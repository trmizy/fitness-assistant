/**
 * Pure decision logic for the "journey start" weight rule — kept
 * dependency-free and DB-free so it's directly unit-testable with
 * node:test (this repo's established convention; see
 * RulerSlider.utils.ts / RulerSlider.utils.test.ts and
 * workout-log-url.utils.ts for the same pattern).
 *
 * Extracted out of profileRepository.upsert so the actual DB write stays a
 * thin wrapper and this rule — the fix for the root-cause bug where a new
 * InBody measurement had no way to be distinguished from the user's
 * original starting weight — can be tested without a live database.
 */

export type StartingWeightSource = "ONBOARDING" | "INBODY";

export interface StartingWeightPatchInput {
  /** The profile's current `startingWeight` value, or null/undefined if
   * this profile doesn't exist yet or has never had one set. */
  existingStartingWeight: number | null | undefined;
  /** The `currentWeight` this write is about to set, if any. Only a
   * numeric value can ever trigger setting startingWeight. */
  incomingCurrentWeight: unknown;
  source: StartingWeightSource;
}

export interface StartingWeightPatch {
  startingWeight: number;
  startingWeightSource: StartingWeightSource;
}

/**
 * Decides whether this write should also capture `startingWeight` — i.e.
 * whether this is the first time this profile has ever had a real weight
 * value written to it. Returns null when the write should leave
 * `startingWeight` untouched (already set, or this write isn't setting a
 * numeric `currentWeight` in the first place).
 *
 * This function is the entire "baseline is immutable within a profile's
 * lifetime" rule — everything else is plumbing.
 */
export function computeStartingWeightPatch(
  input: StartingWeightPatchInput,
): StartingWeightPatch | null {
  if (typeof input.incomingCurrentWeight !== "number") return null;
  if (!Number.isFinite(input.incomingCurrentWeight)) return null;
  if (input.existingStartingWeight != null) return null;
  return {
    startingWeight: input.incomingCurrentWeight,
    startingWeightSource: input.source,
  };
}
