import { AnalysisEnvelopeSchema, type runDevSlice } from "./pipeline";
import { AnswerSchema } from "../advisory-progress/experiment";
import { evaluateContentV3 } from "../advisory-progress/content-aware-v3";
import type { DevCase } from "./fixtures";

export const EVAL_PROTOCOL = {
  version: "ai-coach-dev-protocol-v1", authority: "IMPLEMENTER_DEV_ONLY_NOT_HELD_OUT",
  modelEvaluation: "NOT_RUN", modelCalls: 0,
  factualConsistency: "Exact structured metric projection matches; prose entailment requires review. Report checked/mismatches, never full factual accuracy.",
  sourceSupport: "Report citation/excerpt identity validity separately. Independent review labels each claim SUPPORTED/PARTIAL/UNSUPPORTED/NOT_APPLICABLE with excerpt and applicability rationale; unreviewed=null.",
  unsupportedPersonalClaims: "V3 deterministic alerts only. Independent review counts unsupported individual claims / all individual claims, including rationale and questions; unreviewed=null.",
  uncertaintyCalibration: "DEV assessment label + required question coverage are proxies only. No probability calibration claim. Review overconfidence/appropriate abstention per case.",
  usefulness: { status: "PENDING_BLINDED_HUMAN_REVIEW", scale: [1, 2, 3, 4, 5], anchors: { 1: "Unhelpful or misleading", 3: "Explains observed measure and some missing data", 5: "Answers intent, distinguishes unknowns, asks specific non-prescriptive follow-up" } },
  experiment: "Pair all five arms by case, same facts/question/history (V2 receives adversarial conversation as untrustedText). All cases have profile.goal=null. Five-layer-only uses raw snapshots; built context adds namespace/absence labels, not extra facts. No RAG in V2 baseline. V2 and V3 output contracts differ, so this is a migration comparison, not a single-variable prompting ablation. RAG arms share corpus and retrieval IO; grounding changes release only. Frozen V2 scores are never reused as these new-case scores.",
  nextRealRun: "Requires separate model-call authorization, fixed provider/model/prompt/corpus versions, repeated paired runs, latency/tokens/cost, blinded independent labels, leakage audit and uncertainty intervals. Mock results cannot rank arms or establish improvement.",
};

export function measureDevResult(c: DevCase, result: Awaited<ReturnType<typeof runDevSlice>>) {
  const envelope = AnalysisEnvelopeSchema.safeParse(result.raw);
  const legacy = AnswerSchema.safeParse(result.raw);
  const answer = envelope.success ? envelope.data.analysis : legacy.success ? legacy.data : null;
  const assertions = envelope.success ? envelope.data.analysis.claims.flatMap((claim) => claim.metricAssertion ? [claim.metricAssertion] : []) : [];
  const mismatches = assertions.filter((a) => {
    const value = result.input.facts.find((f) => f.id === a.factId)?.evidence.value;
    return !value || a.measurement !== "ESTIMATED_1RM" || a.baselineKg !== value.baselineKg || a.currentKg !== value.currentKg || a.changePct !== value.changePct;
  }).length;
  const diagnostic = envelope.success ? evaluateContentV3(result.input, envelope.data.analysis) : null;
  const missing = new Set<string>(answer?.missingInformation.map((m) => m.key));
  return {
    caseId: c.request.caseId, arm: result.arm, evidenceLabel: "TEST FIXTURE", modelEvaluation: "NOT_RUN",
    schemaValid: result.schemaIssues.length === 0,
    factualConsistency: { structuredMetricsChecked: assertions.length, mismatches, proseSupport: null },
    sourceSupport: { referenceValidation: envelope.success ? "CHECKED_IDENTITY_ONLY" : "NOT_CHECKED_WITH_EXCERPT_CONTRACT", referenceIssues: envelope.success ? result.citationReferenceIssues : null, semanticSupportedFraction: null, applicability: null },
    unsupportedPersonalClaims: { deterministicAlerts: diagnostic?.contentIssues ?? null, independentlyLabelledRate: null },
    uncertaintyCalibration: { devAssessmentMatch: answer?.assessment === c.evaluationOnly.expectedAssessment, requiredQuestionsPresent: c.evaluationOnly.requiredMissing.every((k) => missing.has(k)), independentLabel: null },
    usefulnessLikert: null, reviewer: null, release: result.release,
  };
}
