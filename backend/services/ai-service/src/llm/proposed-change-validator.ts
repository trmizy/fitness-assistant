/**
 * Semantic (not just type-enum) validation for AssessCycleOutput's
 * proposedChanges — the free-text fields (target/currentValue/proposedValue)
 * have no Zod-level plausibility check, only cycle-assessment.service.ts's
 * existing filter against `allowedChanges` (change TYPE, e.g. VOLUME/LOAD).
 * This module adds the missing check on the VALUES: a numeric jump the
 * Decision Engine's own recommendedActionScope would never actually call
 * for (e.g. an LLM proposing to double training load in one cycle when the
 * engine only authorized a "minor_adjustment"). See
 * docs/TRAINING_CYCLE_DECISION_ENGINE.md §5 / CLOUDCODE_IMPLEMENTATION_AUDIT.md.
 *
 * Same principle as meal-plan-validator.ts: the LLM is never trusted to
 * self-police its own numbers — code filters what actually reaches the user.
 */
import type { z } from "zod";
import type { ProposedChangeSchema } from "../schemas/cycle-assessment.schemas";

export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

/** Change types where currentValue/proposedValue are expected to be
 * comparable numeric magnitudes (grams, kg, reps, sessions/week...).
 * EXERCISE swaps have no numeric meaning (target is an exercise name) and
 * are exempt from the magnitude check. */
const NUMERIC_CHANGE_TYPES = new Set(["VOLUME", "LOAD", "REPS", "FREQUENCY"]);

/** Beyond this relative change, a single-cycle "minor adjustment" is not
 * plausible regardless of decision — even DELOAD (the largest legitimate
 * single-step change this engine authorizes) is a reduction, not a 2x+
 * swing. A product-safety rail against a garbled/hallucinated number, not
 * a personalized training-load limit. */
const MAX_PLAUSIBLE_RELATIVE_CHANGE = 0.6; // 60%

/** Stricter cap for BEGINNER/UNKNOWN users (docs/USER_LEVEL_PERSONALIZATION_PLAN.md
 * §A: "volume mặc định dưới ngưỡng tối thiểu... chưa cần tối ưu hoá volume
 * ngay"). This is the concrete, code-enforced backstop for "beginners must
 * never receive a high volume/intensity jump" — independent of whatever the
 * LLM's free-text reasoning says, and independent of the prompt-level
 * instruction in cycle-assessment.service.ts (which the model could ignore). */
const MAX_PLAUSIBLE_RELATIVE_CHANGE_BEGINNER = 0.2; // 20%

// A number token: thousands grouping ("38.225", "38,225", "1.000.000") or a plain decimal ("62,5", "2.5"). Grouping is recognised
// ONLY for groups of exactly three digits, so "2.5" / "62,5" stay decimals while Vietnamese "38.225 kg" is 38225.
const NUM = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?)`;
const GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/;
const toNumber = (raw: string): number => (GROUPED.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", ".")));

/** A leading period label such as "tuần 4:", "week 2 -", "buổi 3:" is NOT the value: its number is an index, not a magnitude. */
const PERIOD_LABEL = /^\s*(?:tuần|tuan|week|wk|buổi|buoi|ngày|ngay|day|chu kỳ|chu ky|cycle|session|lần|lan)\s*\d+\s*[:：]\s*/i;
/** Units that mark a number as the magnitude itself (preferred over any other number in the text). */
const UNIT_AFTER = new RegExp(`(${NUM})\\s*(?:kg|lbs?|reps?|rep|lần|lan|sets?|buổi|buoi|kcal|cal|g|gam|phút|phut|min|%)(?![a-zà-ỹ])`, "i");

/**
 * The comparable magnitude of a free-text value. The old version read only the FIRST number, which is wrong for the two shapes a
 * training prescription is usually written in:
 *  - "3x10" / "3 sets x 10 reps"  -> sets x reps. Reading only "3" let "3x8 -> 3x12" (+50% volume) through as 0% and judged
 *    "3x10 -> 4x10" by sets alone;
 *  - "8-10 reps" / "8–10"          -> a range; its midpoint is the honest single number ("8-10 -> 10-12" is 9 -> 11, not 8 -> 10).
 * Anything else keeps the previous behaviour (first number), so "60kg" / "2.5 sessions" are unchanged. Returns null when there is no
 * number at all (the caller then treats the pair as not checkable, as before).
 */
export function extractLeadingNumber(value: string): number | null {
  const text = value.trim().replace(PERIOD_LABEL, "");
  const product = text.match(new RegExp(`(${NUM})\\s*(?:sets?\\s*)?[x×*]\\s*(${NUM})`, "i"));
  if (product) {
    const n = toNumber(product[1]) * toNumber(product[2]);
    return Number.isFinite(n) ? n : null;
  }
  const range = text.match(new RegExp(`(${NUM})\\s*[-–—]\\s*(${NUM})`));
  if (range) {
    const n = (toNumber(range[1]) + toNumber(range[2])) / 2;
    return Number.isFinite(n) ? n : null;
  }
  // A number carrying a unit ("38225 kg") is the magnitude, even when another number came first in the text.
  const withUnit = text.match(UNIT_AFTER);
  if (withUnit) {
    const n = toNumber(withUnit[1]);
    return Number.isFinite(n) ? n : null;
  }
  const match = text.match(new RegExp(`-?${NUM}`));
  if (!match) return null;
  const n = toNumber(match[0].replace(/^-/, "")) * (match[0].startsWith("-") ? -1 : 1);
  return Number.isFinite(n) ? n : null;
}

export interface ProposedChangeValidationResult {
  valid: ProposedChange[];
  dropped: Array<{ change: ProposedChange; reason: string }>;
}

/**
 * Filters out proposedChanges whose target is empty/unusably long, or
 * whose numeric current->proposed jump is implausibly large for a single
 * cycle recommendation. Never "fixes" a value (unlike meal-plan-validator's
 * calorieTarget correction) — a free-text field like "8-10 reps" has no
 * single unambiguous correct value to substitute, so an implausible entry
 * is simply dropped, same as the existing allowedChanges type filter.
 */
export function validateProposedChanges(
  changes: ProposedChange[],
  options: { isBeginner?: boolean } = {},
): ProposedChangeValidationResult {
  const valid: ProposedChange[] = [];
  const dropped: Array<{ change: ProposedChange; reason: string }> = [];
  const maxRelativeChange = options.isBeginner ? MAX_PLAUSIBLE_RELATIVE_CHANGE_BEGINNER : MAX_PLAUSIBLE_RELATIVE_CHANGE;

  for (const change of changes) {
    if (!change.target.trim() || change.target.length > 200) {
      dropped.push({ change, reason: "empty or implausibly long target" });
      continue;
    }

    if (!NUMERIC_CHANGE_TYPES.has(change.type)) {
      valid.push(change);
      continue;
    }

    const current = extractLeadingNumber(change.currentValue);
    const proposed = extractLeadingNumber(change.proposedValue);
    if (current == null || proposed == null || current === 0) {
      // Can't evaluate magnitude (non-numeric text on either side, or a
      // zero baseline) — not evidence of a problem, just not checkable
      // here. Let it through; the type-enum + allowedChanges filter
      // already constrains what kind of change this can be.
      valid.push(change);
      continue;
    }

    const relativeChange = Math.abs(proposed - current) / Math.abs(current);
    if (relativeChange > maxRelativeChange) {
      dropped.push({
        change,
        reason: `implausible ${change.type} jump: ${change.currentValue} -> ${change.proposedValue} (${Math.round(relativeChange * 100)}% change, max plausible ${maxRelativeChange * 100}%)`,
      });
      continue;
    }

    valid.push(change);
  }

  return { valid, dropped };
}
