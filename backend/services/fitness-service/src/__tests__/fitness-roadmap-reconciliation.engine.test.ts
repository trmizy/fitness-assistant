import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcilePhase,
  buildForecastChangeExplanation,
  type ActualPhaseOutcome,
} from "../services/fitness-roadmap-reconciliation.engine";

function original(overrides: Partial<{
  phaseIndex: number;
  projectedStartWeightKg: number;
  projectedEndWeightKg: number;
  projectedStartBodyFatPct: number | null;
  projectedEndBodyFatPct: number | null;
}> = {}) {
  return {
    phaseIndex: 1,
    projectedStartWeightKg: 82,
    projectedEndWeightKg: 79.6,
    projectedStartBodyFatPct: 22,
    projectedEndBodyFatPct: 20.2,
    ...overrides,
  };
}

function actual(overrides: Partial<ActualPhaseOutcome> = {}): ActualPhaseOutcome {
  return {
    weightKg: null,
    bodyFatPct: null,
    measuredAt: null,
    adherenceRate: null,
    strengthProgressScore: null,
    ...overrides,
  };
}

test("reconcilePhase: expected 79.6, actual 80.1 -> delta +0.5, matches the master task's own worked example", () => {
  const result = reconcilePhase(original(), actual({ weightKg: 80.1, measuredAt: "2026-10-10" }));
  assert.equal(result.weight!.delta, 0.5);
  assert.equal(result.weight!.expected, 79.6);
  assert.equal(result.weight!.actual, 80.1);
});

test("reconcilePhase: no actual measurement -> INSUFFICIENT_DATA, never a fabricated comparison", () => {
  const result = reconcilePhase(original(), actual());
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.weight, null);
  assert.equal(result.bodyFat, null);
});

test("reconcilePhase: weight closely matched forecast -> ON_TRACK", () => {
  const result = reconcilePhase(original(), actual({ weightKg: 79.7, measuredAt: "2026-10-10" }));
  assert.equal(result.status, "ON_TRACK");
});

test("reconcilePhase: weight change significantly exceeded forecast -> AHEAD_OF_FORECAST", () => {
  // expected delta = -2.4kg; actual delta = -3.5kg -> ratio ~1.46
  const result = reconcilePhase(original(), actual({ weightKg: 78.5, measuredAt: "2026-10-10" }));
  assert.equal(result.status, "AHEAD_OF_FORECAST");
});

test("reconcilePhase: weight behind forecast BUT adherence strong -> ON_TRACK, never an automatic failure label (master task §12)", () => {
  // expected delta -2.4kg; actual delta only -0.5kg (weight loss much slower than forecast)
  const result = reconcilePhase(original(), actual({ weightKg: 81.5, measuredAt: "2026-10-10", adherenceRate: 0.92, strengthProgressScore: 0.041 }));
  assert.equal(result.status, "ON_TRACK");
  assert.ok(result.reasonCodes.includes("WEIGHT_BEHIND_BUT_ADHERENCE_STRONG"));
});

test("reconcilePhase: weight behind forecast BUT strength improving -> ON_TRACK", () => {
  const result = reconcilePhase(original(), actual({ weightKg: 81.5, measuredAt: "2026-10-10", adherenceRate: 0.4, strengthProgressScore: 0.6 }));
  assert.equal(result.status, "ON_TRACK");
  assert.ok(result.reasonCodes.includes("WEIGHT_BEHIND_BUT_PERFORMANCE_STRONG"));
});

test("reconcilePhase: weight behind forecast AND adherence/strength both weak -> BEHIND_FORECAST", () => {
  const result = reconcilePhase(original(), actual({ weightKg: 81.8, measuredAt: "2026-10-10", adherenceRate: 0.4, strengthProgressScore: 0.1 }));
  assert.equal(result.status, "BEHIND_FORECAST");
});

test("reconcilePhase: reconciliation never emits or references a CycleAssessment decision value", () => {
  const result = reconcilePhase(original(), actual({ weightKg: 80.1, measuredAt: "2026-10-10" }));
  const json = JSON.stringify(result);
  assert.ok(!/KEEP|PROGRESS|ADJUST|DELOAD|REBUILD/.test(json));
});

test("reconcilePhase: a maintenance-style phase (near-zero expected delta) judged by closeness, not a meaningless ratio", () => {
  const maintOriginal = original({ projectedStartWeightKg: 79.6, projectedEndWeightKg: 79.6 });
  const closeResult = reconcilePhase(maintOriginal, actual({ weightKg: 79.8, measuredAt: "2026-10-10" }));
  assert.equal(closeResult.status, "ON_TRACK");
  const farResult = reconcilePhase(maintOriginal, actual({ weightKg: 81.5, measuredAt: "2026-10-10" }));
  assert.equal(farResult.status, "BEHIND_FORECAST");
});

test("reconcilePhase: body-fat comparison present only when both original and actual have a value", () => {
  const withOriginalOnly = reconcilePhase(
    original({ projectedEndBodyFatPct: 20.2 }),
    actual({ weightKg: 80, measuredAt: "2026-10-10", bodyFatPct: null }),
  );
  assert.equal(withOriginalOnly.bodyFat, null);

  const withBoth = reconcilePhase(
    original({ projectedEndBodyFatPct: 20.2 }),
    actual({ weightKg: 80, measuredAt: "2026-10-10", bodyFatPct: 21.0 }),
  );
  assert.ok(withBoth.bodyFat);
  assert.equal(withBoth.bodyFat!.delta, 0.8);
});

// ── buildForecastChangeExplanation ──────────────────────────────────────

test("buildForecastChangeExplanation: deterministic Vietnamese text, never blames the user", () => {
  const text = buildForecastChangeExplanation(["FORECAST_UPDATED_FROM_NEW_WEIGHT"]);
  assert.ok(text.includes("cân nặng thực tế khác với kịch bản ban đầu"));
  assert.ok(!/thất bại|không tuân thủ/i.test(text));
});

test("buildForecastChangeExplanation: empty codes -> empty string, never fabricated text", () => {
  assert.equal(buildForecastChangeExplanation([]), "");
});

test("buildForecastChangeExplanation: multiple reasons combine into one sentence", () => {
  const text = buildForecastChangeExplanation(["FORECAST_UPDATED_FROM_NEW_WEIGHT", "ROADMAP_REBUILT"]);
  assert.ok(text.includes("cân nặng thực tế"));
  assert.ok(text.includes("xây dựng lại"));
});
