import { normalizeAgentText } from "../services/fitness-agent-intent";
import type { SlotParseResult } from "./types";

/**
 * Deterministic-first slot-value parsing (docs/conversational-ai-coach-
 * workflow-design.md §Slot extraction — "deterministic first"). These cover
 * the simple, high-frequency shapes a real reply to a targeted question
 * takes (a bare number+unit, a day list, an enum choice). A bounded LLM
 * extractor for genuinely free-form phrasing is intentionally NOT built
 * this pass — see the design doc's own disclosed scope boundary — but the
 * SlotParseResult contract these return is exactly what a future bounded
 * extractor would also have to produce, so adding one later is additive.
 */

// Codex Conversational AI Coach Evaluation #1, §29/§45 — "72 kg... à
// không 70 kg" returned 72 (the first number), not the corrected/final
// value. When a message contains MORE than one weight-shaped number AND a
// correction cue between them, prefer the number AFTER the cue (the final
// value) rather than blindly taking the first match. This is a single-
// message self-correction; a SEPARATE correction reply after a
// confirmation card is already shown (a second message, e.g. "Không, 70
// kg.") is a different case handled at the orchestrator level
// (orchestrator.ts's confirmation-turn correction detection) — that case
// needs no help from this regex since it only ever contains ONE number.
const CORRECTION_CUE_RE = /\b(khong|a khong|y la|doi thanh|sua lai|thanh)\b/;

/** A bare number, optionally followed by "kg"/"cân", within a sane human
 * body-weight range. Rejects anything ambiguous rather than guessing —
 * "khoảng 10" alone (no unit, no context) is NOT parsed as a weight here;
 * the caller decides whether to treat a bare number as an answer based on
 * which slot is actually expected. */
export function parseWeightKg(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  const matches = [...s.matchAll(/(\d{2,3}(?:[.,]\d)?)\s*(kg|ky|can)?/g)];
  if (matches.length === 0) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Bạn có thể cho mình một con số cụ thể, ví dụ '72 kg' không?" };
  let chosen = matches[0];
  if (matches.length > 1) {
    const cueMatch = CORRECTION_CUE_RE.exec(s);
    if (cueMatch) {
      const after = matches.filter((m) => (m.index ?? 0) > cueMatch.index);
      if (after.length > 0) chosen = after[after.length - 1];
    }
  }
  const value = Number(chosen[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 25 || value > 300) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Con số đó có vẻ chưa hợp lý — bạn nhập lại cân nặng (kg) giúp mình nhé?" };
  }
  return { ok: true, value };
}

/** cm height, e.g. "170", "1m70", "170cm". */
export function parseHeightCm(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  const meters = s.match(/(\d)\s*m\s*(\d{2})/); // "1m70"
  if (meters) {
    const value = Number(meters[1]) * 100 + Number(meters[2]);
    if (value >= 100 && value <= 250) return { ok: true, value };
  }
  const match = s.match(/(\d{2,3})\s*(cm)?/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Bạn cho mình chiều cao (cm), ví dụ '170' nhé?" };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 100 || value > 250) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Chiều cao đó có vẻ chưa hợp lý — bạn nhập lại (cm) giúp mình nhé?" };
  }
  return { ok: true, value };
}

export function parseAge(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  const match = s.match(/(\d{1,3})/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Bạn cho mình biết tuổi (số) nhé?" };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 13 || value > 100) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Tuổi đó có vẻ chưa hợp lý — bạn nhập lại giúp mình nhé?" };
  }
  return { ok: true, value };
}

const GENDER_MAP: Record<string, "MALE" | "FEMALE" | "OTHER"> = {
  nam: "MALE", male: "MALE", "trai": "MALE",
  nu: "FEMALE", female: "FEMALE", "gai": "FEMALE",
  khac: "OTHER", other: "OTHER",
};
export function parseGender(raw: string): SlotParseResult<"MALE" | "FEMALE" | "OTHER"> {
  const s = normalizeAgentText(raw).trim();
  for (const [key, value] of Object.entries(GENDER_MAP)) {
    if (new RegExp(`\\b${key}\\b`).test(s)) return { ok: true, value };
  }
  return { ok: false, reason: "unrecognized", clarifyingQuestion: "Bạn là nam, nữ hay khác?" };
}

const GOAL_MAP: Record<string, "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE"> = {};
[["giam mo", "WEIGHT_LOSS"], ["giam can", "WEIGHT_LOSS"], ["fat loss", "WEIGHT_LOSS"], ["lose weight", "WEIGHT_LOSS"],
 ["tang co", "MUSCLE_GAIN"], ["muscle gain", "MUSCLE_GAIN"], ["hypertrophy", "MUSCLE_GAIN"],
 ["duy tri", "MAINTENANCE"], ["maintenance", "MAINTENANCE"],
 ["thanh tich", "ATHLETIC_PERFORMANCE"], ["athletic", "ATHLETIC_PERFORMANCE"], ["strength", "ATHLETIC_PERFORMANCE"]]
  .forEach(([k, v]) => { GOAL_MAP[k] = v as any; });
export function parseGoal(raw: string): SlotParseResult<"WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE"> {
  const s = normalizeAgentText(raw);
  for (const [key, value] of Object.entries(GOAL_MAP)) {
    if (s.includes(key)) return { ok: true, value };
  }
  return { ok: false, reason: "unrecognized", clarifyingQuestion: "Mục tiêu của bạn là giảm mỡ, tăng cơ, duy trì hay hiệu suất thể thao?" };
}

/** "T2-T4-T6", "thứ 2, thứ 4", "3 buổi" (a bare count, not specific days —
 * returned as a count-derived spread starting Monday, matching the existing
 * fallback fitness-agent.service.ts::proposePlanBundle already uses for
 * `trainingDaysPerWeek` without specific days). */
const THU_WORD_DAY: Record<string, number> = { hai: 2, ba: 3, tu: 4, nam: 5, sau: 6, bay: 7 };

export function parseTrainingDays(raw: string): SlotParseResult<number[]> {
  const s = normalizeAgentText(raw);
  const days = new Set<number>();
  // "T2", "T4", "T6" — each day has its own "T" prefix.
  for (const m of s.matchAll(/\bt([2-7])\b/g)) days.add(Number(m[1]) - 1);
  // Codex Evaluation #1 §30 — "thứ 2 4 6" only captured the first day
  // because the old single pattern required a "t"/"thu" prefix on EVERY
  // digit; a real Vietnamese speaker states "thứ" once and lists several
  // day numbers after it. Capture the whole contiguous digit/space/comma
  // run following one "thu" and pull every day number out of it.
  //
  // Codex Evaluation #2 (Remediation #2) — this still failed on "thứ 2 -
  // thứ 4 - thứ 6" -> [1] for two independent reasons: (a) the run's
  // character class didn't include "-", so a hyphen ended the run right
  // after the first digit; (b) `.match()` only ever finds the FIRST "thu"
  // occurrence, so a message that repeats the "thu" cue before every day
  // (rather than stating it once, as "thu 2 4 6" does) never got past day
  // one. Fixed by adding "-" to the run's character class AND iterating
  // every "thu ..." occurrence with `matchAll`, unioning the days found in
  // each — this covers "one thu, many days" and "thu repeated per day"
  // uniformly. The run still stops at the first letter it meets, so a
  // trailing unrelated number is never absorbed: "tập thứ 2, khoảng 60
  // phút" -> the run after "thu" is "2, " (stops at "k" of "khoang"), so
  // day 2 only — the "60" is never reachable. This is NOT blind
  // digit-extraction: every digit here is still anchored to its own "thu"
  // cue via matchAll, never pulled from anywhere else in the sentence.
  for (const m of s.matchAll(/\bthu\s*([2-7][2-7\s,-]*)/g)) {
    for (const d of m[1].match(/[2-7]/g) ?? []) days.add(Number(d) - 1);
  }
  // Spelled-out weekday names ("thứ hai", "thứ tư", "thứ sáu", ...) — each
  // still requires its own "thu" cue immediately before it (a bare "ba"/
  // "sau" elsewhere in the sentence is never treated as a day), same
  // safety property as the digit form above. Canonical mapping mirrors
  // the digit form exactly: "thu hai" == "thu 2" == T2 == index 1, etc.
  for (const m of s.matchAll(/\bthu\s+(hai|ba|tu|nam|sau|bay)\b/g)) {
    days.add(THU_WORD_DAY[m[1]] - 1);
  }
  if (/chu nhat|\bcn\b/.test(s)) days.add(7);
  if (days.size > 0) return { ok: true, value: [...days].sort((a, b) => a - b) };
  const count = s.match(/(\d)\s*(?:buoi|ngay|days?)/);
  if (count) {
    const n = Math.min(7, Math.max(1, Number(count[1])));
    return { ok: true, value: Array.from({ length: n }, (_, i) => i + 1) };
  }
  return { ok: false, reason: "unrecognized", clarifyingQuestion: "Bạn tập được mấy ngày/tuần, hoặc cụ thể là những ngày nào (VD: T2-T4-T6)?" };
}

/** A plain session-COUNT ("3 buổi/tuần", "3", "3 ngày") — distinct from
 * parseTrainingDays, which returns specific weekday indices. Used where a
 * workflow only needs "how many sessions per week", not which ones (e.g.
 * CREATE_WORKOUT_PLAN — the deterministic generator picks its own split by
 * day COUNT, per-weekday scheduling is a separate, later concern). */
export function parseSessionsPerWeek(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  const match = s.match(/(\d)\s*(?:buoi|ngay|sessions?|days?)?/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Bạn muốn tập mấy buổi mỗi tuần (VD: 3)?" };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 1 || value > 7) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Số buổi tập nên từ 1 đến 7 mỗi tuần — bạn nhập lại giúp mình nhé?" };
  }
  return { ok: true, value };
}

/** "chia 4 bữa", "3 bữa/ngày" — CREATE_NUTRITION_PLAN's one genuinely-asked
 * slot (GenerateNutritionPlanRequestSchema bounds mealsPerDay to 2-6, same
 * range enforced here so an out-of-range answer re-asks instead of being
 * silently clamped at the API boundary). */
export function parseMealsPerDay(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  const match = s.match(/(\d)\s*(?:bua|meals?)?/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Bạn muốn chia thành mấy bữa mỗi ngày (2-6)?" };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 2 || value > 6) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Số bữa nên từ 2 đến 6 mỗi ngày — bạn nhập lại giúp mình nhé?" };
  }
  return { ok: true, value };
}

export function parseMinutes(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);
  // Codex Evaluation #1 §32/§44 — "1 tiếng"/"1 giờ" were rejected outright
  // (the old pattern required a 2-3 digit number, and "1" alone is 1
  // digit). Vietnamese commonly states duration in hours; handle
  // "1 giờ"/"1 tiếng"/"1 giờ 30 phút" before falling back to the plain
  // minutes pattern below (which still handles "60 phút" unchanged).
  // Codex Evaluation #2 (Remediation #2) — "1.5 giờ"/"1,5 giờ" returned
  // no_number_found because the hour-count group only accepted whole
  // digits. Vietnamese duration is commonly stated as a decimal hour count
  // ("1.5 giờ", "1,5 giờ" — a decimal point/comma HERE, never a thousands
  // separator; this function shares no regex or logic with
  // parseBudgetVnd's dot/comma-thousands handling). The
  // `(?<![\d.,-])`/`(?![\d.,])` guards mean a candidate number must be a
  // clean, unattached token: they stop a malformed run like "1.2.3 giờ"
  // from being silently sliced into a plausible-looking partial number
  // ("2.3 giờ") — no valid hour-match is found at all for that input, so
  // it falls through to a clarifying failure rather than inventing 138
  // minutes. The same leading guard stops "-1 giờ" from being read as a
  // bare "1 giờ" (60) with the minus sign silently dropped.
  const hourMatch = s.match(/(?<![\d.,-])(\d{1,2}(?:[.,]\d{1,2})?)(?![\d.,])\s*(?:gio|tieng)\s*(?:(\d{1,2})\s*(?:phut)?)?/);
  if (hourMatch) {
    const hours = Number(hourMatch[1].replace(",", "."));
    const extraMinutes = hourMatch[2] ? Number(hourMatch[2]) : 0;
    const value = Math.round(hours * 60 + extraMinutes);
    if (Number.isFinite(value)) {
      // A syntactically valid hour-phrase whose value falls outside the
      // domain's session-length range ("0 giờ", "10 giờ" -> 600 minutes)
      // is a clarifying failure, never silently clamped into range — same
      // domain constraint (10-240) as the plain-minutes path below, just
      // reported explicitly instead of falling through to a vaguer
      // "no_number_found".
      if (value >= 10 && value <= 240) return { ok: true, value };
      return { ok: false, reason: "out_of_range", clarifyingQuestion: "Thời lượng đó có vẻ chưa hợp lý — bạn nhập lại (phút) giúp mình nhé?" };
    }
  }
  const match = s.match(/(\d{2,3})\s*(?:phut|minutes|min)?/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Mỗi buổi bạn có khoảng bao nhiêu phút?" };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 10 || value > 240) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Thời lượng đó có vẻ chưa hợp lý — bạn nhập lại (phút) giúp mình nhé?" };
  }
  return { ok: true, value };
}

function validateBudgetVnd(value: number): SlotParseResult<number> {
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) {
    return { ok: false, reason: "out_of_range", clarifyingQuestion: "Ngân sách đó có vẻ chưa hợp lý — bạn nhập lại giúp mình nhé?" };
  }
  return { ok: true, value };
}

/** VND budget: "1.5 triệu", "1500k", "2tr", "1.500.000", "1tr5". Mirrors
 * fitness-agent-intent.ts's own budget regex for the simple unit-suffixed
 * case, factored out here so both call sites share one parser instead of
 * drifting.
 *
 * Codex Evaluation #1 §15/§31/§39 found two real misreads:
 * "1.500.000" (Vietnamese dot-thousands notation) was read as the decimal
 * 1.5 with no unit -> rounded to 2 VND; "1tr5" (spoken shorthand for "một
 * triệu năm [trăm nghìn]" = 1.5 million) was read as literal "1" + unit
 * "tr5" (no match) falling through to a bare "5" -> 5 VND. Both are fixed
 * below by checking the more specific Vietnamese-only notations BEFORE the
 * generic unit-suffix pattern. */
export function parseBudgetVnd(raw: string): SlotParseResult<number> {
  const s = normalizeAgentText(raw);

  // "1tr5" / "1tr500" / "1 triệu 500" — a single trailing digit after
  // tr/triệu means hundred-thousands (5 -> 500,000); 2-3 trailing digits
  // means a literal thousands count (500 -> 500,000). Both spellings mean
  // the same "X.Y triệu" shorthand real Vietnamese speakers use.
  const shorthand = s.match(/(\d+)\s*(?:tr|trieu)\s*(\d{1,3})\b/);
  if (shorthand) {
    const base = Number(shorthand[1]) * 1_000_000;
    const digits = shorthand[2];
    const extra = digits.length === 1 ? Number(digits) * 100_000 : Number(digits) * 1_000;
    return validateBudgetVnd(base + extra);
  }

  // "1.500.000" / "1,500,000" — two-or-more 3-digit groups after a
  // separator is Vietnamese/thousands-grouping notation, never a decimal
  // (a real decimal like "1.5 triệu" only ever has ONE separator group and
  // is handled by the generic pattern below, which requires a unit).
  const thousandsGrouped = s.match(/\b(\d{1,3}(?:[.,]\d{3}){2,})\b/);
  if (thousandsGrouped) {
    return validateBudgetVnd(Number(thousandsGrouped[1].replace(/[.,]/g, "")));
  }

  const match = s.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr|m|million|k|nghin)?\b/);
  if (!match) return { ok: false, reason: "no_number_found", clarifyingQuestion: "Ngân sách của bạn khoảng bao nhiêu (VD: 1.5 triệu)?" };
  const unit = match[2] ?? "";
  const value = Math.round(Number(match[1].replace(",", ".")) * (/^(trieu|tr|m|million)$/.test(unit) ? 1e6 : /^(k|nghin)$/.test(unit) ? 1000 : 1));
  return validateBudgetVnd(value);
}
