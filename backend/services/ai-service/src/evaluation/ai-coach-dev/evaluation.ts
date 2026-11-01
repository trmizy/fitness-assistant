import { AnalysisEnvelopeSchema, type runDevSlice, type groundCandidate } from "./pipeline";
import { evaluateContentV3 } from "../advisory-progress/content-aware-v3";
import type { DevCase } from "./fixtures";
export const EVAL_PROTOCOL = {
  version: "ai-coach-controlled-ablation-v2", authority: "IMPLEMENTER_DEV_ONLY_NOT_HELD_OUT", modelEvaluation: "NOT_RUN",
  generationArms: ["FLAT_LAYOUT", "LAYERED", "LAYERED_CONTEXT", "LAYERED_CONTEXT_PLACEBO", "LAYERED_CONTEXT_RAG", "LAYERED_CONTEXT_WRONG_EXCERPT"],
  historicalReference: { arm: "V2_BASELINE", status: "HISTORICAL_MIGRATION_REFERENCE_NOT_CONTROLLED", base: "ea98576d", scoresReused: false },
  policies: ["MINIMAL", "FULL"], repetitions: 2,
  controls: "Same V3 envelope, validators, facts/history, sampling and policy variant. Arm-local source IDs only; no-RAG arms see none. Character-length placebo carries no extra facts/evidence; exact model token counts remain null until approved CountTokens preflight. Seed is a mock scheduling field, not a Bedrock parameter. GROUNDED_OFFLINE uses the same raw RAG candidate with zero generation.",
  metrics: {
    factualCorrectness: "Independent per-claim supported/contradicted/not-established labels; structured assertion identity/value checks are diagnostics only.",
    sourceSupport: "Exact excerpt support and scope labelled independently; valid reference is not entailment.",
    unsupportedPersonalClaims: "Unsupported individual claims / all individual claims, including conclusion/questions; unlabelled=null.",
    uncertainty: "Independent appropriate-abstention/overconfidence/underconfidence review; no probabilities or mock accuracy.",
    usefulness: "Blinded Likert 1-5: 1 misleading/unhelpful, 3 addresses observed measure and some unknowns, 5 intent answered with precise limits/follow-up.",
    coverage: "Report raw generated, raw contract eligible, post-gate eligible and blocked; blocked is never counted correct.",
    telemetry: "Real model tokens, latency and cost remain null until authorized model run.",
  },
  requirements: "Independent reviewer must author/approve 40 cases, reserve an unopened split, freeze labels outside generation inputs, then perform blinded paired scoring and repeated runs with intervals. No live run authorized.",
};
type Result = Awaited<ReturnType<typeof runDevSlice>> | ReturnType<typeof groundCandidate>;
export function measureDevResult(c: DevCase, result: Result) {
  const parsed = AnalysisEnvelopeSchema.safeParse(result.raw);
  const assertions = parsed.success ? parsed.data.analysis.claims.flatMap((claim) => claim.metricAssertion ? [claim.metricAssertion] : []) : [];
  const mismatches = assertions.filter((a) => {
    const value = result.input.facts.find((f) => f.id === a.factId)?.evidence.value;
    return !value || a.measurement !== "ESTIMATED_1RM" || a.baselineKg !== value.baselineKg || a.currentKg !== value.currentKg || a.changePct !== value.changePct;
  }).length;
  return {
    caseId: c.request.caseId, arm: result.arm, policy: result.policy, evidenceLabel: "TEST FIXTURE", modelEvaluation: "NOT_RUN",
    schemaValid: result.safetyHandling.action === "SAFETY_HANDLING_REQUIRED" ? null : parsed.success, referenceIssues: result.referenceIssues, citationReferenceIssues: result.citationReferenceIssues,
    factualConsistency: { structuredMetricsChecked: assertions.length, mismatches: assertions.length ? mismatches : null, correctness: null },
    sourceSupport: { referenceValidation: parsed.success ? "CHECKED_IDENTITY_ONLY" : "NOT_EVALUATED", semanticSupportedFraction: null, applicability: null },
    unsupportedPersonalClaims: { deterministicAlerts: parsed.success ? evaluateContentV3(result.input, parsed.data.analysis).contentIssues : null, independentlyLabelledRate: null },
    uncertaintyCalibration: null, usefulnessLikert: null, reviewer: null,
    modelTokens: null, modelLatencyMs: null, modelCost: null,
    postGateEligible: result.release === "DEV_REVIEW_ONLY", countedAsCorrect: null,
  };
}
