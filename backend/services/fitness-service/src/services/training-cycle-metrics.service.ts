import { prisma } from "../repositories/prisma";
import { estimate1RM } from "../utils/estimated-1rm.util";

function weekIndexOf(date: Date, cycleStart: Date): number {
  const days = Math.floor((date.getTime() - cycleStart.getTime()) / 86_400_000);
  return Math.max(0, Math.floor(days / 7)); // 0-indexed week number within the cycle
}

export interface AdherenceMetric {
  completed: number;
  total: number;
  percent: number;
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
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

interface SetRow {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  completed: boolean;
  date: Date;
  exerciseName: string;
  muscleGroups: string[];
}

async function fetchCompletedSets(
  userId: string,
  start: Date,
  end: Date,
): Promise<SetRow[]> {
  const workouts = await prisma.workout.findMany({
    where: { userId, date: { gte: start, lte: end } },
    select: {
      date: true,
      exercises: {
        select: {
          exercise: { select: { exerciseName: true, muscleGroupsActivated: true } },
          workoutSets: {
            where: { completed: true },
            select: { weight: true, reps: true, rpe: true, completed: true },
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
          completed: set.completed,
          date: w.date,
          exerciseName: ex.exercise.exerciseName,
          muscleGroups: ex.exercise.muscleGroupsActivated ?? [],
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
    if (s.weight == null || s.reps == null) continue;
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
    if (s.weight == null) continue;
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

export async function computeWorkoutMetrics(
  userId: string,
  cycleStart: Date,
  asOf: Date,
) {
  const sets = await fetchCompletedSets(userId, cycleStart, asOf);
  const volumeByWeek = computeVolumeByWeek(sets, cycleStart);
  return {
    sets,
    volumeByWeek,
    volumeChangePct: computeVolumeChangePct(volumeByWeek),
    e1rmTrend: computeE1rmTrend(sets, cycleStart),
    rpeTrend: computeRpeTrend(sets, cycleStart),
  };
}
