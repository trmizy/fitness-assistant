/**
 * Pure-logic tests for the frontend past-date lock helper — mirrors
 * backend/services/fitness-service/src/__tests__/schedule-lock.util.test.ts
 * so both sides of the "locked past day" rule agree on the same cases.
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/schedule-lock.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDateLabel,
  scheduledDateLabel,
  scheduledDateLabelFromApi,
  compareScheduleDate,
  isScheduleDateLocked,
  isScheduleDateApiValueLocked,
  isScheduleDateApiValuePast,
  scheduleLockDirection,
  APP_SCHEDULE_TIME_ZONE,
} from "../schedule-lock.utils";

function sched(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

describe("schedule-lock.utils", () => {
  it("calendarDateLabel formats as YYYY-MM-DD in the given zone", () => {
    assert.equal(calendarDateLabel(new Date("2026-07-15T10:00:00Z"), "UTC"), "2026-07-15");
  });

  it("calendarDateLabel: Asia/Ho_Chi_Minh shifts a late-UTC instant to the next day", () => {
    assert.equal(
      calendarDateLabel(new Date("2026-07-15T20:00:00Z"), "Asia/Ho_Chi_Minh"),
      "2026-07-16",
    );
  });

  it("calendarDateLabel: negative-offset zone shifts an early-UTC instant to the previous day", () => {
    assert.equal(
      calendarDateLabel(new Date("2026-07-15T05:00:00Z"), "America/Los_Angeles"),
      "2026-07-14",
    );
  });

  it("calendarDateLabel: correct across a US DST spring-forward transition", () => {
    assert.equal(
      calendarDateLabel(new Date("2026-03-08T07:59:00Z"), "America/Los_Angeles"),
      "2026-03-07",
    );
    assert.equal(
      calendarDateLabel(new Date("2026-03-08T09:01:00Z"), "America/Los_Angeles"),
      "2026-03-08",
    );
  });

  it("scheduledDateLabel reads the UTC-midnight label directly, matching parseApiDateOnly's convention", () => {
    assert.equal(scheduledDateLabel(sched(2026, 7, 29)), "2026-07-29");
  });

  it("compareScheduleDate: yesterday is 'past', today is 'today', tomorrow is 'future'", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    assert.equal(compareScheduleDate(sched(2026, 7, 28), now, "Asia/Ho_Chi_Minh"), "past");
    assert.equal(compareScheduleDate(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"), "today");
    assert.equal(compareScheduleDate(sched(2026, 7, 30), now, "Asia/Ho_Chi_Minh"), "future");
  });

  it("compareScheduleDate: right after local midnight, yesterday flips to 'past'", () => {
    const justAfterMidnight = new Date("2026-07-29T17:01:00Z"); // 2026-07-30 00:01 in Asia/Ho_Chi_Minh
    assert.equal(
      compareScheduleDate(sched(2026, 7, 29), justAfterMidnight, "Asia/Ho_Chi_Minh"),
      "past",
    );
  });

  it("compareScheduleDate: browser TZ differing from the app zone still resolves per the app zone", () => {
    // Same instant reads as 'today' in UTC but 'past' in Asia/Ho_Chi_Minh —
    // this is exactly why the frontend must not just use `new Date()` getters.
    const now = new Date("2026-07-29T18:00:00Z");
    assert.equal(compareScheduleDate(sched(2026, 7, 29), now, "UTC"), "today");
    assert.equal(compareScheduleDate(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"), "past");
  });

  // Real bug found via direct user report: this used to be past-only
  // ("true only for past dates" — see git history), diverging from the
  // BACKEND's assertScheduleDateEditable, which locks a day that is
  // EITHER past OR future (only today is ever editable). That divergence
  // let a future day's "Bắt đầu tập" button render enabled — clicking it
  // reached the real API, which correctly rejected it, but only after the
  // button had already promised it would work. Locked both directions now.
  it("isScheduleDateLocked: true for BOTH past and future dates, false only for today — defaults to APP_SCHEDULE_TIME_ZONE", () => {
    assert.equal(APP_SCHEDULE_TIME_ZONE, "Asia/Ho_Chi_Minh");
    const now = new Date("2026-07-29T18:00:00Z"); // already 2026-07-30 in Asia/Ho_Chi_Minh
    assert.equal(isScheduleDateLocked(sched(2026, 7, 29), now), true, "yesterday (past) must be locked");
    assert.equal(isScheduleDateLocked(sched(2026, 7, 30), now), false, "today must NOT be locked");
    assert.equal(isScheduleDateLocked(sched(2026, 7, 31), now), true, "tomorrow (future) must be locked");
  });

  it("scheduledDateLabelFromApi: reads the Y-M-D digits directly out of an ISO wire string", () => {
    assert.equal(scheduledDateLabelFromApi("2026-07-29T00:00:00.000Z"), "2026-07-29");
    assert.equal(scheduledDateLabelFromApi("2026-07-29"), "2026-07-29");
  });

  it("isScheduleDateApiValueLocked: safe to call directly on a raw API date string, unlike the Date-based helpers — locked for past AND future, not just past", () => {
    // Regression guard: parseApiDateOnly (elsewhere in WorkoutLogPage.tsx)
    // re-materializes a Y-M-D label at *local* midnight for calendar-grid
    // arithmetic. Round-tripping that local Date back through
    // scheduledDateLabel's UTC read would silently shift the label by a
    // day in any browser timezone other than UTC — this function must be
    // called on the raw API string/Date instead, before any such
    // reparsing, which is what the calendar's schedulesByDay builder does.
    const now = new Date("2026-07-29T12:00:00Z");
    assert.equal(isScheduleDateApiValueLocked("2026-07-28T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), true, "yesterday");
    assert.equal(isScheduleDateApiValueLocked("2026-07-29T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), false, "today");
    assert.equal(isScheduleDateApiValueLocked("2026-07-30T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), true, "tomorrow — was wrongly `false` before this fix");
  });

  // isScheduleDateApiValuePast keeps the OLD past-only semantic on
  // purpose, for the one real caller that legitimately needs it: the
  // "upcoming workouts" list must include today AND future days, so it
  // filters on "has this date already gone by", not "is today the only
  // editable day". Using the (now bidirectional) locked-check there would
  // wrongly hide every future session — the exact regression caught while
  // fixing isScheduleDateApiValueLocked above.
  it("isScheduleDateApiValuePast: true only for genuinely past dates — today and future are both false", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    assert.equal(isScheduleDateApiValuePast("2026-07-28T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), true);
    assert.equal(isScheduleDateApiValuePast("2026-07-29T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), false);
    assert.equal(isScheduleDateApiValuePast("2026-07-30T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), false);
  });

  it("scheduleLockDirection: reports which way a locked day is locked, undefined when not locked at all", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    assert.equal(scheduleLockDirection("2026-07-28T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), "past");
    assert.equal(scheduleLockDirection("2026-07-29T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), undefined);
    assert.equal(scheduleLockDirection("2026-07-30T00:00:00.000Z", now, "Asia/Ho_Chi_Minh"), "future");
  });
});
