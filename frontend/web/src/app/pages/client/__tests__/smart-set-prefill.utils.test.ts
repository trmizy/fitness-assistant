import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectSmartSetPrefill } from "../smart-set-prefill.utils";

describe("selectSmartSetPrefill", () => {
  it("prefills REPS_LOAD from a sufficient deterministic target before previous actual", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: {
        status: "INCREASE_LOAD",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: 63, reps: 8, durationSeconds: null },
      },
      previousSets: [{ weightKg: 60, reps: 8, rpe: 8, rir: 2 }],
      exerciseDefaults: { weight: 55, reps: 8 },
    });

    assert.equal(result.source, "progression");
    assert.equal(result.draft.weightKg, "63");
    assert.equal(result.draft.noWeight, false);
    assert.equal(result.draft.rpe, 8);
    assert.equal(result.draft.rir, 2);
  });

  it("falls back to previous actual when progression has insufficient data", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: {
        status: "INSUFFICIENT_DATA",
        dataQuality: "LOW_SAMPLE",
        nextTarget: null,
      },
      previousSets: [{ weightKg: 70, reps: 6 }],
      exerciseDefaults: { weight: 50, reps: 10 },
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.weightKg, "70");
  });

  it("does not use REVIEW progression as an automatic prefill bump", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: {
        status: "REVIEW",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: 90, reps: 5, durationSeconds: null },
      },
      previousSets: [{ weightKg: 80, reps: 5 }],
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.weightKg, "80");
  });

  it("uses DELOAD deterministic target when the cycle envelope produced one", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: {
        status: "DELOAD",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: 54, reps: 8, durationSeconds: null },
      },
      previousSets: [{ weightKg: 60, reps: 8 }],
    });

    assert.equal(result.source, "progression");
    assert.equal(result.draft.weightKg, "54");
  });

  it("prefills BODYWEIGHT_REPS without inferring body weight when none was explicitly available, and prefills reps from the deterministic target", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "BODYWEIGHT_REPS",
      progression: {
        status: "INCREASE_REPS",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: null, reps: 14, durationSeconds: null },
      },
      previousSets: [{ reps: 12 }],
    });

    assert.equal(result.source, "progression");
    assert.equal(result.draft.weightKg, "");
    assert.equal(result.draft.bodyWeightAtSetKg, "");
    assert.equal(result.draft.noWeight, true);
    assert.equal(result.draft.reps, "14");
  });

  it("BODYWEIGHT_REPS falls back to previous actual reps when progression is insufficient, and to the prescription when neither exists", () => {
    const fromPrevious = selectSmartSetPrefill({
      loggingMode: "BODYWEIGHT_REPS",
      progression: { status: "INSUFFICIENT_DATA", dataQuality: "NONE", nextTarget: null },
      previousSets: [{ reps: 9 }],
      exerciseDefaults: { reps: 10 },
    });
    assert.equal(fromPrevious.source, "previous");
    assert.equal(fromPrevious.draft.reps, "9");

    const fromPrescription = selectSmartSetPrefill({
      loggingMode: "BODYWEIGHT_REPS",
      exerciseDefaults: { reps: 10 },
    });
    assert.equal(fromPrescription.source, "prescription");
    assert.equal(fromPrescription.draft.reps, "10");
  });

  it("does not prefill reps for a non-BODYWEIGHT_REPS mode (no reps control exists there yet)", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: {
        status: "INCREASE_LOAD",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: 63, reps: 8, durationSeconds: null },
      },
    });
    assert.equal(result.draft.reps, "");
  });

  it("prefills TIME duration from deterministic target", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "TIME",
      progression: {
        status: "INCREASE_LOAD",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: null, reps: null, durationSeconds: 50 },
      },
      previousSets: [{ durationSeconds: 45 }],
    });

    assert.equal(result.source, "progression");
    assert.equal(result.draft.durationSeconds, "50");
    assert.equal(result.draft.weightKg, "");
    assert.equal(result.draft.noWeight, true);
  });

  it("prefills TIME_LOAD with both load and duration", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "TIME_LOAD",
      previousSets: [{ weightKg: 30, durationSeconds: 45 }],
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.weightKg, "30");
    assert.equal(result.draft.durationSeconds, "45");
    assert.equal(result.draft.noWeight, false);
  });

  it("prefills DISTANCE_TIME distance from previous and duration from target when target has no distance field", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "DISTANCE_TIME",
      progression: {
        status: "INCREASE_LOAD",
        dataQuality: "SUFFICIENT",
        nextTarget: { weightKg: null, reps: null, durationSeconds: 1505 },
      },
      previousSets: [{ distanceMeters: 5000, durationSeconds: 1500 }],
    });

    assert.equal(result.source, "progression");
    assert.equal(result.draft.distanceMeters, "5000");
    assert.equal(result.draft.durationSeconds, "1505");
    assert.equal(result.draft.noWeight, true);
  });

  it("falls back to prescription defaults when no history exists", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "TIME_LOAD",
      exerciseDefaults: { weight: 20, durationSeconds: 60 },
    });

    assert.equal(result.source, "prescription");
    assert.equal(result.draft.weightKg, "20");
    assert.equal(result.draft.durationSeconds, "60");
  });

  // Roadmap P1.1 "true set-by-set table UI" — targetSetNumber lets a
  // multi-set table ask for set 3's OWN previous actual instead of always
  // reusing set 1's (the pre-existing, still-default behavior above).
  it("prefills actual tempo from the matching previous set before exercise defaults", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      previousSets: [
        { weightKg: 60, reps: 8, tempo: "2-0-1-0", setNumber: 1 },
        { weightKg: 60, reps: 8, tempo: "3-1-1-0", setNumber: 2 },
      ],
      exerciseDefaults: { weight: 50, reps: 8, tempo: "1-0-1-0" },
      targetSetNumber: 2,
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.tempo, "3-1-1-0");
  });

  it("targetSetNumber prefers the matching previous set's own actual over the first logged set", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: { status: "INSUFFICIENT_DATA", dataQuality: "NONE", nextTarget: null },
      previousSets: [
        { weightKg: 100, reps: 8, setNumber: 1 },
        { weightKg: 100, reps: 8, setNumber: 2 },
        { weightKg: 100, reps: 7, setNumber: 3 },
      ],
      exerciseDefaults: { weight: 50, reps: 8 },
      targetSetNumber: 3,
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.weightKg, "100");
  });

  it("targetSetNumber falls back to the first previous set when no set with that number exists (e.g. more sets than last session)", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: { status: "INSUFFICIENT_DATA", dataQuality: "NONE", nextTarget: null },
      previousSets: [{ weightKg: 60, reps: 8, setNumber: 1 }],
      exerciseDefaults: { weight: 50, reps: 8 },
      targetSetNumber: 3,
    });

    assert.equal(result.source, "previous");
    assert.equal(result.draft.weightKg, "60");
  });

  it("omitting targetSetNumber keeps the pre-existing always-first-set behavior", () => {
    const result = selectSmartSetPrefill({
      loggingMode: "REPS_LOAD",
      progression: { status: "INSUFFICIENT_DATA", dataQuality: "NONE", nextTarget: null },
      previousSets: [
        { weightKg: 100, reps: 8, setNumber: 1 },
        { weightKg: 90, reps: 7, setNumber: 2 },
      ],
      exerciseDefaults: { weight: 50, reps: 8 },
    });

    assert.equal(result.draft.weightKg, "100");
  });
});
