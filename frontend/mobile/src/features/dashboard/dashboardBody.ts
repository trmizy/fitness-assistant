import { inBodyDateKey } from "../../utils/date";

/**
 * 14B.7 (PG-C1) — the pieces web's ClientDashboard shows that mobile's home did not: weight/muscle
 * trend lines, the active program card, recent workouts and the 30-day session count. Pure, so the
 * screen stays thin and these can be unit-tested.
 */

export type TrendPoint = { key: string; label: string; value: number };

/** Oldest → newest values of one InBody field, skipping missing/zero readings; last `max` only. */
export function bodySeries(history: unknown, field: "weight" | "muscleMass" | "bodyFatPct", max = 12): TrendPoint[] {
  const rows = Array.isArray(history) ? history : [];
  return rows
    // Stored values carry float noise (98.60000000000001) — one decimal, like the InBody sheet.
    .map((h: any) => ({ key: inBodyDateKey(h), value: round(Number(h?.[field])) }))
    .filter((p) => p.key !== "9999-12-31" && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-max)
    .map((p) => ({ ...p, label: `${p.key.slice(8, 10)}/${p.key.slice(5, 7)}` }));
}

/** SVG `points` for a polyline filling `width × height` with `pad` inset; a flat series sits mid-height. */
export function sparklinePoints(values: number[], width: number, height: number, pad = 4): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return values
    .map((v, i) => {
      const x = pad + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
      const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * innerH;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

/** "+1.2 kg" / "-0.4 kg" between the last two points, or null with fewer than two. */
export function seriesDelta(points: TrendPoint[], unit: string): { text: string; diff: number } | null {
  if (points.length < 2) return null;
  const diff = points[points.length - 1].value - points[points.length - 2].value;
  return { text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${unit}`, diff };
}

/** Web "Kế hoạch đang dùng": name, day count (falls back to daysPerWeek) and total exercises. */
export function programSummary(program: any): { name: string; days: number | null; exercises: number } | null {
  if (!program || typeof program !== "object") return null;
  const days = Array.isArray(program.days) ? program.days : [];
  const exercises = days.reduce((n: number, d: any) => n + (Array.isArray(d?.exercises) ? d.exercises.length : 0), 0);
  const dayCount = days.length || (Number(program.daysPerWeek) > 0 ? Number(program.daysPerWeek) : null);
  return { name: String(program.name || "Chương trình tập hiện tại"), days: dayCount, exercises };
}

export type RecentWorkout = { id: string; name: string; date: string; minutes: number | null; exercises: number };

/**
 * `GET /workouts` rows. The fitness-service `Workout` model is `name` + `duration` (minutes) — web's
 * dashboard reads `title`/`durationMinutes`, which do not exist, so it always prints "Buổi tập · --
 * phút". Read the real fields (title kept only as a fallback).
 */
export function recentWorkouts(data: unknown, max = 4): RecentWorkout[] {
  const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
  return rows.slice(0, max).map((w: any, i: number) => ({
    id: String(w?.id ?? i),
    name: String(w?.name || w?.title || "Buổi tập"),
    date: String(w?.date ?? ""),
    minutes: Number(w?.duration) > 0 ? Number(w.duration) : null,
    exercises: Array.isArray(w?.exercises) ? w.exercises.length : 0,
  }));
}

/** "05/10/2026" for a workout's date. */
export function workoutDateLabel(value: string): string {
  if (!value) return "—";
  // Same as web (`new Date(w.date)` in local time): a schedule-linked workout is stored at UTC midnight
  // of its day, an ad-hoc one at the moment it was logged — local time is right for both.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
