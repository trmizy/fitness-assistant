import { llmService } from '../services/llm.service';
import { inputParser } from './input_parser';
import { intentRouter } from './intent_router';
import { languageGuard } from './language_guard';
import { safetyGuard } from './safety_guard';
import { profileExtractor } from './profile_extractor';
import { retriever } from './retriever';
import { recommendationEngine } from './recommendation_engine';
import { promptBuilder } from './prompt_builder';
import { answerValidator } from './answer_validator';
import { responseFormatter } from './response_formatter';
import { labelLocalizer } from './label_localizer';
import { traceLogger } from './trace_logger';
import type { FinalAnswerPayload } from './types';

export const llmOrchestrator = {
  async run(question: string, userId?: string, authHeader?: string): Promise<FinalAnswerPayload> {
    const trace = traceLogger.start(question, userId);
    const context = await profileExtractor.extract(userId, authHeader);
    const language = languageGuard.resolve(question, userId);
    const routedIntent = intentRouter.route(question, context.profile);
    const parsedInput = inputParser.parse(question, context.profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;

    const unsafe = safetyGuard.evaluate(question);
    const retrieval = await retriever.retrieve(question);
    const recommendation = recommendationEngine.recommend(context.profile, parsedInput);

    if (unsafe?.blocked) {
      recommendation.unsafeGuidance = unsafe;
      recommendation.responseIntent = 'unsafe_weight_loss_request';
    }

    const deterministicAnswer = responseFormatter.format(recommendation, language.responseLanguage);

    let llmAnswer = deterministicAnswer;
    let prompt = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    // Intents that go through LLM for richer narrative and context-aware responses.
    // Workout plan + frequency change remain deterministic to enforce hard constraints
    // (day count, min exercises). Recomp and meal requests go through LLM because they
    // often carry strategic/contextual nuance (e.g., "theo hướng nào", "6 tháng điều chỉnh")
    // that the static formatter cannot address. Injury mentions also force LLM path so
    // the model can adapt the plan narrative around the user's pain points.
    const llmIntents = new Set([
      'general_fitness_knowledge',
      'schedule_specific_day_request',
      'body_recomposition_request',
      'meal_plan_request',
    ]);

    const needsLlm = llmIntents.has(routedIntent.intent) || parsedInput.mentionsInjury;

    if (needsLlm && !unsafe?.blocked) {
      prompt = promptBuilder.build(question, parsedInput, context.profile, retrieval, recommendation, language.responseLanguage);
      const llmResponse = await llmService.callLLM(prompt);
      llmAnswer = labelLocalizer.localize(llmResponse.answer, language.responseLanguage);
      promptTokens = llmResponse.promptTokens;
      completionTokens = llmResponse.completionTokens;
      totalTokens = llmResponse.totalTokens;
    }

    const validation = answerValidator.validate(llmAnswer, recommendation);

    traceLogger.end(trace, {
      retrievalEmpty: retrieval.isEmpty,
      warningCount: validation.warnings.length,
      promptTokens,
      completionTokens,
    });

    return {
      traceId: trace.traceId,
      answer: llmAnswer,
      responseLanguage: language.responseLanguage,
      usedFallback: retrieval.isEmpty,
      missingFields: recommendation.missingFields,
      recommendation,
      retrieval,
      finalPrompt: prompt,
      validationNotes: validation.warnings,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  },
};
