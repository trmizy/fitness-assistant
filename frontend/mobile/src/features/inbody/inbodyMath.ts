/**
 * CL-14's numbers, kept pure so the screen has no arithmetic in it.
 *
 * Rules taken from the real API rather than the design mock (verified against a live
 * `POST /inbody` on 2026-09-16):
 * - `weight` and `muscleMass` are non-nullable columns. Omitting `muscleMass` does not produce a
 *   validation error — it reaches Prisma and comes back as a raw **500**, so the form must treat it
 *   as required. (`bodyFat` has a real 400 with a helpful message, and is derived below the same
 *   way the server derives it.)
 * - `bodyFat` is a MASS in kg; `bodyFatPct` is the percentage. The server fills in the kg from
 *   `weight × bodyFatPct / 100` when only the percentage is given, rounded to one decimal — done
 *   here too so the review screen shows the number that will be stored.
 * - One entry per user per UTC day: a save on a date that already has an entry updates it.
 *
 * The design's "Điểm cơ thể" (a 0-100 body score) and its "Phân tích AI" card have no backend
 * behind them — no column, no endpoint, and web shows neither — so neither is built. Body water is
 * likewise absent from the model; the metric grid shows what the scan actually stores.
 */

export type InBodyEntry = {
  id: string;
  /** The measurement day (UTC), which is what the server's per-day uniqueness uses. */
  dateOnly: string;
  date: string;
  weight: number;
  muscleMass: number;
  /** Fat mass in kg. */
  bodyFat: number;
  bodyFatPct: number | null;
  height: number | null;
  bmi: number | null;
  bmr: number | null;
  visceralFat: number | null;
  status: string;
  notes: string | null;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const optional = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function normalizeEntry(raw: any): InBodyEntry {
  return {
    id: String(raw?.id ?? ""),
    dateOnly: String(raw?.dateOnly ?? raw?.date ?? "").slice(0, 10),
    date: String(raw?.date ?? ""),
    weight: num(raw?.weight),
    muscleMass: num(raw?.muscleMass),
    bodyFat: num(raw?.bodyFat),
    bodyFatPct: optional(raw?.bodyFatPct),
    height: optional(raw?.height),
    bmi: optional(raw?.bmi),
    bmr: optional(raw?.bmr),
    visceralFat: optional(raw?.visceralFat),
    status: String(raw?.status ?? "manual"),
    notes: raw?.notes ?? null,
  };
}

/** Newest first, by the measurement day — not by when the row was typed in. */
export function normalizeHistory(raw: any): InBodyEntry[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : raw?.data;
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeEntry)
    .sort((a, b) => b.dateOnly.localeCompare(a.dateOnly));
}

/** The server's own derivation, so the review screen shows what will be stored. */
export function deriveBodyFatKg(weight: number, bodyFatPct: number): number {
  return Math.round(num(weight) * (num(bodyFatPct) / 100) * 10) / 10;
}

export type MetricKey = "weight" | "muscleMass" | "bodyFatPct" | "bodyFat" | "bmi" | "bmr" | "visceralFat";

export const METRICS: { key: MetricKey; label: string; unit: string; higherIsBetter: boolean }[] = [
  { key: "weight", label: "Cân nặng", unit: "kg", higherIsBetter: false },
  { key: "muscleMass", label: "Khối cơ", unit: "kg", higherIsBetter: true },
  { key: "bodyFatPct", label: "Mỡ cơ thể", unit: "%", higherIsBetter: false },
  { key: "bodyFat", label: "Khối mỡ", unit: "kg", higherIsBetter: false },
  { key: "bmi", label: "BMI", unit: "", higherIsBetter: false },
  { key: "bmr", label: "BMR", unit: "kcal", higherIsBetter: true },
  { key: "visceralFat", label: "Mỡ nội tạng", unit: "", higherIsBetter: false },
];

export type MetricDelta = {
  value: number | null;
  delta: number | null;
  /** null when there is nothing to compare against, or the change is exactly zero. */
  good: boolean | null;
};

/**
 * One metric's current value and its change. "Good" is per-metric, not per-sign: losing fat and
 * gaining muscle are both progress, and showing both in the same colour is how a screen lies.
 */
export function metricDelta(
  latest: InBodyEntry | null,
  previous: InBodyEntry | null,
  key: MetricKey,
): MetricDelta {
  const higherIsBetter = METRICS.find((m) => m.key === key)?.higherIsBetter ?? true;
  const value = latest ? (latest[key] as number | null) : null;
  const before = previous ? (previous[key] as number | null) : null;
  if (value == null || before == null || latest?.id === previous?.id) {
    return { value: value ?? null, delta: null, good: null };
  }
  const delta = Math.round((value - before) * 10) / 10;
  if (delta === 0) return { value, delta: 0, good: null };
  return { value, delta, good: higherIsBetter ? delta > 0 : delta < 0 };
}

export type EntryForm = {
  date: string;
  weight: string;
  muscleMass: string;
  bodyFatPct: string;
  height: string;
  bmr: string;
  visceralFat: string;
  notes: string;
};

export const EMPTY_FORM: EntryForm = {
  date: "",
  weight: "",
  muscleMass: "",
  bodyFatPct: "",
  height: "",
  bmr: "",
  visceralFat: "",
  notes: "",
};

const toNumber = (value: string): number => Number(String(value).replace(",", ".")) || 0;

export function formErrors(form: EntryForm): Partial<Record<keyof EntryForm, string>> {
  const errors: Partial<Record<keyof EntryForm, string>> = {};
  const weight = toNumber(form.weight);
  const muscle = toNumber(form.muscleMass);
  const pct = toNumber(form.bodyFatPct);

  if (weight <= 0 || weight > 400) errors.weight = "Cân nặng phải trong khoảng 1–400 kg";
  // Required because the server 500s without it, not because the design asks for it.
  if (muscle <= 0) errors.muscleMass = "Cần nhập khối cơ (kg)";
  else if (muscle >= weight && weight > 0) errors.muscleMass = "Khối cơ phải nhỏ hơn cân nặng";
  if (pct <= 0 || pct >= 100) errors.bodyFatPct = "Tỉ lệ mỡ phải trong khoảng 1–99 %";
  if (form.height && (toNumber(form.height) < 80 || toNumber(form.height) > 250)) {
    errors.height = "Chiều cao phải trong khoảng 80–250 cm";
  }
  return errors;
}

/** The body for `POST /inbody`. Empty optional fields are left out rather than sent as 0. */
export function buildEntryPayload(form: EntryForm): Record<string, unknown> {
  const weight = toNumber(form.weight);
  const bodyFatPct = toNumber(form.bodyFatPct);
  const payload: Record<string, unknown> = {
    weight,
    muscleMass: toNumber(form.muscleMass),
    bodyFatPct,
    bodyFat: deriveBodyFatKg(weight, bodyFatPct),
  };
  if (form.date) payload.date = new Date(`${form.date}T00:00:00.000Z`).toISOString();
  if (toNumber(form.height) > 0) payload.height = toNumber(form.height);
  if (toNumber(form.bmr) > 0) payload.bmr = Math.round(toNumber(form.bmr));
  if (toNumber(form.visceralFat) > 0) payload.visceralFat = toNumber(form.visceralFat);
  if (form.notes.trim()) payload.notes = form.notes.trim();
  return payload;
}

/** Fills the form from whatever OCR managed to read; anything it missed stays blank for the user. */
export function formFromExtracted(extracted: any, fallbackDate: string): EntryForm {
  const value = (raw: unknown) => (raw === null || raw === undefined ? "" : String(raw));
  const weight = optional(extracted?.weight);
  const pct = optional(extracted?.bodyFatPct);
  const fatKg = optional(extracted?.bodyFat);
  return {
    date: String(extracted?.date ?? fallbackDate).slice(0, 10) || fallbackDate,
    weight: value(weight ?? ""),
    muscleMass: value(optional(extracted?.muscleMass) ?? ""),
    // Scans print the percentage; when only the kg mass was read, turn it back into a percentage
    // so the one field the form asks for is filled.
    bodyFatPct:
      pct != null
        ? value(pct)
        : fatKg != null && weight
          ? value(Math.round((fatKg / weight) * 1000) / 10)
          : "",
    height: value(optional(extracted?.height) ?? ""),
    bmr: value(optional(extracted?.bmr) ?? ""),
    visceralFat: value(optional(extracted?.visceralFat) ?? ""),
    notes: "",
  };
}
