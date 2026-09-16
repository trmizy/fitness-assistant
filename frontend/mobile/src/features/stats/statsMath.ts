/**
 * CL-15's pure parts: the activity grid, the muscle heat list, and which metric a given exercise is
 * even measured by.
 *
 * The metric table is web's, verbatim in meaning: an exercise logged by reps has no 1RM to plot, and
 * a distance exercise's pace gets *better* as the number falls. Plotting the wrong field, or reading
 * every series as "up is good", is the easiest way for a progress chart to lie.
 */

export type ActivityState = "completed" | "partial" | "missed" | "rescheduled" | "rest";

export const ACTIVITY_STATES: { key: ActivityState; label: string; color: string }[] = [
  { key: "completed", label: "Hoàn thành", color: "#22c55e" },
  { key: "partial", label: "Một phần", color: "#16a34a" },
  { key: "missed", label: "Bỏ lỡ", color: "#ef4444" },
  { key: "rescheduled", label: "Dời lịch", color: "#f59e0b" },
  { key: "rest", label: "Nghỉ", color: "#1b1f1d" },
];

const STATE_COLOR = new Map(ACTIVITY_STATES.map((s) => [s.key, s.color]));

/** A day with no record at all is drawn like a rest day but is NOT counted as one. */
export const NO_DATA_COLOR = "#131614";

export function activityColor(state: ActivityState | null): string {
  if (!state) return NO_DATA_COLOR;
  return STATE_COLOR.get(state) ?? NO_DATA_COLOR;
}

export type ActivityDay = { date: string; state: ActivityState | null };

/**
 * Columns of seven, each column a week starting Monday — the shape the design's grid draws and the
 * one a Vietnamese week reads in. The first column is padded with nulls so the weekday rows line up
 * instead of the month sliding a day per row.
 */
export function buildActivityWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  if (days.length === 0) return [];
  const first = new Date(`${days[0].date}T00:00:00.000Z`);
  // getUTCDay: 0 = Sunday. Monday-first offset.
  const pad = (first.getUTCDay() + 6) % 7;
  const cells: (ActivityDay | null)[] = [...Array(pad).fill(null), ...days];
  const weeks: (ActivityDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

export function activityCounts(days: ActivityDay[]): Record<ActivityState, number> {
  const counts: Record<ActivityState, number> = {
    completed: 0,
    partial: 0,
    missed: 0,
    rescheduled: 0,
    rest: 0,
  };
  for (const day of days) if (day.state) counts[day.state] += 1;
  return counts;
}

export type ExerciseLoggingMode = "REPS_LOAD" | "BODYWEIGHT_REPS" | "TIME" | "TIME_LOAD" | "DISTANCE_TIME";

export type ProgressMetric = {
  id: string;
  title: string;
  dataKey: string;
  unit: string;
  /** Pace is the one series where a smaller number is a better one. */
  lowerIsBetter?: boolean;
  note?: string;
};

/** Web's own table, same fields and same order. */
export const METRICS_BY_MODE: Record<ExerciseLoggingMode, ProgressMetric[]> = {
  REPS_LOAD: [
    { id: "weight", title: "Khối lượng nặng nhất mỗi buổi", dataKey: "maxWeightKg", unit: "kg" },
    { id: "reps", title: "Số lần lặp nhiều nhất mỗi buổi", dataKey: "maxReps", unit: "reps" },
    { id: "e1rm", title: "Ước tính 1RM (set tốt nhất)", dataKey: "bestEstimated1RmKg", unit: "kg" },
  ],
  BODYWEIGHT_REPS: [
    { id: "bw-reps", title: "Số lần lặp (trọng lượng cơ thể)", dataKey: "maxReps", unit: "reps" },
  ],
  TIME: [
    { id: "duration", title: "Thời gian giữ lâu nhất", dataKey: "maxDurationSeconds", unit: "giây" },
  ],
  TIME_LOAD: [
    { id: "weight", title: "Khối lượng nặng nhất mỗi buổi", dataKey: "maxWeightKg", unit: "kg" },
    { id: "duration", title: "Thời gian giữ lâu nhất", dataKey: "maxDurationSeconds", unit: "giây" },
  ],
  DISTANCE_TIME: [
    { id: "distance", title: "Quãng đường xa nhất", dataKey: "maxDistanceMeters", unit: "m" },
    {
      id: "pace",
      title: "Tốc độ tốt nhất",
      dataKey: "bestPaceSecPerKm",
      unit: "giây/km",
      lowerIsBetter: true,
      note: "Thấp hơn là nhanh hơn",
    },
  ],
};

export const MODE_LABELS: Record<ExerciseLoggingMode, string> = {
  REPS_LOAD: "Có tạ + số lần",
  BODYWEIGHT_REPS: "Trọng lượng cơ thể",
  TIME: "Tính giờ",
  TIME_LOAD: "Tính giờ có tạ",
  DISTANCE_TIME: "Quãng đường/thời gian",
};

export function metricsFor(mode: string | undefined): ProgressMetric[] {
  return METRICS_BY_MODE[(mode as ExerciseLoggingMode) ?? "REPS_LOAD"] ?? METRICS_BY_MODE.REPS_LOAD;
}

export type SeriesPoint = { date: string; value: number };

/**
 * Sessions where the metric was not recorded are dropped, not plotted as zero.
 *
 * The null check is explicit because `Number(null)` is 0, which is finite — the first version of
 * this function happily plotted "not measured" as a zero-weight session, and its own test caught it.
 */
export function seriesFor(sessions: any, dataKey: string): SeriesPoint[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((session) => session?.[dataKey] !== null && session?.[dataKey] !== undefined)
    .map((session) => ({ date: String(session?.date ?? "").slice(0, 10), value: Number(session[dataKey]) }))
    .filter((point) => point.date && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type SeriesSummary = {
  first: number;
  last: number;
  best: number;
  delta: number;
  improved: boolean | null;
};

/** "Improved" follows the metric, not the sign: a faster pace is a smaller number. */
export function summarize(points: SeriesPoint[], lowerIsBetter = false): SeriesSummary | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const first = values[0];
  const last = values[values.length - 1];
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  const delta = Math.round((last - first) * 10) / 10;
  return {
    first,
    last,
    best,
    delta,
    improved: points.length < 2 || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0,
  };
}

/** Bar heights for a chart drawn by hand: a flat series should read as flat, not as full-height. */
export function barHeights(points: SeriesPoint[], floorPct = 12): number[] {
  if (points.length === 0) return [];
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return values.map(() => 60);
  return values.map((value) => floorPct + ((value - min) / (max - min)) * (100 - floorPct));
}

export type MuscleEntry = { muscleId: string; code: string; nameVi: string; score: number; intensity: number };

/** Hottest first — the list answers "what did I actually train", so the answer goes on top. */
export function sortMuscles(raw: any): MuscleEntry[] {
  const list = Array.isArray(raw?.muscles) ? raw.muscles : Array.isArray(raw) ? raw : [];
  return list
    .map((m: any) => ({
      muscleId: String(m?.muscleId ?? m?.code ?? ""),
      code: String(m?.code ?? ""),
      nameVi: String(m?.nameVi ?? m?.code ?? "Nhóm cơ"),
      score: Number(m?.score) || 0,
      intensity: Number(m?.intensity) || 0,
    }))
    .sort((a: MuscleEntry, b: MuscleEntry) => b.intensity - a.intensity);
}

/** The design's four heat steps, kept as its own thresholds. */
export function muscleColor(intensity: number): string {
  if (intensity >= 0.75) return "#22c55e";
  if (intensity >= 0.5) return "#16a34a";
  if (intensity >= 0.3) return "#f59e0b";
  return "#3f3f46";
}
