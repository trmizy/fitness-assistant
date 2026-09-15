/**
 * CL-01's dashboard logic. Two cases are real regressions found on the emulator: today's started
 * session disappearing from the hero card, and "Sắp tới" repeating the hero card's session.
 *
 * Runs with: npx tsx --test src/features/__tests__/dashboardWeek.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  activityStateValue,
  buildActivityWeek,
  changeLabel,
  currentStreak,
  isSameLocalDay,
  selectUpcomingSchedules,
} from "../dashboard/dashboardWeek";

const monday = new Date(2026, 8, 14);
const tuesday = new Date(2026, 8, 15, 9, 30);

describe("activityStateValue", () => {
  it("maps heatmap states to bar heights, empty for rest and unknown", () => {
    assert.equal(activityStateValue("completed"), 1);
    assert.equal(activityStateValue("partial"), 0.55);
    assert.equal(activityStateValue("rescheduled"), 0.3);
    assert.equal(activityStateValue("missed"), 0.15);
    assert.equal(activityStateValue("rest"), 0);
    assert.equal(activityStateValue(null), 0);
  });
});

describe("buildActivityWeek", () => {
  it("places each heatmap day on its weekday and leaves gaps empty", () => {
    const week = buildActivityWeek(monday, [
      { date: "2026-09-14", state: "missed" },
      { date: "2026-09-15", state: "completed" },
    ]);
    assert.deepEqual(
      week.map((d) => [d.label, d.value]),
      [
        ["T2", 0.15],
        ["T3", 1],
        ["T4", 0],
        ["T5", 0],
        ["T6", 0],
        ["T7", 0],
        ["CN", 0],
      ],
    );
  });
});

describe("currentStreak", () => {
  it("counts consecutive trained days ending today", () => {
    const days = [
      { date: "2026-09-13", state: "completed" },
      { date: "2026-09-14", state: "partial" },
      { date: "2026-09-15", state: "completed" },
    ];
    assert.equal(currentStreak(days, tuesday), 3);
  });

  it("does not break because today has not been trained yet", () => {
    const days = [
      { date: "2026-09-13", state: "completed" },
      { date: "2026-09-14", state: "completed" },
      { date: "2026-09-15", state: null },
    ];
    assert.equal(currentStreak(days, tuesday), 2);
  });

  it("skips over a rest day without counting it", () => {
    const days = [
      { date: "2026-09-12", state: "completed" },
      { date: "2026-09-13", state: "rest" },
      { date: "2026-09-14", state: "completed" },
    ];
    assert.equal(currentStreak(days, tuesday), 2);
  });

  it("stops at a missed day", () => {
    const days = [
      { date: "2026-09-13", state: "completed" },
      { date: "2026-09-14", state: "missed" },
      { date: "2026-09-15", state: "completed" },
    ];
    assert.equal(currentStreak(days, tuesday), 1);
  });

  it("is zero with no data", () => {
    assert.equal(currentStreak(undefined, tuesday), 0);
    assert.equal(currentStreak([], tuesday), 0);
  });
});

describe("changeLabel", () => {
  it("signs the difference to one decimal", () => {
    assert.equal(changeLabel(71.3, 88.7, "kg"), "-17.4 kg so với lần trước");
    assert.equal(changeLabel(36.1, 35.2, "kg"), "+0.9 kg so với lần trước");
    assert.equal(changeLabel(35.2, 35.2, "kg"), "0.0 kg so với lần trước");
  });

  it("says there is nothing to compare when either side is missing", () => {
    assert.equal(changeLabel(undefined, 70, "kg"), "Chưa có số liệu trước");
    assert.equal(changeLabel(70, undefined, "kg"), "Chưa có số liệu trước");
  });
});

describe("isSameLocalDay", () => {
  it("compares a date-only API value against the local calendar day", () => {
    assert.equal(isSameLocalDay("2026-09-15T00:00:00.000Z", new Date(2026, 8, 15, 23, 30)), true);
    assert.equal(isSameLocalDay("2026-09-16", new Date(2026, 8, 15, 23, 30)), false);
  });
});

describe("selectUpcomingSchedules", () => {
  const schedules = [
    { id: "later-2", date: "2026-09-28", status: "NOT_STARTED" },
    { id: "done", date: "2026-09-14", status: "COMPLETED", workoutId: "w0" },
    { id: "today", date: "2026-09-15", status: "IN_PROGRESS", workoutId: "w1" },
    { id: "skipped", date: "2026-09-16", status: "SKIPPED" },
    { id: "later-1", date: "2026-09-21", status: "NOT_STARTED" },
    { id: "cancelled", date: "2026-09-17", status: "CANCELLED" },
    { id: "later-3", date: "2026-10-05", status: "NOT_STARTED" },
    { id: "later-4", date: "2026-10-12", status: "NOT_STARTED" },
  ];

  it("keeps a started session as the next one to resume (it used to vanish once started)", () => {
    const { next } = selectUpcomingSchedules(schedules);
    assert.equal(next.id, "today");
  });

  it("drops completed, skipped and cancelled sessions and sorts by date", () => {
    const { upcoming } = selectUpcomingSchedules(schedules);
    assert.deepEqual(
      upcoming.map((s) => s.id),
      ["today", "later-1", "later-2", "later-3", "later-4"],
    );
  });

  it("'Sắp tới' starts after the hero card's session and shows at most three", () => {
    const { next, later } = selectUpcomingSchedules(schedules);
    assert.ok(!later.includes(next), "the hero card's session must not be listed again");
    assert.deepEqual(
      later.map((s) => s.id),
      ["later-1", "later-2", "later-3"],
    );
  });

  it("with a single session, the hero card has it and 'Sắp tới' is empty", () => {
    const { upcoming, next, later } = selectUpcomingSchedules([{ id: "only", date: "2026-09-21", status: "NOT_STARTED" }]);
    assert.equal(upcoming.length, 1);
    assert.equal(next.id, "only");
    assert.deepEqual(later, []);
  });

  it("tolerates a non-array response", () => {
    const result = selectUpcomingSchedules(undefined);
    assert.deepEqual(result.upcoming, []);
    assert.equal(result.next, undefined);
  });
});
