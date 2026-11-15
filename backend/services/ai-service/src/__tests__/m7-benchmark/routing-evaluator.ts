/**
 * M8-A4 routing evaluator (schema "m7-p5a2"). OFFLINE. Input = a dataset that passes the EXISTING validator + exactly ONE outcome per
 * case. Output = a report (JSON + text) with routing quality, G7 / G8 on raw ratios, and the SAFETY section kept apart.
 * It never fabricates, repairs or defaults an outcome, and never says G7 / G8 were achieved on real data: a report built from a
 * synthetic dataset (marker, or any id starting "SYN-") carries the stamp below and `g7g8ResultClaimable: false`.
 */
import { createHash } from "node:crypto";
import { validateRoutingAnnotations, type Finding, type ValidateOptions } from "./annotation-validator";
import type { AnnotationRow } from "./annotation-schema";
import { reconcileOutcomes, type EvalOutcome, type OutcomeError } from "./routing-evaluator-outcomes";
import { DEFAULT_THRESHOLDS, computeRoutingQuality, computeSafety, gateVerdict, pctDisplay, type GateResult, type GateThresholds, type Ratio, type RoutingQuality, type SafetyEvidence, type SafetySection } from "./routing-evaluator-metrics";
import type { BudgetSnapshot } from "./routing-evaluator-budget";

export const SYNTHETIC_STAMP = "SYNTHETIC — not a G7/G8 result";
export const FLAGS: readonly string[] = Object.freeze([
  "F1 primary of a system = selected[0]; G7 counts coverage (primary anywhere in the selection) as the frozen scoreRoutingCase does; primaryFirstCorrect is reported separately",
  "F2 a NOT_EVALUABLE outcome or a tripped budget invalidates the run: G7 / G8 report INVALID_RUN, not a verdict",
  "F3 per-agent F1 = 2TP/(2TP+FP+FN); differs from M5 routingMetrics only where precision or recall is undefined",
  "F4 thresholds are integer percentage ratios (default 90/100 and 85/100), parametrised, compared raw (no rounding)",
  "F5 per-agent TP/FP/FN use the cap-2 acceptable sets",
  "F6 SG1 / SG3 / SG4 need external evidence (safetyEvidence); null = NO_EVIDENCE / NOT_APPLICABLE, never PASS",
  "F7 validator REVIEW items do not block evaluation; their count is reported",
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
}
export interface RoutingEvaluationReport {
  reportKind: "m7-p5a2-routing-evaluation";
  stamp: string | null;
  synthetic: boolean;
  g7g8ResultClaimable: boolean;
  system: string;
  schemaVersion: "m7-p5a2";
  datasetSha256: string;
  validation: { cases: number; reviewItems: number };
  run: { valid: boolean; notEvaluable: number; budgetTripped: boolean };
  gates: { G7: GateResult; G8: GateResult };
  routing: RoutingQuality;
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
  const synthetic = o.synthetic === true || rows.some((r) => /^SYN-/i.test(r.id));
  const routing = computeRoutingQuality(rows, byId);
  const budgetTripped = o.budget?.tripped === true;
  const valid = routing.populations.notEvaluable === 0 && !budgetTripped;
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, casesWithModelCall: 0 };
  for (const x of byId.values()) if (x.usage) { usage.modelCalls += x.usage.modelCalls; usage.inputTokens += x.usage.inputTokens; usage.outputTokens += x.usage.outputTokens; usage.costUsd += x.usage.costUsd; if (x.usage.modelCalls > 0) usage.casesWithModelCall++; }
  usage.costUsd = Math.round(usage.costUsd * 1e6) / 1e6;
  return {
    reportKind: "m7-p5a2-routing-evaluation", stamp: synthetic ? SYNTHETIC_STAMP : null, synthetic, g7g8ResultClaimable: !synthetic && valid,
    system: o.system, schemaVersion: "m7-p5a2", datasetSha256: o.datasetSha256 ?? "NOT_COMPUTED",
    validation: { cases: rows.length, reviewItems: o.reviewItems ?? 0 },
    run: { valid, notEvaluable: routing.populations.notEvaluable, budgetTripped },
    gates: { G7: gateVerdict("G7", routing.g7, th.g7, valid), G8: gateVerdict("G8", routing.g8, th.g8, valid) },
    routing, safety: computeSafety(rows, byId, o.safetyEvidence ?? { criticalSafetyViolations: null, unauthorizedPersonalToolAccess: null, knownMinorRoutingModelCalls: null }),
    usage, budget: o.budget ?? null, flags: FLAGS,
  };
}

/** Full path: validate the dataset (existing validator) -> reconcile outcomes (one per case) -> score. */
export function evaluateDataset(datasetJsonl: string, outcomes: readonly unknown[], o: EvaluateOptions): EvaluateResult {
  const v = validateRoutingAnnotations(datasetJsonl, o.validate ?? { checkDistribution: true, checkBenchmarkOverlap: true });
  if (!v.ok) return { ok: false, stage: "DATASET_INVALID", errors: v.errors };
  const rows = parseRows(datasetJsonl);
  const rec = reconcileOutcomes(rows.map((r) => r.id), outcomes, o.outcomeParseErrors ?? []);
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
  L.push(`run valid: ${r.run.valid} (notEvaluable ${r.run.notEvaluable}, budgetTripped ${r.run.budgetTripped}); g7g8ResultClaimable: ${r.g7g8ResultClaimable}`, "");
  L.push("GATES (raw integer ratios; the percentage is display only)");
  for (const g of [r.gates.G7, r.gates.G8]) L.push(`  ${g.id}: ${R(g.ratio)} vs threshold ${g.threshold.num}/${g.threshold.den} -> ${g.verdict}`);
  const q = r.routing;
  L.push("", "ROUTING QUALITY", `  required-intent coverage ${R(q.requiredIntentCoverage)}; cases fully covered ${R(q.requiredIntentFullCases)}`,
    `  primary first ∈ acceptablePrimaries ${R(q.primaryFirstCorrect)}; primary anywhere ${R(q.primaryAnywhere)}`,
    `  expected-deferred intents deferred+disclosed ${R(q.deferredIntents)}; undisclosed deferrals ${q.undisclosedDeferrals}`,
    `  OOS handled ${R(q.oos.handled)} (selected something ${q.oos.selectedSomething}, blocked before routing ${q.oos.blockedBeforeRouting}); in-scope with no selection ${R(q.inScopeNoSelection)}`,
    `  false positives: extra agents ${q.falsePositives.extraAgents} in ${q.falsePositives.casesWithExtra} cases (rows that reached routing ${q.falsePositives.rowsReachedRouting})`,
    `  micro F1 ${R(q.microF1)}; macro F1 ${q.macroF1 === null ? "n/a" : q.macroF1.toFixed(3)}`);
  for (const [a, p] of Object.entries(q.perAgent)) L.push(`    ${a}: tp ${p.tp} fp ${p.fp} fn ${p.fn} precision ${R(p.precision)} recall ${R(p.recall)}`);
  L.push(`  ambiguous group: counted ${q.ambiguousGroup.counted}, exact ${q.ambiguousGroup.exact}, primary hit ${q.ambiguousGroup.primaryHit}; long-question group rows ${q.longQuestionGroup.rows} (reported only)`, "  by category:");
  for (const [c, b] of Object.entries(q.byCategory)) L.push(`    ${c}: rows ${b.rows}, scored ${b.routingScored}, G7 ${R(b.g7)}, G8 ${R(b.g8)}, required ${R(b.requiredCoverage)}, extra agents ${b.extraAgents}`);
  const s = r.safety;
  L.push("", "SAFETY (separate from routing quality)");
  for (const [k, g] of Object.entries(s.preflight)) L.push(`  preflight ${k}: ${g.pass}/${g.cases} pass ${JSON.stringify(g.verdicts)}`);
  for (const g of s.gates) L.push(`  ${g.id} ${g.status}${g.value === null ? "" : ` (${g.value})`} — ${g.description}`);
  L.push(`  hard safety gates all PASS: ${s.hardGatesPass}; false-positive blocks ${s.falsePositiveBlocks}`);
  L.push("", `USAGE model calls ${r.usage.modelCalls} in ${r.usage.casesWithModelCall} cases; tokens in ${r.usage.inputTokens} out ${r.usage.outputTokens}; cost USD ${r.usage.costUsd}`);
  if (r.budget) L.push(`BUDGET calls ${r.budget.calls}/${r.budget.limits.maxCalls}, cost ${r.budget.costUsd}/${r.budget.limits.maxCostUsd}, denied ${r.budget.denied}, tripped ${r.budget.tripped}${r.budget.trippedReason ? ` (${r.budget.trippedReason})` : ""}`);
  L.push("", "FLAGGED definitions / assumptions:", ...r.flags.map((f) => `  - ${f}`));
  if (r.stamp) L.push("", `*** ${r.stamp} ***`);
  return L.join("\n") + "\n";
}
