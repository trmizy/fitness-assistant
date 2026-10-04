/**
 * 14B.2 (PG-A6) — the plan a coach builds in one place and sends two ways: as a 1-1 order's draft
 * (`personalizedServiceApi.deliverDraft`, PT-09) or assigned straight to a student
 * (`ptCoachService.createAndAssignPlan`, web `AssignPlanModal`). Both endpoints take the same
 * manual-program body, so the builder and these rules are shared.
 */

export type DraftEx = { exerciseId: string; name: string; sets: number; reps: number; restSeconds: number };
export type DraftDay = { dayNumber: number; title: string; weekday: number; exercises: DraftEx[] };

/** 0 = Chủ nhật — the backend's getUTCDay convention for `selectedWeekdays`. */
export const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const emptyDay = (dayNumber: number, weekday: number): DraftDay => ({
  dayNumber,
  title: `Buổi ${dayNumber}`,
  weekday,
  exercises: [],
});

/** First weekday (Monday first) no other day uses yet. */
export function nextFreeWeekday(days: DraftDay[]): number {
  const used = new Set(days.map((d) => d.weekday));
  return WEEKDAY_ORDER.find((w) => !used.has(w)) ?? 0;
}

/** Removing a day renumbers the rest so dayNumber stays 1..n (the server requires it). */
export function removeDayAt(days: DraftDay[], index: number): DraftDay[] {
  if (days.length <= 1) return days;
  return days.filter((_, i) => i !== index).map((d, i) => ({ ...d, dayNumber: i + 1, title: d.title }));
}

/** The rules both endpoints enforce, checked before sending (web throws the same messages). */
export function planDraftError(name: string, days: DraftDay[]): string | null {
  if (!name.trim()) return "Đặt tên cho kế hoạch.";
  if (days.some((d) => d.exercises.length === 0)) return "Mỗi buổi cần ít nhất một bài tập.";
  if (new Set(days.map((d) => d.weekday)).size !== days.length) return "Mỗi buổi phải chọn một ngày trong tuần khác nhau.";
  return null;
}

export interface PlanDraftPayload {
  name: string;
  goal?: string;
  durationWeeks: number;
  daysPerWeek: number;
  startDate: string;
  selectedWeekdays: number[];
  days: {
    dayNumber: number;
    title: string;
    exercises: { exerciseId: string; order: number; sets: number; reps: number; restSeconds: number }[];
  }[];
}

export function planDraftPayload(input: {
  name: string;
  goal?: string | null;
  durationWeeks: string | number;
  defaultWeeks: number;
  startDate: string;
  days: DraftDay[];
}): PlanDraftPayload {
  const weeks = Math.min(52, Math.max(1, Number(input.durationWeeks) || input.defaultWeeks));
  return {
    name: input.name.trim(),
    goal: input.goal?.trim() || undefined,
    durationWeeks: weeks,
    daysPerWeek: input.days.length,
    startDate: input.startDate,
    selectedWeekdays: input.days.map((d) => d.weekday),
    days: input.days.map((d) => ({
      dayNumber: d.dayNumber,
      title: d.title.trim() || `Buổi ${d.dayNumber}`,
      // 1-based: the manual-program schema requires order >= 1 (web hit the 0-based bug, TC-PT-006).
      exercises: d.exercises.map((e, i) => ({ exerciseId: e.exerciseId, order: i + 1, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds })),
    })),
  };
}

/** The AI draft fills the days; weekdays already chosen are kept where the day still exists. */
export function daysFromAiDraft(
  prev: DraftDay[],
  aiDays: { dayNumber?: number; title?: string; exercises?: { exerciseId: string; exerciseName?: string; sets?: number; reps?: number }[] }[],
): DraftDay[] {
  const out: DraftDay[] = [];
  aiDays.forEach((d, i) => {
    const used = new Set(out.map((x) => x.weekday));
    const kept = prev[i]?.weekday;
    const weekday = kept != null && !used.has(kept) ? kept : (WEEKDAY_ORDER.find((w) => !used.has(w)) ?? 0);
    out.push({
      dayNumber: i + 1,
      title: d.title || `Buổi ${i + 1}`,
      weekday,
      exercises: (d.exercises ?? []).map((e) => ({
        exerciseId: e.exerciseId,
        name: e.exerciseName ?? "Bài tập",
        sets: e.sets ?? 3,
        reps: e.reps ?? 10,
        restSeconds: 90,
      })),
    });
  });
  return out;
}
