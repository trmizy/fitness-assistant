import { llmService } from "../services/llm.service";
import { runToolCallingTurn } from "./tools";
import { conversationRepository } from "../repositories/conversation.repository";
import { logger } from "@gym-coach/shared";
import {
  nutritionResponseSourceTotal,
  nutritionMacroValidationTotal,
  nutritionSafetyEscalationTotal,
  nutritionWeightConflictTotal,
  nutritionLlmInstructionOverrideTotal,
} from "@gym-coach/shared";
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
import {
  extractStatedWeightKg,
  requestsIgnoreSavedData,
  resolveWeightForCalculation,
  extractClaimedMacros,
  checkMacroCalorieConsistency,
  hasCalorieEstimationSignal,
  checkCalorieEstimationInputs,
  estimateTdee,
  mapGenderToBiologicalSex,
  mapActivityLevel,
} from "./nutrition_engine";
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
      safetyCheck.type === "medical_emergency" ||
      safetyCheck.type === "unsafe_ped_request" ||
      safetyCheck.type === "unsafe_extreme_calorie_request" ||
      safetyCheck.type === "severe_energy_restriction_warning" ||
      safetyCheck.type === "prompt_injection_attempt" ||
      safetyCheck.type === "medical_nutrition_condition" ||
      safetyCheck.type === "minor_age_nutrition_request" ||
      safetyCheck.type === "pregnancy_or_breastfeeding_nutrition_request" ||
      safetyCheck.type === "eating_disorder_disclosure" ||
      safetyCheck.type === "unsafe_weight_loss_behavior" ||
      safetyCheck.type === "severe_allergy_disclosure" ||
      safetyCheck.type === "prolonged_extreme_calorie_disclosure"
    ) {
      const answer =
        language.responseLanguage === "vi"
          ? safetyCheck.messageVi
          : safetyCheck.messageEn;
      // Part 12 observability: the nutrition-specific triage types (vs.
      // generic off_topic/medical_emergency/PED/prompt_injection, which
      // predate this pass and aren't nutrition-domain metrics) get their
      // own counter so escalation RATE by TYPE is queryable, not just
      // inferable from logs.
      const NUTRITION_SAFETY_TYPES = new Set([
        "medical_nutrition_condition",
        "minor_age_nutrition_request",
        "pregnancy_or_breastfeeding_nutrition_request",
        "eating_disorder_disclosure",
        "unsafe_weight_loss_behavior",
        "severe_allergy_disclosure",
        "prolonged_extreme_calorie_disclosure",
        "severe_energy_restriction_warning",
      ]);
      if (NUTRITION_SAFETY_TYPES.has(safetyCheck.type)) {
        nutritionSafetyEscalationTotal.inc({ type: safetyCheck.type });
      }
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        // Part 12: which layer produced this answer — a static safety-gate
        // template here, never the model or the DB.
        responseSource: "safety_gate",
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
    const [context, retrieval, chatHistory, memories] = await Promise.all([
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
              { userId, sessionId, usedFallback: false, excludeThumbsDown: true },
              5,
            )
          : Promise.resolve([]),
      ),
      timeAsync(timing, "memoriesMs", () =>
        userId
          ? conversationRepository.findMemoriesByUser(userId, 20)
          : Promise.resolve([]),
      ).catch((err) => {
        logger.warn(
          { error: safeErrorMessage(err), request_id: trace.traceId },
          "AI chat memory fetch failed; continuing without saved memories",
        );
        return [];
      }),
    ]);
    context.memories = memories;

    // Part 3 precedence fix: a weight the user states in THIS message must
    // be usable (with the conflict against the latest InBody explicitly
    // surfaced), not silently overridden by — or silently overriding — the
    // profile cache. This only affects THIS response's in-memory context
    // (context.profile is rebuilt fresh per request from profileExtractor);
    // it never writes back to InBody/UserProfile/baseline.
    const messageStatedWeightKg = extractStatedWeightKg(question);
    const ignoreSavedData = requestsIgnoreSavedData(question);
    const weightResolution = resolveWeightForCalculation({
      messageStatedWeightKg,
      ignoreSavedData,
      latestMeasurement: context.profile.inBody
        ? {
            weightKg: context.profile.inBody.weightKg,
            measuredAt: context.profile.inBody.measuredAt,
          }
        : undefined,
      profileCurrentWeightKg: context.profile.currentWeightKg,
    });
    if (weightResolution.weightKg != null) {
      context.profile = {
        ...context.profile,
        currentWeightKg: weightResolution.weightKg,
      };
    }
    if (weightResolution.conflict) {
      nutritionWeightConflictTotal.inc();
    }

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
          responseSource: "context_unavailable",
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
      nutritionResponseSourceTotal.inc({ source: "saved_data_lookup" });
      traceLogger.end(trace, {
        retrievalEmpty: true,
        warningCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        responseSource: "saved_data_lookup",
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
        responseSource: "context_unavailable",
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
        responseSource: "saved_data_lookup",
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

    // Root-cause fix (bug report Q3: "Đánh giá 3000 kcal, 150g protein,
    // 200g carb, 65g fat và kiểm tra tổng calo"): when the user states a
    // NEW set of calorie/macro numbers to be checked (not a stored
    // NutritionGoal — that path is handled separately in
    // nutrition_context.ts's formatTargets), compute the real Atwater
    // consistency check here and inject it as ground truth so the LLM
    // reports the actual discrepancy instead of doing its own arithmetic.
    const claimedMacros = extractClaimedMacros(question);
    const claimedMacroCheck =
      claimedMacros?.calories != null &&
      claimedMacros.proteinG != null &&
      claimedMacros.carbG != null &&
      claimedMacros.fatG != null
        ? checkMacroCalorieConsistency(
            claimedMacros.calories,
            claimedMacros.proteinG,
            claimedMacros.carbG,
            claimedMacros.fatG,
          )
        : undefined;
    if (claimedMacroCheck) {
      nutritionMacroValidationTotal.inc({
        context: "user_claim",
        result: claimedMacroCheck.consistent ? "consistent" : "inconsistent",
      });
    }

    // Part 4 root-cause fix: a calorie/TDEE-estimation question ("mình cần
    // bao nhiêu calo một ngày?") previously had no deterministic engine
    // behind it at all — the LLM was left to invent a number from
    // whatever profile fields happened to be in its prompt, silently
    // guessing past any gaps. Resolve the Mifflin-St Jeor inputs from the
    // (already weight-conflict-resolved) profile; when any required field
    // is missing, inject an explicit instruction to ask for exactly that
    // field instead of estimating — never a guessed number.
    const calorieEstimationRequested = hasCalorieEstimationSignal(question);
    const calorieEstimationInputsCheck = calorieEstimationRequested
      ? checkCalorieEstimationInputs({
          weightKg: weightResolution.weightKg,
          heightCm: context.profile.heightCm,
          age: context.profile.age,
          sex: mapGenderToBiologicalSex(context.profile.gender),
          activityLevel: mapActivityLevel(context.profile.activityLevel),
        })
      : undefined;
    const tdeeEstimate =
      calorieEstimationInputsCheck?.complete &&
      weightResolution.weightKg != null &&
      context.profile.heightCm != null &&
      context.profile.age != null
        ? estimateTdee({
            weightKg: weightResolution.weightKg,
            heightCm: context.profile.heightCm,
            age: context.profile.age,
            sex: mapGenderToBiologicalSex(context.profile.gender)!,
            activityLevel: mapActivityLevel(context.profile.activityLevel)!,
          })
        : undefined;

    // Body composition analysis - synchronous, runs after profile is available
    const bodyCompAnalysis = analyzeBodyComposition(context.profile);
    const bodyCompText = formatBodyCompAnalysis(bodyCompAnalysis);
    const coachContext = buildCoachContext(context);
    const coachContextText = JSON.stringify(
      sanitizeCoachContextForPrompt(coachContext),
    );
    const bodyCompAndCoachText = [
      bodyCompText,
      weightResolution.conflictNote
        ? `[Xung đột cân nặng] ${weightResolution.conflictNote} Dùng ${weightResolution.weightKg}kg (nguồn: ${weightResolution.source}) cho mọi tính toán trong câu trả lời này, và nêu rõ xung đột này với người dùng — không tự ý chọn số khác mà không giải thích.`
        : undefined,
      claimedMacroCheck
        ? `[Kiểm tra macro/calo — nguồn sự thật, KHÔNG tự tính lại]: Người dùng nêu ${claimedMacros!.calories} kcal với ${claimedMacros!.proteinG}g protein/${claimedMacros!.carbG}g carb/${claimedMacros!.fatG}g fat. Theo Atwater (4/4/9), tổng thực tế = ${claimedMacroCheck.computedCalories} kcal. ${claimedMacroCheck.consistent ? "Số liệu này nhất quán (trong sai số làm tròn)." : `KHÔNG khớp — chênh lệch ${Math.abs(claimedMacroCheck.discrepancyKcal)} kcal so với ${claimedMacros!.calories} kcal đã nêu. Bạn PHẢI nêu rõ sự không nhất quán này bằng đúng con số trên, không được bỏ qua hoặc tự tính lại khác đi.`}`
        : undefined,
      calorieEstimationInputsCheck && !calorieEstimationInputsCheck.complete
        ? `[Ước tính calo — thiếu dữ liệu, KHÔNG được đoán]: Người dùng hỏi về lượng calo cần thiết nhưng hồ sơ còn thiếu: ${calorieEstimationInputsCheck.missingFields.join(", ")}. Bạn PHẢI hỏi lại đúng các thông tin còn thiếu này trước khi đưa ra bất kỳ con số calo nào — TUYỆT ĐỐI không tự giả định hoặc ước lượng thay. Gợi ý câu hỏi: "${calorieEstimationInputsCheck.missingFieldsPromptVi}"`
        : undefined,
      tdeeEstimate
        ? `[Ước tính TDEE — nguồn sự thật, KHÔNG tự tính lại]: Theo công thức ${tdeeEstimate.formulaVersion}, BMR ≈ ${tdeeEstimate.bmrKcal} kcal, TDEE ≈ ${tdeeEstimate.tdeeKcal} kcal/ngày (khoảng ${tdeeEstimate.tdeeRangeLowKcal}-${tdeeEstimate.tdeeRangeHighKcal} kcal, hệ số vận động ${tdeeEstimate.activityMultiplier}). Đây là ƯỚC TÍNH, PHẢI trình bày dưới dạng khoảng (không phải một số chính xác tuyệt đối) và nêu rõ đây là công thức dự đoán, nên hiệu chỉnh dần theo cân nặng thực tế theo dõi 2-4 tuần.${tdeeEstimate.applicabilityWarnings.length > 0 ? ` LƯU Ý PHẠM VI ÁP DỤNG: ${tdeeEstimate.applicabilityWarnings.join(" ")}` : ""}`
        : undefined,
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

    // Surface the weight conflict in the deterministic fallback path too
    // (not just the LLM prompt) — this is the safety net used if the LLM
    // call fails or its answer is discarded by validation.
    if (weightResolution.conflictNote) {
      recommendation.assumptions = [
        weightResolution.conflictNote,
        ...recommendation.assumptions,
      ];
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
      "nutrient_timing_request",
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
      if (routedIntent.intent === "meal_plan_request") {
        nutritionLlmInstructionOverrideTotal.inc({ reason: "validation_mismatch" });
      }
    }

    // Part 12 observability: which layer actually produced this answer —
    // scoped to the nutrition intent so the metric is meaningful (not
    // diluted by every workout/general-knowledge answer too).
    if (routedIntent.intent === "meal_plan_request" && !nutritionIntent.enabled) {
      nutritionResponseSourceTotal.inc({
        source: usedDeterministicFallbackBecauseOfValidation
          ? "deterministic_fallback"
          : needsLlm
            ? "llm"
            : "deterministic_fallback",
      });
    }

    // Belt-and-braces (same principle as the mismatch fallback above, and
    // the Adaptive Nutrition Decision Engine's own override elsewhere in
    // this codebase): the ground-truth macro-consistency check was already
    // injected into the prompt as an instruction, but a local/small LLM
    // cannot be trusted to reliably FOLLOW that instruction (observed in
    // E2E testing: the model echoed the user's raw 3000/150/200/65 numbers
    // into a plan table without ever flagging that they don't add up). If
    // the claimed macros are inconsistent and the model's answer doesn't
    // already surface the real computed figure, append a deterministic,
    // always-correct correction — the engine's number wins regardless of
    // what the model chose to say.
    if (
      claimedMacroCheck &&
      !claimedMacroCheck.consistent &&
      !llmAnswer.includes(String(claimedMacroCheck.computedCalories))
    ) {
      const correction =
        language.responseLanguage === "vi"
          ? `\n\n⚠️ **Lưu ý về số liệu bạn nêu**: ${claimedMacros!.proteinG}g protein + ${claimedMacros!.carbG}g carb + ${claimedMacros!.fatG}g fat thực tế chỉ tương đương **${claimedMacroCheck.computedCalories} kcal** (theo công thức Atwater 4/4/9), không khớp với ${claimedMacros!.calories} kcal bạn đã nêu (chênh ${Math.abs(claimedMacroCheck.discrepancyKcal)} kcal). Bạn nên điều chỉnh lại một trong hai số để nhất quán.`
          : `\n\n⚠️ **Note on the numbers you gave**: ${claimedMacros!.proteinG}g protein + ${claimedMacros!.carbG}g carb + ${claimedMacros!.fatG}g fat actually total **${claimedMacroCheck.computedCalories} kcal** (Atwater 4/4/9), not the ${claimedMacros!.calories} kcal you stated (a ${Math.abs(claimedMacroCheck.discrepancyKcal)} kcal gap). You should adjust one of the two figures so they're consistent.`;
      llmAnswer = `${llmAnswer}${correction}`;
      nutritionLlmInstructionOverrideTotal.inc({ reason: "macro_discrepancy_not_cited" });
    }

    // Same belt-and-braces reasoning for Part 4: if the profile is missing
    // required calorie-calc fields and the model's answer doesn't actually
    // ask for any of them (e.g. it invented a number anyway), append the
    // deterministic missing-data prompt so the user is asked for real data
    // rather than silently handed a guess.
    if (
      calorieEstimationInputsCheck &&
      !calorieEstimationInputsCheck.complete &&
      !calorieEstimationInputsCheck.missingFields.some((field) =>
        llmAnswer.toLowerCase().includes(field.toLowerCase()),
      ) &&
      !/chiều cao|cân nặng|tuổi|giới tính|vận động|height|weight|age|gender|activity/i.test(
        llmAnswer,
      )
    ) {
      const askPrompt =
        language.responseLanguage === "vi"
          ? `\n\n📋 ${calorieEstimationInputsCheck.missingFieldsPromptVi}`
          : `\n\n📋 To estimate your daily calorie needs accurately, please share: ${calorieEstimationInputsCheck.missingFields.join(", ")}. I won't guess these to avoid giving you a misleading number.`;
      llmAnswer = `${llmAnswer}${askPrompt}`;
      nutritionLlmInstructionOverrideTotal.inc({ reason: "calorie_calc_missing_data_not_requested" });
    }

    // Belt-and-braces for Part 3's weight-conflict/override (same principle
    // as the two blocks above): resolveWeightForCalculation() already
    // injected a strict "[Xung đột cân nặng] ... Dùng {weightKg}kg ..."
    // instruction into the prompt, but a local/small LLM cannot be trusted
    // to reliably echo that exact number back in its own prose — real gap
    // found via E2E testing (tests/21-ai-nutrition-chat-routing.spec.ts,
    // Q5: "bỏ qua dữ liệu đã lưu, dùng 76kg"). The model sometimes computes
    // a genuinely correct estimate using the overridden weight but never
    // restates the number itself, leaving the user unable to tell which
    // weight was actually used. If the message-stated weight conflicted
    // with a saved measurement and the final answer doesn't mention that
    // number, append the deterministic note explicitly — the resolved
    // weight wins regardless of what the model chose to say.
    if (
      weightResolution.conflict &&
      weightResolution.weightKg != null &&
      !llmAnswer.includes(String(weightResolution.weightKg))
    ) {
      const usedNote =
        language.responseLanguage === "vi"
          ? `\n\n📏 **Cân nặng dùng để tính**: ${weightResolution.weightKg}kg (theo số bạn vừa cung cấp)${weightResolution.alternateWeightKg != null ? `, khác với số đo InBody gần nhất (${weightResolution.alternateWeightKg}kg)` : ""}.`
          : `\n\n📏 **Weight used for this calculation**: ${weightResolution.weightKg}kg (the value you just stated)${weightResolution.alternateWeightKg != null ? `, which differs from your latest InBody measurement (${weightResolution.alternateWeightKg}kg)` : ""}.`;
      llmAnswer = `${llmAnswer}${usedNote}`;
      nutritionLlmInstructionOverrideTotal.inc({ reason: "weight_override_not_cited" });
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

    // Part 12: trace which layer actually produced the final answer —
    // "llm" only if a real model call happened AND wasn't discarded by
    // validation; "deterministic_fallback" covers both "never needed the
    // LLM for this intent" and "LLM ran but got overridden".
    const finalResponseSource =
      needsLlm && !usedDeterministicFallbackBecauseOfValidation && !unsafe?.blocked
        ? "llm"
        : "deterministic_fallback";
    traceLogger.end(trace, {
      retrievalEmpty: retrieval.isEmpty,
      warningCount: validation.warnings.length,
      promptTokens,
      completionTokens,
      responseSource: finalResponseSource,
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
