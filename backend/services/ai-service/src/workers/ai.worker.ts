import { Worker } from "bullmq";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import axios from "axios";
import { llmService } from "../services/llm.service";
import {
  conversationRepository,
  PlanStatus,
} from "../repositories/conversation.repository";
import {
  parsePlanContent,
  type AllowedExerciseItem,
  type DayExerciseCatalog,
} from "../schemas/plan.schemas";
import { LlmError } from "../errors/api-error";
import { safeParseJsonCandidate } from "../utils/json";
import {
  analyzeBodyComposition,
  formatBodyCompAnalysis,
} from "../llm/body_composition_rules";
import { retriever } from "../llm/retriever";
import {
  attachEvidenceToPlanContent,
  buildPlanEvidenceBundle,
  formatEvidenceForPlanPrompt,
  type PlanEvidenceBundle,
} from "../llm/plan_evidence";
import {
  buildCoachContext,
  sanitizeCoachContextForPrompt,
} from "../coach/coach_context_builder";
import {
  buildLegacyDeterministicPlanContent,
  validateLegacyPlanContent,
} from "../coach/plan_schema";
import type { CoachContext } from "../coach/coach_context.types";
import type { UserProfile } from "../llm/types";
import type { WorkerUserContext } from "./worker-user-context";
import { redisConnection } from "./ai.queue";
import { validateWorkoutPlanInvariants } from "../services/workout-plan-invariant.service";

type AllowedExercise = AllowedExerciseItem;

// Increased limit so we have enough exercises to build per-day catalogs
const PLAN_EXERCISE_FETCH_LIMIT = 120;
const PLAN_EXERCISE_PROMPT_LIMIT = 32; // fallback flat-list limit
const PLAN_EXERCISES_PER_DAY_CATALOG_LIMIT = 8;

function readPositiveIntEnv(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function buildEvidenceProfile(
  ctx: WorkerUserContext | null,
  fallbackGoal: string,
): UserProfile {
  const profile = ctx?.profile ?? {};
  const latestInBody = ctx?.latestInBody ?? null;

  return {
    userId: undefined,
    age: typeof profile.age === "number" ? profile.age : undefined,
    gender:
      profile.gender === "FEMALE" || profile.gender === "OTHER"
        ? profile.gender
        : "MALE",
    heightCm:
      typeof profile.heightCm === "number" ? profile.heightCm : undefined,
    currentWeightKg: latestInBody?.weightKg ?? profile.currentWeight,
    targetWeightKg: profile.targetWeight,
    goal: (profile.goal ?? fallbackGoal) as any,
    activityLevel: profile.activityLevel as any,
    experienceLevel: (profile.experienceLevel ?? "BEGINNER") as any,
    training: {
      availableEquipment: [],
      injuries: Array.isArray(profile.injuries) ? profile.injuries : [],
      preferredTrainingDays: [],
      trainingDaysPerWeek: undefined,
    },
    inBody: latestInBody
      ? {
          weightKg: latestInBody.weightKg,
          bodyFatPct: latestInBody.bodyFatPct,
          bodyFatKg: latestInBody.bodyFatKg,
          skeletalMuscleKg: latestInBody.muscleMassKg,
          bmi: latestInBody.bmi,
          bmr: latestInBody.bmr,
          measuredAt: latestInBody.measuredAt,
          segmentalMuscle: latestInBody.segmentalMuscle,
        }
      : undefined,
  };
}

// Muscle group matching

/** Returns true if the exercise matches the given focus group */
function exerciseMatchesMuscleGroup(
  ex: AllowedExercise,
  group: string,
): boolean {
  const muscles = (ex.muscleGroupsActivated || []).map((m) => m.toLowerCase());
  const bp = (ex.bodyPart || "").toUpperCase();
  const name = (ex.exerciseName || "").toLowerCase();

  switch (group) {
    case "CHEST":
      return (
        muscles.some((m) => /chest|pectoral/.test(m)) ||
        (bp === "UPPER_BODY" && /bench|fly|flye|push.up|chest/.test(name))
      );
    case "BACK":
      return (
        (bp === "UPPER_BODY" ||
          muscles.some((m) => /back|lat|trap|rhomboid|erector/.test(m))) &&
        muscles.some((m) => /back|lat|trap|rhomboid|erector/.test(m))
      );
    case "SHOULDERS":
      return (
        muscles.some((m) => /shoulder|deltoid|delt/.test(m)) ||
        /overhead|press.*shoulder|shoulder.*press|lateral raise|front raise/.test(
          name,
        )
      );
    case "TRICEPS":
      return (
        muscles.some((m) => /tricep/.test(m)) ||
        /tricep|skull.*crusher|dip|extension/.test(name)
      );
    case "BICEPS":
      return muscles.some((m) => /bicep/.test(m)) || /bicep|curl/.test(name);
    case "LEGS":
      return (
        bp === "LOWER_BODY" &&
        (muscles.some((m) => /quad|hamstring|calf|glute|leg/.test(m)) ||
          /squat|deadlift|lunge|leg|calf|step.up/.test(name))
      );
    case "GLUTES":
      return (
        bp === "LOWER_BODY" &&
        (muscles.some((m) => /glute|hip/.test(m)) ||
          /squat|lunge|deadlift|hip.thrust|glute|step.up/.test(name))
      );
    case "CORE":
      return (
        bp === "CORE" ||
        muscles.some((m) => /abdomin|oblique|core|rectus/.test(m)) ||
        /crunch|plank|ab |sit.up/.test(name)
      );
    case "LOWER_BODY":
      return bp === "LOWER_BODY";
    case "UPPER_BODY":
      return bp === "UPPER_BODY";
    case "FULL_BODY":
      return true;
    default:
      return false;
  }
}

/** Parse a day goal string into a list of focus muscle group keys */
function parseDayFocusMuscleGroups(dayGoal: string): string[] {
  const s = dayGoal.toLowerCase();

  // Full body / conditioning patterns first
  if (/full.body|toan.*than|conditioning.*all|general.*strength/.test(s)) {
    return ["FULL_BODY"];
  }
  // Push day
  if (/^push/.test(s)) return ["CHEST", "SHOULDERS", "TRICEPS"];
  // Pull day
  if (/^pull/.test(s)) return ["BACK", "BICEPS"];
  // Strict lower body
  if (/lower.*body$|than.*duoi$|leg.*only/.test(s)) return ["LEGS", "GLUTES"];
  // Strict upper body (no specific muscle listed)
  if (/upper.*body$|than.*tren$/.test(s) && !/(nguc|lung|vai|tay)/.test(s)) {
    return ["CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS"];
  }

  const groups: string[] = [];
  if (/nguc|chest|pec|bench/.test(s)) groups.push("CHEST");
  if (/vai|shoulder|delt|overhead/.test(s)) groups.push("SHOULDERS");
  if (/tay sau|tricep/.test(s)) groups.push("TRICEPS");
  // BACK can coexist with CHEST (e.g. "Nguc + Lung" full-body upper day)
  if (/lung|back|lat|row|pull/.test(s) && !/pull.up|pullover/.test(s))
    groups.push("BACK");
  if (/tay truoc|truoc|bicep|curl/.test(s)) groups.push("BICEPS");
  if (/chan|leg|quad|hamstring|squat|deadlift|lunge|bap chan/.test(s))
    groups.push("LEGS");
  if (/mong|glute|hip/.test(s)) groups.push("GLUTES");
  if (/core|bung|ab|plank/.test(s)) groups.push("CORE");

  // Conditioning-only day -> lower body as default
  if (groups.length === 0 && /condition|dieu.*hoa/.test(s))
    return ["LEGS", "CORE"];

  return groups.length > 0 ? groups : ["FULL_BODY"];
}

const HOME_EQUIPMENT = new Set([
  "BODYWEIGHT",
  "DUMBBELLS",
  "RESISTANCE_BAND",
  "KETTLEBELL",
  "MEDICINE_BALL",
  "FOAM_ROLLER",
]);
const MACHINE_ONLY_EQUIPMENT = new Set(["MACHINE", "CABLE"]);
const MIXED_GYM_EQUIPMENT = new Set([
  "MACHINE",
  "CABLE",
  "BARBELL",
  "DUMBBELLS",
  "BODYWEIGHT",
  "KETTLEBELL",
]);

/** Filter and rank exercises for a specific day's muscle focus */
function filterExercisesForDay(
  allExercises: AllowedExercise[],
  focusMuscleGroups: string[],
  goal: string,
  trainingLocation: string,
  limit = 18,
  equipmentPreference = "MIXED_GYM",
): AllowedExercise[] {
  const isMuscleGain = /muscle|tang.*co|hypertrophy|gain/i.test(goal);
  const isHome = trainingLocation === "HOME";
  const isMachineOnly = equipmentPreference === "MACHINE_ONLY";
  const isFullBody =
    focusMuscleGroups.includes("FULL_BODY") || focusMuscleGroups.length === 0;

  const candidates = allExercises.filter((ex) => {
    const equip = ex.typeOfEquipment || "";
    // Equipment filter based on preference/location
    if (isHome && !HOME_EQUIPMENT.has(equip)) return false;
    if (isMachineOnly && !MACHINE_ONLY_EQUIPMENT.has(equip)) return false;
    if (!isHome && !isMachineOnly && !MIXED_GYM_EQUIPMENT.has(equip))
      return false;
    // For muscle gain, skip pure cardio as main exercises
    if (isMuscleGain && ex.typeOfActivity === "CARDIO") return false;
    // Muscle group match
    if (isFullBody) return true;
    return focusMuscleGroups.some((g) => exerciseMatchesMuscleGroup(ex, g));
  });

  // Score: prefer exercises that match more focus groups and fit goal
  const scored = candidates
    .map((ex) => {
      let score = 0;
      for (const g of focusMuscleGroups) {
        if (exerciseMatchesMuscleGroup(ex, g)) score += 3;
      }
      if (isMuscleGain && ex.typeOfActivity === "STRENGTH") score += 2;
      if (isMachineOnly && MACHINE_ONLY_EQUIPMENT.has(ex.typeOfEquipment || ""))
        score += 2;
      if (!isMachineOnly && ex.typeOfEquipment === "BARBELL" && isMuscleGain)
        score += 1;
      return { ex, score };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const result: AllowedExercise[] = [];
  for (const { ex } of scored) {
    if (!seen.has(ex.id)) {
      seen.add(ex.id);
      result.push(ex);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/** Build per-day exercise catalogs from a flat allowedExercises list */
function buildPerDayCatalogs(
  goal: string,
  daysPerWeek: number,
  allExercises: AllowedExercise[],
  trainingLocation: string,
  equipmentPreference = "MIXED_GYM",
  exercisesPerDay = 4,
): DayExerciseCatalog[] {
  const catalogs: DayExerciseCatalog[] = [];
  const perDayLimit = Math.min(
    PLAN_EXERCISES_PER_DAY_CATALOG_LIMIT,
    Math.max(exercisesPerDay + 2, exercisesPerDay),
  );

  for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
    const dayGoal = splitGoalForDay(goal, dayIndex, daysPerWeek);
    const focusMuscleGroups = parseDayFocusMuscleGroups(dayGoal);
    const exercises = filterExercisesForDay(
      allExercises,
      focusMuscleGroups,
      goal,
      trainingLocation,
      perDayLimit,
      equipmentPreference,
    );

    catalogs.push({ dayIndex, dayGoal, focusMuscleGroups, exercises });
  }

  return catalogs;
}

/** Validate that a plan exercise matches its day's focus muscle groups.
 *  Returns an error string if mismatch, null if OK.
 */
function validateExerciseMuscleMatch(
  ex: AllowedExercise,
  focusMuscleGroups: string[],
): string | null {
  if (focusMuscleGroups.includes("FULL_BODY")) return null;
  const matches = focusMuscleGroups.some((g) =>
    exerciseMatchesMuscleGroup(ex, g),
  );
  if (!matches) {
    return `Exercise "${ex.exerciseName}" (${ex.bodyPart ?? "UNKNOWN"}) does not match focus [${focusMuscleGroups.join(", ")}]`;
  }
  return null;
}

function splitGoalForDay(
  planGoal: string,
  dayIndex: number,
  daysPerWeek: number,
): string {
  const normalizedGoal = String(planGoal || "").toLowerCase();
  const muscleGain = /tang co|muscle|hypertrophy|mass/.test(normalizedGoal);

  const hypertrophySplits =
    daysPerWeek >= 6
      ? [
          "Nguc + Tay sau",
          "Lung + Tay truoc",
          "Chan + Mong",
          "Nguc + Vai",
          "Lung + Tay truoc B",
          "Chan + Mong + Core",
        ]
      : daysPerWeek >= 5
        ? [
            "Nguc + Vai + Tay sau",
            "Lung + Tay truoc",
            "Chan + Mong",
            "Vai + Tay truoc + Tay sau",
            "Chan + Mong + Core",
          ]
        : daysPerWeek >= 4
          ? [
              "Nguc + Vai + Tay sau",
              "Lung + Tay truoc",
              "Chan + Mong",
              "Vai + Tay truoc + Tay sau",
            ]
          : ["Nguc + Lung", "Chan + Mong", "Vai + Tay truoc + Tay sau"];

  const generalSplits =
    daysPerWeek >= 5
      ? [
          "Nguc + Lung + Core",
          "Chan + Mong",
          "Vai + Tay truoc + Tay sau",
          "Chan + Mong + Cardio",
          "Nguc + Lung nhe",
        ]
      : daysPerWeek >= 4
        ? [
            "Nguc + Lung + Core",
            "Chan + Mong",
            "Vai + Tay truoc + Tay sau",
            "Chan + Mong + Core nhe",
          ]
        : ["Nguc + Lung + Core", "Chan + Mong", "Vai + Tay truoc + Tay sau"];

  const splits = muscleGain ? hypertrophySplits : generalSplits;
  return splits[dayIndex % splits.length];
}

function isGenericDayGoal(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return /^(training focus|workout day|general training|general fitness)$/i.test(
    value.trim(),
  );
}

function buildExercisePrescription(
  selected: AllowedExercise,
  order: number,
  note: string,
): Record<string, unknown> {
  return {
    exerciseId: selected.id,
    order,
    name: selected.exerciseName,
    sets: order === 1 ? 4 : 3,
    reps: order === 1 ? "6-10" : "8-12",
    restSeconds: order === 1 ? 120 : 75,
    note,
  };
}

// (safeParseJsonCandidate imported from utils)

function tokenize(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function joinNames(values: unknown[]): string {
  return values
    .map((value) => String(value))
    .filter(Boolean)
    .join(" ");
}

function getEmptyDayIndexes(content: any): number[] {
  if (!content || !Array.isArray(content.weeklySchedule)) return [];
  const indexes: number[] = [];
  content.weeklySchedule.forEach((day: any, index: number) => {
    if (!Array.isArray(day?.exercises) || day.exercises.length === 0) {
      indexes.push(index);
    }
  });
  return indexes;
}

function repairScheduleLengthAndEmptyDays(
  content: any,
  goal: string,
  daysPerWeek: number,
  exercisesPerDay: number,
  allowedExercises: AllowedExercise[],
  perDayCatalogs: DayExerciseCatalog[],
  planId: string,
  jobId: string | undefined,
): {
  repaired: boolean;
  content: any;
  warnings: Array<Record<string, unknown>>;
} {
  if (
    !content ||
    typeof content !== "object" ||
    !Array.isArray(content.weeklySchedule)
  ) {
    return { repaired: false, content, warnings: [] };
  }

  const warnings: Array<Record<string, unknown>> = [];
  const schedule = content.weeklySchedule;
  const allowedIdSet = new Set(allowedExercises.map((exercise) => exercise.id));

  if (schedule.length > daysPerWeek) {
    content.weeklySchedule = schedule.slice(0, daysPerWeek);
    warnings.push({
      type: "deterministic_repair",
      planId,
      jobId,
      reason: "trimmed_extra_days",
    });
  }

  while (content.weeklySchedule.length < daysPerWeek) {
    const dayIndex = content.weeklySchedule.length;
    const dayCandidates =
      perDayCatalogs.find((catalog) => catalog.dayIndex === dayIndex)?.exercises ?? [];
    const selected = dayCandidates[0];
    if (!selected) break;

    content.weeklySchedule.push({
      day: `Day ${dayIndex + 1}`,
      goal: splitGoalForDay(goal, dayIndex, daysPerWeek),
      exercises: Array.from({ length: exercisesPerDay }, (_, exerciseIndex) => {
        const next =
          dayCandidates[exerciseIndex % dayCandidates.length] ?? selected;
        return buildExercisePrescription(
          next,
          exerciseIndex + 1,
          "Auto-repaired from allowed exercise catalog after short LLM schedule output",
        );
      }),
    });
    warnings.push({
      type: "deterministic_repair",
      planId,
      jobId,
      dayIndex,
      reason: "filled_missing_day",
      selectedExerciseId: selected.id,
      selectedExerciseName: selected.exerciseName,
    });
  }

  for (
    let dayIndex = 0;
    dayIndex < content.weeklySchedule.length;
    dayIndex += 1
  ) {
    const day = content.weeklySchedule[dayIndex];
    if (Array.isArray(day?.exercises) && day.exercises.length > 0) continue;

    const dayCandidates =
      perDayCatalogs.find((catalog) => catalog.dayIndex === dayIndex)?.exercises ?? [];
    const selected = chooseRepairExercise(day, goal, dayCandidates);
    if (!selected) continue;

    day.exercises = [
      {
        exerciseId: selected.id,
        order: 1,
        name: selected.exerciseName,
        sets: 3,
        reps: "8-12",
        restSeconds: 90,
        note: "Auto-repaired from allowed exercise catalog after empty-day output",
      },
    ];
    warnings.push({
      type: "deterministic_repair",
      planId,
      jobId,
      dayIndex,
      reason: "filled_empty_day",
      selectedExerciseId: selected.id,
      selectedExerciseName: selected.exerciseName,
    });
  }

  for (
    let dayIndex = 0;
    dayIndex < content.weeklySchedule.length;
    dayIndex += 1
  ) {
    const day = content.weeklySchedule[dayIndex];
    if (!day || typeof day !== "object") continue;

    if (!Array.isArray(day.exercises)) {
      day.exercises = [];
    }

    if (day.exercises.length > exercisesPerDay) {
      day.exercises = day.exercises.slice(0, exercisesPerDay);
      warnings.push({
        type: "deterministic_repair",
        planId,
        jobId,
        dayIndex,
        reason: "trimmed_extra_exercises",
      });
    }

    const usedIds = new Set<string>();
    for (
      let exerciseIndex = 0;
      exerciseIndex < exercisesPerDay;
      exerciseIndex += 1
    ) {
      const current = day.exercises[exerciseIndex];
      const currentId = String(current?.exerciseId || "").trim();
      if (currentId && allowedIdSet.has(currentId) && !usedIds.has(currentId)) {
        usedIds.add(currentId);
        continue;
      }

      const dayCandidates =
        perDayCatalogs.find((catalog) => catalog.dayIndex === dayIndex)?.exercises ?? [];
      const preferred = chooseRepairExercise(day, goal, dayCandidates);
      const fallback = dayCandidates.find((exercise) => !usedIds.has(exercise.id));
      const selected =
        preferred && !usedIds.has(preferred.id) ? preferred : fallback;
      if (!selected) continue;

      usedIds.add(selected.id);
      day.exercises[exerciseIndex] = buildExercisePrescription(
        selected,
        exerciseIndex + 1,
        "Auto-repaired from allowed exercise catalog after incomplete LLM output",
      );
      warnings.push({
        type: "deterministic_repair",
        planId,
        jobId,
        dayIndex,
        exerciseIndex,
        reason: currentId
          ? "replaced_invalid_or_duplicate_exercise"
          : "filled_missing_exercise",
        selectedExerciseId: selected.id,
        selectedExerciseName: selected.exerciseName,
      });
    }
  }

  return { repaired: warnings.length > 0, content, warnings };
}

function repairExerciseCountAndDayGoals(
  content: any,
  goal: string,
  daysPerWeek: number,
  exercisesPerDay: number,
  perDayCatalogs: DayExerciseCatalog[],
  planId: string,
  jobId: string | undefined,
): {
  repaired: boolean;
  content: any;
  warnings: Array<Record<string, unknown>>;
} {
  if (
    !content ||
    typeof content !== "object" ||
    !Array.isArray(content.weeklySchedule)
  ) {
    return { repaired: false, content, warnings: [] };
  }

  const warnings: Array<Record<string, unknown>> = [];

  content.exercisesPerDay = exercisesPerDay;

  for (
    let dayIndex = 0;
    dayIndex < content.weeklySchedule.length;
    dayIndex += 1
  ) {
    const day = content.weeklySchedule[dayIndex];
    if (!day || typeof day !== "object") continue;

    if (isGenericDayGoal(day.goal ?? day.focus)) {
      day.goal = splitGoalForDay(goal, dayIndex, daysPerWeek);
      warnings.push({
        type: "deterministic_repair",
        planId,
        jobId,
        dayIndex,
        reason: "renamed_generic_day_goal",
        dayGoal: day.goal,
      });
    }

    if (!Array.isArray(day.exercises)) {
      day.exercises = [];
    }

    if (day.exercises.length > exercisesPerDay) {
      day.exercises = day.exercises.slice(0, exercisesPerDay);
      warnings.push({
        type: "deterministic_repair",
        planId,
        jobId,
        dayIndex,
        reason: "trimmed_extra_exercises",
        exercisesPerDay,
      });
    }

    const usedIds = new Set(
      day.exercises
        .map((exercise: any) => String(exercise?.exerciseId || "").trim())
        .filter(Boolean),
    );

    while (day.exercises.length < exercisesPerDay) {
      const dayCandidates =
        perDayCatalogs.find((catalog) => catalog.dayIndex === dayIndex)?.exercises ?? [];
      const preferred = chooseRepairExercise(day, goal, dayCandidates);
      const selected =
        (preferred && !usedIds.has(preferred.id) ? preferred : null) ??
        dayCandidates.find((exercise) => !usedIds.has(exercise.id));

      if (!selected) break;

      usedIds.add(selected.id);
      day.exercises.push(
        buildExercisePrescription(
          selected,
          day.exercises.length + 1,
          "Auto-repaired from allowed exercise catalog to match requested exercises per day",
        ),
      );
      warnings.push({
        type: "deterministic_repair",
        planId,
        jobId,
        dayIndex,
        reason: "filled_missing_exercise",
        selectedExerciseId: selected.id,
        selectedExerciseName: selected.exerciseName,
      });
    }
  }

  return { repaired: warnings.length > 0, content, warnings };
}

function scoreAllowedExerciseForDay(
  day: any,
  planGoal: string,
  exercise: AllowedExercise,
): number {
  const dayText = tokenize(
    [planGoal, day?.goal, day?.focus, day?.notes, day?.cardio]
      .filter(Boolean)
      .join(" "),
  );
  const exerciseText = tokenize([
    exercise.exerciseName,
    exercise.bodyPart,
    exercise.typeOfActivity,
    exercise.typeOfEquipment,
    joinNames(exercise.muscleGroupsActivated ?? []),
  ]);

  let score = 0;
  const cardioSignals = [
    "cardio",
    "fat",
    "loss",
    "weight",
    "endurance",
    "metcon",
  ];
  const strengthSignals = [
    "strength",
    "muscle",
    "gain",
    "mass",
    "hypertrophy",
    "push",
    "pull",
    "leg",
  ];

  for (const token of dayText) {
    if (exerciseText.includes(token)) score += 2;
  }

  if (
    exercise.typeOfActivity === "CARDIO" &&
    dayText.some((token) => cardioSignals.includes(token))
  )
    score += 4;
  if (
    exercise.typeOfActivity === "STRENGTH" &&
    dayText.some((token) => strengthSignals.includes(token))
  )
    score += 2;
  if (exercise.bodyPart === "FULL_BODY") score += 1;

  if (Array.isArray(exercise.muscleGroupsActivated)) {
    const muscleTokens = exercise.muscleGroupsActivated.flatMap((group) =>
      tokenize(group),
    );
    for (const token of dayText) {
      if (muscleTokens.includes(token)) score += 3;
    }
  }

  if (day?.cardio && exercise.typeOfActivity === "CARDIO") score += 4;

  return score;
}

function chooseRepairExercise(
  day: any,
  planGoal: string,
  allowedExercises: AllowedExercise[],
): AllowedExercise | null {
  let best: AllowedExercise | null = null;
  let bestScore = 0;

  for (const exercise of allowedExercises) {
    const score = scoreAllowedExerciseForDay(day, planGoal, exercise);
    if (score > bestScore) {
      best = exercise;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function appendPlanWarnings(
  content: any,
  warnings: Array<Record<string, unknown>>,
) {
  content._metadata = content._metadata || {};
  content._metadata.aiWarnings = Array.isArray(content._metadata.aiWarnings)
    ? content._metadata.aiWarnings.concat(warnings)
    : warnings;
}

function estimatePlanNumPredict(
  daysPerWeek: number,
  exercisesPerDay: number,
): number {
  const override = readPositiveIntEnv("AI_PLAN_NUM_PREDICT");
  if (override) return clampInt(override, 400, 4500);

  const exerciseObjects = daysPerWeek * exercisesPerDay;
  // Each exercise is a full object (exerciseId, order, name, sets, reps,
  // restSeconds, note) — observed ~75-85 tokens/exercise in practice on
  // qwen3, not the ~30 an earlier estimate assumed. That undercount was
  // silently truncating every plan above ~7 exercise objects, forcing a
  // fallback catalog repair that discards the LLM's actual exercise
  // selection. num_ctx=8192 leaves enough headroom (typical prompts run
  // ~3500 tokens) for the higher budget.
  return clampInt(430 + exerciseObjects * 80, 650, 4500);
}

function estimatePlanRetryNumPredict(planNumPredict: number): number {
  const override = readPositiveIntEnv("AI_PLAN_RETRY_NUM_PREDICT");
  if (override) return clampInt(override, 300, 4000);

  // The retry uses a shorter prompt but the same rich per-exercise schema, so
  // it needs nearly as much completion budget as the primary attempt.
  return Math.min(planNumPredict, 3500);
}

function estimatePlanTimeoutMs(
  daysPerWeek: number,
  exercisesPerDay: number,
): number {
  const override = readPositiveIntEnv("AI_PLAN_TIMEOUT_MS");
  if (override) return clampInt(override, 30000, 300000);

  const exerciseObjects = daysPerWeek * exercisesPerDay;
  return clampInt(45000 + exerciseObjects * 1500, 65000, 120000);
}

function estimatePlanRetryTimeoutMs(planTimeoutMs: number): number {
  const override = readPositiveIntEnv("AI_PLAN_RETRY_TIMEOUT_MS");
  if (override) return clampInt(override, 20000, 300000);

  return Math.min(planTimeoutMs, 60000);
}

function buildFastPlanPrompt(args: {
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  exercisesPerDay: number;
  adjustmentContext?: string;
  trainingLocation: string;
  equipmentPreference: string;
  exercisesByDay: DayExerciseCatalog[];
  bodyCompText?: string;
  evidenceText?: string;
}): string {
  const catalog = args.exercisesByDay
    .map((day) => {
      const ids = day.exercises
        .slice(0, PLAN_EXERCISES_PER_DAY_CATALOG_LIMIT)
        .map((exercise) => `${exercise.id}|${exercise.exerciseName}`)
        .join("\n");
      return `[Day ${day.dayIndex + 1}] ${day.dayGoal}\n${ids}`;
    })
    .join("\n\n");

  const sampleExercise = args.exercisesByDay[0]?.exercises?.[0];
  const sampleId = sampleExercise?.id ?? "allowed-exercise-id";
  const sampleName = sampleExercise?.exerciseName ?? "Exercise name";

  return [
    "You are a personal trainer. Return ONLY valid compact JSON.",
    `Goal: ${args.goal}`,
    `DurationWeeks: ${args.durationWeeks}`,
    `DaysPerWeek: ${args.daysPerWeek}`,
    `ExercisesPerDay: ${args.exercisesPerDay}`,
    `Location: ${args.trainingLocation}`,
    `Equipment: ${args.equipmentPreference}`,
    args.adjustmentContext
      ? `User context/request:\n${args.adjustmentContext}`
      : "",
    args.bodyCompText
      ? `Body composition rule analysis:\n${args.bodyCompText}`
      : "",
    args.evidenceText ? `Allowed evidence only:\n${args.evidenceText}` : "",
    "Exercise catalog. For Day N, use ONLY ids under Day N. Never invent exerciseId.",
    catalog,
    "Rules:",
    "- Keep the JSON compact. No markdown, no commentary, no duplicate exercise details.",
    "- exercise source policy: use ONLY the fitness-service DB catalog below; do NOT use Qdrant/RAG exercise documents.",
    `- weeklySchedule length exactly ${args.daysPerWeek}.`,
    `- each day exactly ${args.exercisesPerDay} exercises.`,
    "- each exercise object must contain only: exerciseId, order, name, sets, reps, restSeconds, note.",
    "- The catalog is listed alphabetically — that is NOT a training order. Choose and order (field `order`) exercises by actual training sequence: compound/multi-joint lifts first (e.g. squat, deadlift, bench/overhead press, row, pull-up), isolation/accessory exercises last (e.g. curl, extension, raise, fly). Within similar exercises, put the higher-skill/heavier-load one earlier while the trainee is fresh.",
    "- notes must be short, max 12 Vietnamese words.",
    "- day goal, notes, cardio, progressionNotes, recoveryNotes, nutritionSummary must be Vietnamese.",
    "- do not diagnose disease; do not invent citations/source_url; server attaches evidence metadata.",
    "- keep exercise names exactly from catalog.",
    `Schema example: {"goal":"${args.goal}","durationWeeks":${args.durationWeeks},"daysPerWeek":${args.daysPerWeek},"exercisesPerDay":${args.exercisesPerDay},"weeklySchedule":[{"day":"Day 1","goal":"Ten nhom co","exercises":[{"exerciseId":"${sampleId}","order":1,"name":"${sampleName}","sets":3,"reps":"8-12","restSeconds":75,"note":"Ghi chu ngan"}],"cardio":"Khoi dong nhe neu can"}],"progressionNotes":["Ghi chu ngan"],"recoveryNotes":["Ghi chu ngan"],"nutritionSummary":"Tom tat ngan"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Job data schema
function buildDeterministicPlanFromCatalogs(args: {
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  exercisesPerDay: number;
  exercisesByDay: DayExerciseCatalog[];
  planId: string;
  jobId: string | undefined;
  reason: string;
}): Record<string, unknown> {
  const weeklySchedule = Array.from(
    { length: args.daysPerWeek },
    (_, dayIndex) => {
      const catalog =
        args.exercisesByDay[dayIndex % Math.max(1, args.exercisesByDay.length)];
      const usedIds = new Set<string>();
      const selectedExercises: AllowedExercise[] = [];

      for (const exercise of catalog?.exercises ?? []) {
        if (!exercise?.id || usedIds.has(exercise.id)) continue;
        usedIds.add(exercise.id);
        selectedExercises.push(exercise);
        if (selectedExercises.length >= args.exercisesPerDay) break;
      }

      return {
        day: `Day ${dayIndex + 1}`,
        goal:
          catalog?.dayGoal ||
          splitGoalForDay(args.goal, dayIndex, args.daysPerWeek),
        exercises: selectedExercises.map((exercise, exerciseIndex) =>
          buildExercisePrescription(
            exercise,
            exerciseIndex + 1,
            "Auto-repaired from per-day exercise catalog after incomplete LLM output",
          ),
        ),
        cardio: "Khoi dong nhe 5-10 phut truoc buoi tap.",
      };
    },
  );

  const content: Record<string, unknown> = {
    goal: args.goal,
    durationWeeks: args.durationWeeks,
    daysPerWeek: args.daysPerWeek,
    exercisesPerDay: args.exercisesPerDay,
    weeklySchedule,
    progressionNotes: [
      "Tang dan muc ta hoac so lan lap khi hoan thanh du hiep voi ky thuat tot.",
      "Giu form chuan truoc khi tang cuong do.",
    ],
    recoveryNotes: [
      "Ngu 7-9 gio moi ngay va duy tri it nhat mot ngay phuc hoi moi tuan.",
      "Neu dau nhuc keo dai, hay giam khoi luong tap hoac nghi them.",
    ],
    nutritionSummary:
      "Uu tien du protein, kiem soat tong calo theo muc tieu va uong du nuoc.",
  };

  appendPlanWarnings(content, [
    {
      type: "deterministic_repair",
      planId: args.planId,
      jobId: args.jobId,
      reason: args.reason,
      source: "per_day_exercise_catalog",
    },
  ]);

  return content;
}

function isRecoverablePlanLlmTimeout(err: unknown): boolean {
  return err instanceof LlmError && /timed out|timeout/i.test(err.message);
}

const PlanJobDataSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  exercisesPerDay: z.number().int().min(1).max(8).default(4),
  trainingLocation: z.enum(["HOME", "GYM"]).default("GYM").optional(),
  equipmentPreference: z
    .enum(["MACHINE_ONLY", "MIXED_GYM"])
    .default("MIXED_GYM")
    .optional(),
  /** Present when this job was queued via the adjust endpoint. */
  adjustmentContext: z.string().max(1000).optional(),
});
type PlanJobData = z.infer<typeof PlanJobDataSchema>;

export const aiWorker = new Worker(
  "ai-tasks",
  async (job) => {
    if (job.name === "generate-nutrition-plan") {
      const { processNutritionPlanJob } =
        await import("../services/nutrition.processor");
      return processNutritionPlanJob(job);
    }

    // 1. Validate job data
    const dataResult = PlanJobDataSchema.safeParse(job.data);
    if (!dataResult.success) {
      const reason = `Invalid job data: ${dataResult.error.errors.map((e) => e.message).join("; ")}`;
      logger.error({ jobId: job.id, data: job.data }, reason);
      // Do NOT update DB - we don't have a planId to update.
      throw new Error(reason);
    }
    const {
      planId,
      userId,
      goal,
      durationWeeks,
      daysPerWeek,
      exercisesPerDay,
      adjustmentContext,
      trainingLocation = "GYM",
      equipmentPreference = "MIXED_GYM",
    } = dataResult.data as PlanJobData;
    const planJobStartedAt = Date.now();

    logger.info(
      { jobId: job.id, planId, userId },
      "Plan generation job started",
    );

    // 2. Mark plan as PROCESSING
    await conversationRepository.updatePlanStatus(
      planId,
      PlanStatus.PROCESSING,
    );

    // 3. Fetch allowed exercises from fitness-service (internal API)
    const fitnessServiceUrl =
      process.env.FITNESS_SERVICE_URL || "http://localhost:3002";
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    let allowedExercises: AllowedExercise[] = [];
    try {
      const resp = await axios.get(
        `${fitnessServiceUrl}/internal/exercises/for-ai-plans`,
        {
          params: {
            goal,
            trainingLocation,
            equipmentPreference,
            limit: PLAN_EXERCISE_FETCH_LIMIT,
          },
          timeout: 10000,
          headers: {
            "x-internal-token": internalSecret,
            "x-user-id": userId,
          },
        },
      );
      if (resp?.data?.success && Array.isArray(resp.data.data?.exercises)) {
        allowedExercises = resp.data.data.exercises.map((e: any) => ({
          id: e.id,
          exerciseName: e.exerciseName,
          bodyPart: e.bodyPart,
          typeOfActivity: e.typeOfActivity,
          typeOfEquipment: e.typeOfEquipment,
          muscleGroupsActivated: e.muscleGroupsActivated,
        }));
      }
    } catch (err) {
      logger.error(
        { err, planId, userId },
        "Failed to fetch allowed exercises from fitness-service",
      );
      await conversationRepository.updatePlanFailed(
        planId,
        "Failed to load exercise catalog from fitness-service",
      );
      return;
    }

    if (!allowedExercises || allowedExercises.length === 0) {
      const reason =
        "No allowed exercises available for the requested goal/filters";
      logger.error({ planId, userId, goal }, reason);
      await conversationRepository.updatePlanFailed(planId, reason);
      return;
    }

    // Declared this early (not just before the later id-validation retry
    // block) because completePlan/enforceFinalPlanEquipmentInvariant close
    // over it and can be invoked from the LLM-timeout recovery path, which
    // runs before that later block — a `const` declared after the first
    // call site would throw (temporal dead zone) on that path.
    const allowedIds = new Set(allowedExercises.map((e) => e.id));

    // 3b. Fetch personal user context (InBody, workout history, nutrition)
    // Non-critical: failures are swallowed; plan will still be generated
    let userContextText = "";
    let coachContextText = "";
    let workerContext: WorkerUserContext | null = null;
    let coachContext: CoachContext | null = null;
    try {
      const { fetchWorkerUserContext, formatWorkerContextForPrompt } =
        await import("./worker-user-context");
      const ctx = await fetchWorkerUserContext(userId);
      workerContext = ctx;
      userContextText = formatWorkerContextForPrompt(ctx);
      coachContext = buildCoachContext({
        userId,
        profile: ctx.profile as any,
        latestInBody: ctx.latestInBody as any,
        inBodyHistory: ctx.inBodyHistory as any,
        workoutHistory: ctx.recentWorkouts as any,
        nutritionHistory: ctx.recentNutritionDays as any,
        requestedDaysPerWeek: daysPerWeek,
        timeframeWeeks: durationWeeks,
        goal,
      });
      coachContextText = JSON.stringify(
        sanitizeCoachContextForPrompt(coachContext),
      );
      if (userContextText) {
        logger.info(
          {
            planId,
            hasInBody: !!ctx.latestInBody,
            workoutDays: ctx.recentWorkouts.length,
          },
          "Fetched personal user context for plan generation",
        );
      }
    } catch (err) {
      logger.warn(
        { err, planId },
        "Could not fetch personal user context - plan will use goal/params only",
      );
    }

    // 4. Build per-day exercise catalogs and prompt
    const perDayCatalogs = buildPerDayCatalogs(
      goal,
      daysPerWeek,
      allowedExercises,
      trainingLocation,
      equipmentPreference,
      exercisesPerDay,
    );
    logger.info(
      {
        planId,
        daysPerWeek,
        catalogs: perDayCatalogs.map((c) => ({
          day: c.dayGoal,
          groups: c.focusMuscleGroups,
          count: c.exercises.length,
        })),
      },
      "Per-day exercise catalogs built",
    );

    // Flat list used for repair/validation helpers
    const promptExercises = allowedExercises.slice(
      0,
      PLAN_EXERCISE_PROMPT_LIMIT,
    );
    const planNumPredict = estimatePlanNumPredict(daysPerWeek, exercisesPerDay);
    const planRetryNumPredict = estimatePlanRetryNumPredict(planNumPredict);
    const planTimeoutMs = estimatePlanTimeoutMs(daysPerWeek, exercisesPerDay);
    const planRetryTimeoutMs = estimatePlanRetryTimeoutMs(planTimeoutMs);
    // Append personal context to adjustmentContext so prompt builder can include it
    const enrichedAdjustmentContext =
      [
        adjustmentContext,
        userContextText ? `[Thong tin ca nhan hoa]\n${userContextText}` : "",
        coachContextText
          ? `[CoachContext JSON - sanitized]\n${coachContextText}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n") || undefined;
    const evidenceProfile = buildEvidenceProfile(workerContext, goal);
    const bodyCompAnalysis = analyzeBodyComposition(evidenceProfile);
    const bodyCompText = formatBodyCompAnalysis(bodyCompAnalysis);
    const evidenceDocs = await retriever
      .retrieveEvidence(bodyCompAnalysis.evidenceQueries)
      .catch((err) => {
        logger.warn(
          { err, planId },
          "Plan evidence retrieval failed; continuing without evidence docs",
        );
        return [];
      });
    const evidenceBundle: PlanEvidenceBundle = buildPlanEvidenceBundle(
      bodyCompAnalysis,
      evidenceDocs,
    );
    const evidenceText = formatEvidenceForPlanPrompt(evidenceDocs);

    if (process.env.DEBUG_AI_PLAN === "true") {
      logger.info(
        {
          planId,
          goal,
          daysPerWeek,
          exercisesPerDay,
          planNumPredict,
          planRetryNumPredict,
          planTimeoutMs,
          planRetryTimeoutMs,
          hasUserContext: Boolean(userContextText),
          exerciseCatalogSource: "fitness-service-db",
          qdrantExerciseRetrieval: false,
          bodyCompAdjustments: evidenceBundle.adjustment_reason.map(
            (item) => item.metric,
          ),
          evidenceUsed: evidenceBundle.evidence_used.map((item) => ({
            title: item.title,
            source_type: item.source_type,
            source_url: item.source_url,
          })),
          safetyNotesCount: evidenceBundle.safety_notes.length,
        },
        "AI plan prompt context summary",
      );
    }

    const prompt = buildFastPlanPrompt({
      goal,
      durationWeeks,
      daysPerWeek,
      exercisesPerDay,
      adjustmentContext: enrichedAdjustmentContext,
      trainingLocation,
      equipmentPreference,
      exercisesByDay: perDayCatalogs,
      bodyCompText: bodyCompText || undefined,
      evidenceText,
    });
    const generationRepairReasons: string[] = [];
    const appendTrackedPlanWarnings = (
      content: any,
      warnings: Array<Record<string, unknown>>,
    ) => {
      generationRepairReasons.push(
        ...warnings.map((warning) => String(warning.reason ?? warning.type ?? "repair")),
      );
      appendPlanWarnings(content, warnings);
    };

    logger.info(
      {
        jobId: job.id,
        planId,
        promptChars: prompt.length,
        allowedExerciseCount: allowedExercises.length,
        daysPerWeek,
        exercisesPerDay,
        planNumPredict,
        planTimeoutMs,
      },
      "Plan generation prompt prepared",
    );

    const completePlan = async (
      content: any,
      logMessage: string,
      extraLog: Record<string, unknown> = {},
    ): Promise<boolean> => {
      if (Array.isArray(content?._metadata?.aiWarnings)) {
        for (const warning of content._metadata.aiWarnings) {
          const reason = String(warning?.reason ?? warning?.type ?? "repair");
          if (!generationRepairReasons.includes(reason)) generationRepairReasons.push(reason);
        }
      }
      const semanticResult = validateWorkoutPlanInvariants({
        content,
        daysPerWeek,
        exercisesPerDay,
        allowedExercises,
        perDayCatalogs,
      });
      const equipmentViolations = await enforceFinalPlanEquipmentInvariant(content);
      const failedConstraints = [
        ...(semanticResult.ok
          ? []
          : semanticResult.violations.map((violation) => violation.code)),
        ...equipmentViolations,
      ];

      content._metadata = content._metadata || {};
      content._metadata.generationTelemetry = {
        modelVersion: process.env.LLM_MODEL || "fitness-coach-qwen2.5-1.5b:q4_K_M",
        promptVersion: "workout-plan-v2-deterministic-candidates",
        generationAttempt: Number(job.attemptsMade ?? 0) + 1,
        repairCount: generationRepairReasons.length,
        repairReasons: generationRepairReasons,
        schemaPass: parsePlanContent(JSON.stringify(content)).ok,
        semanticPass: semanticResult.ok,
        constraintPass: failedConstraints.length === 0,
        failedConstraintNames: [...new Set(failedConstraints)],
        candidateCount: allowedExercises.length,
        fallbackUsed: Boolean((extraLog as any).recoveredFrom),
        generationDurationMs: Date.now() - planJobStartedAt,
      };

      if (!semanticResult.ok || equipmentViolations.length > 0) {
        const reason = `Final workout plan invariant failed: ${[
          ...new Set(failedConstraints),
        ].join(", ")}`;
        await conversationRepository.updatePlanFailed(planId, reason);
        logger.error(
          {
            jobId: job.id,
            planId,
            userId,
            semanticViolations: semanticResult.ok ? [] : semanticResult.violations,
            equipmentViolations,
          },
          "Plan generation failed closed before persistence",
        );
        return false;
      }

      attachEvidenceToPlanContent(content, evidenceBundle);
      await conversationRepository.updatePlanCompletion(planId, content);
      logger.info(
        {
          jobId: job.id,
          planId,
          userId,
          totalDurationMs: Date.now() - planJobStartedAt,
          ...extraLog,
        },
        logMessage,
      );
      return true;
    };

    // Hardening pass §7/§8 — FINAL, authoritative equipment safety net.
    // Everything upstream (the equipment-filtered candidate pool, every
    // repair path) is already supposed to guarantee this, but that pool is
    // itself sampled/bounded (up to PLAN_EXERCISE_FETCH_LIMIT exercises per
    // job) — this is the one check made against the plan's actual small,
    // exact exerciseId set with no sampling involved, called as the very
    // last step before ANY plan content is persisted. Never invents
    // equipment or silently accepts a violation: one repair attempt sourced
    // only from `allowedExercises` (itself equipment-safe by construction),
    // then logs loudly if a slot still can't be resolved.
    async function enforceFinalPlanEquipmentInvariant(content: any): Promise<string[]> {
      if (!Array.isArray(content?.weeklySchedule)) {
        return ["equipment_validator_missing_schedule"];
      }
      try {
        const resp = await axios.post(
          `${fitnessServiceUrl}/internal/exercises/validate-plan-equipment`,
          { weeklySchedule: content.weeklySchedule },
          {
            timeout: 8000,
            headers: { "x-internal-token": internalSecret, "x-user-id": userId },
          },
        );
        const result = resp?.data?.data as
          | { valid: boolean; violations: Array<{ exerciseId: string; dayIndex: number; exerciseName: string; required: string[] }>; skippedNoUserEquipment: boolean }
          | undefined;
        if (!result) return ["equipment_validator_invalid_response"];
        if (result.valid || result.violations.length === 0) return [];

        logger.warn(
          { jobId: job.id, planId, userId, violations: result.violations },
          "Final-plan equipment invariant violated — repairing before persistence",
        );

        for (const v of result.violations) {
          const day = content.weeklySchedule[v.dayIndex];
          if (!day || !Array.isArray(day.exercises)) continue;
          const usedIds = new Set(
            day.exercises.map((e: any) => String(e?.exerciseId || "")).filter((id: string) => allowedIds.has(id)),
          );
          const dayCandidates = perDayCatalogs.find(
            (catalog) => catalog.dayIndex === v.dayIndex,
          )?.exercises ?? [];
          const replacement = dayCandidates.find(
            (candidate) => !usedIds.has(candidate.id),
          );
          if (!replacement) continue; // no safe candidate exists at all — leave as-is, logged below
          const idx = day.exercises.findIndex((e: any) => e?.exerciseId === v.exerciseId);
          if (idx === -1) continue;
          day.exercises[idx] = buildExercisePrescription(
            replacement,
            idx + 1,
            "Auto-repaired: final equipment-invariant check found this exercise unavailable",
          );
          generationRepairReasons.push("replaced_equipment_incompatible_exercise");
        }

        const reValidateResp = await axios.post(
          `${fitnessServiceUrl}/internal/exercises/validate-plan-equipment`,
          { weeklySchedule: content.weeklySchedule },
          { timeout: 8000, headers: { "x-internal-token": internalSecret, "x-user-id": userId } },
        );
        const reValidated = reValidateResp?.data?.data as { valid: boolean; violations: unknown[] } | undefined;
        if (!reValidated) return ["equipment_validator_invalid_response"];
        if (!reValidated.valid) {
          // Repair couldn't fully resolve it (e.g. allowedExercises itself
          // was too sparse for this user's equipment). Never invent
          // equipment or silently ship an impossible exercise — log loudly
          // for operator visibility; the plan still persists with whatever
          // the repair pass achieved (better than failing the whole plan
          // over one slot), but this is now diagnosable from logs.
          logger.error(
            { jobId: job.id, planId, userId, remainingViolations: reValidated.violations },
            "Final-plan equipment invariant still violated after constrained repair",
          );
          return ["equipment_constraint_violation"];
        } else {
          logger.info({ jobId: job.id, planId, userId }, "Final-plan equipment invariant repair succeeded");
          return [];
        }
      } catch (err) {
        logger.error(
          { err: (err as Error).message, jobId: job.id, planId },
          "Final-plan equipment invariant check failed to run",
        );
        return ["equipment_validator_unavailable"];
      }
    }

    let rawAnswer: string;
    try {
      const llmStartedAt = Date.now();
      const llmResponse = await llmService.callLLM(prompt, {
        responseFormat: "json",
        timeoutMs: planTimeoutMs,
        numPredict: planNumPredict,
        temperature: 0.1,
      });
      logger.info(
        {
          jobId: job.id,
          planId,
          durationMs: Date.now() - llmStartedAt,
          promptTokens: llmResponse.promptTokens,
          completionTokens: llmResponse.completionTokens,
          numPredict: planNumPredict,
        },
        "Plan generation LLM call finished",
      );
      rawAnswer = llmResponse.answer;
    } catch (err) {
      if (isRecoverablePlanLlmTimeout(err)) {
        const fallbackContent = buildDeterministicPlanFromCatalogs({
          goal,
          durationWeeks,
          daysPerWeek,
          exercisesPerDay,
          exercisesByDay: perDayCatalogs,
          planId,
          jobId: job.id,
          reason: "llm_timeout_recovered_with_catalog",
        });
        const fallbackParse = parsePlanContent(JSON.stringify(fallbackContent));
        if (fallbackParse.ok) {
          logger.warn(
            {
              jobId: job.id,
              planId,
              timeoutMs: planTimeoutMs,
              promptChars: prompt.length,
            },
            "Plan generation recovered from LLM timeout using per-day catalog repair",
          );
          await completePlan(
            fallbackParse.content,
            "Plan generation completed after LLM timeout recovery",
            {
              recoveredFrom: "llm_timeout",
            },
          );
          return;
        }

        logger.error(
          { jobId: job.id, planId, fallbackReason: fallbackParse.reason },
          "Plan generation timeout recovery failed validation",
        );
      }

      const reason =
        err instanceof LlmError
          ? `LLM unavailable: ${err.message}`
          : `Unexpected LLM error: ${String(err)}`;
      logger.error(
        { err, jobId: job.id, planId },
        "Plan generation: LLM call failed",
      );
      await conversationRepository.updatePlanFailed(planId, reason);
      throw err; // Let BullMQ mark the job as failed and apply retry policy.
    }

    // 4. Parse and validate LLM output
    let parseResult = parsePlanContent(rawAnswer);
    let looseCandidate = safeParseJsonCandidate(rawAnswer);

    // If no JSON found at all, ask the LLM one quick format-only retry.
    if (!parseResult.ok && !looseCandidate) {
      try {
        const repairSampleExercise = perDayCatalogs[0]?.exercises?.[0];
        const repairSampleId = repairSampleExercise?.id ?? "use-an-allowed-exercise-id";
        const repairSampleName = repairSampleExercise?.exerciseName ?? "Bench Press";
        const minimalRepairPrompt = [
          "Your previous response was invalid because it was not a JSON object.",
          `Return ONLY one valid JSON object that matches the schema below. Do NOT add any explanation, markdown, or code fences.`,
          `Goal: ${goal}`,
          `DurationWeeks: ${durationWeeks}`,
          `DaysPerWeek: ${daysPerWeek}`,
          "Allowed exercises (id -> name):",
          ...perDayCatalogs.flatMap((day) => [
            `[Day ${day.dayIndex + 1}] ${day.dayGoal}`,
            ...day.exercises
              .slice(0, PLAN_EXERCISES_PER_DAY_CATALOG_LIMIT)
              .map((e) => `${e.id} -> ${e.exerciseName}`),
          ]),
          `Required JSON shape (use this exact key structure, "weeklySchedule" with exactly ${daysPerWeek} day objects, each exercise as its own object — not a bare id):`,
          `{"goal":"${goal}","durationWeeks":${durationWeeks},"daysPerWeek":${daysPerWeek},"weeklySchedule":[{"day":"Day 1","goal":"Ten nhom co","exercises":[{"exerciseId":"${repairSampleId}","order":1,"name":"${repairSampleName}","sets":3,"reps":"8-12","restSeconds":75,"note":"Ghi chu ngan"}],"cardio":"Khoi dong nhe neu can"}],"progressionNotes":["Ghi chu ngan"],"recoveryNotes":["Ghi chu ngan"],"nutritionSummary":"Tom tat ngan"}`,
          "The allowed-exercises list above is alphabetical — that is NOT a training order. Order exercises (field `order`) by training sequence: compound/multi-joint lifts first, isolation/accessory exercises last.",
        ].join("\n");

        const retryStartedAt = Date.now();
        const retryResp = await llmService.callLLM(minimalRepairPrompt, {
          responseFormat: "json",
          timeoutMs: planRetryTimeoutMs,
          numPredict: planRetryNumPredict,
          temperature: 0.1,
        });
        logger.info(
          {
            jobId: job.id,
            planId,
            durationMs: Date.now() - retryStartedAt,
            promptTokens: retryResp.promptTokens,
            completionTokens: retryResp.completionTokens,
            numPredict: planRetryNumPredict,
          },
          "Plan generation format-only retry finished",
        );
        const retryRaw = retryResp.answer;
        rawAnswer = retryRaw;
        looseCandidate = safeParseJsonCandidate(retryRaw);
        parseResult = parsePlanContent(retryRaw);
      } catch (err) {
        logger.warn(
          { err, jobId: job.id, planId },
          "Plan generation: format-only retry failed",
        );
      }
    }

    // Validate exerciseIds are in allowedExercises. Retry once if not.
    // (allowedIds itself is declared earlier now — see the comment there.)

    async function idsValid(
      content: any,
    ): Promise<{ ok: boolean; missing: string[] }> {
      const missing: string[] = [];
      if (!content || !Array.isArray(content.weeklySchedule))
        return { ok: false, missing: ["invalid_structure"] };
      for (const day of content.weeklySchedule) {
        if (!Array.isArray(day.exercises))
          return { ok: false, missing: ["invalid_structure"] };
        for (const ex of day.exercises) {
          if (
            !ex.exerciseId ||
            typeof ex.exerciseId !== "string" ||
            !allowedIds.has(ex.exerciseId)
          ) {
            missing.push(String(ex.exerciseId || ex.name || "unknown"));
          }
        }
      }
      return { ok: missing.length === 0, missing };
    }

    if (!parseResult.ok) {
      const emptyDayIndexes = getEmptyDayIndexes(looseCandidate);
      if (emptyDayIndexes.length > 0) {
        logger.warn(
          { jobId: job.id, planId, emptyDayIndexes },
          "Plan generation: skipping LLM empty-day retry; using deterministic catalog repair",
        );
      }
    }

    if (!parseResult.ok && looseCandidate) {
      const repaired = repairScheduleLengthAndEmptyDays(
        looseCandidate,
        goal,
        daysPerWeek,
        exercisesPerDay,
        promptExercises,
        perDayCatalogs,
        planId,
        job.id,
      );

      if (repaired.repaired) {
        appendTrackedPlanWarnings(repaired.content, repaired.warnings);
        parseResult = parsePlanContent(JSON.stringify(repaired.content));
        if (parseResult.ok) {
          logger.warn(
            { jobId: job.id, planId, repairs: repaired.warnings },
            "Plan generation repaired short/empty schedule output",
          );
        }
      }
    }

    if (!parseResult.ok) {
      const fallbackContent = buildDeterministicPlanFromCatalogs({
        goal,
        durationWeeks,
        daysPerWeek,
        exercisesPerDay,
        exercisesByDay: perDayCatalogs,
        planId,
        jobId: job.id,
        reason: parseResult.reason || "unparseable_or_incomplete_llm_output",
      });
      const fallbackParse = parsePlanContent(JSON.stringify(fallbackContent));
      if (fallbackParse.ok) {
        logger.warn(
          {
            jobId: job.id,
            planId,
            technicalReason: parseResult.reason,
            rawSnippet: String(rawAnswer).slice(0, 500),
          },
          "Plan generation recovered from invalid LLM output using per-day catalog repair",
        );
        parseResult = fallbackParse;
      }
    }

    if (!parseResult.ok) {
      // If the failure was that no JSON object was returned even after retry,
      // surface a friendly message but keep the technical reason in logs.
      const tech = parseResult.reason || "";
      if (tech.includes("LLM did not return any JSON")) {
        const reason =
          "AI khong tao du bai tap cho mot so ngay. Vui long thu lai hoac giam so buoi/tuan.";
        logger.error(
          {
            jobId: job.id,
            planId,
            technicalReason: "LLM did not return any JSON object after retry",
            rawSnippet: String(rawAnswer).slice(0, 500),
          },
          "Plan generation: structured output validation failed",
        );
        await conversationRepository.updatePlanFailed(planId, reason);
        return;
      }

      const reason =
        "AI khong tao du bai tap cho mot so ngay. Vui long thu lai hoac giam so buoi/tuan.";
      logger.error(
        {
          jobId: job.id,
          planId,
          technicalReason: parseResult.reason,
          rawSnippet: String(rawAnswer).slice(0, 500),
        },
        "Plan generation: structured output validation failed",
      );
      await conversationRepository.updatePlanFailed(planId, reason);
      return;
    }

    const countRepair = repairExerciseCountAndDayGoals(
      parseResult.content,
      goal,
      daysPerWeek,
      exercisesPerDay,
      perDayCatalogs,
      planId,
      job.id,
    );
    if (countRepair.repaired) {
      appendTrackedPlanWarnings(countRepair.content, countRepair.warnings);
      const repairedValidation = parsePlanContent(
        JSON.stringify(countRepair.content),
      );
      if (repairedValidation.ok) {
        parseResult = repairedValidation;
        logger.warn(
          { jobId: job.id, planId, repairs: countRepair.warnings },
          "Plan generation repaired day goals/exercise counts",
        );
      }
    }

    // 4b. Repair muscle-group mismatches (exercise in wrong day)
    const mismatchWarnings: Array<Record<string, unknown>> = [];
    const catalogById = new Map(perDayCatalogs.map((c) => [c.dayIndex, c]));
    const planContentForRepair = parseResult.content as any;

    if (Array.isArray(planContentForRepair?.weeklySchedule)) {
      for (
        let dayIndex = 0;
        dayIndex < planContentForRepair.weeklySchedule.length;
        dayIndex++
      ) {
        const day = planContentForRepair.weeklySchedule[dayIndex];
        const catalog = catalogById.get(dayIndex);
        if (!catalog || catalog.focusMuscleGroups.includes("FULL_BODY"))
          continue;

        const allowedById = new Map(allowedExercises.map((ex) => [ex.id, ex]));

        if (!Array.isArray(day?.exercises)) continue;

        for (let exIdx = 0; exIdx < day.exercises.length; exIdx++) {
          const ex = day.exercises[exIdx];
          if (!ex?.exerciseId) continue;

          const exInfo = allowedById.get(String(ex.exerciseId));
          if (!exInfo) continue; // Will be caught by idsValid

          const mismatch = validateExerciseMuscleMatch(
            exInfo,
            catalog.focusMuscleGroups,
          );
          if (!mismatch) continue;

          // Try to find a valid replacement from this day's catalog
          const usedIds = new Set(
            day.exercises.map((e: any) => String(e?.exerciseId || "")),
          );
          const replacement =
            catalog.exercises.find(
              (cEx) => !usedIds.has(cEx.id) || cEx.id === ex.exerciseId,
            ) ?? catalog.exercises[exIdx % catalog.exercises.length];

          if (!replacement) continue;

          mismatchWarnings.push({
            type: "muscle_mismatch_repair",
            planId,
            jobId: job.id,
            dayIndex,
            dayGoal: catalog.dayGoal,
            focusMuscleGroups: catalog.focusMuscleGroups,
            replaced: `${exInfo.exerciseName} (${exInfo.bodyPart})`,
            with: `${replacement.exerciseName} (${replacement.bodyPart})`,
            reason: mismatch,
          });

          day.exercises[exIdx] = buildExercisePrescription(
            replacement,
            exIdx + 1,
            "Auto-repaired: exercise did not match day muscle group",
          );
        }
      }
    }

    if (mismatchWarnings.length > 0) {
      appendTrackedPlanWarnings(planContentForRepair, mismatchWarnings);
      const repairedAfterMuscle = parsePlanContent(
        JSON.stringify(planContentForRepair),
      );
      if (repairedAfterMuscle.ok) {
        parseResult = repairedAfterMuscle;
        logger.warn(
          { planId, jobId: job.id, repairs: mismatchWarnings },
          "Plan repaired: muscle-group mismatches corrected",
        );
      }
    }

    // Check IDs
    let idCheck = await idsValid(parseResult.content as any);
    if (!idCheck.ok) {
      try {
        const mapped = await tryMapNamesToIds(parseResult.content);
        if (mapped) return;
      } catch (e) {
        logger.warn(
          { err: e, planId },
          "Name->ID mapping helper failed before LLM correction retry",
        );
      }

      idCheck = await idsValid(parseResult.content as any);
    }

    if (!idCheck.ok) {
      const invalidContent = parseResult.content as any;
      const replacementWarnings: Array<Record<string, unknown>> = [];
      if (Array.isArray(invalidContent.weeklySchedule)) {
        for (
          let dayIndex = 0;
          dayIndex < invalidContent.weeklySchedule.length;
          dayIndex += 1
        ) {
          const day = invalidContent.weeklySchedule[dayIndex];
          if (!Array.isArray(day?.exercises)) continue;

          const usedIds = new Set(
            day.exercises
              .map((exercise: any) => String(exercise?.exerciseId || "").trim())
              .filter((id: string) => allowedIds.has(id)),
          );

          for (
            let exerciseIndex = 0;
            exerciseIndex < day.exercises.length;
            exerciseIndex += 1
          ) {
            const exercise = day.exercises[exerciseIndex];
            if (
              exercise?.exerciseId &&
              allowedIds.has(String(exercise.exerciseId))
            )
              continue;

            const dayCandidates = catalogById.get(dayIndex)?.exercises ?? [];
            const preferred = chooseRepairExercise(day, goal, dayCandidates);
            const fallback = dayCandidates.find(
              (candidate) => !usedIds.has(candidate.id),
            );
            const selected =
              preferred && !usedIds.has(preferred.id) ? preferred : fallback;
            if (!selected) continue;

            usedIds.add(selected.id);
            day.exercises[exerciseIndex] = buildExercisePrescription(
              selected,
              exerciseIndex + 1,
              "Auto-repaired from allowed exercise catalog after invalid exerciseId output",
            );
            replacementWarnings.push({
              type: "deterministic_repair",
              planId,
              jobId: job.id,
              dayIndex,
              exerciseIndex,
              reason: "replaced_invalid_exercise_id",
              selectedExerciseId: selected.id,
              selectedExerciseName: selected.exerciseName,
            });
          }
        }
      }

      if (replacementWarnings.length > 0) {
        appendTrackedPlanWarnings(invalidContent, replacementWarnings);
        const repairedValidation = parsePlanContent(
          JSON.stringify(invalidContent),
        );
        const repairedIdCheck = await idsValid(invalidContent);
        if (repairedValidation.ok && repairedIdCheck.ok) {
          parseResult = repairedValidation;
          idCheck = repairedIdCheck;
          logger.warn(
            { jobId: job.id, planId, repairs: replacementWarnings },
            "Plan generation repaired invalid exercise ids",
          );
        }
      }
    }

    if (!idCheck.ok) {
      // Retry once with a corrective prompt instructing to use only allowed exerciseIds
      const correctionPrompt = `The previous output used exerciseIds not present in the allowed list. Allowed exercises (id -> name):\n${promptExercises
        .map((e) => `${e.id} -> ${e.exerciseName}`)
        .join(
          "\n",
        )}\n\nPlease re-output the plan JSON only using exerciseId fields that are exactly one of the allowed ids. Keep the same JSON structure as previously requested and make sure each exercise object includes ${"exerciseId, name, sets, reps, restSeconds"}. Return ONLY the JSON.`;

      try {
        const retryStartedAt = Date.now();
        const retryResp = await llmService.callLLM(
          correctionPrompt + "\n" + rawAnswer,
          {
            responseFormat: "json",
            timeoutMs: planRetryTimeoutMs,
            numPredict: planRetryNumPredict,
            temperature: 0.1,
          },
        );
        logger.info(
          {
            jobId: job.id,
            planId,
            durationMs: Date.now() - retryStartedAt,
            promptTokens: retryResp.promptTokens,
            completionTokens: retryResp.completionTokens,
            numPredict: planRetryNumPredict,
          },
          "Plan generation invalid-id retry finished",
        );
        const retryRaw = retryResp.answer;
        parseResult = parsePlanContent(retryRaw);
        if (!parseResult.ok) {
          const reason = `Plan content invalid after retry: ${parseResult.reason}`;
          logger.error(
            { jobId: job.id, planId, reason },
            "Plan generation: retry parse failed",
          );
          await conversationRepository.updatePlanFailed(planId, reason);
          return;
        }
        const retryCountRepair = repairExerciseCountAndDayGoals(
          parseResult.content,
          goal,
          daysPerWeek,
          exercisesPerDay,
          perDayCatalogs,
          planId,
          job.id,
        );
        if (retryCountRepair.repaired) {
          appendTrackedPlanWarnings(
            retryCountRepair.content,
            retryCountRepair.warnings,
          );
          const retryRepairValidation = parsePlanContent(
            JSON.stringify(retryCountRepair.content),
          );
          if (retryRepairValidation.ok) {
            parseResult = retryRepairValidation;
          }
        }
        idCheck = await idsValid(parseResult.content as any);
        if (!idCheck.ok) {
          try {
            const mapped = await tryMapNamesToIds(parseResult.content);
            if (mapped) return;
          } catch (e) {
            logger.warn({ err: e, planId }, "Name->ID mapping helper failed");
          }

          const incomplete = parseResult.content as any;
          const repairedDays: Array<{
            dayIndex: number;
            selectedExerciseId: string;
            selectedExerciseName: string;
          }> = [];

          if (Array.isArray(incomplete.weeklySchedule)) {
            for (
              let dayIndex = 0;
              dayIndex < incomplete.weeklySchedule.length;
              dayIndex += 1
            ) {
              const day = incomplete.weeklySchedule[dayIndex];
              if (Array.isArray(day.exercises) && day.exercises.length > 0)
                continue;

              const selected = chooseRepairExercise(
                day,
                goal,
                catalogById.get(dayIndex)?.exercises ?? [],
              );
              if (!selected) {
                continue;
              }

              day.exercises = [
                {
                  exerciseId: selected.id,
                  order: 1,
                  name: selected.exerciseName,
                  sets: 3,
                  reps: "8-12",
                  restSeconds: 60,
                  note: "Auto-repaired from allowed exercise catalog after empty-day output",
                },
              ];
              repairedDays.push({
                dayIndex,
                selectedExerciseId: selected.id,
                selectedExerciseName: selected.exerciseName,
              });
            }
          }

          const repairedValidation = parsePlanContent(
            JSON.stringify(incomplete),
          );
          const repairedIdCheck = await idsValid(incomplete);
          if (
            repairedDays.length > 0 &&
            repairedValidation.ok &&
            repairedIdCheck.ok
          ) {
            appendTrackedPlanWarnings(
              incomplete,
              repairedDays.map((item) => ({
                type: "deterministic_repair",
                planId,
                jobId: job.id,
                dayIndex: item.dayIndex,
                reason: "deterministic_empty_day_repair",
                selectedExerciseId: item.selectedExerciseId,
                selectedExerciseName: item.selectedExerciseName,
              })),
            );
            await completePlan(
              incomplete,
              "Plan generation completed after deterministic empty-day repair",
              { repairedDays },
            );
            return;
          }

          await conversationRepository.updatePlanFailed(
            planId,
            "AI khong tao du bai tap cho mot so ngay. Vui long thu lai hoac giam so buoi/tuan.",
          );
          logger.warn(
            { jobId: job.id, planId, missing: idCheck.missing, repairedDays },
            "Plan generation failed after repair attempts",
          );
          return;
        }
      } catch (err) {
        const reason = `LLM retry failed: ${String(err)}`;
        logger.error(
          { err, jobId: job.id, planId },
          "Plan generation: LLM retry failed",
        );
        await conversationRepository.updatePlanFailed(planId, reason);
        return;
      }
    }

    // Fallback: if IDs are missing but the LLM returned exercise names, first
    // try to map names -> IDs using the in-memory `allowedExercises` list
    // returned earlier (best match). If that fails, fall back to the
    // fitness-service public search endpoint.
    async function tryMapNamesToIds(content: any): Promise<boolean> {
      const nameToFind: string[] = [];
      for (const day of content.weeklySchedule) {
        for (const ex of day.exercises) {
          if (
            (!ex.exerciseId || !allowedIds.has(String(ex.exerciseId))) &&
            ex.name
          ) {
            nameToFind.push(String(ex.name));
          }
        }
      }

      if (nameToFind.length === 0) return false;

      // helper normalizer
      const normalize = (s: string) =>
        String(s || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");

      // Collect warnings generated during mapping attempts.
      const mappingWarnings: Array<any> = [];

      // 1) try matching against allowedExercises we fetched earlier
      for (const nm of nameToFind) {
        const qn = normalize(nm);
        let best: any = null;
        for (const cand of allowedExercises) {
          const cn = normalize(cand.exerciseName || "");
          // Only accept confident substring matches. Do NOT pick an arbitrary
          // candidate when no clear match exists.
          if (cn.includes(qn) || qn.includes(cn)) {
            best = cand;
            break;
          }
        }
        if (best) {
          mappingWarnings.push({
            type: "name_mapping",
            planId,
            jobId: job.id,
            exerciseName: nm,
            mappedTo: best.id,
            mappedName: best.exerciseName,
            source: "allowedList",
          });
          for (const day of content.weeklySchedule) {
            for (const ex of day.exercises) {
              if (
                (!ex.exerciseId ||
                  ex.exerciseId === "" ||
                  !allowedIds.has(String(ex.exerciseId))) &&
                ex.name &&
                normalize(String(ex.name)).includes(qn)
              ) {
                ex.exerciseId = best.id;
                ex.name = best.exerciseName || ex.name;
              }
            }
          }
        } else {
          // Log that we couldn't confidently map this name against allowed list.
          logger.warn(
            { planId, jobId: job.id, exerciseName: nm },
            "Name not confidently matched in allowedExercises (skipping allowed-list mapping)",
          );
        }
      }

      // Re-run id validation - if successful, persist and finish.
      let newCheck = await idsValid(content);
      if (newCheck.ok) {
        await completePlan(
          content,
          "Plan generation completed after allowedExercises name->id mapping",
        );
        return true;
      }

      // NOTE: a "2) fallback to fitness-service's public /exercises search"
      // step used to live here. Removed — gym-onboarding project security
      // review (§20/§26): that endpoint is NOT equipment-filtered, so a
      // name too vague to confidently match against `allowedExercises`
      // (already equipment-safe, tried above) could resolve to any exercise
      // in the entire catalog regardless of the user's actual equipment,
      // violating "the LLM/repair mechanism may only choose from a
      // candidate pool already proven equipment-compatible". Any name that
      // still isn't mapped after the allowedList attempt above now falls
      // through to the deterministic per-day repair block below (still
      // sourced only from `allowedExercises`), which was already the
      // pipeline's own safe fallback for exactly this case.

      // Re-run id validation - if successful, persist and finish.
      const finalCheck = await idsValid(content);
      if (finalCheck.ok) {
        // Persist mapping warnings into the plan JSON so downstream consumers
        // and operators can debug which names were auto-mapped.
        content._metadata = content._metadata || {};
        content._metadata.aiWarnings = (
          content._metadata.aiWarnings || []
        ).concat(mappingWarnings);
        if (mappingWarnings.length > 0)
          logger.warn(
            { planId, jobId: job.id, mappings: mappingWarnings },
            "Persisting plan with mapping warnings",
          );
        await completePlan(
          content,
          "Plan generation completed after name->id mapping fallback",
        );
        return true;
      }
      return false;
    }

    // If initial id check failed, attempt mapping fallback before giving up.
    if (!idCheck.ok) {
      try {
        const mapped = await tryMapNamesToIds(parseResult.content);
        if (mapped) return; // done
      } catch (e) {
        logger.warn(
          { err: e, planId },
          "Name->ID mapping fallback encountered an error",
        );
      }
    }

    // Normalize exercise names using canonical names from fitness-service
    const canonicalById = new Map(
      allowedExercises.map((e) => [e.id, e.exerciseName]),
    );
    let content = parseResult.content as any;
    for (const day of content.weeklySchedule) {
      for (const ex of day.exercises) {
        const canonical = canonicalById.get(ex.exerciseId);
        if (canonical) ex.name = canonical;
      }
    }

    if (coachContext) {
      const professionalValidation = validateLegacyPlanContent(
        content,
        coachContext,
        evidenceBundle.evidence_used,
      );
      if (
        professionalValidation.errors.length > 0 ||
        professionalValidation.warnings.length > 0
      ) {
        appendTrackedPlanWarnings(content, [
          {
            type: "coach_plan_validation",
            errors: professionalValidation.errors,
            warnings: professionalValidation.warnings,
          },
        ]);
        logger.warn(
          {
            planId,
            jobId: job.id,
            errorCodes: professionalValidation.errors.map((item) => item.code),
            warningCodes: professionalValidation.warnings.map(
              (item) => item.code,
            ),
          },
          "Coach plan validator reported issues",
        );
      }

      const hardFallbackCodes = new Set([
        "available_days_exceeded",
        "beginner_volume_too_high",
      ]);
      if (
        professionalValidation.errors.some((item) =>
          hardFallbackCodes.has(item.code),
        )
      ) {
        content = buildLegacyDeterministicPlanContent(coachContext, {
          goal,
          durationWeeks,
          daysPerWeek,
          exercisesPerDay,
          allowedExercises,
        }) as any;
        appendTrackedPlanWarnings(content, [
          {
            type: "coach_plan_validation_fallback",
            reason: "structured_plan_failed_backend_validation",
            errorCodes: professionalValidation.errors.map((item) => item.code),
          },
        ]);
      }
    }

    // Embed trainingLocation and equipmentPreference in plan metadata for frontend display
    content._metadata = content._metadata || {};
    content._metadata.trainingLocation = trainingLocation;
    content._metadata.equipmentPreference = equipmentPreference;

    // 5. Persist structured plan
    await completePlan(content, "Plan generation completed successfully");
  },
  {
    connection: redisConnection,
    // Retry up to 2 times on transient LLM failures (network, timeout).
    // Validation failures are NOT re-thrown, so they won't consume retries.
  },
);

aiWorker.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, err },
    "AI worker job failed after all retries",
  );
});
