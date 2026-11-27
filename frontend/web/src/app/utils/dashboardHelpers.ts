// Date + goal helpers shared by the Client dashboards (moved verbatim from ClientDashboard.tsx).

export function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseApiDateOnly(value: string | Date) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function formatScheduleDate(value: string) {
  return parseApiDateOnly(value).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Extract a stable YYYY-MM-DD sort key from an InBody record.
 * Priority: dateOnly → date → createdAt
 * Also handles DD/MM/YYYY format that can come from manual entry or OCR.
 * Invalid/missing dates return "9999-12-31" so they sort to the END (not the start).
 */
export function inBodyDateKey(record: any): string {
  const raw = record?.dateOnly ?? record?.date ?? record?.createdAt;
  const s = raw ? String(raw) : "";
  // ISO format YYYY-MM-DD (or YYYY-MM-DDTHH:mm...)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  // DD/MM/YYYY (from OCR or manual input)
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  // DD-MM-YYYY
  const dmy2 = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy2) return `${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return "9999-12-31";
}

export function parseInBodyMeasurementDate(record: any): Date {
  const key = inBodyDateKey(record);
  if (key === "9999-12-31") return new Date(NaN);
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const goalLabels: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Nâng cao thể lực", // aligned with utils/labels.vi.ts GOAL_VI (was "Cải thiện sức khỏe")
};
