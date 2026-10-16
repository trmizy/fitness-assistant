import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBodyGoalState,
  normalizeBodyLookbackDays,
  type BodyGoalInputs,
} from "../services/body-goal-state.service";
import { evaluateInBodyQuality } from "../services/inbody-quality.evaluator";
import { computeBodyCompositionTrends } from "../services/cycle-metrics.engine";

// Phase 4.4 — DB-free coverage of body state / goal gap / observed trajectory.
// Every trend/quality number is produced by the REAL existing functions; assertions compare against them.

const ASOF = new Date("2026-10-10T12:00:00.000Z");
let n = 0;
function entry(date: string, weight: number, over: Partial<BodyGoalInputs["entries"][number]> = {}) {
  return { id: `e${++n}`, date: `${date}T07:00:00.000Z`, weight, bodyFatPct: 20, muscleMass: 33, status: "manual", ...over } as BodyGoalInputs["entries"][number];
}
const build = (o: Partial<BodyGoalInputs> = {}) =>
  buildBodyGoalState({ asOf: ASOF, lookbackDays: 90, entries: [], profile: null, activeCycle: null, roadmap: null, ...o });

test("lookback is explicit and bounded (not the training 28 days)", () => {
  assert.equal(normalizeBodyLookbackDays(undefined), 90);
  assert.throws(() => normalizeBodyLookbackDays(7), RangeError);
  assert.throws(() => normalizeBodyLookbackDays(400), RangeError);
});

test("NO BODY DATA: body NO_DATA; target present; gap unavailable (no current weight); no fabricated trend", () => {
  const s = build({ profile: { goal: "WEIGHT_LOSS", targetWeight: 75, currentWeight: null } });
  assert.equal(s.body.dataQuality, "NO_DATA");
  assert.equal(s.body.latest, null);
  assert.equal(s.body.trends.weight.status, "INSUFFICIENT_HISTORY");
  assert.equal(s.goal.currentTarget.state, "AVAILABLE");
  assert.deepEqual(s.goal.gap, { state: "NOT_AVAILABLE", reason: "NO_CURRENT_WEIGHT" });
  assert.equal(s.goal.trajectory.observed.state, "NOT_AVAILABLE");
});

test("SINGLE MEASUREMENT: latest state yes; trend NOT available (engine's n=1 'flat' is not exposed)", () => {
  const e = entry("2026-10-05", 82);
  // proves the trap exists in the reused engine
  assert.equal(computeBodyCompositionTrends(evaluateInBodyQuality([e]).comparablePoints).bodyWeightTrend?.direction, "flat");
  const s = build({ entries: [e] });
  assert.equal(s.body.latest?.weightKg, 82);
  assert.equal(s.body.dataQuality, "INSUFFICIENT_HISTORY");
  assert.deepEqual(s.body.trends.weight, { status: "INSUFFICIENT_HISTORY", dataPoints: 1 });
  assert.equal(s.body.trends.bodyFat.status, "INSUFFICIENT_HISTORY");
  assert.ok(!("direction" in s.body.trends.weight));
  assert.equal(s.goal.trajectory.observed.state, "NOT_AVAILABLE");
});

test("MULTIPLE MEASUREMENTS: trend equals the existing engine's result; direction vocabulary neutral", () => {
  const entries = [entry("2026-08-20", 86), entry("2026-09-05", 84.5), entry("2026-09-20", 83.2), entry("2026-10-05", 82)];
  const expected = computeBodyCompositionTrends(evaluateInBodyQuality(entries).comparablePoints).bodyWeightTrend!;
  const s = build({ entries });
  assert.equal(s.body.trends.weight.status, "AVAILABLE");
  assert.equal(s.body.trends.weight.changePerWeek, expected.changePerWeek);
  assert.equal(s.body.trends.weight.dataPoints, expected.dataPoints);
  assert.equal(s.body.trends.weight.direction, "DOWN");
  assert.equal(s.body.dataQuality, "SUFFICIENT");
  assert.equal(s.body.observations.inLookback, 4);
  assert.equal(s.body.previous?.weightKg, 83.2);
  assert.ok(!JSON.stringify(s).match(/IMPROVING|WORSENING|GOOD|BAD/));
});

test("CURRENT WEIGHT DISAGREEMENT: measured wins the gap, profile value kept visible, difference explicit", () => {
  const s = build({
    entries: [entry("2026-10-01", 82), entry("2026-10-08", 82.4)],
    profile: { goal: "WEIGHT_LOSS", targetWeight: 75, currentWeight: 80 },
  });
  assert.equal(s.body.profileReportedWeight?.kg, 80);
  assert.equal(s.body.profileReportedWeight?.matchesLatestMeasurement, false);
  assert.equal(s.body.profileReportedWeight?.differenceFromLatestKg, -2.4);
  assert.equal(s.goal.gap.state, "AVAILABLE");
  if (s.goal.gap.state === "AVAILABLE") {
    assert.equal(s.goal.gap.currentSource, "MEASURED_INBODY");
    assert.equal(s.goal.gap.currentKg, 82.4);
    assert.deepEqual(s.goal.gap.alternateCurrent, { source: "PROFILE_REPORTED", kg: 80, differenceKg: -2.4 });
  }
});

test("TARGET GAP: 82 vs 75 → explicit current, target, signed difference and absolute; no judgement words", () => {
  const s = build({ entries: [entry("2026-10-01", 82)], profile: { goal: "WEIGHT_LOSS", targetWeight: 75 } });
  assert.deepEqual(
    s.goal.gap,
    { state: "AVAILABLE", currentKg: 82, targetKg: 75, differenceKg: 7, absoluteKg: 7, currentSource: "MEASURED_INBODY", currentAsOf: "2026-10-01T07:00:00.000Z", alternateCurrent: null },
  );
  assert.deepEqual(s.goal.currentTarget, { state: "AVAILABLE", weightKg: 75, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" });
});

test("PROFILE-ONLY weight (no InBody): gap uses it but labelled PROFILE_REPORTED and undated", () => {
  const s = build({ profile: { targetWeight: 75, currentWeight: 80 } });
  assert.equal(s.goal.gap.state, "AVAILABLE");
  if (s.goal.gap.state === "AVAILABLE") {
    assert.equal(s.goal.gap.currentSource, "PROFILE_REPORTED");
    assert.equal(s.goal.gap.currentAsOf, null);
  }
});

test("NO TARGET: trend available, gap unavailable, no default target", () => {
  const s = build({ entries: [entry("2026-09-01", 82), entry("2026-10-01", 80)], profile: { goal: "MAINTENANCE", targetWeight: null } });
  assert.equal(s.body.trends.weight.status, "AVAILABLE");
  assert.deepEqual(s.goal.gap, { state: "NOT_AVAILABLE", reason: "NO_TARGET" });
  assert.deepEqual(s.goal.currentTarget, { state: "NO_TARGET" });
  assert.ok(s.goal.trajectory.onTrack.reasons.includes("NO_TARGET"));
});

test("NO TARGET DATE: gap + observed trajectory exist; on-track is NOT_EVALUABLE with NO_TARGET_DATE", () => {
  const s = build({
    entries: [entry("2026-09-01", 84), entry("2026-09-20", 83), entry("2026-10-05", 82)],
    profile: { goal: "WEIGHT_LOSS", targetWeight: 75 },
  });
  assert.equal(s.goal.gap.state, "AVAILABLE");
  const o = s.goal.trajectory.observed;
  assert.equal(o.state, "AVAILABLE");
  if (o.state === "AVAILABLE") {
    assert.equal(o.observedChangeKg, -2);
    assert.equal(o.timeSpanDays, 34);
    assert.equal(o.observationCount, 3);
    assert.equal(o.directionRelativeToGap, "TOWARD_TARGET"); // geometry only
  }
  assert.equal(s.goal.trajectory.onTrack.status, "NOT_EVALUABLE");
  assert.equal(s.goal.trajectory.onTrack.classification, "DEFERRED");
  assert.ok(s.goal.trajectory.onTrack.reasons.includes("NO_TARGET_DATE"));
});

test("FULL INPUT (target + start + history): descriptive trajectory only — on-track classification stays DEFERRED", () => {
  const s = build({
    entries: [entry("2026-09-01", 84), entry("2026-09-20", 83), entry("2026-10-05", 82)],
    profile: { goal: "WEIGHT_LOSS", targetWeight: 75 },
    activeCycle: {
      id: "c1", startDate: new Date("2026-09-01T00:00:00Z"),
      baselineMetrics: { source: "INBODY", weight: 84, bodyFatPct: 20, muscleMass: 33, bmr: null, measuredAt: "2026-09-01T07:00:00.000Z", inbodyId: "x" },
      targetMetrics: { source: "GOAL_AT_CYCLE_START", targetWeight: 76 },
    },
  });
  assert.equal(s.goal.startingState.state, "AVAILABLE");
  if (s.goal.startingState.state === "AVAILABLE") {
    assert.equal(s.goal.startingState.weightKg, 84);
    assert.equal(s.goal.startingState.targetAtCycleStartKg, 76);
    assert.equal(s.goal.startingState.scope, "ACTIVE_CYCLE_BASELINE");
  }
  assert.equal(s.goal.trajectory.onTrack.status, "NOT_EVALUABLE");
  assert.deepEqual(s.goal.trajectory.onTrack.reasons, ["NO_TARGET_DATE"]);
});

test("starting state: free-form / wrong-shaped snapshots are ignored, not trusted", () => {
  const cycle = (baseline: unknown) => ({ id: "c", startDate: new Date("2026-09-01T00:00:00Z"), baselineMetrics: baseline, targetMetrics: { source: "PT", targetWeight: 70 } });
  assert.equal(build({ activeCycle: cycle({ weight: "84" }) }).goal.startingState.state, "NOT_AVAILABLE");
  assert.equal(build({ activeCycle: cycle({ source: "INBODY", weight: 84 }) }).goal.startingState.state, "NOT_AVAILABLE"); // INBODY needs measuredAt
  assert.equal(build({ activeCycle: null }).goal.startingState.state, "NOT_AVAILABLE");
  const ok = build({ activeCycle: cycle({ source: "PROFILE_FALLBACK", weight: 84 }) }).goal.startingState;
  assert.equal(ok.state, "AVAILABLE");
  if (ok.state === "AVAILABLE") assert.equal(ok.targetAtCycleStartKg, null, "PT-supplied targetMetrics is not the typed goal snapshot");
});

test("BODY FAT: missing on some measurements is null (never 0); trend only from points that have it", () => {
  const s = build({ entries: [entry("2026-09-01", 83, { bodyFatPct: null }), entry("2026-09-20", 82.5, { bodyFatPct: 21 }), entry("2026-10-05", 82, { bodyFatPct: 20 })] });
  assert.equal(s.body.latest?.bodyFatPct, 20);
  assert.equal(s.body.trends.bodyFat.status, "AVAILABLE");
  assert.equal(s.body.trends.bodyFat.dataPoints, 2);
  const only = build({ entries: [entry("2026-09-01", 83, { bodyFatPct: null }), entry("2026-10-05", 82, { bodyFatPct: null })] });
  assert.equal(only.body.latest?.bodyFatPct, null);
  assert.equal(only.body.trends.bodyFat.status, "INSUFFICIENT_HISTORY");
});

test("MUSCLE MASS: semantics UNRESOLVED, neutral name, 0 (OCR fallback) is missing, provenance exposed", () => {
  const s = build({ entries: [entry("2026-09-01", 83, { status: "extracted", muscleMass: 0 }), entry("2026-09-20", 82.5, { status: "manual", muscleMass: 33 }), entry("2026-10-05", 82, { status: "manual", muscleMass: 33.4 })] });
  assert.equal(s.body.muscleMassSemantics, "UNRESOLVED");
  assert.deepEqual(s.body.muscleMassProvenance, { extracted: 1, manual: 2, unknown: 0 });
  assert.equal(s.body.latest?.muscleMassKg, 33.4);
  assert.equal(s.body.trends.muscleMass.dataPoints, 2, "the 0 value is not a data point");
  const json = JSON.stringify(s);
  assert.ok(!/skeletal/i.test(json), "never labelled skeletal muscle mass");
  assert.equal(s.body.quality.mixedSources, true);
});

test("OUTLIER: flagged point kept visible, excluded from trend, quality PARTIAL; not silently dropped", () => {
  const entries = [entry("2026-10-01", 82), entry("2026-10-04", 82.3), entry("2026-10-08", 86.5)]; // +4.2kg in 4 days
  const s = build({ entries });
  assert.equal(s.body.quality.outlierCount, 1);
  assert.equal(s.body.latest?.weightKg, 86.5);
  assert.equal(s.body.latest?.excludedFromTrend, true);
  assert.equal(s.body.observations.comparableInLookback, 2);
  assert.equal(s.body.dataQuality, "PARTIAL");
  assert.ok(s.body.quality.flags.some((f) => /bất thường/.test(f)));
});

test("STALE: measurements exist but none in the lookback — latest shown with age, trend unavailable", () => {
  const s = build({ entries: [entry("2026-04-01", 85), entry("2026-05-01", 84)], profile: { targetWeight: 75 } });
  assert.equal(s.body.dataQuality, "STALE");
  assert.equal(s.body.latest?.weightKg, 84);
  assert.ok((s.body.latestAgeDays ?? 0) > 90);
  assert.equal(s.body.trends.weight.status, "INSUFFICIENT_HISTORY");
  assert.ok(s.goal.trajectory.onTrack.reasons.includes("STALE_BODY_DATA"));
  const o = s.goal.trajectory.observed;
  assert.equal(o.state, "NOT_AVAILABLE");
  if (o.state === "NOT_AVAILABLE") assert.deepEqual(o.reasons, ["STALE_BODY_DATA"]);
});

test("ROADMAP: only typed columns exposed; free-form Json never read; plannedEndAt is not a target deadline", () => {
  const s = build({
    roadmap: {
      id: "r1", name: "Giảm mỡ", goalType: "WEIGHT_LOSS", plannedStartAt: new Date("2026-09-01T00:00:00Z"), plannedEndAt: new Date("2026-12-01T00:00:00Z"),
      phases: [
        { id: "p1", name: "Phase 1", phaseType: "FAT_LOSS", status: "COMPLETED", plannedStartAt: new Date("2026-09-01T00:00:00Z"), plannedEndAt: new Date("2026-09-30T00:00:00Z") },
        { id: "p2", name: "Phase 2", phaseType: "MAINTENANCE", status: "ACTIVE", plannedStartAt: new Date("2026-10-01T00:00:00Z"), plannedEndAt: new Date("2026-10-31T00:00:00Z") },
      ],
    },
  });
  assert.equal(s.goal.roadmap.state, "ACTIVE");
  if (s.goal.roadmap.state === "ACTIVE") {
    assert.equal(s.goal.roadmap.currentPhase?.id, "p2");
    assert.equal(s.goal.roadmap.plannedEndAt, "2026-12-01T00:00:00.000Z");
  }
  assert.ok(s.goal.trajectory.onTrack.reasons.includes("NO_TARGET_DATE"), "roadmap end date does not make on-track evaluable");
});
