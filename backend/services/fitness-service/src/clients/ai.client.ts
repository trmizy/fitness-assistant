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

export interface ProposedChange {
  type: "VOLUME" | "LOAD" | "REPS" | "EXERCISE" | "FREQUENCY" | "DELOAD";
  target: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
}

export interface AssessCycleResult {
  decision: "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA";
  headline: string;
  summary: string;
  positiveSignals: string[];
  warningSignals: string[];
  proposedChanges: ProposedChange[];
  missingData: string[];
  safetyNotice: string | null;
  requiresConfirmation: boolean;
  citations: Array<Record<string, unknown>>;
  /** Phase 2 — present only when the request included a `nutrition` block;
   * see ai-service's cycle-assessment.schemas.ts. */
  nutritionSummary: {
    nutritionDecision: "KEEP_PLAN" | "PROPOSE_ADJUSTMENT" | "REQUEST_MORE_DATA" | "EARLY_REVIEW" | "ESCALATE";
    headline: string;
    explanation: string;
  } | null;
}

/** Calls ai-service's new POST /ai/assess-cycle — additive alongside
 * analyzeCycle above, used only by the new /evaluate endpoint (Adaptive
 * Training Cycle Evaluation), not by the legacy /complete flow. */
export async function assessCycle(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AssessCycleResult> {
  const res = await axios.post(
    `${AI_SERVICE_URL}/ai/assess-cycle`,
    payload,
    {
      headers: internalHeaders(userId),
      timeout: Number(process.env.CYCLE_ANALYSIS_TIMEOUT_MS ?? 90_000),
    },
  );
  return res.data.data as AssessCycleResult;
}

export async function assessCycleSafe(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AssessCycleResult | null> {
  try {
    return await assessCycle(userId, payload);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, userId },
      "[training-cycle] assess-cycle call failed",
    );
    return null;
  }
}

export interface AnalyzeFeedbackResult {
  feedbackInterpretation: string;
  sentiment: "positive" | "negative" | "neutral" | "mixed" | "insufficient_feedback";
  complaintValidity: "supported_by_data" | "partially_supported" | "not_supported" | "insufficient_data";
  complaintCategories: string[];
  suggestedImprovementAreas: string[];
  riskFlags: string[];
  recommendedDecisionInfluence: "none" | "minor_adjust" | "adjust" | "deload" | "rebuild_consideration";
  explanationForUser: string;
  explanationForCoach: string;
  citations: Array<Record<string, unknown>>;
  usedFallback: boolean;
}

/** Calls ai-service's POST /ai/analyze-feedback — Phase 4 of
 * docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md. Advisory-only: the caller
 * (feedback-analysis.service.ts) persists this as an audit row and Phase 5
 * feeds `recommendedDecisionInfluence` into the Decision Engine as one
 * signal among several — it never decides anything by itself. */
export async function analyzeFeedback(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AnalyzeFeedbackResult> {
  const res = await axios.post(
    `${AI_SERVICE_URL}/ai/analyze-feedback`,
    payload,
    {
      headers: internalHeaders(userId),
      timeout: Number(process.env.CYCLE_ANALYSIS_TIMEOUT_MS ?? 90_000),
    },
  );
  return res.data.data as AnalyzeFeedbackResult;
}

export async function analyzeFeedbackSafe(
  userId: string,
  payload: Record<string, unknown>,
): Promise<AnalyzeFeedbackResult | null> {
  try {
    return await analyzeFeedback(userId, payload);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, userId },
      "[training-cycle] analyze-feedback call failed",
    );
    return null;
  }
}

export interface GenerateClientPlanDraftResult {
  days: Array<{
    dayNumber: number;
    title: string;
    exercises: Array<{ exerciseId: string; order: number; sets: number; reps: number; note?: string }>;
  }>;
  dataGaps: string[];
  warnings: string[];
  summaryForPt: string;
}

/** Calls ai-service's POST /ai/generate-client-plan-draft — Phase 7 of
 * docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md. Draft-only: never assigns
 * anything by itself, see coach.service.ts's generatePlanDraft. */
export async function generateClientPlanDraft(
  ptUserId: string,
  payload: Record<string, unknown>,
): Promise<GenerateClientPlanDraftResult> {
  const res = await axios.post(
    `${AI_SERVICE_URL}/ai/generate-client-plan-draft`,
    payload,
    {
      headers: internalHeaders(ptUserId),
      timeout: Number(process.env.CYCLE_ANALYSIS_TIMEOUT_MS ?? 90_000),
    },
  );
  return res.data.data as GenerateClientPlanDraftResult;
}

export async function generateClientPlanDraftSafe(
  ptUserId: string,
  payload: Record<string, unknown>,
): Promise<GenerateClientPlanDraftResult | null> {
  try {
    return await generateClientPlanDraft(ptUserId, payload);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, ptUserId },
      "[coach] generate-client-plan-draft call failed",
    );
    return null;
  }
}
