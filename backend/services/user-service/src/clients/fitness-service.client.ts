/**
 * AI Nutrition Cycle Engine (Gymini) — the first call FROM user-service TO
 * fitness-service (every other cross-service call in this repo already
 * goes the other direction, fitness-service/ai-service -> user-service; see
 * profile.repository.ts's own top-of-file comment on that convention).
 * Uses fitness-service's `internalAuthMiddleware` contract exactly as
 * fitness-service's own ai.client.ts documents it: x-internal-token to
 * prove the caller is a trusted service, x-user-id to say who for — NOT the
 * x-service-secret-only convention this service's own /internal/* routes
 * use (that one has no per-user identity to carry; this call always does).
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

function resolveFitnessServiceUrl(): string {
  return (
    process.env.FITNESS_SERVICE_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://fitness-service:3002"
      : "http://localhost:3002")
  );
}

function internalHeaders(userId: string) {
  return {
    "x-internal-token": process.env.INTERNAL_SERVICE_SECRET || "",
    "x-user-id": userId,
  };
}

export type NutritionBootstrapOutcome =
  | { status: "already_initialized"; goalId: string }
  | { status: "insufficient_data"; missingFields: string[] }
  | {
      status: "created";
      goalId: string;
      cycleId: string;
      cycleCreated: boolean;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      mealPlanQueued: boolean;
      professionalReviewRequired: boolean;
      safetyScreeningStatus: string;
    };

/**
 * Fire-and-forget from the caller's point of view: onboarding completion
 * (profileService.upsertProfile) must succeed and return promptly even if
 * fitness-service is slow or briefly unavailable — a missed initial
 * nutrition plan is recoverable (the next Nutrition page load / a retry can
 * trigger it again, and this call is idempotent on the fitness-service
 * side), a blocked onboarding submit is not.
 */
export async function bootstrapNutritionSafe(
  userId: string,
): Promise<NutritionBootstrapOutcome | null> {
  try {
    const res = await axios.post(
      `${resolveFitnessServiceUrl()}/internal/onboarding/bootstrap-nutrition`,
      {},
      {
        headers: internalHeaders(userId),
        timeout: Number(process.env.NUTRITION_BOOTSTRAP_TIMEOUT_MS ?? 8000),
      },
    );
    const data = res.data?.success ? (res.data.data ?? res.data) : res.data;
    return data as NutritionBootstrapOutcome;
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[profile] nutrition bootstrap call to fitness-service failed (non-blocking)",
    );
    return null;
  }
}

export type InBodyReassessmentTriggerOutcome =
  | { triggered: false; reason: string }
  | { triggered: true; cycleId: string };

/**
 * AI Nutrition Cycle Engine (Gymini) Phase 3 — fire-and-forget, exactly like
 * bootstrapNutritionSafe above: a new InBody entry must save successfully
 * regardless of whether fitness-service is reachable. The endpoint itself
 * returns fast (all gating is synchronous DB reads; the actual — possibly
 * LLM-backed — evaluation runs detached on the fitness-service side), so
 * this uses a short timeout, not the long nutrition-bootstrap one.
 */
export async function triggerInBodyReassessmentSafe(
  userId: string,
): Promise<InBodyReassessmentTriggerOutcome | null> {
  try {
    const res = await axios.post(
      `${resolveFitnessServiceUrl()}/internal/inbody/reassessment-check`,
      {},
      {
        headers: internalHeaders(userId),
        timeout: Number(process.env.INBODY_REASSESSMENT_TIMEOUT_MS ?? 5000),
      },
    );
    const data = res.data?.success ? (res.data.data ?? res.data) : res.data;
    return data as InBodyReassessmentTriggerOutcome;
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[inbody] reassessment-check call to fitness-service failed (non-blocking)",
    );
    return null;
  }
}
