/**
 * M8-A4 routing evaluator — SYSTEM ADAPTERS. OFFLINE: pure code + (for B / C) an injected FAKE model behind the budget guard.
 *   A  deterministic            the production intent planner (intent-v1.3) through the REAL supervisor, stub runners, no model
 *   B  "model always" (Nova)    hybrid router in mode "always" with a FAKE/replay model ONLY (no real client exists here)
 *   C  hybrid selective         hybrid router in mode "selective" with a FAKE/replay model ONLY
 *   R  replay                   returns pre-recorded outcomes (used to score an outcomes file produced elsewhere)
 * Every model-backed adapter requires a BudgetGuard; the model is wrapped by GuardedRoutingModel (offline-id check + fail-closed
 * guard). Observation = the same facts the M5 routing harness reads (supervisor trace + answer note), reduced to EvalOutcome.
 */
import { runSupervisorTurn, ROUTING_SIGNALS, type SupervisorDeps, type SupervisorTrace } from "../../agent-v2/supervisor";
import { createIntentDecisionProvider } from "../../agent-v2/routing-planner";
import { createHybridDecisionProvider } from "../../agent-v2/hybrid-router";
import { checkInputSafety } from "../../agent-v2/answer-guards";
import type { AgentId, AgentResult, AgentRunner } from "../../agent-v2/multi-agent-contracts";
import type { AgentModelProvider } from "../../agent-v2/model-provider";
import { CAP, USER_A, T0 } from "../m5-benchmark/harness";
import { observedPreflightStage } from "./annotation-schema";
import { GuardedRoutingModel, type BudgetGuard } from "./routing-evaluator-budget";
import { outcomeProblems, type EvalOutcome } from "./routing-evaluator-outcomes";

export type SystemId = "A_DETERMINISTIC" | "B_MODEL_ALWAYS_FAKE" | "C_HYBRID_SELECTIVE_FAKE" | "R_REPLAY";
export interface RoutingSystemAdapter {
  readonly systemId: SystemId;
  /** True when the adapter can reach a model (always through the budget guard). */
  readonly usesModel: boolean;
  route(c: { id: string; question: string }): Promise<EvalOutcome>;
}

const AGENT_IDS: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const LABEL_VI: Record<AgentId, string> = { training: "tập luyện", nutrition: "dinh dưỡng", recovery: "phục hồi", progress: "tiến độ" };
type Provider = NonNullable<SupervisorDeps["decisionProvider"]>;

const stubRunner = (agentId: AgentId): AgentRunner => ({
  capability: CAP[agentId],
  async run(req): Promise<AgentResult> {
    return { delegationId: req.delegationId, agentId, agentTurnId: null, completion: "COMPLETE", agentStatus: "ANSWERED", answer: `[stub ${agentId}]`, evidence: [], facts: {}, guardActions: [],
      usage: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 } };
  },
});
const RUNNERS = AGENT_IDS.map(stubRunner);

/** Runs ONE question through the real supervisor (stub runners, verified-adult profile) and reduces it to the observed facts. */
export async function observeTurn(id: string, question: string, provider: Provider): Promise<EvalOutcome> {
  const traces: SupervisorTrace[] = [];
  const r = await runSupervisorTurn({ question, context: { userId: USER_A } }, {
    runners: RUNNERS, profileReader: async () => ({ status: "PROFILE_OK", age: 30 }), enabled: true, now: () => T0, traceSink: (t) => traces.push(t), decisionProvider: provider,
  });
  const tr = traces[0];
  const routingReached = tr.decision !== null;
  const stage = observedPreflightStage({ status: r.status, safetyType: r.status === "SAFETY_BLOCKED" ? checkInputSafety(question).type : null, routingReached });
  const selected = stage === "REACHED_ROUTING" ? ((tr.decision?.agents ?? []) as AgentId[]) : [];
  const deferred = [...new Set((tr.decision?.dropped ?? []).filter((d) => /:(max_agents|from_session)$/.test(d)).map((d) => d.split(":")[0] as AgentId))];
  const noteLine = r.answer.split("\n\n").find((l) => /chưa được xử lý trong lượt này/.test(l)) ?? "";
  const deferredDisclosed = deferred.filter((a) => noteLine.includes(LABEL_VI[a]));
  const out: EvalOutcome = { id, stage, selected, deferred: stage === "REACHED_ROUTING" ? deferred : [], deferredDisclosed: stage === "REACHED_ROUTING" ? deferredDisclosed : [] };
  const problems = outcomeProblems(out);
  if (problems.length) throw new Error(`ADAPTER_OUTCOME_INVALID: ${problems.join("; ")}`);
  return out;
}

/** A — deterministic router, no model. */
export function createDeterministicAdapter(): RoutingSystemAdapter {
  const provider = createIntentDecisionProvider({ maxAgents: 2, domainSignals: ROUTING_SIGNALS });
  return { systemId: "A_DETERMINISTIC", usesModel: false, route: (c) => observeTurn(c.id, c.question, provider) };
}

export interface ModelAdapterOptions {
  /** An OFFLINE fake / replay / mock model (anything else is refused). */
  model: AgentModelProvider;
  /** Mandatory: every model call is authorized by this guard first. */
  guard: BudgetGuard;
}
function modelAdapter(systemId: SystemId, mode: "always" | "selective", o: ModelAdapterOptions): RoutingSystemAdapter & { readonly guard: BudgetGuard } {
  if (!o || !o.guard) throw new Error("BUDGET_GUARD_REQUIRED: a model-backed adapter must go through a budget guard");
  const guarded = new GuardedRoutingModel(o.model, o.guard);
  const provider = createHybridDecisionProvider({ model: guarded, maxAgents: 2, mode });
  return {
    systemId, usesModel: true, guard: o.guard,
    async route(c) {
      const before = o.guard.snapshot();
      const out = await observeTurn(c.id, c.question, provider);
      const after = o.guard.snapshot();
      const usage = { modelCalls: after.calls - before.calls, inputTokens: after.inputTokens - before.inputTokens, outputTokens: after.outputTokens - before.outputTokens, costUsd: Math.round((after.costUsd - before.costUsd) * 1e6) / 1e6 };
      return { ...out, usage };
    },
  };
}
/** B — "Nova always" (hybrid mode "always"). FAKE / replay model only. */
export const createModelAlwaysAdapter = (o: ModelAdapterOptions) => modelAdapter("B_MODEL_ALWAYS_FAKE", "always", o);
/** C — hybrid selective (model only when a risk signal fires). FAKE / replay model only. */
export const createHybridSelectiveAdapter = (o: ModelAdapterOptions) => modelAdapter("C_HYBRID_SELECTIVE_FAKE", "selective", o);

/** R — replay of recorded outcomes (a missing id is an error, never a guess). */
export function createReplayAdapter(recorded: ReadonlyMap<string, EvalOutcome>): RoutingSystemAdapter {
  return { systemId: "R_REPLAY", usesModel: false, async route(c) { const o = recorded.get(c.id); if (!o) throw new Error(`REPLAY_MISSING: no recorded outcome for ${c.id}`); return o; } };
}

/** Runs an adapter over cases sequentially (deterministic order). */
export async function runSystem(adapter: RoutingSystemAdapter, cases: ReadonlyArray<{ id: string; question: string }>): Promise<EvalOutcome[]> {
  const out: EvalOutcome[] = [];
  for (const c of cases) out.push(await adapter.route(c));
  return out;
}
