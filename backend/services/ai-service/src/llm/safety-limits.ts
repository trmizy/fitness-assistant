/**
 * Shared size limit for an untrusted user question (the text that reaches the safety guard and the V2 supervisor).
 *
 * UNIT: JavaScript UTF-16 code units, i.e. `string.length` — exactly what zod's `.max()` counts. It is NOT grapheme clusters and
 * NOT Unicode code points: an astral character (most emoji) counts as 2, a precomposed Vietnamese letter ("ế") as 1, and the same
 * letter decomposed (NFD, base + combining marks) as up to 3. The safety guard normalizes text (NFC / NFD) while scanning, so the
 * PROCESSED length can reach up to about 3x this value (a single-tone letter such as "á" is 2 units under NFD -> 4,000; a stacked-mark
 * letter such as "ế" is 3 units -> 6,000 for 2,000 letters); the cost envelope of the detectors must be sized at that expanded length,
 * not at 2,000. (Measured by the M7 bounded-computation work: SIL-6 asserts these lengths.)
 *
 * Single source of truth for: the V1 `AskRequestSchema` (POST /ai/ask, /ai/ask/stream), the V2 `AskV2Schema` (POST /ai/v2/ask) and
 * the function-level fail-closed check in agent-v2/answer-guards `checkInputSafety`. The V2 supervisor and bounded agent keep their
 * own `maxQuestionChars: 2_000` (agent-v2/bounded-agent.ts PILOT_LIMITS); a test asserts they equal this constant.
 *
 * An over-limit question is REJECTED (never truncated, never scanned): truncation would let an attacker choose which part of the
 * text the guard sees.
 */
export const MAX_QUESTION_CHARS = 2000;
