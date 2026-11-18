/**
 * PT application form: pure display/normalisation helpers (kept out of the page so they can be unit-tested).
 *
 * PT-05: the weekly editor keys its day cards with "Mon".."Sun", but a saved draft comes back from the server as "MONDAY".."SUNDAY";
 * after a reload no card matched ("Nghỉ" everywhere) while the hidden blocks were still validated and a raw "MONDAY" showed in an alert.
 * Both spellings map to the editor's key; people read the Vietnamese label.
 */
export const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_LABEL_VI: Record<string, string> = {
  Mon: "Thứ 2", Tue: "Thứ 3", Wed: "Thứ 4", Thu: "Thứ 5", Fri: "Thứ 6", Sat: "Thứ 7", Sun: "Chủ nhật",
};

const DAY_KEY_BY_NAME: Record<string, string> = {
  MON: "Mon", MONDAY: "Mon", TUE: "Tue", TUESDAY: "Tue", WED: "Wed", WEDNESDAY: "Wed", THU: "Thu", THURSDAY: "Thu",
  FRI: "Fri", FRIDAY: "Fri", SAT: "Sat", SATURDAY: "Sat", SUN: "Sun", SUNDAY: "Sun",
};

/** "MONDAY" / "monday" / "Mon" -> "Mon". An unknown value is returned unchanged (never dropped). */
export function normalizeDayKey(v: unknown): string {
  const raw = String(v ?? "").trim();
  return DAY_KEY_BY_NAME[raw.toUpperCase()] ?? raw;
}

/** Vietnamese day name for any spelling of the day; an unknown value is returned as is. */
export function dayLabelVi(v: unknown): string {
  const key = normalizeDayKey(v);
  return DAY_LABEL_VI[key] ?? key;
}

export const CERT_STATUS_LABEL: Record<string, string> = { Valid: "Còn hiệu lực", Expired: "Đã hết hạn", Lifetime: "Vô thời hạn" };
export const certStatusLabel = (v: unknown): string => CERT_STATUS_LABEL[String(v ?? "Valid")] ?? String(v ?? "");

export const EXPERIENCE_LABEL: Record<string, string> = { "<1": "Dưới 1 năm", "1-3": "1 - 3 năm", "3-5": "3 - 5 năm", "5-10": "5 - 10 năm", "10+": "Hơn 10 năm" };
export const experienceLabel = (v: unknown): string => EXPERIENCE_LABEL[String(v ?? "")] ?? String(v ?? "");

/** Blocks as the editor needs them: day keys normalised, everything else kept. */
export function normalizeAvailabilityBlocks<T extends { dayOfWeek?: unknown }>(blocks: T[] | null | undefined): T[] {
  return (blocks ?? []).map((b) => ({ ...b, dayOfWeek: normalizeDayKey(b.dayOfWeek) }));
}
