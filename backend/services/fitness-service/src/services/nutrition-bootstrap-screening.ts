import type { UserProfileSnapshot } from "../clients/user.client";

/** Follow the existing UserProfile screening contract: advise review, never block.
 * UNKNOWN means unscreened, not medically cleared. Flags take precedence over
 * a contradictory CLEARED status; no clinical thresholds are inferred here.
 *
 * A minor (profile age < 18) is also routed to professional review: the
 * Mifflin-St Jeor equation and the adult deficit/surplus bands are not
 * validated for adolescents, so they get the existing maintenance-only
 * prescription (never a weight-loss deficit) until a parent/paediatric
 * professional is involved. Found by the nutrition quality evaluation
 * (test/ai-quality-eval, 2026-11-08): a 16-year-old's onboarding produced a
 * -15% weight-loss NutritionGoal (1530 kcal). This is an applicability rule,
 * not a clinical threshold, and like every other screening outcome it only
 * changes the starting target — it never blocks the user.
 */
export function nutritionBootstrapScreening(profile: UserProfileSnapshot | null) {
  const status = profile?.safetyScreeningStatus ?? "UNKNOWN";
  const flags = profile?.safetyScreeningFlags ?? [];
  const age = profile?.age;
  const minorAge = typeof age === "number" && age > 0 && age < 18;
  const goalTargetConflict = detectGoalTargetWeightConflict(profile);
  return {
    safetyScreeningStatus: status,
    professionalReviewRequired: status === "FOLLOW_UP_SUGGESTED" || flags.length > 0 || minorAge,
    ...(minorAge ? { minorAge: true as const } : {}),
    ...(goalTargetConflict ? { goalTargetConflict } : {}),
  };
}

/**
 * The profile goal contradicts the target weight: "MUSCLE_GAIN" with a target weight below the current one, or "WEIGHT_LOSS" with
 * a target above it. Found 2026-11-08 by the owner's own account (22 y, 80.9 kg -> target 72 kg, goal MUSCLE_GAIN): onboarding
 * gave a +surplus 3543 kcal goal to someone who wants to lose ~9 kg. Neither field is overruled here — the conflict only means
 * the starting target stays at maintenance (no surplus, no deficit) and the user is asked to pick the goal they mean.
 */
export function detectGoalTargetWeightConflict(profile: UserProfileSnapshot | null): { goal: string; currentWeight: number; targetWeight: number } | null {
  const goal = profile?.goal ?? null, cur = profile?.currentWeight ?? null, tgt = profile?.targetWeight ?? null;
  if (!goal || typeof cur !== "number" || typeof tgt !== "number" || cur <= 0 || tgt <= 0) return null;
  const conflict = (goal === "MUSCLE_GAIN" && tgt < cur - 1) || (goal === "WEIGHT_LOSS" && tgt > cur + 1);
  return conflict ? { goal, currentWeight: cur, targetWeight: tgt } : null;
}
