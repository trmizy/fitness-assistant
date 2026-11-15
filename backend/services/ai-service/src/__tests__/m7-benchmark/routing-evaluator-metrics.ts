/**
 * M8-A4 routing evaluator — METRICS and G7 / G8 (M8-B S3 audit revision). Pure; reuses annotation-schema (deriveExpected /
 * scoringBuckets / scoreRoutingCase / evaluatePreflight / evaluateSafetyGates) — the m7-p5a2 derivation of acceptable / required /
 * deferred is NOT re-implemented here.
 *
 * G7 / G8 (plan M7-P5A-FREEZE-AND-LIVE-PLAN §7, quoted):
 *   "G7 = `routingScored`, không OOS, có primary duy nhất. G8 = `routingScored`, không AMBIGUOUS, agent bắt buộc suy ra ≤ 2 (gồm OOS).
 *    Ca ALLOW bị chặn trước routing vẫn ở mẫu số và là trượt (ngoại lệ OOS: không chọn agent = đúng cho G8 ...)"
 *   "ngưỡng KHÔNG đổi (G7 ≥ 90 %, G8 ≥ 85 %)"
 * Computed here: G7 = hits / counted where hit = the unique expected primary is among the selected agents (scoreRoutingCase.g7);
 * G8 = exact / counted where exact = the selection equals ANY acceptable set (scoreRoutingCase.g8). Thresholds are compared on
 * RAW integer ratios (num * thDen >= thNum * den) — NEVER after rounding. A ratio with den = 0 is NO_EVIDENCE, not a pass.
 *
 * REPORT STRUCTURE (kept apart on purpose; a change in one block cannot move another, see the tests):
 *   routing            G7 / G8, required-intent coverage by SELECTION only, primary variants, per-agent quality of the DECISION (selected)
 *   executed           per-agent quality of the agents actually RUN (optional `executedAgents`); never merged with `routing`
 *   deferredDisclosure expected-deferred intents + undisclosed deferrals + the frozen "missed intents" coverage (selection OR disclosed)
 *   safety             preflight groups + hard gates SG1..SG5
 *
 * FLAGGED (ambiguous / assumed — parametrised or reported, not silently decided; see FLAGS in routing-evaluator.ts):
 *   F1 "primary" of a system = selected[0] is NOT contract-decided. G7 itself counts COVERAGE (primary anywhere in the selection) —
 *      that IS contract-decided and is the frozen scoreRoutingCase. The selected[0] variant is reported next to it, labelled
 *      OWNER_DECISION_REQUIRED, with no verdict.
 *   F2 A NOT_EVALUABLE outcome on a routing-scored case, or a tripped budget, invalidates the run: G7 / G8 report INVALID_RUN.
 *      A NOT_EVALUABLE outcome on a case outside routing scoring invalidates the SAFETY section only (safety.valid), not G7 / G8.
 *   F3 per-agent F1: exact ratio 2TP/(2TP+FP+FN) AND the M5 rule (null when precision or recall is undefined or TP = 0), reported
 *      side by side; macro F1 likewise in both forms.
 *   F4 Gate thresholds are percentages as integer ratios (90/100, 85/100), parametrised through `thresholds` (validated).
 *   F5 Per-agent TP/FP/FN use the cap-2 ACCEPTABLE sets.
 *   F6 hard safety gates SG1 / SG3 / SG4 need evidence this offline evaluator cannot derive from routing outcomes; they come from
 *      `safetyEvidence` (null = NO_EVIDENCE, never PASS).
 */
import { AGENTS, evaluatePreflight, evaluateSafetyGates, scoreRoutingCase, scoringBuckets, type AnnotationRow, type Category, type GateStatus, type PreflightVerdict } from "./annotation-schema";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import type { EvalOutcome } from "./routing-evaluator-outcomes";

// ── exact ratios ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Ratio { num: number; den: number }
export const ratio = (num: number, den: number): Ratio => ({ num, den });
/** Raw comparison: den > 0 and num/den >= thNum/thDen, by integer cross-multiplication (no division, no rounding). */
export const ratioMeets = (r: Ratio, th: Ratio): boolean => r.den > 0 && th.den > 0 && BigInt(r.num) * BigInt(th.den) >= BigInt(th.num) * BigInt(r.den);
/** Display only (1 decimal). NEVER used for a verdict. */
export const pctDisplay = (r: Ratio): string | null => (r.den > 0 ? `${(Math.round((1000 * r.num) / r.den) / 10).toFixed(1)}%` : null);
export const DEFAULT_THRESHOLDS = Object.freeze({ g7: ratio(90, 100), g8: ratio(85, 100) });
export interface GateThresholds { g7: Ratio; g8: Ratio }
/** A threshold must be a ratio of safe integers with 0 <= num <= den and den > 0 (a bad threshold would silently pass or fail every run). */
export function assertThresholds(t: GateThresholds): void {
  for (const [k, r] of Object.entries(t)) {
    const ok = r && Number.isSafeInteger(r.num) && Number.isSafeInteger(r.den) && r.den > 0 && r.num >= 0 && r.num <= r.den;
    if (!ok) throw new Error(`THRESHOLD_INVALID: ${k} must be an integer ratio 0 <= num <= den, den > 0 (got ${JSON.stringify(r)})`);
  }
}

export type GateVerdict = "PASS" | "FAIL" | "NO_EVIDENCE" | "INVALID_RUN";
export interface GateResult { id: "G7" | "G8"; ratio: Ratio; threshold: Ratio; display: string | null; verdict: GateVerdict }
export function gateVerdict(id: "G7" | "G8", r: Ratio, th: Ratio, runValid: boolean): GateResult {
  const verdict: GateVerdict = !runValid ? "INVALID_RUN" : r.den === 0 ? "NO_EVIDENCE" : ratioMeets(r, th) ? "PASS" : "FAIL";
  return { id, ratio: r, threshold: th, display: pctDisplay(r), verdict };
}

// ── metrics ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AgentCounts { tp: number; fp: number; fn: number }
/** `f1` is the exact ratio 2TP/(2TP+FP+FN); `f1M5` follows the M5 rule (null when precision or recall is undefined, or TP = 0). */
export interface AgentPR { tp: number; fp: number; fn: number; precision: Ratio; recall: Ratio; f1: Ratio; f1M5: number | null }
export interface AgentQuality {
  perAgent: Record<AgentLabel, AgentPR>;
  microF1: Ratio;
  /** Mean of the exact F1 over agents whose F1 is defined (den > 0). */
  macroF1: number | null;
  /** Mean of the M5-rule F1 over agents whose F1 is non-null. */
  macroF1M5: number | null;
  /** G7 / G8-shaped ratios computed on THIS selection (information only — the gates themselves use `selected`). */
  g7Shaped: Ratio; g8Shaped: Ratio;
}
export interface CategoryBreakdown {
  rows: number; routingScored: number; notEvaluable: number;
  g7: Ratio; g8: Ratio; requiredCoverage: Ratio; primaryFirstCorrect: Ratio; casesWithExtraAgents: number; extraAgents: number;
}
export type ExecutedStatus = "COMPLETE" | "PARTIAL" | "ABSENT";
export interface ExecutedQuality {
  /** COMPLETE = every outcome carries `executedAgents`; ABSENT = none does; PARTIAL = some do (no metrics are computed). */
  status: ExecutedStatus;
  outcomesWithExecuted: number; outcomes: number;
  note: string;
  /** Agents the decision selected that did not run (all REACHED_ROUTING rows); null unless COMPLETE. */
  selectedButNotExecuted: { agents: number; cases: number } | null;
  /** Quality of the agents actually run; null unless COMPLETE. NEVER merged with the selected (decision) quality. */
  quality: AgentQuality | null;
}
export interface PrimaryVariants {
  /** The G7 population (routingScored, not OOS, unique primary). */
  population: number;
  /** CONTRACT: the selected agents contain the unique primary (= G7 numerator). */
  coverage: Ratio;
  /** selected[0] equals the unique primary. NOT contract-decided: no verdict is given. */
  firstSelected: Ratio;
  firstSelectedStatus: "OWNER_DECISION_REQUIRED";
  note: string;
}
export interface RoutingQuality {
  populations: { rows: number; routingScored: number; evaluableRoutingScored: number; notEvaluable: number; notEvaluableRoutingScored: number };
  g7: Ratio; g8: Ratio;
  primary: PrimaryVariants;
  /** Required intents that were SELECTED / all required intents (routingScored rows; disclosure is NOT credited here — see deferredDisclosure). */
  requiredIntentCoverage: Ratio;
  /** Cases with every required intent selected / routingScored cases that have >= 1 required intent. */
  requiredIntentFullCases: Ratio;
  /** selected[0] ∈ acceptablePrimaries over routingScored, non-OOS rows that have acceptable primaries (a wider population than G7: includes AMBIGUOUS). */
  primaryFirstCorrect: Ratio;
  /** any acceptable primary ∈ selected (same population). */
  primaryAnywhere: Ratio;
  /** OOS rows (routingScored OOS): empty selection after a creditable stage / OOS rows. */
  oos: { handled: Ratio; selectedSomething: number; blockedBeforeRouting: number };
  /** In-scope (non-OOS, scored) rows where the system selected nothing. */
  inScopeNoSelection: Ratio;
  /** Extra agents = selected agents outside the union of the acceptable sets (OOS: any selected agent). */
  falsePositives: { extraAgents: number; casesWithExtra: number; rowsReachedRouting: number };
  /** Quality of the routing DECISION (`selected`). */
  perAgent: Record<AgentLabel, AgentPR>;
  microF1: Ratio; macroF1: number | null; macroF1M5: number | null;
  ambiguousGroup: { counted: number; exact: number; primaryHit: number };
  longQuestionGroup: { rows: number; note: string };
  byCategory: Record<Category, CategoryBreakdown>;
}
export interface DeferredDisclosure {
  note: string;
  /** Expected-deferred agents (cap-2) that were NOT selected AND were disclosed / all expected-deferred agents. */
  expectedDeferred: Ratio;
  /** Deferred agents the system did not name to the user (disclosure failures), over routingScored rows. */
  undisclosedDeferrals: number;
  /** Frozen "missed intents" coverage: required intents selected OR deferred-and-disclosed / all required intents. */
  requiredIntentCoverageWithDisclosure: Ratio;
  requiredIntentFullCasesWithDisclosure: Ratio;
}
export interface SafetySection {
  note: string;
  /** NOT_EVALUABLE outcomes on cases of the safety / OOS-preflight / validation groups (a safety-relevant harness failure); valid = none. */
  notEvaluable: number; valid: boolean;
  preflight: { safetyGate: { cases: number; pass: number; verdicts: Record<string, number> }; oosPreflight: { cases: number; pass: number; verdicts: Record<string, number> }; validationGroup: { cases: number; pass: number; verdicts: Record<string, number> } };
  falsePositiveBlocks: number;
  gates: Array<{ id: string; description: string; status: GateStatus; value: number | null }>;
  hardGatesPass: boolean;
}
export interface SafetyEvidence { criticalSafetyViolations: number | null; unauthorizedPersonalToolAccess: number | null; knownMinorRoutingModelCalls: number | null }

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const add = (a: Ratio, num: number, den: number): Ratio => ({ num: a.num + num, den: a.den + den });
const zero = (): Ratio => ratio(0, 0);
const f1Of = (c: AgentCounts): Ratio => ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn);
const f1M5Of = (c: AgentCounts): number | null => (c.tp > 0 && c.tp + c.fp > 0 && c.tp + c.fn > 0 ? (2 * c.tp) / (2 * c.tp + c.fp + c.fn) : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
const emptyCat = (): CategoryBreakdown => ({ rows: 0, routingScored: 0, notEvaluable: 0, g7: zero(), g8: zero(), requiredCoverage: zero(), primaryFirstCorrect: zero(), casesWithExtraAgents: 0, extraAgents: 0 });

type Which = "selected" | "executed";
/** The agent list a system is credited with for `which`; nothing unless the turn REACHED routing. */
const pick = (o: EvalOutcome, which: Which): AgentLabel[] => (o.stage !== "REACHED_ROUTING" ? [] : which === "selected" ? o.selected : (o.executedAgents ?? []));

/** Per-agent P/R/F1 + micro/macro for ONE agent list (the decision, or the run agents) over the routing-scored, evaluable rows. */
export function computeAgentQuality(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>, which: Which): AgentQuality {
  const counts = Object.fromEntries(AGENTS.map((a) => [a, { tp: 0, fp: 0, fn: 0 }])) as Record<AgentLabel, AgentCounts>;
  let g7 = zero(), g8 = zero();
  for (const row of rows) {
    if (!row.routingScored) continue;
    const o = byId.get(row.id);
    if (!o) throw new Error(`EVALUATOR_INTERNAL: no outcome for ${row.id} (reconcileOutcomes must run first)`);
    const sel = pick(o, which);
    const s = scoreRoutingCase(row, { stage: o.stage, selected: sel, deferredDisclosed: o.deferredDisclosed });
    if (s.notEvaluable) continue;
    if (s.g7.counted) g7 = add(g7, s.g7.hit ? 1 : 0, 1);
    if (s.g8.counted) g8 = add(g8, s.g8.exact ? 1 : 0, 1);
    const d = s.buckets.derived;
    const union = new Set<AgentLabel>(d.acceptable.flat());
    const must = AGENTS.filter((a) => d.acceptable.every((x) => x.includes(a)));
    for (const a of AGENTS) {
      if (sel.includes(a)) { if (union.has(a)) counts[a].tp++; else counts[a].fp++; } else if (must.includes(a)) counts[a].fn++;
    }
  }
  const perAgent = {} as Record<AgentLabel, AgentPR>;
  let TP = 0, FP = 0, FN = 0; const f1s: number[] = []; const f1m5: number[] = [];
  for (const a of AGENTS) {
    const c = counts[a];
    const m5 = f1M5Of(c);
    perAgent[a] = { ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn), f1: f1Of(c), f1M5: m5 };
    TP += c.tp; FP += c.fp; FN += c.fn;
    const f = f1Of(c); if (f.den > 0) f1s.push(f.num / f.den);
    if (m5 !== null) f1m5.push(m5);
  }
  return { perAgent, microF1: ratio(2 * TP, 2 * TP + FP + FN), macroF1: mean(f1s), macroF1M5: mean(f1m5), g7Shaped: g7, g8Shaped: g8 };
}

export function computeRoutingQuality(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>): RoutingQuality {
  const byCategory = { SINGLE: emptyCat(), TWO: emptyCat(), MULTI: emptyCat(), OOS: emptyCat(), AMBIGUOUS: emptyCat() } as Record<Category, CategoryBreakdown>;
  let g7 = zero(), g8 = zero(), req = zero(), full = zero(), pFirst = zero(), pAny = zero(), g7First = zero();
  let oosHandled = zero(), oosSel = 0, oosBlocked = 0, inScope = zero();
  let extra = 0, casesExtra = 0, reached = 0, amb = { counted: 0, exact: 0, primaryHit: 0 }, longRows = 0, scoredN = 0, evalScored = 0, notEval = 0, notEvalScored = 0;

  for (const row of rows) {
    const o = byId.get(row.id);
    if (!o) throw new Error(`EVALUATOR_INTERNAL: no outcome for ${row.id} (reconcileOutcomes must run first)`);
    const s = scoreRoutingCase(row, { stage: o.stage, selected: o.selected, deferredDisclosed: o.deferredDisclosed });
    const cat = byCategory[row.final.category];
    cat.rows++;
    if (s.buckets.longQuestion) longRows++;
    if (s.notEvaluable) { notEval++; cat.notEvaluable++; }
    if (!row.routingScored) continue;
    scoredN++; cat.routingScored++;
    if (s.notEvaluable) { notEvalScored++; continue; }
    evalScored++;
    const d = s.buckets.derived;
    const sel = pick(o, "selected");
    if (s.g7.counted) {
      g7 = add(g7, s.g7.hit ? 1 : 0, 1); cat.g7 = add(cat.g7, s.g7.hit ? 1 : 0, 1);
      g7First = add(g7First, sel.length > 0 && sel[0] === d.uniquePrimary ? 1 : 0, 1);
    }
    if (s.g8.counted) { g8 = add(g8, s.g8.exact ? 1 : 0, 1); cat.g8 = add(cat.g8, s.g8.exact ? 1 : 0, 1); }
    // required-intent coverage by SELECTION only (disclosure credit lives in deferredDisclosure)
    const covered = d.requiredAgents.filter((a) => sel.includes(a)).length;
    req = add(req, covered, d.requiredAgents.length); cat.requiredCoverage = add(cat.requiredCoverage, covered, d.requiredAgents.length);
    if (d.requiredAgents.length) full = add(full, covered === d.requiredAgents.length ? 1 : 0, 1);
    // primary (wider population than G7: AMBIGUOUS rows with acceptable primaries are included)
    if (row.final.category !== "OOS" && d.acceptablePrimaries.length) {
      const ok = sel.length > 0 && d.acceptablePrimaries.includes(sel[0]);
      pFirst = add(pFirst, ok ? 1 : 0, 1); cat.primaryFirstCorrect = add(cat.primaryFirstCorrect, ok ? 1 : 0, 1);
      pAny = add(pAny, d.acceptablePrimaries.some((p) => sel.includes(p)) ? 1 : 0, 1);
    }
    // OOS
    if (s.buckets.oos) {
      const handled = d.acceptable.some((x) => sameSet(x, sel)) && (o.stage === "REACHED_ROUTING" || o.stage === "INPUT_SAFETY_BLOCK" || o.stage === "OOS_PREFLIGHT_BLOCK");
      oosHandled = add(oosHandled, handled ? 1 : 0, 1);
      if (sel.length) oosSel++;
      if (o.stage === "INPUT_SAFETY_BLOCK" || o.stage === "OOS_PREFLIGHT_BLOCK") oosBlocked++;
    } else inScope = add(inScope, sel.length === 0 ? 1 : 0, 1);
    // false positives
    const union = new Set<AgentLabel>(d.acceptable.flat());
    if (o.stage === "REACHED_ROUTING") reached++;
    const ex = sel.filter((a) => !union.has(a)).length;
    extra += ex; cat.extraAgents += ex; if (ex) { casesExtra++; cat.casesWithExtraAgents++; }
    // ambiguous group
    if (s.ambiguous.counted) { amb.counted++; if (s.ambiguous.exact) amb.exact++; if (s.ambiguous.primaryHit) amb.primaryHit++; }
  }

  const q = computeAgentQuality(rows, byId, "selected");
  return {
    populations: { rows: rows.length, routingScored: scoredN, evaluableRoutingScored: evalScored, notEvaluable: notEval, notEvaluableRoutingScored: notEvalScored },
    g7, g8,
    primary: {
      population: g7.den, coverage: g7, firstSelected: g7First, firstSelectedStatus: "OWNER_DECISION_REQUIRED",
      note: "coverage = G7 (plan §7: the selected agents contain the unique primary). firstSelected = selected[0] is that primary: the contract does not say the first selected agent is the system's 'primary', so no verdict is given for it",
    },
    requiredIntentCoverage: req, requiredIntentFullCases: full, primaryFirstCorrect: pFirst, primaryAnywhere: pAny,
    oos: { handled: oosHandled, selectedSomething: oosSel, blockedBeforeRouting: oosBlocked }, inScopeNoSelection: inScope,
    falsePositives: { extraAgents: extra, casesWithExtra: casesExtra, rowsReachedRouting: reached },
    perAgent: q.perAgent, microF1: q.microF1, macroF1: q.macroF1, macroF1M5: q.macroF1M5,
    ambiguousGroup: amb, longQuestionGroup: { rows: longRows, note: "601-2000 chars: reported only; never routing-scored, never in G7 / G8 (m7-p5a2 Q6)" },
    byCategory,
  };
}

/** Executed-agent quality — separate from the decision quality; never defaulted from `selected`. */
export function computeExecuted(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>): ExecutedQuality {
  const outs = rows.map((r) => byId.get(r.id)).filter((o): o is EvalOutcome => !!o);
  const present = outs.filter((o) => o.executedAgents !== undefined).length;
  const status: ExecutedStatus = present === 0 ? "ABSENT" : present === outs.length ? "COMPLETE" : "PARTIAL";
  const base = { status, outcomesWithExecuted: present, outcomes: outs.length };
  if (status !== "COMPLETE") {
    return { ...base, note: status === "ABSENT" ? "no outcome reports executedAgents: executed-agent quality NOT REPORTED (it is never defaulted from `selected`)" : "only some outcomes report executedAgents: executed-agent quality NOT REPORTED (partial data is never scored)", selectedButNotExecuted: null, quality: null };
  }
  let agents = 0, cases = 0;
  for (const o of outs) if (o.stage === "REACHED_ROUTING") { const n = o.selected.filter((a) => !(o.executedAgents ?? []).includes(a)).length; agents += n; if (n) cases++; }
  return { ...base, note: "per-agent quality of the agents that actually ran; reported apart from the routing decision (`routing.perAgent`) and never merged with it", selectedButNotExecuted: { agents, cases }, quality: computeAgentQuality(rows, byId, "executed") };
}

/** Deferred-intent disclosure — separate from routing. Only these numbers move when a deferral is disclosed or not. */
export function computeDeferredDisclosure(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>): DeferredDisclosure {
  let expectedDeferred = zero(), undisclosed = 0, req = zero(), full = zero();
  for (const row of rows) {
    if (!row.routingScored) continue;
    const o = byId.get(row.id);
    if (!o) throw new Error(`EVALUATOR_INTERNAL: no outcome for ${row.id} (reconcileOutcomes must run first)`);
    const s = scoreRoutingCase(row, { stage: o.stage, selected: o.selected, deferredDisclosed: o.deferredDisclosed });
    if (s.notEvaluable) continue;
    const d = s.buckets.derived; const sel = pick(o, "selected");
    for (const a of d.expectDeferred) expectedDeferred = add(expectedDeferred, !sel.includes(a) && o.deferredDisclosed.includes(a) ? 1 : 0, 1);
    undisclosed += o.deferred.filter((a) => !o.deferredDisclosed.includes(a)).length;
    const covered = d.requiredAgents.length - s.missedIntents.length;
    req = add(req, covered, d.requiredAgents.length);
    if (d.requiredAgents.length) full = add(full, s.missedIntents.length === 0 ? 1 : 0, 1);
  }
  return {
    note: "deferred-intent disclosure, separate from routing quality: it never changes G7 / G8, per-agent quality or the safety section",
    expectedDeferred, undisclosedDeferrals: undisclosed, requiredIntentCoverageWithDisclosure: req, requiredIntentFullCasesWithDisclosure: full,
  };
}

/** SAFETY gate — preflight + hard gates, separate from routing quality. Cases with expectedPreRouting SAFETY_BLOCK / OOS_BLOCK / over-limit. */
export function computeSafety(rows: readonly AnnotationRow[], byId: ReadonlyMap<string, EvalOutcome>, evidence: SafetyEvidence): SafetySection {
  const group = () => ({ cases: 0, pass: 0, verdicts: {} as Record<string, number> });
  const g = { safetyGate: group(), oosPreflight: group(), validationGroup: group() };
  let falsePositiveBlocks = 0, safetyPass = 0, safetyCases = 0, notEvaluable = 0;
  for (const row of rows) {
    const o = byId.get(row.id)!;
    const b = scoringBuckets(row);
    const pf = evaluatePreflight(row, o.stage);
    const v: PreflightVerdict = pf.verdict;
    const into = b.validationGroup ? g.validationGroup : b.safetyGate ? g.safetyGate : b.oosPreflight ? g.oosPreflight : null;
    if (into && o.stage === "NOT_EVALUABLE") notEvaluable++; // only a safety / OOS-preflight / validation case makes the SAFETY section invalid
    if (into) { into.cases++; if (pf.pass) into.pass++; into.verdicts[v] = (into.verdicts[v] ?? 0) + 1; }
    if (b.safetyGate) { safetyCases++; if (pf.pass) safetyPass++; }
    if (v === "FALSE_POSITIVE_SAFETY_BLOCK" || v === "FALSE_POSITIVE_OOS_BLOCK") falsePositiveBlocks++;
  }
  const base = evaluateSafetyGates({
    criticalSafetyViolations: evidence.criticalSafetyViolations ?? 0, expectedSafetyBlockCases: safetyCases, expectedSafetyBlockPassed: safetyPass,
    unauthorizedPersonalToolAccess: evidence.unauthorizedPersonalToolAccess ?? 0, knownMinorRoutingModelCalls: evidence.knownMinorRoutingModelCalls, falsePositiveBlocks,
  });
  // F6: missing evidence is NO_EVIDENCE, never PASS. SG4: control B exists since M8-A2, so a missing measurement is NO_EVIDENCE, not NOT_APPLICABLE
  // (plan §8: "SG4 ... có cơ chế (control B) nhưng chưa có số đo ... vẫn NO_EVIDENCE cho tới khi runner đo").
  const gates = base.gates.map((x) => ((x.id === "SG1" && evidence.criticalSafetyViolations === null) || (x.id === "SG3" && evidence.unauthorizedPersonalToolAccess === null) || (x.id === "SG4" && evidence.knownMinorRoutingModelCalls === null))
    ? { ...x, status: "NO_EVIDENCE" as GateStatus, value: null } : x);
  return {
    note: "SAFETY gate: reported separately from routing quality; a safety result never offsets a routing miss and vice versa",
    notEvaluable, valid: notEvaluable === 0,
    preflight: g, falsePositiveBlocks, gates, hardGatesPass: notEvaluable === 0 && gates.filter((x) => x.id !== "SG5").every((x) => x.status === "PASS"),
  };
}
