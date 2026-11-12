/**
 * Readable labels for profile enums shown to users or placed in prompts the model may quote (Nova Pro recheck 2026-11-12:
 * "Giới tính: FEMALE" in the deterministic routine, "your INTERMEDIATE experience level and MUSCLE_GAIN goal" in an answer).
 * Unknown values are humanised (underscores → spaces, lower-case) instead of passed through raw.
 */
type Lang = "vi" | "en";
const LABELS: Record<string, Record<Lang, string>> = {
  MALE: { vi: "Nam", en: "male" }, FEMALE: { vi: "Nữ", en: "female" }, OTHER: { vi: "Khác", en: "other" },
  WEIGHT_LOSS: { vi: "giảm cân", en: "weight loss" }, FAT_LOSS: { vi: "giảm mỡ", en: "fat loss" },
  MUSCLE_GAIN: { vi: "tăng cơ", en: "muscle gain" }, MAINTENANCE: { vi: "duy trì", en: "maintenance" },
  ATHLETIC_PERFORMANCE: { vi: "nâng cao thành tích thể thao", en: "athletic performance" }, RECOMPOSITION: { vi: "vừa giảm mỡ vừa tăng cơ", en: "body recomposition" },
  BEGINNER: { vi: "mới tập", en: "beginner" }, INTERMEDIATE: { vi: "đã có kinh nghiệm", en: "intermediate" }, ADVANCED: { vi: "nâng cao", en: "advanced" },
  SEDENTARY: { vi: "ít vận động", en: "sedentary" }, LIGHTLY_ACTIVE: { vi: "vận động nhẹ", en: "lightly active" },
  MODERATELY_ACTIVE: { vi: "vận động vừa", en: "moderately active" }, VERY_ACTIVE: { vi: "vận động nhiều", en: "very active" },
  EXTREMELY_ACTIVE: { vi: "vận động rất nhiều", en: "extremely active" },
};

export function enumLabel(value: string | null | undefined, lang: Lang = "vi"): string | undefined {
  if (value == null || value === "") return undefined;
  const key = String(value).toUpperCase();
  return LABELS[key]?.[lang] ?? String(value).replace(/_/g, " ").toLowerCase();
}
