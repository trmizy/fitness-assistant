/** Current PTAvailability rows, never the historical PTApplication availability snapshot. */
export const PT_WEEKDAYS = [
  { key: "MONDAY", label: "Thứ 2", short: "T2" },
  { key: "TUESDAY", label: "Thứ 3", short: "T3" },
  { key: "WEDNESDAY", label: "Thứ 4", short: "T4" },
  { key: "THURSDAY", label: "Thứ 5", short: "T5" },
  { key: "FRIDAY", label: "Thứ 6", short: "T6" },
  { key: "SATURDAY", label: "Thứ 7", short: "T7" },
  { key: "SUNDAY", label: "Chủ nhật", short: "CN" },
] as const;

export type PtWeekday = (typeof PT_WEEKDAYS)[number]["key"];
export type PtTimeRange = { startTime: string; endTime: string };

export function groupCurrentPtAvailability(raw: unknown): Array<{
  day: PtWeekday;
  label: string;
  short: string;
  ranges: PtTimeRange[];
}> {
  const rows = Array.isArray(raw) ? raw : [];
  return PT_WEEKDAYS.map(({ key, label, short }) => ({
    day: key,
    label,
    short,
    ranges: rows
      .filter((row) => row && row.dayOfWeek === key && row.isActive !== false)
      .map((row) => ({ startTime: String(row.startTime ?? ""), endTime: String(row.endTime ?? "") }))
      .filter((range) => /^([01]\d|2[0-3]):[0-5]\d$/.test(range.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(range.endTime) && range.startTime < range.endTime)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));
}
