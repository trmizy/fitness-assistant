/**
 * M7-P4.1 — benchmark v4 evaluation of the "intent-v1.3" candidate (routing correctness: recovery ownership, compound asks,
 * OOS with fitness context, deferral completeness). OFFLINE: the real supervisor with stub runners (the M5 routing harness,
 * metric definitions UNCHANGED — routingMetrics is reused as is) and the M5 execution benchmark (mock models, synthetic
 * fixtures) for the safety invariants. Gate table = QUALITY_GATES_M51 (thresholds unchanged); G7 / G8 are measured on
 * HELDOUT v4 (frozen in heldout-v4.freeze.json BEFORE the router change); G9 uses the recorded M6 owner adjudications.
 *
 * Comparators on the SAME v4 cases, all through the real supervisor: keyword-v1, intent-v1.1 (frozen copy),
 * intent-v1.2 (frozen copy) and the candidate (= the production default provider). The frozen comparators need a
 * provider-pluggable copy of routeCase (the m5-benchmark directory stays unchanged); its equivalence with routeCase is
 * pinned by a test.
 *
 * Protocol: the FIRST scoring writes heldout-v4.run.json with the candidate's planner sha — afterwards a different planner
 * refuses to run. v1, DEV, heldout v2, DEV v3 and heldout v3 are HISTORICAL REGRESSION — NOT INDEPENDENT HOLDOUT.
 * Nova Pro is NOT evaluated here.
 * CLI: npx tsx src/__tests__/m7-benchmark/run-v4.ts --score   (first scoring / determinism re-check)  [--report]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { routeCase, routingMetrics, type RoutingConfig, type RoutingError, type RoutingMetrics, type RoutingOutcome } from "../m5-benchmark/routing-eval";
import { runExecutionBenchmark, executionMetrics } from "../m5-benchmark/execution-eval";
import { QUALITY_GATES_M51, evaluateGates } from "../m5-benchmark/gates";
import { APPROVED_ADJUDICATIONS_M6, resolveFailures } from "../m5-benchmark/adjudication-m6";
import { ROUTING_CASES_V1, type AgentLabel, type RoutingCase } from "../m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "../m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "../m5-benchmark/dataset-heldout-v2";
import { CAP, USER_A, T0 } from "../m5-benchmark/harness";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3 } from "./dataset-v3";
import { ROUTING_CASES_DEV_V4, ROUTING_CASES_HELDOUT_V4 } from "./dataset-v4";
import * as V11 from "./baseline-intent-v1-1";
import * as V12 from "./baseline-intent-v1-2";
import * as CAND from "../../agent-v2/routing-planner";
import { runSupervisorTurn, keywordDecisionProvider, ROUTING_SIGNALS, type SupervisorTrace, type SupervisorDeps } from "../../agent-v2/supervisor";
import type { AgentId, AgentResult, AgentRunner } from "../../agent-v2/multi-agent-contracts";
import { checkInputSafety } from "../../agent-v2/answer-guards";
import { foldVi } from "../../llm/speech_act";

const HERE = __dirname;
export const V4_DATASET_FILE = resolve(HERE, "dataset-v4.ts");
export const V4_FREEZE_FILE = resolve(HERE, "heldout-v4.freeze.json");
export const V4_RUN_FILE = resolve(HERE, "heldout-v4.run.json");
export const PLANNER_FILE = resolve(HERE, "../../agent-v2/routing-planner.ts");
const WORKTREE = resolve(HERE, "../../../../../..");
const sha = (file: string) => createHash("sha256").update(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
export const candidateSha = () => sha(PLANNER_FILE);
export const CANDIDATE_STRATEGY = "intent-v1.3";
const AGENTS: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const LABEL_VI: Record<AgentId, string> = { training: "tập luyện", nutrition: "dinh dưỡng", recovery: "phục hồi", progress: "tiến độ" };

export function v4Integrity() {
  const f = JSON.parse(readFileSync(V4_FREEZE_FILE, "utf8")) as { sha256: string; devCases: number; heldoutCases: number; plannerSha256AtFreeze: string; baselineFile: string; baselineSha256: string; metrics: { gates: { G7_primaryCoveragePctMin: number; G8_exactSetLe2PctMin: number; agentCap: number } } };
  const actual = sha(V4_DATASET_FILE);
  const baselineOk = sha(resolve(HERE, f.baselineFile)) === f.baselineSha256;
  return { freeze: f, actual, baselineOk, ok: f.sha256 === actual && baselineOk && f.devCases === ROUTING_CASES_DEV_V4.length && f.heldoutCases === ROUTING_CASES_HELDOUT_V4.length };
}

// ── comparators ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type V4Config = "keyword-v1" | "intent-v1.1-frozen" | "intent-v1.2-frozen" | "candidate";
export const V4_CONFIGS: readonly V4Config[] = ["keyword-v1", "intent-v1.1-frozen", "intent-v1.2-frozen", "candidate"];
type Provider = NonNullable<SupervisorDeps["decisionProvider"]>;
const PROVIDERS: Record<Exclude<V4Config, "candidate">, Provider> = {
  "keyword-v1": keywordDecisionProvider,
  "intent-v1.1-frozen": V11.createIntentDecisionProvider({ maxAgents: 2, domainSignals: ROUTING_SIGNALS }) as unknown as Provider,
  "intent-v1.2-frozen": V12.createIntentDecisionProvider({ maxAgents: 2, domainSignals: ROUTING_SIGNALS }) as unknown as Provider,
};
/** The plan each intent config builds for a question (its detected needs). keyword-v1 has no plan. */
export function planFor(config: V4Config, q: string): { intents: Array<{ agentId: AgentId; role?: string }> } | null {
  const folded = foldVi(q);
  if (config === "keyword-v1") return null;
  if (config === "intent-v1.1-frozen") return V11.planRouting(folded, AGENTS, { maxAgents: 2, domainSignals: ROUTING_SIGNALS });
  const opts = { maxAgents: 2, domainSignals: ROUTING_SIGNALS, question: q };
  return config === "intent-v1.2-frozen" ? V12.planRouting(folded, AGENTS, opts) : CAND.planRouting(folded, AGENTS, opts);
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
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * routeCase of m5-benchmark/routing-eval.ts with the decision provider passed in (statement for statement the same scoring;
 * only `depsFor(config)` → `{ decisionProvider }` and the latency probe differ). Pinned equal to routeCase by a test.
 */
export async function routeCaseWith(c: RoutingCase, label: string, provider: Provider): Promise<RoutingOutcome> {
  const traces: SupervisorTrace[] = [];
  const r = await runSupervisorTurn({ question: c.q, context: { userId: USER_A } }, {
    runners: RUNNERS, profileReader: async () => ({ status: "PROFILE_OK", age: 30 }), enabled: true, now: () => T0, traceSink: (t) => traces.push(t), decisionProvider: provider,
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
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) { const s = performance.now(); provider.decide({ question: c.q, folded: foldVi(c.q), available: AGENTS }); xs.push((performance.now() - s) * 1000); }
  return {
    caseId: c.id, config: label as RoutingConfig, status: r.status, selected, deferred, deferredDisclosed, partialNoteShown: note,
    uncertainty: tr.routing?.uncertainty ?? null, primaryNeed: tr.routing?.primaryNeed ?? null,
    exactSet, primaryCovered, errors, routingLatencyUs: Math.round(xs.sort((a, b) => a - b)[2]),
    safetyType: r.status === "SAFETY_BLOCKED" ? checkInputSafety(c.q).type : null,
  };
}

/** One config on one case set; the candidate and keyword-v1 run through routeCase itself (the M5 harness, untouched). */
async function runConfig(cases: readonly RoutingCase[], config: V4Config) {
  const outcomes: RoutingOutcome[] = [];
  for (const c of cases) {
    const o = config === "candidate" ? await routeCase(c, "intent-v1.1") : config === "keyword-v1" ? await routeCase(c, "keyword-v1") : await routeCaseWith(c, config, PROVIDERS[config]);
    outcomes.push({ ...o, config: config as RoutingConfig });
  }
  return { outcomes, metrics: routingMetrics(cases, outcomes, config as RoutingConfig) };
}

/**
 * requiredUndetected (fixed before scoring): a required agent of the case that is neither selected, nor deferred by the
 * system, nor a REQUEST intent of the plan (a turn stopped by input safety detected nothing). Also: detected-but-not-run
 * (REQUEST intent, not selected) split into deferred+disclosed vs silently dropped.
 */
export function deferralAccounting(cases: readonly RoutingCase[], outs: readonly RoutingOutcome[], config: V4Config) {
  const byId = new Map(outs.map((o) => [o.caseId, o]));
  let required = 0, selected = 0, deferredDisclosed = 0, deferredUndisclosed = 0, detectedNotRun = 0, undetected = 0;
  const undetectedCases: string[] = [], expect = { d: 0, deferredOk: 0 };
  for (const c of cases) {
    const o = byId.get(c.id)!;
    const plan = o.status === "SAFETY_BLOCKED" ? null : planFor(config, c.q);
    const requested = new Set((plan?.intents ?? []).filter((x) => x.role === "REQUEST").map((x) => x.agentId));
    for (const a of c.requiredAgents) {
      required++;
      if (o.selected.includes(a)) selected++;
      else if (o.deferred.includes(a)) { if (o.deferredDisclosed) deferredDisclosed++; else deferredUndisclosed++; }
      else if (requested.has(a)) detectedNotRun++;
      else { undetected++; undetectedCases.push(`${c.id}:${a}`); }
    }
    if (c.expectDeferred.length) { expect.d++; if (c.expectDeferred.every((a) => o.deferred.includes(a) && o.deferredDisclosed)) expect.deferredOk++; }
  }
  return { config, required, selected, deferredDisclosed, deferredUndisclosed, detectedNotRun, undetected, undetectedCases, expectDeferred: expect };
}

const TIMING = new Set(["routingLatencyUs", "wallLatencyMs"]);
const scrub = (x: unknown) => JSON.stringify(x, (k, v) => (TIMING.has(k) ? undefined : v));
const asCases = (xs: readonly unknown[]) => xs as unknown as readonly RoutingCase[];

const HISTORICAL = { v1: ROUTING_CASES_V1, dev: ROUTING_CASES_DEV, v2: ROUTING_CASES_HELDOUT_V2, devV3: asCases(ROUTING_CASES_DEV_V3), v3: asCases(ROUTING_CASES_HELDOUT_V3) } as const;
async function once() {
  const heldout = {} as Record<V4Config, Awaited<ReturnType<typeof runConfig>>>;
  for (const cfg of V4_CONFIGS) heldout[cfg] = await runConfig(asCases(ROUTING_CASES_HELDOUT_V4), cfg);
  const devV4 = await runConfig(asCases(ROUTING_CASES_DEV_V4), "candidate");
  const historical = {} as Record<keyof typeof HISTORICAL, { candidate: Awaited<ReturnType<typeof runConfig>>; v12: Awaited<ReturnType<typeof runConfig>> }>;
  for (const [k, cases] of Object.entries(HISTORICAL) as Array<[keyof typeof HISTORICAL, readonly RoutingCase[]]>) historical[k] = { candidate: await runConfig(cases, "candidate"), v12: await runConfig(cases, "intent-v1.2-frozen") };
  const execution = await runExecutionBenchmark();
  return { heldout, devV4, historical, execution, executionSummary: executionMetrics(execution) };
}

export async function runM7P41Evaluation() {
  const integrity = v4Integrity();
  if (!integrity.ok) throw new Error(`HELDOUT_V4_MODIFIED: ${integrity.actual} != ${integrity.freeze.sha256}`);
  const candidate = candidateSha();
  if (candidate === integrity.freeze.plannerSha256AtFreeze) throw new Error("NO_CANDIDATE: the planner is still the one frozen with v4 (intent-v1.2)");
  const prior = existsSync(V4_RUN_FILE) ? JSON.parse(readFileSync(V4_RUN_FILE, "utf8")) as { plannerSha256: string; datasetSha256: string } : null;
  if (prior && prior.plannerSha256 !== candidate) throw new Error(`HELDOUT_V4_ALREADY_SCORED_BY_ANOTHER_CANDIDATE (${prior.plannerSha256.slice(0, 12)}); a new candidate needs a new heldout set`);
  const a = await once();
  const b = await once();
  const key = (r: Awaited<ReturnType<typeof once>>) => scrub({ h: V4_CONFIGS.map((c) => r.heldout[c].outcomes), d: r.devV4.outcomes, hist: r.historical, e: r.execution.assertions, t: r.execution.turns });
  const identical = key(a) === key(b);
  const cand = a.heldout.candidate.metrics;
  const ex = a.executionSummary;
  const g9 = resolveFailures(a.execution.assertions, a.execution.observations, APPROVED_ADJUDICATIONS_M6, ROUTING_CASES_V1);
  const allMetrics: RoutingMetrics[] = [...V4_CONFIGS.map((c) => a.heldout[c].metrics), a.devV4.metrics, ...Object.values(a.historical).flatMap((h) => [h.candidate.metrics, h.v12.metrics])];
  const values: Record<string, number> = {
    "execution.crossUserLeaks": ex.crossUserLeaks,
    "execution.writeCalls": a.execution.counters.writeCalls + ex.failed.filter((f) => f.metric === "write").length,
    "execution.criticalSafetyViolations": ex.criticalSafetyViolations,
    "execution.forecastPromoted": a.execution.counters.forecastPromoted + ex.failed.filter((f) => f.metric === "forecast_promotion" && f.critical).length,
    "execution.agentOutputPromoted": a.execution.counters.agentOutputPromoted + ex.failed.filter((f) => f.metric === "memory_promotion" && f.critical).length,
    "routing.disclosurePctMin": Math.min(...allMetrics.map((m) => m.disclosure.pct ?? 100)),
    "heldout.candidate.primaryCoveragePct": cand.primaryCoverage.pct ?? 0,
    "heldout.candidate.exactSetLe2Pct": cand.exactSetLe2.pct ?? 0,
    "execution.unresolvedFailedAssertions": g9.unresolved.length,
    "determinism.identical": identical ? 1 : 0,
  };
  const gates = evaluateGates(values, QUALITY_GATES_M51);
  const heldoutCases = asCases(ROUTING_CASES_HELDOUT_V4);
  return {
    ...a, integrity, candidate, prior, identical, values, gates, g9,
    thresholdsUnchanged: integrity.freeze.metrics.gates.G7_primaryCoveragePctMin === 90 && integrity.freeze.metrics.gates.G8_exactSetLe2PctMin === 85 && integrity.freeze.metrics.gates.agentCap === 2,
    routingReady: gates.filter((g) => g.id === "G7" || g.id === "G8").every((g) => g.pass),
    allPass: gates.every((g) => g.pass),
    deferral: V4_CONFIGS.map((c) => deferralAccounting(heldoutCases, a.heldout[c].outcomes, c)),
  };
}
export type M7P41Eval = Awaited<ReturnType<typeof runM7P41Evaluation>>;

/** First scoring only: records the candidate that was scored (later runs only re-check determinism). */
export function recordFirstScoring(ev: M7P41Eval, head: string) {
  if (existsSync(V4_RUN_FILE)) return JSON.parse(readFileSync(V4_RUN_FILE, "utf8"));
  const m = ev.heldout.candidate.metrics;
  const rec = {
    plannerSha256: ev.candidate, strategy: CANDIDATE_STRATEGY, datasetSha256: ev.integrity.actual, firstScoredAt: new Date().toISOString(), baseHead: head,
    result: { primaryCoveragePct: m.primaryCoverage.pct, exactSetLe2Pct: m.exactSetLe2.pct, exactSetAllPct: m.exactSetAll.pct, macroF1: m.macroF1, microF1: m.microF1 },
  };
  writeFileSync(V4_RUN_FILE, `${JSON.stringify(rec, null, 2)}\n`);
  return rec;
}

// ── report (local only) ──────────────────────────────────────────────────────────────────────────────────────────────
const p = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x}%`);
const frac = (o: { n: number; d: number; pct: number | null }) => `${o.n}/${o.d} (${p(o.pct)})`;
const ag = (xs: readonly string[]) => (xs.length ? xs.map((a) => a[0].toUpperCase()).join("+") : "∅");
const HEAD_ROW = ["| Router · tập | Primary | Exact ≤2 | Exact (tất cả) | Macro / Micro F1 | Correct deferral (MULTI) | Unreported deferred | Agent thừa | OOS phát hiện | PARTIAL khớp nhãn |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
function metricRow(L: string[], name: string, m: RoutingMetrics) {
  L.push(`| ${name} | ${frac(m.primaryCoverage)} | ${frac(m.exactSetLe2)} | ${frac(m.exactSetAll)} | ${m.macroF1} / ${m.microF1} | ${frac(m.correctDeferral)} | ${m.errors.UNREPORTED_DEFERRED_INTENT} | ${m.falsePositiveInvocations.count} | ${p(m.oos.detectionPct)} | ${m.partial.labelAgree}/${m.partial.d} |`);
}
function fails(L: string[], cases: readonly RoutingCase[], outs: readonly RoutingOutcome[]) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = outs.filter((o) => !o.exactSet || o.errors.length);
  if (!rows.length) { L.push("Không có.", ""); return; }
  L.push("| Ca | Câu hỏi | Chấp nhận | Chọn | Hoãn | Trạng thái | Lỗi |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const o of rows) { const c = byId.get(o.caseId)!; L.push(`| ${o.caseId}${c.review ? " ⚑" : ""} | ${c.q.replace(/\|/g, "/")} | ${c.acceptable.map(ag).join(" / ")} | ${ag(o.selected)} | ${ag(o.deferred)} | ${o.status} | ${o.errors.join(", ") || "(sai tập)"} |`); }
  L.push("");
}
const NAME: Record<V4Config, string> = { "keyword-v1": "keyword-v1", "intent-v1.1-frozen": "intent-v1.1 (frozen)", "intent-v1.2-frozen": "intent-v1.2 (frozen)", candidate: `${CANDIDATE_STRATEGY} (candidate)` };
export function buildReport(ev: M7P41Eval, head: string): string {
  const L: string[] = [];
  const m = ev.heldout.candidate.metrics;
  const n = ROUTING_CASES_HELDOUT_V4.length;
  L.push(`# M7-P4.1 — Routing ${CANDIDATE_STRATEGY} & benchmark v4 (heldout v4)`, "",
    `> Local, ${new Date().toISOString().slice(0, 10)} · HEAD \`${head}\` · candidate planner sha256 \`${ev.candidate.slice(0, 12)}…\` · dataset v4 \`${ev.integrity.actual.slice(0, 12)}…\``,
    `> VERIFIED BY OFFLINE BENCHMARK (stub runners / mock models) · NOT VERIFIED BY LIVE MODEL · NOT VERIFIED BY REAL INFRASTRUCTURE.`,
    `> Single-author benchmark (cùng tác giả với router và mọi tập trước), không phải expert-validated, không đại diện traffic thật.`, "",
    `## Heldout v4 (${n} ca, chấm 1 lần) — G7 / G8 đo trên heldout v4`, "", ...HEAD_ROW);
  for (const c of V4_CONFIGS) metricRow(L, `${NAME[c]} · heldout v4`, ev.heldout[c].metrics);
  metricRow(L, `${NAME.candidate} · DEV v4 (dùng khi sửa)`, ev.devV4.metrics);
  L.push("", `Mẫu số: primary = ca in-scope (${m.primaryCoverage.d}); exact ≤2 = ca cần ≤2 agent (${m.exactSetLe2.d}); exact tất cả = ${m.exactSetAll.d}; correct deferral = ca MULTI (${m.correctDeferral.d}).`, "");
  L.push("### Per-agent (candidate, heldout v4)", "", "| Agent | P | R | F1 |", "| --- | --- | --- | --- |");
  for (const [a, x] of Object.entries(m.perAgent)) L.push(`| ${a} | ${x.precision} | ${x.recall} | ${x.f1} |`);
  L.push("", "### Phát hiện / hoãn nhu cầu (heldout v4, theo cặp ca–agent bắt buộc)", "", "| Router | Bắt buộc | Được chọn | Hoãn + công bố | Hoãn không công bố | Phát hiện nhưng không chạy | Không phát hiện | expectDeferred đúng |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const d of ev.deferral) L.push(`| ${NAME[d.config]} | ${d.required} | ${d.selected} | ${d.deferredDisclosed} | ${d.deferredUndisclosed} | ${d.detectedNotRun} | ${d.undetected}${d.undetectedCases.length ? ` (${d.undetectedCases.join(", ")})` : ""} | ${d.expectDeferred.deferredOk}/${d.expectDeferred.d} |`);
  L.push("", "### Ca heldout v4 sai của candidate (công bố đầy đủ, không sửa nhãn, không tinh chỉnh lại)", "");
  fails(L, asCases(ROUTING_CASES_HELDOUT_V4), ev.heldout.candidate.outcomes);
  L.push("## Gate (QUALITY_GATES_M51, ngưỡng không đổi; G7/G8 = heldout v4)", "", "| Gate | Giá trị | Ngưỡng | Kết quả |", "| --- | --- | --- | --- |");
  for (const g of ev.gates) L.push(`| ${g.id} ${g.description.replace(/heldout v2/g, "heldout v4").replace(/intent-v1\.1/g, CANDIDATE_STRATEGY)} | ${g.value} | ${g.op} ${g.threshold} | ${g.pass ? "PASS" : "FAIL"} |`);
  L.push("", "_Mô tả G6/G7/G8 trong bảng gate M5.1 ghi \"heldout v2 / intent-v1.1\"; ở đây số đo là heldout v4 / candidate (bảng đã thay tên tập cho đúng)._", "",
    "## HISTORICAL REGRESSION — NOT INDEPENDENT HOLDOUT", "", ...HEAD_ROW);
  const HN: Record<keyof typeof HISTORICAL, string> = { v1: "M5 v1", dev: "DEV (M5.1)", v2: "heldout v2 (đã lộ)", devV3: "DEV v3", v3: "heldout v3 (đã lộ)" };
  for (const k of Object.keys(HISTORICAL) as Array<keyof typeof HISTORICAL>) { metricRow(L, `${NAME["intent-v1.2-frozen"]} · ${HN[k]}`, ev.historical[k].v12.metrics); metricRow(L, `${NAME.candidate} · ${HN[k]}`, ev.historical[k].candidate.metrics); }
  L.push("", `Tính tất định (2 lần chạy giống hệt): ${ev.identical ? "CÓ" : "KHÔNG"}.`, "");
  return L.join("\n");
}

if (require.main === module) {
  (async () => {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: WORKTREE, encoding: "utf8" }).trim();
    const ev = await runM7P41Evaluation();
    if (process.argv.includes("--score")) console.log("RUN_FILE", JSON.stringify(recordFirstScoring(ev, head)));
    for (const c of V4_CONFIGS) { const x = ev.heldout[c].metrics; console.log(`HELDOUT_V4 ${c} primary ${x.primaryCoverage.pct} exactLe2 ${x.exactSetLe2.pct} exactAll ${x.exactSetAll.pct} F1 ${x.macroF1}/${x.microF1}`); }
    console.log(`identical ${ev.identical}`);
    for (const g of ev.gates) console.log(`${g.id} ${g.pass ? "PASS" : "FAIL"} ${g.value}`);
    if (process.argv.includes("--report")) {
      const dir = resolve(WORKTREE, "docs/ai-v2/m7");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "M7-P4.1-ROUTING-REPORT-vi.md"), buildReport(ev, head));
      console.log("REPORT written");
    }
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
