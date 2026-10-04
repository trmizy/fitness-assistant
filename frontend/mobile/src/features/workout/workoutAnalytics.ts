/**
 * 14B.4 (PG-C2) — web `workout-analytics.utils.ts` ("Phân bổ nhóm cơ", "Phân bổ loại bài tập") and the
 * weight-journey numbers of web's "Chỉ số cơ thể" block. Computed from real logged workouts and the
 * profile / InBody rows — an empty result is an honest "no data", never a placeholder chart.
 *
 * One deliberate difference from web: the catalog stores some `muscleGroupsActivated` entries as one
 * comma-joined string ("Pectorals, Triceps, Deltoids"); web counts that string as a single muscle
 * group, here it is split into its muscles before counting.
 */

export type AnalyticsTimeFilter = "last" | "week" | "month" | "all";

export interface DistributionSlice {
  name: string;
  value: number;
}

const MUSCLE_GROUP_LABELS: Record<string, string> = {
  chest: "Ngực",
  pectorals: "Ngực",
  back: "Lưng",
  shoulders: "Vai",
  deltoids: "Vai",
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
  "latissimus dorsi": "Xô",
  traps: "Cầu vai",
  trapezius: "Cầu vai",
  forearms: "Cẳng tay",
  neck: "Cổ",
  "hip flexors": "Cơ gập hông",
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

const muscleLabel = (raw: string) => MUSCLE_GROUP_LABELS[raw.trim().toLowerCase()] ?? raw.trim();

function filterByTime(workouts: readonly any[], filter: AnalyticsTimeFilter, now: Date): any[] {
  const sorted = [...workouts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (filter === "all") return sorted;
  if (filter === "last") return sorted.slice(0, 1);
  const cutoff = now.getTime() - (filter === "week" ? 7 : 30) * 86_400_000;
  return sorted.filter((w) => new Date(w.date).getTime() >= cutoff);
}

function toDistribution(counts: Map<string, number>, total: number): DistributionSlice[] {
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([name, count]) => ({ name, value: Math.round((count / total) * 100) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

export function computeMuscleGroupDistribution(workouts: readonly any[], filter: AnalyticsTimeFilter, now = new Date()): DistributionSlice[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const w of filterByTime(workouts, filter, now)) {
    for (const we of Array.isArray(w?.exercises) ? w.exercises : []) {
      const groups: string[] = Array.isArray(we?.exercise?.muscleGroupsActivated) ? we.exercise.muscleGroupsActivated : [];
      for (const entry of groups) {
        for (const part of String(entry ?? "").split(",")) {
          if (!part.trim()) continue;
          const label = muscleLabel(part);
          counts.set(label, (counts.get(label) ?? 0) + 1);
          total += 1;
        }
      }
    }
  }
  return toDistribution(counts, total);
}

export function computeActivityTypeDistribution(workouts: readonly any[], filter: AnalyticsTimeFilter, now = new Date()): DistributionSlice[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const w of filterByTime(workouts, filter, now)) {
    for (const we of Array.isArray(w?.exercises) ? w.exercises : []) {
      const raw = we?.exercise?.typeOfActivity;
      if (!raw) continue;
      const label = ACTIVITY_TYPE_LABELS[raw] ?? raw;
      counts.set(label, (counts.get(label) ?? 0) + 1);
      total += 1;
    }
  }
  return toDistribution(counts, total);
}

/**
 * Web's weight journey: starting weight is the profile's immutable journey-start snapshot; current is
 * the latest InBody weight, else the profile's; remaining needs a target. Null when there is no start
 * or current weight (web hides the block then).
 */
export function weightJourney(profile: any, latestInBodyWeight: number | null | undefined) {
  const start = profile?.startingWeight != null ? Number(profile.startingWeight) : null;
  const current = latestInBodyWeight != null ? Number(latestInBodyWeight) : profile?.currentWeight != null ? Number(profile.currentWeight) : null;
  const target = profile?.targetWeight != null ? Number(profile.targetWeight) : null;
  if (start == null || current == null) return null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const changed = r1(start - current);
  const remaining = target != null ? r1(current - target) : null;
  return {
    start,
    current,
    target,
    changedText: `${changed > 0 ? "−" : changed < 0 ? "+" : ""}${Math.abs(changed)} kg`,
    remainingText: remaining == null ? "Chưa đặt mục tiêu" : remaining === 0 ? "Đã đạt mục tiêu" : `${Math.abs(remaining)} kg`,
  };
}
