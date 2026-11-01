/** Server-fact adapters, not model-declared assessmentBasis, establish outcomes.
 * No new analytics, prescriptions, or production projection writers. */
import type { AdvisoryInput } from "./experiment";
import type { AnswerV3 } from "./content-aware-v3-schema";
import type { ContentIssue } from "./content-aware-v3";
import { fold, MUSCLE_WORDS, STRENGTH_WORDS } from "./content-aware-v3-language";

const CONTEXT_ONLY = new Set(["SCHEDULED_ADHERENCE", "LOGGED_TRAINING_DAYS", "LATEST_MEASURED_WEIGHT", "TARGET_WEIGHT", "GAP_TO_TARGET", "LOGGED_DAYS", "AVERAGE_LOGGED_CALORIES", "AVERAGE_LOGGED_PROTEIN"]);
const KNOWN = new Set(["EXERCISE_E1RM_CHANGE", "DIRECT_1RM_CHANGE", "OBSERVED_WEIGHT_TRAJECTORY", "BODY_FAT_TREND"]);
export function checkOutcomeSupport(input: AdvisoryInput, answer: AnswerV3): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (severity: ContentIssue["severity"], code: string) => issues.push({ severity, code, path: "assessment", scope: "STRUCTURED_INVARIANT" });
  const q = fold(input.question);
  const muscle = MUSCLE_WORDS.test(q), strength = STRENGTH_WORDS.test(q);
  const weight = /\b(?:can nang|weight)\b/.test(q), fat = /\b(?:ty le mo|ti le mo|body fat)\b/.test(q);
  const valid = input.facts.filter((f) => ["SUFFICIENT", "PARTIAL"].includes(f.evidence.quality));
  const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const outcomes = valid.filter((f) => {
    const e = f.evidence, v = e.value;
    if (["EXERCISE_E1RM_CHANGE", "DIRECT_1RM_CHANGE"].includes(e.kind)) return e.domain === "TRAINING" && e.provenance === "TRAINING_LOGS"
      && finite(v.baselineKg) && finite(v.currentKg) && v.baselineKg > 0 && v.currentKg > 0 && (v.unit === undefined || v.unit === "kg");
    if (e.kind === "OBSERVED_WEIGHT_TRAJECTORY") return e.domain === "BODY" && e.provenance === "MEASURED_INBODY" && finite(v.firstKg) && finite(v.latestKg) && finite(v.observations) && v.observations >= 2;
    if (e.kind === "BODY_FAT_TREND") return e.domain === "BODY" && e.provenance === "MEASURED_INBODY" && finite(v.dataPoints) && v.dataPoints >= 2 && finite(v.changePerWeekPct);
    return false;
  });
  const unknown = valid.some((f) => !KNOWN.has(f.evidence.kind) && !CONTEXT_ONLY.has(f.evidence.kind));
  const relevant = outcomes.filter((f) => muscle ? false : weight ? f.evidence.kind === "OBSERVED_WEIGHT_TRAJECTORY" : fat ? f.evidence.kind === "BODY_FAT_TREND" : strength ? ["EXERCISE_E1RM_CHANGE", "DIRECT_1RM_CHANGE"].includes(f.evidence.kind) : true);
  if (answer.assessment !== "INSUFFICIENT_DATA" && !relevant.length) {
    // Unknown future outcome kinds need an adapter/review, never a blanket veto.
    const singleExplicitOutcome = [muscle, strength, weight, fat].filter(Boolean).length === 1;
    const mixedScope = outcomes.length > 0 && !singleExplicitOutcome && (!muscle || (strength && /\b(?:va|and)\b/.test(q)));
    add(unknown || mixedScope ? "SOFT" : "HARD", unknown ? "OUTCOME_ADAPTER_REQUIRED" : mixedScope ? "OUTCOME_SCOPE_REQUIRES_REVIEW" : "ASSESSMENT_WITHOUT_OUTCOME_MEASUREMENT");
  }
  const direct = relevant.filter((f) => f.evidence.kind === "DIRECT_1RM_CHANGE");
  if (direct.length === 1 && relevant.length === 1) {
    const v = direct[0].evidence.value, direction = Math.sign(Number(v.currentKg) - Number(v.baselineKg));
    if ((answer.assessment === "OBSERVED_PROGRESS" && direction <= 0) || (answer.assessment === "NO_OBSERVED_CHANGE" && direction !== 0)) add("HARD", "ASSESSMENT_CONTRADICTS_SERVER_FACTS");
  }
  if (relevant.length && relevant.some((f) => !["EXERCISE_E1RM_CHANGE", "DIRECT_1RM_CHANGE"].includes(f.evidence.kind))) {
    add("SOFT", "OTHER_MEASURED_OUTCOME_REQUIRES_GOAL_REVIEW");
    if (relevant.length === 1 && answer.assessment === "NO_OBSERVED_CHANGE") {
      const e = relevant[0].evidence, v = e.value;
      const changed = e.kind === "OBSERVED_WEIGHT_TRAJECTORY" ? v.firstKg !== v.latestKg : v.changePerWeekPct !== 0;
      if (changed) add("HARD", "ASSESSMENT_CONTRADICTS_SERVER_FACTS");
    }
  }
  if (answer.assessment !== "INSUFFICIENT_DATA" && answer.assessmentBasis.factIds.length && !answer.assessmentBasis.factIds.some((id) => relevant.some((f) => f.id === id))) add("SOFT", "ASSESSMENT_BASIS_NOT_OUTCOME_FACT");
  return issues;
}
