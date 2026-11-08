import type { ResponseLanguage } from "./types";
import { normalizeExerciseNames } from "./exercise_name_normalizer";

const INTERNAL_LABEL_REPLACEMENTS: Record<string, string> = {
  recomposition: "tái cấu trúc cơ thể",
  strength_retention: "giữ sức mạnh",
  omnivorous: "ăn đa dạng thực phẩm",
  moderate_volume: "khối lượng tập vừa phải",
  confidence: "độ tin cậy",
};

// Whole English assumption sentences produced by the deterministic engines (workout_plan_selector.ts,
// recommendation_engine.ts) reached Vietnamese answers verbatim — and "low-confidence" was half-translated by the
// label pass below into "low-độ tin cậy" (found by test/ai-quality-eval, 2026-11-08: 16/31 baseline answers).
// Translated here, BEFORE the single-word label replacements.
const ENGLISH_SENTENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Assumed (\d+) sessions per week due to missing training frequency\.?/gi, "Tạm tính $1 buổi tập/tuần vì chưa có số buổi tập của bạn."],
  [/No dietary preference provided; using a general mixed-food baseline template\.?/gi, "Chưa có sở thích ăn uống nên dùng mẫu thực phẩm đa dạng cơ bản."],
  [/Nutrition targets are low-confidence because key profile metrics are missing\.?/gi, "Mục tiêu dinh dưỡng chỉ mang tính ước lượng thô vì hồ sơ còn thiếu chỉ số quan trọng."],
];

function sanitizeVietnameseOutput(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of ENGLISH_SENTENCE_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [rawLabel, replacement] of Object.entries(
    INTERNAL_LABEL_REPLACEMENTS,
  )) {
    const regex = new RegExp(rawLabel, "gi");
    sanitized = sanitized.replace(regex, replacement);
  }

  sanitized = sanitized.replace(/missing profile/gi, "thiếu thông tin hồ sơ");
  sanitized = sanitized.replace(/ {2,}/g, " ").trim();
  return sanitized;
}

export const labelLocalizer = {
  localize(text: string, language: ResponseLanguage): string {
    const canonicalized = normalizeExerciseNames(text);
    if (language === "vi") {
      return sanitizeVietnameseOutput(canonicalized);
    }
    return canonicalized;
  },

  localizeMissingFields(
    fields: string[],
    language: ResponseLanguage,
  ): string[] {
    if (language === "en") return fields;

    const map: Record<string, string> = {
      profile: "hồ sơ cơ bản",
      weight: "cân nặng",
      height: "chiều cao",
      age: "tuổi",
      gender: "giới tính",
      goal: "mục tiêu",
      activity_level: "mức độ vận động",
      experience_level: "kinh nghiệm tập",
    };

    return fields.map((field) => map[field] || field);
  },
};
