/**
 * M7-P4 — benchmark v3 evaluation of the "intent-v1.2" candidate (KD-1 / KD-2 fix). OFFLINE: the real supervisor with stub
 * runners for routing (m5-benchmark/routing-eval.ts, metric definitions UNCHANGED) and the M5 execution benchmark (mock
 * models, synthetic fixtures) for the safety invariants. Same gate table as M5.1 (QUALITY_GATES_M51, thresholds
 * unchanged); G7 / G8 are measured on HELDOUT v3 (frozen before the router change); G9 uses the recorded M6 owner
 * adjudications (exact keys, unchanged).
 *
 * Protocol: heldout-v3.freeze.json pins the dataset; the FIRST scoring writes heldout-v3.run.json with the candidate's
 * planner sha — afterwards a different planner refuses to run (a new candidate needs a new heldout set). v1, DEV and
 * heldout v2 are run as HISTORICAL REGRESSION — NOT INDEPENDENT HOLDOUT. Nova Pro is NOT evaluated here.
 * CLI: npx tsx src/__tests__/m7-benchmark/run-v3.ts --score   (first scoring / determinism re-check)  [--report]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runRoutingBenchmark, type RoutingMetrics, type RoutingOutcome } from "../m5-benchmark/routing-eval";
import { runExecutionBenchmark, executionMetrics } from "../m5-benchmark/execution-eval";
import { QUALITY_GATES_M51, evaluateGates } from "../m5-benchmark/gates";
import { APPROVED_ADJUDICATIONS_M6, resolveFailures } from "../m5-benchmark/adjudication-m6";
import { ROUTING_CASES_V1, type RoutingCase } from "../m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "../m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "../m5-benchmark/dataset-heldout-v2";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3, type V3Case } from "./dataset-v3";
import { planRouting as planBaselineV11 } from "./baseline-intent-v1-1";
import { foldVi } from "../../llm/speech_act";
import type { AgentId } from "../../agent-v2/multi-agent-contracts";

const HERE = __dirname;
export const V3_DATASET_FILE = resolve(HERE, "dataset-v3.ts");
export const V3_FREEZE_FILE = resolve(HERE, "heldout-v3.freeze.json");
export const V3_RUN_FILE = resolve(HERE, "heldout-v3.run.json");
export const PLANNER_FILE = resolve(HERE, "../../agent-v2/routing-planner.ts");
const WORKTREE = resolve(HERE, "../../../../../..");
const sha = (file: string) => createHash("sha256").update(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
export const candidateSha = () => sha(PLANNER_FILE);
/** The production default config of the M5 harness (= the router in agent-v2/routing-planner.ts, now intent-v1.2). */
const CANDIDATE = "intent-v1.1" as const;
const AGENTS: AgentId[] = ["progress", "recovery", "training", "nutrition"];

export function v3Integrity() {
  const f = JSON.parse(readFileSync(V3_FREEZE_FILE, "utf8")) as { sha256: string; devCases: number; heldoutCases: number; plannerSha256AtFreeze: string; criteria: { primaryCoveragePctMin: number; exactSetLe2PctMin: number } };
  const actual = sha(V3_DATASET_FILE);
  return { freeze: f, actual, ok: f.sha256 === actual && f.devCases === ROUTING_CASES_DEV_V3.length && f.heldoutCases === ROUTING_CASES_HELDOUT_V3.length };
}

const TIMING = new Set(["routingLatencyUs", "wallLatencyMs"]);
const scrub = (x: unknown) => JSON.stringify(x, (k, v) => (TIMING.has(k) ? undefined : v));
const asCases = (xs: readonly V3Case[]) => xs as unknown as readonly RoutingCase[];

async function once() {
  const heldoutV3 = await runRoutingBenchmark(asCases(ROUTING_CASES_HELDOUT_V3), [CANDIDATE]);
  const devV3 = await runRoutingBenchmark(asCases(ROUTING_CASES_DEV_V3), [CANDIDATE]);
  const v1 = await runRoutingBenchmark(ROUTING_CASES_V1, [CANDIDATE]);
  const dev = await runRoutingBenchmark(ROUTING_CASES_DEV, [CANDIDATE]);
  const v2 = await runRoutingBenchmark(ROUTING_CASES_HELDOUT_V2, [CANDIDATE]);
  const execution = await runExecutionBenchmark();
  return { heldoutV3, devV3, v1, dev, v2, execution, executionSummary: executionMetrics(execution) };
}

/** Selection-only comparison with the frozen intent-v1.1 (folded input, as the M5 harness gives it). Informational. */
export function baselineComparison(cases: readonly V3Case[] | readonly RoutingCase[]) {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  let exact = 0, le2 = 0, le2d = 0, prim = 0, primd = 0;
  const changed: string[] = [];
  for (const c of cases as readonly RoutingCase[]) {
    const sel = planBaselineV11(foldVi(c.q), AGENTS, { maxAgents: 2 }).selected;
    const ok = c.acceptable.some((s) => same(s, sel));
    if (ok) exact++;
    if (c.requiredAgents.length <= 2) { le2d++; if (ok) le2++; }
    if (c.primaryAgent) { primd++; if (sel.includes(c.primaryAgent as AgentId)) prim++; }
    changed.push(`${c.id}:${sel.join("+")}`);
  }
  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
  return { exactAll: pct(exact, cases.length), exactSetLe2: pct(le2, le2d), primaryCoverage: pct(prim, primd), selections: changed };
}

export async function runM7P4Evaluation() {
  const integrity = v3Integrity();
  if (!integrity.ok) throw new Error(`HELDOUT_V3_MODIFIED: ${integrity.actual} != ${integrity.freeze.sha256}`);
  const candidate = candidateSha();
  if (candidate === integrity.freeze.plannerSha256AtFreeze) throw new Error("NO_CANDIDATE: the planner is still the one frozen with v3 (intent-v1.1)");
  const prior = existsSync(V3_RUN_FILE) ? JSON.parse(readFileSync(V3_RUN_FILE, "utf8")) as { plannerSha256: string; datasetSha256: string } : null;
  if (prior && prior.plannerSha256 !== candidate) throw new Error(`HELDOUT_V3_ALREADY_SCORED_BY_ANOTHER_CANDIDATE (${prior.plannerSha256.slice(0, 12)}); a new candidate needs a new heldout set`);
  const a = await once();
  const b = await once();
  const key = (r: Awaited<ReturnType<typeof once>>) => scrub({ h: r.heldoutV3.outcomes, d3: r.devV3.outcomes, v1: r.v1.outcomes, d: r.dev.outcomes, v2: r.v2.outcomes, e: r.execution.assertions, t: r.execution.turns });
  const identical = key(a) === key(b);
  const cand = a.heldoutV3.metrics[0];
  const ex = a.executionSummary;
  const g9 = resolveFailures(a.execution.assertions, a.execution.observations, APPROVED_ADJUDICATIONS_M6, ROUTING_CASES_V1);
  const values: Record<string, number> = {
    "execution.crossUserLeaks": ex.crossUserLeaks,
    "execution.writeCalls": a.execution.counters.writeCalls + ex.failed.filter((f) => f.metric === "write").length,
    "execution.criticalSafetyViolations": ex.criticalSafetyViolations,
    "execution.forecastPromoted": a.execution.counters.forecastPromoted + ex.failed.filter((f) => f.metric === "forecast_promotion" && f.critical).length,
    "execution.agentOutputPromoted": a.execution.counters.agentOutputPromoted + ex.failed.filter((f) => f.metric === "memory_promotion" && f.critical).length,
    "routing.disclosurePctMin": Math.min(...[a.heldoutV3, a.devV3, a.v1, a.dev, a.v2].flatMap((x) => x.metrics.map((m) => m.disclosure.pct ?? 100))),
    "heldout.candidate.primaryCoveragePct": cand.primaryCoverage.pct ?? 0,
    "heldout.candidate.exactSetLe2Pct": cand.exactSetLe2.pct ?? 0,
    "execution.unresolvedFailedAssertions": g9.unresolved.length,
    "determinism.identical": identical ? 1 : 0,
  };
  const gates = evaluateGates(values, QUALITY_GATES_M51);
  return {
    ...a, integrity, candidate, prior, identical, values, gates, g9,
    thresholdsUnchanged: integrity.freeze.criteria.primaryCoveragePctMin === 90 && integrity.freeze.criteria.exactSetLe2PctMin === 85,
    routingReady: gates.filter((g) => g.id === "G7" || g.id === "G8").every((g) => g.pass),
    allPass: gates.every((g) => g.pass),
    baselineV11OnHeldoutV3: baselineComparison(ROUTING_CASES_HELDOUT_V3),
  };
}
export type M7P4Eval = Awaited<ReturnType<typeof runM7P4Evaluation>>;

/** First scoring only: records the candidate that was scored (later runs only re-check determinism). */
export function recordFirstScoring(ev: M7P4Eval, head: string) {
  if (existsSync(V3_RUN_FILE)) return JSON.parse(readFileSync(V3_RUN_FILE, "utf8"));
  const m = ev.heldoutV3.metrics[0];
  const rec = {
    plannerSha256: ev.candidate, strategy: "intent-v1.2", datasetSha256: ev.integrity.actual, firstScoredAt: new Date().toISOString(), baseHead: head,
    result: { primaryCoveragePct: m.primaryCoverage.pct, exactSetLe2Pct: m.exactSetLe2.pct, exactSetAllPct: m.exactSetAll.pct, macroF1: m.macroF1, microF1: m.microF1 },
  };
  writeFileSync(V3_RUN_FILE, `${JSON.stringify(rec, null, 2)}\n`);
  return rec;
}

// ── report (local only) ──────────────────────────────────────────────────────────────────────────────────────────────
const p = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x}%`);
const frac = (o: { n: number; d: number; pct: number | null }) => `${o.n}/${o.d} (${p(o.pct)})`;
const ag = (xs: readonly string[]) => (xs.length ? xs.map((a) => a[0].toUpperCase()).join("+") : "∅");
function metricRows(L: string[], name: string, m: RoutingMetrics) {
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
export function buildReport(ev: M7P4Eval, head: string): string {
  const L: string[] = [];
  const m = ev.heldoutV3.metrics[0];
  L.push(`# M7-P4 — Routing intent-v1.2 (KD-1 / KD-2) & benchmark v3`, "",
    `> Local, ${new Date().toISOString().slice(0, 10)} · HEAD \`${head}\` · candidate planner sha256 \`${ev.candidate.slice(0, 12)}…\` · dataset v3 \`${ev.integrity.actual.slice(0, 12)}…\``,
    `> VERIFIED BY OFFLINE BENCHMARK (stub runners / mock models) · NOT VERIFIED BY LIVE MODEL · NOT VERIFIED BY REAL INFRASTRUCTURE.`,
    `> Single-author benchmark (same author as the router), not expert-validated.`, "",
    `## Heldout v3 (${ROUTING_CASES_HELDOUT_V3.length} ca, chấm 1 lần)`, "",
    "| Tập | Primary | Exact ≤2 | Exact (tất cả) | Macro/Micro F1 | Correct deferral | Unreported deferred | Agent thừa | OOS | PARTIAL khớp nhãn |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  metricRows(L, "heldout v3 — intent-v1.2", m);
  metricRows(L, "DEV v3 (dùng khi sửa)", ev.devV3.metrics[0]);
  L.push("", `Baseline intent-v1.1 (chỉ so lựa chọn, input đã bỏ dấu) trên heldout v3: primary ${p(ev.baselineV11OnHeldoutV3.primaryCoverage)}, exact ≤2 ${p(ev.baselineV11OnHeldoutV3.exactSetLe2)}, exact tất cả ${p(ev.baselineV11OnHeldoutV3.exactAll)}.`, "");
  L.push("| Agent | P | R | F1 |", "| --- | --- | --- | --- |");
  for (const [a, x] of Object.entries(m.perAgent)) L.push(`| ${a} | ${x.precision} | ${x.recall} | ${x.f1} |`);
  L.push("", "### Ca heldout v3 sai (công bố đầy đủ, không sửa nhãn, không tinh chỉnh lại)", "");
  fails(L, ROUTING_CASES_HELDOUT_V3 as unknown as RoutingCase[], ev.heldoutV3.outcomes);
  L.push("## Gate (ngưỡng M5.1 không đổi)", "", "| Gate | Giá trị | Ngưỡng | Kết quả |", "| --- | --- | --- | --- |");
  for (const g of ev.gates) L.push(`| ${g.id} ${g.description} | ${g.value} | ${g.op} ${g.threshold} | ${g.pass ? "PASS" : "FAIL"} |`);
  L.push("", "## HISTORICAL REGRESSION — NOT INDEPENDENT HOLDOUT", "", "| Tập | Primary | Exact ≤2 | Exact (tất cả) | Macro/Micro F1 | Correct deferral | Unreported deferred | Agent thừa | OOS | PARTIAL khớp nhãn |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  metricRows(L, "M5 v1", ev.v1.metrics[0]); metricRows(L, "DEV (M5.1)", ev.dev.metrics[0]); metricRows(L, "heldout v2 (đã lộ)", ev.v2.metrics[0]);
  L.push("", `Tính tất định (2 lần chạy giống hệt): ${ev.identical ? "CÓ" : "KHÔNG"}.`, "");
  return L.join("\n");
}

if (require.main === module) {
  (async () => {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: WORKTREE, encoding: "utf8" }).trim();
    const ev = await runM7P4Evaluation();
    if (process.argv.includes("--score")) console.log("RUN_FILE", JSON.stringify(recordFirstScoring(ev, head)));
    const m = ev.heldoutV3.metrics[0];
    console.log(`HELDOUT_V3 primary ${m.primaryCoverage.pct} exactLe2 ${m.exactSetLe2.pct} exactAll ${m.exactSetAll.pct} identical ${ev.identical}`);
    for (const g of ev.gates) console.log(`${g.id} ${g.pass ? "PASS" : "FAIL"} ${g.value}`);
    if (process.argv.includes("--report")) {
      const dir = resolve(WORKTREE, "docs/ai-v2/m7");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "M7-P4-ROUTING-REPORT-vi.md"), buildReport(ev, head));
      console.log("REPORT written");
    }
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
