import { llmService } from "../services/llm.service";
import { runToolCallingTurn } from "./tools";
import { conversationRepository } from "../repositories/conversation.repository";
import { logger } from "@gym-coach/shared";
import { inputParser } from "./input_parser";
import { intentRouter } from "./intent_router";
import { languageGuard } from "./language_guard";
import { safetyGuard } from "./safety_guard";
import { profileExtractor } from "./profile_extractor";
import type { PersonalizationContext } from "./profile_extractor";
import { retriever } from "./retriever";
import { recommendationEngine } from "./recommendation_engine";
import { promptBuilder } from "./prompt_builder";
import {
  answerValidator,
  hasCriticalNutritionMismatch,
  hasCriticalStructureMismatch,
} from "./answer_validator";
import { responseFormatter } from "./response_formatter";
import { labelLocalizer } from "./label_localizer";
import { traceLogger } from "./trace_logger";
import {
  analyzeBodyComposition,
  formatBodyCompAnalysis,
} from "./body_composition_rules";
import type {
  AdjustmentReason,
  AiChatTiming,
  EvidenceUsed,
  FinalAnswerPayload,
  LanguageDecision,
  RecommendationResult,
} from "./types";
import {
  buildWorkoutScheduleContextBlock,
  detectWorkoutScheduleIntent,
  formatWorkoutScheduleAnswer,
  workoutScheduleContextResolver,
} from "./workout_schedule_context";
import {
  buildNutritionContextBlock,
  detectNutritionLookupIntent,
  formatNutritionAnswer,
  nutritionContextResolver,
} from "./nutrition_context";
import { evidenceUsedFromDocs } from "./plan_evidence";
import {
  buildCoachContext,
  sanitizeCoachContextForPrompt,
} from "../coach/coach_context_builder";

/** Callback fired at each real pipeline milestone so callers can forward live status events. */
export type ProgressCallback = (message: string) => void;

const CONTEXT_TIMEOUT_MS = Number(process.env.AI_CHAT_CONTEXT_TIMEOUT_MS || "5000");
const RAG_TIMEOUT_MS = Number(process.env.AI_CHAT_RAG_TIMEOUT_MS || "8000");
const EVIDENCE_TIMEOUT_MS = Number(
  process.env.AI_CHAT_EVIDENCE_TIMEOUT_MS || "8000",
);
const LLM_TIMEOUT_MS = Number(
  process.env.AI_CHAT_LLM_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || "60000",
);
// Opt-in real tool-calling for the LLM-bound intents (Phase 2 of the AI
// readiness roadmap). Defaults off: the regex/deterministic routing this
// gates around already scores hitAtK=0.98 on the retrieval eval, so this is
// additive, not a replacement, and must be explicitly enabled per environment.
const ENABLE_TOOL_CALLING = process.env.ENABLE_TOOL_CALLING === "true";

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function timeAsync<T>(
  timing: Partial<AiChatTiming>,
  key: keyof AiChatTiming,
  task: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await task();
  } finally {
    if (key !== "requestId") {
      (timing as Record<string, unknown>)[key] = Date.now() - start;
    }
  }
}

function buildAiUnavailableFallback(language: LanguageDecision): string {
  if (language.responseLanguage === "vi") {
    return [
      "Tạm thời AI chưa sẵn sàng để phân tích chi tiết.",
      "Tôi đã ghi nhận yêu cầu phân tích InBody của bạn. Hãy thử lại sau khi AI service hoặc Ollama sẵn sàng.",
    ].join(" ");
  }

  return "The AI model is starting up or overloaded, so I cannot complete the detailed analysis right now. Please try again shortly.";
}

function foldForIntent(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d");
}

function isBodyCompositionQuestion(question: string): boolean {
  const q = foldForIntent(question);
  return /\b(inbody|bia|body composition|body fat|mo co the|phan tich co the|thanh phan co the)\b/i.test(
    q,
  );
}

function isTimeoutError(err: unknown): boolean {
  const message = safeErrorMessage(err);
  return /timeout|timed out|ECONNABORTED/i.test(message);
}

function buildDeterministicBodyCompFallback(
  language: LanguageDecision,
  bodyCompText: string,
  deterministicAnswer: string,
): string {
  const analysis = bodyCompText.trim() || deterministicAnswer.trim();
  if (language.responseLanguage === "vi") {
    return [
      "Tôi chưa dùng được LLM chi tiết lúc này, nên trả phân tích deterministic từ dữ liệu hiện có:",
      "",
      analysis,
      "",
      "Nếu kết quả chưa đủ cá nhân hóa, hãy kiểm tra Ollama rồi thử lại để nhận phần diễn giải đầy đủ hơn.",
    ].join("\n");
  }

  return [
    "The LLM is not ready right now, so here is the deterministic body-composition analysis from available data:",
    "",
    analysis,
    "",
    "If this is not detailed enough, check Ollama readiness and retry for the full narrative analysis.",
  ].join("\n");
}

function buildContextUnavailableFallback(
  language: LanguageDecision,
  contextName: "nutrition" | "workoutSchedule",
): string {
  if (language.responseLanguage === "vi") {
    return contextName === "nutrition"
      ? "Tạm thời tôi không tải được dữ liệu dinh dưỡng đã lưu. Vui lòng thử lại sau hoặc kiểm tra dịch vụ nutrition/AI."
      : "Tạm thời tôi không tải được lịch tập đã lưu. Vui lòng thử lại sau hoặc kiểm tra dịch vụ workout/AI.";
  }

  return contextName === "nutrition"
    ? "I could not load your saved nutrition context right now. Please try again shortly."
    : "I could not load your saved workout schedule right now. Please try again shortly.";
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptyPersonalizationContext(userId?: string): PersonalizationContext {
  return {
    profile: {
      userId,
      training: {
        trainingDaysPerWeek: undefined,
        availableEquipment: [],
        injuries: [],
        preferredTrainingDays: [],
      },
    },
    inBodyHistory: [],
    workoutHistory: [],
    nutritionHistory: [],
  };
}

function makeEarlyPayload(
  traceId: string,
  answer: string,
  language: LanguageDecision,
  routeIntent: string,
): FinalAnswerPayload {
  const emptyRec: RecommendationResult = {
    objective: "",
    nutrition: { formula: "none", confidence: "low" },
    workout: {
      split: "none",
      sessionsPerWeek: 0,
      focus: [],
      avoidedPatterns: [],
      assumptions: [],
    },
    meal: { template: "none", dailyMeals: 0, assumptions: [] },
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
    finalPrompt: "",
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
    sessionId?: string,
    onProgress?: ProgressCallback,
  ): Promise<FinalAnswerPayload> {
    const trace = traceLogger.start(question, userId);
    const requestStartedAt = Date.now();
    const timing: Partial<AiChatTiming> = {
      requestId: trace.traceId,
    };
    let fallbackReason: string | undefined;

    // Language detection is synchronous - resolve before any network I/O so early-exit
    // responses are returned in the correct locale.
    const language = languageGuard.resolve(question, userId);

    // Fast safety gate - runs before profile fetch and vector search.
    // Off-topic and medical emergency return immediately without hitting downstream services.
    const safetyCheck = safetyGuard.check(question);

    if (
      safetyCheck.type === "off_topic" ||
      safetyCheck.type === "medical_emergency"
    ) {
      const answer =
        language.responseLanguage === "vi"
          ? safetyCheck.messageVi
          : safetyCheck.messageEn;
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
      return makeEarlyPayload(
        trace.traceId,
        answer,
        language,
        safetyCheck.type,
      );
    }

    // Emit before any I/O - fires immediately after safety gate passes.
    onProgress?.("AI đang phân tích dữ liệu...");

    // Profile fetch (4 downstream HTTP calls) and Qdrant vector search run concurrently -
    // neither depends on the other, so parallelising saves ~150-300 ms per request.
    const preliminaryNutritionIntent = detectNutritionLookupIntent(question);
    const preliminaryScheduleIntent = preliminaryNutritionIntent.enabled
      ? { enabled: false }
      : detectWorkoutScheduleIntent(question);
    const [context, retrieval, chatHistory] = await Promise.all([
      timeAsync(timing, "profileContextMs", () =>
        withTimeout(
          profileExtractor.extract(userId, authHeader),
          CONTEXT_TIMEOUT_MS,
          "profile_context",
        ),
      ).catch((err) => {
        fallbackReason = "profile_context_unavailable";
        logger.warn(
          { error: safeErrorMessage(err), request_id: trace.traceId },
          "AI chat profile context failed; continuing with empty context",
        );
        return emptyPersonalizationContext(userId);
      }),
      timeAsync(timing, "ragTotalMs", () =>
        preliminaryNutritionIntent.enabled || preliminaryScheduleIntent.enabled
          ? Promise.resolve({
              documents: [],
              isEmpty: true,
              reason: preliminaryNutritionIntent.enabled
                ? "nutrition_schedule_lookup_skips_rag"
                : "workout_schedule_lookup_skips_rag",
            })
          : withTimeout(
              retriever.retrieveForChat(question),
              RAG_TIMEOUT_MS,
              "rag_retrieval",
            ),
      ).catch((err) => {
        fallbackReason = fallbackReason ?? "rag_unavailable";
        logger.warn(
          { error: safeErrorMessage(err), request_id: trace.traceId },
          "AI chat RAG retrieval failed; continuing without retrieved context",
        );
        return {
          documents: [],
          isEmpty: true,
          reason: "RAG retrieval failed or timed out",
        };
      }),
      timeAsync(timing, "chatHistoryMs", () =>
        userId
          ? conversationRepository.findMany(
              { userId, sessionId, usedFallback: false },
              5,
            )
          : Promise.resolve([]),
      ),
    ]);

    const nutritionIntent = detectNutritionLookupIntent(question, chatHistory);
    if (nutritionIntent.enabled) {
      const nutritionContext = await timeAsync(
        timing,
        "nutritionContextMs",
        () =>
          withTimeout(
            nutritionContextResolver.resolve(
              nutritionIntent,
              userId,
              authHeader,
            ),
            CONTEXT_TIMEOUT_MS,
            "nutrition_context",
          ),
      ).catch((err) => {
        fallbackReason = "nutrition_context_unavailable";
        logger.warn(
          { error: safeErrorMessage(err), request_id: trace.traceId },
          "AI chat nutrition context failed; returning deterministic context fallback",
        );
        return undefined;
      });
      if (!nutritionContext) {
        traceLogger.end(trace, {
          retrievalEmpty: true,
          warningCount: 1,
          promptTokens: 0,
          completionTokens: 0,
        });

        timing.totalMs = Date.now() - requestStartedAt;
        return {
          ...makeEarlyPayload(
            trace.traceId,
            buildContextUnavailableFallback(language, "nutrition"),
            language,
            "meal_plan_request",
          ),
          usedFallback: true,
          fallbackReason,
          timing: timing as AiChatTiming,
        };
      }
      nutritionContextResolver.debug(nutritionIntent, nutritionContext, userId);
      const answer = formatNutritionAnswer(
        nutritionContext,
        language.responseLanguage,
      );
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });

      timing.totalMs = Date.now() - requestStartedAt;
      return {
        ...makeEarlyPayload(
          trace.traceId,
          answer,
          language,
          "meal_plan_request",
        ),
        finalPrompt: buildNutritionContextBlock(nutritionContext),
        nutritionSchedule: {
          targetDate: nutritionContext.targetDate,
          mealType: nutritionContext.mealType,
          nutritionPlanName: nutritionContext.nutritionPlanName,
          plannedMealsFound: nutritionContext.plannedMealsFound,
          source: nutritionContext.source,
        },
        timing: timing as AiChatTiming,
      };
    }

    const scheduleIntent = detectWorkoutScheduleIntent(question, chatHistory);
    const workoutScheduleContext = scheduleIntent.enabled
      ? await timeAsync(timing, "scheduleContextMs", () =>
          withTimeout(
            workoutScheduleContextResolver.resolve(
              scheduleIntent,
              userId,
              authHeader,
            ),
            CONTEXT_TIMEOUT_MS,
            "workout_schedule_context",
          ),
        ).catch((err) => {
          fallbackReason = "workout_schedule_context_unavailable";
          logger.warn(
            { error: safeErrorMessage(err), request_id: trace.traceId },
            "AI chat workout schedule context failed; returning deterministic context fallback",
          );
          return undefined;
        })
      : undefined;

    if (scheduleIntent.enabled && !workoutScheduleContext) {
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 1,
        promptTokens: 0,
        completionTokens: 0,
      });

      timing.totalMs = Date.now() - requestStartedAt;
      return {
        ...makeEarlyPayload(
          trace.traceId,
          buildContextUnavailableFallback(language, "workoutSchedule"),
          language,
          "schedule_specific_day_request",
        ),
        usedFallback: true,
        fallbackReason,
        timing: timing as AiChatTiming,
      };
    }

    if (scheduleIntent.enabled && workoutScheduleContext) {
      if (process.env.DEBUG_INTENT_ROUTING === "true") {
        logger.info(
          {
            rawMessage: scheduleIntent.rawMessage,
            normalizedMessage: scheduleIntent.normalizedMessage,
            detectedIntent: "workout_schedule_lookup",
            intentReason: "workout_keyword_or_date_context",
            inheritedIntent: scheduleIntent.inheritedIntent ?? false,
            targetDate: scheduleIntent.targetDate,
            mealType: undefined,
            workoutLookupCalled: true,
            nutritionLookupCalled: false,
          },
          "AI coach intent routing resolved",
        );
      }
      workoutScheduleContextResolver.debug(
        scheduleIntent,
        workoutScheduleContext,
        userId,
      );
      const answer = formatWorkoutScheduleAnswer(
        workoutScheduleContext,
        language.responseLanguage,
      );
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });

      timing.totalMs = Date.now() - requestStartedAt;
      return {
        ...makeEarlyPayload(
          trace.traceId,
          answer,
          language,
          "schedule_specific_day_request",
        ),
        finalPrompt: buildWorkoutScheduleContextBlock(workoutScheduleContext),
        workoutSchedule: {
          activePlanName: workoutScheduleContext.activePlanName,
          planFrequency: workoutScheduleContext.planFrequency,
          targetDate: workoutScheduleContext.targetDate,
          targetDayOfWeek: workoutScheduleContext.targetDayOfWeek,
          scheduledWorkoutFound: workoutScheduleContext.scheduledWorkoutFound,
          source: workoutScheduleContext.source,
        },
        timing: timing as AiChatTiming,
      };
    }

    // Body composition analysis - synchronous, runs after profile is available
    const bodyCompAnalysis = analyzeBodyComposition(context.profile);
    const bodyCompText = formatBodyCompAnalysis(bodyCompAnalysis);
    const coachContext = buildCoachContext(context);
    const coachContextText = JSON.stringify(
      sanitizeCoachContextForPrompt(coachContext),
    );
    const bodyCompAndCoachText = [
      bodyCompText,
      `CoachContext JSON (sanitized, no user identity):\n${coachContextText}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Retrieve evidence from fitness_evidence collection using body-comp-specific queries.
    // Runs after profile so queries can be shaped by the analysis. Best-effort: no throw.
    const evidenceDocs = await timeAsync(timing, "evidenceMs", () =>
      withTimeout(
        retriever.retrieveEvidence(bodyCompAnalysis.evidenceQueries),
        EVIDENCE_TIMEOUT_MS,
        "body_composition_evidence",
      ),
    ).catch((err) => {
      fallbackReason = fallbackReason ?? "evidence_unavailable";
      logger.warn(
        { error: safeErrorMessage(err), request_id: trace.traceId },
        "AI chat evidence retrieval failed; continuing without evidence enrichment",
      );
      return [];
    });

    onProgress?.("AI đang đối chiếu ngữ cảnh và bằng chứng...");

    const routedIntent = intentRouter.route(question, context.profile);
    const parsedInput = inputParser.parse(question, context.profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;

    const unsafe =
      safetyCheck.type === "unsafe_weight_loss"
        ? safetyCheck.guidance
        : undefined;
    const recommendation = recommendationEngine.recommend(
      context.profile,
      parsedInput,
      language.responseLanguage,
    );

    if (unsafe?.blocked) {
      recommendation.unsafeGuidance = unsafe;
      recommendation.responseIntent = "unsafe_weight_loss_request";
    }

    const deterministicAnswer = responseFormatter.format(
      recommendation,
      language.responseLanguage,
    );

    let llmAnswer = deterministicAnswer;
    let prompt = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    // Intents that go through LLM for richer narrative and context-aware responses.
    // Workout plan + frequency change remain deterministic to enforce hard constraints
    // (day count, min exercises). Recomp and meal requests go through LLM because they
    // Keep general-knowledge follow-ups in LLM path because they often carry contextual nuance.
    // that the static formatter cannot address. Injury mentions also force LLM path so
    // the model can adapt the plan narrative around the user's pain points.
    const llmIntents = new Set([
      "general_fitness_knowledge",
      "schedule_specific_day_request",
      "body_recomposition_request",
      "meal_plan_request",
      "combined_plan_request",
    ]);

    const needsLlm =
      llmIntents.has(routedIntent.intent) || parsedInput.mentionsInjury;
    const bodyCompositionQuestion = isBodyCompositionQuestion(question);

    // Merge evidence docs into retrieval so compactRetrieval() can format citations
    const mergedRetrieval =
      evidenceDocs.length > 0
        ? {
            ...retrieval,
            documents: [...retrieval.documents, ...evidenceDocs],
            isEmpty: false,
          }
        : retrieval;

    if (needsLlm && !unsafe?.blocked) {
      onProgress?.("AI đang tạo câu trả lời cá nhân hóa...");
      prompt = await timeAsync(timing, "promptBuildMs", async () =>
        promptBuilder.build(
          question,
          parsedInput,
          context,
          mergedRetrieval,
          recommendation,
          language.responseLanguage,
          chatHistory,
          bodyCompAndCoachText || undefined,
        ),
      );
      try {
        const llmCallOpts = {
          timeoutMs: LLM_TIMEOUT_MS,
          temperature: routedIntent.intent === "general_fitness_knowledge" ? 0.2 : undefined,
          numPredict: bodyCompositionQuestion
            ? 650
            : routedIntent.intent === "general_fitness_knowledge"
              ? 420
              : undefined,
        };
        const llmResponse = await timeAsync(timing, "llmGenerateMs", () =>
          ENABLE_TOOL_CALLING
            ? runToolCallingTurn(prompt, context, llmCallOpts)
            : llmService.callLLM(prompt, llmCallOpts),
        );
        llmAnswer = labelLocalizer.localize(
          llmResponse.answer,
          language.responseLanguage,
        );
        promptTokens = llmResponse.promptTokens;
        completionTokens = llmResponse.completionTokens;
        totalTokens = llmResponse.totalTokens;
      } catch (err) {
        const useBodyCompDeterministicFallback =
          bodyCompositionQuestion && (bodyCompText.trim() || deterministicAnswer.trim());
        fallbackReason =
          useBodyCompDeterministicFallback && isTimeoutError(err)
            ? "llm_timeout_deterministic_body_comp"
            : "llm_unavailable";
        logger.warn(
          {
            error: safeErrorMessage(err),
            request_id: trace.traceId,
            route: routedIntent.intent,
          },
          "AI chat LLM generation failed; using deterministic fallback",
        );
        llmAnswer = useBodyCompDeterministicFallback
          ? buildDeterministicBodyCompFallback(
              language,
              bodyCompText,
              deterministicAnswer,
            )
          : buildAiUnavailableFallback(language);
      }
    }

    const validation = await timeAsync(timing, "validationMs", async () =>
      answerValidator.validate(
        llmAnswer,
        recommendation,
        language.responseLanguage,
        context.profile,
      ),
    );

    // If the LLM answer contains nutrition numbers that differ materially from the
    // deterministic targets, discard it and use the deterministic answer instead.
    // This prevents the "185g protein in headline / 133g in targets" drift.
    // Exception: when injury is the sole reason LLM ran (intent was non-LLM), skip
    // structural validation - injury/advisory answers legitimately lack workout structure.
    const injuryForcedLlm =
      parsedInput.mentionsInjury && !llmIntents.has(routedIntent.intent);
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
      fallbackReason = "validation_fallback";
      onProgress?.("Đang dùng kế hoạch an toàn đã kiểm chứng.");
    }

    timing.totalMs = Date.now() - requestStartedAt;
    logger.info(
      {
        request_id: trace.traceId,
        user_id_present: Boolean(userId),
        route: routedIntent.intent,
        timing,
        fallback_used: Boolean(fallbackReason || retrieval.isEmpty),
        fallback_reason: fallbackReason,
        error_type: fallbackReason,
      },
      "AI chat timing",
    );

    traceLogger.end(trace, {
      retrievalEmpty: retrieval.isEmpty,
      warningCount: validation.warnings.length,
      promptTokens,
      completionTokens,
    });

    // Build evidence-used list from all retrieved fitness_evidence docs, including
    // chat RAG hits and body-composition-specific enrichment.
    const evidenceUsed: EvidenceUsed[] = evidenceUsedFromDocs(
      mergedRetrieval.documents.filter(
        (doc) => doc.source === "qdrant:fitness_evidence",
      ),
    );

    const adjustmentReasons: AdjustmentReason[] =
      bodyCompAnalysis.adjustments.map((a) => ({
        metric: a.metric,
        observed_value: a.observed_value,
        interpretation: a.interpretation,
        plan_adjustment: a.plan_adjustment,
      }));

    return {
      traceId: trace.traceId,
      answer: llmAnswer,
      responseLanguage: language.responseLanguage,
      usedFallback: Boolean(fallbackReason || retrieval.isEmpty),
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
      timing: timing as AiChatTiming,
      fallbackReason,
      // Evidence enrichment (optional backward-compat fields)
      adjustmentReasons:
        adjustmentReasons.length > 0 ? adjustmentReasons : undefined,
      evidenceUsed: evidenceUsed.length > 0 ? evidenceUsed : undefined,
      safetyNotes:
        bodyCompAnalysis.safetyNotes.length > 0
          ? bodyCompAnalysis.safetyNotes
          : undefined,
    };
  },
};
