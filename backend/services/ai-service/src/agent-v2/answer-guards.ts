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
import { appendMinorSupervisionNote } from "../llm/medical-referral";
import { MAX_QUESTION_CHARS } from "../llm/safety-limits";

/**
 * Sentence splitter for the deterministic guards: breaks after . ! ? only when followed by whitespace / end, and at line
 * breaks — so decimals ("70.4 kg", "1.6 kg") stay inside their sentence (M3 found "70." / "4 kg." splits hiding a figure).
 * Joining the parts with "" restores the original text exactly.
 */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?=\s|$)|(?<=\n)/u);
}

export interface InputSafetyVerdict { safe: boolean; type: string; message?: string }

/** True when the text carries any Vietnamese diacritic (NFD combining mark, or đ/Đ which has no decomposition). */
function hasVietnameseDiacritic(text: string): boolean {
  return /[\p{M}đĐ]/u.test(text.normalize("NFD"));
}

const UNASSESSABLE_MESSAGE = "Mình không thể hỗ trợ yêu cầu này một cách an toàn. Hãy trao đổi với bác sĩ hoặc chuyên gia.";

export function checkInputSafety(question: string): InputSafetyVerdict {
  // F2: not text at all → nothing can be assessed → fail CLOSED (it used to throw on `.length`, an unhandled error is not a safety verdict either).
  if (typeof question !== "string") return { safe: false, type: "emergency_unassessable", message: UNASSESSABLE_MESSAGE };
  // Bounded computation (owner Q3): an over-limit question is refused BEFORE any scan, normalization or detector runs — fail-CLOSED
  // (never "safe", never truncated, never echoed). Unreachable over HTTP (zod and the supervisor / bounded agent already reject
  // > MAX_QUESTION_CHARS earlier); this is function-level defence in depth for any other caller. Unit: UTF-16 code units (`.length`).
  if (question.length > MAX_QUESTION_CHARS) {
    return { safe: false, type: "input_too_long", message: "Mình không thể hỗ trợ yêu cầu này một cách an toàn. Hãy trao đổi với bác sĩ hoặc chuyên gia." };
  }
  // V1's detectors partly match only UNACCENTED text ("giam 10kg trong 1 tuan" is blocked, "giảm 10kg trong 1 tuần" is not —
  // found 2026-11-12, V1 runtime frozen, reported separately). V2 also checks the diacritic-folded form; never weaker than V1.
  // The induced-vomiting detector reads the ORIGINAL accents ("ói"/"ơi", "cô"/"có"), so when the original HAS diacritics the folded retry
  // skips only that detector (accentFoldedRetry) — otherwise an accented third-person sentence folds into a first-person lookalike. A fully
  // unaccented original is evaluated unchanged (folded == original), so unaccented first-person disclosures keep being refused.
  // F2: ONE emergency assessment per message. The first call assesses the ORIGINAL text (the engine reads both of its normalization views); the folded retry of an ACCENTED original
  // (`accentFoldedRetry`) does not assess the derived string again — it used to turn "Tôi muốn từ từ." (slowly) into a suicide verdict that V1 never gave. The other detectors still
  // read the folded copy. A guard that throws is not "safe": fail closed.
  let r: any;
  try {
    r = safetyGuard.check(question);
    if (!r || r.type === "safe") r = hasVietnameseDiacritic(question) ? safetyGuard.check(foldVi(question), { accentFoldedRetry: true }) : safetyGuard.check(foldVi(question));
  } catch {
    return { safe: false, type: "emergency_unassessable", message: UNASSESSABLE_MESSAGE };
  }
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
  out = splitSentences(out).filter((sentence) => {
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
  out = splitSentences(out).filter((sentence) => {
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
  out = splitSentences(out).filter((sentence) => {
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

// ── Progress (M3) ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Folded: a claim that something was ACHIEVED / measured ("đã giảm 2 kg", "giảm được", "hiện nặng", "đo được"). */
const ACHIEVED_CLAIM = /\b(da|vua) (giam|tang|dat|xuong|len)\b|\b(giam|tang) duoc\b|\bhien (tai )?(nang|can nang|o muc)\b|\bdo duoc\b|\bthuc te (ban )?(da|dang)\b/;
const GOAL_ACHIEVED = /\b(da|vua) (dat|hoan thanh|cham) (duoc )?(muc tieu|can nang muc tieu)\b|\bhoan thanh muc tieu\b/;
const TREND_CLAIM = /\b(xu huong|dang (giam|tang)|giam dan|tang dan|on dinh dan)\b/;
const BODY_FAT_CLAIM = /\b(mo co the|ti le mo|ty le mo|body fat|% ?mo)\b/;
const MUSCLE_CLAIM = /\b(khoi co|luong co|co bap|co nac|muscle mass|lean mass)\b.{0,30}\b(cua ban|ban da|da tang|da giam|tang|giam)\b|\b(ban da|ban) (tang|giam) (\d+[.,]?\d* ?kg )?(co|khoi co|co bap)\b/;
const HEALTH_CLAIM = /\b(suc khoe (cua ban )?(da |dang )?(cai thien|tot hon|tot len)|khoe manh hon|giam nguy co|it nguy co|an toan hon cho tim)\b/;
const SIGNIFICANCE_CLAIM = /\b(y nghia thong ke|dang ke ve mat thong ke|statistically significant)\b/;
const RATE_PER_WEEK = /(giam|mat|cat)\s+(\d+(?:[.,]\d+)?)\s*(?:kg|ky|ki)\s*(?:\/|moi|mot|1)\s*tuan/;
const ONE_RM = /\b1 ?rm\b/i;

export interface ProgressAnswerEvidence {
  question: string;
  sessionUserMessages?: string[];
  verifiedNumbers: number[];
  /** Numbers that appeared ONLY in a forecast this turn (never in a measurement / estimate / user text). */
  forecastOnlyNumbers: number[];
  weightTrendAvailable: boolean;
  bodyFatTrendAvailable: boolean;
  bodyFatObserved: boolean;
}

const numbersIn = (s: string) => [...s.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d])/g)].map((m) => Number(m[1].replace(",", ".")));

/**
 * Final-answer guards for the Progress Agent (M3). V1 hygiene / BMI / fidelity, then deterministic rules on each sentence:
 * forecast-only figures stated as achieved, goal claimed as achieved, trends without ≥2 data points, body fat without an
 * observation, any personal muscle-mass change (not exposed), health inference, statistical-significance wording, unsafe
 * weight-loss rates (> 1 kg/week) or a daily energy figure under MIN_DAILY_KCAL. "1RM" is always labelled as an estimate.
 */
export function guardProgressAnswer(answer: string, ev: ProgressAnswerEvidence): { answer: string; actions: string[] } {
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

  const forecastOnly = new Set(ev.forecastOnlyNumbers);
  const removed: Record<string, number> = {};
  let labelled = 0;
  out = splitSentences(out).filter((sentence) => {
    const f = foldVi(sentence);
    const negated = /\b(khong|chua)\b/.test(f);
    const conditional = /\b(neu|gia su|du kien|du bao|kich ban|co the se)\b/.test(f);
    const hit = (k: string) => { removed[k] = (removed[k] ?? 0) + 1; return false; };
    if (ACHIEVED_CLAIM.test(f) && !negated && !conditional && numbersIn(f).some((n) => forecastOnly.has(n))) return hit("forecast_as_actual");
    if (GOAL_ACHIEVED.test(f) && !negated) return hit("goal_claim");
    if (TREND_CLAIM.test(f) && !negated) {
      const aboutFat = BODY_FAT_CLAIM.test(f);
      const aboutWeight = /\b(can nang|nang|kg)\b/.test(f);
      if ((aboutFat && !ev.bodyFatTrendAvailable) || (aboutWeight && !aboutFat && !ev.weightTrendAvailable)) return hit("trend_without_history");
    }
    if (BODY_FAT_CLAIM.test(f) && !ev.bodyFatObserved && /\d/.test(f) && !conditional && !/\b(chua co|khong co|thieu)\b/.test(f)) return hit("body_fat_unsupported");
    if (MUSCLE_CLAIM.test(f) && !negated) return hit("muscle_unsupported");
    if (HEALTH_CLAIM.test(f)) return hit("health_claim");
    if (SIGNIFICANCE_CLAIM.test(f) && !negated) return hit("significance_claim");
    const rate = RATE_PER_WEEK.exec(f);
    if (rate && Number(rate[2].replace(",", ".")) > 1) return hit("extreme_rate");
    for (const m of sentence.matchAll(KCAL_FIGURE)) {
      const v = Number(m[1].replace(/[.,]/g, ""));
      if (v > 0 && v < MIN_DAILY_KCAL && DAILY_CONTEXT.test(f)) return hit("kcal_floor");
    }
    return true;
  }).map((sentence) => {
    if (ONE_RM.test(sentence) && !/uoc tinh|estimat|e1rm/.test(foldVi(sentence))) { labelled++; return sentence.replace(ONE_RM, (m) => `${m} ước tính`); }
    return sentence;
  }).join("").trim();
  for (const [k, n] of Object.entries(removed)) actions.push(`${k}:${n}`);
  if (labelled) actions.push(`e1rm_labelled:${labelled}`);

  return { answer: out.trim(), actions };
}

// ── M7-P0.1 (MG-1): general-only output policy (minor / unverified profile) ─────────────────────────────────────────
/**
 * On a GENERAL_ONLY turn (Gate 1: minor + general knowledge, or profile unverified + general knowledge) nothing about the
 * user was read and the model was told so — but the model's TEXT is not trusted to comply. This deterministic filter runs on
 * MODEL-GENERATED text only (never on the user's input) and removes, sentence by sentence (folded text, accented or not):
 *   age        a specific age asserted for the user ("bạn 20 tuổi", "em năm nay 17 tuổi", "tuổi 20 của bạn")
 *   adult      an adulthood claim ("bạn đã trưởng thành", "vì bạn là người lớn", "bạn trên 18 tuổi")
 *   kcal       an energy figure (≥ 100 kcal/calo/cal, any common separator, ranges) addressed to the user, or prescribed per
 *              day / for weight change ("bạn cần 1500 kcal/ngày", "để giảm cân nên ăn 1.200 calo mỗi ngày")
 *   weight     a weight-change figure addressed to the user ("bạn nên giảm 5 kg")
 *   macro      a gram figure of a macronutrient addressed to the user ("bạn cần 120 g protein")
 *   body       a conclusion about the user's own body / energy need ("bạn đang thừa cân", "nhu cầu calo của bạn là …")
 *   plan       a personal meal plan or restrictive diet instruction ("thực đơn cho bạn", "bạn nên ăn kiêng")
 * Kept: general statements, including ones with numbers ("1 g protein cung cấp 4 kcal", "một quả chuối khoảng 100 kcal",
 * "nhu cầu dinh dưỡng thay đổi theo tuổi"), and the mandatory supervision line. When a sentence is ambiguous (addressed to
 * the user AND carrying an energy / weight / macro figure) it is removed — the stricter side. If the removals leave no
 * content, a fixed general-knowledge answer is returned instead. A pattern list cannot cover every phrasing; it is a
 * deterministic backstop under the prompt note, not a proof of absence.
 */
export const GENERAL_ONLY_FALLBACK_VI =
  "Nhu cầu năng lượng và dinh dưỡng ở tuổi đang lớn khác nhau theo tuổi, giới, tốc độ phát triển và mức vận động, nên mình không đưa ra con số hay mục tiêu cá nhân.";
const SUPERVISION_NOTES = [appendMinorSupervisionNote("", "vi"), appendMinorSupervisionNote("", "en")].map((n) => foldVi(n));
const YOU = String.raw`(?<!tre )\b(?:ban|em)\b`;
const AGE_FILLER = String.raw`(?:\s+(?:hien|hien tai|nay|nam nay|bay gio|da|moi|chi|tam|khoang|cung|la|vua|se|tron|duoc))*`;
const MINOR_OUTPUT_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["age", new RegExp(`${YOU}${AGE_FILLER}\\s+\\d{1,3}\\s*(?:tuoi|t)\\b|\\btuoi\\s+\\d{1,3}\\s+(?:cua|nhu)\\s+(?:ban|em)\\b|\\b\\d{1,3}\\s*tuoi\\s+(?:nhu|cua)\\s+(?:ban|em)\\b|\\b(?:o|voi)\\s+(?:do\\s+)?(?:tuoi\\s+\\d{1,3}|\\d{1,3}\\s*tuoi)\\b[^.!?\\n]{0,20}${YOU}|\\byou(?:'re| are)\\s+\\d{1,3}\\b`)],
  ["adult", new RegExp(`${YOU}\\s+(?:hien\\s+|nay\\s+|bay gio\\s+|cung\\s+)?(?:da\\s+|la\\s+|deu\\s+|dang la\\s+)?(?:mot\\s+)?(?:nguoi\\s+)?(?:truong thanh|nguoi lon|lon roi|du 18|tren 18|qua 18|ngoai 18|du tuoi truong thanh|qua tuoi vi thanh nien|khong con (?:la )?(?:tre )?vi thanh nien|khong phai (?:la )?(?:tre )?vi thanh nien)\\b|\\btuoi truong thanh\\b[^.!?\\n]{0,15}\\b(?:nhu|cua) (?:ban|em)\\b|\\byou(?:'re| are) (?:an )?(?:adult|over 18|grown)`)],
  ["body", new RegExp(`${YOU}\\s+(?:hien\\s+|dang\\s+|co ve\\s+|co le\\s+|hoi\\s+|bi\\s+)*(?:thua can|beo phi|thieu can|qua gay|qua beo|nang \\d|cao \\d)|\\b(?:can nang|chieu cao|vong eo|ti le mo|ty le mo|luong mo|khoi co|bmi|tdee|bmr|nhu cau (?:calo|nang luong|dinh duong)|muc tieu (?:calo|nang luong|can nang)) (?:hien tai |hang ngay |moi ngay )?cua (?:ban|em)\\b[^.!?\\n]{0,30}(?:\\d|\\b(?:la|o muc|khoang|dang|qua|thap|cao|on)\\b)`)],
  ["plan", new RegExp(`\\b(?:thuc don|ke hoach (?:an|dinh duong|giam can)|che do an|lich an)\\b[^.!?\\n]{0,20}\\b(?:cua|cho|danh cho) (?:ban|em)\\b|${YOU}\\s+(?:nen|can|hay|phai)\\s+(?:an kieng|nhin an|bo bua|cat giam (?:calo|tinh bot|an)|giam an|an it lai|han che calo)`)],
];
const SECOND_PERSON = new RegExp(`${YOU}|\\byour?\\b`);
const ENERGY_FIGURE = /(\d{1,2}(?:[.,\s]\d{3})+|\d{2,5})\s*(?:kcal|kilocalo(?:ries)?|calo(?:ries?)?|calories?|cal|ca-? ?lo)\b/g;
const WEIGHT_FIGURE = /\b(?:giam|tang|xuong|len|cat|mat)\s+(?:them\s+|duoc\s+|khoang\s+)?\d+(?:[.,]\d+)?\s*(?:kg|ky|ki|kilo|can)\b/;
const MACRO_FIGURE = /\b\d+(?:[.,]\d+)?\s*(?:g|gam|gram)\b[^.!?\n]{0,20}\b(?:protein|dam|carb|tinh bot|chat beo|beo|chat xo)\b|\b(?:protein|dam|carb|tinh bot|chat beo)\b[^.!?\n]{0,25}\b\d+(?:[.,]\d+)?\s*(?:g|gam|gram)\b/;
const PRESCRIPTIVE = /\b(?:nen|can|hay|phai|chi nen|muc tieu|toi da|toi thieu|khong qua|it nhat|an|nap)\b/;
const WEIGHT_CONTEXT = /\b(?:giam can|giam mo|tang can|siet can|cat can|tham hut|thieu hut|giam beo|dot mo|cat giam)\b/;

export function guardGeneralOnlyAnswer(answer: string): { answer: string; actions: string[] } {
  const removed: Record<string, number> = {};
  const kept = splitSentences(answer).filter((sentence) => {
    const f = foldVi(sentence);
    if (!f || SUPERVISION_NOTES.some((n) => n.includes(f))) return true;
    const hit = (k: string) => { removed[k] = (removed[k] ?? 0) + 1; return false; };
    for (const [k, re] of MINOR_OUTPUT_RULES) if (re.test(f)) return hit(k);
    const you = SECOND_PERSON.test(f);
    const energy = [...f.matchAll(ENERGY_FIGURE)].some((m) => Number(m[1].replace(/[.,\s]/g, "")) >= 100);
    if (energy && (you || (PRESCRIPTIVE.test(f) && (DAILY_CONTEXT.test(f) || WEIGHT_CONTEXT.test(f))) || (DAILY_CONTEXT.test(f) && WEIGHT_CONTEXT.test(f)))) return hit("kcal");
    if (you && WEIGHT_FIGURE.test(f)) return hit("weight");
    if (you && MACRO_FIGURE.test(f)) return hit("macro");
    return true;
  });
  const actions = Object.entries(removed).map(([k, n]) => `minor_output_${k}:${n}`);
  if (!actions.length) return { answer, actions };
  const out = kept.join("").trim();
  const content = splitSentences(out).filter((s) => { const f = foldVi(s); return /[a-z]{2}/.test(f) && !SUPERVISION_NOTES.some((n) => n.includes(f)); });
  if (!content.length) return { answer: [GENERAL_ONLY_FALLBACK_VI, out].filter(Boolean).join("\n\n"), actions: [...actions, "minor_output_fallback:1"] };
  return { answer: out, actions };
}
