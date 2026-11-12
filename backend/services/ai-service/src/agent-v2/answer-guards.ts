/**
 * Gymini V2 (EXPERIMENTAL) — final-answer guards for the Training Agent.
 *
 * Adapter over EXISTING pure V1 guards (no copies of their logic, no I/O, no orchestrator dependency):
 *   input  : safetyGuard.check (medical / emergency / unsafe weight loss / diagnosis) — runs BEFORE any model or tool call.
 *   output : stripInternalReferences (evidence labels, internal enums), groundBmiClaims (the agent has no BMI source → a
 *            personal BMI figure is removed), removeUnsupportedUserClaims (personal facts/figures not supported by the
 *            question or by tool data), enforceExerciseConstraints (equipment/injury/exclusion constraints stated this turn).
 * Minor policy by PROFILE age: Gate 1 (minor-gate.ts), applied by the engine before any model/tool call.
 * Nutrition (M1, guardNutritionAnswer): the same hygiene / BMI / fidelity guards + V1 groundIntakeClaims (a protein TARGET is
 * never stated as current intake — the agent has no intake log) + a calorie floor (V1 policy: never below 1200 kcal/day,
 * safety_guard / nutrition_answer_mode) for any daily figure not taken from a tool result. answer_validator is not applied.
 */
import { safetyGuard } from "../llm/safety_guard";
import { foldVi } from "../llm/speech_act";
import { stripInternalReferences } from "../llm/output_hygiene";
import { groundBmiClaims } from "../llm/bmi_claim_guard";
import { removeUnsupportedUserClaims } from "../llm/context_fidelity_guard";
import { enforceExerciseConstraints } from "../llm/exercise_constraint_guard";
import { extractTurnFacts } from "../llm/turn_facts";
import { groundIntakeClaims } from "../llm/intake_claim_guard";

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

/** V1 policy floor (safety_guard / nutrition_answer_mode): a daily energy figure below this is never recommended. */
export const MIN_DAILY_KCAL = 1200;
const KCAL_FIGURE = /(\d{3,4}(?:[.,]\d{3})?)\s*(?:kcal|calo|calories|cal)\b/giu;
/** Folded: "bạn (hiện) đang/đã/vẫn ăn|tiêu thụ|nạp|uống ... <n> g|kcal|calo" — a claim about the user's current intake. */
const CURRENT_INTAKE = /\b(?:ban|em)\s+(?:hien (?:tai )?)?(?:dang|da|van)\s+(?:an|tieu thu|nap|hap thu|bo sung|uong)\b[^.!?\n]{0,30}?(\d+(?:[.,]\d+)?)\s*(?:g|gam|kcal|calo)\b/;
/** Folded: the figure is a DAILY amount (a single meal's energy, e.g. "bữa sáng 400 kcal", is not touched). */
const DAILY_CONTEXT = /(moi ngay|mot ngay|hang ngay|trong ngay|\/ ?ngay|per day|a day|\/ ?day|daily|muc tieu (calo|nang luong)|tong (calo|nang luong))/;

export interface NutritionAnswerEvidence {
  question: string;
  sessionUserMessages?: string[];
  verifiedNumbers: number[];
  /** g/day protein from the authoritative target tool this turn, when read. */
  proteinTargetG: number | null;
}

/**
 * Final-answer guards for the Nutrition Agent (M1). Order: hygiene → BMI → fidelity → intake grounding → calorie floor.
 * The floor removes a sentence that states a daily energy figure below MIN_DAILY_KCAL unless that exact number came from a
 * tool result (the authoritative NutritionGoal is never rewritten by a guard; a professional-review case keeps its value).
 */
export function guardNutritionAnswer(answer: string, ev: NutritionAnswerEvidence): { answer: string; actions: string[] } {
  const actions: string[] = [];
  let out = answer;

  const hygiene = stripInternalReferences(out);
  if (hygiene.labels || hygiene.removedSentences) actions.push(`hygiene:${hygiene.labels}/${hygiene.removedSentences}`);
  out = hygiene.answer;

  const bmi = groundBmiClaims(out, { bmi: null, lang: "vi" }) as { answer: string; corrected?: number; removed?: number };
  if (bmi.corrected || bmi.removed) actions.push(`bmi:${bmi.corrected ?? 0}/${bmi.removed ?? 0}`);
  out = bmi.answer;

  const fidelity = removeUnsupportedUserClaims(out, {
    question: ev.question, sessionUserMessages: ev.sessionUserMessages ?? [], verifiedProfileFacts: {}, verifiedNumbers: ev.verifiedNumbers,
  });
  if (fidelity.removed.length) actions.push(`fidelity:${fidelity.removed.length}`);
  out = fidelity.answer;

  const intake = groundIntakeClaims(out, { proteinTargetG: ev.proteinTargetG, loggedIntake: false, lang: "vi" });
  if (intake.rewritten) actions.push(`intake:${intake.rewritten}`);
  out = intake.answer;

  // The agent has no intake log: a sentence asserting what the user CURRENTLY eats, with a figure the user never stated,
  // is fabricated (M1 test MA-3: "Bạn đang ăn 60g protein mỗi ngày" passed the V1 fidelity guard). Conditionals are kept.
  const userText = foldVi([ev.question, ...(ev.sessionUserMessages ?? [])].join(" "));
  let intakeRemoved = 0;
  out = out.split(/(?<=[.!?\n])/u).filter((sentence) => {
    const f = foldVi(sentence);
    const m = CURRENT_INTAKE.exec(f);
    if (!m || /\b(neu|gia su|vi du)\b/.test(f)) return true;
    if (new RegExp(`(?<!\\d)${m[1].replace(/[.,]/g, "[.,]?")}(?!\\d)`).test(userText)) return true;
    intakeRemoved++;
    return false;
  }).join("");
  if (intakeRemoved) actions.push(`intake_unlogged:${intakeRemoved}`);

  const verified = new Set(ev.verifiedNumbers);
  let floorRemoved = 0;
  out = out.split(/(?<=[.!?\n])/u).filter((sentence) => {
    for (const m of sentence.matchAll(KCAL_FIGURE)) {
      const v = Number(m[1].replace(/[.,]/g, ""));
      if (Number.isFinite(v) && v > 0 && v < MIN_DAILY_KCAL && !verified.has(v) && DAILY_CONTEXT.test(foldVi(sentence))) {
        floorRemoved++;
        return false;
      }
    }
    return true;
  }).join("");
  if (floorRemoved) actions.push(`kcal_floor:${floorRemoved}`);

  return { answer: out.trim(), actions };
}

// ── Recovery (M2) ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Folded. Personal sleep / HRV / heart-rate statements — Gymini has no such data for normal users. */
const BIOMETRIC_CLAIM = /\b(hrv|bien thien nhip tim|nhip tim (khi |luc )?nghi|resting heart|giac ngu cua (ban|em)|(ban|em) (da |dang |chi |moi )?ngu (duoc |khoang |it |nhieu |du |khong du |\d)|chat luong giac ngu cua (ban|em))/;
const BIOMETRIC_TOPIC = /\b(hrv|nhip tim|ngu|giac ngu)\b/;
/** Folded. "You have fully recovered / are 100% ready" — never supported by logged training data. */
const FULL_RECOVERY_CLAIM = /\b(da |hoan toan )?(hoi phuc|phuc hoi) hoan toan\b|\bhoan toan (hoi phuc|phuc hoi)\b|\bsan sang 100\b|\bfully recovered\b/;
/** Folded. A derived recovery / readiness score — no validated method exists in Gymini. */
const RECOVERY_SCORE = /\b(diem|chi so|muc) (phuc hoi|hoi phuc|san sang)\b|\brecovery score\b|\breadiness score\b/;
/** Folded. A diagnosis about the user ("bạn bị viêm gân", "có thể bạn đã rách cơ"). */
const DIAGNOSIS = /\b(ban|em)\s+(co the |co le |chac la |da |dang )*(bi|mac)\s+(viem|rach|gian|dut|thoat vi|chan thuong|hoi chung|tran dich|nut|bong gan|tieu co van|qua tai man tinh)/;
export const RECOVERY_REFERRAL = "Nếu đau kéo dài, đau tăng khi tập hoặc có dấu hiệu bất thường, hãy gặp bác sĩ hoặc chuyên gia vật lý trị liệu để được kiểm tra trực tiếp.";

export interface RecoveryAnswerEvidence {
  question: string;
  sessionUserMessages?: string[];
  verifiedNumbers: number[];
}

/**
 * Final-answer guards for the Recovery Agent (M2). V1 hygiene / BMI / fidelity, then deterministic removal of: personal
 * sleep/HRV/heart-rate claims the user did not raise, "fully recovered" assertions, any recovery/readiness score, and
 * diagnoses (replaced by one referral line). Observations must come from tools; the guard never adds a fact.
 */
export function guardRecoveryAnswer(answer: string, ev: RecoveryAnswerEvidence): { answer: string; actions: string[] } {
  const actions: string[] = [];
  let out = answer;

  const hygiene = stripInternalReferences(out);
  if (hygiene.labels || hygiene.removedSentences) actions.push(`hygiene:${hygiene.labels}/${hygiene.removedSentences}`);
  out = hygiene.answer;

  const bmi = groundBmiClaims(out, { bmi: null, lang: "vi" }) as { answer: string; corrected?: number; removed?: number };
  if (bmi.corrected || bmi.removed) actions.push(`bmi:${bmi.corrected ?? 0}/${bmi.removed ?? 0}`);
  out = bmi.answer;

  const fidelity = removeUnsupportedUserClaims(out, {
    question: ev.question, sessionUserMessages: ev.sessionUserMessages ?? [], verifiedProfileFacts: {}, verifiedNumbers: ev.verifiedNumbers,
  });
  if (fidelity.removed.length) actions.push(`fidelity:${fidelity.removed.length}`);
  out = fidelity.answer;

  const userRaisedBiometrics = BIOMETRIC_TOPIC.test(foldVi([ev.question, ...(ev.sessionUserMessages ?? [])].join(" ")));
  const removed: Record<string, number> = {};
  let diagnosisRemoved = false;
  out = out.split(/(?<=[.!?\n])/u).filter((sentence) => {
    const f = foldVi(sentence);
    const hit = (k: string) => { removed[k] = (removed[k] ?? 0) + 1; return false; };
    if (!userRaisedBiometrics && BIOMETRIC_CLAIM.test(f)) return hit("biometric");
    if (FULL_RECOVERY_CLAIM.test(f) && !/\bkhong\b|\bchua\b/.test(f)) return hit("full_recovery");
    if (RECOVERY_SCORE.test(f)) return hit("recovery_score");
    if (DIAGNOSIS.test(f)) { diagnosisRemoved = true; return hit("diagnosis"); }
    return true;
  }).join("").trim();
  for (const [k, n] of Object.entries(removed)) actions.push(`${k}:${n}`);
  if (diagnosisRemoved && !out.includes(RECOVERY_REFERRAL)) out = `${out}${out ? "\n\n" : ""}${RECOVERY_REFERRAL}`;

  return { answer: out.trim(), actions };
}
