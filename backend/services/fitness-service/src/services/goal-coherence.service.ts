/**
 * Goal coherence — reports where the user's goals disagree with each other (derived on read, nothing stored).
 * docs/goal-coherence/GOAL_COHERENCE_AUDIT_AND_DESIGN_20261121.md §3.2.
 *
 * It only DETECTS and offers actions; it never edits the profile, the roadmap or a nutrition goal. Each action is
 * executed by the client through the existing, authorised endpoint after the user confirms ("ask, then sync").
 * Owners are unchanged: UserProfile = stated intent, FitnessRoadmap/RoadmapPhase = the journey, NutritionGoal = the
 * calorie prescription. The maintenance figure used for the calorie-direction check is ESTIMATED, so copy says "khoảng".
 */
import { prisma } from "../repositories/prisma";
import { nutritionRepository } from "../repositories/nutrition.repository";
import { fetchUserProfile } from "../clients/user.client";
import { resolveEffectiveGoal, type EffectiveGoal } from "./effective-goal.service";
import { detectGoalTargetWeightConflict } from "./nutrition-bootstrap-screening";
import { computeRecommendedNutritionTargetForUser } from "./nutrition-onboarding-bootstrap.service";

const GOAL_LABEL: Record<string, string> = {
  WEIGHT_LOSS: "giảm mỡ",
  MUSCLE_GAIN: "tăng cơ",
  MAINTENANCE: "duy trì vóc dáng",
  ATHLETIC_PERFORMANCE: "hiệu suất thể thao",
};
const label = (goal: string | null | undefined) => (goal ? GOAL_LABEL[goal] ?? goal : "chưa đặt");
const isKnownGoal = (goal: unknown): goal is string => typeof goal === "string" && goal in GOAL_LABEL;

/** Active calories this far from the estimated maintenance still count as "no clear direction". */
const NEUTRAL_BAND = 0.03;

export type CoherenceActionKey = "SET_PROFILE_GOAL" | "END_ROADMAP" | "OPEN_PROFILE" | "OPEN_NUTRITION";
export interface CoherenceAction {
  key: CoherenceActionKey;
  label: string;
  /** SET_PROFILE_GOAL: the Goal to write to the profile */
  value?: string;
}
export interface GoalConflict {
  code: "PROFILE_VS_ROADMAP" | "GOAL_VS_TARGET_WEIGHT" | "NUTRITION_DIRECTION";
  title: string;
  detail: string;
  actions: CoherenceAction[];
}
export interface GoalCoherence {
  coherent: boolean;
  /** the ACTIVE roadmap the conflicts refer to, for END_ROADMAP */
  roadmapId: string | null;
  profileGoal: string | null;
  roadmapGoal: string | null;
  effectiveGoal: Pick<EffectiveGoal, "goal" | "source" | "phaseType">;
  conflicts: GoalConflict[];
}

export async function getGoalCoherence(userId: string): Promise<GoalCoherence> {
  const [profile, roadmap] = await Promise.all([
    fetchUserProfile(userId).catch(() => null),
    prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      select: { id: true, goalType: true },
    }),
  ]);
  const profileGoal = isKnownGoal(profile?.goal) ? (profile!.goal as string) : null;
  const roadmapGoal = roadmap && isKnownGoal(roadmap.goalType) ? roadmap.goalType : null;
  const effective = await resolveEffectiveGoal(userId, profileGoal);
  const conflicts: GoalConflict[] = [];

  // 1. The profile says one thing, the running roadmap another.
  if (roadmap && profileGoal && roadmapGoal && profileGoal !== roadmapGoal) {
    conflicts.push({
      code: "PROFILE_VS_ROADMAP",
      title: "Mục tiêu hồ sơ và lộ trình chưa khớp",
      detail: `Hồ sơ của bạn đang là "${label(profileGoal)}", còn lộ trình đang chạy theo "${label(roadmapGoal)}". Gymini đang tính dinh dưỡng và đánh giá chu kỳ theo lộ trình. Hãy chọn một hướng để mọi nơi cùng một mục tiêu.`,
      actions: [
        { key: "SET_PROFILE_GOAL", label: `Đặt mục tiêu hồ sơ là ${label(roadmapGoal)}`, value: roadmapGoal },
        { key: "END_ROADMAP", label: "Kết thúc lộ trình để làm lại" },
      ],
    });
  }

  // 2. The goal contradicts the target weight (profile goal when there is no roadmap, otherwise the roadmap's).
  const goalForTarget = roadmapGoal ?? profileGoal;
  const targetConflict = detectGoalTargetWeightConflict(
    profile ? { ...profile, goal: goalForTarget } : null,
  );
  if (targetConflict) {
    const below = targetConflict.targetWeight < targetConflict.currentWeight;
    conflicts.push({
      code: "GOAL_VS_TARGET_WEIGHT",
      title: "Cân nặng mong muốn đi ngược mục tiêu",
      detail: `Mục tiêu "${label(targetConflict.goal)}" nhưng cân nặng mong muốn ${targetConflict.targetWeight} kg ${below ? "thấp hơn" : "cao hơn"} cân nặng hiện tại ${targetConflict.currentWeight} kg.`,
      actions: [{ key: "OPEN_PROFILE", label: "Sửa cân nặng mong muốn" }],
    });
  }

  // 3. The active calorie prescription pushes the opposite way from the effective goal.
  const activeGoal = await nutritionRepository.findGoalByUserId(userId);
  if (activeGoal && (effective.goal === "WEIGHT_LOSS" || effective.goal === "MUSCLE_GAIN")) {
    const recommended = await computeRecommendedNutritionTargetForUser(userId).catch(() => null);
    const maintenance = recommended && recommended.status === "COMPUTED" ? recommended.estimate?.maintenanceCalories : undefined;
    if (typeof maintenance === "number" && maintenance > 0) {
      const surplus = activeGoal.calories > maintenance * (1 + NEUTRAL_BAND);
      const deficit = activeGoal.calories < maintenance * (1 - NEUTRAL_BAND);
      if ((effective.goal === "WEIGHT_LOSS" && surplus) || (effective.goal === "MUSCLE_GAIN" && deficit)) {
        conflicts.push({
          code: "NUTRITION_DIRECTION",
          title: "Mục tiêu dinh dưỡng đi ngược hướng",
          detail: `Bạn đang ở hướng "${label(effective.goal)}" nhưng mục tiêu dinh dưỡng đang đặt ${Math.round(activeGoal.calories)} kcal, ${surplus ? "cao hơn" : "thấp hơn"} mức duy trì ước tính khoảng ${Math.round(maintenance)} kcal.`,
          actions: [{ key: "OPEN_NUTRITION", label: "Xem mục tiêu dinh dưỡng đề xuất" }],
        });
      }
    }
  }

  return {
    coherent: conflicts.length === 0,
    roadmapId: roadmap?.id ?? null,
    profileGoal,
    roadmapGoal,
    effectiveGoal: { goal: effective.goal, source: effective.source, phaseType: effective.phaseType },
    conflicts,
  };
}
