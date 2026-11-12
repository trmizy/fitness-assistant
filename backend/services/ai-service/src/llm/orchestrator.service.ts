import { llmService, LLM_PROVIDER } from "../services/llm.service";
import { runToolCallingTurn } from "./tools";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { ciMode } from "../conversational-intelligence";
import { reminder as pendingWorkflowReminder } from "../conversational-intelligence/global/global-turn";
import { describeTransition, snapshotTurnState } from "../conversational-intelligence/global/turn-state";
import { conversationRepository } from "../repositories/conversation.repository";
import { persistDeterministicMemoryCandidates } from "./memory_extraction";
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
import { selectPromptMemories } from "./memory_selection";
import { removeUnsupportedUserClaims } from "./context_fidelity_guard";
import { applyTurnFacts, extractTurnFacts, formatTurnFactsForPrompt } from "./turn_facts";
import { enforceExerciseConstraints } from "./exercise_constraint_guard";
import { groundBmiClaims } from "./bmi_claim_guard";
import { groundIntakeClaims } from "./intake_claim_guard";
import { stripInternalReferences } from "./output_hygiene";
import { fitToBudget, planContext } from "./context_plan";
import { detectMythClaims, formatClaimRulesForPrompt } from "./claim_rules";
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
import { appendMedicalReferralNote, appendMinorSupervisionNote, minorGeneralInfoPromptNote } from "./medical-referral";
import { isMinorGeneralKnowledgeQuestion } from "./safety_guard";
import { needsProfileAgeForMinorPolicy } from "./minor_safety_policy";
import {
  isDirectNutritionQuestion,
  formatDirectNutritionAnswer,
  stripTemplateArtifacts,
  isPersonalQuestion,
  isPersonalDailyTargetQuestion,
  isCalculationExplanationQuestion,
  parseWeightChangeGoal,
  formatWeightChangeAnswer,
  parseMealSplit,
  formatMealSplitAnswer,
  parseStatedKcalComparison,
  formatStatedKcalComparison,
  isFollowUpMacroQuestion,
  formatCalculationExplanation,
  nutritionValidationMode,
} from "./nutrition_answer_mode";
import { labelLocalizer } from "./label_localizer";
import { detectThirdPartyClientQuestion, thirdPartyDeterministicAnswer } from "./third_party_question";
import { detectMetaQuestion, metaAnswer } from "./meta_question";
import { explainMaintenanceEstimate } from "./nutrition_calculator";
import { estimateDayMacros, formatDayEstimate, isDayMacroRequest } from "../services/day-macro-estimate";
import { isPtProposalRequest } from "../services/pt-copilot-proposals";
import { traceLogger } from "./trace_logger";
import {
  analyzeBodyComposition,
  computeBmi,
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

/** Safety answers about cutting calories / losing weight that must change when the profile says the user is a minor. */
const PROFILE_AGE_SENSITIVE_SAFETY_TYPES = new Set<string>([
  "unsafe_extreme_calorie_request",
  "severe_energy_restriction_warning",
  "unsafe_weight_loss_behavior",
  "prolonged_extreme_calorie_disclosure",
]);
/** Folded text: skipping meals / fasting, "N kg in <short time>", crash wording, slimming pills — read with the profile age above. */
const AGGRESSIVE_WEIGHT_LOSS_PLAN = /\b(nhin (an|bua|doi|toi|sang|trua)|bo bua|giam \d{1,2} ?kg (trong|sau|chi) (\d|mot|hai|ba|1)|cap toc|that nhanh|thuoc giam can|tra giam can|an kieng khat khe|chi an (1|mot) bua)\b/;

/** Appended to the prompt for the single retry after a wrong "out of scope" refusal of a general coaching question. */
function scopeRetryNote(lang: string): string {
  return lang === "en"
    ? "Note: this question IS within a personal trainer's scope (motivation, habits, the mindset around training, sleep, recovery, body image while training). Answer it directly and practically in 4-6 sentences, using the user's profile where relevant. Only suggest a mental-health professional if the user describes serious distress."
    : "Lưu ý: câu hỏi này NẰM TRONG phạm vi của một huấn luyện viên cá nhân (động lực, thói quen, tâm lý khi tập luyện, giấc ngủ, phục hồi, hình ảnh cơ thể khi tập). Hãy trả lời trực tiếp, thực tế trong 4-6 câu, dựa trên hồ sơ của người dùng khi liên quan. Chỉ gợi ý gặp chuyên gia tâm lý nếu người dùng mô tả tình trạng nghiêm trọng.";
}

/** Folded text: a weight-loss / diet goal. Read with the profile age too, so a minor who does not state their age still gets the minor guidance (eval B2-44). */
const WEIGHT_LOSS_GOAL = /\b(giam can|giam mo|giam ky|giam beo|an kieng|weight loss|lose weight|fat loss)\b/;

/**
 * The question-only safety detector cannot see the profile. A user who is a MINOR by profile age gets the minors' triage
 * (parent + paediatric professional) when the turn is one the minor policy never answers personally:
 *  - energy restriction / weight loss (SF-D1/SF-D2, 2026-11-08: a 16-year-old got the adult deficit answer);
 *  - V1 RC 2026-11-12 (minor_safety_policy.ts): personal frequency/intensity/load advice, a plan request or high-risk wording —
 *    "Tạo lịch tập 6 buổi cường độ cao cho tôi" from a 16-year-old profile used to be "safe" and reached the plan agent, and
 *    "Tôi 19 tuổi, …" against a 16-year-old profile must keep the minor reading (conservative).
 * The profile is only read on such turns (`getProfileAge` is never called for anything else). A failed lookup keeps the
 * question-only result (logged).
 */
export async function resolveProfileAwareSafety(
  question: string,
  safetyCheck: ReturnType<typeof safetyGuard.check>,
  getProfileAge: () => Promise<number | null | undefined>,
): Promise<ReturnType<typeof safetyGuard.check>> {
  if (safetyCheck.type === "minor_age_nutrition_request") return safetyCheck;
  const folded = question.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  const isSafe = safetyCheck.type === "safe";
  const aggressiveWeightLossPlan = isSafe && (AGGRESSIVE_WEIGHT_LOSS_PLAN.test(folded) || WEIGHT_LOSS_GOAL.test(folded));
  const minorPolicyTurn = isSafe && needsProfileAgeForMinorPolicy(question);
  if (!PROFILE_AGE_SENSITIVE_SAFETY_TYPES.has(safetyCheck.type) && !aggressiveWeightLossPlan && !minorPolicyTurn) return safetyCheck;
  try {
    const age = await getProfileAge();
    if (typeof age === "number" && age > 0 && age < 18) return safetyGuard.minorAgeResult();
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[safety] profile age lookup failed; question-only safety result kept");
  }
  return safetyCheck;
}

/** Minor prompt note + supervision line: a minor by the MESSAGE asking a general question, or a minor by PROFILE/TurnFacts. */
export function shouldAddMinorSupervision(question: string, minorProtected: boolean): boolean {
  return isMinorGeneralKnowledgeQuestion(question) || minorProtected;
}

export function buildAiUnavailableFallback(language: LanguageDecision): string {
  if (language.responseLanguage === "vi") {
    // Batch 5 defect fix: this used to claim "Tôi đã ghi nhận yêu cầu phân tích InBody của bạn" for EVERY unavailable turn, a false
    // statement for any other question. The fallback now says only what is true: no answer was generated, and nothing was recorded or changed.
    return [
      "Tạm thời AI chưa sẵn sàng để trả lời câu hỏi này.",
      "Mình chưa ghi nhận hay thay đổi gì — bạn thử lại sau ít phút nhé.",
    ].join(" ");
  }

  return "The AI model is starting up or overloaded, so I cannot answer this right now. Nothing was recorded or changed. Please try again shortly.";
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

export function isFitnessScopeRefusal(answer: string): boolean {
  const q = foldForIntent(answer);
  const apologyOrRefusal =
    /\b(xin loi|sorry|khong the ho tro|khong the ho tro chinh xac|wouldn'?t be able|cannot help)\b/i.test(
      q,
    );
  const fitnessScopeClaim =
    /(chi ho tro|only support|specialized in|chuyen ve).{0,120}(fitness|the hinh|tap luyen|suc khoe|dinh duong|physical health)|ngoai linh vuc|outside (my )?(area|scope)/i.test(
      q,
    );
  return apologyOrRefusal && fitnessScopeClaim;
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
  const analysis = localizeBodyCompTextForFallback(
    language,
    bodyCompText.trim() || deterministicAnswer.trim(),
  );
  if (language.responseLanguage === "vi") {
    return [
      "AI hiện chưa thể tạo phần diễn giải chi tiết. Dưới đây là phân tích theo các quy tắc từ dữ liệu hiện có:",
      "",
      analysis,
      "",
      "Bạn có thể thử lại sau để nhận phần diễn giải chi tiết hơn.",
    ].join("\n");
  }

  return [
    "AI cannot generate a detailed explanation right now. Here is a rule-based body-composition analysis from the available data:",
    "",
    analysis,
    "",
    "Please try again later for a more detailed explanation.",
  ].join("\n");
}

function localizeBodyCompTextForFallback(
  language: LanguageDecision,
  text: string,
): string {
  if (language.responseLanguage !== "vi") return text;
  return text.replace(
    "No InBody/DXA data available. Using self-reported profile weight. Body composition estimates will be less accurate. Recommend measuring InBody for better personalization.",
    "Chưa tìm thấy dữ liệu InBody/DXA trong hồ sơ hiện tại. Nếu bạn vừa cập nhật InBody, hãy đồng bộ lại dữ liệu hoặc thử lại sau ít phút; nếu chưa có, hãy thêm lần đo InBody để phân tích cá nhân hóa chính xác hơn.",
  );
}

function buildVerifiedBodyCompFallback(
  language: LanguageDecision,
  bodyCompText: string,
  deterministicAnswer: string,
): string {
  const analysis = localizeBodyCompTextForFallback(
    language,
    bodyCompText.trim() || deterministicAnswer.trim(),
  );
  if (language.responseLanguage === "vi") {
    return [
      "Mình đã nhận diện đây là yêu cầu phân tích InBody/hồ sơ cơ thể.",
      "",
      analysis,
    ].join("\n");
  }

  return [
    "I recognized this as a body-composition/InBody analysis request.",
    "",
    analysis,
  ].join("\n");
}

function buildVerifiedFitnessFallback(
  language: LanguageDecision,
  deterministicAnswer: string,
): string {
  if (language.responseLanguage === "vi") {
    return [
      "Mình đã nhận diện đây là câu hỏi thuộc phạm vi tập luyện/sức khỏe.",
      "",
      deterministicAnswer.trim(),
    ].join("\n");
  }

  return [
    "I recognized this as a training or physical-health question.",
    "",
    deterministicAnswer.trim(),
  ].join("\n");
}

function buildInjuryScopeFallback(language: LanguageDecision): string {
  if (language.responseLanguage === "vi") {
    return [
      "Mình đã nhận diện đây là câu hỏi về chấn thương/đau khi tập.",
      "",
      "## Việc nên làm ngay",
      "1. Dừng các bài làm đau vai, đặc biệt là đẩy vai, bench press nặng, dips, upright row hoặc động tác đưa tay qua đầu.",
      "2. Không cố tập xuyên đau. Nếu đau sắc, yếu tay, tê lan, sưng/bầm rõ, hoặc đau sau té/ngã, hãy đi khám bác sĩ/chuyên gia vật lý trị liệu.",
      "3. Trong 24-48 giờ đầu, ưu tiên nghỉ tương đối, ngủ đủ, và chỉ vận động nhẹ trong biên độ không đau.",
      "",
      "## Khi quay lại tập",
      "- Tập thân dưới, core nhẹ, đi bộ/cardio nhẹ nếu không làm vai đau.",
      "- Với vai, chỉ bắt đầu bằng bài phục hồi rất nhẹ như external rotation bằng dây, scapular retraction, wall slide trong biên độ không đau.",
      "- Giảm tải ít nhất 30-50% khi tập lại và tăng dần nếu không đau trong/sau buổi tập.",
      "",
      "Bạn cho mình biết đau ở vị trí nào của vai, đau khi làm động tác nào, mức đau 0-10, và chấn thương xảy ra từ khi nào nhé.",
    ].join("\n");
  }

  return [
    "I recognized this as an injury/pain question.",
    "",
    "Stop movements that provoke shoulder pain, avoid pressing or overhead work for now, and seek medical/physio care if pain is sharp, spreading, associated with weakness/numbness, visible swelling/bruising, or followed a fall.",
    "",
    "You can keep training pain-free lower-body, light core, and easy cardio. For the shoulder, restart only with very light pain-free rehab work, then ramp load gradually.",
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

// "Đau cơ sau khi tập 1-2 ngày có bình thường không?" — "1-2 ngày" is a duration, not the date 1/2 (coach TK-04, 2026-11-08:
// answered "Mình chưa thấy lịch tập cụ thể được lưu cho Chủ Nhật 2026-02-01").
// Also: frequency ADVICE ("Vậy một tuần nên tập mấy buổi?") is not a lookup of the saved schedule (coach MT-1, 2026-11-08:
// "Mình chưa thấy lịch tập cụ thể được lưu cho Chủ Nhật 2026-11-08").
function isDurationNotDate(question: string): boolean {
  const noDateWord = !/(lịch|lich|ngày\s*\d{1,2}\s*\/|ngay\s*\d{1,2}\s*\/|thứ\s*\d|thu\s*\d|hôm nay|hôm qua|ngày mai)/i.test(question);
  const durationRange = /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*(ngày|ngay|tuần|tuan|tháng|thang|hôm|hom)\b/i.test(question);
  const frequencyAdvice = /(^|\s)nên(\s|$)/iu.test(question) && /(mấy|bao nhiêu)\s+(buổi|lần|ngày)/iu.test(question);
  return noDateWord && (durationRange || frequencyAdvice);
}

function isYesNoKnowledgeQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  // (JS \b is ASCII-only, so "có" is delimited by whitespace explicitly)
  return /(^|\s)có\s.{2,60}\skhông\s*[?.!]*$/u.test(q) &&!/(gợi ý|tạo|lên lịch|lên giáo án|cho (tôi|mình|em)|bài nào|tập gì|nên tập|giáo án|lịch tập)/u.test(q);
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

async function runInner(
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
    let safetyCheck = safetyGuard.check(question);
    if (userId) {
      safetyCheck = await resolveProfileAwareSafety(question, safetyCheck, async () => (await profileExtractor.extract(userId, authHeader)).profile?.age);
    }

    // ADV-003 (docs/codex-ai-agent-regression-3-report.md) — deterministic
    // memory-write provenance (see memory_extraction.ts's own doc comment).
    // Placed here, before every downstream early-return branch, so it runs
    // on every real authenticated chat turn regardless of intent routing —
    // this is now the ONLY path that can create a durable UserMemory row
    // from a live chat turn (the LLM can no longer trigger a write via
    // tool-calling, see tools.ts's AVAILABLE_TOOLS comment). Fire-and-forget:
    // never awaited into the response, never allowed to affect the chat
    // answer or its latency.
    void persistDeterministicMemoryCandidates(userId, question, {
      knownPromptInjection: safetyCheck.type === "prompt_injection_attempt",
    }).catch((err) => logger.warn({ err: (err as Error)?.message, userId }, "[memory-provenance] unexpected error; chat turn unaffected"));

    if (
      safetyCheck.type === "off_topic" ||
      safetyCheck.type === "medical_emergency" ||
      safetyCheck.type === "post_exercise_symptoms" ||
      safetyCheck.type === "medical_diagnosis_request" ||
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

    // Questions about the assistant itself / clearly off-topic (meta_question.ts): answered directly instead of the model's
    // out-of-scope refusal being replaced by the profile overview.
    const metaKind = detectMetaQuestion(question);
    if (metaKind) {
      traceLogger.end(trace, { retrievalEmpty: true, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "meta_question" });
      return makeEarlyPayload(trace.traceId, metaAnswer(metaKind, language.responseLanguage === "vi" ? "vi" : "en"), language, `meta_${metaKind}`);
    }

    // A PT asking ABOUT a client (third_party_question.ts): a plan request is not executed on the PT's own account and a question
    // about the client's numbers gets an honest answer (client data is not reachable here). PT Copilot proposals keep their path.
    const thirdParty = detectThirdPartyClientQuestion(question);
    if (thirdParty && thirdParty.kind !== "coaching" && !isPtProposalRequest(question)) {
      const answer = thirdPartyDeterministicAnswer(thirdParty, question)!;
      traceLogger.end(trace, { retrievalEmpty: true, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "third_party_guard" });
      return makeEarlyPayload(trace.traceId, answer, language, "third_party_guard");
    }

    // "Hôm nay tôi ăn …, tính macro giúp" (day-macro-estimate.ts): per-item + total macros from real food data, compared with
    // the saved goal; read-only — the block's "Lưu vào nhật ký" is the user's explicit save.
    if (userId && isDayMacroRequest(question)) {
      const estimate = await estimateDayMacros({ userId, authorizationHeader: authHeader }, question);
      traceLogger.end(trace, { retrievalEmpty: true, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "day_macro_estimate" });
      return { ...makeEarlyPayload(trace.traceId, formatDayEstimate(estimate), language, "day_macro_estimate"), structuredBlocks: [{ type: "NUTRITION_DAY_ESTIMATE", estimate }] };
    }

    // Emit before any I/O - fires immediately after safety gate passes.
    if (userId && sessionId) {
      const agentResult = await fitnessAgent.tryTurn(question, { userId, authorizationHeader: authHeader }, sessionId, trace.traceId);
      if (agentResult) {
        traceLogger.end(trace, { retrievalEmpty: false, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "fitness_agent" });
        return { ...makeEarlyPayload(trace.traceId, agentResult.answer, language, "fitness_agent"), structuredBlocks: agentResult.blocks };
      }
    }
    onProgress?.("AI đang phân tích dữ liệu...");

    // Profile fetch (4 downstream HTTP calls) and Qdrant vector search run concurrently -
    // neither depends on the other, so parallelising saves ~150-300 ms per request.
    const preliminaryNutritionIntent = detectNutritionLookupIntent(question);
    const preliminaryScheduleIntent = preliminaryNutritionIntent.enabled || isDurationNotDate(question)
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
    // Saved memories are NOT injected wholesale any more: memory_selection.ts quarantines rows the current write policy would
    // reject (questions/hypotheticals saved by the old keyword policy) and keeps only rows whose domain matches this turn,
    // once the intent is known (below). Nothing is deleted.
    const storedMemories = memories;
    context.memories = [];
    // Coaching question about a client: answer without the ASKER's personal context, so nothing of the PT's own profile, goal or
    // history is presented as the client's (pt-r1: "học viên của bạn… với cân nặng hiện tại 70kg").
    if (thirdParty) {
      const blank = emptyPersonalizationContext(userId);
      context.profile = blank.profile;
      context.inBodyHistory = [];
      context.workoutHistory = [];
      context.nutritionHistory = [];
      context.memories = [];
    }

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

    // TurnFacts (turn_facts.ts): age / equipment / experience / time / injuries the user STATED in this message or earlier in
    // this session win over the saved profile for THIS answer only (in memory, never persisted) — the same precedence the
    // weight already had. The deterministic engines below then build from the stated constraints too.
    const sessionUserMessages = Array.isArray(chatHistory) ? chatHistory.map((e: any) => String(e?.question ?? "")).filter(Boolean) : [];
    const turnFacts = thirdParty ? { conflicts: [] } : extractTurnFacts(question, { sessionUserMessages, profile: context.profile });
    // Injury on record for the fidelity guard: saved profile injuries or one the user ASSERTED (never a hypothetical, never memory).
    const injuryOnRecord = (context.profile?.training?.injuries?.length ?? 0) > 0
      || Boolean((turnFacts as any).injuries && (turnFacts as any).injuries.source !== "profile" && ((turnFacts as any).injuries.status ?? "ASSERTED") === "ASSERTED" && (turnFacts as any).injuries.value?.length);
    if (!thirdParty) context.profile = applyTurnFacts(context.profile, turnFacts);
    const turnFactsText = formatTurnFactsForPrompt(turnFacts);

    // "Còn protein thì sao?" asks for the user's own target, not for the saved meal plan (expert review H22, 2026-11-08).
    const nutritionIntent = isFollowUpMacroQuestion(question) ? { ...detectNutritionLookupIntent(question, chatHistory), enabled: false } : detectNutritionLookupIntent(question, chatHistory);
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

    const detectedScheduleIntent = detectWorkoutScheduleIntent(question, chatHistory);
    const scheduleIntent = isDurationNotDate(question) ? { ...detectedScheduleIntent, enabled: false } : detectedScheduleIntent;
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
    // Deterministic "source of truth" notes — always kept (small, correctness-critical). The body-composition analysis and the
    // CoachContext JSON are added below only when the context plan asks for them (context_plan.ts).
    const deterministicNotes = [
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
    ].filter((x): x is string => Boolean(x));

    // Evidence from fitness_evidence with body-comp-specific queries (shaped by the PROFILE, not the question). Best-effort,
    // and only fetched when the context plan needs it (below) — not for "Plank nên giữ bao lâu?".
    const fetchBodyCompEvidence = () => timeAsync(timing, "evidenceMs", () =>
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
    // The user's own daily fat amount routes like their protein/carb/kcal amount (direct answer from the saved goal).
    if (routedIntent.intent === "general_fitness_knowledge" && isPersonalDailyTargetQuestion(question)) routedIntent.intent = "meal_plan_request";
    // A yes/no question about an effect ("Tập bụng nhiều có giảm mỡ bụng không?") asks for knowledge, not for a workout routine
    // (coach TK-06, 2026-11-08: answered with a full core session; the spot-reduction answer was buried in the template).
    if (routedIntent.intent === "muscle_group_routine_request" && isYesNoKnowledgeQuestion(question)) routedIntent.intent = "general_fitness_knowledge";
    // "Nếu tôi bắt đầu tập tạ 3 buổi mỗi tuần thì có cần ăn thêm không?" is about EATING: it got a workout schedule (expert human
    // review H02, 2026-11-08) — a yes/no question about food/energy on a workout route goes to the nutrition answer instead.
    if (/workout|routine|frequency|program|training/.test(String(routedIntent.intent)) && isYesNoKnowledgeQuestion(question)
      && /\b(an|an them|calo|kcal|protein|dam|dinh duong|nang luong)\b/.test(foldForIntent(question))) routedIntent.intent = "meal_plan_request";
    const parsedInput = inputParser.parse(question, context.profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;
    const memorySelection = thirdParty
      ? { selected: [], quarantined: 0, irrelevant: storedMemories.length }
      : selectPromptMemories(storedMemories, { question, intent: routedIntent.intent });
    context.memories = memorySelection.selected;
    // An impersonal knowledge question that merely mentions a goal ("Nhịn ăn 16:8 có giảm mỡ tốt hơn…?") is not a personal
    // what-if: without this the calculator recomputed fat-loss targets and the answer presented them as the user's current
    // numbers (Opus judge, KN-08 2026-11-08: "calo hiện tại của bạn là 1630 kcal" while the saved goal was 1852 kcal).
    if (!isPersonalQuestion(question) && !parsedInput.statedCalories && !parsedInput.statedProteinGrams) parsedInput.goalStatedInQuestion = false;

    const unsafe =
      safetyCheck.type === "unsafe_weight_loss"
        ? safetyCheck.guidance
        : undefined;
    const recommendation = recommendationEngine.recommend(
      context.profile,
      parsedInput,
      language.responseLanguage,
    );

    // "Con số 2370 kcal của tôi được tính như thế nào?" — answered from the engine's own figures (explainMaintenanceEstimate),
    // not by the model (which answered "Harris-Benedict hoặc Mifflin-St Jeor" with no number; examiner-style probe 2026-11-08).
    if (!unsafe?.blocked && isCalculationExplanationQuestion(question)) {
      const explanation = formatCalculationExplanation(context.profile as any, recommendation, explainMaintenanceEstimate(context.profile), language.responseLanguage === "vi" ? "vi" : "en", context.profile.nutritionGoal);
      if (explanation) {
        traceLogger.end(trace, { retrievalEmpty: true, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "calculation_explanation" });
        return makeEarlyPayload(trace.traceId, explanation, language, routedIntent.intent);
      }
    }

    // Nutrition arithmetic answered deterministically from the saved goal / engine estimate (nutrition_answer_mode.ts; expert
    // human review 2026-11-08 found the model's sums wrong: deficit for "3 kg in 2 months", per-meal split, "2200 kcal có quá nhiều?").
    if (!unsafe?.blocked && language.responseLanguage === "vi") {
      const est = explainMaintenanceEstimate(context.profile);
      const saved = context.profile.nutritionGoal;
      const weightKg = context.profile.currentWeightKg ?? context.profile.inBody?.weightKg;
      const n = recommendation.nutrition;
      const target = saved ?? (n?.targetCalories && n.proteinGrams !== undefined && n.carbsGrams !== undefined && n.fatGrams !== undefined
        ? { calories: n.targetCalories, protein: n.proteinGrams, carbs: n.carbsGrams, fat: n.fatGrams } : undefined);
      const change = parseWeightChangeGoal(question), split = parseMealSplit(question), statedKcal = parseStatedKcalComparison(question);
      const math = change ? formatWeightChangeAnswer(change, { maintenance: est.maintenanceCalories, saved, weightKg, gender: context.profile.gender })
        : split && target ? formatMealSplitAnswer(split, target, saved ? "PRESCRIBED" : "ESTIMATED")
        : statedKcal ? formatStatedKcalComparison(statedKcal, { saved, maintenance: est.maintenanceCalories, goalType: context.profile.goal })
        : isFollowUpMacroQuestion(question) ? formatDirectNutritionAnswer(question, recommendation, weightKg)
        : null;
      if (math) {
        traceLogger.end(trace, { retrievalEmpty: true, warningCount: 0, promptTokens: 0, completionTokens: 0, responseSource: "nutrition_math" });
        return makeEarlyPayload(trace.traceId, math, language, routedIntent.intent);
      }
    }

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

    // A direct nutrition question routed to meal_plan_request ("tôi cần bao nhiêu calo/protein?") falls back to a direct
    // numeric answer built from the same deterministic targets, not to the meal-plan template (nutrition_answer_mode.ts).
    const directNutritionQuestion = isDirectNutritionQuestion(routedIntent.intent, question);
    const deterministicAnswer = directNutritionQuestion
      ? formatDirectNutritionAnswer(
          question,
          recommendation,
          context.profile.currentWeightKg ?? context.profile.inBody?.weightKg,
          language.responseLanguage === "vi" ? "vi" : "en",
        )
      : responseFormatter.format(recommendation, language.responseLanguage);

    let llmAnswer = deterministicAnswer;
    let prompt = "";
    const minorGeneralInfo = shouldAddMinorSupervision(question, Boolean((turnFacts as { minorProtected?: boolean }).minorProtected));
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
    let usedDeterministicFallbackBecauseOfValidation = false;

    // Context-on-demand (context_plan.ts): the intent and question signals decide which blocks the prompt carries.
    const contextPlan = planContext({
      intent: routedIntent.intent,
      question,
      personalQuestion: isPersonalQuestion(question),
      bodyCompositionQuestion,
      mentionsInjury: Boolean(parsedInput.mentionsInjury),
      hasSessionHistory: Array.isArray(chatHistory) && chatHistory.length > 0,
    });
    const evidenceDocs = contextPlan.blocks.has("body_comp_evidence") ? await fetchBodyCompEvidence() : [];
    const bodyCompAndCoachText = [
      contextPlan.blocks.has("body_composition") ? fitToBudget(bodyCompText, "body_composition") : undefined,
      ...deterministicNotes,
      contextPlan.blocks.has("coach_context") ? `CoachContext JSON (sanitized, no user identity):\n${coachContextText}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");

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
          {
            turnFactsText: turnFactsText || undefined,
            knowledgeRulesText: formatClaimRulesForPrompt(question) || undefined,
            contextPlan,
            // Block names + token estimates only — never the context text itself.
            onManifest: (manifest) => {
              // retrievalDocs: knowledge-base document ids + source collection only (no text, nothing about the user) — B3-41's
              // "đau gối" could not be traced because which chunks were in the prompt was never recorded.
              const retrievalDocs = (mergedRetrieval.documents ?? []).slice(0, 8).map((d: any) => `${String(d.source ?? "").replace(/^[a-z]+:/, "")}#${d.metadata?.chunk_id ?? d.id}`);
              const meta = { request_id: trace.traceId, contextManifest: { ...manifest, entries: manifest.entries.map((e) => ({ block: e.block, tokens: e.tokens })) }, retrievalDocs, memoryQuarantined: memorySelection.quarantined, memoryIrrelevant: memorySelection.irrelevant };
              // over the whole-prompt guard rail → warn (visible in ops), nothing is cut here
              if (manifest.overBudget) logger.warn(meta, "[context] prompt over token budget");
              else logger.info(meta, "[context] prompt context manifest");
            },
          },
        ),
      );
      // A minor's general safety question reaches the model (instead of the flat redirect) with a hard guardrail.
      if (minorGeneralInfo) prompt = `${prompt}\n\n${minorGeneralInfoPromptNote(language.responseLanguage)}`;
      try {
        const llmCallOpts = {
          timeoutMs: LLM_TIMEOUT_MS,
          // R1 telemetry label only (never changes the request)
          purpose: routedIntent.intent === "general_fitness_knowledge" ? ("GENERAL_QA" as const) : ("GENERATION" as const),
          temperature: routedIntent.intent === "general_fitness_knowledge" ? 0.2 : undefined,
          // These caps were originally tuned for the small local fine-tuned Ollama model
          // (fitness-coach-qwen2.5-1.5b), where ~420 tokens is a full answer.
          // On a Claude model the same cap truncates hard — and with a
          // Vietnamese answer (far more tokens per word) it produced a
          // completely EMPTY text block: 420 output tokens were consumed
          // before any answer text was emitted (confirmed live: completionTokens
          // hit exactly 420 with answer: ""). Scale the cap by provider instead
          // of blanket-raising it, so switching back to the local model keeps
          // its tuned budget.
          // 2026-10-09: lowered 420 -> 320 for the general_fitness_knowledge/Ollama
          // case specifically. LLM_MODEL here is now qwen3:4b-instruct-2507 (not the
          // smaller 1.5b model the 420 figure was tuned for) on a CPU-only dev host
          // measured at ~4.8 tokens/s — 420 tokens took ~87s, just over
          // AI_CHAT_LLM_TIMEOUT_MS, so every real answer was silently replaced by the
          // "AI unavailable" fallback. 320 tokens -> ~65-70s, inside the budget with
          // margin. This raises truncation risk on this larger, more verbose model
          // (the 420 cap already wasn't generous for it); if truncated/empty answers
          // become a real problem, the fix is a faster host/model, not raising this
          // back up (that just reproduces the timeout).
          numPredict:
            // bedrock added (AWS Bedrock Claude pass): same Claude model, same
            // truncation risk, so it takes the anthropic budget.
            LLM_PROVIDER === "anthropic" || LLM_PROVIDER === "bedrock"
              ? bodyCompositionQuestion
                ? 2000
                : 1500
              : bodyCompositionQuestion
                ? 650
                : routedIntent.intent === "general_fitness_knowledge"
                  ? 320
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
        // A model can return a technically-successful response whose text
        // block is empty (e.g. the whole output-token budget was consumed
        // before any answer text was emitted). Without this guard that empty
        // string flows all the way to the user as a blank chat bubble with
        // usedFallback:false — confirmed live on a Vietnamese question. An
        // empty answer is a failed answer: fall back to the deterministic one.
        if (!llmAnswer.trim() && deterministicAnswer.trim()) {
          logger.warn(
            {
              request_id: trace.traceId,
              route: routedIntent.intent,
              completionTokens,
            },
            "AI chat LLM returned an empty answer; using deterministic fallback",
          );
          llmAnswer = deterministicAnswer;
          usedDeterministicFallbackBecauseOfValidation = true;
          fallbackReason = "llm_empty_answer";
        }
        // A general coaching question the model wrongly called "out of scope" (motivation, habits, comparing yourself to
        // others online…) gets ONE retry with the scope spelled out, instead of an unrelated canned plan dump
        // (eval B2-48, 2026-11-11). Only when nothing else owns the turn; any failure falls through to the old fallback.
        if (
          safetyCheck.type === "safe" &&
          isFitnessScopeRefusal(llmAnswer) &&
          routedIntent.intent === "general_fitness_knowledge" &&
          !bodyCompositionQuestion &&
          !parsedInput.mentionsInjury
        ) {
          try {
            const retry = await llmService.callLLM(`${prompt}\n\n${scopeRetryNote(language.responseLanguage)}`, llmCallOpts);
            const retried = labelLocalizer.localize(retry.answer, language.responseLanguage);
            if (retried.trim() && !isFitnessScopeRefusal(retried)) {
              llmAnswer = retried;
              promptTokens += retry.promptTokens ?? 0;
              completionTokens += retry.completionTokens ?? 0;
              totalTokens += retry.totalTokens ?? 0;
              logger.info({ request_id: trace.traceId }, "AI chat scope refusal recovered by one retry");
            }
          } catch (err) {
            logger.warn({ error: safeErrorMessage(err), request_id: trace.traceId }, "AI chat scope-refusal retry failed; using fallback");
          }
        }
        if (
          safetyCheck.type === "safe" &&
          isFitnessScopeRefusal(llmAnswer) &&
          deterministicAnswer.trim()
        ) {
          llmAnswer =
            bodyCompositionQuestion && bodyCompText.trim()
              ? buildVerifiedBodyCompFallback(
                  language,
                  bodyCompText,
                  deterministicAnswer,
                )
              : parsedInput.mentionsInjury
                ? buildInjuryScopeFallback(language)
              : buildVerifiedFitnessFallback(language, deterministicAnswer);
          usedDeterministicFallbackBecauseOfValidation = true;
          fallbackReason = bodyCompositionQuestion
            ? "llm_scope_refusal_deterministic_body_comp"
            : parsedInput.mentionsInjury
              ? "llm_scope_refusal_injury_fallback"
              : "llm_scope_refusal_deterministic_fitness";
          onProgress?.(
            bodyCompositionQuestion
              ? "Đang dùng phân tích InBody đã kiểm chứng."
              : "Đang dùng câu trả lời đã kiểm chứng.",
          );
        }
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

    // The model sometimes copies the prompt's "[...]" format-instruction lines verbatim; never show those.
    if (needsLlm && llmAnswer !== deterministicAnswer) llmAnswer = stripTemplateArtifacts(llmAnswer);
    // A user who says they have a chronic condition always gets a doctor referral, even if the model forgot it (eval B1-45).
    if (minorGeneralInfo && needsLlm && llmAnswer !== deterministicAnswer) llmAnswer = appendMinorSupervisionNote(llmAnswer, language.responseLanguage);
    if (needsLlm && llmAnswer !== deterministicAnswer) llmAnswer = appendMedicalReferralNote(
      question,
      llmAnswer,
      language.responseLanguage,
      Array.isArray(chatHistory) ? chatHistory.slice(0, 4).map((e: any) => String(e?.question ?? "")) : [],
    );
    // Claims about the user nothing in THIS conversation supports ("Bạn đã đạt mục tiêu 78kg" for a stated goal, a birth taken
    // from another question) are removed — context_fidelity_guard.ts. Session history only, never memories.
    if (needsLlm && llmAnswer !== deterministicAnswer) {
      const fidelity = removeUnsupportedUserClaims(llmAnswer, {
        question,
        sessionUserMessages: Array.isArray(chatHistory) ? chatHistory.map((e: any) => String(e?.question ?? "")) : [],
        verifiedProfileFacts: { injury: injuryOnRecord },
        // provenance: what the assistant said earlier is a suggestion; figures on record (profile / InBody) are real
        assistantTurns: Array.isArray(chatHistory) ? chatHistory.map((e: any) => String(e?.answer ?? "")) : [],
        verifiedNumbers: [
          context.profile?.currentWeightKg, context.profile?.targetWeightKg, context.profile?.inBody?.weightKg,
          ...(Array.isArray(context.inBodyHistory) ? context.inBodyHistory.flatMap((h: any) => [h?.weight, h?.weightKg, h?.bodyFatPct, h?.skeletalMuscleMassKg]) : []),
        ].filter((n): n is number => typeof n === "number" && Number.isFinite(n)),
      });
      if (fidelity.removed.length) {
        llmAnswer = fidelity.answer;
        logger.info({ request_id: trace.traceId, removedCount: fidelity.removed.length }, "[context-fidelity] unsupported user claim removed");
      }
      // Removal would have gutted the answer → the guard kept it and only reported (never an empty answer). Counts only, no text.
      if (fidelity.warnings?.length) {
        logger.warn({ request_id: trace.traceId, suppressedCount: fidelity.suppressed?.length ?? 0 }, "[context-fidelity] unsupported claim kept because removal would empty the answer");
      }
      // Known outdated claims (claim_rules.ts) — observability only, the answer is not rewritten.
      const myths = detectMythClaims(llmAnswer);
      if (myths.length) logger.warn({ request_id: trace.traceId, myths: myths.map((m) => m.id) }, "[claim-check] answer contains a known outdated claim");
      // Exercises the user cannot do with what they said they have / their stated experience (catalog-based check).
      const constrained = enforceExerciseConstraints(llmAnswer, turnFacts);
      if (constrained.violations.length) {
        llmAnswer = constrained.answer;
        logger.info({ request_id: trace.traceId, violations: constrained.violations.map((v) => `${v.reason}:${v.exercise.catalogId}`), removedLines: constrained.removedLines }, "[exercise-constraints] answer adjusted to stated constraints");
      }
      // exercises the catalog cannot judge (missing/contradictory metadata) — never removed, only counted for catalog hygiene
      if ((constrained as any).unverified?.length) {
        logger.info({ request_id: trace.traceId, unverifiedCount: (constrained as any).unverified.length }, "[exercise-constraints] exercises with unverifiable catalog metadata");
      }
      // Personal BMI figures are grounded on the one deterministic computation over the resolved profile (bmi_claim_guard.ts).
      const bmiGrounding = groundBmiClaims(llmAnswer, {
        bmi: computeBmi({ heightCm: context.profile.heightCm, weightKg: context.profile.currentWeightKg, age: context.profile.age }),
        lang: language.responseLanguage,
      });
      if (bmiGrounding.answer !== llmAnswer) {
        llmAnswer = bmiGrounding.answer;
        logger.info({ request_id: trace.traceId, corrected: bmiGrounding.corrected, removed: bmiGrounding.removed, minorNote: bmiGrounding.minorNoteAdded }, "[bmi-grounding] personal BMI figure grounded");
      }
      // A TARGET is never stated as current intake when nothing is logged (intake_claim_guard.ts, H-13).
      const loggedIntake = (context.nutritionHistory ?? []).length > 0
        || ((context as any).dailyConsumptionHistory ?? []).some((d: any) => (d?.consumedCalories ?? 0) > 0 || (d?.consumedProtein ?? 0) > 0);
      const intake = groundIntakeClaims(llmAnswer, {
        proteinTargetG: (context.profile as any).nutritionGoal?.protein ?? recommendation.nutrition?.proteinGrams ?? null,
        loggedIntake,
        lang: language.responseLanguage,
      });
      if (intake.rewritten) {
        llmAnswer = intake.answer;
        logger.info({ request_id: trace.traceId, rewritten: intake.rewritten }, "[intake-grounding] target stated as intake rewritten");
      }
      // Internal evidence labels (E1…) and references to material the user never saw ("các mẫu ở trên") — output_hygiene.ts.
      const hygiene = stripInternalReferences(llmAnswer);
      if (hygiene.labels || hygiene.removedSentences) {
        llmAnswer = hygiene.answer;
        logger.info({ request_id: trace.traceId, labels: hygiene.labels, removedSentences: hygiene.removedSentences }, "[output-hygiene] internal reference removed");
      }
    }

    const validation = await timeAsync(timing, "validationMs", async () =>
      answerValidator.validate(
        llmAnswer,
        recommendation,
        language.responseLanguage,
        context.profile,
        { nutritionAnswerMode: nutritionValidationMode(routedIntent.intent, question), personalQuestion: isPersonalQuestion(question) },
      ),
    );

    // If the LLM answer contains nutrition numbers that differ materially from the
    // deterministic targets, discard it and use the deterministic answer instead.
    // This prevents the "185g protein in headline / 133g in targets" drift.
    // Exception: when injury is the sole reason LLM ran (intent was non-LLM), skip
    // structural validation - injury/advisory answers legitimately lack workout structure.
    const injuryForcedLlm =
      parsedInput.mentionsInjury && !llmIntents.has(routedIntent.intent);
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
      // Which validator rule discarded the model's answer — the one fact needed to tell a real model error from a
      // validator false positive (52% of baseline answers were the latter; test/ai-quality-eval, 2026-11-08).
      // Warnings carry rule names and numbers only, never the user's text.
      logger.warn(
        {
          traceId: trace.traceId,
          intent: routedIntent.intent,
          nutritionAnswerMode: nutritionValidationMode(routedIntent.intent, question),
          warnings: validation.warnings.slice(0, 6).map((w) => w.slice(0, 200)),
        },
        "[answer-validation] LLM answer replaced by deterministic fallback",
      );
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
}

export const llmOrchestrator = {
  async run(
    question: string,
    userId?: string,
    authHeader?: string,
    sessionId?: string,
    onProgress?: ProgressCallback,
  ): Promise<FinalAnswerPayload> {
    // CI-V2 diagnostics: the conversation state this turn starts from and ends in (ids/types/statuses only), joined to the
    // request by traceId — so "which workflow did the router actually see?" is answerable per request, not by log order.
    const stateBefore = userId && sessionId && ciMode() === "on" ? await snapshotTurnState(userId, sessionId).catch(() => null) : null;
    const payload = await runInner(question, userId, authHeader, sessionId, onProgress);
    if (stateBefore && userId && sessionId) {
      const stateAfter = await snapshotTurnState(userId, sessionId).catch(() => null);
      if (stateAfter) logger.info({ correlationId: payload.traceId, userId, sessionId, routeIntent: payload.routeIntent, ...describeTransition(stateBefore, stateAfter) }, "ci_turn_transition");
    }
    // CI-V2 Phase B — "pending workflow survives an interruption" must also hold when the interruption was answered by
    // this file's own RAG/deterministic-shortcut chat pipeline (e.g. a knowledge question, or a nutrition/schedule lookup
    // that CI-V2's own READ_STATE routing did not claim), not only when fitness-agent.service.ts's global-turn module
    // answered it directly. runInner()'s early returns already cover the two cases that must NEVER get this reminder:
    // fitness_agent (routeIntent === "fitness_agent", and structured CI-V2 answers already append their own copy of this
    // same reminder — see global-turn.ts's reminder()) and the safety gate (never append conversational bookkeeping to a
    // crisis/off-topic/emergency response). Everything else that reaches this point is a genuine chat-pipeline answer.
    // safetyGuard.check() is synchronous/local (no I/O) — cheap enough to call again here rather than threading a flag
    // through runInner()'s many internal return points.
    if (userId && sessionId && ciMode() === "on" && payload.routeIntent !== "fitness_agent" && safetyGuard.check(question).type === "safe") {
      try {
        const text = await pendingWorkflowReminder({ userId, authorizationHeader: authHeader }, sessionId, {
          getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
          updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
        });
        if (text) payload.answer += text;
      } catch (err) {
        logger.warn({ err: safeErrorMessage(err), userId, sessionId }, "ci_v2_pending_workflow_reminder_failed");
      }
    }
    return payload;
  },
};
