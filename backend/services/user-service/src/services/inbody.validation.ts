import { z } from "zod";

/**
 * InBody input validation + field whitelist (N13G-01/02/03).
 *
 * - Only the keys in `inbodyFieldsSchema` ever reach the database: `userId`, `id`, `createdAt`, `updatedAt`,
 *   `dateOnly` and any unknown key are stripped (zod default), so a request body can never move an entry to
 *   another user or rewrite its identity/timestamps. The owner comes from the verified token only.
 * - Ranges are plausibility limits for a human body measured on an InBody scale (decided by the owner on
 *   14/11/2026). They reject typos and junk; they are not a medical judgement.
 * - Every failure is a 400 with a Vietnamese message and the stable code INBODY_INVALID_INPUT - never a 500.
 */

export const INBODY_LIMITS = {
  weightKg: { min: 20, max: 400 },
  heightCm: { min: 100, max: 250 },
  bodyFatPct: { min: 2, max: 75 },
  bmr: { min: 500, max: 5000 },
  visceralFat: { min: 1, max: 60 },
  bmi: { min: 8, max: 80 },
  segmentalKg: { min: 0, max: 200 },
  notesMaxLength: 1000,
  earliestDate: new Date("1900-01-01T00:00:00.000Z"),
  // A user in UTC+14 can already be "tomorrow" while the server is still on today's UTC date.
  futureToleranceMs: 14 * 60 * 60 * 1000,
} as const;

export const INBODY_INVALID_INPUT = "INBODY_INVALID_INPUT";

type InBodyHttpError = Error & { status: number; code: string; field?: string };

export function inbodyError(message: string, status: number, code: string, field?: string): InBodyHttpError {
  return Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
}

function bad(message: string, field?: string): InBodyHttpError {
  return inbodyError(message, 400, INBODY_INVALID_INPUT, field);
}

/** A finite JSON number within [min, max]; `null` is treated by the caller (absent / clear). */
function numberField(label: string, min: number, max: number, unit = "", opts: { int?: boolean } = {}) {
  const u = unit ? ` ${unit}` : "";
  let schema = z
    .number({ invalid_type_error: `${label} phải là một số`, required_error: `${label} là bắt buộc` })
    .finite(`${label} phải là một số`);
  if (opts.int) schema = schema.int(`${label} phải là số nguyên`);
  return schema
    .min(min, `${label} phải từ ${min} đến ${max}${u}`)
    .max(max, `${label} phải từ ${min} đến ${max}${u}`);
}

const segmental = (label: string) =>
  numberField(label, INBODY_LIMITS.segmentalKg.min, INBODY_LIMITS.segmentalKg.max, "kg").nullish();

const inbodyFieldsSchema = z.object({
  date: z
    .string({ invalid_type_error: "Ngày đo không hợp lệ", required_error: "Ngày đo là bắt buộc" })
    .nullish(),
  weight: numberField("Cân nặng", INBODY_LIMITS.weightKg.min, INBODY_LIMITS.weightKg.max, "kg").nullish(),
  height: numberField("Chiều cao", INBODY_LIMITS.heightCm.min, INBODY_LIMITS.heightCm.max, "cm").nullish(),
  bmi: numberField("BMI", INBODY_LIMITS.bmi.min, INBODY_LIMITS.bmi.max).nullish(),
  // bodyFat is the fat MASS in kg (see InBodyEntry.bodyFat), bodyFatPct the percentage.
  bodyFat: numberField("Mỡ cơ thể (kg)", 0.1, INBODY_LIMITS.weightKg.max, "kg").nullish(),
  bodyFatPct: numberField("% Mỡ cơ thể", INBODY_LIMITS.bodyFatPct.min, INBODY_LIMITS.bodyFatPct.max, "%").nullish(),
  muscleMass: numberField("Cơ bắp (kg)", 1, INBODY_LIMITS.weightKg.max, "kg").nullish(),
  visceralFat: numberField("Mỡ nội tạng", INBODY_LIMITS.visceralFat.min, INBODY_LIMITS.visceralFat.max).nullish(),
  bmr: numberField("BMR", INBODY_LIMITS.bmr.min, INBODY_LIMITS.bmr.max, "kcal", { int: true }).nullish(),
  rightArmMuscle: segmental("Cơ tay phải"),
  leftArmMuscle: segmental("Cơ tay trái"),
  trunkMuscle: segmental("Cơ thân"),
  rightLegMuscle: segmental("Cơ chân phải"),
  leftLegMuscle: segmental("Cơ chân trái"),
  rightArmFat: segmental("Mỡ tay phải"),
  leftArmFat: segmental("Mỡ tay trái"),
  trunkFat: segmental("Mỡ thân"),
  rightLegFat: segmental("Mỡ chân phải"),
  leftLegFat: segmental("Mỡ chân trái"),
  status: z
    .enum(["manual", "extracted", "pending"], { errorMap: () => ({ message: "Trạng thái bản ghi không hợp lệ" }) })
    .nullish(),
  notes: z
    .string({ invalid_type_error: "Ghi chú không hợp lệ" })
    .max(INBODY_LIMITS.notesMaxLength, `Ghi chú tối đa ${INBODY_LIMITS.notesMaxLength} ký tự`)
    .nullish(),
});

export type InBodyFields = {
  date?: Date;
  weight?: number;
  height?: number | null;
  bmi?: number | null;
  bodyFat?: number;
  bodyFatPct?: number | null;
  muscleMass?: number;
  visceralFat?: number | null;
  bmr?: number | null;
  rightArmMuscle?: number | null;
  leftArmMuscle?: number | null;
  trunkMuscle?: number | null;
  rightLegMuscle?: number | null;
  leftLegMuscle?: number | null;
  rightArmFat?: number | null;
  leftArmFat?: number | null;
  trunkFat?: number | null;
  rightLegFat?: number | null;
  leftLegFat?: number | null;
  status?: string;
  notes?: string | null;
};

/** Columns that are NOT NULL in the table: sending `null` for them is a 400, not "clear". */
const REQUIRED_COLUMNS = ["date", "weight", "bodyFat", "muscleMass", "status"] as const;
const REQUIRED_LABELS: Record<(typeof REQUIRED_COLUMNS)[number], string> = {
  date: "Ngày đo",
  weight: "Cân nặng",
  bodyFat: "Mỡ cơ thể (kg)",
  muscleMass: "Cơ bắp (kg)",
  status: "Trạng thái",
};

function parseMeasuredDate(value: string, now: Date): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad("Ngày đo không hợp lệ", "date");
  if (d.getTime() < INBODY_LIMITS.earliestDate.getTime()) {
    throw bad("Ngày đo không được trước năm 1900", "date");
  }
  if (d.getTime() > now.getTime() + INBODY_LIMITS.futureToleranceMs) {
    throw bad("Ngày đo không được ở tương lai", "date");
  }
  return d;
}

/**
 * Whitelist + validate a request body. `create` keeps `null` meaning "not provided" for every field;
 * `patch` keeps `null` meaning "clear this optional column" (and rejects it for required columns).
 */
export function parseInBodyInput(raw: unknown, mode: "create" | "patch", now: Date = new Date()): InBodyFields {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw bad("Dữ liệu InBody không hợp lệ");
  }
  const parsed = inbodyFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw bad(issue.message, String(issue.path[0] ?? ""));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (value === null) {
      if (mode === "create") continue;
      if ((REQUIRED_COLUMNS as readonly string[]).includes(key)) {
        throw bad(`${REQUIRED_LABELS[key as (typeof REQUIRED_COLUMNS)[number]]} không được để trống`, key);
      }
      out[key] = null;
      continue;
    }
    out[key] = value;
  }
  if (typeof out.date === "string") out.date = parseMeasuredDate(out.date, now);
  return out as InBodyFields;
}

/** Cross-field plausibility on the full (merged) record. */
export function assertInBodyConsistent(record: { weight?: number | null; muscleMass?: number | null; bodyFat?: number | null }) {
  const { weight, muscleMass, bodyFat } = record;
  if (typeof weight === "number" && typeof muscleMass === "number" && muscleMass >= weight) {
    throw bad("Cơ bắp (kg) phải nhỏ hơn cân nặng", "muscleMass");
  }
  if (typeof weight === "number" && typeof bodyFat === "number" && bodyFat >= weight) {
    throw bad("Mỡ cơ thể (kg) phải nhỏ hơn cân nặng", "bodyFat");
  }
}
