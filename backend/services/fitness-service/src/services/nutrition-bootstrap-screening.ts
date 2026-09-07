import type { UserProfileSnapshot } from "../clients/user.client";

/** Follow the existing UserProfile screening contract: advise review, never block.
 * UNKNOWN means unscreened, not medically cleared. Flags take precedence over
 * a contradictory CLEARED status; no clinical thresholds are inferred here.
 */
export function nutritionBootstrapScreening(profile: UserProfileSnapshot | null) {
  const status = profile?.safetyScreeningStatus ?? "UNKNOWN";
  const flags = profile?.safetyScreeningFlags ?? [];
  return {
    safetyScreeningStatus: status,
    professionalReviewRequired: status === "FOLLOW_UP_SUGGESTED" || flags.length > 0,
  };
}
