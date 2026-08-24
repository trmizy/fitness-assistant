import { prisma } from "../repositories/prisma";
import { estimate1RM } from "../utils/estimated-1rm.util";

function weekIndexOf(date: Date, cycleStart: Date): number {
  const days = Math.floor((date.getTime() - cycleStart.getTime()) / 86_400_000);
  return Math.max(0, Math.floor(days / 7)); // 0-indexed week number within the cycle
}

export interface AdherenceMetric {
  completed: number;
  total: number;
  /** null when there were no scheduled sessions to judge against — a 0/0
   * cycle must never read as either 0% (no data mistaken for total failure)
   * or 100% (no data mistaken for perfect adherence). */
  percent: number | null;
}

export interface VolumeWeek {
  week: number;
  totalVolumeKg: number;
  byMuscleGroup: Record<string, number>;
}

export interface E1rmTrendPoint {
  exerciseName: string;
  weeklyTop: Array<{ week: number; e1rm: number }>;
}

export interface RpeTrend {
  weeklyAvg: number[];
  trend: "stable" | "increasing" | "decreasing";
}

export interface RirTrend {
  weeklyAvg: number[];
  trend: "stable" | "increasing" | "decreasing";
}

/** Adherence to date: completed sessions vs planned sessions in [startDate, asOf]. */
export async function computeAdherence(
  userId: string,
  planId: string | null,
  startDate: Date,
  asOf: Date,
): Promise<AdherenceMetric> {
  const schedules = await prisma.workoutSchedule.findMany({
    where: {
      userId,
      ...(planId ? { sourcePlanId: planId } : {}),
      date: { gte: startDate, lte: asOf },
    },
    select: { status: true },
  });
  const total = schedules.length;
  const completed = schedules.filter((s) => s.status === "COMPLETED").length;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : null,
  };
}

interface SetRow {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  completed: boolean;
  date: Date;
  exerciseName: string;
  muscleGroups: string[];
  /** SET_TYPES from fitness.models.ts (WARMUP/WORKING/TOP/BACKOFF/FAILURE),
   * null for pre-advanced-set-logging rows. Used to exclude warm-up sets
   * from e1RM/PR/RPE/RIR (maximal-performance and effort signals a warm-up
   * set, by definition, doesn't represent — industry convention per
   * docs/OPENGYM_RESEARCH_SOURCES.md, not a scientific claim) — deliberately
   * NOT excluded from volume (computeVolumeByWeek), since a warm-up set is
   * still real performed work contributing to training load/fatigue. */
  setType: string | null;
}

async function fetchCompletedSets(
  userId: string,
  start: Date,
  end: Date,
  sourcePlanId?: string | null,
): Promise<SetRow[]> {
  // Workout has no direct sourcePlanId of its own — scope through its
  // linked WorkoutSchedule when a plan is given, so a user with more than
  // one plan/cycle overlapping the same date range (e.g. an old test cycle
  // still sitting in the same calendar month) doesn't have its sets bleed
  // into a DIFFERENT cycle's volume/e1RM/PR calculations. Optional and
  // undefined-safe: omitting it reproduces the exact prior (unscoped)
  // behavior for any caller that doesn't have a plan to scope by.
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      date: { gte: start, lte: end },
      ...(sourcePlanId ? { schedules: { some: { sourcePlanId } } } : {}),
    },
    select: {
      date: true,
      exercises: {
        select: {
          exercise: { select: { exerciseName: true, muscleGroupsActivated: true } },
          workoutSets: {
            where: { completed: true },
            select: { weight: true, reps: true, rpe: true, rir: true, completed: true, setType: true },
          },
        },
      },
    },
  });

  const rows: SetRow[] = [];
  for (const w of workouts) {
    for (const ex of w.exercises) {
      for (const set of ex.workoutSets) {
        rows.push({
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          rir: set.rir,
          completed: set.completed,
          date: w.date,
          exerciseName: ex.exercise.exerciseName,
          muscleGroups: ex.exercise.muscleGroupsActivated ?? [],
          setType: set.setType,
        });
      }
    }
  }
  return rows;
}

/** Training volume (Σ weight×reps) per week of the cycle, broken down by muscle group. */
export function computeVolumeByWeek(
  sets: SetRow[],
  cycleStart: Date,
): VolumeWeek[] {
  const weeks = new Map<number, VolumeWeek>();
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const week = weekIndexOf(s.date, cycleStart);
    const volume = s.weight * s.reps;
    if (!weeks.has(week)) {
      weeks.set(week, { week, totalVolumeKg: 0, byMuscleGroup: {} });
    }
    const entry = weeks.get(week)!;
    entry.totalVolumeKg += volume;
    for (const group of s.muscleGroups) {
      entry.byMuscleGroup[group] = (entry.byMuscleGroup[group] ?? 0) + volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.week - b.week);
}

/** % change in total volume: last week of data vs first week of the cycle. */
export function computeVolumeChangePct(weeks: VolumeWeek[]): number | null {
  if (weeks.length < 2) return null;
  const first = weeks[0].totalVolumeKg;
  const last = weeks[weeks.length - 1].totalVolumeKg;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

/** Weekly top-set e1RM trend for the most-frequently-trained exercises (empirically the user's main lifts). */
export function computeE1rmTrend(
  sets: SetRow[],
  cycleStart: Date,
  topN = 5,
): E1rmTrendPoint[] {
  const byExercise = new Map<string, SetRow[]>();
  for (const s of sets) {
    if (s.weight == null || s.reps == null || s.setType === "WARMUP") continue;
    if (!byExercise.has(s.exerciseName)) byExercise.set(s.exerciseName, []);
    byExercise.get(s.exerciseName)!.push(s);
  }

  const ranked = [...byExercise.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, topN);

  return ranked.map(([exerciseName, exSets]) => {
    const byWeek = new Map<number, number>();
    for (const s of exSets) {
      const week = weekIndexOf(s.date, cycleStart);
      const e1rm = estimate1RM(s.weight!, s.reps!);
      byWeek.set(week, Math.max(byWeek.get(week) ?? 0, e1rm));
    }
    const weeklyTop = [...byWeek.entries()]
      .sort(([a], [b]) => a - b)
      .map(([week, e1rm]) => ({ week, e1rm: Math.round(e1rm * 10) / 10 }));
    return { exerciseName, weeklyTop };
  });
}

/** New PRs during the cycle: cycle-max weight per exercise exceeds the all-time-before-cycle max. */
export async function computeNewPRs(
  userId: string,
  cycleSets: SetRow[],
  cycleStart: Date,
): Promise<string[]> {
  const exerciseNames = [...new Set(cycleSets.map((s) => s.exerciseName))];
  if (exerciseNames.length === 0) return [];

  const priorBest = await prisma.workoutSet.findMany({
    where: {
      completed: true,
      // Prisma's `setType: { not: "WARMUP" }` alone would exclude every
      // NULL-setType row too (standard SQL three-valued logic — verified
      // empirically against the real dev DB before writing this: with all
      // 485,741 existing rows at setType=null, that filter alone matched
      // ZERO of them). The vast majority of real rows predate the advanced-
      // set-logging UI and are null, so this OR is not optional polish —
      // without it, PR detection would have silently gone dark for
      // virtually every user.
      OR: [{ setType: null }, { setType: { not: "WARMUP" } }],
      workoutExercise: {
        exercise: { exerciseName: { in: exerciseNames } },
        workout: { userId, date: { lt: cycleStart } },
      },
    },
    select: {
      weight: true,
      workoutExercise: { select: { exercise: { select: { exerciseName: true } } } },
    },
  });

  const priorMax = new Map<string, number>();
  for (const s of priorBest) {
    if (s.weight == null) continue;
    const name = s.workoutExercise.exercise.exerciseName;
    priorMax.set(name, Math.max(priorMax.get(name) ?? 0, s.weight));
  }

  const cycleMax = new Map<string, number>();
  for (const s of cycleSets) {
    if (s.weight == null || s.setType === "WARMUP") continue;
    cycleMax.set(s.exerciseName, Math.max(cycleMax.get(s.exerciseName) ?? 0, s.weight));
  }

  const prs: string[] = [];
  for (const [name, max] of cycleMax) {
    const prior = priorMax.get(name);
    if (prior == null || max > prior) prs.push(name);
  }
  return prs;
}

/** RPE trend across weeks of the cycle — used as a fatigue proxy. */
export function computeRpeTrend(sets: SetRow[], cycleStart: Date): RpeTrend {
  const byWeek = new Map<number, number[]>();
  for (const s of sets) {
    if (s.rpe == null) continue;
    const week = weekIndexOf(s.date, cycleStart);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(s.rpe);
  }
  const weeklyAvg = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, values]) => Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10);

  let trend: RpeTrend["trend"] = "stable";
  if (weeklyAvg.length >= 3) {
    const risingStreak = weeklyAvg
      .slice(-3)
      .every((v, i, arr) => i === 0 || v >= arr[i - 1]);
    const fallingStreak = weeklyAvg
      .slice(-3)
      .every((v, i, arr) => i === 0 || v <= arr[i - 1]);
    if (risingStreak && weeklyAvg[weeklyAvg.length - 1] > weeklyAvg[weeklyAvg.length - 3]) {
      trend = "increasing";
    } else if (fallingStreak && weeklyAvg[weeklyAvg.length - 1] < weeklyAvg[weeklyAvg.length - 3]) {
      trend = "decreasing";
    }
  }
  return { weeklyAvg, trend };
}

/** RIR (Reps in Reserve) trend across weeks of the cycle — mirrors
 * computeRpeTrend's shape exactly. Backed by WorkoutSet.rir, added in the
 * 20260728010000_workout_set_rir migration; before that migration this
 * schema had no RIR data source at all (see the averageRir doc comment in
 * cycle-metrics.engine.ts for that now-resolved history). */
export function computeRirTrend(sets: SetRow[], cycleStart: Date): RirTrend {
  const byWeek = new Map<number, number[]>();
  for (const s of sets) {
    if (s.rir == null) continue;
    const week = weekIndexOf(s.date, cycleStart);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(s.rir);
  }
  const weeklyAvg = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, values]) => Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10);

  let trend: RirTrend["trend"] = "stable";
  if (weeklyAvg.length >= 3) {
    const risingStreak = weeklyAvg
      .slice(-3)
      .every((v, i, arr) => i === 0 || v >= arr[i - 1]);
    const fallingStreak = weeklyAvg
      .slice(-3)
      .every((v, i, arr) => i === 0 || v <= arr[i - 1]);
    if (risingStreak && weeklyAvg[weeklyAvg.length - 1] > weeklyAvg[weeklyAvg.length - 3]) {
      trend = "increasing";
    } else if (fallingStreak && weeklyAvg[weeklyAvg.length - 1] < weeklyAvg[weeklyAvg.length - 3]) {
      trend = "decreasing";
    }
  }
  return { weeklyAvg, trend };
}

export async function computeWorkoutMetrics(
  userId: string,
  cycleStart: Date,
  asOf: Date,
  sourcePlanId?: string | null,
) {
  const sets = await fetchCompletedSets(userId, cycleStart, asOf, sourcePlanId);
  const volumeByWeek = computeVolumeByWeek(sets, cycleStart);
  return {
    sets,
    volumeByWeek,
    volumeChangePct: computeVolumeChangePct(volumeByWeek),
    e1rmTrend: computeE1rmTrend(sets, cycleStart),
    rpeTrend: computeRpeTrend(sets, cycleStart),
    rirTrend: computeRirTrend(sets, cycleStart),
  };
}
