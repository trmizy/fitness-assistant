/**
 * Gymini V2 (EXPERIMENTAL, flag AI_AGENT_V2 default OFF) — Multi-Agent Supervisor (M1, 2026-11-13).
 *
 * One turn:
 *   flag → authenticated context → input → V1 input safety → route (swappable DecisionProvider) → validate decision against the
 *   registered capabilities + execution policy (a decision can only NAME agents) → Gate 1 minor policy over the whole turn,
 *   BEFORE any delegation (one profile read, shared with every agent) → sequential delegations, each with a hard slice of the
 *   REMAINING turn budget → typed facts handed forward (never another agent's text) → evidence reconciliation (conflicts,
 *   policy violations) → deterministic composition with provenance → final guards → one SupervisorTrace.
 * No model call is made by the supervisor itself in M1 (deterministic router + deterministic composer). Not wired to /ai/ask.
 * See multi-agent-contracts.ts for the recorded governance deviation.
 */
import { randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { foldVi } from "../llm/speech_act";
import { stripInternalReferences } from "../llm/output_hygiene";
import { appendMinorSupervisionNote } from "../llm/medical-referral";
import { checkInputSafety, splitSentences } from "./answer-guards";
import { isAgentV2Enabled } from "./flag";
import { PILOT_LIMITS, type AgentLimits, type AgentTurn, type AgentTurnResult, type BoundedAgentDeps } from "./bounded-agent";
import { classifyMinorRequest, decideMinorGate, resolveAgeVerdict, type ProfileAgeRead, type VerifiedProfileAgeReader } from "./minor-gate";
import type { AgentModelProvider } from "./model-provider";
import type { ToolRegistry } from "./tool-registry";
import type { TurnTrace } from "./turn-trace";
import { progressEvidenceOf } from "./progress-tools";
import { createIntentDecisionProvider } from "./routing-planner";
import {
  agentsSatisfiedBySession, entriesFromFacts, invalidate, mergeEntries, reusableContext, userStatement,
  type ContextEntry, type SessionContextStore,
} from "./session-context";
import type {
  AgentBudget, AgentCapability, AgentCompletion, AgentEvidence, AgentExecutionPolicy, AgentId, AgentRequest, AgentResult,
  AgentRunner, AgentRuntime, DecisionInput, DecisionProvider, ProfileReadResult, SupervisorDecision, SupervisorProfileReader,
} from "./multi-agent-contracts";

// ── defaults ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Whole-turn budget (hard). Two pilot agents at their full per-agent caps would need 2 × $0.05; the supervisor allows $0.08 in
 * total, so a two-agent turn is always cheaper than two independent agent turns, and adding agents never raises the ceiling.
 */
export const SUPERVISOR_BUDGET: Readonly<AgentBudget> = Object.freeze({
  maxWallTimeMs: 60_000, maxModelCalls: 8, maxToolCalls: 6, maxInputTokens: 60_000, maxOutputTokens: 6_000, maxCostUsd: 0.08,
});
export const DEFAULT_EXECUTION_POLICY: Readonly<AgentExecutionPolicy> = Object.freeze({
  allowedAgents: Object.freeze(["progress", "recovery", "training", "nutrition"]) as readonly AgentId[],
  maxAgentsPerTurn: 2,
  budget: SUPERVISOR_BUDGET,
  minDelegationWallMs: 2_000,
});
/**
 * Data producers first, so their typed facts can be handed to later agents: Recovery (logged load) → Training (today's plan,
 * may weigh the recovery evidence) → Progress → Nutrition.
 */
const AGENT_ORDER: readonly AgentId[] = ["progress", "recovery", "training", "nutrition"];
const AGENT_LABEL: Record<AgentId, string> = { training: "Tập luyện", nutrition: "Dinh dưỡng", recovery: "Phục hồi", progress: "Tiến độ" };

// ── routing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Folded-text signals per agent. A table, not an if/else: adding an agent = adding a row (and registering its runner). */
export const ROUTING_SIGNALS: Readonly<Partial<Record<AgentId, RegExp>>> = Object.freeze({
  // M3: "tải tập" (training load) is a recovery/progress notion, not a request for today's training.
  training: /\b((?<!tai )tap(?! trung)|lich tap|buoi tap|bai tap|nhom co|chu ky|hiep|squat|deadlift|bench|gym|khoi dong|gian co|cardio|chay bo)\b/,
  nutrition: /\b(an(?! toan| tam| ninh)|uong|bua|dinh duong|protein|dam|calo|kcal|macro|carb|tinh bot|chat beo|thuc don|thuc pham|mon an|whey|che do an)\b/,
  // M2. "phục hồi cơ" alone is NOT a recovery signal (e.g. "protein có vai trò gì trong phục hồi cơ" is a nutrition question).
  recovery: /\b(nghi ngoi|ngay nghi|nghi (bao lau|may ngay|giua)|met|qua met|kiet suc|uong co|dau moi|nhuc moi|doms|qua tai|hoi suc|giam khoi luong|deload|chua hoi phuc|da hoi phuc|hoi phuc (chua|du|hoan toan|sau buoi|giua)|giac ngu|ngu du)\b|\btap\b.{0,25}\bhom qua\b|\bhom qua\b.{0,25}\btap\b/,
  // M3
  progress: /\b(tien bo|tien do|tien trien|ket qua (tap|do|inbody)|xu huong|manh hon|yeu di|suc manh|1 ?rm|can nang|giam duoc|tang duoc|body fat|mo co the|ti le mo|inbody|du bao|dat muc tieu|muc tieu can nang|hieu suat)\b/,
});

export const keywordDecisionProvider: DecisionProvider = {
  name: "keyword-v1",
  decide({ folded, available }: DecisionInput): SupervisorDecision {
    const agents = available.filter((a) => ROUTING_SIGNALS[a]?.test(folded));
    return { strategy: "keyword-v1", agents, reasonCodes: agents.length ? agents.map((a) => `signal:${a}`) : ["no_domain_signal"] };
  },
};

// ── budget arithmetic ────────────────────────────────────────────────────────────────────────────────────────────────
const DIMS = ["maxWallTimeMs", "maxModelCalls", "maxToolCalls", "maxInputTokens", "maxOutputTokens", "maxCostUsd"] as const;
type Spent = Record<(typeof DIMS)[number], number>;
const zeroSpent = (): Spent => ({ maxWallTimeMs: 0, maxModelCalls: 0, maxToolCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxCostUsd: 0 });

/** The slice for the next delegation: the remaining turn budget shared evenly among the agents still to run (hard). */
export function grantBudget(limit: AgentBudget, spent: Spent, agentsLeft: number): AgentBudget {
  const share = (k: (typeof DIMS)[number]) => Math.max(0, limit[k] - spent[k]) / Math.max(1, agentsLeft);
  return {
    maxWallTimeMs: Math.floor(share("maxWallTimeMs")),
    maxModelCalls: Math.floor(share("maxModelCalls")),
    maxToolCalls: Math.floor(share("maxToolCalls")),
    maxInputTokens: Math.floor(share("maxInputTokens")),
    maxOutputTokens: Math.floor(share("maxOutputTokens")),
    maxCostUsd: Number(share("maxCostUsd").toFixed(6)),
  };
}

/** Engine limits for a delegation: never above the agent's own pilot caps, never above the granted slice. */
export function limitsFor(grant: AgentBudget, overrides: Partial<AgentLimits> = {}): Partial<AgentLimits> {
  const lower = (k: keyof AgentLimits, v: number) => Math.min(v, overrides[k] ?? Number.POSITIVE_INFINITY);
  return {
    ...overrides,
    maxWallTimeMs: lower("maxWallTimeMs", Math.min(PILOT_LIMITS.maxWallTimeMs, grant.maxWallTimeMs)),
    maxModelCalls: lower("maxModelCalls", Math.min(PILOT_LIMITS.maxModelCalls, grant.maxModelCalls)),
    maxToolCalls: lower("maxToolCalls", Math.min(PILOT_LIMITS.maxToolCalls, grant.maxToolCalls)),
    maxTotalInputTokens: lower("maxTotalInputTokens", Math.min(PILOT_LIMITS.maxTotalInputTokens, grant.maxInputTokens)),
    maxTotalOutputTokens: lower("maxTotalOutputTokens", Math.min(PILOT_LIMITS.maxTotalOutputTokens, grant.maxOutputTokens)),
    perCallMaxOutputTokens: lower("perCallMaxOutputTokens", Math.min(PILOT_LIMITS.perCallMaxOutputTokens, grant.maxOutputTokens)),
    maxEstimatedCostUsd: lower("maxEstimatedCostUsd", Math.min(PILOT_LIMITS.maxEstimatedCostUsd, grant.maxCostUsd)),
  };
}

// ── profile reader (Gate 1 contract) ─────────────────────────────────────────────────────────────────────────────────
/** Maps the 4-state supervisor contract onto the minor-gate input. DENIED / UNAVAILABLE stay FAILED (fail closed). */
export function toProfileAgeRead(r: ProfileReadResult | null | undefined): ProfileAgeRead {
  switch (r?.status) {
    case "PROFILE_OK": return Number.isInteger(r.age) && r.age >= 1 && r.age <= 120 ? { status: "OK", age: r.age } : { status: "OK", age: null };
    case "AGE_UNKNOWN": return { status: "OK", age: null };
    case "PROFILE_ACCESS_DENIED": return { status: "FAILED", reason: "access_denied" };
    case "PROFILE_UNAVAILABLE": return { status: "FAILED", reason: "unavailable" };
    default: return { status: "FAILED", reason: "malformed_reader_result" };
  }
}

// ── typed facts (derived by code from schema-validated projections, never from model text) ───────────────────────────
export type BodyFocus = "LOWER_BODY" | "UPPER_BODY" | "FULL_BODY" | "UNSPECIFIED";
function focusOf(title: unknown): BodyFocus {
  const f = foldVi(String(title ?? ""));
  if (/\b(chan|leg|legs|lower|duoi|mong|glute|squat)\b/.test(f)) return "LOWER_BODY";
  if (/\b(full|toan than|fullbody)\b/.test(f)) return "FULL_BODY";
  if (/\b(nguc|lung|vai|tay|upper|push|pull|tren|chest|back|arm|shoulder)\b/.test(f)) return "UPPER_BODY";
  return "UNSPECIFIED";
}
export function trainingFacts(toolId: string, data: unknown): Record<string, unknown> | null {
  if (toolId !== "training.get_today_schedule" || !Array.isArray(data)) return null;
  const active = data.filter((s: any) => s?.status !== "CANCELLED" && s?.status !== "SKIPPED");
  // enum values only: a session TITLE is user/PT-authored text and is never handed to another agent
  return { todaySchedule: { known: true, sessionCount: active.length, focus: active.length ? focusOf((active[0] as any)?.title) : "UNSPECIFIED" } };
}
/** Whole days between a YYYY-MM-DD date and `now` (UTC calendar days). */
function daysAgo(date: string, now: number): number | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - t) / 86_400_000);
}
/** M2: enums and counts from the recovery projections only (never notes, names or a derived score). */
export function recoveryFacts(toolId: string, data: unknown, now: number = Date.now()): Record<string, unknown> | null {
  if (toolId === "recovery.get_recent_sessions" && data && Array.isArray((data as any).sessions)) {
    const sessions = (data as any).sessions as Array<{ date: string; bodyParts: string[]; maxPainScore: number | null }>;
    const aged = sessions.map((s) => ({ ...s, ago: daysAgo(s.date, now) })).filter((s) => s.ago !== null && s.ago >= 0);
    const yesterday = aged.filter((s) => s.ago === 1);
    return {
      recentSessions: {
        known: true,
        loggedLast7d: aged.filter((s) => (s.ago as number) <= 7).length,
        lastLoggedDaysAgo: aged.length ? Math.min(...aged.map((s) => s.ago as number)) : null,
        yesterdayBodyParts: yesterday.length ? [...new Set(yesterday.flatMap((s) => s.bodyParts))] : null,
        painLoggedLast7d: aged.some((s) => (s.ago as number) <= 7 && typeof s.maxPainScore === "number" && s.maxPainScore > 0),
      },
    };
  }
  if (toolId === "recovery.get_training_load" && data && typeof data === "object") {
    const d = data as any;
    return {
      trainingLoad: d.available
        ? { known: true, dataQuality: d.dataQuality, completedPerWeek: d.frequency?.completedPerWeek ?? null, rpeTrend: d.effort?.rpeTrend ?? null, volumeTrendPercent: d.volume?.trendPercent ?? null }
        : { known: true, dataQuality: "NO_DATA" },
    };
  }
  return null;
}
/** M3: enums/counts only, each labelled with its evidence kind (observation vs estimate vs forecast vs goal). */
export function progressFacts(toolId: string, data: unknown): Record<string, unknown> | null {
  const d = data as any;
  const kinds = progressEvidenceOf(toolId, d).map((e) => `${e.subject}:${e.kind}`);
  if (toolId === "progress.get_body_measurements") {
    if (!d?.available) return { measurementAvailability: { known: true, weight: "MISSING", bodyFat: "MISSING" }, progressEvidence: kinds };
    return {
      measurementAvailability: { known: true, weight: d.latest?.weightKg != null ? "OBSERVED" : "MISSING", bodyFat: d.latest?.bodyFatPct != null ? "OBSERVED" : "MISSING", latestAgeDays: d.observations?.latestAgeDays ?? null, dataQuality: d.dataQuality },
      bodyTrend: { weightStatus: d.trends?.weight?.status, weightDirection: d.trends?.weight?.direction ?? null, weightDataPoints: d.trends?.weight?.dataPoints ?? 0 },
      goalStatus: { hasTarget: d.goal?.targetWeightKg != null, gap: d.gap?.state, directionRelativeToGap: d.observedTrajectory?.state === "AVAILABLE" ? d.observedTrajectory.directionRelativeToGap : null, onTrack: "NOT_EVALUABLE" },
      progressEvidence: kinds,
    };
  }
  if (toolId === "progress.get_strength_progression") {
    const ex = Array.isArray(d?.exercises) ? d.exercises : [];
    const sign = (s: number) => ex.filter((e: any) => typeof e.changePct === "number" && Math.sign(e.changePct) === s).length;
    return { strengthTrend: { kind: "DERIVED_ESTIMATE", available: !!d?.available && ex.length > 0, exercisesUp: sign(1), exercisesDown: sign(-1), exercisesFlat: sign(0), quality: d?.dataQuality ?? "NO_DATA" }, progressEvidence: kinds };
  }
  if (toolId === "progress.get_cycle_status") {
    return { assessmentFreshness: { hasActiveCycle: !!d?.activeCycle, hasAssessment: !!d?.latestAssessment, decision: d?.latestAssessment?.decision ?? null }, progressEvidence: kinds };
  }
  if (toolId === "progress.get_roadmap_forecast") return { observedVsForecast: { forecastAvailable: !!d?.available, kind: "FORECAST", isMeasurement: false }, progressEvidence: kinds };
  return null;
}
export function nutritionFacts(toolId: string, data: unknown): Record<string, unknown> | null {
  if (toolId !== "nutrition.get_target" || !data || typeof data !== "object") return null;
  return { nutritionTarget: { status: (data as any).status } };
}

// ── runner for agents built on the bounded engine ────────────────────────────────────────────────────────────────────
const COMPLETION: Record<string, AgentCompletion> = {
  ANSWERED: "COMPLETE", UNGROUNDED: "INSUFFICIENT_DATA", MINOR_PROTECTED: "BLOCKED", PROFILE_UNVERIFIED: "BLOCKED",
  SAFETY_BLOCKED: "BLOCKED", CONFIRMATION_REQUIRED: "BLOCKED", BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED", DEADLINE_EXCEEDED: "BUDGET_EXHAUSTED",
};

export function createBoundedAgentRunner(
  capability: AgentCapability,
  run: (turn: AgentTurn, deps: BoundedAgentDeps) => Promise<AgentTurnResult>,
  base: { provider: AgentModelProvider; registry: ToolRegistry<any>; facts?: (toolId: string, data: unknown) => Record<string, unknown> | null },
): AgentRunner {
  return {
    capability,
    async run(request: AgentRequest, runtime: AgentRuntime): Promise<AgentResult> {
      const facts: Record<string, unknown> = {};
      const started = runtime.now();
      const res = await run(
        { question: request.task, context: request.context.identity, history: [...request.context.history] },
        {
          provider: base.provider, registry: base.registry, policy: capability.toolPolicy, enabled: runtime.enabled, now: runtime.now,
          limits: limitsFor(request.budget, runtime.limitOverrides), getVerifiedProfileAge: runtime.profileAgeReader,
          traceSink: runtime.agentTraceSink, handoffData: request.context.handoff,
          traceLinks: { supervisorTraceId: runtime.supervisorTraceId, delegationId: request.delegationId },
          onToolResult: (toolId, data) => { const f = base.facts?.(toolId, data); if (f) Object.assign(facts, f); },
        });
      return {
        delegationId: request.delegationId, agentId: capability.agentId, agentTurnId: res.turnId,
        completion: COMPLETION[res.status] ?? "FAILED", agentStatus: res.status, answer: res.answer,
        evidence: res.tools.map((t) => ({ agentId: capability.agentId, delegationId: request.delegationId, toolId: t.toolId, outcome: t.outcome, personal: capability.personalTools.has(t.toolId) })),
        facts, guardActions: res.guardActions,
        usage: { modelCalls: res.usage.modelRounds, toolCalls: res.usage.toolInvocations, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, estimatedCostUsd: res.usage.estimatedCostUsd, latencyMs: runtime.now() - started },
        ...(COMPLETION[res.status] ? {} : { error: { code: "AGENT_FAILED" as const, retryable: false } }),
      };
    },
  };
}

// ── supervisor ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type SupervisorStatus =
  | "ANSWERED" | "PARTIAL" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED" | "BUDGET_EXHAUSTED" | "OUT_OF_SCOPE"
  | "DISABLED" | "UNAUTHENTICATED" | "INVALID_INPUT" | "SAFETY_BLOCKED" | "MINOR_PROTECTED" | "PROFILE_UNVERIFIED";

export interface DelegationTrace {
  delegationId: string;
  agentId: AgentId;
  agentTurnId: string | null;
  completionStatus: AgentCompletion;
  agentStatus: string;
  modelCallCount: number;
  toolCallCount: number;
  latencyMs: number;
  tokenUsage: { input: number; output: number };
  estimatedCost: number;
  guardInterventions: Record<string, number>;
  budgetGranted: AgentBudget;
  evidence: Array<{ toolId: string; outcome: string; personal: boolean }>;
}

export interface SupervisorTrace {
  supervisorTraceId: string;
  turnId: string;
  startedAt: string;
  durationMs: number;
  status: SupervisorStatus;
  question: { length: number };
  answerLength: number;
  decision: { strategy: string; agents: AgentId[]; dropped: string[]; reasonCodes: string[] } | null;
  profileRead: ProfileReadResult["status"] | "NOT_READ" | "READER_ERROR";
  ageGate: { status: string; minorBy: string[]; conflict: boolean; decision: string } | null;
  delegations: DelegationTrace[];
  conflicts: string[];
  totals: { modelCallCount: number; toolCallCount: number; tokenUsage: { input: number; output: number }; estimatedCost: number; latencyMs: number };
  budget: { limit: AgentBudget; spent: AgentBudget; overrun: string[] };
  /** M4: routing plan summary (codes only). */
  routing?: { coverage: string; uncertainty: string; primaryNeed: string | null; deferred: Array<{ agentId: AgentId; needs: string[]; reason: string }> } | null;
  /** M4: session-context counts (never values, subjects of user data or the session id). */
  session?: { used: boolean; loaded: number; reused: number; expired: number; superseded: number; droppedInvalid: number; stored: number } | null;
}

export interface SupervisorResult {
  supervisorTraceId: string;
  turnId: string;
  status: SupervisorStatus;
  answer: string;
  decision: SupervisorDecision | null;
  results: AgentResult[];
  provenance: AgentEvidence[];
  conflicts: string[];
}

export interface SupervisorDeps {
  runners: readonly AgentRunner[];
  decisionProvider?: DecisionProvider;
  executionPolicy?: Partial<AgentExecutionPolicy>;
  /** Gate 1 reader (4-state contract). Absent → PROFILE_UNAVAILABLE (fail closed); profileExtractor is NOT used here. */
  profileReader?: SupervisorProfileReader;
  enabled?: boolean;
  now?: () => number;
  traceSink?: (trace: SupervisorTrace) => void;
  agentTraceSink?: (trace: TurnTrace) => void;
  limitOverrides?: Partial<AgentLimits>;
  /** M4: multi-turn context (in-memory in tests). Absent → single-turn behaviour (M1–M3). */
  sessionStore?: SessionContextStore;
}

export interface SupervisorTurn {
  question: string;
  /** Built by the HTTP boundary from the verified request — never from model output. */
  context: unknown;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** M4: a client-provided conversation id. Only a HINT: the scope is (authenticated userId, sessionId). */
  sessionId?: string;
}

const TEXT: Record<string, string> = {
  DISABLED: "Tính năng trợ lý đa tác tử thử nghiệm đang tắt.",
  UNAUTHENTICATED: "Bạn cần đăng nhập để dùng trợ lý.",
  INVALID_INPUT: "Câu hỏi quá dài hoặc không hợp lệ. Hãy hỏi ngắn gọn hơn.",
  OUT_OF_SCOPE: "Mình hiện chỉ hỗ trợ câu hỏi về tập luyện, phục hồi, tiến độ và dinh dưỡng. Bạn có thể hỏi cụ thể hơn về một trong các chủ đề này nhé.",
  FORECAST_NOTE: "Lưu ý: con số trong dự báo là kịch bản của ứng dụng, không phải kết quả đo. Mức thay đổi thực tế chỉ dựa trên các lần đo đã ghi.",
  CAUSAL_NOTE: "Lưu ý: dữ liệu chỉ cho thấy các thay đổi xảy ra cùng lúc, chưa đủ để kết luận cái này gây ra cái kia.",
  AGE_REQUIRED: "Hồ sơ của bạn chưa có tuổi, nên mình chưa thể tư vấn cá nhân cho yêu cầu này (mục tiêu thay đổi cơ thể, cường độ tối đa hoặc các yêu cầu có rủi ro). Bạn hãy cập nhật tuổi trong hồ sơ rồi hỏi lại nhé; câu hỏi kiến thức chung thì mình vẫn trả lời được.",
  HISTORY_CONFLICT: "Lưu ý: nhật ký tập của bạn không có buổi tập nào được ghi vào hôm qua. Mình vẫn tính đến điều bạn kể, nhưng phần nhận xét dựa trên dữ liệu chỉ phản ánh các buổi đã được ghi.",
  BODY_PART_CONFLICT: "Lưu ý: buổi tập được ghi vào hôm qua không phải nhóm cơ bạn nhắc tới. Mình giữ cả hai thông tin như nhau — bạn kiểm tra lại nhật ký tập nhé.",
  FAILED: "Trợ lý tạm thời chưa trả lời được. Bạn thử lại sau ít phút nhé.",
  BUDGET_EXHAUSTED: "Mình chưa thể hoàn thành câu trả lời trong giới hạn xử lý cho phép. Bạn thử hỏi cụ thể hơn nhé.",
  SCHEDULE_CONFLICT: "Lưu ý: mình không thấy buổi tập nào trong lịch hôm nay của bạn, nên phần dưới là gợi ý chung, chỉ áp dụng nếu bạn tự tập.",
};
const PART_UNAVAILABLE: Record<Exclude<AgentCompletion, "COMPLETE" | "BLOCKED">, (label: string) => string> = {
  INSUFFICIENT_DATA: (l) => `Phần ${l.toLowerCase()}: mình chưa đọc được dữ liệu cần thiết của bạn nên chưa trả lời phần này.`,
  FAILED: (l) => `Phần ${l.toLowerCase()}: trợ lý tạm thời chưa trả lời được.`,
  BUDGET_EXHAUSTED: (l) => `Phần ${l.toLowerCase()}: chưa xử lý kịp trong giới hạn cho phép.`,
  SKIPPED: (l) => `Phần ${l.toLowerCase()}: chưa xử lý kịp trong giới hạn cho phép.`,
  POLICY_VIOLATION: (l) => `Phần ${l.toLowerCase()}: không thể hiển thị vì vi phạm chính sách an toàn.`,
};

/** Folded: the user asserts a workout today ("hôm nay tôi có buổi tập chân"). */
/** M2, folded: the user says they trained (a body part) yesterday. Group 1 = the named part, if any. */
const CLAIMS_TRAINED_YESTERDAY = /\btap\s*(chan|mong|dui|nguc|lung|vai|tay|bung|full body|toan than)?\b.{0,20}\bhom qua\b/;
const CLAIMS_TRAINED_YESTERDAY_REVERSED = /\bhom qua\b.{0,20}\btap\s*(chan|mong|dui|nguc|lung|vai|tay|bung|full body|toan than)?\b/;
/** M4, folded: a forecast the user mentions ("dự báo tôi giảm 2 kg") — stored as a FORECAST user statement, never a result. */
const FORECAST_MENTION = /\bdu bao\b.{0,40}?\b(giam|tang)\s+(\d+(?:[.,]\d+)?)\s*(?:kg|ky|ki)\b/;
/** M4, folded: "how much have I lost / gained (so far)?". */
const ACHIEVED_ASK = /\b(da|duoc) (giam|tang)\b|\b(giam|tang) duoc\b/;
const CLAIMED_PART: Record<string, string> = { chan: "LOWER_BODY", mong: "LOWER_BODY", dui: "LOWER_BODY", nguc: "UPPER_BODY", lung: "UPPER_BODY", vai: "UPPER_BODY", tay: "UPPER_BODY", bung: "CORE", "full body": "FULL_BODY", "toan than": "FULL_BODY" };
/** M2, folded: first-person fatigue — a SELF-REPORT handed to agents as such, never as a measurement. */
const SELF_REPORTED_FATIGUE = /\b(toi|minh|em)\b.{0,50}\b(met|qua met|kiet suc|uong co|nhuc moi|dau moi|ue oai)\b/;
/** M3, folded: the user treats a forecast figure as an achieved one ("dự báo tôi giảm 2 kg, vậy tôi đã giảm được 2 kg?"). */
const FORECAST_CONFUSION = /\bdu bao\b.{0,60}\b(da|duoc|vay) (giam|tang|dat)|\b(da|duoc) (giam|tang)\b.{0,60}\bdu bao\b/;
/** M3, folded: a causal claim ("nguyên nhân là", "là do tải tập") — kept out when only correlations were observed. */
const CAUSAL_CLAIM = /\b(nguyen nhan (chinh )?(la|cua)|chinh la do|la do (tai|met|khoi luong|tap|thieu ngu)|gay ra boi|chac chan do|vi vay (hieu suat|suc manh) (giam|tang))\b/;
const CLAIMS_SESSION_TODAY = /\bhom nay\b.{0,30}\b(co|se) (buoi|lich|bai)? ?tap\b|\bbuoi tap\b.{0,20}\bhom nay\b|\bhom nay\b.{0,15}\btap (chan|nguc|lung|vai|tay|mong|full)/;
/** Folded: a sentence asserting the user's schedule contains a session today. */
const SCHEDULE_CLAIM = /(trong lich|theo lich|lich (tap )?(hom nay|cua ban)|buoi tap (hom nay )?cua ban)/;
/** Provider-style tool names (training__get_x) never reach the user. */
const TOOL_NAME = /\b[a-z]+__[a-z_]+\b/;

function countGuards(actions: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of actions) { const k = a.split(":")[0]; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export async function runSupervisorTurn(turn: SupervisorTurn, deps: SupervisorDeps): Promise<SupervisorResult> {
  const policy: AgentExecutionPolicy = { ...DEFAULT_EXECUTION_POLICY, ...(deps.executionPolicy ?? {}) };
  const now = deps.now ?? Date.now;
  const started = now();
  const supervisorTraceId = randomUUID();
  const turnId = randomUUID();
  const sink = deps.traceSink ?? ((t: SupervisorTrace) => logger.info(t, "agent_v2_supervisor_turn"));
  const results: AgentResult[] = [];
  const delegations: DelegationTrace[] = [];
  const conflicts: string[] = [];
  const spent = zeroSpent();
  const overrun: string[] = [];
  let decision: SupervisorDecision | null = null;
  let dropped: string[] = [];
  let profileStatus: SupervisorTrace["profileRead"] = "NOT_READ";
  let ageGate: SupervisorTrace["ageGate"] = null;
  let routingSummary: SupervisorTrace["routing"] = null;
  let sessionCounts: SupervisorTrace["session"] = null;

  const finish = (status: SupervisorStatus, answer: string): SupervisorResult => {
    const durationMs = now() - started;
    try {
      sink({
        supervisorTraceId, turnId, startedAt: new Date(started).toISOString(), durationMs, status,
        question: { length: typeof turn.question === "string" ? turn.question.length : 0 }, answerLength: answer.length,
        decision: decision ? { strategy: decision.strategy, agents: decision.agents, dropped, reasonCodes: decision.reasonCodes } : null,
        profileRead: profileStatus, ageGate, delegations, conflicts,
        totals: {
          modelCallCount: spent.maxModelCalls, toolCallCount: spent.maxToolCalls, tokenUsage: { input: spent.maxInputTokens, output: spent.maxOutputTokens },
          estimatedCost: Number(spent.maxCostUsd.toFixed(6)), latencyMs: durationMs,
        },
        budget: { limit: policy.budget, spent: { ...spent, maxWallTimeMs: durationMs, maxCostUsd: Number(spent.maxCostUsd.toFixed(6)) }, overrun },
        routing: routingSummary, session: sessionCounts,
      });
    } catch { /* tracing must never change the outcome */ }
    return { supervisorTraceId, turnId, status, answer, decision, results, provenance: results.flatMap((r) => r.evidence), conflicts };
  };

  // 1. gates that never cost anything
  const enabled = deps.enabled ?? isAgentV2Enabled();
  if (!enabled) return finish("DISABLED", TEXT.DISABLED);
  const ctx = turn.context as { userId?: unknown; authorizationHeader?: unknown } | null | undefined;
  if (!ctx || typeof ctx.userId !== "string" || !/^\S{1,128}$/.test(ctx.userId)) return finish("UNAUTHENTICATED", TEXT.UNAUTHENTICATED);
  const identity = { userId: ctx.userId, ...(typeof ctx.authorizationHeader === "string" ? { authorizationHeader: ctx.authorizationHeader } : {}) };
  const question = typeof turn.question === "string" ? turn.question.trim() : "";
  if (!question || question.length > PILOT_LIMITS.maxQuestionChars) return finish("INVALID_INPUT", TEXT.INVALID_INPUT);
  const safety = checkInputSafety(question);
  if (!safety.safe) return finish("SAFETY_BLOCKED", safety.message ?? TEXT.FAILED);
  const folded = foldVi(question);

  // M4: session context — scope = (authenticated userId, sessionId); the client's sessionId alone authorizes nothing
  const sessionId = typeof turn.sessionId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(turn.sessionId) ? turn.sessionId : null;
  const store = deps.sessionStore && sessionId ? deps.sessionStore : null;
  let sessionAll: ContextEntry[] = [];
  let reuse: ReturnType<typeof reusableContext>["reuse"] | null = null;
  if (store) {
    let loadedRaw: unknown[] = [];
    try { loadedRaw = store.load(identity.userId, sessionId!); } catch { loadedRaw = []; }
    const loaded = reusableContext(loadedRaw, identity.userId, sessionId!, now());
    sessionAll = loaded.all; reuse = loaded.reuse;
    sessionCounts = { used: true, ...loaded.reuse.counts, stored: 0 };
  }

  // 2. route (M4 default: intent planner), then validate: a decision can only select registered, allowed agents
  const byId = new Map<AgentId, AgentRunner>();
  for (const r of deps.runners) if (!byId.has(r.capability.agentId)) byId.set(r.capability.agentId, r);
  const available = AGENT_ORDER.filter((a) => byId.has(a) && policy.allowedAgents.includes(a));
  const provider = deps.decisionProvider ?? createIntentDecisionProvider({ maxAgents: policy.maxAgentsPerTurn, domainSignals: ROUTING_SIGNALS });
  const satisfiedFromSession = reuse ? agentsSatisfiedBySession(reuse.freshSubjects) : new Set<AgentId>();
  let raw: SupervisorDecision;
  try {
    raw = await provider.decide({ question, folded, available, satisfiedFromSession });
  } catch {
    raw = { strategy: provider.name, agents: [], reasonCodes: ["decision_provider_error"] };
  }
  const requested = Array.isArray(raw?.agents) ? raw.agents.map(String) : [];
  const valid = AGENT_ORDER.filter((a) => requested.includes(a) && available.includes(a));
  dropped = [...new Set(requested.filter((a) => !valid.includes(a as AgentId)))].slice(0, 10).map((a) => a.slice(0, 40));
  const selected = valid.slice(0, Math.max(0, policy.maxAgentsPerTurn));
  if (valid.length > selected.length) dropped.push(...valid.slice(selected.length).map((a) => `${a}:max_agents`));
  // the plan's own deferrals (intent ranking / fresh session facts) are recorded the same way — never silent
  const plan = raw?.plan && Array.isArray(raw.plan.deferred) ? raw.plan : null;
  const planDeferred = (plan?.deferred ?? []).filter((d) => available.includes(d.agentId) && !selected.includes(d.agentId));
  for (const d of planDeferred) dropped.push(`${d.agentId}:${d.reason === "MAX_AGENTS" ? "max_agents" : "from_session"}`);
  routingSummary = plan ? { coverage: plan.coverage, uncertainty: plan.uncertainty, primaryNeed: plan.primaryNeed, deferred: planDeferred.map((d) => ({ agentId: d.agentId, needs: d.needs, reason: d.reason })) } : null;
  decision = { strategy: String(raw?.strategy ?? provider.name).slice(0, 40), agents: selected, reasonCodes: (raw?.reasonCodes ?? []).map((c) => String(c).slice(0, 40)).slice(0, 10), ...(plan ? { plan } : {}) };
  if (!selected.length) return finish("OUT_OF_SCOPE", TEXT.OUT_OF_SCOPE);

  // 3. Gate 1 over the WHOLE turn, before any delegation — one read, shared by every agent (they cannot loosen it)
  let read: ProfileReadResult;
  try {
    read = deps.profileReader ? await deps.profileReader(identity) : { status: "PROFILE_UNAVAILABLE" };
    profileStatus = read?.status ?? "READER_ERROR";
  } catch {
    read = { status: "PROFILE_UNAVAILABLE" };
    profileStatus = "READER_ERROR";
  }
  const ageRead = toProfileAgeRead(read);
  const profileAgeReader: VerifiedProfileAgeReader = async () => ageRead;
  const history = (turn.history ?? []).slice(-4).map((h) => ({ role: h.role, text: String(h.text ?? "").slice(0, 1_500) }));
  const verdict = resolveAgeVerdict(ageRead, question, history.filter((h) => h.role === "user").map((h) => h.text));
  const needsOwnData = selected.some((a) => byId.get(a)!.capability.needsUserData.test(folded));
  const gate = decideMinorGate(verdict, classifyMinorRequest(question), needsOwnData);
  ageGate = { status: verdict.status, minorBy: verdict.minorBy, conflict: verdict.conflict, decision: gate.action };
  if (gate.action === "BLOCK") return finish(gate.status, gate.message);
  // M3: AGE_UNKNOWN is never evidence of adulthood — a HIGH_RISK personal request (body-change targets, max effort,
  // supplements, pain…) fails closed until the profile carries an age (a self-stated adult age cannot unlock it).
  if (read.status === "AGE_UNKNOWN" && verdict.status === "UNKNOWN" && needsOwnData && classifyMinorRequest(question) === "HIGH_RISK") {
    ageGate = { ...ageGate, decision: "BLOCK_AGE_UNKNOWN" };
    return finish("PROFILE_UNVERIFIED", TEXT.AGE_REQUIRED);
  }
  const generalOnly = gate.action === "GENERAL_ONLY";

  // 4. delegations — sequential, each bounded by a slice of the REMAINING turn budget
  // the user's own fatigue statement travels as a labelled self-report (the question itself is never handed over)
  let handoff: Record<string, unknown> = SELF_REPORTED_FATIGUE.test(folded) ? { selfReport: { fatigue: true, source: "user_statement" } } : {};
  // M4: fresh session facts (typed, labelled by kind) — never model text; stale subjects are listed so agents re-read them
  if (reuse && (reuse.entries.length || reuse.staleSubjects.length)) {
    handoff.sessionContext = { entries: reuse.entries, staleSubjects: reuse.staleSubjects };
    for (const e of reuse.entries) {
      if (e.kind !== "TOOL_EVIDENCE") continue;
      const [domain, name] = e.subject.split(".");
      if (satisfiedFromSession.has(domain as AgentId) && !selected.includes(domain as AgentId)) handoff[name] = { ...e.value, source: "session", ageMin: e.ageMin };
    }
  }
  for (const [i, agentId] of selected.entries()) {
    const runner = byId.get(agentId)!;
    const delegationId = randomUUID();
    spent.maxWallTimeMs = now() - started;
    const grant = grantBudget(policy.budget, spent, selected.length - i);
    const traceOf = (r: AgentResult): DelegationTrace => ({
      delegationId, agentId, agentTurnId: r.agentTurnId, completionStatus: r.completion, agentStatus: r.agentStatus,
      modelCallCount: r.usage.modelCalls, toolCallCount: r.usage.toolCalls, latencyMs: r.usage.latencyMs,
      tokenUsage: { input: r.usage.inputTokens, output: r.usage.outputTokens }, estimatedCost: r.usage.estimatedCostUsd,
      guardInterventions: countGuards(r.guardActions), budgetGranted: grant,
      evidence: r.evidence.map((e) => ({ toolId: e.toolId, outcome: e.outcome, personal: e.personal })),
    });
    const empty = (completion: AgentCompletion, code?: "BUDGET_EXHAUSTED" | "RUNNER_THREW" | "POLICY_VIOLATION"): AgentResult => ({
      delegationId, agentId, agentTurnId: null, completion, agentStatus: completion, answer: "", evidence: [], facts: {}, guardActions: [],
      usage: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 },
      ...(code ? { error: { code, retryable: false } } : {}),
    });

    let result: AgentResult;
    if (overrun.length || grant.maxModelCalls < 1 || grant.maxWallTimeMs < policy.minDelegationWallMs || grant.maxCostUsd <= 0) {
      result = empty("SKIPPED", "BUDGET_EXHAUSTED");
    } else {
      const request: AgentRequest = {
        delegationId, agentId, task: question, budget: grant,
        context: { identity, history, handoff: Object.freeze({ ...handoff }) },
      };
      const runtime: AgentRuntime = {
        enabled, now, supervisorTraceId, profileAgeReader, agentTraceSink: deps.agentTraceSink,
        limitOverrides: { ...(deps.limitOverrides ?? {}), maxWallTimeMs: Math.min(grant.maxWallTimeMs, deps.limitOverrides?.maxWallTimeMs ?? Number.POSITIVE_INFINITY) },
      };
      try {
        result = await runner.run(request, runtime);
      } catch {
        result = empty("FAILED", "RUNNER_THREW");
      }
      // account what was ACTUALLY used (provider-reported or estimated by the engine)
      spent.maxModelCalls += result.usage.modelCalls; spent.maxToolCalls += result.usage.toolCalls;
      spent.maxInputTokens += result.usage.inputTokens; spent.maxOutputTokens += result.usage.outputTokens;
      spent.maxCostUsd += result.usage.estimatedCostUsd;
      for (const k of ["maxModelCalls", "maxToolCalls", "maxInputTokens", "maxOutputTokens", "maxCostUsd"] as const) {
        if (spent[k] > policy.budget[k] + 1e-9 && !overrun.includes(k)) overrun.push(k);
      }

      // M4: an agent selected only to SUPPLY data (no need of its own in the plan) whose personal reads all failed has
      // nothing grounded to add — its text is withheld (e.g. a follow-up whose schedule refresh failed must not still say
      // "you have Leg day today")
      // M5.1: only an ASKED need counts (a background mention makes the agent a supplier, not an owner)
      const ownNeed = plan ? plan.intents.some((c) => c.agentId === agentId && (c.role ?? "REQUEST") === "REQUEST") : true;
      const personalReads = result.evidence.filter((e) => e.personal);
      if (!ownNeed && selected.length > 1 && result.completion === "COMPLETE" && personalReads.length && !personalReads.some((e) => e.outcome === "ok")) {
        result = { ...result, completion: "INSUFFICIENT_DATA", answer: "" };
      }
      // evidence reconciliation: an agent may only have used its own tools, and only non-personal ones on a general-only turn
      const foreign = result.evidence.some((e) => e.outcome === "ok" && !runner.capability.toolPolicy.allowedTools.includes(e.toolId));
      const personalOnGeneral = generalOnly && result.evidence.some((e) => e.outcome === "ok" && e.personal);
      if (foreign || personalOnGeneral) {
        conflicts.push(`policy_violation:${agentId}`);
        result = { ...result, completion: "POLICY_VIOLATION", answer: "", facts: {}, error: { code: "POLICY_VIOLATION", retryable: false } };
      }
    }
    results.push(result);
    delegations.push(traceOf(result));
    if (result.completion !== "POLICY_VIOLATION") handoff = { ...handoff, ...result.facts };
    if (agentId === "training" && !(result.facts as any)?.todaySchedule) handoff = { ...handoff, todaySchedule: { known: false } };
    if (agentId === "recovery" && !(result.facts as any)?.recentSessions) handoff = { ...handoff, recentSessions: { known: false } };
    if (agentId === "progress" && !Object.keys(result.facts ?? {}).length) handoff = { ...handoff, progressData: { known: false } };
  }

  // 5. conflicts between the user's claim and authoritative data
  const schedule = handoff.todaySchedule as { known?: boolean; sessionCount?: number } | undefined;
  const scheduleConflict = schedule?.known === true && schedule.sessionCount === 0 && CLAIMS_SESSION_TODAY.test(folded);
  if (scheduleConflict) conflicts.push("user_claims_session_not_in_schedule");
  // M2: the user's account of yesterday vs the training log — both are kept (uncertainty + provenance), neither is erased
  const recent = handoff.recentSessions as { known?: boolean; yesterdayBodyParts?: string[] | null } | undefined;
  const yesterdayClaim = yesterdayClaimOf(folded);
  let historyNote = "";
  if (yesterdayClaim && recent?.known === true) {
    const claimedPart = yesterdayClaim.part;
    if (!recent.yesterdayBodyParts) { conflicts.push("user_claims_session_not_in_history"); historyNote = TEXT.HISTORY_CONFLICT; }
    else if (claimedPart && !recent.yesterdayBodyParts.includes(claimedPart) && !recent.yesterdayBodyParts.includes("FULL_BODY")) {
      conflicts.push("user_claim_differs_from_logged_body_part"); historyNote = TEXT.BODY_PART_CONFLICT;
    }
  }

  // M3: a forecast figure taken for a measured result — always corrected, whatever the agents wrote.
  // M4: also across turns — a forecast mentioned/read earlier in the session followed by "how much have I lost?"
  const sessionForecast = !!reuse?.entries.some((e) => e.kind === "FORECAST");
  const forecastNote = selected.includes("progress") && (FORECAST_CONFUSION.test(folded) || (sessionForecast && ACHIEVED_ASK.test(folded))) ? TEXT.FORECAST_NOTE : "";
  if (forecastNote) conflicts.push("user_conflates_forecast_with_measurement");
  // M3: Progress + Recovery observe co-occurring changes only — no causal claim survives composition
  const correlationOnly = results.some((r) => r.agentId === "progress" && r.completion === "COMPLETE") && results.some((r) => r.agentId === "recovery" && r.completion === "COMPLETE");
  let causalRemoved = 0;

  // 6. composition (deterministic) + final guards
  const sections: string[] = [];
  const notes: string[] = [];
  const multi = results.length > 1;
  for (const r of results) {
    const label = AGENT_LABEL[r.agentId];
    let text = r.answer;
    if (r.completion === "COMPLETE" || r.completion === "BLOCKED") {
      if (scheduleConflict && r.agentId !== "training") {
        // never let another agent assert the session the schedule does not contain
        text = splitSentences(text).filter((s) => !(SCHEDULE_CLAIM.test(foldVi(s)) && !/\bkhong\b/.test(foldVi(s)))).join("").trim();
      }
      if (correlationOnly) {
        text = splitSentences(text).filter((s) => { const keep = !CAUSAL_CLAIM.test(foldVi(s)); if (!keep) causalRemoved++; return keep; }).join("").trim();
      }
      text = text.split("\n").filter((line) => !TOOL_NAME.test(line)).join("\n");
      text = stripInternalReferences(text).answer.trim();
      if (!text) { notes.push(PART_UNAVAILABLE.FAILED(label)); continue; }
      sections.push(multi ? `**${label}**\n${text}` : text);
    } else {
      notes.push(PART_UNAVAILABLE[r.completion](label));
    }
  }
  if (causalRemoved) { conflicts.push("causal_claim_removed"); notes.push(TEXT.CAUSAL_NOTE); }
  // M3/M4: agents the question needed but the per-turn cap excluded (by the cap or by the intent plan) are SAID
  const cappedOut = [...new Set([...valid.slice(selected.length), ...planDeferred.filter((d) => d.reason === "MAX_AGENTS").map((d) => d.agentId)])];
  if (cappedOut.length) {
    notes.push(`Phần ${cappedOut.map((a) => AGENT_LABEL[a].toLowerCase()).join(", ")} của câu hỏi chưa được xử lý trong lượt này vì mỗi lượt chỉ tham vấn tối đa ${policy.maxAgentsPerTurn} trợ lý — bạn hỏi riêng phần này nhé.`);
  }
  // M4: no sentence twice across sections (agents sharing a fact restate it)
  const seenSentences = new Set<string>();
  const deduped = sections.map((sec) => {
    const [head, ...body] = multi ? sec.split("\n") : ["", sec];
    const kept = splitSentences(body.join("\n")).filter((s) => {
      const k = foldVi(s).replace(/[^a-z0-9]+/g, " ").trim();
      if (k.length < 12) return true;
      if (seenSentences.has(k)) return false;
      seenSentences.add(k); return true;
    }).join("").trim();
    return multi ? (kept ? `${head}\n${kept}` : "") : kept;
  }).filter(Boolean);
  // M4: what the answer rests on — by evidence class, from provenance and session (codes → fixed wording, no data)
  const basis = evidenceBasis(results, handoff, yesterdayClaim !== null || SELF_REPORTED_FATIGUE.test(folded));
  const completes = results.filter((r) => r.completion === "COMPLETE").length;
  let answer = [scheduleConflict ? TEXT.SCHEDULE_CONFLICT : "", historyNote, forecastNote, ...deduped, ...notes, basis].filter(Boolean).join("\n\n");
  if (generalOnly && "addMinorNote" in gate && gate.addMinorNote && answer) answer = appendMinorSupervisionNote(answer, "vi");

  let status: SupervisorStatus;
  if (completes === results.length && !cappedOut.length) status = "ANSWERED";
  else if (completes === results.length) status = "PARTIAL";
  else if (completes > 0) status = "PARTIAL";
  else if (results.some((r) => r.completion === "BLOCKED")) status = "BLOCKED";
  else if (results.some((r) => r.completion === "INSUFFICIENT_DATA")) status = "INSUFFICIENT_DATA";
  else if (results.some((r) => r.completion === "BUDGET_EXHAUSTED" || r.completion === "SKIPPED")) status = "BUDGET_EXHAUSTED";
  else status = "FAILED";
  if (!answer) answer = status === "BUDGET_EXHAUSTED" ? TEXT.BUDGET_EXHAUSTED : TEXT.FAILED;

  // M4: session write — tool-derived typed facts, parsed user statements and conflicts only (never agent text)
  if (store) {
    const at = { owner: identity.userId, sessionId: sessionId!, turnId, now: now() };
    let incoming: ContextEntry[] = [];
    let entries = sessionAll;
    for (const r of results) {
      if (r.completion === "POLICY_VIOLATION") continue;
      const okTools = r.evidence.filter((e) => e.outcome === "ok").map((e) => e.toolId);
      incoming.push(...entriesFromFacts(r.agentId, r.facts, { ...at, toolIds: okTools }));
      // a failed refresh invalidates the previous value of that subject (it must not be reused as current)
      for (const e of r.evidence) if (e.outcome !== "ok" && TOOL_SUBJECT[e.toolId]) entries = invalidate(entries, TOOL_SUBJECT[e.toolId]);
    }
    if (yesterdayClaim) incoming.push(userStatement("user.trainedYesterday", { part: yesterdayClaim.part ?? "UNSPECIFIED" }, at));
    if (SELF_REPORTED_FATIGUE.test(folded)) incoming.push(userStatement("user.fatigue", { reported: true }, at));
    const fm = FORECAST_MENTION.exec(folded);
    if (fm) incoming.push(userStatement("user.mentionedForecast", { direction: fm[1] === "giam" ? "DOWN" : "UP", kg: Number(fm[2].replace(",", ".")) }, at, "FORECAST"));
    for (const c of conflicts) incoming.push({ ...userStatement("user.conflict", { code: c }, at), kind: "CONFLICT", subject: `conflict.${c}`, source: { producer: "supervisor", turnId } });
    incoming = incoming.filter((e) => e.kind === "CONFLICT" || validateIncoming(e));
    try { store.save(identity.userId, sessionId!, mergeEntries(entries, incoming)); } catch { /* the answer never depends on the save */ }
    if (sessionCounts) sessionCounts.stored = incoming.length;
  }
  return finish(status, answer);
}

/** Tool → session subject it refreshes (a failed read invalidates that subject). */
const TOOL_SUBJECT: Readonly<Record<string, string>> = Object.freeze({
  "training.get_today_schedule": "training.todaySchedule",
  "recovery.get_recent_sessions": "recovery.recentSessions",
  "recovery.get_training_load": "recovery.trainingLoad",
  "progress.get_body_measurements": "progress.measurementAvailability",
  "progress.get_strength_progression": "progress.strengthTrend",
  "progress.get_cycle_status": "progress.assessmentFreshness",
  "progress.get_roadmap_forecast": "progress.observedVsForecast",
  "nutrition.get_target": "nutrition.nutritionTarget",
});
const validateIncoming = (e: ContextEntry) => e.kind !== "AGENT_HYPOTHESIS" && !(e.kind === "USER_STATEMENT" && e.verification === "VERIFIED");

/** M4: one fixed-wording line on what the answer rests on (evidence classes only — no values, no data). */
function evidenceBasis(results: AgentResult[], handoff: Record<string, unknown>, userStated: boolean): string {
  const ok = (id: string) => results.some((r) => r.evidence.some((e) => e.toolId === id && e.outcome === "ok"));
  const logged = results.some((r) => r.evidence.some((e) => e.outcome === "ok" && e.personal && e.toolId !== "progress.get_strength_progression" && e.toolId !== "progress.get_roadmap_forecast"));
  const fromSession = Object.values(handoff).some((v) => (v as any)?.source === "session");
  const sessionForecast = Array.isArray((handoff.sessionContext as any)?.entries) && (handoff.sessionContext as any).entries.some((e: any) => e.kind === "FORECAST");
  const parts = [
    logged ? "dữ liệu đã ghi trong ứng dụng" : "",
    ok("progress.get_strength_progression") ? "ước tính (1RM ước tính từ các set đã ghi)" : "",
    ok("progress.get_roadmap_forecast") || sessionForecast ? "dự báo của ứng dụng (kịch bản, không phải số đo)" : "",
    userStated ? "điều bạn kể (chưa được ghi nhận như số liệu)" : "",
    fromSession ? "dữ liệu đã đọc trước đó trong cuộc trò chuyện" : "",
  ].filter(Boolean);
  return parts.length ? `_Cơ sở: ${parts.join("; ")}._` : "";
}

/** M2/M4, folded: "tập (chân) hôm qua" or "hôm qua (tôi) tập (chân)". */
function yesterdayClaimOf(folded: string): { part: string | undefined } | null {
  const a = CLAIMS_TRAINED_YESTERDAY.exec(folded);
  if (a) return { part: a[1] ? CLAIMED_PART[a[1]] : undefined };
  const b = CLAIMS_TRAINED_YESTERDAY_REVERSED.exec(folded);
  if (b) return { part: b[1] ? CLAIMED_PART[b[1]] : undefined };
  return null;
}
