/**
 * M8-A4 routing evaluator — BUDGET GUARD (fail-closed). Every model-backed adapter (B "model always", C "hybrid selective")
 * can reach a model ONLY through GuardedRoutingModel, which asks this guard BEFORE the call. There is NO real client and NO live
 * call path anywhere in this module: assertOfflineModel() refuses any model whose id is not an offline fake / replay / mock.
 *
 * Fail-closed rules:
 *   - invalid / missing / non-finite / negative limits  -> the guard cannot be constructed (throws BUDGET_INVALID_LIMITS);
 *   - a call is allowed only if (calls+1, input, output, cost) all stay within the limits after RESERVING its estimate;
 *   - the first denial TRIPS the guard permanently (every later call is denied, BUDGET_TRIPPED);
 *   - settle() replaces the reservation by the actual usage; exceeding a limit after settling trips the guard too;
 *   - a failed call keeps its estimate reserved (it may still have been billed);
 *   - cost is compared in integer micro-USD (estimates rounded UP, limits rounded DOWN) — never as floats.
 * Pricing constants = plan M7-P5A-FREEZE-AND-LIVE-PLAN §6 (in 0.0008 / out 0.0032 USD per 1000 tokens). They only size the
 * ESTIMATE used by the guard; they are not a billing record.
 */
import { AgentProviderError, type AgentModelProvider, type AgentModelRequest, type AgentModelResponse } from "../../agent-v2/model-provider";
import { estimateRoutingInputTokens } from "../../agent-v2/hybrid-router";

export const PRICE_IN_USD_PER_1K = 0.0008;
export const PRICE_OUT_USD_PER_1K = 0.0032;
export interface BudgetLimits { maxCalls: number; maxInputTokens: number; maxOutputTokens: number; maxCostUsd: number }
export interface CallEstimate { inputTokens: number; outputTokens: number; costUsd: number }
export type BudgetDenyReason = "BUDGET_TRIPPED" | "MAX_CALLS" | "MAX_INPUT_TOKENS" | "MAX_OUTPUT_TOKENS" | "MAX_COST" | "INVALID_ESTIMATE";
export interface BudgetSnapshot {
  limits: BudgetLimits;
  calls: number; inputTokens: number; outputTokens: number; costUsd: number;
  denied: number; tripped: boolean; trippedReason: BudgetDenyReason | null;
}
export interface BudgetGuard {
  authorize(estimate: CallEstimate): { allowed: true } | { allowed: false; reason: BudgetDenyReason };
  /** `actual` = null when the call failed / reported no usage: the reserved estimate stays. */
  settle(estimate: CallEstimate, actual: CallEstimate | null): void;
  snapshot(): BudgetSnapshot;
}
const micro = (usd: number, up: boolean) => (up ? Math.ceil(usd * 1e6 - 1e-9) : Math.floor(usd * 1e6 + 1e-9));
const okNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

export function createBudgetGuard(limits: BudgetLimits): BudgetGuard {
  const l = limits as Partial<BudgetLimits> | null | undefined;
  if (!l || !okNum(l.maxCalls) || !okNum(l.maxInputTokens) || !okNum(l.maxOutputTokens) || !okNum(l.maxCostUsd)) {
    throw new Error("BUDGET_INVALID_LIMITS: maxCalls, maxInputTokens, maxOutputTokens and maxCostUsd must all be finite numbers >= 0");
  }
  const lim = { ...(l as BudgetLimits) };
  const maxCostMicro = micro(lim.maxCostUsd, false);
  let calls = 0, inTok = 0, outTok = 0, costMicro = 0, denied = 0;
  let tripped: BudgetDenyReason | null = null;
  const over = (c: number, i: number, o: number, m: number): BudgetDenyReason | null =>
    c > lim.maxCalls ? "MAX_CALLS" : i > lim.maxInputTokens ? "MAX_INPUT_TOKENS" : o > lim.maxOutputTokens ? "MAX_OUTPUT_TOKENS" : m > maxCostMicro ? "MAX_COST" : null;
  const valid = (e: CallEstimate) => !!e && okNum(e.inputTokens) && okNum(e.outputTokens) && okNum(e.costUsd);
  return {
    authorize(e) {
      if (tripped) { denied++; return { allowed: false, reason: "BUDGET_TRIPPED" }; }
      if (!valid(e)) { denied++; tripped = "INVALID_ESTIMATE"; return { allowed: false, reason: "INVALID_ESTIMATE" }; }
      const why = over(calls + 1, inTok + Math.ceil(e.inputTokens), outTok + Math.ceil(e.outputTokens), costMicro + micro(e.costUsd, true));
      if (why) { denied++; tripped = why; return { allowed: false, reason: why }; }
      calls++; inTok += Math.ceil(e.inputTokens); outTok += Math.ceil(e.outputTokens); costMicro += micro(e.costUsd, true);
      return { allowed: true };
    },
    settle(e, actual) {
      if (!actual || !valid(actual)) return; // keep the reservation (conservative)
      inTok += Math.ceil(actual.inputTokens) - Math.ceil(e.inputTokens);
      outTok += Math.ceil(actual.outputTokens) - Math.ceil(e.outputTokens);
      costMicro += micro(actual.costUsd, true) - micro(e.costUsd, true);
      const why = over(calls, inTok, outTok, costMicro);
      if (why && !tripped) tripped = why;
    },
    snapshot: () => ({ limits: { ...lim }, calls, inputTokens: inTok, outputTokens: outTok, costUsd: costMicro / 1e6, denied, tripped: tripped !== null, trippedReason: tripped }),
  };
}

export const costUsdOf = (inputTokens: number, outputTokens: number) => (inputTokens * PRICE_IN_USD_PER_1K) / 1000 + (outputTokens * PRICE_OUT_USD_PER_1K) / 1000;
export function estimateCall(req: Pick<AgentModelRequest, "system" | "messages" | "maxOutputTokens">): CallEstimate {
  const inputTokens = estimateRoutingInputTokens(req);
  return { inputTokens, outputTokens: req.maxOutputTokens, costUsd: costUsdOf(inputTokens, req.maxOutputTokens) };
}

/** A model may be wrapped only when its id says it is an OFFLINE fake / replay / mock. Anything else is refused (no live path). */
export const OFFLINE_MODEL_ID = /^(fake|replay|mock)([-_.][A-Za-z0-9._-]*)?$/;
export function assertOfflineModel(model: Pick<AgentModelProvider, "modelId">): void {
  if (typeof model?.modelId !== "string" || !OFFLINE_MODEL_ID.test(model.modelId)) throw new Error("LIVE_MODEL_REFUSED: only an offline fake / replay / mock model (modelId fake*, replay* or mock*) may be used by the routing evaluator");
}

/** The ONLY way an adapter reaches a model: authorize first, never call when denied, settle after. */
export class GuardedRoutingModel implements AgentModelProvider {
  readonly modelId: string;
  readonly supportsCancellation: boolean;
  constructor(private readonly inner: AgentModelProvider, readonly guard: BudgetGuard) {
    assertOfflineModel(inner);
    if (!guard || typeof guard.authorize !== "function") throw new Error("BUDGET_GUARD_REQUIRED: a model-backed adapter must go through a budget guard");
    this.modelId = inner.modelId; this.supportsCancellation = inner.supportsCancellation;
  }
  async converse(request: AgentModelRequest): Promise<AgentModelResponse> {
    const est = estimateCall(request);
    const d = this.guard.authorize(est);
    if (!d.allowed) throw new AgentProviderError("validation", `BUDGET_GUARD_DENIED:${d.reason}`); // no prompt text in the message
    let res: AgentModelResponse;
    try { res = await this.inner.converse(request); } catch (e) { this.guard.settle(est, null); throw e; }
    const u = res?.usage;
    this.guard.settle(est, u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd: costUsdOf(u.inputTokens, u.outputTokens) } : null);
    return res;
  }
}

/** OFFLINE fake model: answers from a question -> agentIds table (the evaluator's stand-in for "Nova"). No network, no randomness. */
export interface FakeRoutingModel extends AgentModelProvider { readonly calls: () => number }
export function createFakeRoutingModel(answers: ReadonlyMap<string, readonly string[]> | ((question: string) => readonly string[] | "INVALID"), fakeUsage: { inputTokens?: number; outputTokens?: number } = {}): FakeRoutingModel {
  let calls = 0;
  const lookup = typeof answers === "function" ? answers : (q: string) => answers.get(q) ?? [];
  return {
    modelId: "fake-routing-model", supportsCancellation: false, calls: () => calls,
    async converse(req) {
      calls++;
      let q = "";
      try { q = String(JSON.parse((req.messages[0].content[0] as { text: string }).text).question ?? ""); } catch { /* unparseable request -> [] */ }
      const a = lookup(q);
      const text = a === "INVALID" ? "not json" : JSON.stringify({ agentIds: [...a] });
      const est = estimateCall(req);
      return { stopReason: "end_turn", rawStopReason: "end_turn", content: [{ type: "text", text }], usage: { inputTokens: fakeUsage.inputTokens ?? est.inputTokens, outputTokens: fakeUsage.outputTokens ?? 12 } };
    },
  };
}
