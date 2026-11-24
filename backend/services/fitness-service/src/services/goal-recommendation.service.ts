/**
 * Goal recommendation from the user's body metrics — the I/O side of goal-recommendation.engine.ts (pure).
 * Reuses the roadmap's own profile + InBody resolver, so the wizard, the profile page and the diagnosis screen read the SAME
 * weight/height/age/body-fat with the same priority (a real InBody reading beats a typed or photo-guessed figure).
 * Read-only: it suggests, the user decides, nothing is stored.
 */
import { resolveEffectiveDiagnosisContext } from "./fitness-roadmap.service";
import { recommendGoalFromBody, type BodyFatSource, type GoalRecommendation } from "./goal-recommendation.engine";

export interface GoalRecommendationOverrides {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  gender?: string;
  bodyFatPct?: number;
  bodyFatMethod?: string;
}

export interface GoalRecommendationResponse {
  recommendation: GoalRecommendation;
  /** the goal currently saved on the profile, so the client can say "same as your profile" without a second call */
  profileGoal: string | null;
}

const SOURCE_BY_METHOD: Record<string, BodyFatSource> = { inbody: "MEASURED", manual: "USER_ENTERED", visual_reference: "VISUAL_ESTIMATE" };

export async function getGoalRecommendation(userId: string, overrides: GoalRecommendationOverrides = {}): Promise<GoalRecommendationResponse> {
  const ctx = await resolveEffectiveDiagnosisContext(userId, overrides);
  const recommendation = recommendGoalFromBody({
    age: ctx.age,
    gender: ctx.gender as "MALE" | "FEMALE" | "OTHER" | null,
    heightCm: ctx.heightCm,
    weightKg: ctx.weightKg,
    bodyFatPct: ctx.bodyFatPct,
    bodyFatSource: ctx.bodyFatMethod ? SOURCE_BY_METHOD[ctx.bodyFatMethod] ?? "USER_ENTERED" : null,
    bodyFatMeasuredAt: ctx.inbodyMeasuredAt ? new Date(ctx.inbodyMeasuredAt) : null,
    experienceLevel: ctx.experienceLevel,
    // the age rule is applied by the engine on the age actually used; only the health-screening part comes from the profile
    professionalReviewRequired: ctx.healthReviewRequired,
    now: new Date(),
  });
  return { recommendation, profileGoal: ctx.profileGoal };
}
