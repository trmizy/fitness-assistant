/**
 * Run with: npx tsx --test src/__tests__/weight-trend.util.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightTrend, type WeightTrendConfig } from "../services/weight-trend.util";

const config: WeightTrendConfig = {
  minWeightSamples: 4,
  trendWindowDays: 14,
  highConfidenceSamples: 7,
};

test("no samples at all: trendWeight/latestWeight null, LOW confidence, never fabricated", () => {
  const result = computeWeightTrend([], new Date("2026-08-18"), config);
  assert.deepEqual(result, {
    trendWeight: null,
    latestWeight: null,
    sampleCount: 0,
    confidence: "LOW",
    windowDays: 14,
  });
});

test("fewer samples than minWeightSamples: LOW confidence even if the numbers look clean", () => {
  const result = computeWeightTrend(
    [
      { date: "2026-08-16", weight: 78.0 },
      { date: "2026-08-17", weight: 78.1 },
    ],
    new Date("2026-08-18"),
    config,
  );
  assert.equal(result.confidence, "LOW");
  assert.equal(result.sampleCount, 2);
});

// Spec §44 — noisy weight must not itself move the plan. A single spiky day
// only shifts the average by 1/N, it never becomes "the" reading.
test("a noisy single-day spike is smoothed by the moving average, not treated as the new reading", () => {
  const result = computeWeightTrend(
    [
      { date: "2026-08-13", weight: 78.1 },
      { date: "2026-08-14", weight: 79.0 }, // spike (water/sodium/meal timing)
      { date: "2026-08-15", weight: 78.0 },
      { date: "2026-08-16", weight: 78.2 },
      { date: "2026-08-17", weight: 78.1 },
    ],
    new Date("2026-08-18"),
    config,
  );
  assert.equal(result.latestWeight, 78.1); // most recent reading, unsmoothed
  assert.notEqual(result.trendWeight, 79.0); // the spike never becomes the reported trend
  assert.equal(result.trendWeight, 78.3); // (78.1+79.0+78.0+78.2+78.1)/5 = 78.28, rounded to 1dp
});

test("exactly minWeightSamples reaches MEDIUM (not LOW, not yet HIGH)", () => {
  const samples = [78, 77.9, 77.8, 77.7].map((weight, i) => ({
    date: `2026-08-1${4 + i}`,
    weight,
  }));
  const result = computeWeightTrend(samples, new Date("2026-08-18"), config);
  assert.equal(result.sampleCount, 4);
  assert.equal(result.confidence, "MEDIUM");
});

test("reaching highConfidenceSamples flips confidence to HIGH", () => {
  const samples = [80, 79.8, 79.6, 79.5, 79.3, 79.1, 79.0].map((weight, i) => ({
    date: `2026-08-1${1 + i}`,
    weight,
  }));
  const result = computeWeightTrend(samples, new Date("2026-08-18"), config);
  assert.equal(result.sampleCount, 7);
  assert.equal(result.confidence, "HIGH");
});

test("samples outside the trend window are excluded from both the average and the count", () => {
  const result = computeWeightTrend(
    [
      { date: "2026-07-01", weight: 90 }, // ~48 days ago — well outside a 14-day window
      { date: "2026-08-15", weight: 78.0 },
      { date: "2026-08-16", weight: 78.1 },
      { date: "2026-08-17", weight: 78.2 },
      { date: "2026-08-18", weight: 78.3 },
    ],
    new Date("2026-08-18"),
    config,
  );
  assert.equal(result.sampleCount, 4);
  assert.equal(result.trendWeight, 78.2); // (78.0+78.1+78.2+78.3)/4 = 78.15, rounded to 1dp
});

test("an unparseable date is excluded rather than crashing or corrupting the average", () => {
  const result = computeWeightTrend(
    [
      { date: "not-a-date", weight: 999 },
      { date: "2026-08-17", weight: 78.0 },
      { date: "2026-08-18", weight: 78.0 },
    ],
    new Date("2026-08-18"),
    config,
  );
  assert.equal(result.sampleCount, 2);
  assert.equal(result.trendWeight, 78.0);
});

test("latestWeight is the single most recent in-window reading, not the average", () => {
  const result = computeWeightTrend(
    [
      { date: "2026-08-16", weight: 80 },
      { date: "2026-08-17", weight: 79 },
      { date: "2026-08-18", weight: 77 },
    ],
    new Date("2026-08-18"),
    config,
  );
  assert.equal(result.latestWeight, 77);
  assert.notEqual(result.trendWeight, result.latestWeight);
});
