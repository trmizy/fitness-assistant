import { llmService } from '../services/llm.service';
import { inputParser } from './input_parser';
import { profileExtractor } from './profile_extractor';
import { retriever } from './retriever';
import { recommendationEngine } from './recommendation_engine';
import { promptBuilder } from './prompt_builder';
import { answerValidator } from './answer_validator';
import { traceLogger } from './trace_logger';
import type { FinalAnswerPayload } from './types';

export const llmOrchestrator = {
  async run(question: string, userId?: string, authHeader?: string): Promise<FinalAnswerPayload> {
    const trace = traceLogger.start(question, userId);
    const context = await profileExtractor.extract(userId, authHeader);
    const parsedInput = inputParser.parse(question, context.profile);
    const retrieval = await retriever.retrieve(question);
    const recommendation = recommendationEngine.recommend(context.profile, parsedInput);
    const prompt = promptBuilder.build(question, parsedInput, context.profile, retrieval, recommendation);

    const llmResponse = await llmService.callLLM(prompt);
    const validation = answerValidator.validate(llmResponse.answer, recommendation);

    traceLogger.end(trace, {
      retrievalEmpty: retrieval.isEmpty,
      warningCount: validation.warnings.length,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
    });

    return {
      traceId: trace.traceId,
      answer: llmResponse.answer,
      usedFallback: retrieval.isEmpty,
      missingFields: recommendation.missingFields,
      recommendation,
      retrieval,
      finalPrompt: prompt,
      validationNotes: validation.warnings,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
      totalTokens: llmResponse.totalTokens,
    };
  },
};
