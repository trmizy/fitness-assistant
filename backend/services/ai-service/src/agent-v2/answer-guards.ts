/**
 * Gymini V2 (EXPERIMENTAL) — final-answer guards for the Training Agent.
 *
 * Adapter over EXISTING pure V1 guards (no copies of their logic, no I/O, no orchestrator dependency):
 *   input  : safetyGuard.check (medical / emergency / unsafe weight loss / diagnosis) — runs BEFORE any model or tool call.
 *   output : stripInternalReferences (evidence labels, internal enums), groundBmiClaims (the agent has no BMI source → a
 *            personal BMI figure is removed), removeUnsupportedUserClaims (personal facts/figures not supported by the
 *            question or by tool data), enforceExerciseConstraints (equipment/injury/exclusion constraints stated this turn).
 * Not applied (stated, not hidden): resolveProfileAwareSafety / minor policy by PROFILE age (needs the profile age, which the
 * Training projection does not expose), groundIntakeClaims (nutrition — out of the Training scope), answer_validator
 * (nutrition-number rules).
 */
import { safetyGuard } from "../llm/safety_guard";
import { foldVi } from "../llm/speech_act";
import { stripInternalReferences } from "../llm/output_hygiene";
import { groundBmiClaims } from "../llm/bmi_claim_guard";
import { removeUnsupportedUserClaims } from "../llm/context_fidelity_guard";
import { enforceExerciseConstraints } from "../llm/exercise_constraint_guard";
import { extractTurnFacts } from "../llm/turn_facts";

export interface InputSafetyVerdict { safe: boolean; type: string; message?: string }

export function checkInputSafety(question: string): InputSafetyVerdict {
  // V1's detectors partly match only UNACCENTED text ("giam 10kg trong 1 tuan" is blocked, "giảm 10kg trong 1 tuần" is not —
  // found 2026-11-12, V1 runtime frozen, reported separately). V2 also checks the diacritic-folded form; never weaker than V1.
  let r: any = safetyGuard.check(question);
  if (!r || r.type === "safe") r = safetyGuard.check(foldVi(question));
  if (!r || r.type === "safe") return { safe: true, type: "safe" };
  const message = typeof r.messageVi === "string" && r.messageVi
    ? r.messageVi
    : r.guidance
      ? [`⚠️ ${r.guidance.reason}`, "", r.guidance.safeAlternative, "", ...(r.guidance.firstWeekSteps ?? []).map((s: string) => `- ${s}`)].join("\n")
      : "Mình không thể hỗ trợ yêu cầu này một cách an toàn. Hãy trao đổi với bác sĩ hoặc chuyên gia.";
  return { safe: false, type: String(r.type), message };
}

export interface AnswerEvidence {
  question: string;
  /** Prior user messages of THIS conversation only. */
  sessionUserMessages?: string[];
  /** Numbers that appeared in successful tool results this turn (sets, reps, day numbers, week numbers …). */
  verifiedNumbers: number[];
  /** True when a tool result this turn listed injuries for the user. */
  injuriesOnRecord: boolean;
}

export function guardTrainingAnswer(answer: string, ev: AnswerEvidence): { answer: string; actions: string[] } {
  const actions: string[] = [];
  let out = answer;

  const hygiene = stripInternalReferences(out);
  if (hygiene.labels || hygiene.removedSentences) actions.push(`hygiene:${hygiene.labels}/${hygiene.removedSentences}`);
  out = hygiene.answer;

  const bmi = groundBmiClaims(out, { bmi: null, lang: "vi" }) as { answer: string; corrected?: number; removed?: number };
  if (bmi.corrected || bmi.removed) actions.push(`bmi:${bmi.corrected ?? 0}/${bmi.removed ?? 0}`);
  out = bmi.answer;

  const fidelity = removeUnsupportedUserClaims(out, {
    question: ev.question, sessionUserMessages: ev.sessionUserMessages ?? [],
    verifiedProfileFacts: { injury: ev.injuriesOnRecord }, verifiedNumbers: ev.verifiedNumbers,
  });
  if (fidelity.removed.length) actions.push(`fidelity:${fidelity.removed.length}`);
  out = fidelity.answer;

  const facts = extractTurnFacts(ev.question, { sessionUserMessages: ev.sessionUserMessages ?? [] });
  const constraints = enforceExerciseConstraints(out, facts);
  if (constraints.violations.length) actions.push(`constraints:${constraints.violations.length}`);
  out = constraints.answer;

  return { answer: out.trim(), actions };
}
