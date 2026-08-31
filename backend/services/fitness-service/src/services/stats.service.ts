import { workoutRepository } from "../repositories/workout.repository";
import { nutritionRepository } from "../repositories/nutrition.repository";
import { prisma } from "../repositories/prisma";
import {
  currentWeekRange,
  todayAsScheduleDate,
  scheduledDateLabel,
} from "../utils/schedule-lock.util";
import { computeMuscleScores, normalizeToIntensity, type MuscleLink } from "../utils/muscle-heatmap.util";
import { classifyDayState, type ActivityDayState } from "../utils/activity-heatmap.util";
import { computeSessionProgressPoint, type CompletedSetInput } from "../utils/exercise-progress.util";
import { trainingCycleService } from "./training-cycle.service";
import { workoutService } from "./workout.service";

const STREAK_LOOKBACK_DAYS = 400;

/** Strict YYYY-MM-DD -> UTC-midnight Date, or null if not that exact
 * shape. Deliberately never delegates to `new Date(str)` for a date-only
 * string — see muscle-heatmap's own module doc comment on why. */
function parseDateOnlyUtc(value: string | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

// Consecutive calendar days (per Asia/Ho_Chi_Minh), ending today or
// yesterday, that have at least one COMPLETED WorkoutSchedule. Today itself
// doesn't have to be completed yet for the streak to still count (a user
// mid-day, not yet trained today, shouldn't see their real streak reset to
// 0) — but any actual gap day breaks it. Replaces a previous hardcoded
// "0 ngày" placeholder that was never computed from real data at all.
async function computeCurrentStreakDays(
  userId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await workoutRepository.findCompletedScheduleDates(userId, since);
  const completedLabels = new Set(
    (rows as { date: Date }[]).map((r) => scheduledDateLabel(r.date)),
  );

  const cursor = todayAsScheduleDate(now);
  if (!completedLabels.has(scheduledDateLabel(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (completedLabels.has(scheduledDateLabel(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export const statsService = {
  async getWorkoutStats(userId: string, days = 30) {
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // duration/exercise-count totals still come from raw Workout rows —
    // these aren't part of the "completed sessions" count that had to match
    // the cycle report's definition, and nothing else derives a conflicting
    // number from them.
    const workouts = await workoutRepository.findForStats(userId, startDate);
    type WorkoutStat = {
      duration?: number | null;
      exercises: { length: number } | unknown[];
    };
    const typedWorkouts = workouts as WorkoutStat[];
    const totalDuration = typedWorkouts.reduce(
      (sum, w) => sum + (w.duration || 0),
      0,
    );
    const totalExercises = typedWorkouts.reduce(
      (sum, w) => sum + (w.exercises as unknown[]).length,
      0,
    );

    // "Completed sessions" uses the same canonical definition as the
    // training-cycle/adherence code (WorkoutSchedule.status === "COMPLETED"),
    // not a raw Workout-row count — see countCompletedSchedules' doc comment.
    const totalWorkouts = await workoutRepository.countCompletedSchedules(
      userId,
      startDate,
      now,
    );

    // weeklyWorkouts is the field the frontend's "Tuần này" tile reads; it
    // was previously undefined (always rendered as a hardcoded 0/N) because
    // no backend field existed for it at all.
    const { start: weekStart, end: weekEnd } = currentWeekRange(now);
    const weeklyWorkouts = await workoutRepository.countCompletedSchedules(
      userId,
      weekStart,
      weekEnd,
    );

    const currentStreakDays = await computeCurrentStreakDays(userId, now);

    return {
      totalWorkouts,
      weeklyWorkouts,
      currentStreakDays,
      totalDuration,
      totalExercises,
      averageDuration:
        totalWorkouts > 0 ? Math.round(totalDuration / totalWorkouts) : 0,
      workoutsPerWeek: (totalWorkouts / (days / 7)).toFixed(1),
    };
  },

  async getNutritionStats(userId: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    type NutritionStat = {
      calories: number;
      protein?: number | null;
      carbs?: number | null;
      fats?: number | null;
    };
    const logs = (await nutritionRepository.findForStats(
      userId,
      startDate,
    )) as NutritionStat[];
    const totalCalories = logs.reduce((sum, l) => sum + l.calories, 0);
    const totalProtein = logs.reduce((sum, l) => sum + (l.protein || 0), 0);
    const totalCarbs = logs.reduce((sum, l) => sum + (l.carbs || 0), 0);
    const totalFats = logs.reduce((sum, l) => sum + (l.fats || 0), 0);

    return {
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFats,
      averageCaloriesPerDay: Math.round(totalCalories / days),
      averageProteinPerDay: Math.round(totalProtein / days),
      averageCarbsPerDay: Math.round(totalCarbs / days),
      averageFatsPerDay: Math.round(totalFats / days),
    };
  },

  /**
   * Roadmap P3.1 "Muscle heatmap" (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
   * `range`: "7d" | "30d" | "cycle" (the user's real ACTIVE TrainingCycle
   * window, up to today) | "custom" (explicit from/to). Scoring/weighting
   * logic itself lives in the pure, unit-tested muscle-heatmap.util.ts —
   * this function only resolves the date window and does the real DB
   * joins.
   */
  async getMuscleHeatmap(
    userId: string,
    params: { range: "7d" | "30d" | "cycle" | "custom"; from?: string; to?: string },
  ) {
    const today = todayAsScheduleDate();
    let from: Date;
    let to: Date = today;
    let noActiveCycle = false;

    if (params.range === "7d") {
      from = new Date(today);
      from.setUTCDate(from.getUTCDate() - 7);
    } else if (params.range === "30d") {
      from = new Date(today);
      from.setUTCDate(from.getUTCDate() - 30);
    } else if (params.range === "cycle") {
      try {
        const { cycle } = await trainingCycleService.getActiveCycle(userId);
        from = cycle.startDate;
        to = cycle.endDate < today ? cycle.endDate : today;
      } catch (err: any) {
        if (err?.status !== 404) throw err;
        noActiveCycle = true;
        from = today;
        to = today;
      }
    } else {
      // "custom" — parsed the same timezone-safe way every other date in
      // this codebase is (never new Date(dateOnlyString) — see this
      // session's own real bug history on that exact parsing mistake).
      const parsedFrom = parseDateOnlyUtc(params.from);
      const parsedTo = parseDateOnlyUtc(params.to);
      if (!parsedFrom || !parsedTo) throw { status: 400, message: "custom range requires valid from/to (YYYY-MM-DD)" };
      from = parsedFrom;
      to = parsedTo;
    }

    if (noActiveCycle) {
      return { range: params.range, from: scheduledDateLabel(from), to: scheduledDateLabel(to), noActiveCycle: true, muscles: [] };
    }

    // Real completed WORKING sets (never WARMUP) in the window, grouped
    // by exercise — the null-inclusive OR is deliberate: Prisma's `not`
    // on a nullable column is not guaranteed obvious, so this is written
    // explicitly rather than trusted implicitly.
    const sets = await prisma.workoutSet.findMany({
      where: {
        completed: true,
        OR: [{ setType: null }, { setType: { not: "WARMUP" } }],
        workoutExercise: { workout: { userId, date: { gte: from, lte: to } } },
      },
      select: { workoutExercise: { select: { exerciseId: true } } },
    });

    const workingSetCountByExerciseId = new Map<string, number>();
    for (const s of sets) {
      const id = s.workoutExercise.exerciseId;
      workingSetCountByExerciseId.set(id, (workingSetCountByExerciseId.get(id) ?? 0) + 1);
    }

    const exerciseIds = [...workingSetCountByExerciseId.keys()];
    const muscleLinkRows = exerciseIds.length
      ? await prisma.exerciseMuscle.findMany({
          where: { exerciseId: { in: exerciseIds } },
          select: { exerciseId: true, muscleId: true, role: true },
        })
      : [];
    const muscleLinksByExerciseId = new Map<string, MuscleLink[]>();
    for (const row of muscleLinkRows) {
      const list = muscleLinksByExerciseId.get(row.exerciseId) ?? [];
      list.push({ muscleId: row.muscleId, role: row.role as "primary" | "secondary" });
      muscleLinksByExerciseId.set(row.exerciseId, list);
    }

    const scores = computeMuscleScores(workingSetCountByExerciseId, muscleLinksByExerciseId);
    const intensities = normalizeToIntensity(scores);

    const muscleIds = [...scores.keys()];
    const muscleRows = muscleIds.length
      ? await prisma.muscle.findMany({ where: { id: { in: muscleIds } } })
      : [];
    const muscles = muscleRows
      .map((m) => ({
        muscleId: m.id,
        code: m.code,
        nameVi: m.nameVi,
        nameEn: m.nameEn,
        anatomyRegion: m.anatomyRegion,
        score: Math.round((scores.get(m.id) ?? 0) * 100) / 100,
        intensity: intensities.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    return { range: params.range, from: scheduledDateLabel(from), to: scheduledDateLabel(to), noActiveCycle: false, muscles };
  },

  /**
   * Roadmap P3.2 "Activity heatmap" (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
   * Returns every calendar day in [from, to] with its classified state
   * (or null for a future day — see classifyDayState's own doc comment).
   */
  async getActivityHeatmap(userId: string, from: Date, to: Date) {
    const todayLabel = scheduledDateLabel(todayAsScheduleDate());

    const [schedulesAtDate, schedulesMovedAway] = await Promise.all([
      prisma.workoutSchedule.findMany({
        where: { userId, date: { gte: from, lte: to } },
        select: { date: true, status: true },
      }),
      prisma.workoutSchedule.findMany({
        where: { userId, originalPlannedDate: { gte: from, lte: to, not: null } },
        select: { originalPlannedDate: true },
      }),
    ]);

    const statusByDateLabel = new Map(schedulesAtDate.map((s) => [scheduledDateLabel(s.date), s.status]));
    const movedAwayDateLabels = new Set(
      schedulesMovedAway.filter((s) => s.originalPlannedDate).map((s) => scheduledDateLabel(s.originalPlannedDate!)),
    );

    const days: Array<{ date: string; state: ActivityDayState | null }> = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dateLabel = scheduledDateLabel(cursor);
      const state = classifyDayState({
        dateLabel,
        todayLabel,
        scheduleStatusAtDate: statusByDateLabel.get(dateLabel) ?? null,
        hasOriginalPlanMovedAway: movedAwayDateLabels.has(dateLabel),
      });
      days.push({ date: dateLabel, state });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { from: scheduledDateLabel(from), to: scheduledDateLabel(to), days };
  },

  /**
   * Roadmap P3.2 "Activity heatmap" — click-through day detail. Reuses
   * workoutService.getSessionSummary UNCHANGED for real PR data (the
   * exact same logic the end-of-session completion screen already
   * uses) — never a second, possibly-divergent PR implementation.
   */
  async getActivityDayDetail(userId: string, dateLabel: string) {
    const parsed = parseDateOnlyUtc(dateLabel);
    if (!parsed) throw { status: 400, message: "date must be YYYY-MM-DD" };

    const todayLabel = scheduledDateLabel(todayAsScheduleDate());
    const schedule = await prisma.workoutSchedule.findFirst({
      where: { userId, date: parsed },
    });

    const movedAway = schedule
      ? false
      : !!(await prisma.workoutSchedule.findFirst({ where: { userId, originalPlannedDate: parsed } }));

    const state = classifyDayState({
      dateLabel,
      todayLabel,
      scheduleStatusAtDate: schedule?.status ?? null,
      hasOriginalPlanMovedAway: movedAway,
    });

    if (!schedule?.workoutId) {
      return { date: dateLabel, state, workout: null, volumeKg: null, durationMinutes: null, prs: [], rpeAverage: null, rirAverage: null, notes: schedule?.notes ?? null };
    }

    const workout = await prisma.workout.findUnique({ where: { id: schedule.workoutId } });
    if (!workout) {
      return { date: dateLabel, state, workout: null, volumeKg: null, durationMinutes: null, prs: [], rpeAverage: null, rirAverage: null, notes: schedule.notes ?? null };
    }

    // Volume/RPE/RIR computed directly from real per-set WorkoutSet rows
    // — NOT from getSessionSummary's own totalVolumeKg, which sums
    // WorkoutExercise's coarse weight/reps/sets AGGREGATE fields (a
    // single flat value per exercise, assuming every set was identical).
    // Real finding while writing this feature's own integration test: a
    // workout logged set-by-set (this app's actual, current logging UX
    // — see roadmap's own P1.1 Smart Set-by-Set Prefill) never
    // necessarily populates those coarse aggregate fields at all, so
    // getSessionSummary's volume undercounts (in this test's case, all
    // the way to 0) for exactly the genuinely-varying-per-set data this
    // whole feature exists to visualize accurately. Summing real
    // WorkoutSet rows directly is both more precise AND already this
    // codebase's own established "set-by-set is the source of truth"
    // convention (recomputeScheduleProgress, this session's own P2
    // import commit path, etc.) — not a new pattern invented here.
    const sets = await prisma.workoutSet.findMany({
      where: { completed: true, workoutExercise: { workoutId: workout.id } },
      select: { weight: true, reps: true, rpe: true, rir: true },
    });
    const exerciseCount = await prisma.workoutExercise.count({ where: { workoutId: workout.id } });
    const volumeKg = sets.reduce((sum, s) => (s.weight != null && s.reps != null ? sum + s.weight * s.reps : sum), 0);
    const rpeValues = sets.map((s) => s.rpe).filter((v): v is number => v != null);
    const rirValues = sets.map((s) => s.rir).filter((v): v is number => v != null);
    const average = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

    // PRs are still reused UNCHANGED from getSessionSummary — that
    // comparison (best single set vs prior best, by e1RM) is correct
    // regardless of the aggregate-fields limitation above, since it only
    // ever needs one best set, not a sum.
    let prs: any[] = [];
    try {
      const summary = await workoutService.getSessionSummary(userId, workout.id);
      prs = (summary as any)?.prs ?? [];
    } catch {
      // Never blocks the rest of the detail if the summary itself fails.
    }

    return {
      date: dateLabel,
      state,
      workout: { id: workout.id, name: workout.name, exerciseCount },
      volumeKg: Math.round(volumeKg * 10) / 10,
      durationMinutes: workout.duration ?? null,
      prs,
      rpeAverage: average(rpeValues),
      rirAverage: average(rirValues),
      notes: workout.notes ?? schedule.notes ?? null,
    };
  },

  /**
   * Roadmap P3.3 "Exercise progress charts" (§ 23,
   * docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md). One data
   * point per real session (workout) this user has logged completed sets
   * for this exercise, ordered oldest-to-newest. Every field is computed
   * directly from real `WorkoutSet` rows via the pure
   * `computeSessionProgressPoint` — see that util's own doc comment for
   * why mode-gating ("do not graph weight where not meaningful") is left
   * to the frontend rather than done here.
   *
   * Visibility follows the same rule `import.service.ts`'s catalog
   * lookup already uses for "exercises this user may reference": a
   * public `SYSTEM` exercise, or a `USER_CUSTOM` exercise owned by this
   * user. A `USER_CUSTOM` exercise owned by someone else 404s — same
   * "not found" response as a genuinely nonexistent id, never leaking
   * that a private exercise exists.
   */
  async getExerciseProgress(
    userId: string,
    exerciseId: string,
    params: { from?: string; to?: string },
  ) {
    const exercise = await prisma.exercise.findFirst({
      where: {
        id: exerciseId,
        archivedAt: null,
        OR: [{ source: "SYSTEM" }, { source: "USER_CUSTOM", ownerId: userId }],
      },
      select: { id: true, exerciseName: true, loggingMode: true },
    });
    if (!exercise) throw { status: 404, message: "Exercise not found" };

    let from: Date | undefined;
    let to: Date | undefined;
    if (params.from || params.to) {
      const parsedFrom = parseDateOnlyUtc(params.from);
      const parsedTo = parseDateOnlyUtc(params.to);
      if (!parsedFrom || !parsedTo) {
        throw { status: 400, message: "from and to must both be provided as YYYY-MM-DD" };
      }
      from = parsedFrom;
      to = parsedTo;
    }

    const workoutExercises = await prisma.workoutExercise.findMany({
      where: {
        exerciseId,
        workout: {
          userId,
          ...(from && to ? { date: { gte: from, lte: to } } : {}),
        },
      },
      select: {
        workoutId: true,
        workout: { select: { date: true } },
        workoutSets: {
          where: { completed: true },
          select: { weight: true, reps: true, durationSeconds: true, distanceMeters: true },
        },
      },
    });

    // A single workout can carry more than one WorkoutExercise row for the
    // same exercise (e.g. logged again later in the same session) —
    // grouped by workoutId so every real completed set for this exercise
    // this session feeds one combined session point, never split into two
    // artificial "sessions" on the same real date.
    const setsByWorkoutId = new Map<string, { date: Date; sets: CompletedSetInput[] }>();
    for (const we of workoutExercises) {
      const entry = setsByWorkoutId.get(we.workoutId) ?? { date: we.workout.date, sets: [] };
      entry.sets.push(...we.workoutSets);
      setsByWorkoutId.set(we.workoutId, entry);
    }

    const sessions = [...setsByWorkoutId.entries()]
      .filter(([, entry]) => entry.sets.length > 0)
      .map(([workoutId, entry]) =>
        computeSessionProgressPoint(scheduledDateLabel(entry.date), workoutId, entry.sets),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      exerciseId: exercise.id,
      exerciseName: exercise.exerciseName,
      loggingMode: exercise.loggingMode,
      from: from ? scheduledDateLabel(from) : null,
      to: to ? scheduledDateLabel(to) : null,
      sessions,
    };
  },
};
