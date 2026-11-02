import type { ClaimContext } from "./context";
import { textIdentity } from "../../knowledge/scientific-claim-map-v3/presentation";
import type { ClaimAnalysis } from "./pipeline";

type Unit = { path: string; text: string; kind: string; claimIndex?: number };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function units(raw: unknown): Unit[] {
  const a = record(raw) && record(raw.analysis) ? raw.analysis : null;
  if (!a) return [{ path: "raw", text: typeof raw === "string" ? raw : "[invalid non-text output]", kind: "INVALID_OUTPUT" }];
  const found: Unit[] = [];
  const questions = (value: unknown, path: string) => { if (Array.isArray(value)) value.forEach((q, i) => { if (record(q) && typeof q.question === "string") found.push({ path: `${path}.${i}.question`, text: q.question, kind: "QUESTION_REQUIRES_CONTENT_REVIEW" }); }); };
  if (Array.isArray(a.claims)) a.claims.forEach((c, i) => {
    if (record(c) && typeof c.text === "string") found.push({ path: `claims.${i}.text`, text: c.text, kind: String(c.claimType), claimIndex: i });
    if (record(c)) questions(c.missingToConfirm, `claims.${i}.missingToConfirm`);
  });
  if (typeof a.rationaleSummary === "string") found.push({ path: "rationaleSummary", text: a.rationaleSummary, kind: "CONCLUSION" });
  questions(a.missingInformation, "missingInformation");
  return found;
}

/** No prose entailment model or scientific regex. Account for every text unit, including unlinked prose. */
export function assessTextUnits(context: ClaimContext, raw: unknown, envelope: ClaimAnalysis | null, identityIssues: string[]) {
  const support = units(raw).map(unit => {
    const c = unit.claimIndex === undefined ? undefined : envelope?.analysis.claims[unit.claimIndex];
    const link = envelope?.claimLinks.find(l => l.claimIndex === unit.claimIndex);
    const known = context.retrieval.matches.find(m => m.claim.id === link?.knowledgeClaimId);
    const signal = known ? textIdentity(unit.text, known.claim) : "NO_EXACT_MATCH" as const;
    // Only compare structured copied metrics. An assertion's correctness never verifies arbitrary prose beside it.
    const m = c?.metricAssertion, fact = context.personal.facts.find(f => f.id === m?.factId);
    const eligible = !!m && !!fact && c?.claimType === "OBSERVATION" && c.factIds.includes(fact.id)
      && ["SUFFICIENT", "PARTIAL"].includes(fact.evidence.quality) && fact.evidence.kind === "EXERCISE_E1RM_CHANGE";
    const comparable = eligible && ["baselineKg", "currentKg", "changePct"].every(key => typeof fact!.evidence.value[key] === "number");
    const metricMatches = comparable && m!.measurement === "ESTIMATED_1RM"
      && ["baselineKg", "currentKg", "changePct"].every(key => fact!.evidence.value[key] === m![key as "baselineKg"])
      && (m!.unit === undefined || m!.unit === "kg") && (fact!.evidence.value.unit === undefined || fact!.evidence.value.unit === "kg")
      && (m!.exerciseId === undefined || m!.exerciseId === fact!.evidence.value.exerciseId)
      && (m!.exerciseName === undefined || m!.exerciseName === fact!.evidence.value.exercise);
    const structuredStatus = !comparable ? "NOT_EVALUATED" as const : metricMatches ? "VERIFIED_METRIC_COPY_COMPARISON" as const : "CONTRADICTED" as const;
    const exactGeneral = c?.claimType === "GENERAL_PRINCIPLE" && !!known && signal !== "NO_EXACT_MATCH" && identityIssues.length === 0;
    const status = structuredStatus === "CONTRADICTED" ? "CONTRADICTED_STRUCTURED_ASSERTION" as const
      : exactGeneral ? "CANONICAL_GENERAL_TEXT_IDENTITY" as const
      : c?.factIds.length || c?.claimType === "PERSONAL_HYPOTHESIS" ? "UNKNOWN_PERSONAL_APPLICABILITY" as const : "UNKNOWN_ENTAILMENT" as const;
    return { ...unit, status, textIdentity: signal, evidenceIdentity: !envelope ? "NOT_EVALUATED" : known ? identityIssues.length ? "INVALID" : "VALID" : "NO_EVIDENCE_LINK",
      structuredVerification: { status: structuredStatus, factId: comparable ? fact!.id : null, scope: "METRIC_FIELDS_ONLY_NOT_NARRATIVE_OR_MEASURED_STRENGTH" },
      verifiedSupport: exactGeneral ? "OWNER_ACCEPTED_GENERAL_WORDING_ONLY" : "UNVERIFIED", scientificSupport: "UNKNOWN" as const, personalSupport: "UNKNOWN" as const,
      reason: exactGeneral ? "Exact canonical/display identity with valid bound references; independent entailment and personal application are not established."
        : structuredStatus === "CONTRADICTED" ? "Structured metric fields contradict the trusted projection; prose still requires review."
        : "No deterministic fact-to-prose/scientific entailment verification, including unlinked observations, conclusions and question content." };
  });
  const unverifiedClaims = support.filter(s => s.verifiedSupport === "UNVERIFIED");
  return { support, unverifiedClaims, coverage: { reviewableTextUnits: support.length, accountedTextUnits: support.length,
    canonicalGeneralTextIdentity: support.filter(s => s.status === "CANONICAL_GENERAL_TEXT_IDENTITY").length,
    unverifiedTextUnits: unverifiedClaims.length, structuredMetricsVerified: support.filter(s => s.structuredVerification.status === "VERIFIED_METRIC_COPY_COMPARISON").length,
    independentlyVerifiedScientificClaims: null } };
}
