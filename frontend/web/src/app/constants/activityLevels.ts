// One shared description per UserProfile.activityLevel, so the onboarding, roadmap wizard and profile pages stop
// describing the same enum differently (before 2026-11-08 one said "Tập 6-7 buổi/tuần" for VERY_ACTIVE, another
// "Công việc/sinh hoạt đòi hỏi thể lực"). The factor is the one fitness-service multiplies BMR by
// (config/cycle-thresholds.config.ts → nutritionBootstrap.activityMultiplier). Each hint counts the job AND the
// training together, because that is what the factor covers: a desk job plus 3-5 gym sessions is MODERATELY_ACTIVE
// (×1.55), not EXTREMELY_ACTIVE (×1.9, heavy manual labour or twice-daily training).
export type ActivityLevelKey =
  | "SEDENTARY"
  | "LIGHTLY_ACTIVE"
  | "MODERATELY_ACTIVE"
  | "VERY_ACTIVE"
  | "EXTREMELY_ACTIVE";

export const ACTIVITY_LEVELS: Array<{ key: ActivityLevelKey; label: string; hint: string; factor: number }> = [
  { key: "SEDENTARY", label: "Ít vận động", hint: "Làm việc ngồi, đi lại ít, gần như không tập", factor: 1.2 },
  { key: "LIGHTLY_ACTIVE", label: "Vận động nhẹ", hint: "Làm việc ngồi + tập 1–3 buổi/tuần, hoặc đi bộ nhiều trong ngày", factor: 1.375 },
  { key: "MODERATELY_ACTIVE", label: "Vận động vừa", hint: "Làm việc ngồi + tập 3–5 buổi/tuần (phần lớn người tập gym)", factor: 1.55 },
  { key: "VERY_ACTIVE", label: "Năng động", hint: "Tập nặng 6–7 buổi/tuần, hoặc công việc đứng/đi lại cả ngày kèm tập", factor: 1.725 },
  { key: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động", hint: "Lao động chân tay nặng cả ngày, hoặc tập 2 buổi/ngày (vận động viên)", factor: 1.9 },
];

export function activityLevelInfo(key: string | null | undefined) {
  return ACTIVITY_LEVELS.find((a) => a.key === key) ?? null;
}
