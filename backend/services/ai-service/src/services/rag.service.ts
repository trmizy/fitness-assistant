import { LLM_MODEL, llmService } from "./llm.service";
import { conversationRepository } from "../repositories/conversation.repository";
import type { RelevanceEval } from "../models/ai.models";
import { llmOrchestrator } from "../llm/orchestrator.service";
import type { ProgressCallback } from "../llm/orchestrator.service";
import { logger } from "@gym-coach/shared";
import { ApiError, LlmError } from "../errors/api-error";
import { currentClientRequestId } from "./request-identity";

type PersistedTurn = NonNullable<Awaited<ReturnType<typeof conversationRepository.findByClientRequestId>>>;

/**
 * Replays an already-persisted turn for a retried action. The response has the shape of a fresh one (conversationId, sessionId, answer,
 * structuredBlocks…) so the client simply adopts the original session; `replayed: true` marks it. The model is NOT called again.
 */
function replayOfPersistedTurn(turn: PersistedTurn) {
  return {
    conversationId: turn.id,
    ...(turn.structuredBlocks ? { structuredBlocks: turn.structuredBlocks as any } : {}),
    sessionId: turn.sessionId ?? undefined,
    question: turn.question,
    answer: turn.answer,
    modelUsed: turn.modelUsed,
    responseTime: turn.responseTime,
    promptTokens: turn.promptTokens,
    completionTokens: turn.completionTokens,
    totalTokens: turn.totalTokens,
    traceId: turn.traceId ?? undefined,
    responseLanguage: turn.responseLanguage ?? undefined,
    usedFallback: turn.usedFallback,
    missingFields: [] as string[],
    validationNotes: [] as string[],
    recommendation: undefined,
    // Present-but-empty so the replay has the same optional fields as a fresh turn (callers read them without branching).
    evidenceUsed: undefined as any,
    adjustmentReasons: undefined as any,
    safetyNotes: undefined as any,
    timing: undefined as any,
    fallbackReason: undefined as any,
    workoutSchedule: undefined as any,
    nutritionSchedule: undefined as any,
    replayed: true as const,
  };
}

/**
 * The same clientRequestId may only ever mean the same action: same user (the lookup is per user), same question and, when the retry
 * names one, the same session. Anything else is a client bug or a collision and is refused rather than answered with another turn.
 */
function assertSameAction(turn: PersistedTurn, question: string, sessionId?: string): void {
  if (turn.question.trim() !== question.trim() || (sessionId && turn.sessionId && sessionId !== turn.sessionId)) {
    throw new ApiError("IDEMPOTENCY_KEY_CONFLICT", "This request id was already used for a different message.", 409);
  }
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

/**
 * LLM self-evaluation is DISABLED by default.
 *
 * It fires a second LLM call after every /ai/ask to score the answer's
 * relevance.  This adds latency and cost with no measurable user benefit in
 * production.  Enable it only for QA / offline evaluation:
 *
 *   ENABLE_LLM_SELF_EVAL=true
 */
const SELF_EVAL_ENABLED = process.env.ENABLE_LLM_SELF_EVAL === "true";

const EVALUATION_PROMPT = `
You are an expert evaluator for a RAG system.
Your task is to analyze the relevance of the generated answer to the given question.
Based on the relevance of the generated answer, you will classify it
as "NON_RELEVANT", "PARTLY_RELEVANT", or "RELEVANT".

Question: {question}
Generated Answer: {answer}

Respond ONLY with valid JSON — no markdown:
{"Relevance": "NON_RELEVANT" | "PARTLY_RELEVANT" | "RELEVANT", "Explanation": "..."}
`.trim();

async function evaluateRelevance(
  question: string,
  answer: string,
): Promise<RelevanceEval> {
  try {
    const prompt = EVALUATION_PROMPT.replace("{question}", question).replace(
      "{answer}",
      answer.slice(0, 1500),
    ); // cap to avoid huge prompts
    const result = await llmService.callLLM(prompt);
    const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<RelevanceEval>;
      if (parsed.Relevance && parsed.Explanation) {
        return parsed as RelevanceEval;
      }
    }
  } catch (err) {
    // Self-eval failures must not propagate — log and continue.
    logger.warn(
      { err },
      "Self-evaluation failed, continuing without relevance score",
    );
  }
  return { Relevance: "UNKNOWN", Explanation: "Evaluation skipped or failed" };
}

export const ragService = {
  async rag(
    question: string,
    userId?: string,
    authHeader?: string,
    sessionId?: string,
    onProgress?: ProgressCallback,
  ) {
    const startTime = Date.now();

    // Retry of an action that already produced a persisted turn (lost response, refresh, 401 resend that landed twice): answer from
    // the stored turn. No second model call, no second session, no duplicate message in the history. The verified userId scopes the
    // lookup, so another account can never read or collide with this turn.
    const clientRequestId = userId ? currentClientRequestId() : null;
    if (userId && clientRequestId) {
      const prior = await conversationRepository.findByClientRequestId(userId, clientRequestId);
      if (prior) {
        assertSameAction(prior, question, sessionId);
        logger.info({ userId, conversationId: prior.id }, "[chat] retried action answered from the stored turn");
        return replayOfPersistedTurn(prior);
      }
    }

    // Resolve the session BEFORE running the orchestrator so its chat-history
    // fetch always has a real sessionId to scope against — a brand-new session
    // then naturally returns zero prior rows (nothing written against it yet)
    // instead of needing special-case branching for "no session".
    let effectiveSessionId: string | undefined;
    let createdSessionId: string | undefined; // set only when THIS attempt created the session (so a lost race can clean it up)
    if (sessionId) {
      const session = await conversationRepository.findSessionById(sessionId);
      if (!session || session.userId !== userId || session.archivedAt) {
        throw new ApiError(
          "SESSION_NOT_FOUND",
          `Session ${sessionId} not found`,
          404,
        );
      }
      effectiveSessionId = session.id;
    } else if (userId) {
      const title = question.trim().slice(0, 60);
      const created = await conversationRepository.createSession({
        userId,
        title,
      });
      effectiveSessionId = created.id;
      createdSessionId = created.id;
    }

    // May throw LlmError if the LLM provider is down — propagates to controller.
    const orchestrated = await llmOrchestrator.run(
      question,
      userId,
      authHeader,
      effectiveSessionId,
      onProgress,
    );
    const responseTime = (Date.now() - startTime) / 1000;

    // Self-evaluation: second LLM call, gated behind env flag.
    let relevanceEval: RelevanceEval = {
      Relevance: null as unknown as RelevanceEval["Relevance"],
      Explanation: null as unknown as string,
    };
    if (SELF_EVAL_ENABLED) {
      relevanceEval = await evaluateRelevance(question, orchestrated.answer);
    }

    // Do NOT store infrastructure error messages as conversation content.
    // If answer is a LlmError message it would have already thrown above.
    let conversation;
    try {
      conversation = await conversationRepository.create({
        userId,
        sessionId: effectiveSessionId,
        clientRequestId,
        question,
        answer: orchestrated.answer,
        structuredBlocks: orchestrated.structuredBlocks as any,
        modelUsed: LLM_MODEL,
        responseTime,
        relevance: SELF_EVAL_ENABLED ? relevanceEval.Relevance : null,
        relevanceExplanation: SELF_EVAL_ENABLED
          ? relevanceEval.Explanation
          : null,
        promptTokens: orchestrated.promptTokens,
        completionTokens: orchestrated.completionTokens,
        totalTokens: orchestrated.totalTokens,
        cost: 0,
        // ── Observability fields ────────────────────────────────────────────────
        traceId: orchestrated.traceId,
        usedFallback: orchestrated.usedFallback,
        usedDeterministicFallback:
          orchestrated.usedDeterministicFallbackBecauseOfValidation,
        responseLanguage: orchestrated.responseLanguage,
        routeIntent: orchestrated.routeIntent,
      warningCount: orchestrated.warningCount,
      });
    } catch (err) {
      // Two attempts of the SAME action raced to persist: the unique (user, clientRequestId) index kept exactly one turn. This attempt
      // answers with the winner, so the user sees one consistent turn (the redundant model call is the only cost of the race).
      if (!(isUniqueViolation(err) && userId && clientRequestId)) throw err;
      const winner = await conversationRepository.findByClientRequestId(userId, clientRequestId);
      if (!winner) throw err;
      assertSameAction(winner, question, sessionId);
      if (createdSessionId && createdSessionId !== winner.sessionId) await conversationRepository.deleteSessionIfEmpty(createdSessionId);
      return replayOfPersistedTurn(winner);
    }

    if (effectiveSessionId) {
      conversationRepository
        .touchSessionLastMessage(effectiveSessionId)
        .catch((err) =>
          logger.warn(
            { err, sessionId: effectiveSessionId },
            "Failed to touch chat session lastMessageAt",
          ),
        );
    }

    return {
      conversationId: conversation.id,
      ...(orchestrated.structuredBlocks ? { structuredBlocks: orchestrated.structuredBlocks } : {}),
      sessionId: effectiveSessionId,
      question,
      answer: orchestrated.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      ...(SELF_EVAL_ENABLED
        ? {
            relevance: relevanceEval.Relevance,
            relevanceExplanation: relevanceEval.Explanation,
          }
        : {}),
      promptTokens: orchestrated.promptTokens,
      completionTokens: orchestrated.completionTokens,
      totalTokens: orchestrated.totalTokens,
      traceId: orchestrated.traceId,
      responseLanguage: orchestrated.responseLanguage,
      usedFallback: orchestrated.usedFallback,
      missingFields: orchestrated.missingFields,
      validationNotes: orchestrated.validationNotes,
      recommendation: orchestrated.recommendation,
      ...(orchestrated.fallbackReason
        ? { fallbackReason: orchestrated.fallbackReason }
        : {}),
      ...(orchestrated.timing ? { timing: orchestrated.timing } : {}),
      ...(orchestrated.adjustmentReasons
        ? { adjustmentReasons: orchestrated.adjustmentReasons }
        : {}),
      ...(orchestrated.evidenceUsed
        ? { evidenceUsed: orchestrated.evidenceUsed }
        : {}),
      ...(orchestrated.safetyNotes
        ? { safetyNotes: orchestrated.safetyNotes }
        : {}),
      ...(orchestrated.workoutSchedule
        ? { workoutSchedule: orchestrated.workoutSchedule }
        : {}),
      ...(orchestrated.nutritionSchedule
        ? { nutritionSchedule: orchestrated.nutritionSchedule }
        : {}),
    };
  },
};

// Re-export so callers can distinguish LLM failures.
export { LlmError };
