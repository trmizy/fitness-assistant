/**
 * Phase 4.7R — pure gate evaluation for the retrieval-grounding evaluator
 * (src/scripts/evaluateRagGrounding.ts). Extracted so the gate logic is unit-testable without Qdrant/Ollama.
 *
 * The thresholds are declared in the gold file BEFORE a run. Phase 4.7 printed the improvement threshold but never
 * EVALUATED it (it needs the baseline metrics, which the single-mode run did not have) — `evaluateGate` fixes that:
 * pass a baseline metrics object and the improvement check is part of `passAll`.
 */
export interface GateThresholds {
  topicHit_at3_inScope_min: number;
  relevantCuratedEvidence_at3_sciQueries_min: number;
  relevantCuratedEvidence_at3_improvement_over_baseline_min?: number;
  syntheticTop1Rate_noSynthQueries_max: number;
  duplicateRate_max: number;
  falseSourceRate_outOfScope_max: number;
  emptyRetrievalRate_inScope_max: number;
  /** optional per-domain floors on topicHit@3 (declared before the run), e.g. { "HYPERTROPHY": 0.5 } */
  domainFloors?: Record<string, number>;
  /** SAFE_ABSTENTION_EXPECTED items: share that either returned nothing or only trusted, relevant curated evidence */
  safeAbstention_success_min?: number;
  /** hard gate: SAFETY-domain items that returned anything other than trusted, relevant curated evidence (declared 0) */
  unsafeGenericSafetyFallthrough_max?: number;
  /** hard gate (4.7R4): personal/current high-risk or safety-uncertain narratives that received generic content as guidance (declared 0) */
  personalHighRiskGenericFallthrough_max?: number;
}

export interface GateMetrics {
  topicHit_at3_inScope: number | null;
  relevantCuratedEvidence_at3_sciQueries: number | null;
  syntheticTop1Rate_noSynthQueries: number | null;
  duplicateRate: number | null;
  falseSourceRate_outOfScope: number | null;
  emptyRetrievalRate_inScope: number | null;
  safeAbstention?: { n: number; success: number | null } | null;
  unsafeGenericSafetyFallthrough?: { n: number; count: number } | null;
  personalHighRiskGenericFallthrough?: { n: number; count: number } | null;
}

export interface GateResult {
  checks: Record<string, boolean>;
  improvement: { required: number | null; observed: number | null; evaluated: boolean };
  domainFloors: Record<string, { floor: number; observed: number | null; pass: boolean }>;
  /** every evaluated check passed (a check that could not be evaluated because its input is missing FAILS) */
  passAll: boolean;
  failed: string[];
}

export function evaluateGate(
  metrics: GateMetrics,
  th: GateThresholds,
  opts: { baseline?: { relevantCuratedEvidence_at3_sciQueries?: number | null } | null; byDomain?: Record<string, { topicHit_at3: number | null }> } = {},
): GateResult {
  const checks: Record<string, boolean> = {
    topicHit_at3_inScope: (metrics.topicHit_at3_inScope ?? -1) >= th.topicHit_at3_inScope_min,
    relevantCuratedEvidence_at3_sciQueries: (metrics.relevantCuratedEvidence_at3_sciQueries ?? -1) >= th.relevantCuratedEvidence_at3_sciQueries_min,
    syntheticTop1Rate_noSynthQueries: (metrics.syntheticTop1Rate_noSynthQueries ?? 2) <= th.syntheticTop1Rate_noSynthQueries_max,
    duplicateRate: (metrics.duplicateRate ?? 2) <= th.duplicateRate_max,
    falseSourceRate_outOfScope: (metrics.falseSourceRate_outOfScope ?? 2) <= th.falseSourceRate_outOfScope_max,
    emptyRetrievalRate_inScope: (metrics.emptyRetrievalRate_inScope ?? 2) <= th.emptyRetrievalRate_inScope_max,
  };

  const required = th.relevantCuratedEvidence_at3_improvement_over_baseline_min ?? null;
  const base = opts.baseline?.relevantCuratedEvidence_at3_sciQueries ?? null;
  const cur = metrics.relevantCuratedEvidence_at3_sciQueries;
  const evaluated = required !== null && base !== null && cur !== null;
  const observed = evaluated ? Math.round((cur! - base!) * 1000) / 1000 : null;
  if (required !== null) checks.improvement_over_baseline = evaluated ? observed! >= required : false;

  const domainFloors: GateResult["domainFloors"] = {};
  for (const [d, floor] of Object.entries(th.domainFloors ?? {})) {
    const obs = opts.byDomain?.[d]?.topicHit_at3 ?? null;
    const pass = obs !== null && obs >= floor;
    domainFloors[d] = { floor, observed: obs, pass };
    checks[`domainFloor_${d}`] = pass;
  }

  if (th.safeAbstention_success_min !== undefined) {
    const a = metrics.safeAbstention;
    checks.safeAbstention_success = !a || a.n === 0 ? false : (a.success ?? -1) >= th.safeAbstention_success_min;
  }

  if (th.unsafeGenericSafetyFallthrough_max !== undefined) {
    const u = metrics.unsafeGenericSafetyFallthrough;
    checks.unsafeGenericSafetyFallthrough = !u || u.n === 0 ? false : u.count <= th.unsafeGenericSafetyFallthrough_max;
  }

  if (th.personalHighRiskGenericFallthrough_max !== undefined) {
    const p = metrics.personalHighRiskGenericFallthrough;
    checks.personalHighRiskGenericFallthrough = !p || p.n === 0 ? false : p.count <= th.personalHighRiskGenericFallthrough_max;
  }

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return { checks, improvement: { required, observed, evaluated }, domainFloors, passAll: failed.length === 0, failed };
}
