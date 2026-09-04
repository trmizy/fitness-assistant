import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInBodyQuality } from "../services/inbody-quality.evaluator";
import type { InBodyEntrySnapshot } from "../clients/user.client";

function entry(overrides: Partial<InBodyEntrySnapshot>): InBodyEntrySnapshot {
  return {
    id: "id",
    date: "2026-06-01",
    weight: 75,
    bodyFatPct: 18,
    muscleMass: 32,
    visceralFat: 8,
    bmr: 1700,
    status: "manual",
    ...overrides,
  };
}

test("single measurement: insufficient data, low confidence, no conclusion drawn", () => {
  const result = evaluateInBodyQuality([entry({ id: "a", date: "2026-06-01" })]);
  assert.equal(result.recordCount, 1);
  assert.equal(result.hasSufficientData, false);
  assert.equal(result.confidenceMultiplier, 0.3);
  assert.ok(result.qualityFlags.some((f) => /1 lần đo InBody/i.test(f)));
});

test("two normal, well-spaced measurements: sufficient data, high confidence, no outliers", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75, bodyFatPct: 18, muscleMass: 32 }),
    entry({ id: "b", date: "2026-06-29", weight: 74, bodyFatPct: 17, muscleMass: 32.5 }),
  ]);
  assert.equal(result.recordCount, 2);
  assert.equal(result.outlierFlags.length, 0);
  assert.equal(result.comparableRecordCount, 2);
  assert.equal(result.hasSufficientData, true);
  assert.ok(result.confidenceMultiplier >= 0.9);
});

test("implausible weight swing between two close entries is flagged as an outlier and excluded from trend", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75 }),
    // +5kg in 2 days — far exceeds maxPlausibleWeightChangeKgPerDay (0.35kg/day default)
    entry({ id: "b", date: "2026-06-03", weight: 80 }),
  ]);
  assert.equal(result.outlierFlags.length, 1);
  assert.equal(result.outlierFlags[0].entryId, "b");
  assert.equal(result.comparableRecordCount, 1);
  assert.ok(!result.comparablePoints.some((p) => p.entryId === "b"));
});

test("implausible body-fat-pct swing is flagged as an outlier independent of weight", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75, bodyFatPct: 18 }),
    // weight barely moved (plausible) but bodyFatPct jumped 5pp in 10 days — exceeds the 3pp threshold
    entry({ id: "b", date: "2026-06-11", weight: 75.2, bodyFatPct: 23 }),
  ]);
  assert.equal(result.outlierFlags.length, 1);
  // Messages are Vietnamese (user-facing — see §9 Vietnamese-ization fix);
  // match on "mỡ cơ thể" (body fat) rather than the old English wording.
  assert.match(result.outlierFlags[0].reason, /mỡ cơ thể/i);
});

test("entries closer than the minimum meaningful interval get an interval warning, not an outlier flag", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75 }),
    entry({ id: "b", date: "2026-06-02", weight: 75.1 }), // 1 day apart, plausible weight change
  ]);
  assert.equal(result.outlierFlags.length, 0);
  assert.equal(result.intervalWarnings.length, 1);
  assert.equal(result.intervalWarnings[0].entryId, "b");
});

test("mixed measurement sources (manual vs extracted) produce a device-consistency warning that lowers confidence", () => {
  const consistent = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", status: "manual" }),
    entry({ id: "b", date: "2026-06-15", status: "manual" }),
  ]);
  const mixed = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", status: "manual" }),
    entry({ id: "b", date: "2026-06-15", status: "extracted" }),
  ]);
  assert.equal(consistent.deviceConsistencyWarning, null);
  assert.ok(mixed.deviceConsistencyWarning);
  assert.ok(mixed.confidenceMultiplier < consistent.confidenceMultiplier);
});

test("weightWaterConflict is always false — documented no-op since InBodyEntry has no total-body-water field", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75 }),
    entry({ id: "b", date: "2026-06-15", weight: 70 }), // large swing that WOULD trigger the rule if TBW existed
  ]);
  assert.equal(result.weightWaterConflict, false);
});

test("outliers are flagged, never deleted — original record still counted in recordCount", () => {
  const result = evaluateInBodyQuality([
    entry({ id: "a", date: "2026-06-01", weight: 75 }),
    entry({ id: "b", date: "2026-06-03", weight: 80 }), // outlier
  ]);
  assert.equal(result.recordCount, 2); // both entries still counted
  assert.equal(result.comparableRecordCount, 1); // but only 1 usable for trend
});

test("empty input returns zero confidence and no comparable points", () => {
  const result = evaluateInBodyQuality([]);
  assert.equal(result.recordCount, 0);
  assert.equal(result.confidenceMultiplier, 0);
  assert.equal(result.comparablePoints.length, 0);
});
