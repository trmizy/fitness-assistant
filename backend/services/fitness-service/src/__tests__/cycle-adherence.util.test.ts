import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCycleAdherence, type CycleAdherenceDayInput } from "../utils/cycle-adherence.util";

/**
 * Roadmap P3.4 "Training consistency and adherence"
 * (docs/features/TRAINING_CONSISTENCY_ADHERENCE_IMPACT_ANALYSIS.md).
 */

function day(state: CycleAdherenceDayInput["state"], hasRealSchedule = false): CycleAdherenceDayInput {
  return { state, hasRealSchedule };
}

test("aggregateCycleAdherence: counts each of the 5 states independently", () => {
  const result = aggregateCycleAdherence([
    day("completed"),
    day("completed"),
    day("partial"),
    day("missed"),
    day("rescheduled"),
    day("rescheduled"),
  ]);
  assert.equal(result.completed, 2);
  assert.equal(result.partial, 1);
  assert.equal(result.missed, 1);
  assert.equal(result.rescheduled, 2);
  assert.equal(result.planned, 0);
});

test("aggregateCycleAdherence: a future day with a real schedule row counts as planned", () => {
  const result = aggregateCycleAdherence([day(null, true), day(null, true), day(null, false)]);
  assert.equal(result.planned, 2, "only the 2 real future sessions count, not the empty future day");
});

test("aggregateCycleAdherence: rest days (state 'rest') are excluded from every count", () => {
  const result = aggregateCycleAdherence([day("rest"), day("rest"), day("completed")]);
  assert.equal(result.completed, 1);
  assert.equal(result.partial, 0);
  assert.equal(result.missed, 0);
  assert.equal(result.rescheduled, 0);
  assert.equal(result.planned, 0);
});

test("aggregateCycleAdherence: adherencePct is completed / (completed+partial+missed+rescheduled), excluding planned and rest", () => {
  // 3 completed, 1 partial, 1 missed, 1 rescheduled -> resolved total 6, 3/6 = 50%
  const result = aggregateCycleAdherence([
    day("completed"), day("completed"), day("completed"),
    day("partial"),
    day("missed"),
    day("rescheduled"),
    day(null, true), // planned — must not affect the percentage
    day("rest"), day("rest"), // must not affect the percentage
  ]);
  assert.equal(result.adherencePct, 50);
});

test("aggregateCycleAdherence: adherencePct is null when nothing has resolved yet (never 0% or 100% for no data)", () => {
  const result = aggregateCycleAdherence([day(null, true), day("rest")]);
  assert.equal(result.adherencePct, null);
});

test("aggregateCycleAdherence: an empty cycle window returns all zeros and a null percentage", () => {
  const result = aggregateCycleAdherence([]);
  assert.deepEqual(result, { completed: 0, partial: 0, missed: 0, rescheduled: 0, planned: 0, adherencePct: null });
});

test("aggregateCycleAdherence: a fully-adhered cycle (all completed) is 100%, not left null", () => {
  const result = aggregateCycleAdherence([day("completed"), day("completed")]);
  assert.equal(result.adherencePct, 100);
});

test("aggregateCycleAdherence: a fully-missed cycle is 0%, not left null (0/N is real data, distinct from 0/0)", () => {
  const result = aggregateCycleAdherence([day("missed"), day("missed")]);
  assert.equal(result.adherencePct, 0);
});
