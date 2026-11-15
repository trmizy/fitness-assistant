/**
 * M8-A4 routing evaluator (schema "m7-p5a2"). OFFLINE. Input = a dataset that passes the EXISTING validator + exactly ONE outcome per
 * case. Output = a report (JSON + text) with routing quality, G7 / G8 on raw ratios, and the SAFETY section kept apart.
 * It never fabricates, repairs or defaults an outcome, and never says G7 / G8 were achieved on real data: a report built from a
 * synthetic dataset (marker, or any id starting "SYN-") carries the stamp below and `g7g8ResultClaimable: false`.
 *
 * MAPPING (owner decision F8): selected = the routing DECISION (supervisor trace `decision.agents`) — the ONLY thing G7 / G8 measure;
 * executed = the agents actually delegated (`trace.delegations`) — reported in `executed`, never feeding G7 / G8. Deferred-intent
 * disclosure is a third, separate block. (The frozen scorer's "selected/ran" wording is intentionally left untouched.)
 *
 * MODE (owner decision F7): every report is mode OFFLINE_DIAGNOSTIC with `liveEligible: false` (a literal constant). There is no live
 * runner here and no code path can set it true: an unsigned validator REVIEW item, or a missing freeze manifest, only adds a reason.
 */
import { createHash } from "node:crypto";
import { validateRoutingAnnotations, type Finding, type ValidateOptions } from "./annotation-validator";
import type { AnnotationRow } from "./annotation-schema";
import { ELIGIBILITY_RULE, eligibleCaseIds, reconcileOutcomes, type EvalOutcome, type OutcomeError } from "./routing-evaluator-outcomes";
import { DEFAULT_THRESHOLDS, assertThresholds, computeDeferredDisclosure, computeExecuted, computeRoutingQuality, computeSafety, gateVerdict, pctDisplay, type DeferredDisclosure, type ExecutedQuality, type GateResult, type GateThresholds, type Ratio, type RoutingQuality, type SafetyEvidence, type SafetySection } from "./routing-evaluator-metrics";
import type { BudgetSnapshot } from "./routing-evaluator-budget";

export const SYNTHETIC_STAMP = "SYNTHETIC — not a G7/G8 result";
export const FLAGS: readonly string[] = Object.freeze([
  "F1 DECIDED (owner, M8-C): G7 is by MEMBERSHIP (the unique expected primary is among the selected agents; plan §7 'có primary duy nhất'); selected[0] is never 'the primary'; routing.primary.firstSelectedDiagnostic is a labelled diagnostic with no verdict and no influence on G7 / G8",
  "F2 DECIDED (owner, M8-C): NOT_EVALUABLE affects only its own gate: a NOT_EVALUABLE routing-scored row (or a tripped budget) -> G7 / G8 INVALID_RUN only (run.gatesValid); a NOT_EVALUABLE safety / OOS-preflight / validation group row -> safety block invalid only (run.safetyValid); any other row invalidates nothing",
  "F3 DECIDED (owner, M8-C, keep): per-agent F1 exact 2TP/(2TP+FP+FN) and by the M5 rule (null when precision or recall is undefined or TP = 0); macro F1 in both forms",
  "F4 DECIDED (owner, M8-C, keep): thresholds are integer ratios (default 90/100 and 85/100; plan §7 'ngưỡng KHÔNG đổi'), parametrised and validated, compared raw by BigInt cross-multiplication (no rounding)",
  "F5 DECIDED (owner, M8-C, keep): per-agent TP/FP/FN use the cap-2 acceptable sets",
  "F6 DECIDED (owner, M8-C): SG1 / SG3 need EXECUTED evidence and SG4 a measurement ({executed:true, runId, source, cases>0, count>=0}); absent -> NO_EVIDENCE; invalid / partial -> INVALID_EVIDENCE (SAFETY_EVIDENCE_INVALID); never PASS, never inferred from routing outcomes",
  "F7 DECIDED (owner, M8-C): an unsigned REVIEW item (or no freeze manifest) allows OFFLINE DIAGNOSTIC evaluation only; mode is always OFFLINE_DIAGNOSTIC and liveEligible is always false; no live runner exists",
  "F8 DECIDED (owner, M8-C): G7 / G8 are measured on SELECTED routing (decision.agents); executed-agent quality (trace.delegations) and deferred-intent metrics are separate blocks that never feed G7 / G8",
]);

export interface EvaluateOptions {
  system: string;
  /** Mark the dataset synthetic. Forced true when any case id starts with "SYN-" (cannot be switched off). */
  synthetic?: boolean;
  thresholds?: GateThresholds;
  safetyEvidence?: SafetyEvidence;
  /** Budget snapshot of a model-backed system run; tripped => INVALID_RUN. */
  budget?: BudgetSnapshot | null;
  validate?: ValidateOptions;
  /** Errors found while parsing the outcomes file (e.g. OUTCOME_MALFORMED_JSON). */
  outcomeParseErrors?: readonly OutcomeError[];
  /** sha256 of a signed freeze manifest, if one exists. Supplying it NEVER makes a report live-eligible (F7); it only removes one reason. */
  freezeManifestSha256?: string | null;
}
/** F7: the only mode this evaluator has. `liveEligible` is the literal `false`: nothing here can produce a live-eligible report. */
export interface OfflineMode { mode: "OFFLINE_DIAGNOSTIC"; liveEligible: false; liveEligibilityReasons: string[] }
export const LIVE_ELIGIBLE = false as const;
export function offlineMode(reviewItems: number, freezeManifestSha256: string | null | undefined): OfflineMode {
  const reasons = ["EVALUATOR_OFFLINE_ONLY: this evaluator has no live runner and no model client; a live run needs a separate, explicitly approved runner"];
  if (reviewItems > 0) reasons.push(`UNSIGNED_REVIEW_ITEMS: ${reviewItems} validator REVIEW item(s) — offline diagnostic evaluation only`);
  if (!freezeManifestSha256) reasons.push("NO_FREEZE_MANIFEST: no freeze manifest supplied");
  return { mode: "OFFLINE_DIAGNOSTIC", liveEligible: LIVE_ELIGIBLE, liveEligibilityReasons: reasons };
}
export interface RoutingEvaluationReport {
  reportKind: "m7-p5a2-routing-evaluation";
  stamp: string | null;
  synthetic: boolean;
  g7g8ResultClaimable: boolean;
  /** F7: always OFFLINE_DIAGNOSTIC / liveEligible false. */
  mode: "OFFLINE_DIAGNOSTIC";
  liveEligible: false;
  liveEligibilityReasons: string[];
  system: string;
  schemaVersion: "m7-p5a2";
  datasetSha256: string;
  validation: { cases: number; reviewItems: number };
  /** One outcome per eligible case (see ELIGIBILITY_RULE): eligible = every dataset case. */
  eligibility: { rule: string; eligibleCases: number; routingScored: number; outcomeOnlyCases: number };
  /** F2 per gate: gatesValid covers G7 + G8 only; safetyValid covers the safety block only. `valid` = gatesValid. */
  run: { status: "VALID" | "BUDGET_EXHAUSTED" | "INVALID_NOT_EVALUABLE"; valid: boolean; gatesValid: boolean; safetyValid: boolean; notEvaluable: number; notEvaluableRoutingScored: number; budgetTripped: boolean };
  gates: { G7: GateResult; G8: GateResult };
  routing: RoutingQuality;
  /** Executed-agent quality (optional `executedAgents`) — separate from `routing`, never merged. */
  executed: ExecutedQuality;
  /** Deferred-intent disclosure — separate from `routing` and `safety`. */
  deferredDisclosure: DeferredDisclosure;
  safety: SafetySection;
  usage: { modelCalls: number; inputTokens: number; outputTokens: number; costUsd: number; casesWithModelCall: number };
  budget: BudgetSnapshot | null;
  flags: readonly string[];
}
export type EvaluateResult =
  | { ok: false; stage: "DATASET_INVALID"; errors: Finding[] }
  | { ok: false; stage: "OUTCOMES_INVALID"; errors: OutcomeError[] }
  | { ok: true; report: RoutingEvaluationReport };

export const parseRows = (jsonl: string): AnnotationRow[] => jsonl.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as AnnotationRow);

/** Scores validated rows against reconciled outcomes (no validation here; use evaluateDataset for the full path). */
export function evaluateRows(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>, o: EvaluateOptions & { datasetSha256?: string; reviewItems?: number }): RoutingEvaluationReport {
  const th = o.thresholds ?? DEFAULT_THRESHOLDS;
  assertThresholds(th);
  const synthetic = o.synthetic === true || rows.some((r) => /^SYN-/i.test(r.id));
  const routing = computeRoutingQuality(rows, byId);
  const budgetTripped = o.budget?.tripped === true;
  // F2: only a NOT_EVALUABLE outcome in the routing-scored population (the G7 / G8 / OOS / AMBIGUOUS denominators) invalidates the gates
  const valid = routing.populations.notEvaluableRoutingScored === 0 && !budgetTripped;
  const status = budgetTripped ? "BUDGET_EXHAUSTED" as const : routing.populations.notEvaluableRoutingScored > 0 ? "INVALID_NOT_EVALUABLE" as const : "VALID" as const;
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, casesWithModelCall: 0 };
  for (const x of byId.values()) if (x.usage) { usage.modelCalls += x.usage.modelCalls; usage.inputTokens += x.usage.inputTokens; usage.outputTokens += x.usage.outputTokens; usage.costUsd += x.usage.costUsd; if (x.usage.modelCalls > 0) usage.casesWithModelCall++; }
  usage.costUsd = Math.round(usage.costUsd * 1e6) / 1e6;
  const safety = computeSafety(rows, byId, o.safetyEvidence ?? {});
  const om = offlineMode(o.reviewItems ?? 0, o.freezeManifestSha256);
  return {
    reportKind: "m7-p5a2-routing-evaluation", stamp: synthetic ? SYNTHETIC_STAMP : null, synthetic, g7g8ResultClaimable: !synthetic && valid,
    mode: om.mode, liveEligible: om.liveEligible, liveEligibilityReasons: om.liveEligibilityReasons,
    system: o.system, schemaVersion: "m7-p5a2", datasetSha256: o.datasetSha256 ?? "NOT_COMPUTED",
    validation: { cases: rows.length, reviewItems: o.reviewItems ?? 0 },
    eligibility: { rule: ELIGIBILITY_RULE, eligibleCases: eligibleCaseIds(rows).length, routingScored: routing.populations.routingScored, outcomeOnlyCases: rows.length - routing.populations.routingScored },
    run: { status, valid, gatesValid: valid, safetyValid: safety.valid, notEvaluable: routing.populations.notEvaluable, notEvaluableRoutingScored: routing.populations.notEvaluableRoutingScored, budgetTripped },
    gates: { G7: gateVerdict("G7", routing.g7, th.g7, valid), G8: gateVerdict("G8", routing.g8, th.g8, valid) },
    routing, executed: computeExecuted(rows, byId), deferredDisclosure: computeDeferredDisclosure(rows, byId), safety,
    usage, budget: o.budget ?? null, flags: FLAGS,
  };
}

/** Full path: validate the dataset (existing validator) -> reconcile outcomes (one per case) -> score. */
export function evaluateDataset(datasetJsonl: string, outcomes: readonly unknown[], o: EvaluateOptions): EvaluateResult {
  const v = validateRoutingAnnotations(datasetJsonl, o.validate ?? { checkDistribution: true, checkBenchmarkOverlap: true });
  if (!v.ok) return { ok: false, stage: "DATASET_INVALID", errors: v.errors };
  const rows = parseRows(datasetJsonl);
  const rec = reconcileOutcomes(eligibleCaseIds(rows), outcomes, o.outcomeParseErrors ?? []);
  if (!rec.ok) return { ok: false, stage: "OUTCOMES_INVALID", errors: rec.errors };
  const sha = createHash("sha256").update(datasetJsonl.replace(/\r\n/g, "\n")).digest("hex");
  return { ok: true, report: evaluateRows(rows, rec.byId, { ...o, datasetSha256: sha, reviewItems: v.reviews.length }) };
}

// ── text rendering ──────────────────────────────────────────────────────────────────────────────────────────────────
const R = (r: Ratio) => `${r.num}/${r.den}${r.den ? ` (${pctDisplay(r)})` : " (n/a)"}`;
export function renderTextReport(r: RoutingEvaluationReport): string {
  const L: string[] = [];
  if (r.stamp) L.push(`*** ${r.stamp} ***`);
  L.push(`m7-p5a2 routing evaluation — system ${r.system}`, `dataset sha256 ${r.datasetSha256}; cases ${r.validation.cases}; validator review items ${r.validation.reviewItems}`);
  L.push(`eligibility: ${r.eligibility.rule}; eligible ${r.eligibility.eligibleCases} (routing-scored ${r.eligibility.routingScored}, outcome-only ${r.eligibility.outcomeOnlyCases})`);
  L.push(`mode ${r.mode}; liveEligible: ${r.liveEligible}`, ...r.liveEligibilityReasons.map((x) => `  - ${x}`));
  L.push(`run status ${r.run.status} (notEvaluable ${r.run.notEvaluable}, of which routing-scored ${r.run.notEvaluableRoutingScored}; budgetTripped ${r.run.budgetTripped}); g7g8ResultClaimable: ${r.g7g8ResultClaimable}`, "");
  L.push("GATES (raw integer ratios; the percentage is display only; G7 = membership of the unique primary in the SELECTED agents; executed agents and deferred intents never feed G7 / G8)");
  for (const g of [r.gates.G7, r.gates.G8]) L.push(`  ${g.id}: ${R(g.ratio)} vs threshold ${g.threshold.num}/${g.threshold.den} -> ${g.verdict}`);
  const q = r.routing;
  const pv = q.primary;
  L.push("", "ROUTING QUALITY (decision = selected agents)", `  PRIMARY variants on the G7 population (${pv.population}): membership (= G7) ${R(pv.coverage)}; DIAGNOSTIC ONLY (no verdict, not in G7): selected[0] is the primary ${R(pv.firstSelectedDiagnostic)}`,
    `  required intents selected ${R(q.requiredIntentCoverage)}; cases fully selected ${R(q.requiredIntentFullCases)}`,
    `  primary first ∈ acceptablePrimaries ${R(q.primaryFirstCorrect)}; primary anywhere ${R(q.primaryAnywhere)} (wider population than G7)`,
    `  OOS handled ${R(q.oos.handled)} (selected something ${q.oos.selectedSomething}, blocked before routing ${q.oos.blockedBeforeRouting}); in-scope with no selection ${R(q.inScopeNoSelection)}`,
    `  false positives: extra agents ${q.falsePositives.extraAgents} in ${q.falsePositives.casesWithExtra} cases (rows that reached routing ${q.falsePositives.rowsReachedRouting})`,
    `  micro F1 ${R(q.microF1)}; macro F1 ${q.macroF1 === null ? "n/a" : q.macroF1.toFixed(3)} (M5 rule ${q.macroF1M5 === null ? "n/a" : q.macroF1M5.toFixed(3)})`);
  for (const [a, p] of Object.entries(q.perAgent)) L.push(`    ${a}: tp ${p.tp} fp ${p.fp} fn ${p.fn} precision ${R(p.precision)} recall ${R(p.recall)} f1 ${R(p.f1)} (M5 ${p.f1M5 === null ? "n/a" : p.f1M5.toFixed(3)})`);
  L.push(`  ambiguous group: counted ${q.ambiguousGroup.counted}, exact ${q.ambiguousGroup.exact}, primary hit ${q.ambiguousGroup.primaryHit}; long-question group rows ${q.longQuestionGroup.rows} (reported only)`, "  by category:");
  for (const [c, b] of Object.entries(q.byCategory)) L.push(`    ${c}: rows ${b.rows}, scored ${b.routingScored}, G7 ${R(b.g7)}, G8 ${R(b.g8)}, required ${R(b.requiredCoverage)}, extra agents ${b.extraAgents}`);
  const x = r.executed;
  L.push("", "EXECUTED AGENTS (separate from the decision above; never merged)", `  status ${x.status} (${x.outcomesWithExecuted}/${x.outcomes} outcomes carry executedAgents) — ${x.note}`);
  if (x.quality && x.selectedButNotExecuted) {
    L.push(`  selected but not executed: ${x.selectedButNotExecuted.agents} agents in ${x.selectedButNotExecuted.cases} cases`, `  micro F1 ${R(x.quality.microF1)}; macro F1 ${x.quality.macroF1 === null ? "n/a" : x.quality.macroF1.toFixed(3)} (M5 rule ${x.quality.macroF1M5 === null ? "n/a" : x.quality.macroF1M5.toFixed(3)}); G7-shaped ${R(x.quality.g7Shaped)}, G8-shaped ${R(x.quality.g8Shaped)} (information only, no verdict)`);
    for (const [a, p] of Object.entries(x.quality.perAgent)) L.push(`    ${a}: tp ${p.tp} fp ${p.fp} fn ${p.fn} precision ${R(p.precision)} recall ${R(p.recall)} f1 ${R(p.f1)} (M5 ${p.f1M5 === null ? "n/a" : p.f1M5.toFixed(3)})`);
  }
  const d = r.deferredDisclosure;
  L.push("", "DEFERRED-INTENT DISCLOSURE (separate from routing and safety)", `  expected-deferred intents deferred+disclosed ${R(d.expectedDeferred)}; undisclosed deferrals ${d.undisclosedDeferrals}`,
    `  frozen 'missed intents' coverage (selected OR disclosed) ${R(d.requiredIntentCoverageWithDisclosure)}; cases fully covered ${R(d.requiredIntentFullCasesWithDisclosure)}`);
  const s = r.safety;
  L.push("", "SAFETY (separate from routing quality)", `  valid ${s.valid} (notEvaluable ${s.notEvaluable})`);
  for (const [k, g] of Object.entries(s.preflight)) L.push(`  preflight ${k}: ${g.pass}/${g.cases} pass ${JSON.stringify(g.verdicts)}`);
  for (const g of s.gates) L.push(`  ${g.id} ${g.status}${g.value === null ? "" : ` (${g.value})`} — ${g.description}`);
  for (const [k, e] of Object.entries(s.evidence)) L.push(`  evidence ${k}: ${e.status}${e.runId ? ` (run ${e.runId}, source ${e.source}, cases ${e.cases})` : ""}${e.problems.length ? ` — ${e.problems.join("; ")}` : ""}`);
  L.push(`  hard safety gates all PASS: ${s.hardGatesPass}; false-positive blocks ${s.falsePositiveBlocks}`);
  L.push("", `USAGE model calls ${r.usage.modelCalls} in ${r.usage.casesWithModelCall} cases; tokens in ${r.usage.inputTokens} out ${r.usage.outputTokens}; cost USD ${r.usage.costUsd}`);
  if (r.budget) L.push(`BUDGET calls ${r.budget.calls}/${r.budget.limits.maxCalls}, cost ${r.budget.costUsd}/${r.budget.limits.maxCostUsd}, denied ${r.budget.denied}, tripped ${r.budget.tripped}${r.budget.trippedReason ? ` (${r.budget.trippedReason})` : ""}`);
  L.push("", "FLAGGED definitions / assumptions:", ...r.flags.map((f) => `  - ${f}`));
  if (r.stamp) L.push("", `*** ${r.stamp} ***`);
  return L.join("\n") + "\n";
}
