/** Checks server projections and bounded numeric grammar, never model metadata as truth. */
import type { AdvisoryInput, Answer } from "./experiment";
import { checkAnswer } from "./experiment";
import type { AnswerV3 } from "./content-aware-v3-schema";
import type { ContentIssue } from "./content-aware-v3";
import type { TextUnit } from "./content-review";
import { fold, MUSCLE_WORDS, STRENGTH_WORDS, uncertaintyBefore } from "./content-aware-v3-language";

const numeric = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));
const metrics = (input: AdvisoryInput) => input.facts.filter((f) => f.evidence.kind === "EXERCISE_E1RM_CHANGE"
  && typeof f.evidence.value.baselineKg === "number" && typeof f.evidence.value.currentKg === "number")
  .map((f) => ({ id: f.id, baseline: f.evidence.value.baselineKg as number, current: f.evidence.value.currentKg as number,
    exercise: typeof f.evidence.value.exercise === "string" ? f.evidence.value.exercise : null }));
const issue = (severity: ContentIssue["severity"], code: string, path: string): ContentIssue => ({ severity, code, path, scope: "STRUCTURED_INVARIANT" });

export function checkTextInvariants(input: AdvisoryInput, units: TextUnit[], observations: Answer["observations"]): ContentIssue[] {
  const result: ContentIssue[] = [];
  const adapter = (text: string): Answer => ({ assessment: "INSUFFICIENT_DATA", observations, hypotheses: [], missingInformation: [], rationaleSummary: text, proposedAction: null });
  if (checkAnswer(input, adapter("")).includes("facts_not_addressed")) result.push(issue("HARD", "FACTS_NOT_ADDRESSED", "claims"));
  const allowed = new Set(numeric(JSON.stringify({ facts: input.facts, sources: input.sources })));
  for (const unit of units) {
    const codes = checkAnswer(input, adapter(unit.text));
    if (codes.includes("unmapped_url")) {
      const urls = unit.text.match(/https?:\/\/[^\s<>"”]+/gi) ?? [];
      if (urls.some((url) => !input.sources.some((s) => s.url === url.replace(/[.,;)]*$/, "")))) result.push(issue("HARD", "UNMAPPED_URL", unit.path));
    }
    const extra = new Set(codes.filter((c) => c.startsWith("number_not_in_input:")).map((c) => Number(c.slice("number_not_in_input:".length))));
    // Only explicit binary equations over input operands are an authorized
    // arithmetic grammar. No eval, invented operands, rounding policy or clinical formula.
    const derivationSpans: Array<{ start: number; end: number }> = [];
    for (const m of unit.text.matchAll(/(\d+(?:[.,]\d+)?)\s*([+*/-])\s*(\d+(?:[.,]\d+)?)\s*=\s*(-?\d+(?:[.,]\d+)?)/g)) {
      const a = Number(m[1].replace(",", ".")), b = Number(m[3].replace(",", ".")), out = Number(m[4].replace(",", "."));
      if (!allowed.has(a) || !allowed.has(b)) {
        result.push(issue("SOFT", "NUMERIC_DERIVATION_UNVERIFIED", unit.path));
      } else {
        const value = m[2] === "+" ? a + b : m[2] === "-" ? a - b : m[2] === "*" ? a * b : b !== 0 ? a / b : NaN;
        if (!Number.isFinite(value)) result.push(issue("SOFT", "NUMERIC_DERIVATION_UNVERIFIED", unit.path));
        else if (Math.abs(value - out) > 1e-9) result.push(issue("HARD", "NUMERIC_DERIVATION_CONTRADICTION", unit.path));
        else result.push(issue("SOFT", "DERIVED_NUMBER_ATTRIBUTION_REQUIRES_REVIEW", unit.path));
      }
      derivationSpans.push({ start: m.index!, end: m.index! + m[0].length });
    }
    // A single directly referenced metric also permits an exact kg delta, in
    // this bounded strength-delta grammar. It never authorizes the same number
    // in unrelated prose elsewhere in the unit.
    const personal = metrics(input);
    if (personal.length === 1) {
      const s = fold(unit.text), metric = personal[0];
      for (const m of s.matchAll(/\b(?:e1rm|suc manh)(?: uoc tinh)?\s+(tang|giam)\s+(?:them\s+)?(\d+(?:[.,]\d+)?)\s*kg\b/g)) {
        const value = Number(m[2].replace(",", "."));
        if (Math.abs(Math.abs(metric.current - metric.baseline) - value) < 1e-9 && Math.sign(metric.current - metric.baseline) === (m[1] === "tang" ? 1 : -1)) derivationSpans.push({ start: m.index!, end: m.index! + m[0].length });
      }
    }
    for (const m of unit.text.matchAll(/\d+(?:[.,]\d+)?/g)) {
      if (extra.has(Number(m[0].replace(",", "."))) && !derivationSpans.some((span) => m.index! >= span.start && m.index! < span.end)) result.push(issue("HARD", "NUMBER_NOT_IN_INPUT", unit.path));
    }
  }
  return result;
}

/** Existing upstream projections include weight/fat trends, not a validated
 * muscle-size outcome. Unknown future BODY kinds require an explicit adapter;
 * neither the BODY domain nor model-declared outcome can clear this review. */
export function checkServerFacts(input: AdvisoryInput, answer: AnswerV3): ContentIssue[] {
  const result: ContentIssue[] = [], all = metrics(input), question = fold(input.question);
  const muscleQuestion = MUSCLE_WORDS.test(question), strengthQuestion = STRENGTH_WORDS.test(question);
  if (muscleQuestion && strengthQuestion) result.push(issue("SOFT", "MIXED_OUTCOME_ASSESSMENT_REQUIRES_REVIEW", "assessment"));
  const strengthScope = strengthQuestion && !muscleQuestion;
  if (strengthScope && all.length) {
    const named = all.filter((m) => m.exercise && question.includes(fold(m.exercise)));
    const scoped = named.length ? named : all;
    const ambiguous = scoped.length > 1;
    const directions = scoped.map((m) => Math.sign(m.current - m.baseline));
    if (ambiguous) result.push(issue("SOFT", "AMBIGUOUS_STRENGTH_ASSESSMENT_SCOPE", "assessment"));
    else if ((answer.assessment === "OBSERVED_PROGRESS" && directions.every((d) => d <= 0))
      || (answer.assessment === "NO_OBSERVED_CHANGE" && directions.some((d) => d !== 0))) result.push(issue("HARD", "ASSESSMENT_CONTRADICTS_SERVER_FACTS", "assessment"));
    if (answer.assessmentBasis.outcome !== "ESTIMATED_STRENGTH" || !answer.assessmentBasis.factIds.some((id) => scoped.some((m) => m.id === id))) result.push(issue("SOFT", "ASSESSMENT_BASIS_INCOMPLETE_OR_WRONG_SCOPE", "assessmentBasis"));
  }
  if ((muscleQuestion || answer.assessmentBasis.outcome === "MUSCLE_SIZE") && answer.assessment !== "INSUFFICIENT_DATA") {
    const relevant = input.facts.filter((f) => answer.assessmentBasis.factIds.includes(f.id));
    const weightOnly = relevant.some((f) => ["LATEST_MEASURED_WEIGHT", "OBSERVED_WEIGHT_TRAJECTORY"].includes(f.evidence.kind));
    result.push(issue("SOFT", weightOnly ? "WEIGHT_IS_NOT_MUSCLE_SIZE_MEASUREMENT" : "MUSCLE_OUTCOME_WITHOUT_SUPPORTED_MEASUREMENT", "assessment"));
  }
  answer.claims.forEach((claim, i) => {
    const linked = all.filter((m) => claim.factIds.includes(m.id));
    if (!linked.length) return;
    const path = `claims.${i}.text`, s = fold(claim.text);
    if (claim.claimType === "OBSERVATION" && !claim.metricAssertion) result.push(issue("SOFT", "MISSING_METRIC_ASSERTION", `claims.${i}.metricAssertion`));
    // Restricted from/to grammar, linked to the cited personal fact(s). A number
    // occurring elsewhere in the input is not proof of its attribution here.
    if (STRENGTH_WORDS.test(s)) {
      for (const m of s.matchAll(/\b(?:tu|from)\s+(\d+(?:[.,]\d+)?)\s*(?:kg\s*)?(?:len|xuong|den|to|->|→)\s*(\d+(?:[.,]\d+)?)/g)) {
        if (uncertaintyBefore(s, m.index!)) continue;
        const from = Number(m[1].replace(",", ".")), to = Number(m[2].replace(",", "."));
        if (!linked.some((f) => f.baseline === from && f.current === to)) result.push(issue(linked.length === 1 ? "HARD" : "SOFT", "OBSERVATION_ENDPOINT_CONTRADICTION", path));
      }
      for (const m of s.matchAll(/\b(?:e1rm|1rm|suc manh|strength)\s+(?:uoc tinh\s+)?(tang|giam|giu nguyen|khong thay doi|increased|decreased|unchanged)\b/g)) {
        if (uncertaintyBefore(s, m.index!)) continue;
        const expected = /^(?:tang|increased)$/.test(m[1]) ? 1 : /^(?:giam|decreased)$/.test(m[1]) ? -1 : 0;
        if (linked.every((f) => Math.sign(f.current - f.baseline) !== expected)) result.push(issue(linked.length === 1 ? "HARD" : "SOFT", "OBSERVATION_DIRECTION_CONTRADICTION", path));
      }
    }
  });
  return result;
}
