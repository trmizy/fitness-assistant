/**
 * Pure rolling weight-trend computation — kept dependency-free and DB-free
 * so it's directly unit-testable with node:test (this repo's established
 * convention; see cycle-metrics.engine.test.ts for the same pattern in
 * this service).
 *
 * Root-cause context (real-time body profile refactor, spec §8): a single
 * day's weight reading is noisy (water, meal timing, measurement
 * conditions — see BODYCOMP-002 in docs/research/fitness-nutrition-evidence.md)
 * and must never by itself drive an adaptive nutrition decision. This
 * computes a smoothed `trendWeight` plus a confidence label from however
 * many readings actually exist in the trailing window, using thresholds
 * from cycleThresholds.weightTrend (never hard-coded here — spec §26).
 *
 * This is an ENGINEERING HEURISTIC (a smoothing window), not a scientific
 * model of true body-weight change — it must never be described to users
 * or the AI as more precise than that. See PRODUCT_HEURISTIC labeling in
 * docs/research/fitness-nutrition-evidence.md.
 */

export type TrendConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface WeightSample {
  date: string | Date;
  weight: number;
}

export interface WeightTrendConfig {
  minWeightSamples: number;
  trendWindowDays: number;
  highConfidenceSamples: number;
}

export interface WeightTrendResult {
  /** Simple moving average over the in-window samples, or null if there are
   * none at all — never fabricated. */
  trendWeight: number | null;
  /** The single most recent in-window reading — distinct from trendWeight;
   * see spec §8's latestWeight vs trendWeight distinction. */
  latestWeight: number | null;
  sampleCount: number;
  confidence: TrendConfidence;
  windowDays: number;
}

export function computeWeightTrend(
  samples: readonly WeightSample[],
  asOf: Date,
  config: WeightTrendConfig,
): WeightTrendResult {
  const windowStartMs = asOf.getTime() - config.trendWindowDays * 86_400_000;
  const inWindow = samples
    .filter((s) => {
      const t = new Date(s.date).getTime();
      return Number.isFinite(t) && t >= windowStartMs && t <= asOf.getTime();
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const sampleCount = inWindow.length;

  if (sampleCount === 0) {
    return {
      trendWeight: null,
      latestWeight: null,
      sampleCount: 0,
      confidence: "LOW",
      windowDays: config.trendWindowDays,
    };
  }

  const latestWeight = inWindow[inWindow.length - 1].weight;
  const sum = inWindow.reduce((acc, s) => acc + s.weight, 0);
  const trendWeight = Math.round((sum / sampleCount) * 10) / 10;

  let confidence: TrendConfidence;
  if (sampleCount < config.minWeightSamples) {
    confidence = "LOW";
  } else if (sampleCount >= config.highConfidenceSamples) {
    confidence = "HIGH";
  } else {
    confidence = "MEDIUM";
  }

  return { trendWeight, latestWeight, sampleCount, confidence, windowDays: config.trendWindowDays };
}
