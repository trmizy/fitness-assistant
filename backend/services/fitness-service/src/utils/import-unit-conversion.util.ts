/**
 * Roadmap P2.2 "Strong import" + P2.3 "FitNotes import" (docs/features/
 * STRONG_IMPORT_IMPACT_ANALYSIS.md, docs/features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md).
 *
 * Both providers export weight/distance with a PER-ROW unit (unlike
 * Hevy, which always exports weight_kg) — this conversion logic was
 * first written for Strong import and is reused unchanged here rather
 * than reimplemented a second time.
 */

const LB_TO_KG = 0.45359237;
const MI_TO_M = 1609.344;

/** Converts a weight value to kg. Unrecognized/unspecified units pass
 * through unchanged — "kg" (or nothing) is this app's own default. */
export function convertWeightToKg(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  const u = unit?.trim().toLowerCase();
  if (u === "lb" || u === "lbs") return value * LB_TO_KG;
  return value;
}

/** Converts a distance value to meters. Unrecognized/unspecified units
 * are treated as km — the provider's own typical default distance
 * unit. */
export function convertDistanceToMeters(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  const u = unit?.trim().toLowerCase();
  if (u === "mi" || u === "mile" || u === "miles") return value * MI_TO_M;
  if (u === "m" || u === "meter" || u === "meters") return value;
  return value * 1000; // "km" or unspecified
}
