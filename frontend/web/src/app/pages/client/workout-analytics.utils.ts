/**
 * Pure logic for the "Phân bổ nhóm cơ" (muscle group distribution) and
 * "Phân bổ loại bài tập" (activity type distribution) charts on the
 * Workout Log overview screen.
 *
 * These used to be two hardcoded arrays of made-up percentages
 * (`muscleChartData`/`exerciseTypeData` in WorkoutLogPage.tsx — e.g.
 * "Chest 25%", "Compound 45%" for every single user, completely
 * disconnected from any real logged data, with a `TimeFilterBar` control
 * that looked interactive but didn't actually filter anything). That is
 * exactly the "never fabricate data to make dashboards look good" failure
 * mode this project's hardening pass is meant to eliminate. This module
 * computes the real distribution from the user's actual logged workout
 * history instead.
 *
 * "Compound vs. Isolation" (the exercise-type chart's old fake categories)
 * has no corresponding real field anywhere in the Exercise model — inventing
 * a heuristic for it risks being confidently wrong, which is worse than not
 * showing it. `typeOfActivity` (STRENGTH/CARDIO/MOBILITY/...) is the closest
 * real, already-tracked classification, so the activity-type chart now
 * reports that instead.
 */

export type AnalyticsTimeFilter = "last" | "week" | "month" | "all";

export interface LoggedExerciseForAnalytics {
  exercise?: {
    muscleGroupsActivated?: string[] | null;
    typeOfActivity?: string | null;
  } | null;
}

export interface LoggedWorkoutForAnalytics {
  date: string | Date;
  exercises: LoggedExerciseForAnalytics[];
}

export interface DistributionSlice {
  name: string;
  value: number; // percentage, rounded; slices sum to ~100 (rounding)
}

const MUSCLE_GROUP_LABELS: Record<string, string> = {
  chest: "Ngực",
  back: "Lưng",
  shoulders: "Vai",
  biceps: "Tay trước",
  triceps: "Tay sau",
  quadriceps: "Đùi trước",
  hamstrings: "Đùi sau",
  glutes: "Mông",
  calves: "Bắp chân",
  abdominals: "Bụng",
  core: "Core",
  "lower back": "Lưng dưới",
  "middle back": "Lưng giữa",
  lats: "Xô",
  traps: "Cầu vai",
  forearms: "Cẳng tay",
  neck: "Cổ",
  "full body": "Toàn thân",
  cardio: "Cardio",
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  STRENGTH: "Sức mạnh",
  CARDIO: "Cardio",
  MOBILITY: "Vận động linh hoạt",
  STRENGTH_CARDIO: "Sức mạnh + Cardio",
  STRENGTH_MOBILITY: "Sức mạnh + Linh hoạt",
};

function muscleGroupLabel(raw: string): string {
  return MUSCLE_GROUP_LABELS[raw.toLowerCase()] ?? raw;
}

function activityTypeLabel(raw: string): string {
  return ACTIVITY_TYPE_LABELS[raw] ?? raw;
}

function filterByTime(
  workouts: readonly LoggedWorkoutForAnalytics[],
  filter: AnalyticsTimeFilter,
  now: Date,
): LoggedWorkoutForAnalytics[] {
  const sorted = [...workouts].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  if (filter === "all") return sorted;
  if (filter === "last") return sorted.slice(0, 1);
  const days = filter === "week" ? 7 : 30;
  const cutoff = now.getTime() - days * 86_400_000;
  return sorted.filter((w) => new Date(w.date).getTime() >= cutoff);
}

function toDistribution(counts: Map<string, number>, total: number): DistributionSlice[] {
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([name, count]) => ({ name, value: Math.round((count / total) * 100) }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6); // cap slice count so the legend stays readable
}

/** Empty array means "no data in this range" — the caller must render an
 * honest empty state, never a chart of fabricated percentages. */
export function computeMuscleGroupDistribution(
  workouts: readonly LoggedWorkoutForAnalytics[],
  filter: AnalyticsTimeFilter,
  now: Date = new Date(),
): DistributionSlice[] {
  const included = filterByTime(workouts, filter, now);
  const counts = new Map<string, number>();
  let total = 0;
  for (const w of included) {
    for (const we of w.exercises) {
      const groups = we.exercise?.muscleGroupsActivated ?? [];
      for (const g of groups) {
        if (!g) continue;
        const label = muscleGroupLabel(g);
        counts.set(label, (counts.get(label) ?? 0) + 1);
        total += 1;
      }
    }
  }
  return toDistribution(counts, total);
}

export function computeActivityTypeDistribution(
  workouts: readonly LoggedWorkoutForAnalytics[],
  filter: AnalyticsTimeFilter,
  now: Date = new Date(),
): DistributionSlice[] {
  const included = filterByTime(workouts, filter, now);
  const counts = new Map<string, number>();
  let total = 0;
  for (const w of included) {
    for (const we of w.exercises) {
      const raw = we.exercise?.typeOfActivity;
      if (!raw) continue;
      const label = activityTypeLabel(raw);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      total += 1;
    }
  }
  return toDistribution(counts, total);
}
