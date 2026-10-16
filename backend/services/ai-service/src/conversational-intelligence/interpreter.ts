import { logger } from "@gym-coach/shared";
import { z } from "zod";
import { callLlmJson } from "../llm/json_llm_call.util";
import { parseFitnessAgentIntent, normalizeAgentText } from "../services/fitness-agent-intent";
import { extractEntities } from "./entity-extractor";
import {
  SemanticEntitySchema,
  SemanticInterpretationSchema,
  type InterpretContext,
  type PrimaryIntent,
  type SemanticEntity,
  type SemanticInterpretation,
  type WorkflowIntent,
} from "./schema";
import { detectCorrections, detectGoalSignals, detectNegations, detectRecommendationRequest, detectReferences, detectWhy, hasCorrectionCue, isQuestionForm } from "./signals";
import { groundReferences } from "./reference-grounding-guard";

/**
 * InterpretConversationTurn — deterministic first, LLM only when the deterministic reading is unsure.
 * The result is a candidate reading for the policy layer; it is never authoritative state.
 */

const WORKFLOW_BY_INTENT_KIND: Record<string, WorkflowIntent> = {
  CREATE_PLAN_BUNDLE: "CREATE_ROADMAP",
  CREATE_WORKOUT_PLAN: "CREATE_WORKOUT_PLAN",
  CREATE_NUTRITION_PLAN: "CREATE_NUTRITION_PLAN",
  PT: "FIND_PT",
  PROGRAM: "FIND_TRAINING_PROGRAM",
};

/** Confidence bands (see docs/conversational-intelligence-v2.md §Confidence policy). */
export const CONFIDENCE_HIGH = 0.85; // use as-is (still unit/range validated)
export const CONFIDENCE_LOW = 0.55; // below → clarify, never guess

export function interpretDeterministic(text: string, ctx: InterpretContext = {}): SemanticInterpretation {
  const s = normalizeAgentText(text);
  const extracted = extractEntities(text, { expectedSlot: ctx.expectedSlot, currentWeightKg: ctx.persisted?.currentWeightKg });
  const goalSignals = detectGoalSignals(s);
  const corrections = detectCorrections(s, extracted.entities, goalSignals, ctx.expectedSlot);
  const negations = detectNegations(s, extracted.entities);
  // V2.3A.7 phase 5 (frozen insertion point, V2.3A.6): grounding runs
  // immediately after detection, before primaryIntent/confidence below ever
  // read `references.length` — so an ungrounded THIS_ITEM/PREVIOUS_STATE
  // reference (e.g. "PT đó" with no PT named anywhere in the message) can
  // never silently flip primaryIntent to PROVIDE_INFORMATION or raise
  // confidence (line ~76) on its way out. `detectReferences()` itself still
  // runs unconditionally and is otherwise unchanged — the guard only
  // decides whether its surface-pattern matches are actually safe to keep.
  const grounding = groundReferences(detectReferences(s), text);
  const references = grounding.references;
  const asksRecommendation = detectRecommendationRequest(s);
  const asksWhy = detectWhy(s);

  const entities = extracted.entities;
  const asserted = entities.filter((e) => !e.negated);
  const intent = parseFitnessAgentIntent(text);
  const workflowIntent = WORKFLOW_BY_INTENT_KIND[intent.kind as string] ?? (intent.kind === "SELECT" && /(thue|hire)/.test(s) ? "HIRE_PT" : undefined);

  let primaryIntent: PrimaryIntent;
  if (corrections.length > 0) primaryIntent = "CORRECT_INFORMATION";
  // a workflow COMMAND ("Gợi ý chương trình tập cho tôi", "Tìm PT") is a command even though it contains "gợi ý"
  else if (workflowIntent && !asksWhy && asserted.length === 0) primaryIntent = "START_WORKFLOW";
  else if (asksRecommendation && asserted.length === 0) primaryIntent = "ASK_RECOMMENDATION";
  else if (workflowIntent && !asksWhy) primaryIntent = "START_WORKFLOW";
  else if (asserted.length === 0 && isQuestionForm(s, text) && !references.length) primaryIntent = "ANSWER_QUESTION";
  else if (asserted.length > 0 || goalSignals.length > 0) primaryIntent = "PROVIDE_INFORMATION";
  else if (/^\s*(xac nhan|dong y|ok luu|luu (di|nhe)|chot|oke?)\b/.test(s)) primaryIntent = "CONFIRM";
  else if (/^\s*(bo qua|huy|khong luu|thoi khong)\b/.test(s)) primaryIntent = "DISMISS";
  else primaryIntent = "UNKNOWN";
  // a pure reference ("mức đó", "lấy mức thấp hơn") answering a proposal is information, not "unknown".
  if (primaryIntent === "UNKNOWN" && references.length > 0) primaryIntent = "PROVIDE_INFORMATION";

  let requestedAction: SemanticInterpretation["requestedAction"];
  if (asksRecommendation && primaryIntent !== "START_WORKFLOW") requestedAction = "SUGGEST";
  else if (corrections.some((c) => c.field === "GOAL")) requestedAction = "PROPOSE_CHANGE";
  else if (corrections.length > 0) requestedAction = "REVISE";
  else if (primaryIntent === "CONFIRM") requestedAction = "CONFIRM";
  else if (primaryIntent === "ANSWER_QUESTION") requestedAction = "ASK";

  // "explain + act": "tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi" — still only a PROPOSED change.
  if (asksWhy && /(doi|cap nhat|sua) (muc tieu|goal)/.test(s)) requestedAction = "PROPOSE_CHANGE";

  const ambiguities = [...extracted.ambiguities];
  // V2.3A.7 phase 5: the one ambiguity entry the guard appends when it
  // invalidates a reference — bounded correction, nothing else is touched.
  if (grounding.activated && grounding.ambiguityEntry && !ambiguities.some((a) => a.field === "reference")) {
    ambiguities.push(grounding.ambiguityEntry);
  }
  const lowestEntity = asserted.length ? Math.min(...asserted.map((e) => e.confidence)) : 1;
  let confidence =
    primaryIntent === "UNKNOWN" ? 0.3 : ambiguities.length ? Math.min(0.5, lowestEntity) : asserted.length ? Math.min(0.97, lowestEntity) : corrections.length || goalSignals.length || references.length || asksRecommendation ? 0.85 : 0.75;
  if (grounding.activated && typeof grounding.confidenceFloor === "number") {
    confidence = Math.min(confidence, grounding.confidenceFloor);
  }

  return {
    primaryIntent,
    workflowIntent,
    entities,
    corrections,
    references,
    goalSignals,
    negations,
    ambiguities,
    requestedAction,
    asksWhy: asksWhy || undefined,
    // grounding.activated is OR'd into the SAME frozen formula, not a
    // separate override path — a deterministic grounding failure can only
    // ever raise this to true, never be overruled by anything downstream
    // (task's own "do not let model output overrule a grounding failure").
    clarificationRequired: ambiguities.length > 0 || confidence < CONFIDENCE_LOW || grounding.activated,
    confidence,
    source: "DETERMINISTIC",
  };
}

/** True when the deterministic reading is too unsure to act on and an LLM second opinion is worth its latency. */
export function needsSemanticLlm(i: SemanticInterpretation, text: string): boolean {
  if (text.trim().length < 12) return false;
  if (i.primaryIntent === "UNKNOWN") return true;
  return i.confidence < CONFIDENCE_LOW && i.entities.length === 0;
}

const LlmOutputSchema = z.object({
  primaryIntent: SemanticInterpretationSchema.shape.primaryIntent,
  entities: z.array(SemanticEntitySchema.pick({ type: true, value: true, sourceText: true, negated: true })).default([]),
  goalSignals: SemanticInterpretationSchema.shape.goalSignals.default([]),
  asksRecommendation: z.boolean().default(false),
  isCorrection: z.boolean().default(false),
});

/**
 * V2.3A.7 phase 1: split into an explicit system/user pair instead of one
 * joined string — see docs/ai-training/
 * qwen4b-v2-3a7-production-semantic-contract-alignment-implementation.md.
 * Previously this was one `buildPrompt()` string with no role marker, which
 * `buildOllamaMessages()`/`buildAnthropicRequest()` silently flattened into a
 * single user-role message on every live provider (confirmed in V2.3A.6).
 * `callLlmJson`'s new `systemPrompt` option (llm.service.ts) now carries
 * `buildSystemInstructions()`'s output as a real system turn/block on every
 * provider branch, bypassing that string-sniffing entirely for this call.
 */
function buildSystemInstructions(): string {
  return [
    "Bạn là bộ phân tích ngữ nghĩa cho một trợ lý thể hình tiếng Việt. CHỈ trả về một JSON object, không giải thích.",
    "Nhiệm vụ: đọc MỘT tin nhắn của người dùng và trích xuất ý định + dữ kiện. Không tự bịa số; mọi giá trị phải xuất hiện trong tin nhắn.",
    "Quy tắc đơn vị: '1m73' hoặc '173cm' là HEIGHT_CM=173 (KHÔNG BAO GIỜ là cân nặng). '80kg' là WEIGHT_KG (cân hiện tại) trừ khi câu nói đó là mục tiêu, khi đó là TARGET_WEIGHT_KG.",
    "primaryIntent ∈ ANSWER_QUESTION|START_WORKFLOW|PROVIDE_INFORMATION|CORRECT_INFORMATION|ASK_RECOMMENDATION|CONFIRM|DISMISS|UNKNOWN. ASK_RECOMMENDATION = người dùng nhờ trợ lý tự đề xuất/chọn giúp.",
    // V2.3A.6 found this list only advertised 8 of the real 10 ENTITY_TYPES
    // (schema.ts) — WEIGHT_UNLABELED and GENDER are now included so the
    // prompt text matches schema truth (task's own alignment instruction;
    // the Zod schema already accepted both, it just never told the model).
    "entities: mảng {type,value,sourceText,negated?}; type ∈ HEIGHT_CM|WEIGHT_KG|TARGET_WEIGHT_KG|WEIGHT_UNLABELED|AGE|GENDER|SESSIONS_PER_WEEK|SESSION_MINUTES|MEALS_PER_DAY|BUDGET_VND. negated=true nếu người dùng PHỦ ĐỊNH giá trị đó.",
    "goalSignals: mảng {goal,strength,negatesGoal?,sourceText}; goal ∈ WEIGHT_LOSS|MUSCLE_GAIN|MAINTENANCE|ATHLETIC_PERFORMANCE; strength ∈ EXPLICIT|IMPLICIT.",
    'Ví dụ đầu ra: {"primaryIntent":"PROVIDE_INFORMATION","entities":[{"type":"HEIGHT_CM","value":173,"sourceText":"1m73"}],"goalSignals":[],"asksRecommendation":false,"isCorrection":false}',
  ].join("\n");
}

function buildUserTurn(text: string, ctx: InterpretContext): string {
  return [
    ctx.expectedSlot ? `Trợ lý vừa hỏi về ô: ${ctx.expectedSlot}.` : "",
    `Tin nhắn: """${text.slice(0, 500)}"""`,
  ].filter(Boolean).join("\n");
}

/** Cross-check an LLM claim against the text and against physical ranges; anything that fails is dropped, never repaired. */
export function validateLlmEntities(text: string, entities: Array<Pick<SemanticEntity, "type" | "value" | "sourceText" | "negated">>): SemanticEntity[] {
  const s = normalizeAgentText(text);
  const out: SemanticEntity[] = [];
  const RANGE: Partial<Record<SemanticEntity["type"], [number, number]>> = {
    HEIGHT_CM: [100, 250], WEIGHT_KG: [25, 300], TARGET_WEIGHT_KG: [25, 300], AGE: [10, 100], SESSIONS_PER_WEEK: [1, 7],
    SESSION_MINUTES: [10, 240], MEALS_PER_DAY: [2, 8], BUDGET_VND: [100_000, 100_000_000],
  };
  for (const e of entities) {
    if (typeof e.value !== "number") continue;
    const range = RANGE[e.type];
    if (range && (e.value < range[0] || e.value > range[1])) continue;
    // the digits (or their metre form) must really be in the message
    const digits = String(e.value);
    const metreForms = [...s.matchAll(/(?<![\d.,])(\d)\s*m\s*(\d{2})(?!\d)|(?<![\d])(\d)[.,](\d{1,2})\s*m(?![a-z])/g)].map((m) => (m[1] !== undefined ? Number(m[1]) * 100 + Number(m[2]) : Math.round(Number(`${m[3]}.${m[4]}`) * 100)));
    const inText = s.includes(digits) || (e.type === "HEIGHT_CM" && metreForms.includes(e.value));
    if (!inText && e.type !== "BUDGET_VND") continue;
    // hard unit rule: a metre-form height ("1m73") can never be anything but a height
    if (e.type !== "HEIGHT_CM") {
      const metre = /(?<![\d.,])(\d)\s*m\s*(\d{2})(?!\d)/.exec(s);
      if (metre && e.value === Number(metre[2])) continue;
    }
    out.push({ type: e.type, value: e.value, sourceText: e.sourceText, explicit: false, confidence: 0.7, negated: e.negated });
  }
  return out;
}

export async function interpretWithLlm(text: string, ctx: InterpretContext, userId: string, base?: SemanticInterpretation): Promise<SemanticInterpretation | null> {
  const started = Date.now();
  const raw = await callLlmJson(buildUserTurn(text, ctx), LlmOutputSchema, { userId, phase: "conversation-interpretation", numPredict: 400, attempts: 1, logPrefix: "[ci-v2]", systemPrompt: buildSystemInstructions() });
  if (!raw) return null;
  const det = base ?? interpretDeterministic(text, ctx);
  const entities = validateLlmEntities(text, raw.entities);
  logger.info({ latencyMs: Date.now() - started, intent: raw.primaryIntent, entityCount: entities.length }, "ci_v2_llm_interpretation");
  // V2.3A.7 phase 5: a deterministic grounding failure (the guard already
  // invalidated a reference and flagged it in det.ambiguities) must not be
  // silently overruled by this merge's own clarificationRequired/confidence
  // reset below — task's own "do not let model output overrule a
  // deterministic grounding failure". Every other ambiguity source keeps
  // the pre-existing behavior (merge resets clarificationRequired to
  // false, confidence floors at 0.6) exactly as before this task.
  const hasGroundingFailure = det.ambiguities.some((a) => a.field === "reference");
  const merged: SemanticInterpretation = {
    ...det,
    // deterministic entities always win on conflict (units are cross-checked there); LLM only ADDS types the parser missed.
    entities: [...det.entities, ...entities.filter((e) => !det.entities.some((d) => d.type === e.type))],
    goalSignals: det.goalSignals.length ? det.goalSignals : raw.goalSignals,
    primaryIntent: det.primaryIntent === "UNKNOWN" ? raw.primaryIntent : det.primaryIntent,
    requestedAction: det.requestedAction ?? (raw.asksRecommendation ? "SUGGEST" : undefined),
    confidence: hasGroundingFailure ? det.confidence : Math.max(det.confidence, 0.6),
    clarificationRequired: hasGroundingFailure ? true : false,
    source: "MERGED",
  };
  if (raw.asksRecommendation && merged.primaryIntent === "UNKNOWN") merged.primaryIntent = "ASK_RECOMMENDATION";
  if (raw.isCorrection && hasCorrectionCue(normalizeAgentText(text)) === false && merged.corrections.length === 0) merged.clarificationRequired = true;
  return merged;
}

/** Deterministic first; LLM second opinion only when it is genuinely needed and the feature allows it. */
export async function interpretTurn(text: string, ctx: InterpretContext, opts: { userId: string; allowLlm: boolean }): Promise<SemanticInterpretation> {
  const det = interpretDeterministic(text, ctx);
  if (!opts.allowLlm || !needsSemanticLlm(det, text)) return det;
  try {
    return (await interpretWithLlm(text, ctx, opts.userId, det)) ?? det;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "ci_v2_llm_failed_fallback_to_deterministic");
    return det;
  }
}

/** The typed LLM reading ALONE (no deterministic merge) — used to measure the model on the corpus and to show what the validator catches. */
export async function llmOnlyReading(text: string, ctx: InterpretContext, userId: string) {
  const raw = await callLlmJson(buildUserTurn(text, ctx), LlmOutputSchema, { userId, phase: "conversation-interpretation-eval", numPredict: 400, attempts: 1, logPrefix: "[ci-v2-eval]", systemPrompt: buildSystemInstructions() });
  if (!raw) return null;
  return { raw, validatedEntities: validateLlmEntities(text, raw.entities) };
}
