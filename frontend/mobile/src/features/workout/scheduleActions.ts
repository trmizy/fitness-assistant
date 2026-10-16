import { addDays, parseApiDateOnly, toDateInputValue } from "../../utils/date";

/**
 * 14B.4 (PG-A3) — what a day of the training week offers, mirroring the server's own guards
 * (fitness-service workout.service) so the phone never shows an action certain to be refused:
 * - reschedule: a NOT_STARTED session with no workout, onto today or later;
 * - delete ("Ẩn khỏi lịch"): no workout yet and only TODAY's row (assertScheduleDateEditable) — web
 *   offers it on future rows too and the server rejects those;
 * - add: any date, from a day of the current program (createSchedule has no date lock).
 */

export function canReschedule(schedule: any): boolean {
  return !!schedule?.id && !schedule.workoutId && !schedule.workout?.id && schedule.status === "NOT_STARTED";
}

export function canDeleteSchedule(schedule: any, todayKey: string): boolean {
  if (!schedule?.id || schedule.workoutId || schedule.workout?.id) return false;
  return toDateInputValue(parseApiDateOnly(schedule.date)) === todayKey;
}

/** The next `count` days starting today — reschedule targets (the server refuses the past). */
export function rescheduleTargets(currentKey: string, today: Date, count = 14): { key: string; label: string; weekday: string }[] {
  const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const out: { key: string; label: string; weekday: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = addDays(today, i);
    const key = toDateInputValue(d);
    if (key === currentKey) continue;
    out.push({ key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, weekday: i === 0 ? "Hôm nay" : WEEKDAY[d.getDay()] });
  }
  return out;
}

/** Program days of the current program, for "Thêm lịch tập". */
export function programDayOptions(program: any): { id: string; label: string; exerciseCount: number }[] {
  const days: any[] = Array.isArray(program?.days) ? program.days : [];
  return days
    .filter((d) => d?.id)
    .sort((a, b) => Number(a.dayNumber ?? 0) - Number(b.dayNumber ?? 0))
    .map((d) => ({
      id: String(d.id),
      label: String(d.title || d.name || `Buổi ${d.dayNumber ?? ""}`).trim(),
      exerciseCount: Array.isArray(d.exercises) ? d.exercises.length : 0,
    }));
}

/** The server's Vietnamese/English refusals turned into what web shows. */
export function scheduleErrorMessage(e: any, fallback: string): string {
  if (e?.response?.status === 409 && /already/i.test(String(e?.response?.data?.error ?? ""))) return "Ngày này đã có lịch tập.";
  const raw = e?.response?.data?.error;
  if (typeof raw === "string") {
    if (/past/i.test(raw)) return "Không thể dời sang một ngày đã qua.";
    if (/not-yet-started/i.test(raw)) return "Chỉ dời được buổi chưa bắt đầu.";
    return raw;
  }
  return fallback;
}
