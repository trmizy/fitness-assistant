/**
 * M5 routing evaluation. Every case is run through the REAL runSupervisorTurn (input safety, routing, validation, the
 * 2-agent cap, plan deferrals, PARTIAL composition) with stub runners that make no model or tool call — so what is measured
 * is the routing + disclosure behaviour of the supervisor, not any answer quality.
 *
 * Configurations (everything else held fixed: dataset, budget SUPERVISOR_BUDGET, capabilities, criteria):
 *   keyword-v1   — keywordDecisionProvider (M1–M3 signal table); supervisor caps by its execution order.
 *   intent-v1    — the production default (createIntentDecisionProvider, maxAgents 2).
 *   single-agent — intent planner restricted to the single highest-relevance agent (maxAgents 1, policy cap 1).
 */
import { performance } from "node:perf_hooks";
import { runSupervisorTurn, keywordDecisionProvider, ROUTING_SIGNALS, type SupervisorTrace, type SupervisorDeps } from "../../agent-v2/supervisor";
import { createIntentDecisionProvider, planRouting } from "../../agent-v2/routing-planner";
import type { AgentId, AgentRunner, AgentResult } from "../../agent-v2/multi-agent-contracts";
import { foldVi } from "../../llm/speech_act";
import { checkInputSafety } from "../../agent-v2/answer-guards";
import { CAP, USER_A, T0 } from "./harness";
import type { AgentLabel, RoutingCase } from "./dataset-v1";

export type RoutingConfig = "keyword-v1" | "intent-v1" | "single-agent";
export const ROUTING_CONFIGS: readonly RoutingConfig[] = ["keyword-v1", "intent-v1", "single-agent"];
const AGENTS: readonly AgentId[] = ["training", "nutrition", "recovery", "progress"];
const LABEL_VI: Record<AgentId, string> = { training: "tập luyện", nutrition: "dinh dưỡng", recovery: "phục hồi", progress: "tiến độ" };

export type RoutingError =
  | "PRIMARY_INTENT_MISSED" | "WRONG_AGENT" | "UNNECESSARY_AGENT" | "REQUIRED_AGENT_DEFERRED_INCORRECTLY"
  | "UNREPORTED_DEFERRED_INTENT" | "OUT_OF_SCOPE_FALSE_POSITIVE" | "OUT_OF_SCOPE_FALSE_NEGATIVE" | "ROUTING_UNCERTAIN"
  /** Extra (not in the M5 brief's taxonomy): an in-scope question stopped by the V1 input-safety detectors before routing. */
  | "INPUT_SAFETY_FALSE_POSITIVE";
export const ROUTING_ERRORS: readonly RoutingError[] = ["PRIMARY_INTENT_MISSED", "WRONG_AGENT", "UNNECESSARY_AGENT", "REQUIRED_AGENT_DEFERRED_INCORRECTLY", "UNREPORTED_DEFERRED_INTENT", "OUT_OF_SCOPE_FALSE_POSITIVE", "OUT_OF_SCOPE_FALSE_NEGATIVE", "ROUTING_UNCERTAIN", "INPUT_SAFETY_FALSE_POSITIVE"];

export interface RoutingOutcome {
  caseId: string;
  config: RoutingConfig;
  status: string;
  selected: AgentId[];
  /** Agents the system itself deferred (cap or plan), from the trace `dropped` codes. */
  deferred: AgentId[];
  /** Every deferred agent is named in the user-facing PARTIAL note. */
  deferredDisclosed: boolean;
  partialNoteShown: boolean;
  uncertainty: string | null;
  primaryNeed: string | null;
  exactSet: boolean;
  primaryCovered: boolean | null;
  errors: RoutingError[];
  routingLatencyUs: number;
  /** V1 input-safety detector type when the turn stopped before routing. */
  safetyType: string | null;
}

function stubRunner(agentId: AgentId): AgentRunner {
  return {
    capability: CAP[agentId],
    async run(req): Promise<AgentResult> {
      return { delegationId: req.delegationId, agentId, agentTurnId: null, completion: "COMPLETE", agentStatus: "ANSWERED", answer: `[stub ${agentId}]`, evidence: [], facts: {}, guardActions: [],
        usage: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 } };
    },
  };
}
const RUNNERS = AGENTS.map(stubRunner);

function depsFor(config: RoutingConfig): Partial<SupervisorDeps> {
  if (config === "keyword-v1") return { decisionProvider: keywordDecisionProvider };
  if (config === "single-agent") return { decisionProvider: createIntentDecisionProvider({ maxAgents: 1, domainSignals: ROUTING_SIGNALS }), executionPolicy: { maxAgentsPerTurn: 1 } };
  return {};
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Pure routing latency (decision only, no supervisor), median of 5 local runs, µs — a LOCAL CPU figure, not production. */
function routingLatencyUs(config: RoutingConfig, q: string): number {
  const folded = foldVi(q);
  const f = () => config === "keyword-v1"
    ? keywordDecisionProvider.decide({ question: q, folded, available: AGENTS })
    : planRouting(folded, AGENTS, { maxAgents: config === "single-agent" ? 1 : 2, domainSignals: ROUTING_SIGNALS });
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) { const s = performance.now(); f(); xs.push((performance.now() - s) * 1000); }
  return Math.round(xs.sort((a, b) => a - b)[2]);
}

export async function routeCase(c: RoutingCase, config: RoutingConfig): Promise<RoutingOutcome> {
  const traces: SupervisorTrace[] = [];
  const r = await runSupervisorTurn({ question: c.q, context: { userId: USER_A } }, {
    runners: RUNNERS, profileReader: async () => ({ status: "PROFILE_OK", age: 30 }), enabled: true, now: () => T0, traceSink: (t) => traces.push(t), ...depsFor(config),
  });
  const tr = traces[0];
  const selected = (tr.decision?.agents ?? []) as AgentId[];
  const deferred = [...new Set((tr.decision?.dropped ?? []).filter((d) => /:(max_agents|from_session)$/.test(d)).map((d) => d.split(":")[0] as AgentId))];
  const note = /chưa được xử lý trong lượt này/.test(r.answer);
  const noteLine = r.answer.split("\n\n").find((l) => /chưa được xử lý trong lượt này/.test(l)) ?? "";
  const deferredDisclosed = deferred.every((a) => noteLine.includes(LABEL_VI[a]));
  const exactSet = c.acceptable.some((s) => sameSet(s, selected));
  const primaryCovered = c.primaryAgent ? selected.includes(c.primaryAgent) : null;
  const union = new Set<AgentLabel>(c.acceptable.flat());
  const must = AGENTS.filter((a) => c.acceptable.every((s) => s.includes(a)));
  const errors: RoutingError[] = [];
  const oosOk = c.acceptable.some((s) => s.length === 0);
  // a V1 input-safety stop happens BEFORE routing: it is not a routing decision, so it gets its own (extra) code
  // (an OUT-of-scope case stopped as off_topic is a correct rejection, not a false positive)
  if (r.status === "SAFETY_BLOCKED" && c.routingScored) { if (c.primaryAgent) errors.push("INPUT_SAFETY_FALSE_POSITIVE"); }
  else if (c.primaryAgent && !selected.length) errors.push("OUT_OF_SCOPE_FALSE_POSITIVE");
  else if (!c.primaryAgent && selected.length && !exactSet) errors.push("OUT_OF_SCOPE_FALSE_NEGATIVE");
  else if (c.primaryAgent && !selected.includes(c.primaryAgent)) errors.push("PRIMARY_INTENT_MISSED");
  if (c.primaryAgent && selected.length) {
    for (const a of selected) if (!union.has(a)) errors.push("UNNECESSARY_AGENT");
    if (!exactSet && selected.includes(c.primaryAgent) && selected.some((a) => !union.has(a)) && must.some((a) => !selected.includes(a))) errors.push("WRONG_AGENT");
    for (const a of must) if (!selected.includes(a) && deferred.includes(a)) errors.push("REQUIRED_AGENT_DEFERRED_INCORRECTLY");
    for (const a of c.requiredAgents) if (!selected.includes(a) && !deferred.includes(a)) errors.push("UNREPORTED_DEFERRED_INTENT");
  }
  if (!oosOk || selected.length) {
    const unc = tr.routing?.uncertainty ?? null;
    if (errors.length && (unc === "MEDIUM" || unc === "HIGH")) errors.push("ROUTING_UNCERTAIN");
  }
  return {
    caseId: c.id, config, status: r.status, selected, deferred, deferredDisclosed, partialNoteShown: note,
    uncertainty: tr.routing?.uncertainty ?? null, primaryNeed: tr.routing?.primaryNeed ?? null,
    exactSet, primaryCovered, errors, routingLatencyUs: routingLatencyUs(config, c.q),
    safetyType: r.status === "SAFETY_BLOCKED" ? checkInputSafety(c.q).type : null,
  };
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
export interface RoutingMetrics {
  config: RoutingConfig;
  n: number;
  exactSetAll: { n: number; d: number; pct: number | null };
  exactSetLe2: { n: number; d: number; pct: number | null };
  exactSetMulti: { n: number; d: number; pct: number | null };
  primaryCoverage: { n: number; d: number; pct: number | null };
  perAgent: Record<AgentId, { tp: number; fp: number; fn: number; precision: number | null; recall: number | null; f1: number | null }>;
  macroF1: number | null;
  microF1: number | null;
  multiDomainCoverage: { selectedOrDisclosed: number; required: number; pct: number | null; answered: number; answeredPct: number | null };
  correctDeferral: { n: number; d: number; pct: number | null };
  falsePositiveInvocations: { count: number; perCase: number | null };
  oos: { tp: number; fn: number; fp: number; detectionPct: number | null };
  uncertainty: { flaggedWrong: number; wrong: number; flaggedRight: number; right: number } | null;
  partial: { correct: number; d: number; pct: number | null; labelAgree: number; labelPct: number | null };
  threeAgent: { primary: number; bestSupport: number; deferredRecorded: number; partialAnnounced: number; d: number };
  disclosure: { deferredRuns: number; disclosed: number; pct: number | null };
  errors: Record<RoutingError, number>;
  routingLatencyUs: { median: number; p95: number; max: number };
}

export function routingMetrics(cases: readonly RoutingCase[], outs: readonly RoutingOutcome[], config: RoutingConfig): RoutingMetrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = outs.filter((o) => o.config === config && byId.get(o.caseId)!.routingScored).map((o) => ({ o, c: byId.get(o.caseId)! }));
  const frac = (xs: typeof rows, f: (r: (typeof rows)[number]) => boolean) => { const n = xs.filter(f).length; return { n, d: xs.length, pct: pct(n, xs.length) }; };
  const le2 = rows.filter((r) => r.c.requiredAgents.length <= 2);
  const multi = rows.filter((r) => r.c.category === "MULTI");
  const perAgent = {} as RoutingMetrics["perAgent"];
  let TP = 0, FP = 0, FN = 0;
  for (const a of AGENTS) {
    let tp = 0, fp = 0, fn = 0;
    for (const { o, c } of rows) {
      const union = c.acceptable.flat(); const must = c.acceptable.every((s) => s.includes(a));
      if (o.selected.includes(a)) { if (union.includes(a)) tp++; else fp++; } else if (must && c.acceptable[0].length) fn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : null; const recall = tp + fn ? tp / (tp + fn) : null;
    const f1 = precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : null;
    perAgent[a] = { tp, fp, fn, precision: r3(precision), recall: r3(recall), f1: r3(f1) };
    TP += tp; FP += fp; FN += fn;
  }
  const f1s = AGENTS.map((a) => perAgent[a].f1).filter((x): x is number => x !== null);
  const microP = TP / Math.max(1, TP + FP), microR = TP / Math.max(1, TP + FN);
  const md = rows.filter((r) => r.c.category === "TWO" || r.c.category === "MULTI");
  let req = 0, sod = 0, ans = 0;
  for (const { o, c } of md) for (const a of c.requiredAgents) { req++; if (o.selected.includes(a)) { sod++; ans++; } else if (o.deferred.includes(a) && o.deferredDisclosed) sod++; }
  const oosRows = rows.filter((r) => r.c.category === "OOS_AMBIGUOUS");
  const inScope = rows.filter((r) => r.c.primaryAgent);
  const errors = Object.fromEntries(ROUTING_ERRORS.map((e) => [e, rows.reduce((n, r) => n + r.o.errors.filter((x) => x === e).length, 0)])) as Record<RoutingError, number>;
  const right = (r: (typeof rows)[number]) => r.o.exactSet;
  const lat = rows.map((r) => r.o.routingLatencyUs).sort((a, b) => a - b);
  const deferredRuns = rows.filter((r) => r.o.deferred.length);
  // PARTIAL honesty: status PARTIAL ⇔ the system deferred something it was asked for (and said so)
  const partialCorrect = (r: (typeof rows)[number]) => (r.o.status === "PARTIAL") === (r.o.deferred.length > 0 && r.o.deferredDisclosed);
  const labelAgree = (r: (typeof rows)[number]) => (r.c.coverage === "PARTIAL") === (r.o.status === "PARTIAL");
  return {
    config, n: rows.length,
    exactSetAll: frac(rows, right), exactSetLe2: frac(le2, right), exactSetMulti: frac(multi, right),
    primaryCoverage: frac(inScope, (r) => r.o.primaryCovered === true),
    perAgent, macroF1: r3(f1s.reduce((s, x) => s + x, 0) / Math.max(1, f1s.length)), microF1: r3((2 * microP * microR) / Math.max(1e-9, microP + microR)),
    multiDomainCoverage: { selectedOrDisclosed: sod, required: req, pct: pct(sod, req), answered: ans, answeredPct: pct(ans, req) },
    correctDeferral: frac(multi, (r) => r.o.exactSet && r.c.requiredAgents.filter((a) => !r.o.selected.includes(a)).every((a) => r.o.deferred.includes(a)) && r.o.deferredDisclosed),
    falsePositiveInvocations: { count: errors.UNNECESSARY_AGENT, perCase: rows.length ? Math.round((100 * errors.UNNECESSARY_AGENT) / rows.length) / 100 : null },
    oos: { tp: oosRows.filter((r) => r.o.selected.length === 0).length, fn: oosRows.filter((r) => r.o.selected.length > 0 && !r.o.exactSet).length, fp: inScope.filter((r) => !r.o.selected.length && r.o.status === "OUT_OF_SCOPE").length, detectionPct: pct(oosRows.filter((r) => r.o.exactSet).length, oosRows.length) },
    uncertainty: config === "keyword-v1" ? null : {
      flaggedWrong: rows.filter((r) => !right(r) && r.o.uncertainty && r.o.uncertainty !== "LOW").length, wrong: rows.filter((r) => !right(r)).length,
      flaggedRight: rows.filter((r) => right(r) && r.o.uncertainty && r.o.uncertainty !== "LOW").length, right: rows.filter(right).length,
    },
    partial: { correct: rows.filter(partialCorrect).length, d: rows.length, pct: pct(rows.filter(partialCorrect).length, rows.length), labelAgree: rows.filter(labelAgree).length, labelPct: pct(rows.filter(labelAgree).length, rows.length) },
    threeAgent: {
      primary: multi.filter((r) => r.o.primaryCovered).length, bestSupport: multi.filter((r) => r.o.exactSet).length,
      deferredRecorded: multi.filter((r) => r.c.requiredAgents.filter((a) => !r.o.selected.includes(a)).every((a) => r.o.deferred.includes(a))).length,
      partialAnnounced: multi.filter((r) => r.o.status === "PARTIAL" && r.o.partialNoteShown && r.o.deferredDisclosed).length, d: multi.length,
    },
    disclosure: { deferredRuns: deferredRuns.length, disclosed: deferredRuns.filter((r) => r.o.deferredDisclosed && r.o.status === "PARTIAL").length, pct: pct(deferredRuns.filter((r) => r.o.deferredDisclosed && r.o.status === "PARTIAL").length, deferredRuns.length) },
    errors,
    routingLatencyUs: { median: lat[Math.floor(lat.length / 2)] ?? 0, p95: lat[Math.floor(lat.length * 0.95)] ?? 0, max: lat[lat.length - 1] ?? 0 },
  };
}
function r3(x: number | null): number | null { return x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000; }

export async function runRoutingBenchmark(cases: readonly RoutingCase[]) {
  const outcomes: RoutingOutcome[] = [];
  for (const config of ROUTING_CONFIGS) for (const c of cases) outcomes.push(await routeCase(c, config));
  const metrics = ROUTING_CONFIGS.map((cfg) => routingMetrics(cases, outcomes, cfg));
  return { outcomes, metrics };
}
