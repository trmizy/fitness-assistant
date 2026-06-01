import { llmService } from '../services/llm.service';
import { conversationRepository } from '../repositories/conversation.repository';
import { logger } from '@gym-coach/shared';
import { inputParser } from './input_parser';
import { intentRouter } from './intent_router';
import { languageGuard } from './language_guard';
import { safetyGuard } from './safety_guard';
import { profileExtractor } from './profile_extractor';
import { retriever } from './retriever';
import { recommendationEngine } from './recommendation_engine';
import { promptBuilder } from './prompt_builder';
import { answerValidator, hasCriticalNutritionMismatch, hasCriticalStructureMismatch } from './answer_validator';
import { responseFormatter } from './response_formatter';
import { labelLocalizer } from './label_localizer';
import { traceLogger } from './trace_logger';
import { analyzeBodyComposition, formatBodyCompAnalysis } from './body_composition_rules';
import type { AdjustmentReason, EvidenceUsed, FinalAnswerPayload, LanguageDecision, RecommendationResult } from './types';
import {
  buildWorkoutScheduleContextBlock,
  detectWorkoutScheduleIntent,
  formatWorkoutScheduleAnswer,
  workoutScheduleContextResolver,
} from './workout_schedule_context';
import {
  buildNutritionContextBlock,
  detectNutritionLookupIntent,
  formatNutritionAnswer,
  nutritionContextResolver,
} from './nutrition_context';

/** Callback fired at each real pipeline milestone so callers can forward live status events. */
export type ProgressCallback = (message: string) => void;

function makeEarlyPayload(
  traceId: string,
  answer: string,
  language: LanguageDecision,
  routeIntent: string,
): FinalAnswerPayload {
  const emptyRec: RecommendationResult = {
    objective: '',
    nutrition: { formula: 'none', confidence: 'low' },
    workout: { split: 'none', sessionsPerWeek: 0, focus: [], avoidedPatterns: [], assumptions: [] },
    meal: { template: 'none', dailyMeals: 0, assumptions: [] },
    assumptions: [],
    missingFields: [],
  };
  return {
    traceId,
    answer,
    responseLanguage: language.responseLanguage,
    usedFallback: false,
    usedDeterministicFallbackBecauseOfValidation: false,
    missingFields: [],
    retrieval: { documents: [], isEmpty: true },
    recommendation: emptyRec,
    finalPrompt: '',
    validationNotes: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    routeIntent,
    warningCount: 0,
    explicitLanguageLock: language.locked,
  };
}

export const llmOrchestrator = {
  async run(
    question: string,
    userId?: string,
    authHeader?: string,
    onProgress?: ProgressCallback,
  ): Promise<FinalAnswerPayload> {
    const trace = traceLogger.start(question, userId);

    // Language detection is synchronous — resolve before any network I/O so early-exit
    // responses are returned in the correct locale.
    const language = languageGuard.resolve(question, userId);

    // Fast safety gate — runs before profile fetch and vector search.
    // Off-topic and medical emergency return immediately without hitting downstream services.
    const safetyCheck = safetyGuard.check(question);

    if (safetyCheck.type === 'off_topic' || safetyCheck.type === 'medical_emergency') {
      const answer =
        language.responseLanguage === 'vi' ? safetyCheck.messageVi : safetyCheck.messageEn;
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
      return makeEarlyPayload(trace.traceId, answer, language, safetyCheck.type);
    }

    // Emit before any I/O — fires immediately after safety gate passes.
    onProgress?.('Đang đọc hồ sơ của bạn...');

    // Profile fetch (4 downstream HTTP calls) and Qdrant vector search run concurrently —
    // neither depends on the other, so parallelising saves ~150-300 ms per request.
    const preliminaryNutritionIntent = detectNutritionLookupIntent(question);
    const preliminaryScheduleIntent = preliminaryNutritionIntent.enabled
      ? { enabled: false }
      : detectWorkoutScheduleIntent(question);
    const [context, retrieval, chatHistory] = await Promise.all([
      profileExtractor.extract(userId, authHeader),
      preliminaryNutritionIntent.enabled || preliminaryScheduleIntent.enabled
        ? Promise.resolve({ documents: [], isEmpty: true, reason: preliminaryNutritionIntent.enabled ? 'nutrition_schedule_lookup_skips_rag' : 'workout_schedule_lookup_skips_rag' })
        : retriever.retrieve(question),
      userId ? conversationRepository.findMany({ userId }, 5) : Promise.resolve([]),
    ]);

    const nutritionIntent = detectNutritionLookupIntent(question, chatHistory);
    if (nutritionIntent.enabled) {
      const nutritionContext = await nutritionContextResolver.resolve(nutritionIntent, userId, authHeader);
      nutritionContextResolver.debug(nutritionIntent, nutritionContext, userId);
      const answer = formatNutritionAnswer(nutritionContext, language.responseLanguage);
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });

      return {
        ...makeEarlyPayload(trace.traceId, answer, language, 'meal_plan_request'),
        finalPrompt: buildNutritionContextBlock(nutritionContext),
        nutritionSchedule: {
          targetDate: nutritionContext.targetDate,
          mealType: nutritionContext.mealType,
          nutritionPlanName: nutritionContext.nutritionPlanName,
          plannedMealsFound: nutritionContext.plannedMealsFound,
          source: nutritionContext.source,
        },
      };
    }

    const scheduleIntent = detectWorkoutScheduleIntent(question, chatHistory);
    const workoutScheduleContext = scheduleIntent.enabled
      ? await workoutScheduleContextResolver.resolve(scheduleIntent, userId, authHeader)
      : undefined;

    if (scheduleIntent.enabled && workoutScheduleContext) {
      if (process.env.DEBUG_INTENT_ROUTING === 'true') {
        logger.info({
          rawMessage: scheduleIntent.rawMessage,
          normalizedMessage: scheduleIntent.normalizedMessage,
          detectedIntent: 'workout_schedule_lookup',
          intentReason: 'workout_keyword_or_date_context',
          inheritedIntent: scheduleIntent.inheritedIntent ?? false,
          targetDate: scheduleIntent.targetDate,
          mealType: undefined,
          workoutLookupCalled: true,
          nutritionLookupCalled: false,
        }, 'AI coach intent routing resolved');
      }
      workoutScheduleContextResolver.debug(scheduleIntent, workoutScheduleContext, userId);
      const answer = formatWorkoutScheduleAnswer(workoutScheduleContext, language.responseLanguage);
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });

      return {
        ...makeEarlyPayload(trace.traceId, answer, language, 'schedule_specific_day_request'),
        finalPrompt: buildWorkoutScheduleContextBlock(workoutScheduleContext),
        workoutSchedule: {
          activePlanName: workoutScheduleContext.activePlanName,
          planFrequency: workoutScheduleContext.planFrequency,
          targetDate: workoutScheduleContext.targetDate,
          targetDayOfWeek: workoutScheduleContext.targetDayOfWeek,
          scheduledWorkoutFound: workoutScheduleContext.scheduledWorkoutFound,
          source: workoutScheduleContext.source,
        },
      };
    }

    // Body composition analysis — synchronous, runs after profile is available
    const bodyCompAnalysis = analyzeBodyComposition(context.profile);
    const bodyCompText = formatBodyCompAnalysis(bodyCompAnalysis);

    // Retrieve evidence from fitness_evidence collection using body-comp-specific queries.
    // Runs after profile so queries can be shaped by the analysis. Best-effort: no throw.
    const evidenceDocs = await retriever.retrieveEvidence(bodyCompAnalysis.evidenceQueries).catch(() => []);

    onProgress?.('Đã tìm dữ liệu phù hợp');

    const routedIntent = intentRouter.route(question, context.profile);
    const parsedInput = inputParser.parse(question, context.profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;

    const unsafe =
      safetyCheck.type === 'unsafe_weight_loss' ? safetyCheck.guidance : undefined;
    const recommendation = recommendationEngine.recommend(
      context.profile,
      parsedInput,
      language.responseLanguage,
    );

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
      'combined_plan_request',
    ]);

    const needsLlm = llmIntents.has(routedIntent.intent) || parsedInput.mentionsInjury;

    // Merge evidence docs into retrieval so compactRetrieval() can format citations
    const mergedRetrieval = evidenceDocs.length > 0
      ? { ...retrieval, documents: [...retrieval.documents, ...evidenceDocs], isEmpty: false }
      : retrieval;

    if (needsLlm && !unsafe?.blocked) {
      onProgress?.('Đang tạo câu trả lời cá nhân hóa...');
      prompt = promptBuilder.build(
        question,
        parsedInput,
        context,
        mergedRetrieval,
        recommendation,
        language.responseLanguage,
        chatHistory,
        bodyCompText || undefined,
      );
      const llmResponse = await llmService.callLLM(prompt);
      llmAnswer = labelLocalizer.localize(llmResponse.answer, language.responseLanguage);
      promptTokens = llmResponse.promptTokens;
      completionTokens = llmResponse.completionTokens;
      totalTokens = llmResponse.totalTokens;
    }

    const validation = answerValidator.validate(
      llmAnswer,
      recommendation,
      language.responseLanguage,
      context.profile,
    );

    // If the LLM answer contains nutrition numbers that differ materially from the
    // deterministic targets, discard it and use the deterministic answer instead.
    // This prevents the "185g protein in headline / 133g in targets" drift.
    // Exception: when injury is the sole reason LLM ran (intent was non-LLM), skip
    // structural validation — injury/advisory answers legitimately lack workout structure.
    const injuryForcedLlm = parsedInput.mentionsInjury && !llmIntents.has(routedIntent.intent);
    let usedDeterministicFallbackBecauseOfValidation = false;
    if (
      needsLlm &&
      !unsafe?.blocked &&
      !injuryForcedLlm &&
      (hasCriticalNutritionMismatch(validation.warnings) ||
        hasCriticalStructureMismatch(validation.warnings))
    ) {
      llmAnswer = deterministicAnswer;
      usedDeterministicFallbackBecauseOfValidation = true;
      onProgress?.('Đang dùng kế hoạch an toàn đã kiểm chứng');
    }

    traceLogger.end(trace, {
      retrievalEmpty: retrieval.isEmpty,
      warningCount: validation.warnings.length,
      promptTokens,
      completionTokens,
    });

    // Build evidence-used list from retrieved fitness_evidence docs
    const evidenceUsed: EvidenceUsed[] = evidenceDocs.map(d => {
      const m = d.metadata as any;
      return {
        title:       m.title ?? d.pageContent.slice(0, 80),
        source_url:  m.source_url ?? '',
        category:    m.category ?? d.category,
        source_type: m.source_type ?? 'curated_summary',
        summary:     d.pageContent.slice(0, 200),
      };
    });

    const adjustmentReasons: AdjustmentReason[] = bodyCompAnalysis.adjustments.map(a => ({
      metric:          a.metric,
      observed_value:  a.observed_value,
      interpretation:  a.interpretation,
      plan_adjustment: a.plan_adjustment,
    }));

    return {
      traceId: trace.traceId,
      answer: llmAnswer,
      responseLanguage: language.responseLanguage,
      usedFallback: retrieval.isEmpty,
      usedDeterministicFallbackBecauseOfValidation,
      missingFields: recommendation.missingFields,
      recommendation,
      retrieval: mergedRetrieval,
      finalPrompt: prompt,
      validationNotes: validation.warnings,
      promptTokens,
      completionTokens,
      totalTokens,
      routeIntent: routedIntent.intent,
      warningCount: validation.warnings.length,
      explicitLanguageLock: language.locked,
      // Evidence enrichment (optional backward-compat fields)
      adjustmentReasons: adjustmentReasons.length > 0 ? adjustmentReasons : undefined,
      evidenceUsed:      evidenceUsed.length > 0 ? evidenceUsed : undefined,
      safetyNotes:       bodyCompAnalysis.safetyNotes.length > 0 ? bodyCompAnalysis.safetyNotes : undefined,
    };
  },
};
