import { Queue } from "bullmq";
import { isRedisEnabled } from "../repositories/redis";
import { prisma } from "../repositories/prisma";
import { workoutRepository } from "../repositories/workout.repository";
import { exerciseRepository } from "../repositories/exercise.repository";
import { checkMissingExerciseIds } from "../utils/workout-validation";
import { invalidateCycleProgressCache } from "./training-cycle.service";
import { assertScheduleDateEditable, todayAsScheduleDate, compareScheduleDate, scheduledDateLabel } from "../utils/schedule-lock.util";
import { createPersistentNotification } from "../clients/notification.client";
import { withIdempotentEvent } from "../utils/workout-idempotency.util";
import { estimate1RM } from "../utils/estimated-1rm.util";
import {
  evaluateExerciseProgression,
  type ExercisePerformanceSession,
  type LoggingMode,
  type ExperienceLevel,
} from "./exercise-progression.engine";
import type { CycleDecision } from "./cycle-decision.engine";
import { fetchUserProfile } from "../clients/user.client";
import {
  explainExerciseProgressionSafe,
  type ExplainExerciseProgressionPayload,
} from "../clients/ai.client";
import type {
  CompleteScheduleExerciseDto,
  CreateManualProgramDto,
  CreateWorkoutDto,
  UpdateWorkoutSetDto,
  ImportAiPlanDto,
  ManualSetPrescriptionDto,
} from "../models/fitness.models";
import { SET_TYPES, SET_SIDES } from "../models/fitness.models";

type NormalizedExerciseCatalogItem = {
  id: string;
  name: string;
  rawName: string;
};

type MappedAiExercise = {
  exerciseId: string;
  order: number;
  sets: number;
  reps: number | null;
  restSeconds: number;
  notes?: string;
};

type MappedAiDay = {
  title: string;
  description?: string;
  exercises: MappedAiExercise[];
};

type SetPrescriptionLike = Partial<ManualSetPrescriptionDto> & {
  setNumber: number;
};

const GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: "Giam mo",
  MUSCLE_GAIN: "Tang co",
  MAINTENANCE: "Duy tri",
  ATHLETIC_PERFORMANCE: "Cai thien suc khoe",
  lose_fat: "Giam mo",
  gain_muscle: "Tang co",
  maintain: "Duy tri",
  improve_health: "Cai thien suc khoe",
};

function goalLabel(goal?: string | null) {
  if (!goal) return "AI";
  return CLEAN_GOAL_LABELS[goal] || GOAL_LABELS[goal] || goal;
}

const CLEAN_GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: "Giam mo",
  MUSCLE_GAIN: "Tang co",
  MAINTENANCE: "Duy tri",
  ATHLETIC_PERFORMANCE: "Cai thien suc khoe",
  lose_fat: "Giam mo",
  gain_muscle: "Tang co",
  maintain: "Duy tri",
  improve_health: "Cai thien suc khoe",
};

const CLEAN_WEEKDAY_LABELS: Record<number, string> = {
  0: "Chu nhat",
  1: "Thu 2",
  2: "Thu 3",
  3: "Thu 4",
  4: "Thu 5",
  5: "Thu 6",
  6: "Thu 7",
};

const CORRUPTED_TEXT_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\uFFFD|\?|\u00C3|\u00C4|\u00C6|\u00C7|\u00C8|\u00D3|\u00E1\u00BA|\u00C2|\u00BB/i;

const DAY_FALLBACK_TITLES = [
  "Chan + Mong",
  "Nguc + Vai + Tay sau",
  "Lung + Tay truoc",
  "Core + Cardio",
  "Than tren",
  "Than duoi",
  "Hoi phuc chu dong",
];

function sanitizeImportedText(value?: string | null, fallback?: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (CORRUPTED_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

function sanitizeImportedDayTitle(value: string | undefined, dayIndex: number) {
  const fallback = DAY_FALLBACK_TITLES[dayIndex % DAY_FALLBACK_TITLES.length];
  return sanitizeImportedText(value, fallback) || fallback;
}

function sanitizeImportedExerciseNote(value?: string | null) {
  return sanitizeImportedText(
    value,
    "Tap trung vao ky thuat dung, kiem soat nhip tap va tang tien tu tu.",
  );
}

function buildSetPrescriptionsForExercise(exercise: {
  sets?: number | null;
  reps?: number | null;
  weight?: number | null;
  restSeconds?: number | null;
  setPrescriptions?: SetPrescriptionLike[] | null;
}) {
  const setCount = Math.max(1, Number(exercise.sets) || 1);
  const provided = new Map<number, SetPrescriptionLike>();
  for (const prescription of exercise.setPrescriptions ?? []) {
    if (prescription?.setNumber >= 1 && prescription.setNumber <= setCount) {
      provided.set(prescription.setNumber, prescription);
    }
  }

  return Array.from({ length: setCount }, (_unused, index) => {
    const setNumber = index + 1;
    const source = provided.get(setNumber);
    return {
      setNumber,
      targetReps: source?.targetReps ?? exercise.reps ?? null,
      targetWeight: source?.targetWeight ?? exercise.weight ?? null,
      targetRpe: source?.targetRpe ?? null,
      targetRir: source?.targetRir ?? null,
      targetSetType: source?.targetSetType ?? null,
      targetTempo: source?.targetTempo ?? null,
      targetDurationSeconds: source?.targetDurationSeconds ?? null,
      targetDistanceMeters: source?.targetDistanceMeters ?? null,
      isAmrap: source?.isAmrap ?? false,
      minReps: source?.minReps ?? null,
      restSeconds: source?.restSeconds ?? exercise.restSeconds ?? null,
      notes: source?.notes ?? null,
    };
  });
}

function prescriptionForSet(programExercise: any, setNumber: number) {
  const prescriptions = Array.isArray(programExercise?.setPrescriptions)
    ? programExercise.setPrescriptions
    : [];
  const matched = prescriptions.find((prescription: any) => prescription.setNumber === setNumber);
  if (matched) return matched;
  return {
    targetReps: programExercise.reps ?? null,
    targetWeight: programExercise.weight ?? null,
    targetRpe: null,
    targetRir: null,
    targetSetType: null,
    targetTempo: null,
    targetDurationSeconds: programExercise.duration ?? null,
    targetDistanceMeters: null,
  };
}

const PROGRAM_EXERCISE_INCLUDE = {
  exercise: true,
  setPrescriptions: { orderBy: { setNumber: "asc" as const } },
};

type WorkoutProgressSummary = {
  sessionId: string | null;
  workoutId: string | null;
  planId: string | null;
  dayId: string | null;
  exerciseId?: string | null;
  programExerciseId?: string | null;
  exerciseCompleted?: boolean;
  completedExercises: number;
  totalExercises: number;
  completedSets: number;
  totalSets: number;
  progressPercent: number;
  sessionStatus: "not_started" | "in_progress" | "completed";
  dayStatus: "not_started" | "in_progress" | "completed";
  completedAt: Date | null;
  trainingCycleId?: string | null;
};

function progressPercent(
  completedExercises: number,
  totalExercises: number,
): number {
  return totalExercises === 0
    ? 0
    : Math.round((completedExercises / totalExercises) * 100);
}

function isWorkoutExerciseCompleted(workoutExercise: any): boolean {
  const sets = Array.isArray(workoutExercise?.workoutSets)
    ? workoutExercise.workoutSets
    : [];
  return sets.length > 0 && sets.every((set: any) => set.completed === true);
}

async function createStartedWorkoutForSchedule(
  tx: any,
  schedule: any,
  userId: string,
) {
  if (!schedule.programDay?.exercises?.length) {
    throw { status: 400, message: "Schedule has no planned exercises" };
  }

  return tx.workout.create({
    data: {
      userId,
      name:
        schedule.programDay.title || `Workout ${formatDateOnly(schedule.date)}`,
      description: schedule.programDay.description || null,
      date: schedule.date,
      exercises: {
        create: schedule.programDay.exercises.map(
          (programExercise: any, index: number) => ({
            exerciseId: programExercise.exerciseId,
            programExerciseId: programExercise.id,
            // History-protection snapshot (Gate 4, exerciseNameSnapshot's
            // own schema doc comment) — populated at creation time so a
            // later exercise rename/reclassification never retroactively
            // changes what this logged set displays. Previously only ever
            // backfilled once by the migration for pre-existing rows; every
            // NEW WorkoutExercise since then was silently leaving this
            // null (found via postMigrationIntegrityCheck.ts's snapshot
            // backfill count still growing post-migration).
            exerciseNameSnapshot: programExercise.exercise?.exerciseName ?? null,
            sets: Number(programExercise.sets) || 1,
            reps: programExercise.reps ?? null,
            duration: programExercise.duration ?? null,
            weight: programExercise.weight ?? null,
            notes: programExercise.notes ?? null,
            order: programExercise.order ?? index + 1,
            workoutSets: {
              create: Array.from(
                { length: Number(programExercise.sets) || 1 },
                (_unused, setIndex) => {
                  const prescription = prescriptionForSet(programExercise, setIndex + 1);
                  return {
                    setNumber: setIndex + 1,
                    reps: prescription.targetReps ?? programExercise.reps ?? null,
                    weight: prescription.targetWeight ?? programExercise.weight ?? null,
                    rpe: prescription.targetRpe ?? null,
                    rir: prescription.targetRir ?? null,
                    setType: prescription.targetSetType ?? null,
                    tempo: prescription.targetTempo ?? null,
                    durationSeconds:
                      prescription.targetDurationSeconds ??
                      programExercise.duration ??
                      null,
                    distanceMeters: prescription.targetDistanceMeters ?? null,
                    isAmrap: prescription.isAmrap,
                    amrapMinReps: prescription.minReps,
                    completed: false,
                  };
                },
              ),
            },
          }),
        ),
      },
    },
  });
}

async function recomputeScheduleProgress(
  tx: any,
  scheduleId: string,
  userId: string,
  patch: Partial<WorkoutProgressSummary> = {},
) {
  const schedule = await tx.workoutSchedule.findFirst({
    where: { id: scheduleId, userId },
    include: {
      workout: {
        include: {
          exercises: {
            include: { workoutSets: true },
            orderBy: { order: "asc" },
          },
        },
      },
      programDay: {
        include: {
          program: { select: { id: true } },
          exercises: { orderBy: { order: "asc" }, include: PROGRAM_EXERCISE_INCLUDE },
        },
      },
    },
  });
  if (!schedule) throw { status: 404, message: "Schedule not found" };

  const plannedExercises = schedule.programDay?.exercises ?? [];
  const loggedExercises = schedule.workout?.exercises ?? [];
  const completedByProgramExerciseId = new Set(
    loggedExercises
      .filter(
        (exercise: any) =>
          exercise.programExerciseId && isWorkoutExerciseCompleted(exercise),
      )
      .map((exercise: any) => exercise.programExerciseId),
  );
  const fallbackCompletedExerciseIds = new Set(
    loggedExercises
      .filter(
        (exercise: any) =>
          !exercise.programExerciseId && isWorkoutExerciseCompleted(exercise),
      )
      .map((exercise: any) => exercise.exerciseId),
  );

  const totalExercises = plannedExercises.length || loggedExercises.length;
  const completedExercises =
    plannedExercises.length > 0
      ? plannedExercises.filter(
          (exercise: any) =>
            completedByProgramExerciseId.has(exercise.id) ||
            fallbackCompletedExerciseIds.has(exercise.exerciseId),
        ).length
      : loggedExercises.filter(isWorkoutExerciseCompleted).length;
  const totalSets =
    plannedExercises.length > 0
      ? plannedExercises.reduce(
          (sum: number, exercise: any) => sum + (Number(exercise.sets) || 1),
          0,
        )
      : loggedExercises.reduce(
          (sum: number, exercise: any) =>
            sum +
            (Array.isArray(exercise.workoutSets)
              ? exercise.workoutSets.length
              : 0),
          0,
        );
  const completedSets = loggedExercises.reduce(
    (sum: number, exercise: any) =>
      sum +
      (exercise.workoutSets || []).filter((set: any) => set.completed).length,
    0,
  );
  const percent = progressPercent(completedExercises, totalExercises);
  const completed = totalExercises > 0 && completedExercises === totalExercises;
  // PARTIALLY_COMPLETED distinguishes "some exercises actually logged" from
  // "session started but nothing done yet" — previously both read as
  // IN_PROGRESS, so a session 1-of-4 exercises in was indistinguishable
  // from one just opened. See docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md G2 /
  // docs/workout-log-audit.md's Known Gaps. The external API contract
  // (sessionStatus/dayStatus below) still maps this to "in_progress" —
  // only the persisted WorkoutSchedule.status gains the finer distinction.
  const status = completed
    ? "COMPLETED"
    : completedExercises > 0
      ? "PARTIALLY_COMPLETED"
      : schedule.workoutId || schedule.startedAt
        ? "IN_PROGRESS"
        : "NOT_STARTED";
  const completedAt = completed ? schedule.completedAt || new Date() : null;

  await tx.workoutSchedule.update({
    where: { id: scheduleId },
    data: {
      status,
      progressPercent: percent,
      totalExercises,
      completedExercises,
      totalSets,
      completedSets,
      completedAt,
      startedAt: schedule.startedAt || (schedule.workoutId ? new Date() : null),
    },
  });

  // Adaptive Training Cycle Evaluation: this session's progress just
  // changed — invalidate the cached cycle-progress summary if it's linked
  // to one. Fire-and-forget (best-effort, matches exercise.repository.ts's
  // cache-invalidation style) so a slow/unavailable Redis never blocks or
  // fails the workout-logging request; the 120s TTL self-heals regardless.
  if (schedule.trainingCycleId) {
    void invalidateCycleProgressCache(schedule.trainingCycleId).catch(() => {});
  }

  return {
    sessionId: schedule.workoutId,
    workoutId: schedule.workoutId,
    planId: schedule.programDay?.program?.id ?? null,
    dayId: schedule.programDayId,
    completedExercises,
    totalExercises,
    completedSets,
    totalSets,
    progressPercent: percent,
    sessionStatus: completed
      ? "completed"
      : status === "IN_PROGRESS" || status === "PARTIALLY_COMPLETED"
        ? "in_progress"
        : "not_started",
    dayStatus: completed
      ? "completed"
      : status === "IN_PROGRESS" || status === "PARTIALLY_COMPLETED"
        ? "in_progress"
        : "not_started",
    completedAt,
    trainingCycleId: schedule.trainingCycleId ?? null,
    ...patch,
  } satisfies WorkoutProgressSummary;
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Chu nhat",
  1: "Thu 2",
  2: "Thu 3",
  3: "Thu 4",
  4: "Thu 5",
  5: "Thu 6",
  6: "Thu 7",
};

// Real bug found via a Gate-6 E2E test (fitnessassistant-playwright-e2e/
// tests/25-exercise-muscle-map.spec.ts): this function (and parseDateOnly/
// formatDateOnly below) used LOCAL Date getters/setters
// (getDate/getDay/setDate), which only produce the documented "UTC-
// midnight calendar label" storage convention (see
// src/utils/schedule-lock.util.ts's own module doc comment, and
// __tests__/schedule-lock.util.test.ts's explicit "stored ... as a
// UTC-midnight instant" assumption) when the RUNNING PROCESS's own
// timezone happens to be UTC. Confirmed live against the real dev
// service that it is NOT: requesting startDate "2026-08-20" was stored
// as "2026-08-19T17:00:00.000Z" (Ho_Chi_Minh midnight, not UTC midnight)
// — one full calendar day off from what every reader of this column
// (schedule-lock.util.ts, its frontend mirror, this file's own
// formatDateOnly) assumes, so a schedule created for "today" was locked
// as already-passed. Switched to UTC getters/setters throughout so the
// stored value actually matches the documented contract regardless of
// the server process's own ambient timezone.
function nextDateForWeekday(
  startDate: Date,
  weekday: number,
  weekOffset: number,
) {
  const plannedDate = new Date(startDate);
  const daysAhead = (weekday - plannedDate.getUTCDay() + 7) % 7;
  plannedDate.setUTCDate(plannedDate.getUTCDate() + daysAhead + weekOffset * 7);
  return plannedDate;
}

async function validateExerciseIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await exerciseRepository.findManyByIds(ids);
  const foundSet = new Set(found.map((e) => e.id));
  const missing = checkMissingExerciseIds(ids, foundSet);
  if (missing.length > 0) {
    throw { status: 400, message: `Exercise not found: ${missing.join(", ")}` };
  }
}

// --- Past-date lock guards -------------------------------------------------
// The server is the sole authority on whether a given day's log/plan data
// may still be mutated; the frontend calendar's disabled/locked styling is
// only a UI convenience and must never be the only enforcement point (a
// stale client or a direct API call must be rejected here regardless of
// what the calendar shows). Every mutating entry point below resolves the
// relevant WorkoutSchedule.date (or, for a schedule-less ad-hoc workout log,
// the workout's own `date`) and asserts it via schedule-lock.util before
// touching the database.

async function assertWorkoutEditableByWorkoutId(workoutId: string) {
  const schedule = await prisma.workoutSchedule.findFirst({
    where: { workoutId },
    select: { date: true },
  });
  if (schedule) {
    assertScheduleDateEditable(schedule.date);
    return;
  }
  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    select: { date: true },
  });
  if (workout) assertScheduleDateEditable(workout.date);
}

export const workoutQueue = isRedisEnabled()
  ? new Queue("workout-generation", {
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
      },
    })
  : {
      async add() {
        throw {
          status: 503,
          message:
            "Async workout generation queue is not configured for this deployment",
        };
      },
      async close() {},
    };

// Shared core of getExerciseProgression / getExerciseProgressionExplanation —
// see docs/TRAINING_PROGRESSION_ARCHITECTURE.md §5. Every external lookup
// (profile, active cycle, latest assessment) is independently fail-soft: a
// missing profile/cycle/assessment degrades to the engine's own documented
// defaults (UNKNOWN experience level, null cycle decision) rather than
// erroring the whole request — this is reference/explanation, never a
// blocker to logging a workout.
async function computeExerciseProgressionInternal(
  userId: string,
  exerciseId: string,
  excludeWorkoutId?: string,
) {
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
    select: { exerciseName: true, loggingMode: true },
  });
  if (!exercise) throw { status: 404, message: "Exercise not found" };

  const sessions = await workoutRepository.findRecentCompletedSessionsForExercise(
    userId,
    exerciseId,
    5,
    excludeWorkoutId,
  );
  const recentSessions: ExercisePerformanceSession[] = sessions.map((s) => ({
    date: s.workout.date,
    sets: s.workoutSets.map((set) => ({
      weightKg: set.weight,
      reps: set.reps,
      rir: set.rir,
      rpe: set.rpe,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      completed: true, // repository already filters to completed:true
      setType: set.setType,
      isAmrap: set.isAmrap,
      amrapMinReps: set.amrapMinReps,
    })),
  }));

  const [profile, cycleDecision] = await Promise.all([
    fetchUserProfile(userId).catch(() => null),
    (async () => {
      const activeCycle = await prisma.trainingCycle.findFirst({
        where: { userId, status: "ACTIVE", archivedAt: null },
        select: { id: true },
      });
      if (!activeCycle) return null;
      const latestAssessment = await prisma.cycleAssessment.findFirst({
        where: { cycleId: activeCycle.id, status: "COMPLETED" },
        orderBy: { assessmentVersion: "desc" },
        select: { decision: true },
      });
      return (latestAssessment?.decision as CycleDecision | undefined) ?? null;
    })().catch(() => null),
  ]);

  const experienceLevel: ExperienceLevel = (profile?.experienceLevel as ExperienceLevel) ?? "UNKNOWN";

  const result = evaluateExerciseProgression({
    loggingMode: (exercise.loggingMode as LoggingMode) ?? "REPS_LOAD",
    experienceLevel,
    recentSessions,
    cycleDecision,
  });

  return { exercise, experienceLevel, result };
}

const PROGRESSION_STATUS_LABEL_VI: Record<string, string> = {
  KEEP: "giữ nguyên mức hiện tại",
  INCREASE_LOAD: "tăng tải",
  INCREASE_REPS: "tăng số rep",
  INCREASE_SETS: "tăng số set",
  DELOAD: "giảm tải để phục hồi",
  REVIEW: "xem lại trước khi thay đổi",
  INSUFFICIENT_DATA: "chưa đủ dữ liệu để kết luận",
};

// Local, non-AI fallback used only when ai-service itself is unreachable
// (network error/timeout at the HTTP call level) — distinct from, and in
// addition to, ai-service's OWN internal deterministic fallback (used when
// ai-service is up but its LLM backend is not). Mirrors
// exercise-progression-explanation.service.ts's buildDeterministicFallback
// in ai-service so both fallback paths read the same regardless of which
// layer produced them.
function buildLocalDeterministicExplanation(
  exerciseName: string,
  result: { status: string; reasonCodes: string[] },
): string {
  const label = PROGRESSION_STATUS_LABEL_VI[result.status] ?? result.status;
  const reasons = result.reasonCodes.length > 0 ? result.reasonCodes.join(", ") : "dữ liệu buổi tập gần đây";
  return `Hệ thống đề xuất "${label}" cho ${exerciseName}, dựa trên: ${reasons}.`;
}

export const workoutService = {
  async listWorkouts(
    userId: string,
    filters: { startDate?: string; endDate?: string; limit?: string },
  ) {
    const where: any = { userId };
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    return workoutRepository.findMany(
      where,
      filters.limit ? parseInt(filters.limit) : 50,
    );
  },

  async getWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: "Workout not found" };
    return workout;
  },

  async createWorkout(userId: string, data: CreateWorkoutDto) {
    await validateExerciseIds(data.exercises.map((ex) => ex.exerciseId));
    const workoutData: any = { ...data };
    if ((data as any).scheduleId) {
      const schedule = await prisma.workoutSchedule.findFirst({
        where: { id: (data as any).scheduleId, userId },
      });
      if (!schedule) throw { status: 404, message: "Schedule not found" };
      if (schedule.workoutId)
        throw {
          status: 409,
          message: "Schedule already has a completed workout log",
        };
      assertScheduleDateEditable(schedule.date);
      workoutData.date = schedule.date.toISOString();
    } else if (data.date) {
      assertScheduleDateEditable(new Date(data.date));
    } else {
      // Real bug found via this session's own regression testing (reproduces
      // reliably every day roughly VN-midnight-to-7am, i.e. right now):
      // leaving `date` unset here let Prisma's raw `Workout.date
      // @default(now())` apply — a true UTC instant. Every OTHER date this
      // codebase writes/compares (WorkoutSchedule.date, and every call site
      // in this same file) is a UTC-midnight-anchored calendar-day LABEL in
      // APP_SCHEDULE_TIME_ZONE (see schedule-lock.util.ts's own module doc
      // comment) — a real instant is not the same value once VN-local-day
      // has advanced past UTC-day, which happens for ~7 hours every single
      // day. assertWorkoutEditableByWorkoutId's schedule-less fallback then
      // read that "yesterday" UTC label and immediately locked a workout the
      // user had just that moment created — a false SCHEDULE_DATE_LOCKED
      // ("past") on brand-new data, for anyone logging a freeform/unscheduled
      // workout during that window. Fixed by using the same
      // todayAsScheduleDate() helper every other "what day is today" call
      // site in this codebase already uses, instead of letting a raw instant
      // default silently apply here.
      workoutData.date = todayAsScheduleDate().toISOString();
    }
    return workoutRepository.create(userId, workoutData);
  },

  async updateWorkout(id: string, userId: string, data: CreateWorkoutDto) {
    const existing = await workoutRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: "Workout not found" };
    await validateExerciseIds(data.exercises.map((ex) => ex.exerciseId));
    const workoutData: any = { ...data };
    if ((data as any).scheduleId) {
      const schedule = await prisma.workoutSchedule.findFirst({
        where: { id: (data as any).scheduleId, userId },
      });
      if (!schedule) throw { status: 404, message: "Schedule not found" };
      if (schedule.workoutId && schedule.workoutId !== id) {
        throw {
          status: 409,
          message: "Schedule already has a completed workout log",
        };
      }
      assertScheduleDateEditable(schedule.date);
      workoutData.date = schedule.date.toISOString();
    } else {
      await assertWorkoutEditableByWorkoutId(id);
    }
    return workoutRepository.update(id, workoutData);
  },

  async deleteWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: "Workout not found" };
    await assertWorkoutEditableByWorkoutId(id);
    await workoutRepository.delete(id);
    return { message: "Workout deleted" };
  },

  // "Previous performance" prefill (docs/TRAINING_PROGRESSION_ARCHITECTURE.md
  // §3, gap analysis P0 #1: confirmed absent before this — no per-exercise
  // history endpoint existed anywhere in this controller). Returns exactly
  // what the user logged last time for this exercise, per set, with no
  // recommendation attached — the caller (UI/AI) must never present this as
  // a target, only as reference context ("last time you did...").
  async getPreviousPerformance(userId: string, exerciseId: string, excludeWorkoutId?: string) {
    const prior = await workoutRepository.findLastCompletedSetsForExercise(
      userId,
      exerciseId,
      excludeWorkoutId,
    );
    if (!prior) {
      return { exerciseId, hasHistory: false, date: null, sets: [] };
    }
    return {
      exerciseId,
      hasHistory: true,
      date: prior.workout.date,
      sets: prior.workoutSets.map((s) => ({
        setNumber: s.setNumber,
        weightKg: s.weight,
        bodyWeightAtSetKg: s.bodyWeightAtSetKg,
        reps: s.reps,
        rpe: s.rpe,
        rir: s.rir,
        setType: s.setType,
        durationSeconds: s.durationSeconds,
        distanceMeters: s.distanceMeters,
      })),
    };
  },

  // Wires exercise-progression.engine.ts (built and unit-tested earlier in
  // this pass, but never actually reachable by a real user until this
  // endpoint — a real, honestly-flagged gap this pass closes) to real data:
  // recent session history, the exercise's loggingMode, the user's
  // experienceLevel (via the existing fitness-service -> user-service
  // client, never touching user-service's own files), and the current
  // active cycle's latest decision (for the precedence envelope —
  // docs/TRAINING_PROGRESSION_ARCHITECTURE.md §2). Every external lookup is
  // independently fail-soft: a missing profile/cycle/assessment degrades to
  // the engine's own documented defaults (UNKNOWN experience level, null
  // cycle decision) rather than erroring the whole request — this is
  // reference/explanation, never a blocker to logging a workout.
  async getExerciseProgression(userId: string, exerciseId: string, excludeWorkoutId?: string) {
    const { result } = await computeExerciseProgressionInternal(userId, exerciseId, excludeWorkoutId);
    return { exerciseId, ...result };
  },

  // openGym FINAL P0 CLOSURE PASS — docs/TRAINING_PROGRESSION_ARCHITECTURE.md
  // §5. OPTIONAL, separate, slower sibling of getExerciseProgression above:
  // that endpoint stays purely deterministic and MUST keep working with zero
  // AI dependency; this one additionally asks ai-service to explain the
  // already-computed decision in natural Vietnamese. explainExerciseProgressionSafe
  // never throws (ai-service down/timeout -> null), and even then this method
  // still returns a real, locally-built explanation — AI is never a
  // dependency of this request succeeding, only of whether the explanation
  // text happens to be LLM-written vs mechanically templated.
  async getExerciseProgressionExplanation(userId: string, exerciseId: string, excludeWorkoutId?: string) {
    const { exercise, experienceLevel, result } = await computeExerciseProgressionInternal(
      userId,
      exerciseId,
      excludeWorkoutId,
    );

    const payload: ExplainExerciseProgressionPayload = {
      userId,
      exerciseName: exercise.exerciseName,
      loggingMode: (exercise.loggingMode as ExplainExerciseProgressionPayload["loggingMode"]) ?? "REPS_LOAD",
      experienceLevel,
      status: result.status,
      currentPerformance: result.currentPerformance
        ? {
            weightKg: result.currentPerformance.weightKg,
            reps: result.currentPerformance.reps,
            durationSeconds: result.currentPerformance.durationSeconds,
            distanceMeters: result.currentPerformance.distanceMeters,
          }
        : null,
      nextTarget: result.nextTarget,
      reasonCodes: result.reasonCodes,
      cycleContext: result.cycleContext,
    };

    const aiResult = await explainExerciseProgressionSafe(userId, payload);
    if (aiResult) {
      return { exerciseId, ...aiResult };
    }

    // ai-service itself unreachable (not just its LLM backend) — local,
    // non-AI fallback so this endpoint never errors just because AI is down.
    return {
      exerciseId,
      explanation: buildLocalDeterministicExplanation(exercise.exerciseName, result),
      source: "deterministic-fallback" as const,
    };
  },

  async getPRs(userId: string, exerciseId?: string) {
    const where: any = { workout: { userId } };
    if (exerciseId) where.exerciseId = exerciseId;

    const exercises = await workoutRepository.findExercisePRs(
      userId,
      exerciseId,
    );
    return exercises;
  },

  // "Kết thúc buổi tập → hiển thị PR và tiến độ": end-of-session summary
  // shown once on the WorkoutLogPage completion screen. A PR here means
  // this session's best set for an exercise beat that exercise's prior
  // best (by estimated 1RM, so "same weight, more reps" correctly counts
  // as an improvement, not just a heavier absolute weight) — a user's
  // very first time doing an exercise is deliberately NOT flagged as a
  // PR, since there is nothing yet to have beaten.
  async getSessionSummary(userId: string, workoutId: string) {
    const workout = await workoutRepository.findOne(workoutId, userId);
    if (!workout) throw { status: 404, message: "Workout not found" };

    const weightedExercises = workout.exercises.filter(
      (ex: any) => ex.weight != null && ex.weight > 0,
    );
    const exerciseIds = [...new Set(weightedExercises.map((ex: any) => ex.exerciseId))] as string[];
    const priorSets = await workoutRepository.findPriorSetsForExercises(
      userId,
      exerciseIds,
      workoutId,
    );

    const priorBestByExercise = new Map<
      string,
      { weight: number; reps: number | null; e1rm: number }
    >();
    for (const s of priorSets as any[]) {
      if (s.weight == null) continue;
      const e1rm = estimate1RM(s.weight, s.reps ?? 0);
      const current = priorBestByExercise.get(s.exerciseId);
      if (!current || e1rm > current.e1rm) {
        priorBestByExercise.set(s.exerciseId, {
          weight: s.weight,
          reps: s.reps ?? null,
          e1rm,
        });
      }
    }

    const sessionBestByExercise = new Map<
      string,
      { weight: number; reps: number | null; e1rm: number; exerciseName: string }
    >();
    for (const ex of weightedExercises as any[]) {
      const e1rm = estimate1RM(ex.weight, ex.reps ?? 0);
      const current = sessionBestByExercise.get(ex.exerciseId);
      if (!current || e1rm > current.e1rm) {
        sessionBestByExercise.set(ex.exerciseId, {
          weight: ex.weight,
          reps: ex.reps ?? null,
          e1rm,
          exerciseName:
            ex.exerciseNameSnapshot || ex.exercise?.exerciseName || "Bài tập",
        });
      }
    }

    const prs: Array<{
      exerciseId: string;
      exerciseName: string;
      prType: "WEIGHT_E1RM" | "REPS";
      weightKg: number | null;
      reps: number | null;
      estimated1RmKg: number | null;
      previousBestWeightKg: number | null;
      previousBestEstimated1RmKg: number | null;
      previousBestReps: number | null;
    }> = [];
    for (const [exerciseId, best] of sessionBestByExercise) {
      const prior = priorBestByExercise.get(exerciseId);
      if (prior && best.e1rm > prior.e1rm) {
        prs.push({
          exerciseId,
          exerciseName: best.exerciseName,
          prType: "WEIGHT_E1RM",
          weightKg: best.weight,
          reps: best.reps,
          estimated1RmKg: Math.round(best.e1rm * 10) / 10,
          previousBestWeightKg: prior.weight,
          previousBestEstimated1RmKg: Math.round(prior.e1rm * 10) / 10,
          previousBestReps: null,
        });
      }
    }

    // Bodyweight exercises (no added load — weight is null): the e1RM
    // comparison above never applies to these (estimate1RM needs a weight),
    // so without this block a user doing only bodyweight work would never
    // see a PR, ever. PR here is simply "more reps than your prior best for
    // this exercise" — reps is the only performance axis available. A
    // user's first time doing the exercise is not flagged, same rule as
    // the weighted path above (nothing yet to have beaten).
    const bodyweightExercises = workout.exercises.filter(
      (ex: any) => ex.weight == null && ex.reps != null && ex.reps > 0,
    );
    if (bodyweightExercises.length > 0) {
      const bwExerciseIds = [
        ...new Set(bodyweightExercises.map((ex: any) => ex.exerciseId)),
      ] as string[];
      const priorBwSets = await workoutRepository.findPriorBodyweightRepsForExercises(
        userId,
        bwExerciseIds,
        workoutId,
      );
      const priorBestRepsByExercise = new Map<string, number>();
      for (const s of priorBwSets as any[]) {
        if (s.reps == null) continue;
        const current = priorBestRepsByExercise.get(s.exerciseId);
        if (current == null || s.reps > current) {
          priorBestRepsByExercise.set(s.exerciseId, s.reps);
        }
      }

      const sessionBestRepsByExercise = new Map<
        string,
        { reps: number; exerciseName: string }
      >();
      for (const ex of bodyweightExercises as any[]) {
        const current = sessionBestRepsByExercise.get(ex.exerciseId);
        if (!current || ex.reps > current.reps) {
          sessionBestRepsByExercise.set(ex.exerciseId, {
            reps: ex.reps,
            exerciseName:
              ex.exerciseNameSnapshot || ex.exercise?.exerciseName || "Bài tập",
          });
        }
      }

      for (const [exerciseId, best] of sessionBestRepsByExercise) {
        const priorBestReps = priorBestRepsByExercise.get(exerciseId);
        if (priorBestReps != null && best.reps > priorBestReps) {
          prs.push({
            exerciseId,
            exerciseName: best.exerciseName,
            prType: "REPS",
            weightKg: null,
            reps: best.reps,
            estimated1RmKg: null,
            previousBestWeightKg: null,
            previousBestEstimated1RmKg: null,
            previousBestReps: priorBestReps,
          });
        }
      }
    }

    const totalVolumeKg = workout.exercises.reduce((sum: number, ex: any) => {
      if (ex.weight == null) return sum;
      return sum + ex.weight * (ex.reps ?? 1) * (ex.sets ?? 1);
    }, 0);
    const totalSets = workout.exercises.reduce(
      (sum: number, ex: any) => sum + (ex.sets ?? 0),
      0,
    );

    return {
      workoutId,
      exerciseCount: workout.exercises.length,
      totalSets,
      totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
      prs,
    };
  },

  async updateSet(setId: string, userId: string, data: UpdateWorkoutSetDto, eventId?: string | null) {
    const existing = await workoutRepository.findSetWithOwner(setId, userId);
    if (!existing) throw { status: 404, message: "Set not found" };
    const workoutExerciseForLock = await prisma.workoutExercise.findFirst({
      where: { id: existing.workoutExerciseId, workout: { userId } },
      select: { workoutId: true },
    });
    if (workoutExerciseForLock?.workoutId) {
      await assertWorkoutEditableByWorkoutId(workoutExerciseForLock.workoutId);
    }

    // Roadmap P1.4 "Active-workout offline resilience" — the update and
    // its progress recompute now run in ONE transaction (previously two
    // separate operations) specifically so the idempotency check below is
    // atomic with the mutation: either both the ledger row and the write
    // commit together, or a crash rolls back both and a retry starts
    // clean. See workout-idempotency.util.ts's own doc comment.
    return prisma.$transaction((tx) =>
      withIdempotentEvent(
        tx,
        eventId,
        userId,
        data.completed === false ? "SET_UNDONE" : "SET_COMPLETED",
        async () => {
          const { segments, ...setData } = data;
          const updated = await tx.workoutSet.update({
            where: { id: setId },
            data: {
              ...setData,
              ...(segments !== undefined
                ? {
                    segments: {
                      deleteMany: {},
                      create: segments,
                    },
                  }
                : {}),
            },
            include: { segments: { orderBy: { segmentNumber: "asc" } } },
          });
          const workoutExercise = await tx.workoutExercise.findFirst({
            where: { id: existing.workoutExerciseId, workout: { userId } },
            select: { workoutId: true, exerciseId: true, programExerciseId: true },
          });
          // Roadmap P1.1 "true set-by-set table UI" — the recompute already
          // ran here before that change, its result was just discarded.
          // Returning it lets a caller completing the LAST remaining set of
          // an exercise via this endpoint (instead of
          // completeScheduleExercise, which would otherwise overwrite every
          // SIBLING set's already-logged distinct values — see
          // docs/features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md) learn the
          // same completedExercises/totalExercises/progressPercent/status/
          // trainingCycleId completeScheduleExercise's response already
          // carries, without a second network round-trip. `undefined` (the
          // pre-existing behavior) when this set isn't linked to a
          // schedule at all (the ad-hoc/freeform logging path).
          let progress: Awaited<ReturnType<typeof recomputeScheduleProgress>> | undefined;
          if (workoutExercise?.workoutId) {
            const schedule = await tx.workoutSchedule.findFirst({
              where: { userId, workoutId: workoutExercise.workoutId },
              select: { id: true },
            });
            if (schedule) {
              progress = await recomputeScheduleProgress(tx, schedule.id, userId, {
                sessionId: workoutExercise.workoutId!,
                workoutId: workoutExercise.workoutId!,
                exerciseId: workoutExercise.exerciseId,
                programExerciseId: workoutExercise.programExerciseId ?? undefined,
              });
            }
          }
          return { ...updated, progress };
        },
      ),
    );
  },

  // POST /workouts/:id/sets - append a single set to an existing workout. Finds or
  // creates the WorkoutExercise(workoutId, exerciseId), then appends a new WorkoutSet
  // with the next set_number for that exercise.
  async addSet(
    workoutId: string,
    userId: string,
    body: {
      exerciseId: string;
      setNumber?: number;
      weight?: number;
      reps?: number;
      rpe?: number;
      rir?: number;
      setType?: string | null;
      tempo?: string | null;
      rangeOfMotion?: string | null;
      side?: string | null;
      painScore?: number | null;
      techniqueNotes?: string | null;
    },
  ) {
    if (body.rpe !== undefined && (body.rpe < 1 || body.rpe > 10)) {
      throw { status: 400, message: "rpe must be between 1 and 10" };
    }
    if (body.rir !== undefined && (body.rir < 0 || body.rir > 5)) {
      throw { status: 400, message: "rir must be between 0 and 5" };
    }
    if (body.setType != null && !SET_TYPES.includes(body.setType as any)) {
      throw {
        status: 400,
        message: `setType must be one of: ${SET_TYPES.join(", ")}`,
      };
    }
    if (body.side != null && !SET_SIDES.includes(body.side as any)) {
      throw { status: 400, message: `side must be one of: ${SET_SIDES.join(", ")}` };
    }
    if (body.painScore != null && (body.painScore < 0 || body.painScore > 10)) {
      throw { status: 400, message: "painScore must be between 0 and 10" };
    }
    if (!body.exerciseId)
      throw { status: 400, message: "exerciseId is required" };

    const workout = await workoutRepository.findOne(workoutId, userId);
    if (!workout) throw { status: 404, message: "Workout not found" };
    await assertWorkoutEditableByWorkoutId(workoutId);

    await validateExerciseIds([body.exerciseId]);
    return workoutRepository.appendSet(workoutId, body.exerciseId, body);
  },

  async queueWorkoutGeneration(userId: string, params: any) {
    const job = await workoutQueue.add("generate-workout", {
      userId,
      ...params,
    });
    return { message: "Workout generation started", jobId: job.id };
  },

  async listSchedules(
    userId: string,
    params: { limit?: number; startDate?: string; endDate?: string } = {},
  ) {
    const where: any = {
      userId,
      // Hide un-executed placeholder days from an abandoned (archived)
      // program so an old plan doesn't keep cluttering the calendar after
      // the user switches plans — but a schedule that already has a real
      // completed workout attached must ALWAYS stay visible regardless of
      // its program's current status; that's real history, not a stale
      // placeholder, and archiving a later plan must never make a past
      // completed session disappear.
      OR: [
        { programDayId: null },
        { programDay: { program: { status: "ACTIVE" } } },
        { workoutId: { not: null } },
      ],
    };
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = parseDateOnly(params.startDate);
      if (params.endDate) where.date.lte = parseDateOnly(params.endDate);
    }
    // When a date range is provided (calendar month query), don't cap results with a low
    // default - a month with 6 training days/week can have up to ~26 schedules.
    // Only apply the limit when explicitly passed (or fallback to 200 for safety).
    const takeLimit =
      params.startDate || params.endDate
        ? (params.limit ?? 200)
        : (params.limit ?? 20);

    return prisma.workoutSchedule.findMany({
      where,
      orderBy: { date: "asc" },
      take: takeLimit,
      include: {
        workout: true,
        programDay: {
          include: {
            program: {
              select: {
                id: true,
                name: true,
                sourceType: true,
                sourcePlanId: true,
                status: true,
              },
            },
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
            // Roadmap P1.3 "Superset / exercise grouping".
            exerciseGroups: {
              include: { members: true },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });
  },

  async createSchedule(
    userId: string,
    data: { date?: string; programDayId?: string; notes?: string | null },
  ) {
    if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw { status: 400, message: "date must be YYYY-MM-DD" };
    }
    if (!data.programDayId || typeof data.programDayId !== "string") {
      throw { status: 400, message: "programDayId is required" };
    }

    const programDay = await prisma.workoutProgramDay.findFirst({
      where: { id: data.programDayId, program: { userId } },
      include: {
        program: true,
        exercises: {
          include: PROGRAM_EXERCISE_INCLUDE,
          orderBy: { order: "asc" },
        },
      },
    });
    if (!programDay) throw { status: 404, message: "Program day not found" };

    const date = parseDateOnly(data.date);
    const existing = await prisma.workoutSchedule.findFirst({
      where: { userId, date },
      include: {
        workout: true,
        programDay: {
          include: {
            program: true,
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });
    if (existing) {
      return { alreadyExists: true, schedule: existing };
    }

    const schedule = await prisma.workoutSchedule.create({
      data: {
        userId,
        date,
        programDayId: data.programDayId,
        sourcePlanId: programDay.program.sourcePlanId,
        sourceType: programDay.program.sourceType || "MANUAL",
        notes:
          typeof data.notes === "string" && data.notes.trim()
            ? data.notes.trim()
            : null,
      },
      include: {
        workout: true,
        programDay: {
          include: {
            program: true,
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    return { alreadyExists: false, schedule };
  },

  async startSchedule(userId: string, scheduleId: string) {
    return prisma.$transaction(async (tx) => {
      const schedule = await tx.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: {
          workout: true,
          programDay: {
            include: {
              program: { select: { id: true } },
              exercises: { orderBy: { order: "asc" }, include: PROGRAM_EXERCISE_INCLUDE },
            },
          },
        },
      });
      if (!schedule) throw { status: 404, message: "Schedule not found" };

      let workoutId = schedule.workoutId;
      if (!workoutId) {
        // Only block *creating* a brand-new session for a locked past day —
        // a day that already has a workout attached is allowed to resume
        // here (idempotent progress recompute), since that's also how the
        // frontend re-enters an existing session to show it read-only.
        // Historical data must stay viewable even once it's locked.
        assertScheduleDateEditable(schedule.date);
        const workout = await createStartedWorkoutForSchedule(
          tx,
          schedule,
          userId,
        );
        workoutId = workout.id;
        await tx.workoutSchedule.update({
          where: { id: schedule.id },
          data: {
            workoutId,
            status: "IN_PROGRESS",
            startedAt: schedule.startedAt || new Date(),
            totalExercises: schedule.programDay?.exercises?.length ?? 0,
            completedExercises: 0,
            totalSets: (schedule.programDay?.exercises ?? []).reduce(
              (sum: number, exercise: any) =>
                sum + (Number(exercise.sets) || 1),
              0,
            ),
            completedSets: 0,
            progressPercent: 0,
          },
        });
      }

      return recomputeScheduleProgress(tx, schedule.id, userId, {
        sessionId: workoutId,
        workoutId,
      });
    });
  },

  async completeScheduleExercise(
    userId: string,
    scheduleId: string,
    programExerciseId: string,
    performed?: CompleteScheduleExerciseDto,
    eventId?: string | null,
  ) {
    // performed carries what the user ACTUALLY logged in WorkoutLogPage's
    // "Ghi chép" card (weight/reps/RPE/RIR) and/or a session-only exercise
    // swap (SwapExerciseModal) — falls back to the plan's prescribed values
    // when omitted, exactly matching the old (no-body) behavior. Only the
    // WorkoutExercise/WorkoutSet LOG rows are affected; plannedExercise
    // (the WorkoutProgramExercise row) is never written to, so the
    // underlying program/plan and any other schedule stay untouched.
    if (performed?.exerciseId) {
      await validateExerciseIds([performed.exerciseId]);
    }
    // Roadmap P1.4 "Active-workout offline resilience" — see
    // workout-idempotency.util.ts's own doc comment. Optional eventId,
    // fully backward compatible with every existing caller.
    return prisma.$transaction((tx) => withIdempotentEvent(tx, eventId, userId, "EXERCISE_COMPLETED", async () => {
      const schedule = await tx.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: {
          workout: {
            include: { exercises: { include: { workoutSets: true } } },
          },
          programDay: {
            include: {
              program: { select: { id: true } },
              exercises: { orderBy: { order: "asc" }, include: PROGRAM_EXERCISE_INCLUDE },
            },
          },
        },
      });
      if (!schedule) throw { status: 404, message: "Schedule not found" };
      assertScheduleDateEditable(schedule.date);

      const plannedExercise = schedule.programDay?.exercises?.find(
        (exercise: any) => exercise.id === programExerciseId,
      );
      if (!plannedExercise)
        throw {
          status: 404,
          message: "Planned exercise not found in this schedule",
        };

      let workoutId = schedule.workoutId;
      if (!workoutId) {
        const workout = await createStartedWorkoutForSchedule(
          tx,
          schedule,
          userId,
        );
        workoutId = workout.id;
        await tx.workoutSchedule.update({
          where: { id: schedule.id },
          data: {
            workoutId,
            status: "IN_PROGRESS",
            startedAt: schedule.startedAt || new Date(),
          },
        });
      }
      if (!workoutId)
        throw { status: 500, message: "Workout session could not be started" };

      let workoutExercise = await tx.workoutExercise.findFirst({
        where: { workoutId, programExerciseId },
        include: { workoutSets: true },
      });
      let finalExerciseId: string;

      if (!workoutExercise) {
        // First time this exercise is being logged — fall back to the
        // PLAN's prescribed values (there's nothing else to fall back to).
        const actualExerciseId = performed?.exerciseId ?? plannedExercise.exerciseId;
        const actualWeight = performed?.weight ?? plannedExercise.weight ?? null;
        const actualReps = performed?.reps ?? plannedExercise.reps ?? null;
        const actualNotes = performed?.notes ?? plannedExercise.notes ?? null;
        const actualBodyWeightAtSetKg = performed?.bodyWeightAtSetKg ?? null;
        const actualDurationSeconds = performed?.durationSeconds ?? plannedExercise.duration ?? null;
        const actualDistanceMeters = performed?.distanceMeters ?? null;
        finalExerciseId = actualExerciseId;
        // History-protection snapshot (see createStartedWorkoutForSchedule's
        // matching comment above) — the ACTUALLY performed exercise's name
        // (a session-only swap counts as "actually performed", not the
        // originally-planned one) at the moment it was logged.
        const actualExerciseName =
          actualExerciseId === plannedExercise.exerciseId
            ? plannedExercise.exercise?.exerciseName ?? null
            : (await tx.exercise.findUnique({ where: { id: actualExerciseId }, select: { exerciseName: true } }))
                ?.exerciseName ?? null;
        workoutExercise = await tx.workoutExercise.create({
          data: {
            workoutId,
            exerciseId: actualExerciseId,
            programExerciseId: plannedExercise.id,
            exerciseNameSnapshot: actualExerciseName,
            sets: Number(plannedExercise.sets) || 1,
            reps: actualReps,
            duration: actualDurationSeconds,
            weight: actualWeight,
            notes: actualNotes,
            order: plannedExercise.order ?? 0,
            workoutSets: {
              create: Array.from(
                { length: Number(plannedExercise.sets) || 1 },
                (_unused, index) => {
                  const prescription = prescriptionForSet(plannedExercise, index + 1);
                  return {
                    setNumber: index + 1,
                    reps: performed?.reps ?? prescription.targetReps ?? actualReps,
                    weight: performed?.weight ?? prescription.targetWeight ?? actualWeight,
                    rpe: performed?.rpe ?? prescription.targetRpe ?? null,
                    rir: performed?.rir ?? prescription.targetRir ?? null,
                    setType: prescription.targetSetType ?? null,
                    tempo: prescription.targetTempo ?? null,
                    bodyWeightAtSetKg: actualBodyWeightAtSetKg,
                    durationSeconds:
                      performed?.durationSeconds ??
                      prescription.targetDurationSeconds ??
                      actualDurationSeconds,
                    distanceMeters:
                      performed?.distanceMeters ??
                      prescription.targetDistanceMeters ??
                      actualDistanceMeters,
                    isAmrap: prescription.isAmrap,
                    amrapMinReps: prescription.minReps,
                    completed: false,
                  };
                },
              ),
            },
          },
          include: { workoutSets: true },
        });
      } else if (performed) {
        // Re-completing an already-logged WorkoutExercise (e.g. the user
        // navigated back and re-submitted, or `startSchedule` pre-created
        // this row before any completion happened — the common case in
        // practice) — fall back to what's ALREADY on the row, not the
        // plan's original defaults. Falling back to the plan here would
        // silently revert a session-only swap (or a previously-logged
        // weight/RPE/RIR) the moment any LATER completion call for this
        // exercise omits that one field.
        const actualExerciseId = performed.exerciseId ?? workoutExercise.exerciseId;
        const actualWeight = performed.weight ?? workoutExercise.weight ?? null;
        const actualReps = performed.reps ?? workoutExercise.reps ?? null;
        const actualNotes = performed.notes ?? workoutExercise.notes ?? null;
        const existingSet = workoutExercise.workoutSets[0];
        const actualRpe = performed.rpe ?? existingSet?.rpe ?? null;
        const actualRir = performed.rir ?? existingSet?.rir ?? null;
        const actualBodyWeightAtSetKg = performed.bodyWeightAtSetKg ?? existingSet?.bodyWeightAtSetKg ?? null;
        const actualDurationSeconds =
          performed.durationSeconds ?? existingSet?.durationSeconds ?? workoutExercise.duration ?? null;
        const actualDistanceMeters = performed.distanceMeters ?? existingSet?.distanceMeters ?? null;
        finalExerciseId = actualExerciseId;
        // Only re-resolve the snapshot when the exercise itself actually
        // changed on this re-submit (a late swap) — avoids a needless
        // lookup on every ordinary re-completion (weight/RPE correction).
        const exerciseNameSnapshotUpdate =
          actualExerciseId === workoutExercise.exerciseId
            ? undefined
            : (await tx.exercise.findUnique({ where: { id: actualExerciseId }, select: { exerciseName: true } }))
                ?.exerciseName ?? null;
        await tx.workoutExercise.update({
          where: { id: workoutExercise.id },
          data: {
            exerciseId: actualExerciseId,
            reps: actualReps,
            weight: actualWeight,
            duration: actualDurationSeconds,
            notes: actualNotes,
            ...(exerciseNameSnapshotUpdate !== undefined ? { exerciseNameSnapshot: exerciseNameSnapshotUpdate } : {}),
          },
        });
        await tx.workoutSet.updateMany({
          where: { workoutExerciseId: workoutExercise.id },
          data: {
            weight: actualWeight,
            reps: actualReps,
            rpe: actualRpe,
            rir: actualRir,
            bodyWeightAtSetKg: actualBodyWeightAtSetKg,
            durationSeconds: actualDurationSeconds,
            distanceMeters: actualDistanceMeters,
          },
        });
      } else {
        // Row already existed and no `performed` override was sent (the old
        // no-body call shape) — nothing to change, just report what's there.
        finalExerciseId = workoutExercise.exerciseId;
      }

      await tx.workoutSet.updateMany({
        where: { workoutExerciseId: workoutExercise.id },
        data: { completed: true },
      });

      return recomputeScheduleProgress(tx, schedule.id, userId, {
        sessionId: workoutId,
        workoutId,
        exerciseId: finalExerciseId,
        programExerciseId,
        exerciseCompleted: true,
      });
    }));
  },

  // Roadmap P1.6 "undo last set" / Milestone P1-A exit criterion. Deliberately
  // narrow (see docs/features/UNDO_LAST_SET_IMPACT_ANALYSIS.md): reverts the
  // ONE exercise the caller names back to not-completed, never a general
  // multi-step history undo. recomputeScheduleProgress is the exact same
  // derivation completeScheduleExercise already uses — it always recomputes
  // completedExercises/progressPercent/status fresh from the current
  // WorkoutSet.completed flags, so undo needs no parallel counting logic at
  // all, just the flag flip. The frontend is responsible for only ever
  // offering this for the most-recently-completed exercise in the current
  // session (never a general edit-history undo) — this method's own
  // authorization is ownership + "is this exercise currently completed",
  // same trust boundary completeScheduleExercise already has for "which
  // exercise" (both take an explicit programExerciseId from the caller).
  async undoCompleteScheduleExercise(
    userId: string,
    scheduleId: string,
    programExerciseId: string,
    eventId?: string | null,
  ) {
    // Roadmap P1.4 "Active-workout offline resilience" — same pattern as
    // completeScheduleExercise above.
    return prisma.$transaction((tx) => withIdempotentEvent(tx, eventId, userId, "EXERCISE_UNDONE", async () => {
      const schedule = await tx.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
      });
      if (!schedule) throw { status: 404, message: "Schedule not found" };
      assertScheduleDateEditable(schedule.date);
      if (!schedule.workoutId) {
        throw { status: 409, message: "No session has been started for this schedule yet" };
      }

      const workoutExercise = await tx.workoutExercise.findFirst({
        where: { workoutId: schedule.workoutId, programExerciseId },
        include: { workoutSets: true },
      });
      if (!workoutExercise || !isWorkoutExerciseCompleted(workoutExercise)) {
        throw { status: 409, message: "This exercise is not currently marked complete" };
      }

      await tx.workoutSet.updateMany({
        where: { workoutExerciseId: workoutExercise.id },
        data: { completed: false },
      });

      return recomputeScheduleProgress(tx, schedule.id, userId, {
        sessionId: schedule.workoutId,
        workoutId: schedule.workoutId,
        exerciseId: workoutExercise.exerciseId,
        programExerciseId,
        exerciseCompleted: false,
      });
    }));
  },

  async createManualProgram(userId: string, input: CreateManualProgramDto) {
    if (input.days.length !== input.daysPerWeek) {
      throw {
        status: 400,
        message: `days must contain exactly ${input.daysPerWeek} training days`,
      };
    }
    if (input.selectedWeekdays.length !== input.daysPerWeek) {
      throw {
        status: 400,
        message: `selectedWeekdays must contain exactly ${input.daysPerWeek} weekdays`,
      };
    }
    const uniqueWeekdays = new Set(input.selectedWeekdays);
    if (uniqueWeekdays.size !== input.selectedWeekdays.length) {
      throw { status: 400, message: "selectedWeekdays must be unique" };
    }

    const exerciseIds = input.days.flatMap((day) =>
      day.exercises.map((exercise) => exercise.exerciseId),
    );
    await validateExerciseIds([...new Set(exerciseIds)]);

    const startDate = parseDateOnly(input.startDate);
    const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
    const shouldReplace = input.replaceExisting !== false;

    const result = await prisma.$transaction(async (tx) => {
      let cancelledScheduleCount = 0;
      if (shouldReplace) {
        // Delete ALL of this user's incomplete schedules (any date, past or
        // future), not just ones on/after the new startDate. A schedule row
        // dated before the new plan's start would otherwise survive here,
        // then become invisible once its program is archived below
        // (listSchedules only returns ACTIVE-program schedules) while still
        // permanently occupying its (userId, date) slot — createMany's
        // skipDuplicates then silently drops the new row for that same date
        // forever. This is the exact bug where some calendar days vanish
        // after editing/regenerating a schedule.
        const deleteResult = await (tx.workoutSchedule as any).deleteMany({
          where: {
            userId,
            workoutId: null,
          },
        });
        cancelledScheduleCount = deleteResult.count ?? 0;
      }

      await (tx.workoutProgram as any).updateMany({
        where: { userId, status: "ACTIVE" },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      const createdProgram = await (tx.workoutProgram as any).create({
        data: {
          userId,
          name: input.name,
          description: "Manual workout program",
          sourceType: "MANUAL",
          goal: input.goal || null,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          status: "ACTIVE",
          days: {
            create: input.days.map((day) => ({
              dayNumber: day.dayNumber,
              title: day.title,
              description: day.description || null,
              exercises: {
                create: day.exercises.map((exercise, index) => ({
                  exerciseId: exercise.exerciseId,
                  order: exercise.order ?? index + 1,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  restSeconds: exercise.restSeconds,
                  notes: exercise.notes || null,
                  setPrescriptions: {
                    create: buildSetPrescriptionsForExercise(exercise),
                  },
                })),
              },
            })),
          },
        },
        include: {
          days: {
            include: {
              exercises: {
                include: PROGRAM_EXERCISE_INCLUDE,
                orderBy: { order: "asc" },
              },
              schedules: true,
            },
            orderBy: { dayNumber: "asc" },
          },
        },
      });

      const programDays = [...(createdProgram.days as any[])].sort(
        (a: any, b: any) => a.dayNumber - b.dayNumber,
      );
      const scheduleRows: any[] = [];
      const schedulePreview: any[] = [];

      for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
        for (const [
          weekdayIndex,
          weekday,
        ] of input.selectedWeekdays.entries()) {
          const day = programDays[weekdayIndex];
          if (!day) continue;
          const plannedDate = nextDateForWeekday(startDate, weekday, weekIndex);
          scheduleRows.push({
            userId,
            date: plannedDate,
            programDayId: day.id,
            sourceType: "MANUAL",
            notes: `${input.name} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
          });
          if (schedulePreview.length < 14) {
            schedulePreview.push({
              date: formatDateOnly(plannedDate),
              programDayId: day.id,
              dayLabel:
                CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
            });
          }
        }
      }

      const createResult = await (tx.workoutSchedule as any).createMany({
        data: scheduleRows,
        skipDuplicates: true,
      });

      return {
        createdProgram,
        createdScheduleCount: createResult.count,
        cancelledScheduleCount,
        skippedDuplicateCount: Math.max(
          0,
          scheduleRows.length - createResult.count,
        ),
        schedulePreview,
      };
    });

    return {
      success: true,
      message: "Manual workout program created",
      createdProgramId: result.createdProgram.id,
      createdScheduleCount: result.createdScheduleCount,
      cancelledScheduleCount: result.cancelledScheduleCount,
      skippedDuplicateCount: result.skippedDuplicateCount,
      selectedWeekdays: input.selectedWeekdays,
      schedulePreview: result.schedulePreview,
      program: result.createdProgram,
    };
  },

  async getCurrentProgram(userId: string) {
    const program = await prisma.workoutProgram.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        days: {
          include: {
            schedules: {
              where: { userId },
              orderBy: { date: "asc" },
              take: 20,
              include: { workout: true },
            },
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
            // Roadmap P1.3 "Superset / exercise grouping".
            exerciseGroups: {
              include: { members: true },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { dayNumber: "asc" },
        },
      },
    });

    if (!program) return null;

    const schedules = await prisma.workoutSchedule.findMany({
      where: {
        userId,
        programDay: { programId: program.id },
      },
      orderBy: { date: "asc" },
      take: 50,
      include: {
        workout: true,
        programDay: {
          include: {
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    return { ...program, schedules };
  },

  async updateProgram(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgram.findFirst({
      where: { id, userId },
    });
    if (!existing) throw { status: 404, message: "Program not found" };
    const patch: any = {};
    if (typeof data.name === "string") patch.name = data.name.trim();
    if (typeof data.description === "string" || data.description === null)
      patch.description = data.description;
    if (typeof data.goal === "string" || data.goal === null)
      patch.goal = data.goal;
    if (typeof data.status === "string") {
      if (!["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"].includes(data.status)) {
        throw { status: 400, message: "Invalid program status" };
      }
      patch.status = data.status;
      patch.archivedAt = data.status === "ARCHIVED" ? new Date() : null;
    }
    return prisma.workoutProgram.update({
      where: { id },
      data: patch,
    });
  },

  async deleteProgram(id: string, userId: string) {
    const existing = await prisma.workoutProgram.findFirst({
      where: { id, userId },
    });
    if (!existing) throw { status: 404, message: "Program not found" };
    return prisma.workoutProgram.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
  },

  async updateProgramDay(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgramDay.findFirst({
      where: { id, program: { userId } },
    });
    if (!existing) throw { status: 404, message: "Program day not found" };
    const patch: any = {};
    if (typeof data.title === "string") patch.title = data.title.trim();
    if (typeof data.description === "string" || data.description === null)
      patch.description = data.description;
    if (typeof data.duration === "number" || data.duration === null)
      patch.duration = data.duration;
    return prisma.workoutProgramDay.update({
      where: { id },
      data: patch,
    });
  },

  async addProgramExercise(programDayId: string, userId: string, data: any) {
    const day = await prisma.workoutProgramDay.findFirst({
      where: { id: programDayId, program: { userId } },
      include: { _count: { select: { exercises: true } } },
    });
    if (!day) throw { status: 404, message: "Program day not found" };
    if (!data.exerciseId || typeof data.exerciseId !== "string") {
      throw { status: 400, message: "exerciseId is required" };
    }
    await validateExerciseIds([data.exerciseId]);

    return prisma.workoutProgramExercise.create({
      data: {
        programDayId,
        exerciseId: data.exerciseId,
        order:
          typeof data.order === "number"
            ? data.order
            : day._count.exercises + 1,
        sets: typeof data.sets === "number" ? data.sets : 3,
        reps: typeof data.reps === "number" ? data.reps : 10,
        restSeconds:
          typeof data.restSeconds === "number" ? data.restSeconds : 90,
        notes: typeof data.notes === "string" ? data.notes : undefined,
        setPrescriptions: {
          create: buildSetPrescriptionsForExercise({
            sets: typeof data.sets === "number" ? data.sets : 3,
            reps: typeof data.reps === "number" ? data.reps : 10,
            restSeconds:
              typeof data.restSeconds === "number" ? data.restSeconds : 90,
            setPrescriptions: Array.isArray(data.setPrescriptions)
              ? data.setPrescriptions
              : undefined,
          }),
        },
      },
      include: PROGRAM_EXERCISE_INCLUDE,
    });
  },

  async updateProgramExercise(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgramExercise.findFirst({
      where: { id, programDay: { program: { userId } } },
    });
    if (!existing) throw { status: 404, message: "Program exercise not found" };

    if (data.exerciseId) {
      await validateExerciseIds([data.exerciseId]);
    }

    const patch: any = {};
    if (typeof data.exerciseId === "string") patch.exerciseId = data.exerciseId;
    if (typeof data.order === "number") patch.order = data.order;
    if (typeof data.sets === "number" || data.sets === null)
      patch.sets = data.sets;
    if (typeof data.reps === "number" || data.reps === null)
      patch.reps = data.reps;
    if (typeof data.restSeconds === "number" || data.restSeconds === null)
      patch.restSeconds = data.restSeconds;
    if (typeof data.weight === "number" || data.weight === null)
      patch.weight = data.weight;
    if (typeof data.notes === "string" || data.notes === null)
      patch.notes = data.notes;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.workoutProgramExercise.update({
        where: { id },
        data: patch,
      });

      if (Array.isArray(data.setPrescriptions)) {
        await tx.workoutProgramExerciseSetPrescription.deleteMany({
          where: { programExerciseId: id },
        });
        await tx.workoutProgramExerciseSetPrescription.createMany({
          data: buildSetPrescriptionsForExercise({
            sets: updated.sets,
            reps: updated.reps,
            weight: updated.weight,
            restSeconds: updated.restSeconds,
            setPrescriptions: data.setPrescriptions,
          }).map((prescription) => ({
            ...prescription,
            programExerciseId: id,
          })),
        });
      }

      return tx.workoutProgramExercise.findUnique({
        where: { id },
        include: PROGRAM_EXERCISE_INCLUDE,
      });
    });
  },

  async deleteProgramExercise(id: string, userId: string) {
    const existing = await prisma.workoutProgramExercise.findFirst({
      where: { id, programDay: { program: { userId } } },
      include: {
        programDay: { include: { _count: { select: { exercises: true } } } },
      },
    });
    if (!existing) throw { status: 404, message: "Program exercise not found" };
    if (existing.programDay._count.exercises <= 1) {
      throw {
        status: 409,
        message: "Cannot delete the last exercise in a program day",
      };
    }
    return prisma.workoutProgramExercise.delete({
      where: { id },
    });
  },

  /**
   * Roadmap P1.3 "Superset / exercise grouping"
   * (docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md). Purely a
   * program-day planning concept — never touches WorkoutExercise/
   * WorkoutSet, so already-logged history is never at risk.
   *
   * Reorders the day's exercises so the selected members become a
   * CONTIGUOUS block (in the order the caller selected them), inserted at
   * the position of the earliest one. This is deliberate, not incidental:
   * the active-session "is the next exercise a fellow group member" check
   * (used to pick the right rest duration) only needs to compare adjacent
   * entries if this invariant holds by construction, rather than search
   * past unrelated exercises.
   */
  async createExerciseGroup(
    userId: string,
    programDayId: string,
    programExerciseIds: string[],
    type: string,
    restBetweenExercisesSeconds?: number | null,
    restAfterRoundSeconds?: number | null,
  ) {
    const VALID_TYPES = ["SUPERSET", "TRISET", "CIRCUIT"];
    if (!VALID_TYPES.includes(type)) {
      throw { status: 400, message: `type must be one of: ${VALID_TYPES.join(", ")}` };
    }
    const uniqueIds = [...new Set(programExerciseIds ?? [])];
    if (uniqueIds.length < 2) {
      throw { status: 400, message: "A group requires at least 2 exercises" };
    }

    const day = await prisma.workoutProgramDay.findFirst({
      where: { id: programDayId, program: { userId } },
      include: {
        exercises: {
          orderBy: { order: "asc" },
          include: { groupMembership: true },
        },
      },
    });
    if (!day) throw { status: 404, message: "Program day not found" };

    const dayExerciseIds = new Set(day.exercises.map((e) => e.id));
    if (uniqueIds.some((id) => !dayExerciseIds.has(id))) {
      throw { status: 400, message: "All exercises must belong to the same program day" };
    }
    const alreadyGrouped = day.exercises.filter(
      (e) => uniqueIds.includes(e.id) && e.groupMembership,
    );
    if (alreadyGrouped.length > 0) {
      throw { status: 409, message: "One or more exercises are already in a group" };
    }

    const selectedSet = new Set(uniqueIds);
    const selectedInCallerOrder = uniqueIds.map((id) => day.exercises.find((e) => e.id === id)!);
    const finalSequence: typeof day.exercises = [];
    let groupInserted = false;
    for (const ex of day.exercises) {
      if (selectedSet.has(ex.id)) {
        if (!groupInserted) {
          finalSequence.push(...selectedInCallerOrder);
          groupInserted = true;
        }
      } else {
        finalSequence.push(ex);
      }
    }

    return prisma.$transaction(async (tx) => {
      await Promise.all(
        finalSequence.map((ex, idx) =>
          tx.workoutProgramExercise.update({ where: { id: ex.id }, data: { order: idx } }),
        ),
      );
      const group = await tx.workoutProgramExerciseGroup.create({
        data: {
          programDayId,
          type,
          restBetweenExercisesSeconds: restBetweenExercisesSeconds ?? null,
          restAfterRoundSeconds: restAfterRoundSeconds ?? null,
          members: {
            create: selectedInCallerOrder.map((ex, idx) => ({
              programExerciseId: ex.id,
              order: idx,
            })),
          },
        },
        include: { members: true },
      });
      return group;
    });
  },

  async updateExerciseGroup(
    id: string,
    userId: string,
    data: {
      restBetweenExercisesSeconds?: number | null;
      restAfterRoundSeconds?: number | null;
      type?: string;
    },
  ) {
    const existing = await prisma.workoutProgramExerciseGroup.findFirst({
      where: { id, programDay: { program: { userId } } },
    });
    if (!existing) throw { status: 404, message: "Exercise group not found" };
    const VALID_TYPES = ["SUPERSET", "TRISET", "CIRCUIT"];
    if (data.type !== undefined && !VALID_TYPES.includes(data.type)) {
      throw { status: 400, message: `type must be one of: ${VALID_TYPES.join(", ")}` };
    }
    const patch: any = {};
    if (data.type !== undefined) patch.type = data.type;
    if (data.restBetweenExercisesSeconds !== undefined)
      patch.restBetweenExercisesSeconds = data.restBetweenExercisesSeconds;
    if (data.restAfterRoundSeconds !== undefined)
      patch.restAfterRoundSeconds = data.restAfterRoundSeconds;
    return prisma.workoutProgramExerciseGroup.update({
      where: { id },
      data: patch,
      include: { members: true },
    });
  },

  /** Removes the group and its membership records only — the underlying
   * WorkoutProgramExercise rows (and their current `order`) are untouched,
   * so ungrouping never silently reshuffles the day again. */
  async ungroupExercises(id: string, userId: string) {
    const existing = await prisma.workoutProgramExerciseGroup.findFirst({
      where: { id, programDay: { program: { userId } } },
    });
    if (!existing) throw { status: 404, message: "Exercise group not found" };
    await prisma.workoutProgramExerciseGroup.delete({ where: { id } });
    return { success: true };
  },

  async deleteSchedule(id: string, userId: string) {
    const existing = await prisma.workoutSchedule.findFirst({
      where: { id, userId },
    });
    if (!existing) throw { status: 404, message: "Schedule not found" };
    if (existing.workoutId) {
      throw {
        status: 409,
        message:
          "Cannot delete a schedule that already has a completed workout log",
      };
    }
    assertScheduleDateEditable(existing.date);
    return prisma.workoutSchedule.delete({ where: { id } });
  },

  /**
   * Explicit "I'm not doing this session" — writes SKIPPED, a status value
   * that has existed in the schema/comment all along but that no code path
   * ever set (see docs/workout-log-audit.md's Known Gaps / G1 in
   * docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md). Before this, a due session
   * that was never started just stayed NOT_STARTED forever, with "missed"
   * only ever inferred ad hoc per call site (e.g. cycle adherence treating
   * any past non-COMPLETED schedule as missed) rather than being a
   * first-class, directly queryable state.
   *
   * assertScheduleDateEditable already restricts this to "today" under the
   * current lock policy (past is locked — already effectively missed with
   * no action needed; future is locked — nothing to skip yet).
   */
  async skipSchedule(id: string, userId: string, notes?: string) {
    const existing = await prisma.workoutSchedule.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: "Schedule not found" };
    if (existing.workoutId) {
      throw { status: 409, message: "Cannot skip a schedule that already has a logged workout" };
    }
    assertScheduleDateEditable(existing.date);
    return prisma.workoutSchedule.update({
      where: { id },
      data: { status: "SKIPPED", notes: notes ?? existing.notes },
    });
  },

  /**
   * Explicit cancellation with a mandatory reason — distinct from SKIPPED
   * (a normal "didn't do it today") in that it represents an operator-level
   * decision to void the session entirely (e.g. plan changed, injury). No
   * coach/admin role exists yet for workout schedules (see
   * docs/workout-log-audit.md Known Gaps), so this is currently
   * self-service only — the "audit log when coach/admin overrides"
   * requirement doesn't yet apply since there is no such override actor.
   */
  async cancelSchedule(id: string, userId: string, reason: string) {
    const existing = await prisma.workoutSchedule.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: "Schedule not found" };
    if (existing.workoutId) {
      throw { status: 409, message: "Cannot cancel a schedule that already has a logged workout" };
    }
    assertScheduleDateEditable(existing.date);
    return prisma.workoutSchedule.update({
      where: { id },
      data: { status: "CANCELLED", notes: reason },
    });
  },

  /**
   * Roadmap P1.2 "Reschedule workout"
   * (docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md) — moves the SAME
   * logical session to a new date. Deliberately NOT built on
   * assertScheduleDateEditable (which restricts every other mutation to
   * "today only"): a missed (past) session must be reschedulable (case 3
   * in the impact analysis), and a future session too (case 1) — only the
   * TARGET date is restricted to today-or-future. This is a plain UPDATE
   * of `date` on the existing row (never a new row) — see the impact
   * analysis's "Audit findings" for why that is not just simpler but more
   * correct than a two-row/logicalScheduleId design, given
   * @@unique([userId, date]) already rules out two rows per day and
   * computeAdherence already just range-queries the current `date`.
   */
  async rescheduleSchedule(
    userId: string,
    id: string,
    newDateStr: string,
    reason?: string | null,
  ) {
    if (!newDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(newDateStr)) {
      throw { status: 400, message: "newDate must be YYYY-MM-DD" };
    }
    const existing = await prisma.workoutSchedule.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: "Schedule not found" };
    // Case 7 ("completed session cannot be casually moved") + the same
    // trust boundary skip/cancel already use: workoutId set means a real
    // session was started/logged. Also excludes SKIPPED/CANCELLED (both
    // status !== "NOT_STARTED" with workoutId still null) — deliberate,
    // see the impact analysis's "Scope boundary".
    if (existing.workoutId || existing.status !== "NOT_STARTED") {
      throw {
        status: 409,
        message: "Only a not-yet-started, not-skipped/cancelled session can be rescheduled",
      };
    }

    const newDate = parseDateOnly(newDateStr);
    if (compareScheduleDate(newDate, new Date()) === "past") {
      throw { status: 400, message: "Cannot reschedule onto a date in the past" };
    }
    if (newDate.getTime() === existing.date.getTime()) {
      throw { status: 409, message: "This session is already scheduled for that date" };
    }

    const conflict = await prisma.workoutSchedule.findFirst({
      where: { userId, date: newDate, id: { not: id } },
      include: { programDay: { select: { title: true } } },
    });
    if (conflict) {
      throw {
        status: 409,
        message: `You already have "${conflict.programDay?.title ?? "a session"}" scheduled for that date`,
      };
    }

    try {
      const updated = await prisma.workoutSchedule.update({
        where: { id },
        data: {
          date: newDate,
          // Set once, on the FIRST reschedule only — never overwritten by
          // a later one, so it always points at the truly original plan.
          originalPlannedDate: existing.originalPlannedDate ?? existing.date,
          rescheduledAt: new Date(),
          rescheduleReason: reason ?? null,
        },
      });

      // Roadmap P4.1 "Notifications/reminders" (§27) — a real, listable
      // confirmation record of the reschedule (same "you just did X, here's
      // a record of it" convention as e.g. an order confirmation), not a
      // blocker to the reschedule itself succeeding (best-effort, see
      // createPersistentNotification's own doc comment).
      void createPersistentNotification({
        userId,
        text: `Đã dời lịch buổi tập từ ${scheduledDateLabel(existing.date)} sang ${scheduledDateLabel(newDate)}`,
        eventType: "WORKOUT_RESCHEDULED",
        entityId: id,
        link: "/client/workout",
      });

      return updated;
    } catch (error: any) {
      // Defensive: the explicit conflict check above already covers the
      // common case, but a concurrent request could still race past it —
      // the DB's own @@unique([userId, date]) is the real guarantee.
      if (error?.code === "P2002") {
        throw { status: 409, message: "You already have a session scheduled for that date" };
      }
      throw error;
    }
  },

  async importAiPlanToSchedule(userId: string, input: ImportAiPlanDto) {
    const existingProgram = await (prisma.workoutProgram as any).findFirst({
      where: {
        userId,
        sourcePlanId: input.sourcePlanId,
      },
      include: {
        days: {
          include: {
            schedules: true,
            exercises: {
              include: PROGRAM_EXERCISE_INCLUDE,
              orderBy: { order: "asc" },
            },
          },
          orderBy: { dayNumber: "asc" },
        },
      },
    });

    if (existingProgram) {
      const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
      const startDate = parseDateOnly(input.startDate);
      const selectedWeekdays = input.selectedWeekdays;

      if (selectedWeekdays) {
        const uniqueWeekdays = new Set(selectedWeekdays);
        if (
          uniqueWeekdays.size !== selectedWeekdays.length ||
          selectedWeekdays.length !== input.daysPerWeek
        ) {
          throw {
            status: 400,
            message: `Plan has ${input.daysPerWeek} sessions per week. Please select exactly ${input.daysPerWeek} training days.`,
          };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        let cancelledScheduleCount = 0;
        const shouldReplace = input.replaceExisting !== false;
        if (shouldReplace) {
          // Any date, not just >= startDate — see the matching comment in
          // createManualProgram for why a date lower-bound here leaves
          // orphaned schedule rows that silently vanish from the calendar.
          const deleteResult = await (tx.workoutSchedule as any).deleteMany({
            where: {
              userId,
              workoutId: null,
            },
          });
          cancelledScheduleCount = deleteResult.count ?? 0;
        }

        const otherActivePrograms = await (tx.workoutProgram as any).findMany({
          where: { userId, status: "ACTIVE", id: { not: existingProgram.id } },
          select: { id: true },
        });
        if (otherActivePrograms.length > 0) {
          const otherProgramIds: string[] = otherActivePrograms.map(
            (p: any) => p.id,
          );
          const otherDays = await (tx.workoutProgramDay as any).findMany({
            where: { programId: { in: otherProgramIds } },
            select: { id: true },
          });
          if (otherDays.length > 0) {
            await (tx.workoutSchedule as any).deleteMany({
              where: {
                userId,
                programDayId: { in: otherDays.map((d: any) => d.id) },
                workoutId: null,
              },
            });
          }
        }

        await (tx.workoutProgram as any).updateMany({
          where: {
            userId,
            status: "ACTIVE",
            id: { not: existingProgram.id },
          },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });

        const program = await (tx.workoutProgram as any).update({
          where: { id: existingProgram.id },
          data: {
            status: "ACTIVE",
            archivedAt: null,
            aiPlanVersion: input.sourcePlanVersion ?? existingProgram.aiPlanVersion ?? null,
          },
          include: {
            days: {
              include: {
                schedules: true,
                exercises: {
                  include: PROGRAM_EXERCISE_INCLUDE,
                  orderBy: { order: "asc" },
                },
              },
              orderBy: { dayNumber: "asc" },
            },
          },
        });

        const scheduleRows: any[] = [];
        const schedulePreview: any[] = [];
        const programDays = [...(program.days as any[])].sort(
          (a: any, b: any) => a.dayNumber - b.dayNumber,
        );

        if (selectedWeekdays) {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const [weekdayIndex, weekday] of selectedWeekdays.entries()) {
              const day = programDays[weekdayIndex];
              if (!day) continue;
              const plannedDate = nextDateForWeekday(
                startDate,
                weekday,
                weekIndex,
              );
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: "AI_PLAN",
                notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel:
                    CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
                });
              }
            }
          }
        } else {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const day of programDays) {
              const plannedDate = new Date(startDate);
              // UTC — see nextDateForWeekday's doc comment above for why.
              plannedDate.setUTCDate(
                plannedDate.getUTCDate() + weekIndex * 7 + (day.dayNumber - 1),
              );
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: "AI_PLAN",
                notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel: `Day ${day.dayNumber}`,
                });
              }
            }
          }
        }

        const createResult =
          scheduleRows.length > 0
            ? await (tx.workoutSchedule as any).createMany({
                data: scheduleRows,
                skipDuplicates: true,
              })
            : { count: 0 };

        return {
          program,
          createdScheduleCount: createResult.count,
          cancelledScheduleCount,
          skippedDuplicateCount: Math.max(
            0,
            scheduleRows.length - createResult.count,
          ),
          schedulePreview,
        };
      });

      const totalScheduleCount =
        (result.program.days as any[]).reduce(
          (count: number, day: any) => count + (day.schedules?.length || 0),
          0,
        ) + result.createdScheduleCount;
      return {
        success: true,
        message: "AI plan already saved to workout schedule",
        sourcePlanId: input.sourcePlanId,
        createdProgramId: existingProgram.id,
        createdScheduleCount: result.createdScheduleCount,
        cancelledScheduleCount: result.cancelledScheduleCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        alreadyExists: true,
        selectedWeekdays: input.selectedWeekdays,
        schedulePreview: result.schedulePreview,
        totalScheduleCount,
        program: result.program,
      };
    }

    const exerciseCatalog = await exerciseRepository.findMany({});
    const catalog = (
      exerciseCatalog.data as Array<{ id: string; exerciseName: string }>
    ).map((exercise) => ({
      id: exercise.id,
      rawName: exercise.exerciseName,
      name: normalizeExerciseName(exercise.exerciseName),
    }));

    const unmatchedExercises = new Set<string>();
    const mappedDays: MappedAiDay[] = input.weeklySchedule.map(
      (day, dayIndex) => {
        const rawTitle =
          day.goal || day.focus || String(day.day ?? "AI Workout Day");
        const title = sanitizeImportedDayTitle(rawTitle, dayIndex);
        const exercises: MappedAiExercise[] = [];

        for (const exercise of day.exercises) {
          // If the AI provided an exerciseId, prefer it and DO NOT fallback to name matching.
          if (
            exercise.exerciseId &&
            typeof exercise.exerciseId === "string" &&
            exercise.exerciseId.trim()
          ) {
            const found = catalog.find((c) => c.id === exercise.exerciseId);
            if (!found) {
              const match = findExerciseMatch(catalog, exercise.name);
              if (!match) {
                unmatchedExercises.add(exercise.name);
                continue;
              }
              const parsedReps = Number.parseInt(
                String(exercise.reps).match(/\d+/)?.[0] ?? "",
                10,
              );
              exercises.push({
                exerciseId: match.id,
                order: exercise.order ?? exercises.length + 1,
                sets: exercise.sets,
                reps: Number.isFinite(parsedReps) ? parsedReps : null,
                restSeconds: exercise.restSeconds,
                notes: sanitizeImportedExerciseNote(exercise.note),
              });
              continue;
            }
            const parsedReps = Number.parseInt(
              String(exercise.reps).match(/\d+/)?.[0] ?? "",
              10,
            );
            exercises.push({
              exerciseId: found.id,
              order: exercise.order ?? exercises.length + 1,
              sets: exercise.sets,
              reps: Number.isFinite(parsedReps) ? parsedReps : null,
              restSeconds: exercise.restSeconds,
              notes: sanitizeImportedExerciseNote(exercise.note),
            });
            continue;
          }

          // No exerciseId provided: fallback to name matching (legacy support)
          const match = findExerciseMatch(catalog, exercise.name);
          if (!match) {
            unmatchedExercises.add(exercise.name);
            continue;
          }

          const parsedReps = Number.parseInt(
            String(exercise.reps).match(/\d+/)?.[0] ?? "",
            10,
          );

          exercises.push({
            exerciseId: match.id,
            order: exercise.order ?? exercises.length + 1,
            sets: exercise.sets,
            reps: Number.isFinite(parsedReps) ? parsedReps : null,
            restSeconds: exercise.restSeconds,
            notes: sanitizeImportedExerciseNote(exercise.note),
          });
        }

        if (exercises.length === 0) {
          unmatchedExercises.add(title);
        }

        return {
          title,
          description: sanitizeImportedText(
            day.cardio || day.notes,
            "Tap trung vao ky thuat dung, kiem soat nhip tap va tang tien tu tu.",
          ),
          exercises,
        };
      },
    );

    if (unmatchedExercises.size > 0) {
      throw {
        status: 400,
        message: `Unable to map AI exercises to exercise master: ${Array.from(unmatchedExercises).join(", ")}`,
      };
    }

    const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
    const startDate = parseDateOnly(input.startDate);
    const selectedWeekdays = input.selectedWeekdays;

    if (selectedWeekdays) {
      const uniqueWeekdays = new Set(selectedWeekdays);
      if (
        uniqueWeekdays.size !== selectedWeekdays.length ||
        selectedWeekdays.length !== input.daysPerWeek
      ) {
        throw {
          status: 400,
          message: `Plan has ${input.daysPerWeek} sessions per week. Please select exactly ${input.daysPerWeek} training days.`,
        };
      }
    }

    const shouldReplace = input.replaceExisting !== false; // default true

    const result = await prisma.$transaction(async (tx) => {
      let cancelledScheduleCount = 0;

      if (shouldReplace) {
        // Delete ALL incomplete schedules for this user, any date — not just
        // startDate onwards. We cannot limit by programDayId because old
        // archived programs' schedules are still in the DB and their dates
        // conflict with new ones due to @@unique([userId, date]). A date
        // lower-bound has the same problem in the other direction: a row
        // dated *before* the new startDate survives, then becomes invisible
        // once its program is archived below (listSchedules only returns
        // ACTIVE-program schedules) while still permanently blocking that
        // date via skipDuplicates — the exact bug where some calendar days
        // silently vanish after regenerating a plan.
        const deleteResult = await (tx.workoutSchedule as any).deleteMany({
          where: {
            userId,
            workoutId: null, // Keep schedules that have a completed workout log
          },
        });
        cancelledScheduleCount = deleteResult.count ?? 0;

        // Archive all currently ACTIVE programs for this user
        await (tx.workoutProgram as any).updateMany({
          where: { userId, status: "ACTIVE" },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });
      } else {
        // Append mode: still archive other active programs so only one is ACTIVE at a time
        await (tx.workoutProgram as any).updateMany({
          where: { userId, status: "ACTIVE" },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });
      }

      const createdProgram = await (tx.workoutProgram as any).create({
        data: {
          userId,
          name: input.sourcePlanName || `${goalLabel(input.goal)} Plan`,
          description: `Imported from AI plan ${input.sourcePlanId}`,
          sourcePlanId: input.sourcePlanId,
          sourceType: "AI_PLAN",
          aiPlanVersion: input.sourcePlanVersion ?? null,
          goal: input.goal,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          status: "ACTIVE",
          days: {
            create: mappedDays.map((day, dayIndex) => ({
              dayNumber: dayIndex + 1,
              title: day.title,
              description: day.description,
              exercises: {
                create: day.exercises.map((exercise, exerciseIndex) => ({
                  exerciseId: exercise.exerciseId,
                  order: exercise.order || exerciseIndex + 1,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  restSeconds: exercise.restSeconds,
                  notes: exercise.notes,
                })),
              },
            })),
          },
        },
        include: {
          days: {
            include: {
              exercises: {
                include: PROGRAM_EXERCISE_INCLUDE,
                orderBy: { order: "asc" },
              },
              schedules: true,
            },
            orderBy: { dayNumber: "asc" },
          },
        },
      });

      const scheduleRows: any[] = [];
      const schedulePreview: any[] = [];
      const programDays = [...(createdProgram.days as any[])].sort(
        (a: any, b: any) => a.dayNumber - b.dayNumber,
      );

      if (selectedWeekdays) {
        for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
          for (const [weekdayIndex, weekday] of selectedWeekdays.entries()) {
            const day = programDays[weekdayIndex];
            if (!day) continue;
            const plannedDate = nextDateForWeekday(
              startDate,
              weekday,
              weekIndex,
            );
            scheduleRows.push({
              userId,
              date: plannedDate,
              programDayId: day.id,
              sourcePlanId: input.sourcePlanId,
              sourceType: "AI_PLAN",
              notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
            });
            if (schedulePreview.length < 14) {
              schedulePreview.push({
                date: formatDateOnly(plannedDate),
                programDayId: day.id,
                dayLabel:
                  CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
              });
            }
          }
        }
      } else {
        for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
          for (const day of programDays) {
            const plannedDate = new Date(startDate);
            // UTC — see nextDateForWeekday's doc comment above for why.
            plannedDate.setUTCDate(
              plannedDate.getUTCDate() + weekIndex * 7 + (day.dayNumber - 1),
            );
            scheduleRows.push({
              userId,
              date: plannedDate,
              programDayId: day.id,
              sourcePlanId: input.sourcePlanId,
              sourceType: "AI_PLAN",
              notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
            });
            if (schedulePreview.length < 14) {
              schedulePreview.push({
                date: formatDateOnly(plannedDate),
                programDayId: day.id,
                dayLabel: `Day ${day.dayNumber}`,
              });
            }
          }
        }
      }

      const createResult = await (tx.workoutSchedule as any).createMany({
        data: scheduleRows,
        skipDuplicates: true,
      });

      return {
        createdProgram,
        createdScheduleCount: createResult.count,
        cancelledScheduleCount,
        skippedDuplicateCount: Math.max(
          0,
          scheduleRows.length - createResult.count,
        ),
        schedulePreview,
      };
    });

    return {
      success: true,
      message: "AI plan imported to workout schedule",
      sourcePlanId: input.sourcePlanId,
      createdProgramId: result.createdProgram.id,
      createdScheduleCount: result.createdScheduleCount,
      cancelledScheduleCount: result.cancelledScheduleCount,
      skippedDuplicateCount: result.skippedDuplicateCount,
      alreadyExists: false,
      selectedWeekdays,
      schedulePreview: result.schedulePreview,
      program: result.createdProgram,
    };
  },

  /**
   * Batch, read-only check: for each given weeklySchedule, do ALL its exercises resolve
   * to a real catalog entry (by exerciseId or name match)? Mirrors the exact same
   * exercise-mapping logic importAiPlanToSchedule enforces at apply-time — reuses
   * findExerciseMatch/normalizeExerciseName below as the single source of truth, just
   * without building the mapped program structure or writing anything.
   *
   * Exists so ai-service's marketplace browse() can filter out listings (often leftover
   * E2E-fixture data — "Fixture Exercise 1", "Full body" as an exercise name, etc.) that
   * would otherwise 400 with "Unable to map AI exercises to exercise master" the moment
   * a real user tries to apply them — found live while testing the marketplace flow.
   */
  async validateMarketplaceSchedules(
    schedules: Array<{ listingId: string; weeklySchedule: unknown }>,
  ): Promise<Array<{ listingId: string; mappable: boolean; unmatchedExercises: string[] }>> {
    const exerciseCatalog = await exerciseRepository.findMany({});
    const catalog: NormalizedExerciseCatalogItem[] = (
      exerciseCatalog.data as Array<{ id: string; exerciseName: string }>
    ).map((exercise) => ({
      id: exercise.id,
      rawName: exercise.exerciseName,
      name: normalizeExerciseName(exercise.exerciseName),
    }));

    return schedules.map(({ listingId, weeklySchedule }) => {
      const unmatched = new Set<string>();
      const days = Array.isArray(weeklySchedule) ? (weeklySchedule as any[]) : [];
      for (const day of days) {
        const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
        if (exercises.length === 0) {
          unmatched.add(day?.goal || day?.focus || String(day?.day ?? "day"));
          continue;
        }
        for (const exercise of exercises) {
          const byId =
            exercise?.exerciseId && typeof exercise.exerciseId === "string"
              ? catalog.find((c) => c.id === exercise.exerciseId)
              : undefined;
          if (byId) continue;
          const byName = exercise?.name ? findExerciseMatch(catalog, exercise.name) : undefined;
          if (!byName) unmatched.add(exercise?.name || "unknown exercise");
        }
      }
      return { listingId, mappable: unmatched.size === 0, unmatchedExercises: Array.from(unmatched) };
    });
  },
};

function normalizeExerciseName(name: string) {
  const aliasNormalized = name
    .toLowerCase()
    .replace(
      /\boverhead\s+dumbbell\s+extension\b/gi,
      "overhead triceps extension",
    )
    .replace(
      /\boverhead\s+tricep[s]?\s+extension\b/gi,
      "overhead triceps extension",
    )
    .replace(/\btricep[s]?\s+pushdowns?\b/gi, "triceps pushdown")
    .replace(/\blat\s+pull[-\s]?downs?\b/gi, "lat pulldown")
    .replace(/\bpull[-\s]?downs?\b/gi, "pulldown")
    .replace(/\bpull[-\s]?ups?\b/gi, "pull up")
    .replace(/\btricep\b/gi, "triceps");

  return aliasNormalized
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findExerciseMatch(
  catalog: NormalizedExerciseCatalogItem[],
  exerciseName: string,
) {
  const normalized = normalizeExerciseName(exerciseName);
  const exact = catalog.find((exercise) => exercise.name === normalized);
  if (exact) return exact;
  // Token-based matching with simple singularization to handle plurals (rows -> row)
  const tokens = normalized.split(" ").filter(Boolean);
  const tokenVariants = new Set<string>();
  for (const t of tokens) {
    tokenVariants.add(t);
    // naive singularization: drop trailing 's' for common plurals, avoid words like 'press' (ends with 'ss')
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) {
      tokenVariants.add(t.slice(0, -1));
    }
  }

  const subsetMatch = catalog.find((exercise) => {
    const catalogTokens = exercise.name.split(" ").filter(Boolean);
    const catalogTokenSet = new Set<string>();
    for (const ct of catalogTokens) {
      catalogTokenSet.add(ct);
      if (ct.length > 3 && ct.endsWith("s") && !ct.endsWith("ss")) {
        catalogTokenSet.add(ct.slice(0, -1));
      }
    }

    // Check if all input token variants are present in catalog tokens
    const allInputPresent = [...tokenVariants].every((tok) =>
      catalogTokenSet.has(tok),
    );
    if (allInputPresent) return true;

    // Check weaker match: any input token appears in catalog tokens
    const anyInputPresent = [...tokenVariants].some((tok) =>
      catalogTokenSet.has(tok),
    );
    // And catalog contains a key token like 'barbell' or movement name
    const strongCatalogToken = [
      "barbell",
      "dumbbell",
      "press",
      "row",
      "squat",
      "deadlift",
      "curl",
    ];
    const hasStrong = strongCatalogToken.some((k) => catalogTokenSet.has(k));
    return anyInputPresent && hasStrong;
  });
  if (subsetMatch) return subsetMatch;

  // Fallback: substring contains checks against normalized raw names
  const contains = catalog.find(
    (exercise) =>
      exercise.name.includes(normalized) || normalized.includes(exercise.name),
  );
  if (contains) return contains;

  return catalog.find((exercise) => {
    const raw = exercise.rawName.toLowerCase();
    return raw.includes(normalized) || normalized.includes(raw);
  });
}

function parseDateOnly(dateValue?: string) {
  // No date given -> "today", computed the SAME way
  // schedule-lock.util.ts's own lock check computes "today" (Ho_Chi_Minh
  // calendar day, not the server process's ambient timezone) — using a
  // DIFFERENT "today" here than the one the lock check compares against
  // would silently recreate this exact class of bug for the no-date-given
  // path even after fixing the explicit-date-string path below.
  if (!dateValue) {
    return todayAsScheduleDate();
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) {
    return todayAsScheduleDate();
  }

  // UTC — see nextDateForWeekday's doc comment for why: a WorkoutSchedule
  // .date must be stored as an actual UTC-midnight instant to match what
  // every reader of this column (schedule-lock.util.ts, its frontend
  // mirror, formatDateOnly below) already assumes.
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateOnly(date: Date) {
  // UTC — must match parseDateOnly's storage convention above, or a
  // round-trip through parse -> format silently shifts by a day again.
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
