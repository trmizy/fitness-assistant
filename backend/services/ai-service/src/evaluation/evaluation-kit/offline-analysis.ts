/** Provider-independent offline analysis. Never calls a model, embeds, reads a DB, or grants approval. */
import { z } from "zod";
import { ARMS, POLICY_VARIANTS, AnalysisEnvelopeSchema } from "../ai-coach-dev/pipeline";
import { attemptIdentity } from "../bedrock-pilot/design";
import { AdjudicationSchema, AnnotationSchema, ManifestSchema, ReviewerCaseSchema, annotationUnits, validateAnnotation, type createAnnotationPackets } from "./annotations";
import { digest } from "./identity";
import { cohensKappa, pairedClusterBootstrap, type Category, type CaseCell } from "./statistics";

type Packet = ReturnType<typeof createAnnotationPackets>["reviewers"][number];
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Authority = z.enum(["TEST_FIXTURE", "REVIEWER_ATTESTED"]);
export const AnalysisAttemptSchema = z.object({ attemptKey: Hash, caseKey: z.string(), arm: z.enum(ARMS), policy: z.enum(POLICY_VARIANTS), repeatIndex: z.number().int().min(0).max(49), configHash: Hash, promptHash: Hash }).strict();
const NullableNumber = z.number().finite().nonnegative().nullable();
export const OfflineAnalysisInputSchema = z.object({
  version: z.literal("offline-evaluation-v1"), purpose: z.enum(["TEST_FIXTURE", "INDEPENDENT_ANALYSIS"]), configHash: Hash,
  cases: z.array(z.object({ authority: Authority, manifest: ManifestSchema, sealed: z.object({ case: ReviewerCaseSchema, salt: Hash }).strict() }).strict()),
  schedule: z.array(AnalysisAttemptSchema), routedBeforeGeneration: z.number().int().nonnegative(),
  outputs: z.array(z.object({ attemptKey: Hash,
    raw: z.object({ candidate: z.unknown().refine((v) => v !== undefined, "ExplicitCandidateOrNullRequired"), text: z.string().nullable(), status: z.enum(["GENERATED", "FAILED"]), executionMode: z.enum(["FAKE", "LIVE"]), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), latencyMs: NullableNumber, estimatedUsd: NullableNumber }).strict(),
    postGate: z.object({ decision: z.enum(["ELIGIBLE", "BLOCKED", "FAILED"]), structuredInvariant: z.boolean(), narrowTextHeuristic: z.boolean() }).strict(),
    packet: z.custom<Packet>((v) => !!v && typeof v === "object" && "body" in v && "packetHash" in v),
  }).strict()),
  annotations: z.array(AnnotationSchema),
  adjudications: z.array(z.object({ authority: Authority, review: AdjudicationSchema, shouldBlock: z.boolean().nullable() }).strict()),
}).strict();
export type OfflineAnalysisInput = z.input<typeof OfflineAnalysisInputSchema>;
type Metric = { numerator: number; denominator: number; value: number | null };
const metric = (n = 0, d = 0): Metric => ({ numerator: n, denominator: d, value: d ? n / d : null });
const personal = new Set(["OBSERVATION", "PERSONAL_HYPOTHESIS", "MEASUREMENT_LIMITATION", "CONCLUSION"]);
const unitAxes = ["factualCorrectness", "sourceSupport", "unsupportedPersonalClaim", "uncertainty", "abstention", "personalApplicability", "unsupportedCausalInference"] as const;
type Axis = typeof unitAxes[number] | "usefulness";
type Row = { metadata: z.infer<typeof AnalysisAttemptSchema>; valid: boolean; released: boolean; qualified: boolean; values: Record<string, Metric>; gateTruth: boolean | null; scopes: { structuredInvariant: boolean; narrowTextHeuristic: boolean }; blocked: boolean };
function known(value: unknown): value is string | number | boolean { return value !== null && value !== undefined && value !== "NOT_EVALUATED"; }
function sumMetrics(rows: Row[], key: string) { return metric(rows.reduce((n, r) => n + r.values[key].numerator, 0), rows.reduce((n, r) => n + r.values[key].denominator, 0)); }
export function gateConfusion(rows: readonly { truth: boolean | null; blocked: boolean }[]) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) { if (r.truth === null) continue; if (r.truth) { if (r.blocked) tp++; else fn++; } else if (r.blocked) fp++; else tn++; }
  return { labelled: tp + fp + tn + fn, missing: rows.filter((r) => r.truth === null).length, tp, fp, tn, fn, sensitivity: metric(tp, tp + fn), specificity: metric(tn, tn + fp), precision: metric(tp, tp + fp) };
}
export function analyzeOffline(value: unknown, options: { resamples?: number; samplerSeed?: number } = {}) {
  const input = OfflineAnalysisInputSchema.parse(value);
  const cases = new Map(input.cases.map((c) => [c.manifest.caseKey, c]));
  if (cases.size !== input.cases.length) throw new Error("DuplicateFrozenCase");
  if (new Set(input.cases.map((c) => c.manifest.split)).size > 1) throw new Error("AnalyzeReviewedDevAndHeldOutSeparately");
  for (const c of input.cases) {
    const s = c.sealed, m = c.manifest;
    if (m.caseKey !== s.case.caseKey || m.split !== s.case.split || m.requestHash !== digest(s.case.request) || m.labelHash !== digest({ salt: s.salt, labels: s.case.labels }) || m.authorAttestationHash !== digest(s.case.author)) throw new Error("FrozenCaseOrLabelsChanged");
  }
  const schedule = new Map(input.schedule.map((m) => [m.attemptKey, m]));
  if (schedule.size !== input.schedule.length || input.schedule.some(({ attemptKey, ...m }) => attemptIdentity(m) !== attemptKey || m.configHash !== input.configHash || !cases.has(m.caseKey))) throw new Error("ScheduleIdentityMismatch");
  if (new Set(input.outputs.map((o) => o.attemptKey)).size !== input.outputs.length || new Set(input.outputs.map((o) => o.packet.packetHash)).size !== input.outputs.length) throw new Error("DuplicateOutputOrPacket");
  const packetIds = new Set(input.outputs.map((o) => o.packet.packetHash));
  if (input.annotations.some((a) => !packetIds.has(a.packetHash)) || input.adjudications.some((a) => !packetIds.has(a.review.packetHash))) throw new Error("UnknownAnnotationPacket");
  const rows: Row[] = [], disagreement: { attemptKey: string; unitId: string; axis: string; resolved: boolean }[] = [];
  const agreementPairs: Record<Axis, [Category, Category][]> = { factualCorrectness: [], sourceSupport: [], unsupportedPersonalClaim: [], uncertainty: [], abstention: [], personalApplicability: [], unsupportedCausalInference: [], usefulness: [] };
  let missingAnnotationRecords = 0, missingAxisJudgements = 0;
  for (const output of input.outputs) {
    const metadata = schedule.get(output.attemptKey); if (!metadata) throw new Error("OutputNotScheduled");
    const frozen = cases.get(metadata.caseKey)!, packet = output.packet, body = packet.body;
    const packetCandidate = output.raw.candidate ?? output.raw.text;
    if (!body || digest(body) !== packet.packetHash || body.candidateHash !== digest(packetCandidate) || digest(body.units) !== digest(annotationUnits(packetCandidate)) || body.question !== frozen.sealed.case.request.question || digest(body.facts) !== digest(frozen.sealed.case.request.snapshots.flatMap((s) => s.facts))) throw new Error("PacketRawOrCaseMismatch");
    const parsed = AnalysisEnvelopeSchema.safeParse(output.raw.candidate), valid = output.raw.status === "GENERATED";
    if ((valid && !parsed.success) || (output.postGate.decision === "ELIGIBLE" && !valid)) throw new Error("RawPostGateContractMismatch");
    const annotations = input.annotations.filter((a) => a.packetHash === packet.packetHash);
    if (new Set(annotations.map((a) => a.reviewerSlot)).size !== annotations.length || new Set(annotations.map((a) => a.reviewerPseudonym)).size !== annotations.length) throw new Error("DuplicateReviewer");
    for (const a of annotations) { if (!/^[A-Za-z0-9_-]+$/.test(a.reviewerPseudonym)) throw new Error("PseudonymRequired"); validateAnnotation(a, { ...packet, reviewerSlot: a.reviewerSlot }); }
    missingAnnotationRecords += 2 - annotations.length;
    const left = annotations.find((a) => a.reviewerSlot === "R1"), right = annotations.find((a) => a.reviewerSlot === "R2");
    const adjs = input.adjudications.filter((a) => a.review.packetHash === packet.packetHash); if (adjs.length > 1) throw new Error("DuplicateAdjudication");
    const adj = adjs[0];
    if (adj) {
      const keys = adj.review.decisions.map((d) => JSON.stringify([d.unitId, d.axis]));
      if (new Set(keys).size !== keys.length || adj.review.decisions.some((d) => d.axis === "usefulness" ? d.unitId !== "WHOLE_RESPONSE" : !body.units.some((u) => u.unitId === d.unitId))) throw new Error("AdjudicationUnitMismatch");
      if (annotations.some((a) => a.reviewerPseudonym === adj.review.adjudicatorPseudonym) || adj.review.adjudicatorPseudonym === frozen.sealed.case.author.pseudonym) throw new Error("IndependentAdjudicatorRequired");
    }
    const paired = !!left && !!right;
    const eligibleAuthority = paired && frozen.authority === "REVIEWER_ATTESTED" && annotations.every((a) => a.authority === "REVIEWER_ATTESTED" && a.reviewerPseudonym !== frozen.sealed.case.author.pseudonym);
    const qualified = input.purpose === "INDEPENDENT_ANALYSIS" && output.raw.executionMode === "LIVE" && eligibleAuthority;
    // Fixture arithmetic is an explicit diagnostic, never published semantic results.
    const calculate = qualified || input.purpose === "TEST_FIXTURE" && paired;
    function finalLabel(unitId: string, axis: Axis): unknown {
      const a = axis === "usefulness" ? left?.usefulness : left?.units.find((u) => u.unitId === unitId)?.[axis];
      const b = axis === "usefulness" ? right?.usefulness : right?.units.find((u) => u.unitId === unitId)?.[axis];
      if (!known(a)) missingAxisJudgements++; if (!known(b)) missingAxisJudgements++;
      if (calculate) agreementPairs[axis].push([known(a) ? a : null, known(b) ? b : null]);
      const decision = adj?.review.decisions.find((d) => d.unitId === unitId && d.axis === axis);
      const trustedDecision = decision && (input.purpose === "TEST_FIXTURE" || qualified && adj!.authority === "REVIEWER_ATTESTED");
      if (known(a) && known(b) && a !== b) disagreement.push({ attemptKey: metadata!.attemptKey, unitId, axis, resolved: !!trustedDecision && known(decision!.decision) });
      if (!calculate) return null;
      if (trustedDecision) return decision!.decision;
      return known(a) && a === b ? a : null;
    }
    const values: Record<string, Metric> = { unsupportedPersonalClaimRate: metric(), assessmentCorrectness: metric(), sourceSupport: metric(), appropriateAbstention: metric(), usefulness: metric() };
    for (const u of body.units) {
      const labels = Object.fromEntries(unitAxes.map((axis) => [axis, finalLabel(u.unitId, axis)]));
      if (valid && personal.has(u.type) && typeof labels.unsupportedPersonalClaim === "boolean") { values.unsupportedPersonalClaimRate.denominator++; values.unsupportedPersonalClaimRate.numerator += Number(labels.unsupportedPersonalClaim); }
      if (valid && ["SUPPORTED", "PARTIAL", "UNSUPPORTED"].includes(String(labels.sourceSupport))) { values.sourceSupport.denominator++; values.sourceSupport.numerator += Number(labels.sourceSupport === "SUPPORTED"); }
      if (valid && u.unitId === "CONCLUSION" && frozen.sealed.case.labels.appropriateAbstention && ["APPROPRIATE", "UNNECESSARY", "NEEDED_BUT_MISSING"].includes(String(labels.abstention))) values.appropriateAbstention = metric(Number(labels.abstention === "APPROPRIATE"), 1);
    }
    const usefulness = finalLabel("WHOLE_RESPONSE", "usefulness");
    if (valid && typeof usefulness === "number") values.usefulness = metric(usefulness, 1);
    if (calculate && valid && parsed.success && frozen.sealed.case.labels.expectedAssessment !== null) values.assessmentCorrectness = metric(Number(parsed.data.analysis.assessment === frozen.sealed.case.labels.expectedAssessment), 1);
    for (const key of Object.keys(values)) values[key] = metric(values[key].numerator, values[key].denominator);
    rows.push({ metadata, valid, released: valid && output.postGate.decision === "ELIGIBLE", qualified, values, blocked: output.postGate.decision === "BLOCKED", scopes: output.postGate,
      gateTruth: calculate && adj && (input.purpose === "TEST_FIXTURE" || adj.authority === "REVIEWER_ATTESTED") ? adj.shouldBlock : null });
  }
  const keys = ["unsupportedPersonalClaimRate", "assessmentCorrectness", "sourceSupport", "appropriateAbstention", "usefulness"];
  const aggregate = (selected: Row[]) => Object.fromEntries(keys.map((k) => [k, sumMetrics(selected, k)]));
  const raw = aggregate(rows), postGate = aggregate(rows.filter((r) => r.released));
  // Confusion requires valid generation and an actual BLOCKED/ELIGIBLE decision.
  const gateRows = rows.filter((r) => r.valid && (r.blocked || r.released));
  const agreement = Object.fromEntries(Object.entries(agreementPairs).map(([axis, pairs]) => [axis, cohensKappa(pairs, axis === "usefulness" ? [1, 2, 3, 4, 5] : undefined)]));
  const cells: (CaseCell & { metric: string })[] = [];
  const groups = new Map(input.schedule.map((m) => [JSON.stringify([m.caseKey, m.arm, m.policy]), m]));
  for (const m of groups.values()) for (const key of keys) { const s = rows.filter((r) => r.metadata.caseKey === m.caseKey && r.metadata.arm === m.arm && r.metadata.policy === m.policy); cells.push({ caseKey: m.caseKey, arm: m.arm, policy: m.policy, metric: key, value: sumMetrics(s, key).value }); }
  const contrasts = [["LAYERED", "FLAT_LAYOUT"], ["LAYERED_CONTEXT", "LAYERED_CONTEXT_PLACEBO"], ["LAYERED_CONTEXT", "LAYERED"], ["LAYERED_CONTEXT_RAG", "LAYERED_CONTEXT"], ["LAYERED_CONTEXT_RAG", "LAYERED_CONTEXT_WRONG_EXCERPT"]];
  const comparisons = input.purpose !== "INDEPENDENT_ANALYSIS" ? null : POLICY_VARIANTS.flatMap((policy) => contrasts.flatMap(([a, b]) => keys.map((key) => {
    const result = pairedClusterBootstrap(cells.filter((c) => c.metric === key), a, b, policy, options);
    if (result.caseCount < 20) { result.interval = null; result.reason = result.caseCount ? "EXPLORATORY_FEWER_THAN_20_CASES" : "NOT_EVALUATED"; }
    return { metric: key, ...result };
  })));
  const actual = input.purpose === "INDEPENDENT_ANALYSIS" ? input.outputs.filter((o) => o.raw.executionMode === "LIVE") : [];
  const telemetry = (field: "inputTokens" | "outputTokens" | "latencyMs" | "estimatedUsd") => { const values = actual.flatMap((o) => o.raw[field] === null ? [] : [o.raw[field]!]); return { observedSum: values.length ? values.reduce((a, b) => a + b, 0) : null, observedMean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, observed: values.length, missing: actual.length - values.length }; };
  const responseCount = input.outputs.filter((o) => o.raw.text !== null || o.raw.candidate !== null).length, eligible = rows.filter((r) => r.released).length;
  const substantive = rows.some((r) => r.qualified);
  return { status: substantive ? "INDEPENDENT_LABELS_ANALYZED_NOT_SCIENTIFIC_APPROVAL" : "NOT_EVALUATED", purpose: input.purpose, configHash: input.configHash, inputHash: digest(input), split: input.cases[0]?.manifest.split ?? null, scientificPass: null,
    denominators: { scheduled: input.schedule.length, routedBeforeGeneration: input.routedBeforeGeneration, rawRecorded: rows.length, rawResponded: responseCount, missingOutputs: input.schedule.length - rows.length, validGenerated: rows.filter((r) => r.valid).length, failed: rows.filter((r) => !r.valid).length, blockedValid: rows.filter((r) => r.valid && r.blocked).length, releasedValid: eligible, coverage: metric(eligible, responseCount), attemptRetention: metric(eligible, rows.length) },
    semantics: substantive ? { raw, postGate, gate: gateConfusion(gateRows.map((r) => ({ truth: r.gateTruth, blocked: r.blocked }))), gateByScope: Object.fromEntries(["structuredInvariant", "narrowTextHeuristic"].map((scope) => [scope, gateConfusion(gateRows.map((r) => ({ truth: r.gateTruth, blocked: r.scopes[scope as keyof typeof r.scopes] }))) ])), agreement } : null,
    fixtureCalculations: input.purpose === "TEST_FIXTURE" ? { authority: "TEST_FIXTURE_MATH_ONLY_NOT_MODEL_EVALUATION", raw, postGate, gate: gateConfusion(gateRows.map((r) => ({ truth: r.gateTruth, blocked: r.blocked }))), agreement } : null,
    pairedComparisons: comparisons, missingness: { annotationRecords: missingAnnotationRecords, axisJudgements: missingAxisJudgements, unresolvedDisagreements: disagreement.filter((d) => !d.resolved).length }, disagreements: disagreement,
    telemetry: { inputTokens: telemetry("inputTokens"), outputTokens: telemetry("outputTokens"), latencyMs: telemetry("latencyMs"), estimatedUsd: telemetry("estimatedUsd"), fakeAttemptsExcluded: input.outputs.length - actual.length },
    limitations: ["Reviewer attestations/pseudonyms require owner verification; hashes are integrity, not independent expertise", "Case clusters are assumed independent; repeated outputs are aggregated within case/arm/policy", "Complete-pair/available-label analysis may be biased by missingness; report all denominators", "No p-values, mixed-effects model, multiplicity correction or equivalence claim", "All six arms share structured output; no isolated structured-analysis effect", "No corpus scientific approval or model capability conclusion is granted"] };
}
