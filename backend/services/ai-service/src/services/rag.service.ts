import { LLM_MODEL, llmService } from './llm.service';
import { conversationRepository } from '../repositories/conversation.repository';
import type { RelevanceEval } from '../models/ai.models';
import { llmOrchestrator } from '../llm/orchestrator.service';

const EVALUATION_PROMPT = `
You are an expert evaluator for a RAG system.
Your task is to analyze the relevance of the generated answer to the given question.
Based on the relevance of the generated answer, you will classify it
as "NON_RELEVANT", "PARTLY_RELEVANT", or "RELEVANT".

Question: {question}
Generated Answer: {answer}

Please analyze the content and context of the generated answer in relation to the question
and provide your evaluation in parsable JSON:

{
  "Relevance": "NON_RELEVANT" | "PARTLY_RELEVANT" | "RELEVANT",
  "Explanation": "[Provide a brief explanation for your evaluation]"
}
`.trim();

async function evaluateRelevance(
  question: string,
  answer: string,
): Promise<RelevanceEval> {
  try {
    const prompt = EVALUATION_PROMPT.replace('{question}', question).replace(
      '{answer}',
      answer,
    );
    const result = await llmService.callLLM(prompt);
    const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // ignore parse errors
  }
  return { Relevance: 'UNKNOWN', Explanation: 'Failed to parse evaluation' };
}

export const ragService = {
  async rag(question: string, userId?: string, authHeader?: string) {
    const startTime = Date.now();

    const orchestrated = await llmOrchestrator.run(question, userId, authHeader);
    const relevanceEval = await evaluateRelevance(question, orchestrated.answer);
    const responseTime = (Date.now() - startTime) / 1000;

    const conversation = await conversationRepository.create({
      userId,
      question,
      answer: orchestrated.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      relevance: relevanceEval.Relevance,
      relevanceExplanation: relevanceEval.Explanation,
      promptTokens: orchestrated.promptTokens,
      completionTokens: orchestrated.completionTokens,
      totalTokens: orchestrated.totalTokens,
      cost: 0,
    });

    return {
      conversationId: conversation.id,
      question,
      answer: orchestrated.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      relevance: relevanceEval.Relevance,
      relevanceExplanation: relevanceEval.Explanation,
      promptTokens: orchestrated.promptTokens,
      completionTokens: orchestrated.completionTokens,
      totalTokens: orchestrated.totalTokens,
      traceId: orchestrated.traceId,
      usedFallback: orchestrated.usedFallback,
      missingFields: orchestrated.missingFields,
      validationNotes: orchestrated.validationNotes,
      recommendation: orchestrated.recommendation,
    };
  },
};
