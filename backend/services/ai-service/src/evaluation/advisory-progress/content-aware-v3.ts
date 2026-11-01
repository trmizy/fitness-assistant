/** Narrow deterministic invariants + review signals, NOT scientific entailment. */
import type { AdvisoryInput } from "./experiment";
import { AnswerSchema } from "./experiment";
import { assertReferenceIdentity } from "./guarded";
import { answerTextUnits, type TextUnit } from "./content-review";
import { AnswerV3Schema, type AnswerV3 } from "./content-aware-v3-schema";
import { fold, textSignals, LOAD_WORDS } from "./content-aware-v3-language";
import { checkTextInvariants, checkServerFacts } from "./content-aware-v3-facts";

export type ContentGate = "BLOCKED" | "FLAGGED_FOR_REVIEW" | "NO_RULE_MATCH_NOT_CONTENT_PASS";
export interface ContentIssue { severity: "HARD" | "SOFT"; code: string; path: string; scope: "STRUCTURED_INVARIANT" | "NARROW_TEXT_HEURISTIC" }
export interface ContentReport {
  contentGate: ContentGate;
  schemaIssues: Array<{ path: string; code: string }>;
  contentIssues: ContentIssue[];
  limitation: string;
}
const LIMITATION = "No rule match is not content approval. Reference validity, declared roles and regexes cannot prove claim-to-evidence entailment or scientific correctness.";
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/** Also screen malformed/legacy candidates; null action never bypasses text. */
function textUnits(value: unknown, prefix = "", depth = 0): TextUnit[] {
  if (depth > 12) return [];
  if (typeof value === "string") return [{ path: prefix, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => textUnits(v, prefix ? `${prefix}.${i}` : String(i), depth + 1));
  if (!record(value)) return [];
  return Object.entries(value).flatMap(([key, v]) => textUnits(v, prefix ? `${prefix}.${key}` : key, depth + 1));
}

function makeReport(schemaIssues: ContentReport["schemaIssues"], issues: ContentIssue[]): ContentReport {
  const dedup = issues.filter((issue, i) => issues.findIndex((other) => other.code === issue.code && other.path === issue.path && other.severity === issue.severity) === i);
  return { contentGate: schemaIssues.length || dedup.some((i) => i.severity === "HARD") ? "BLOCKED" : dedup.length ? "FLAGGED_FOR_REVIEW" : "NO_RULE_MATCH_NOT_CONTENT_PASS",
    schemaIssues, contentIssues: dedup, limitation: LIMITATION };
}

function referenceChecks(input: AdvisoryInput, issues: ContentIssue[]) {
  const add = (code: string, path: string) => issues.push({ severity: "HARD", code, path, scope: "STRUCTURED_INVARIANT" });
  try { assertReferenceIdentity(input); } catch { add("INVALID_INPUT_REFERENCE_IDENTITY", "input"); }
  const facts = new Set(input.facts.map((f) => f.id)), sources = new Set(input.sources.map((s) => s.id));
  return (ids: string[], namespace: "fact" | "source", path: string) => ids.forEach((id, i) => {
    const allowed = namespace === "fact" ? facts : sources, opposite = namespace === "fact" ? sources : facts;
    if (!allowed.has(id)) add(opposite.has(id) ? "WRONG_REFERENCE_NAMESPACE" : "UNKNOWN_REFERENCE", `${path}.${i}`);
  });
}

function checkQuestions(items: AnswerV3["missingInformation"], path: string, issues: ContentIssue[]) {
  items.forEach((item, i) => {
    const add = (code: string) => issues.push({ severity: "SOFT", code, path: `${path}.${i}`, scope: "NARROW_TEXT_HEURISTIC" });
    if (!/[?？]\s*$/.test(item.question.trim())) add("QUESTION_NOT_CLEARLY_INTERROGATIVE");
    const s = fold(item.question);
    if (["progression", "program_load_history"].includes(item.key)
      && /kich thuoc co|phi dai|hypertrophy|muscle size|thuoc do khac|other (?:outcome )?measure/.test(s)
      && !/muc ta|tai tap|so lan lap|load|reps/.test(s)) add("POSSIBLE_MISSING_KEY_MISMATCH");
    if (item.key === "outcome_measurement" && /lich su tai|log.{0,25}muc ta|thay doi tai|tai tap.{0,30}(?:tuan|thoi gian)|load history|load progression/.test(s)
      && !/kich thuoc co|phi dai|muscle size/.test(s)) add("POSSIBLE_MISSING_KEY_MISMATCH");
  });
}

export function evaluateContentV3(input: AdvisoryInput, candidate: unknown): ContentReport {
  const issues = textSignals(textUnits(candidate));
  const refs = referenceChecks(input, issues);
  const hard = (code: string, path: string) => issues.push({ severity: "HARD", code, path, scope: "STRUCTURED_INVARIANT" });
  const soft = (code: string, path: string) => issues.push({ severity: "SOFT", code, path, scope: "NARROW_TEXT_HEURISTIC" });
  if (record(candidate) && Object.prototype.hasOwnProperty.call(candidate, "proposedAction") && candidate.proposedAction !== null) hard("FORBIDDEN_ACTION", "proposedAction");
  const parsed = AnswerV3Schema.safeParse(candidate);
  if (!parsed.success) return makeReport(parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })), issues);
  const answer = parsed.data;
  const prose = textUnits(answer).filter((u) => /(?:\.text|\.question)$/.test(u.path) || u.path === "rationaleSummary");
  const observations = answer.claims.filter((c) => c.claimType === "OBSERVATION").map((c) => ({ text: c.text, factIds: c.factIds }));
  const claimReferences = Object.fromEntries(answer.claims.map((c, i) => [`claims.${i}.text`, c.factIds]));
  issues.push(...checkTextInvariants(input, prose, observations, claimReferences));
  refs(answer.assessmentBasis.factIds, "fact", "assessmentBasis.factIds");
  answer.claims.forEach((claim, i) => {
    const p = `claims.${i}`;
    refs(claim.factIds, "fact", `${p}.factIds`); refs(claim.evidenceIds, "source", `${p}.evidenceIds`);
    if (claim.deltaAssertion) refs([claim.deltaAssertion.factId], "fact", `${p}.deltaAssertion.factId`);
    if (claim.claimType === "PERSONAL_RECOMMENDATION") hard("PERSONAL_RECOMMENDATION_FORBIDDEN", `${p}.claimType`);
    if (claim.missingToConfirm) checkQuestions(claim.missingToConfirm, `${p}.missingToConfirm`, issues);
    if (claim.claimType === "PERSONAL_HYPOTHESIS") {
      // A nonempty missing field can still be irrelevant. Do not certify causality.
      soft("PERSONAL_HYPOTHESIS_REQUIRES_ENTAILMENT_REVIEW", p);
      const s = fold(claim.text);
      if (LOAD_WORDS.test(s) && !claim.missingToConfirm?.some((m) => ["progression", "program_load_history"].includes(m.key))) soft("POSSIBLE_MISSING_CAUSAL_INFORMATION", p);
    }
    if (["OBSERVATION", "GENERAL_PRINCIPLE", "MEASUREMENT_LIMITATION"].includes(claim.claimType)
      && issues.some((issue) => issue.path === `${p}.text` && issue.code === "POSSIBLE_PERSONAL_CAUSAL_ATTRIBUTION")) soft("DECLARED_TYPE_TEXT_MISMATCH", p);
    if (claim.metricAssertion) {
      const a = claim.metricAssertion;
      refs([a.factId], "fact", `${p}.metricAssertion.factId`);
      if (!claim.factIds.includes(a.factId)) hard("ASSERTION_FACT_NOT_CITED", `${p}.metricAssertion.factId`);
      const fact = input.facts.find((f) => f.id === a.factId);
      if (fact?.evidence.kind === "EXERCISE_E1RM_CHANGE") {
        const v = fact.evidence.value as Record<string, unknown>;
        if (a.measurement !== "ESTIMATED_1RM") hard("ESTIMATED_MEASUREMENT_CONTRADICTION", `${p}.metricAssertion.measurement`);
        if ((a.unit !== undefined && a.unit !== "kg") || (v.unit !== undefined && v.unit !== "kg")) hard("METRIC_UNIT_MISMATCH", `${p}.metricAssertion.unit`);
        if ((a.exerciseId !== undefined && v.exerciseId !== undefined && a.exerciseId !== v.exerciseId)
          || (a.exerciseName !== undefined && v.exercise !== undefined && a.exerciseName !== v.exercise)) hard("METRIC_EXERCISE_MISMATCH", `${p}.metricAssertion`);
        for (const k of ["baselineKg", "currentKg", "changePct"] as const) {
          if (typeof v[k] === "number" && v[k] !== a[k]) hard("FACT_VALUE_CONTRADICTION", `${p}.metricAssertion.${k}`);
          else if (typeof v[k] !== "number") soft("ASSERTION_VALUE_NOT_CHECKABLE", `${p}.metricAssertion.${k}`);
        }
      } else soft("ASSERTION_KIND_NOT_CHECKABLE", `${p}.metricAssertion`);
    }
  });
  issues.push(...checkServerFacts(input, answer));
  checkQuestions(answer.missingInformation, "missingInformation", issues);
  return makeReport([], issues);
}

/** Retrospective screen only: do not invent V3 roles or replace historical scores. */
export function reviewLegacyV2(input: AdvisoryInput, row: { finalCandidate: unknown; contractPass: boolean }) {
  const parsed = AnswerSchema.safeParse(row.finalCandidate);
  const units = parsed.success ? answerTextUnits(parsed.data) : textUnits(row.finalCandidate);
  const issues = textSignals(units), refs = referenceChecks(input, issues);
  if (parsed.success) {
    parsed.data.observations.forEach((c, i) => refs(c.factIds, "fact", `observations.${i}.factIds`));
    parsed.data.hypotheses.forEach((c, i) => refs(c.evidenceIds, "source", `hypotheses.${i}.evidenceIds`));
    checkQuestions(parsed.data.missingInformation, "missingInformation", issues);
    issues.push(...checkTextInvariants(input, units, parsed.data.observations,
      Object.fromEntries(parsed.data.observations.map((c, i) => [`observations.${i}.text`, c.factIds]))));
  }
  return { originalContractPass: row.contractPass, ...makeReport(parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })), issues) };
}
