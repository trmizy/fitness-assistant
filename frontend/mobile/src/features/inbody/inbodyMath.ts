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
  /** Segmental lean/fat analysis, printed on a real InBody sheet. Null when it was never entered. */
  segmental: Record<SegmentField, number | null>;
};

export type SegmentSide = "rightArm" | "leftArm" | "trunk" | "rightLeg" | "leftLeg";
export type SegmentField =
  | "rightArmMuscle" | "leftArmMuscle" | "trunkMuscle" | "rightLegMuscle" | "leftLegMuscle"
  | "rightArmFat" | "leftArmFat" | "trunkFat" | "rightLegFat" | "leftLegFat";

export const SEGMENT_SIDES: { key: SegmentSide; label: string; norm: "arm" | "trunk" | "leg" }[] = [
  { key: "rightArm", label: "Tay P", norm: "arm" },
  { key: "leftArm", label: "Tay T", norm: "arm" },
  { key: "trunk", label: "Thân", norm: "trunk" },
  { key: "rightLeg", label: "Chân P", norm: "leg" },
  { key: "leftLeg", label: "Chân T", norm: "leg" },
];

/** Web's reference values, kept identical so both clients call the same body "normal". */
export const SEGMENT_NORMS = {
  muscle: { arm: 3.2, trunk: 24.0, leg: 9.5 },
  fat: { arm: 1.0, trunk: 8.0, leg: 2.3 },
} as const;

export const SEGMENT_FIELDS: SegmentField[] = [
  "rightArmMuscle", "leftArmMuscle", "trunkMuscle", "rightLegMuscle", "leftLegMuscle",
  "rightArmFat", "leftArmFat", "trunkFat", "rightLegFat", "leftLegFat",
];

export type SegmentVerdict = { pct: number | null; label: "Thấp" | "Bình thường" | "Cao" | "—" };

/**
 * Where one segment sits against its reference, with web's own thresholds (<90% low, >110% high).
 * The words are Vietnamese here where web prints Under/Normal/Over — same rule, readable audience.
 */
export function segmentVerdict(value: number | null, norm: number): SegmentVerdict {
  if (value == null || !norm) return { pct: null, label: "—" };
  const pct = Math.round((value / norm) * 100);
  return { pct, label: pct < 90 ? "Thấp" : pct > 110 ? "Cao" : "Bình thường" };
}

/** True when the sheet actually carried segmental numbers — most manual entries do not. */
export function hasSegmental(entry: InBodyEntry | null, kind: "muscle" | "fat"): boolean {
  if (!entry) return false;
  return SEGMENT_SIDES.some((side) => entry.segmental[`${side.key}${kind === "muscle" ? "Muscle" : "Fat"}` as SegmentField] != null);
}

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
    segmental: SEGMENT_FIELDS.reduce(
      (acc, field) => ({ ...acc, [field]: optional(raw?.[field]) }),
      {} as Record<SegmentField, number | null>,
    ),
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
} & Record<SegmentField, string>;

const EMPTY_SEGMENTS = SEGMENT_FIELDS.reduce(
  (acc, field) => ({ ...acc, [field]: "" }),
  {} as Record<SegmentField, string>,
);

export const EMPTY_FORM: EntryForm = {
  date: "",
  weight: "",
  muscleMass: "",
  bodyFatPct: "",
  height: "",
  bmr: "",
  visceralFat: "",
  notes: "",
  ...EMPTY_SEGMENTS,
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
  // Segmental values are optional: a printout carries them, a bathroom scale does not.
  for (const field of SEGMENT_FIELDS) {
    if (toNumber(form[field]) > 0) payload[field] = toNumber(form[field]);
  }
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
    // OCR reads the segmental table off a real sheet too, so carry whatever it found.
    ...SEGMENT_FIELDS.reduce(
      (acc, field) => ({ ...acc, [field]: value(optional(extracted?.[field]) ?? "") }),
      {} as Record<SegmentField, string>,
    ),
  };
}
