/**
 * M7-P5A.1 - INTER-ANNOTATOR AGREEMENT metrics for the future human-labelled routing dataset (schema "m7-p5a1").
 *
 * INPUT CONTRACT (read before use): `pairs[i].a` / `.b` MUST be the ORIGINAL, INDEPENDENT labels of annotator A and
 * annotator B, captured BEFORE any adjudication. This function has no access to adjudicated / final labels BY DESIGN.
 * A report computed from adjudicated or final labels (row.final, adjudication.decision) must NEVER be used to claim
 * the annotators agreed - after adjudication agreement is 100% by construction and says nothing about the guide.
 *
 * Pure: no I/O, no network, no model; never mutates its input.
 *
 * Definitions
 *  - "agent set" of a label = the agents in `domains`. For AMBIGUOUS labels (domains = []) it is the UNION of agents
 *    across interpretations. AMBIGUOUS cases are listed in `ambiguousIds`; every metric is reported twice:
 *    `withAmbiguous` (ambiguous cases included, union semantics) and `excludingAmbiguous` (second block).
 *  - Cohen's kappa = (p_o - p_e) / (1 - p_e); p_o = share of exact matches, p_e = sum_k pA(k) * pB(k).
 *    When 1 - p_e = 0 (e.g. a variable constant for both annotators) kappa is `undefined` with a `reason` - never
 *    coerced to 1 or 0. n = 0 -> everything undefined.
 *  - PABAK = 2 * p_o - 1 for binary metrics: a prevalence-robust companion, NOT a replacement for kappa.
 *  - Ordered first-two = the agents that would RUN (deriveExpected(label).acceptable[0], first MAX_EXECUTING_AGENTS),
 *    compared as sets (for AMBIGUOUS: union of all acceptable sets). The position-1 domain is covered by primary.
 *  - Full ordered list = same agents, same order, same roles (+ supports); AMBIGUOUS: interpretations compared as a
 *    multiset (rationale ignored).
 *  - Primary for AMBIGUOUS labels is null by schema, so the interpretations' primaries are only compared in the
 *    full-ordered metric; read the excludingAmbiguous block for a clean primary agreement.
 */
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import { AGENTS, CATEGORIES, PRE_ROUTING_VALUES, SAFETY_VALUES, deriveExpected, type CaseLabel, type DomainLabel, type Interpretation } from "./annotation-schema";

export interface KappaResult {
  /** undefined (with `reason`) when 1 - p_e = 0 or n = 0. */
  value: number | undefined;
  reason?: string;
  n: number;
  p_o: number | undefined;
  p_e: number | undefined;
}
export interface PctMetric { percent: number | undefined; agree: number; n: number }
export interface CategoricalMetric extends PctMetric { kappa: KappaResult }
export interface Prevalence { count: number; share: number | undefined }
export type PrevalenceTable = Record<string, { A: Prevalence; B: Prevalence; pooled: Prevalence }>;
export interface BinaryMetric extends CategoricalMetric {
  /** 2x2 counts: aYesBYes, aYesBNo, aNoBYes, aNoBNo. */
  counts: { aYesBYes: number; aYesBNo: number; aNoBYes: number; aNoBNo: number };
  prevalence: { A: number | undefined; B: number | undefined; pooled: number | undefined };
  /** PABAK = 2 * p_o - 1 (prevalence-adjusted bias-adjusted kappa) - companion to kappa, not a substitute. */
  pabak: number | undefined;
}
export interface AgreementBlock {
  n: number;
  perAgentKappa: Record<AgentLabel, BinaryMetric>;
  macroKappa: { value: number | undefined; definedCount: number; undefinedCount: number; reason?: string };
  exactRequiredSet: PctMetric;
  orderedFirstTwo: PctMetric;
  fullOrderedList: PctMetric;
  primary: CategoricalMetric;
  category: CategoricalMetric;
  safety: CategoricalMetric;
  expectedPreRouting: CategoricalMetric;
  oos: BinaryMetric;
  prevalence: { primary: PrevalenceTable; category: PrevalenceTable; safety: PrevalenceTable; expectedPreRouting: PrevalenceTable };
  /** metric name (e.g. "primary", "agent:training", "exactRequiredSet") -> ids that disagree, input order. */
  disagreements: Record<string, string[]>;
}
export interface AgreementReport {
  n: number;
  /** Ids whose A or B label is AMBIGUOUS (their agent set is the union across interpretations). */
  ambiguousIds: string[];
  withAmbiguous: AgreementBlock;
  excludingAmbiguous: AgreementBlock;
}
export type AgreementPair = { id: string; a: CaseLabel; b: CaseLabel };

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ratio = (num: number, den: number): number | undefined => (den === 0 ? undefined : num / den);
const pct = (num: number, den: number): number | undefined => (den === 0 ? undefined : (100 * num) / den);

function agentSet(label: CaseLabel): AgentLabel[] {
  if (label.category === "AMBIGUOUS") {
    const out = new Set<AgentLabel>();
    for (const it of label.interpretations ?? []) for (const d of it.domains) out.add(d.agent);
    return [...out];
  }
  return [...new Set(label.domains.map((d) => d.agent))];
}
const setKey = (xs: readonly string[]) => [...xs].sort().join("|");
const canonDomain = (d: DomainLabel) => `${d.agent}:${d.role}:${d.supports ?? ""}`;
const canonInterp = (i: Interpretation) => `${i.primaryAgent}|${i.domains.map(canonDomain).join(",")}`;
const orderedKey = (l: CaseLabel) => `${l.domains.map(canonDomain).join(",")}#${(l.interpretations ?? []).map(canonInterp).sort().join(";")}`;
/** Agents that would run. AMBIGUOUS: union over all acceptable sets. */
function firstTwoSet(l: CaseLabel): string[] {
  return [...new Set(deriveExpected(l).acceptable.flat())];
}

export function kappaOf(pairs: ReadonlyArray<readonly [string, string]>, universe: readonly string[]): KappaResult {
  const n = pairs.length;
  if (n === 0) return { value: undefined, reason: "n = 0: no cases", n, p_o: undefined, p_e: undefined };
  const p_o = pairs.filter(([x, y]) => x === y).length / n;
  const labels = new Set<string>(universe);
  for (const [x, y] of pairs) { labels.add(x); labels.add(y); }
  let p_e = 0;
  for (const k of labels) p_e += (pairs.filter(([x]) => x === k).length / n) * (pairs.filter(([, y]) => y === k).length / n);
  if (1 - p_e < 1e-12) return { value: undefined, reason: "1 - p_e = 0: chance agreement is total (variable is constant for both annotators), kappa is not defined", n, p_o, p_e };
  return { value: (p_o - p_e) / (1 - p_e), n, p_o, p_e };
}

function categorical(pairs: ReadonlyArray<readonly [string, string]>, universe: readonly string[]): CategoricalMetric {
  const agree = pairs.filter(([x, y]) => x === y).length;
  return { percent: pct(agree, pairs.length), agree, n: pairs.length, kappa: kappaOf(pairs, universe) };
}

function binary(vals: ReadonlyArray<readonly [boolean, boolean]>): BinaryMetric {
  const n = vals.length;
  const c = { aYesBYes: 0, aYesBNo: 0, aNoBYes: 0, aNoBNo: 0 };
  for (const [x, y] of vals) { if (x && y) c.aYesBYes++; else if (x) c.aYesBNo++; else if (y) c.aNoBYes++; else c.aNoBNo++; }
  const base = categorical(vals.map(([x, y]) => [x ? "yes" : "no", y ? "yes" : "no"] as const), ["yes", "no"]);
  const pA = c.aYesBYes + c.aYesBNo, pB = c.aYesBYes + c.aNoBYes;
  const p_o = base.kappa.p_o;
  return {
    ...base, counts: c,
    prevalence: { A: ratio(pA, n), B: ratio(pB, n), pooled: ratio(pA + pB, 2 * n) },
    pabak: p_o === undefined ? undefined : 2 * p_o - 1,
  };
}

function prevalenceTable(pairs: ReadonlyArray<readonly [string, string]>, universe: readonly string[]): PrevalenceTable {
  const n = pairs.length;
  const keys = new Set<string>(universe);
  for (const [x, y] of pairs) { keys.add(x); keys.add(y); }
  const out: PrevalenceTable = {};
  for (const k of keys) {
    const a = pairs.filter(([x]) => x === k).length, b = pairs.filter(([, y]) => y === k).length;
    out[k] = { A: { count: a, share: ratio(a, n) }, B: { count: b, share: ratio(b, n) }, pooled: { count: a + b, share: ratio(a + b, 2 * n) } };
  }
  return out;
}

function block(pairs: ReadonlyArray<AgreementPair>): AgreementBlock {
  const n = pairs.length;
  const dis: Record<string, string[]> = {};
  const note = (metric: string, ok: boolean, id: string) => { (dis[metric] ??= []); if (!ok) dis[metric].push(id); };

  const perAgent = {} as Record<AgentLabel, BinaryMetric>;
  for (const ag of AGENTS) {
    perAgent[ag] = binary(pairs.map((p) => [agentSet(p.a).includes(ag), agentSet(p.b).includes(ag)] as const));
    for (const p of pairs) note(`agent:${ag}`, agentSet(p.a).includes(ag) === agentSet(p.b).includes(ag), p.id);
  }
  const defined = AGENTS.map((ag) => perAgent[ag].kappa.value).filter((v): v is number => v !== undefined);
  const macroKappa = {
    value: defined.length ? defined.reduce((s, v) => s + v, 0) / defined.length : undefined,
    definedCount: defined.length, undefinedCount: AGENTS.length - defined.length,
    ...(defined.length ? {} : { reason: "no per-agent kappa is defined" }),
  };

  const pctOf = (metric: string, eq: (p: AgreementPair) => boolean): PctMetric => {
    let agree = 0;
    for (const p of pairs) { const ok = eq(p); if (ok) agree++; note(metric, ok, p.id); }
    return { percent: pct(agree, n), agree, n };
  };
  const exactRequiredSet = pctOf("exactRequiredSet", (p) => setKey(agentSet(p.a)) === setKey(agentSet(p.b)));
  const orderedFirstTwo = pctOf("orderedFirstTwo", (p) => setKey(firstTwoSet(p.a)) === setKey(firstTwoSet(p.b)));
  const fullOrderedList = pctOf("fullOrderedList", (p) => orderedKey(p.a) === orderedKey(p.b));

  const cat = (metric: string, get: (l: CaseLabel) => string, universe: readonly string[]) => {
    const vals = pairs.map((p) => [get(p.a), get(p.b)] as const);
    for (const [i, p] of pairs.entries()) note(metric, vals[i][0] === vals[i][1], p.id);
    return { metric: categorical(vals, universe), prev: prevalenceTable(vals, universe) };
  };
  const primary = cat("primary", (l) => l.primaryAgent ?? "null", [...AGENTS, "null"]);
  const category = cat("category", (l) => l.category, CATEGORIES);
  const safety = cat("safety", (l) => l.safety, SAFETY_VALUES);
  const pre = cat("expectedPreRouting", (l) => l.expectedPreRouting, PRE_ROUTING_VALUES);
  const oos = binary(pairs.map((p) => [p.a.category === "OOS", p.b.category === "OOS"] as const));
  for (const p of pairs) note("oos", (p.a.category === "OOS") === (p.b.category === "OOS"), p.id);

  return {
    n, perAgentKappa: perAgent, macroKappa, exactRequiredSet, orderedFirstTwo, fullOrderedList,
    primary: primary.metric, category: category.metric, safety: safety.metric, expectedPreRouting: pre.metric, oos,
    prevalence: { primary: primary.prev, category: category.prev, safety: safety.prev, expectedPreRouting: pre.prev },
    disagreements: dis,
  };
}

/** See the header: pass ORIGINAL pre-adjudication labels only. */
export function computeAgreement(pairs: ReadonlyArray<{ id: string; a: CaseLabel; b: CaseLabel }>): AgreementReport {
  const isAmb = (p: AgreementPair) => p.a.category === "AMBIGUOUS" || p.b.category === "AMBIGUOUS";
  return {
    n: pairs.length,
    ambiguousIds: pairs.filter(isAmb).map((p) => p.id),
    withAmbiguous: block(pairs),
    excludingAmbiguous: block(pairs.filter((p) => !isAmb(p))),
  };
}
