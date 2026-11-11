import { logger } from "@gym-coach/shared";
import { z } from "zod";
import { callLlmJson } from "../../llm/json_llm_call.util";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import type { GlobalContext, GlobalRouteResult, ReadTopic, RecommendTopic } from "./router";

/**
 * Typed LLM fallback for turns the deterministic router could not place (route UNKNOWN). The model may ONLY pick from closed lists
 * and can only ever produce a READ / RECOMMEND / KNOWLEDGE_QA route: it can never start a workflow, propose a write, name a tool, or
 * touch an id. Its answer is validated in TypeScript (closed enums; a topic must be paired with its route) and anything else is
 * discarded. Measured intent accuracy of the raw model is poor (40 % in the earlier isolated sample), which is exactly why it is only
 * a second opinion on turns nothing else could classify.
 */

const READ_TOPICS = ["PT_STATUS", "CONTRACT_STATUS", "PROGRAM_STATUS", "SCHEDULE", "NUTRITION_TARGET", "NUTRITION_PROGRAM", "GOAL", "PROFILE_FACT"] as const;
const RECOMMEND_TOPICS = ["GOAL", "TARGET_WEIGHT", "SESSIONS", "MEALS", "HIRE_PT", "PT", "PROGRAM"] as const;

/** every topic a model answer may legitimately carry; anything else is untrusted text and is never logged */
const ALLOWED_TOPICS = new Set<string>([...READ_TOPICS, ...RECOMMEND_TOPICS]);
export const REJECTED_TOPIC_MARKER = "[rejected]";
const loggableTopic = (t?: string): string | null => (t === undefined ? null : ALLOWED_TOPICS.has(t) ? t : REJECTED_TOPIC_MARKER);

/** a READ topic the model names must be corroborated by the message's own vocabulary — the model alone is never enough */
const EVIDENCE: Record<string, RegExp> = {
  PT_STATUS: /(\bpt\b|huan luyen|trainer|coach|tap voi ai|hop dong)/, CONTRACT_STATUS: /(hop dong|contract)/,
  // R1 (N2): a bare "buổi" is a training-SESSION word, and a session is exactly what a revision utterance talks about ("Buổi chân hơi
  // nặng."). Only program-level wording or an explicit "tập mấy buổi" count as a program-status read.
  PROGRAM_STATUS: /(chuong trinh|giao an|program|lo trinh|tap (may|bao nhieu) buoi)/, SCHEDULE: /(lich|hom nay|ngay mai|tuan)/,
  NUTRITION_TARGET: /(calo|kcal|macro|protein|dam\b|carb|gram|dinh duong)/, NUTRITION_PROGRAM: /(thuc don|bua an|meal)/,
  GOAL: /(muc tieu|\bgoal\b|cut|bulk)/, PROFILE_FACT: /(can nang|chieu cao|\bcao\b|\bnang\b|tuoi|ho so)/,
};
const PAIN = /(dau |dau$|chan thuong|injury|pain|bi thuong|te |sung )/;

export const LlmRouteSchema = z.object({
  route: z.enum(["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA", "OTHER"]),
  topic: z.string().optional(),
});

function prompt(text: string, ctx: GlobalContext): string {
  return [
    "Bạn phân loại MỘT tin nhắn của người dùng trong ứng dụng thể hình. CHỈ trả về JSON.",
    "route:",
    " - READ_STATE: người dùng hỏi về DỮ LIỆU HIỆN CÓ CỦA CHÍNH HỌ (ví dụ: họ đang có PT chưa, hợp đồng, chương trình tập đang theo, lịch tập, thực đơn, mục tiêu, kcal/đạm mục tiêu, cân nặng/chiều cao trong hồ sơ).",
    " - RECOMMEND: người dùng nhờ GỢI Ý/TƯ VẤN cho riêng họ (nên cut hay bulk, nên tập mấy buổi, nên ăn mấy bữa, có nên thuê PT, cân nặng mục tiêu nào...).",
    " - KNOWLEDGE_QA: câu hỏi kiến thức chung, không nói về dữ liệu của họ.",
    " - OTHER: mọi thứ khác (lệnh tạo/tìm/đổi/lưu/hủy, trả lời một câu hỏi trước đó, chào hỏi...).",
    `topic khi READ_STATE ∈ ${READ_TOPICS.join("|")}; khi RECOMMEND ∈ ${RECOMMEND_TOPICS.join("|")}; nếu route khác thì bỏ topic.`,
    ctx.active ? `Lưu ý: trợ lý đang chờ người dùng trả lời một câu hỏi (${ctx.active.slot ?? "?"}). Nếu tin nhắn là câu trả lời cho câu hỏi đó thì route=OTHER.` : "",
    `Tin nhắn: """${text.slice(0, 400)}"""`,
    'Ví dụ: {"route":"READ_STATE","topic":"PT_STATUS"}',
  ].filter(Boolean).join("\n");
}

/**
 * R1 — a READ request is a QUESTION or a STATE cue about the user's own data. A bare statement or a command-like evaluation ("Buổi chân
 * hơi nặng.", "Bài chân nhiều quá.") is never a read, however many topic words it contains.
 */
const READ_CUE = /\?|\bhien (tai|nay|gio)\b|\bdang (co|theo|tap|an|dung)\b|\bla gi\b|\bla ai\b|\bbao nhieu\b|\bchua\b|\bnao\b|\bcua (toi|minh|t)\b|\bmay\b/;
/** R1 — evaluative/revision wording that asks for a CHANGE to the pending workout, not a status read */
const REVISION_CUE = /\b(hoi|qua|nhieu qua|giam|bot|them|bo|bot|nhe|nang|it hon|nhieu hon|doi|thay|giu)\b/;

export type RouteAcceptance = { accepted: GlobalRouteResult | null; reason: string | null };

/**
 * R1 — the acceptance decision for a model-proposed route. Schema validity and an allowed enum are NOT enough: the route must also be
 * consistent with the message and with the active context. Strong deterministic/contextual evidence always wins over the model
 * (it only reaches this function on turns the deterministic router left UNKNOWN). Returns the reason for every rejection (telemetry).
 */
export function routeAcceptance(text: string, out: GlobalRouteResult | null, ctx: { pendingDraft?: boolean } = {}): RouteAcceptance {
  if (!out) return { accepted: null, reason: "no_route_proposed" };
  const s = normalizeAgentText(text);
  if (PAIN.test(s)) return { accepted: null, reason: "pain_or_injury_wording" };
  if (out.route === "RECOMMEND" && (out.topic === "PT" || out.topic === "PROGRAM")) return { accepted: null, reason: "would_start_workflow" };
  if (out.route === "READ_STATE") {
    if (!(EVIDENCE[out.topic as string]?.test(s))) return { accepted: null, reason: "topic_evidence_missing" };
    if (!READ_CUE.test(s)) return { accepted: null, reason: "read_question_cue_missing" };
    if (ctx.pendingDraft && REVISION_CUE.test(s)) return { accepted: null, reason: "pending_draft_revision_wording" };
  }
  return { accepted: out, reason: null };
}

/** the hard limits, applied to ANY model-derived route (also re-applied by the caller, so a substituted/test model cannot bypass them) */
export function limitLlmRoute(text: string, out: GlobalRouteResult | null, ctx: { pendingDraft?: boolean } = {}): GlobalRouteResult | null {
  return routeAcceptance(text, out, ctx).accepted;
}

/** R1 — the routing call's own budget. Historically this call borrowed CYCLE_ANALYSIS_LLM_TIMEOUT_MS (80 s); a routing decision is short
 *  and always has a deterministic fallback (UNKNOWN / clarification), so it gets its own, much smaller, bound. */
export const ROUTING_TIMEOUT_MS = Number(process.env.LLM_ROUTING_TIMEOUT_MS ?? 15_000);

async function llmRouteImpl(text: string, ctx: GlobalContext, userId: string, correlationId?: string): Promise<GlobalRouteResult | null> {
  const t0 = Date.now();
  // callPurpose SEMANTIC_ROUTING: this call exists only to place a turn the deterministic router left UNKNOWN (R1 telemetry taxonomy).
  const raw = await callLlmJson(prompt(text, ctx), LlmRouteSchema, { userId, phase: "global-routing", numPredict: 60, attempts: 1, logPrefix: "[ci-global-route]", redactErrorDetail: true, timeoutMs: ROUTING_TIMEOUT_MS, purpose: "SEMANTIC_ROUTING" });
  if (!raw) {
    logger.info({ correlationId, userId, callPurpose: "SEMANTIC_ROUTING", timeoutMs: ROUTING_TIMEOUT_MS, latencyMs: Date.now() - t0, llmRoute: null, accepted: false, rejectionReason: "no_valid_output_or_timeout" }, "ci_global_llm_route");
    return null;
  }
  let out: GlobalRouteResult | null = null;
  if (raw.route === "READ_STATE" && (READ_TOPICS as readonly string[]).includes(raw.topic ?? "")) out = { route: "READ_STATE", topic: raw.topic as ReadTopic, confidence: 0.6, reason: "typed LLM fallback" };
  else if (raw.route === "RECOMMEND" && (RECOMMEND_TOPICS as readonly string[]).includes(raw.topic ?? "")) {
    const t = raw.topic as RecommendTopic;
    out = { route: "RECOMMEND", topic: t, workflow: t === "PT" ? "FIND_PT" : t === "PROGRAM" ? "FIND_TRAINING_PROGRAM" : undefined, confidence: 0.6, reason: "typed LLM fallback" };
  } else if (raw.route === "KNOWLEDGE_QA") out = { route: "KNOWLEDGE_QA", confidence: 0.6, reason: "typed LLM fallback" };
  // hard limits: no workflow can be started from a model answer, no read without evidence in the text, nothing for pain/injury wording
  const decision = routeAcceptance(text, out, { pendingDraft: Boolean(ctx.draft) });
  out = decision.accepted;
  logger.info({ correlationId, userId, callPurpose: "SEMANTIC_ROUTING", timeoutMs: ROUTING_TIMEOUT_MS, latencyMs: Date.now() - t0, llmRoute: raw.route, llmTopic: loggableTopic(raw.topic), accepted: Boolean(out), acceptedRoute: out?.route ?? null, rejectionReason: decision.reason }, "ci_global_llm_route");
  if (out && ctx.active) out.interrupts = true;
  return out;
}

/** indirection so tests can substitute a worst-case model */
export const llmRouteDeps = { llmRoute: llmRouteImpl };
export const llmRoute = (text: string, ctx: GlobalContext, userId: string, correlationId?: string) => llmRouteDeps.llmRoute(text, ctx, userId, correlationId);
