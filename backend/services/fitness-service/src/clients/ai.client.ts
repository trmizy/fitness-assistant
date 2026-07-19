/**
 * Calls ai-service's /ai/analyze-cycle from fitness-service after a training
 * cycle is completed. Uses the same x-internal-token + x-user-id pattern
 * ai-service's own requireAuth middleware expects from the gateway.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://ai-service:3003"
    : "http://localhost:3003");

function internalHeaders(userId: string) {
  return {
    "x-internal-token": process.env.INTERNAL_SERVICE_SECRET || "",
    "x-user-id": userId,
  };
}

export interface AnalyzeCycleResult {
  decision: "KEEP" | "ADJUST" | "NEW_PLAN";
  cycleReview: {
    bodyCompositionTrend: string;
    trainingNote: string;
    laggingMuscleGroups: string[];
    confidence: "high" | "low";
  };
  keepDetails: Record<string, unknown> | null;
  adjustDetails: Record<string, unknown> | null;
  newPlanDraft: Record<string, unknown> | null;
  mealPlanDraft: Record<string, unknown> | null;
  aiFallback?: boolean;
}

export async function analyzeCycle(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AnalyzeCycleResult> {
  const res = await axios.post(
    `${AI_SERVICE_URL}/ai/analyze-cycle`,
    payload,
    {
      headers: internalHeaders(userId),
      timeout: Number(process.env.CYCLE_ANALYSIS_TIMEOUT_MS ?? 90_000),
    },
  );
  return res.data.data as AnalyzeCycleResult;
}

export async function analyzeCycleSafe(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AnalyzeCycleResult | null> {
  try {
    return await analyzeCycle(userId, payload);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, userId },
      "[training-cycle] analyze-cycle call failed",
    );
    return null;
  }
}
