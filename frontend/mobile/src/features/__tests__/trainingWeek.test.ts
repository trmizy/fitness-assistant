/**
 * CL-02's week view. The in-progress case is a real regression: starting a session ticked the day
 * as done and made the card untappable, so the user could not get back into their own session.
 *
 * Runs with: npx tsx --test src/features/__tests__/trainingWeek.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TRAINING_WEEK_LABELS, buildTrainingWeek } from "../workout/trainingWeek";

const monday = new Date(2026, 8, 14); // Mon 14 Sep 2026, local midnight
const tuesdayMorning = new Date(2026, 8, 15, 10, 0);

describe("buildTrainingWeek", () => {
  it("lays out Monday..Sunday with local date keys", () => {
    const week = buildTrainingWeek([], monday, tuesdayMorning);
    assert.deepEqual(
      week.map((d) => d.label),
      TRAINING_WEEK_LABELS,
    );
    assert.deepEqual(
      week.map((d) => d.key),
      ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"],
    );
  });

  it("marks today and the days before it", () => {
    const week = buildTrainingWeek([], monday, tuesdayMorning);
    assert.deepEqual(
      week.map((d) => [d.today, d.past]),
      [
        [false, true],
        [true, false],
        [false, false],
        [false, false],
        [false, false],
        [false, false],
        [false, false],
      ],
    );
  });

  it("a day without a schedule is rest", () => {
    const week = buildTrainingWeek([{ date: "2026-09-15T00:00:00.000Z", status: "NOT_STARTED" }], monday, tuesdayMorning);
    assert.equal(week[1].rest, false);
    assert.equal(week[2].rest, true);
  });

  it("a started session (IN_PROGRESS with a workout row) is in progress, NOT done", () => {
    const week = buildTrainingWeek(
      [{ date: "2026-09-15T00:00:00.000Z", status: "IN_PROGRESS", workoutId: "w1" }],
      monday,
      tuesdayMorning,
    );
    assert.equal(week[1].done, false);
    assert.equal(week[1].inProgress, true);
  });

  it("a partially completed session is still in progress", () => {
    const week = buildTrainingWeek(
      [{ date: "2026-09-15", status: "PARTIALLY_COMPLETED", workout: { id: "w1" } }],
      monday,
      tuesdayMorning,
    );
    assert.equal(week[1].inProgress, true);
    assert.equal(week[1].done, false);
  });

  it("only COMPLETED counts as done", () => {
    const week = buildTrainingWeek(
      [
        { date: "2026-09-14", status: "COMPLETED", workoutId: "w0" },
        { date: "2026-09-16", status: "NOT_STARTED" },
      ],
      monday,
      tuesdayMorning,
    );
    assert.equal(week[0].done, true);
    assert.equal(week[0].inProgress, false);
    assert.equal(week[2].done, false);
    assert.equal(week[2].inProgress, false);
  });

  it("matches a schedule by its date label, whatever timezone suffix the API sends", () => {
    // A plain `new Date("2026-09-17T00:00:00.000Z")` lands on the 16th west of UTC.
    const week = buildTrainingWeek([{ date: "2026-09-17T00:00:00.000Z", status: "NOT_STARTED" }], monday, tuesdayMorning);
    assert.equal(week[3].rest, false);
  });

  it("treats a non-array response as an empty week", () => {
    const week = buildTrainingWeek({ error: "x" }, monday, tuesdayMorning);
    assert.ok(week.every((d) => d.rest));
  });
});
