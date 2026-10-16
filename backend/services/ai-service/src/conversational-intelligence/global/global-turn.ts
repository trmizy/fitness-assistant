import { logger } from "@gym-coach/shared";
import {
  describePendingWorkflow, peekActiveWorkflow, startProfileChangeWorkflow, storeProposalWorkflow,
} from "../../agent-workflow/orchestrator";
import type { AgentIdentity } from "../../services/fitness-agent-tools";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import { extractEntities } from "../entity-extractor";
import { detectGoalSignals } from "../signals";
import { recommendGoal, recommendMealsPerDay, recommendSessionsPerWeek, recommendTargetWeight } from "../recommenders";
import { GOAL_LABEL, recommendationText, whyGoalExplanation } from "../responses";
import type { Goal } from "../schema";
import { hasPendingDraft } from "./turn-state";
import { rethrowProfileFailures } from "./profile-errors";
import { readState } from "./readers";
import { ciLlmAllowed, unifiedCoachMode } from "../index";
import { ragRetrievalV2Enabled } from "../../llm/retriever";
import { limitLlmRoute, llmRoute } from "./llm-route";
import { classifyGlobal, type GlobalRouteResult, type ReadTopic } from "./router";

/**
 * GLOBAL conversation policy: what does Gymini DO for this turn, inside or outside a workflow?
 *   READ_STATE      → Enterprise Data read (authoritative service), rendered naturally
 *   RECOMMEND       → deterministic recommendation from the user's own data (never a write, never auto-creates a plan)
 *   WRITE (goal)    → only a PROPOSAL: the existing PROFILE_UPDATE_CONFIRMATION card, then the existing confirm → write → resume
 *   interruption    → answer the side question, leave the waiting workflow untouched, remind the user how to continue
 * It never executes a business write, never picks a tool from model output, and hands everything else back to the existing pipeline.
 */

export interface GlobalDeps {
  getUserFitnessContext: (identity: AgentIdentity) => Promise<{ profile: Record<string, unknown>; coach: unknown }>;
  updateProfileFields: (identity: AgentIdentity, fields: Record<string, unknown>) => Promise<unknown>;
}

export interface GlobalOutcome {
  route: GlobalRouteResult;
  /** the turn was fully handled here */
  result?: { answer: string; blocks: unknown[] };
  /** stop the agent pipeline for this turn (RAG / deterministic chat contexts answer; a waiting workflow is NOT touched) */
  skipAgent?: boolean;
  /** treat the message as this legacy intent kind (starts the existing workflow) */
  overrideIntentKind?: string;
}

const KIND_BY_WORKFLOW: Record<string, string> = {
  CREATE_ROADMAP: "CREATE_PLAN_BUNDLE", CREATE_WORKOUT_PLAN: "CREATE_WORKOUT_PLAN", CREATE_NUTRITION_PLAN: "CREATE_NUTRITION_PLAN",
  FIND_PT: "PT", FIND_TRAINING_PROGRAM: "PROGRAM",
};

const NL = String.fromCharCode(10).repeat(2);

/** Exported so the RAG/chat pipeline (orchestrator.service.ts) can append the SAME reminder text after a knowledge
 * question it answered itself — kept as one shared implementation rather than a second copy of the wording. */
export async function reminder(identity: AgentIdentity, sessionId: string, deps: GlobalDeps): Promise<string> {
  const p = await describePendingWorkflow(identity, sessionId, deps);
  if (!p) return "";
  return `${NL}Bạn vẫn đang ${p.label} dở. ${p.question ? `Khi muốn tiếp tục: ${p.question}` : "Khi muốn tiếp tục, bạn cứ trả lời tiếp nhé"} (hoặc nhắn "hủy" nếu muốn dừng).`;
}

function profileNumber(profile: Record<string, unknown>, k: string): number | undefined {
  return typeof profile[k] === "number" ? (profile[k] as number) : undefined;
}

/** the topics a standalone recommendation exists for; PT/PROGRAM are workflows and a topic-less "personalised fit question" has nothing to recommend */
const STANDALONE_RECOMMEND_TOPICS = new Set<string>(["GOAL", "TARGET_WEIGHT", "SESSIONS", "MEALS", "HIRE_PT"]);

async function recommendStandalone(route: GlobalRouteResult, question: string, identity: AgentIdentity, sessionId: string, deps: GlobalDeps): Promise<{ answer: string; blocks: unknown[] } | null> {
  // Nothing to recommend for this route → do not read the profile at all (a wasted read whose failure used to be swallowed and now is not).
  if (!route.topic || !STANDALONE_RECOMMEND_TOPICS.has(route.topic)) return null;
  const ctx = await deps.getUserFitnessContext(identity);
  const profile = ctx.profile;
  const goal = typeof profile.goal === "string" ? (profile.goal as Goal) : undefined;
  const heightCm = profileNumber(profile, "heightCm");
  const weight = profileNumber(profile, "currentWeight");
  switch (route.topic) {
    case "GOAL": {
      const rec = recommendGoal({ heightCm, currentWeightKg: weight });
      if (rec.kind === "INSUFFICIENT") return { answer: `Để gợi ý nên cut hay bulk, mình cần biết thêm ${rec.missing.join(" và ")} của bạn. Bạn cập nhật hồ sơ (hoặc nhắn cho mình) rồi mình sẽ gợi ý theo số liệu thật nhé.`, blocks: [] };
      const bmi = String(rec.bmi).replace(".", ",");
      const head = `Với ${rec.inputs.heightCm}cm và ${rec.inputs.currentWeightKg}kg (BMI khoảng ${bmi}), ${rec.reason}.`;
      const stored = goal ? ` Mục tiêu đang lưu của bạn là ${GOAL_LABEL[goal]}.` : "";
      if (rec.kind === "DIRECTIONAL") {
        if (goal === rec.recommended) return { answer: `${head}${stored} Vậy mục tiêu hiện tại của bạn đã khớp với gợi ý này, bạn không cần đổi. Đây là gợi ý tham khảo, không phải chẩn đoán.`, blocks: [] };
        const stored2 = await storeProposalWorkflow(identity, sessionId, { field: "goal", recommended: rec.recommended, goal: rec.recommended, inputs: rec.inputs });
        return { answer: `${head}${stored} Đây là gợi ý tham khảo, không phải chẩn đoán, và mình chưa thay đổi gì.${stored2 ? ` Nếu bạn đồng ý, hãy nhắn "ok đổi theo đề xuất đó" — mình sẽ soạn thay đổi sang ${GOAL_LABEL[rec.recommended]} để bạn xác nhận.` : ""}`, blocks: [] };
      }
      return { answer: `${head}${stored} Bạn thiên về hướng nào hơn? Nói cho mình mục tiêu bạn chọn, mình sẽ soạn thay đổi để bạn xác nhận.`, blocks: [] };
    }
    case "TARGET_WEIGHT": {
      const rec = recommendTargetWeight({ heightCm, currentWeightKg: weight, goal });
      if (rec.kind === "INSUFFICIENT") return { answer: `Để gợi ý cân nặng mục tiêu, mình cần biết thêm ${rec.missing.join(" và ")} của bạn.`, blocks: [] };
      return { answer: recommendationText(rec), blocks: [] };
    }
    case "SESSIONS": {
      const r = recommendSessionsPerWeek({ goal, experience: typeof profile.experience === "string" ? (profile.experience as string) : undefined });
      return { answer: `Với hồ sơ hiện tại của bạn, mình gợi ý tập khoảng ${r.value} buổi mỗi tuần (${r.reason}). Đây chỉ là gợi ý — mình chưa tạo hay thay đổi lịch nào; muốn thì bạn nhắn "tạo lịch tập cho tôi".`, blocks: [] };
    }
    case "MEALS": {
      const r = recommendMealsPerDay({ goal });
      return { answer: `Mình gợi ý khoảng ${r.value} bữa mỗi ngày (${r.reason}). Chưa có thực đơn nào được tạo; muốn thì bạn nhắn "tạo thực đơn cho tôi".`, blocks: [] };
    }
    case "HIRE_PT": {
      const st = await readState("PT_STATUS", identity, question, deps);
      const has = st && (st.facts.live as number) > 0;
      if (has) return { answer: `${st!.text} Vì bạn đã có PT/yêu cầu hợp đồng đang hiệu lực nên chưa cần thuê thêm.`, blocks: [] };
      return { answer: `Không bắt buộc phải thuê PT. PT hữu ích khi bạn là người mới cần kiểm tra kỹ thuật, khi bạn khó giữ nhịp tập một mình, hoặc khi mục tiêu cần theo dõi sát${goal ? ` (mục tiêu hiện tại của bạn: ${GOAL_LABEL[goal]})` : ""}; nếu bạn đã tự tập đều và an toàn thì có thể chưa cần. Hiện bạn chưa có PT. Muốn xem PT phù hợp, bạn nhắn "tìm PT cho tôi" — mình chỉ gợi ý, không tự đăng ký.`, blocks: [] };
    }
    default:
      return null;
  }
}

/** `legacySpecialistCue`: the legacy pipeline has a deterministic specialist for this message (food substitution / meal log). The typed-LLM fallback must not take such a turn. */
export async function runGlobalTurn(question: string, identity: AgentIdentity, sessionId: string, legacyIntentKind: string | null, deps: GlobalDeps, correlationId?: string, legacySpecialistCue = false): Promise<GlobalOutcome | null> {
  const active = await peekActiveWorkflow(identity.userId, sessionId);
  const proposal = Boolean((active?.slotsJson as { __ci?: { proposal?: unknown } } | undefined)?.__ci?.proposal);
  // A pending DRAFT (workout/nutrition/roadmap preview awaiting confirmation, or a menu still generating) is conversation state the router
  // must know about BEFORE it classifies: the draft has its own deterministic router (routePendingDraftTurn) for revisions/confirmations.
  const pendingDraft = await hasPendingDraft(identity.userId, sessionId);
  const gctx = { active: active && active.status === "COLLECTING_SLOTS" ? { wf: active.type, slot: active.expectedSlot } : null, proposal, draft: pendingDraft, trainingCoach: unifiedCoachMode() === "on", personalInterpretation: unifiedCoachMode() === "on" && ragRetrievalV2Enabled() };
  let route = classifyGlobal(question, gctx);
  const deterministicRoute = route;
  let llmCalled = false;
  let llmAccepted: string | null = null;
  // typed LLM second opinion ONLY for turns nothing deterministic could place (never for slot answers, never able to start a workflow or write)
  // Never for: a turn while a confirmation card is pending ("Xác nhận cập nhật") or a DRAFT awaits confirmation, or a generic slot-directed
  // reply while a workflow waits ("ok hãy đề xuất cho tôi") — those belong to the workflow/draft layer. Inside a waiting workflow the model
  // may only be asked when the message names a business topic of its own, and never for a message a legacy deterministic specialist owns.
  const businessNoun = /(\bpt\b|huan luyen|hop dong|chuong trinh|giao an|lich tap|thuc don|calo|kcal|macro|protein|dam\b|muc tieu|can nang|chieu cao|trainer|goal)/.test(normalizeAgentText(question));
  const llmEligible = (!active || (active.status === "COLLECTING_SLOTS" && businessNoun)) && !(active && active.status !== "COLLECTING_SLOTS") && !pendingDraft && !legacySpecialistCue;
  if (route.route === "UNKNOWN" && ciLlmAllowed() && llmEligible && question.trim().length >= 8) {
    llmCalled = true;
    const viaLlm = await llmRoute(question, gctx, identity.userId, correlationId).catch(() => null);
    // R1: the same context-consistency guard that llmRoute applies, re-applied here with the active context so a substituted model cannot bypass it.
    const limited = limitLlmRoute(question, viaLlm, { pendingDraft: Boolean(pendingDraft) });
    llmAccepted = limited ? `${limited.route}${limited.topic ? `(${limited.topic})` : ""}` : null;
    if (limited) route = limited;
  }
  // Request-scoped decision trace. Joined to its HTTP request by `correlationId` (the request's traceId, returned to the client) —
  // never by log order. Ids, types and statuses only: no message text, profile values or tokens.
  const trace = (extra: Record<string, unknown>) =>
    logger.info({
      correlationId, userId: identity.userId, sessionId,
      workflowId: active?.id, workflowStatus: active?.status, expectedSlot: active?.expectedSlot, activeWorkflow: active?.type, proposalStored: proposal, pendingDraft,
      deterministicRoute: deterministicRoute.route, deterministicTopic: deterministicRoute.topic, legacySpecialistCue, llmCalled, llmAccepted,
      route: route.route, topic: route.topic, workflow: route.workflow, interrupts: route.interrupts, reason: route.reason, ...extra,
    }, "ci_global_trace");

  const waiting = Boolean(active && active.status === "COLLECTING_SLOTS");
  const s = normalizeAgentText(question);
  // messages about the pending draft itself ("thực đơn xong chưa?", "tôi không muốn deadlift") must reach its router, not be read as a state question.
  // "vì sao bạn đề xuất vậy?" while a proposal is stored is answered by the workflow policy from the stored reasoning
  if (waiting && proposal && /(vi sao|tai sao|why)/.test(s)) { trace({ action: "why-question about the stored proposal → workflow policy" }); return { route }; }

  // ── READ: authoritative state, never a search/creation flow ──
  if (route.route === "READ_STATE" && route.topic) {
    if (pendingDraft && ["NUTRITION_PROGRAM", "PROGRAM_STATUS", "SCHEDULE"].includes(route.topic as string)) { trace({ action: "pending draft owns this turn → existing draft routing" }); return { route }; }
    if (route.topic === "ROADMAP_STATUS") { trace({ action: "roadmap status → existing roadmap-status intent" }); return { route }; }
    if (route.topic === "SCHEDULE") { trace({ agent: "EnterpriseDataAgent", reader: "schedule-context(chat pipeline)" }); return { route, skipAgent: true }; }
    const read = await readState(route.topic as ReadTopic, identity, question, deps);
    if (!read) { trace({ agent: "EnterpriseDataAgent", reader: "none" }); return { route, skipAgent: true }; }
    trace({ agent: "EnterpriseDataAgent", source: read.source, factKeys: Object.keys(read.facts) });
    const tail = waiting ? await reminder(identity, sessionId, deps) : "";
    return { route, result: { answer: read.text + tail, blocks: [] } };
  }

  // ── RECOMMEND ──
  if (route.route === "RECOMMEND") {
    if (route.topic === "PT" || route.topic === "PROGRAM") {
      // an existing search workflow: outside a workflow start it; inside the same workflow it continues
      const kind = route.topic === "PT" ? "PT" : "PROGRAM";
      trace({ agent: "FitnessRecommendationAgent", action: "start-existing-workflow", kind });
      if (waiting) return { route, skipAgent: false };
      return { route, overrideIntentKind: kind };
    }
    const slotRelated = waiting && active!.expectedSlot && ((route.topic === "SESSIONS" && active!.expectedSlot === "daysPerWeek") || (route.topic === "MEALS" && active!.expectedSlot === "mealsPerDay") || (route.topic === "TARGET_WEIGHT" && active!.expectedSlot === "targetWeight") || (route.topic === "GOAL" && active!.expectedSlot === "goal"));
    if (slotRelated) { trace({ agent: "FitnessRecommendationAgent", action: "in-workflow recommendation (workflow policy)" }); return { route }; }
    const rec = await recommendStandalone(route, question, identity, sessionId, deps).catch((e) => { rethrowProfileFailures(e); logger.warn({ correlationId, err: (e as Error).message }, "ci_global_recommend_failed"); return null; });
    if (!rec) { trace({ agent: "FitnessRecommendationAgent", action: "recommendation unavailable → pass-through" }); return { route }; }
    trace({ agent: "EnterpriseDataAgent+FitnessRecommendationAgent", action: "deterministic recommendation", write: false });
    return { route, result: { answer: rec.answer + (waiting ? await reminder(identity, sessionId, deps) : ""), blocks: rec.blocks } };
  }

  // ── WRITE (goal / target change): PROPOSE only ──
  if ((route.route === "WRITE_ACTION" && route.topic === "GOAL_CHANGE") || route.route === "EXPLAIN_AND_PROPOSE") {
    if (waiting && active!.type !== "UPDATE_GOAL") {
      trace({ agent: "ConversationPolicy", action: "ask (another workflow is waiting)" });
      const p = await describePendingWorkflow(identity, sessionId, deps);
      return { route, result: { answer: `Bạn đang ${p?.label ?? "làm dở một việc khác"} dở. Bạn muốn mình hủy việc đó để đổi mục tiêu ngay, hay xong việc này rồi mới đổi? (Nhắn "hủy" nếu muốn dừng việc hiện tại rồi yêu cầu đổi mục tiêu lại.)`, blocks: [] } };
    }
    const signals = detectGoalSignals(s).filter((g) => !g.negatesGoal);
    const goalSig = signals.find((g) => g.strength === "EXPLICIT") ?? signals[0];
    const ents = extractEntities(question, { expectedSlot: "targetWeight" }).entities.filter((e) => e.type === "TARGET_WEIGHT_KG" && !e.negated);
    const patch: Record<string, unknown> = {};
    if (goalSig) patch.goal = goalSig.goal;
    if (ents[0]) patch.targetWeight = ents[0].value;
    if (Object.keys(patch).length === 0) { trace({ agent: "ConversationPolicy", action: "goal-change intent but no extractable target → ask" }); return { route, result: { answer: "Bạn muốn đổi sang mục tiêu nào — giảm mỡ, tăng cơ, duy trì hay hiệu suất thể thao? Nếu chưa chắc, bạn hỏi \"tôi nên cut hay bulk?\" để mình gợi ý theo số liệu của bạn.", blocks: [] } }; }
    if (active && active.type === "UPDATE_GOAL") {
      // a stale proposal row is in the way; the user restated a concrete change → replace it
      const { workflowStateRepository } = await import("../../agent-workflow/workflow-state.repository");
      await workflowStateRepository.cancel(active.id);
    }
    const profile = (await deps.getUserFitnessContext(identity)).profile;
    const explain = route.route === "EXPLAIN_AND_PROPOSE" && goalSig
      ? whyGoalExplanation({ to: goalSig.goal, heightCm: profileNumber(profile, "heightCm"), weightKg: profileNumber(profile, "currentWeight") }) + " "
      : "";
    const res = await startProfileChangeWorkflow(identity, sessionId, patch, explain ? explain + "Mình chưa thay đổi gì cho tới khi bạn xác nhận; đây là thay đổi mình đề xuất:" : undefined, {
      getUserFitnessContext: deps.getUserFitnessContext, updateProfileFields: deps.updateProfileFields,
    });
    trace({ agent: "ConversationPolicy", action: "PROPOSE_PROFILE_CHANGE", write: false, patchKeys: Object.keys(patch) });
    if (res) return { route, result: res };
    return { route };
  }

  // ── KNOWLEDGE Q&A ──
  if (route.route === "KNOWLEDGE_QA") {
    if (waiting) { trace({ action: "knowledge question interrupts the waiting workflow (workflow preserved)" }); return { route, skipAgent: true }; }
    if (legacyIntentKind === "PT" || legacyIntentKind === "PROGRAM") { trace({ action: "knowledge question would have started a search; routed to chat" }); return { route, skipAgent: true }; }
    trace({ action: "knowledge question → existing RAG pipeline (no CI-V2 involvement needed)" });
    return { route };
  }

  // ── negated action: acknowledge, do nothing ──
  if (route.route === "NEGATE_ACTION" && !/(khong luu|dung luu|khong can luu)/.test(s) && !waiting && !pendingDraft && /(\bpt\b|huan luyen vien|thue|muc tieu)/.test(s)) {
    trace({ action: "acknowledge negation (no action)" });
    const what = /\bpt\b|huan luyen|thue/.test(s) ? "thuê hay tìm PT" : "đổi mục tiêu";
    return { route, result: { answer: `Ok, mình sẽ không ${what}. Khi nào cần, bạn cứ nhắn mình nhé.`, blocks: [] } };
  }

  // ── START: keep the legacy intent, or supply the workflow's intent when the regex parser had none ──
  if (route.route === "START_WORKFLOW" && route.workflow && !legacyIntentKind) {
    trace({ action: "start workflow (regex parser had no intent of its own)" });
    return { route, overrideIntentKind: KIND_BY_WORKFLOW[route.workflow] };
  }

  // ── multi-intent: answer every READ part; anything that would ACT is offered, never auto-run ──
  if (route.route === "MULTI" && route.parts) {
    const answers: string[] = [];
    const offers: string[] = [];
    let knowledgeLeft = false;
    for (const part of route.parts) {
      if (part.route === "READ_STATE" && part.topic && part.topic !== "SCHEDULE") {
        const read = await readState(part.topic as ReadTopic, identity, question, deps);
        if (read) { answers.push(read.text); trace({ agent: "EnterpriseDataAgent", source: read.source, part: part.topic }); }
      } else if (part.route === "READ_STATE") {
        offers.push('Phần lịch tập hôm nay bạn hỏi riêng ("hôm nay tôi tập gì?") để mình đọc lịch chính xác nhé.');
      } else if (part.route === "RECOMMEND" && part.topic && part.topic !== "PT" && part.topic !== "PROGRAM") {
        const rec = await recommendStandalone(part, question, identity, sessionId, deps).catch((e) => { rethrowProfileFailures(e); return null; });
        if (rec) { answers.push(rec.answer); trace({ agent: "FitnessRecommendationAgent", part: part.topic, write: false }); }
      } else if (part.route === "START_WORKFLOW" || part.route === "RECOMMEND") {
        const w = part.workflow ?? (part.topic === "PROGRAM" ? "FIND_TRAINING_PROGRAM" : part.topic === "PT" ? "FIND_PT" : undefined);
        const label = w === "FIND_PT" ? 'tìm PT' : w === "CREATE_WORKOUT_PLAN" ? 'tạo lịch tập' : w === "CREATE_NUTRITION_PLAN" ? 'tạo thực đơn' : w === "CREATE_ROADMAP" ? 'tạo lộ trình' : w === "FIND_TRAINING_PROGRAM" ? 'tìm chương trình tập' : 'làm việc đó';
        offers.push(`Nếu bạn muốn ${label}, hãy nhắn riêng "${label} cho tôi" — mình chưa tự bắt đầu vì mỗi bước cần bạn xác nhận.`);
      } else if (part.route === "KNOWLEDGE_QA") knowledgeLeft = true;
    }
    if (knowledgeLeft) offers.push("Còn phần câu hỏi kiến thức, bạn hỏi riêng để mình trả lời đầy đủ nhé.");
    if (answers.length === 0 && offers.length === 0) { trace({ action: "multi-intent (nothing answerable) → pass-through" }); return { route }; }
    trace({ action: "multi-intent answered", parts: route.multi, write: false });
    return { route, result: { answer: [...answers, ...offers].join(NL), blocks: [] } };
  }

  trace({ action: "pass-through to the existing pipeline" });
  return { route };
}
