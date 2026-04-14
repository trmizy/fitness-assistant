import { LLM_MODEL, llmService } from './llm.service';
import { conversationRepository } from '../repositories/conversation.repository';
import type { RelevanceEval } from '../models/ai.models';
import { llmOrchestrator } from '../llm/orchestrator.service';
import { logger } from '@gym-coach/shared';
import { LlmError } from '../errors/api-error';

/**
 * LLM self-evaluation is DISABLED by default.
 *
 * It fires a second LLM call after every /ai/ask to score the answer's
 * relevance.  This adds latency and cost with no measurable user benefit in
 * production.  Enable it only for QA / offline evaluation:
 *
 *   ENABLE_LLM_SELF_EVAL=true
 */
const SELF_EVAL_ENABLED = process.env.ENABLE_LLM_SELF_EVAL === 'true';

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
    const prompt = EVALUATION_PROMPT
      .replace('{question}', question)
      .replace('{answer}', answer.slice(0, 1500)); // cap to avoid huge prompts
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
    logger.warn({ err }, 'Self-evaluation failed, continuing without relevance score');
  }
  return { Relevance: 'UNKNOWN', Explanation: 'Evaluation skipped or failed' };
}

export const ragService = {
  async rag(question: string, userId?: string, authHeader?: string) {
    const startTime = Date.now();

    // May throw LlmError if the LLM provider is down — propagates to controller.
    const orchestrated = await llmOrchestrator.run(question, userId, authHeader);
    const responseTime = (Date.now() - startTime) / 1000;

    // Self-evaluation: second LLM call, gated behind env flag.
    let relevanceEval: RelevanceEval = { Relevance: null as unknown as RelevanceEval['Relevance'], Explanation: null as unknown as string };
    if (SELF_EVAL_ENABLED) {
      relevanceEval = await evaluateRelevance(question, orchestrated.answer);
    }

    // Do NOT store infrastructure error messages as conversation content.
    // If answer is a LlmError message it would have already thrown above.
    const conversation = await conversationRepository.create({
      userId,
      question,
      answer: orchestrated.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      relevance: SELF_EVAL_ENABLED ? relevanceEval.Relevance : null,
      relevanceExplanation: SELF_EVAL_ENABLED ? relevanceEval.Explanation : null,
      promptTokens: orchestrated.promptTokens,
      completionTokens: orchestrated.completionTokens,
      totalTokens: orchestrated.totalTokens,
      cost: 0,
      // ── Observability fields ────────────────────────────────────────────────
      traceId: orchestrated.traceId,
      usedFallback: orchestrated.usedFallback,
      usedDeterministicFallback: orchestrated.usedDeterministicFallbackBecauseOfValidation,
      responseLanguage: orchestrated.responseLanguage,
      routeIntent: orchestrated.routeIntent,
      warningCount: orchestrated.warningCount,
    });

    return {
      conversationId: conversation.id,
      question,
      answer: orchestrated.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      ...(SELF_EVAL_ENABLED
        ? { relevance: relevanceEval.Relevance, relevanceExplanation: relevanceEval.Explanation }
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
    };
  },
};

// Re-export so callers can distinguish LLM failures.
export { LlmError };
