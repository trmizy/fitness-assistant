import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDateLabel,
  scheduledDateLabel,
  compareScheduleDate,
  isScheduleDateLocked,
  assertScheduleDateEditable,
  currentWeekRange,
  ScheduleLockedError,
  APP_SCHEDULE_TIME_ZONE,
} from "../utils/schedule-lock.util";

// Schedule dates are stored the same way workout.service.ts's parseDateOnly/
// formatDateOnly write/read them: as a UTC-midnight instant that is really
// just carrying a Y-M-D label. `sched` below mirrors that convention so
// these tests exercise the same shape of Date the real DB rows contain.
function sched(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

test("calendarDateLabel: formats as YYYY-MM-DD in the given IANA zone", () => {
  const instant = new Date("2026-07-15T10:00:00Z");
  assert.equal(calendarDateLabel(instant, "UTC"), "2026-07-15");
});

test("calendarDateLabel: Asia/Ho_Chi_Minh (UTC+7, no DST) shifts a late-UTC instant to the next day", () => {
  // 2026-07-15 20:00 UTC is 2026-07-16 03:00 in Asia/Ho_Chi_Minh.
  const instant = new Date("2026-07-15T20:00:00Z");
  assert.equal(calendarDateLabel(instant, "Asia/Ho_Chi_Minh"), "2026-07-16");
});

test("calendarDateLabel: negative-offset zone (America/Los_Angeles) shifts an early-UTC instant to the previous day", () => {
  // 2026-07-15 05:00 UTC is 2026-07-14 22:00 PDT (UTC-7 in July).
  const instant = new Date("2026-07-15T05:00:00Z");
  assert.equal(calendarDateLabel(instant, "America/Los_Angeles"), "2026-07-14");
});

test("calendarDateLabel: DST-observing zone stays correct across a spring-forward transition", () => {
  // US DST 2026 starts 2026-03-08. Before: UTC-8 (PST). After: UTC-7 (PDT).
  const beforeDst = new Date("2026-03-08T07:59:00Z"); // 23:59 PST on 03-07
  const afterDst = new Date("2026-03-08T09:01:00Z"); // 02:01 PDT on 03-08
  assert.equal(calendarDateLabel(beforeDst, "America/Los_Angeles"), "2026-03-07");
  assert.equal(calendarDateLabel(afterDst, "America/Los_Angeles"), "2026-03-08");
});

test("scheduledDateLabel: reads the stored UTC-midnight instant as its own label, ignoring any other timezone", () => {
  assert.equal(scheduledDateLabel(sched(2026, 7, 29)), "2026-07-29");
});

test("compareScheduleDate: yesterday relative to now is 'past'", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.equal(
    compareScheduleDate(sched(2026, 7, 28), now, "Asia/Ho_Chi_Minh"),
    "past",
  );
});

test("compareScheduleDate: today relative to now is 'today'", () => {
  const now = new Date("2026-07-29T12:00:00Z"); // 19:00 in Asia/Ho_Chi_Minh, still 07-29
  assert.equal(
    compareScheduleDate(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"),
    "today",
  );
});

test("compareScheduleDate: tomorrow relative to now is 'future'", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.equal(
    compareScheduleDate(sched(2026, 7, 30), now, "Asia/Ho_Chi_Minh"),
    "future",
  );
});

test("compareScheduleDate: month boundary — last day of July is 'past' once August has started", () => {
  const now = new Date("2026-08-01T01:00:00Z"); // 08:00 Asia/Ho_Chi_Minh on Aug 1
  assert.equal(
    compareScheduleDate(sched(2026, 7, 31), now, "Asia/Ho_Chi_Minh"),
    "past",
  );
});

test("compareScheduleDate: year boundary — Dec 31 is 'past' once Jan 1 has started", () => {
  const now = new Date("2027-01-01T01:00:00Z");
  assert.equal(
    compareScheduleDate(sched(2026, 12, 31), now, "Asia/Ho_Chi_Minh"),
    "past",
  );
});

test("compareScheduleDate: leap day (2028-02-29) compares correctly the day after", () => {
  const now = new Date("2028-03-01T01:00:00Z"); // 08:00 Asia/Ho_Chi_Minh on Mar 1
  assert.equal(
    compareScheduleDate(sched(2028, 2, 29), now, "Asia/Ho_Chi_Minh"),
    "past",
  );
  assert.equal(
    compareScheduleDate(sched(2028, 2, 29), new Date("2028-02-29T01:00:00Z"), "Asia/Ho_Chi_Minh"),
    "today",
  );
});

test("compareScheduleDate: right before local midnight, today's schedule is still 'today'", () => {
  // 2026-07-29 23:59 in Asia/Ho_Chi_Minh (UTC+7) == 2026-07-29T16:59:00Z.
  const justBeforeMidnight = new Date("2026-07-29T16:59:00Z");
  assert.equal(
    compareScheduleDate(sched(2026, 7, 29), justBeforeMidnight, "Asia/Ho_Chi_Minh"),
    "today",
  );
});

test("compareScheduleDate: right after local midnight, yesterday's schedule flips to 'past'", () => {
  // 2026-07-30 00:01 in Asia/Ho_Chi_Minh == 2026-07-29T17:01:00Z.
  const justAfterMidnight = new Date("2026-07-29T17:01:00Z");
  assert.equal(
    compareScheduleDate(sched(2026, 7, 29), justAfterMidnight, "Asia/Ho_Chi_Minh"),
    "past",
  );
});

test("compareScheduleDate: server clock in UTC vs user's real zone — a session that reads as 'today' in UTC can already be 'past' in Asia/Ho_Chi_Minh", () => {
  // 2026-07-29 18:00 UTC is still 2026-07-29 in UTC, but 2026-07-30 01:00 in
  // Asia/Ho_Chi_Minh — this is the exact scenario the lock must get right
  // even though the fitness-service container itself runs with TZ=UTC.
  const now = new Date("2026-07-29T18:00:00Z");
  assert.equal(compareScheduleDate(sched(2026, 7, 29), now, "UTC"), "today");
  assert.equal(
    compareScheduleDate(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"),
    "past",
  );
});

test("isScheduleDateLocked: true for past and future, false only for today", () => {
  // Future days are locked too — a session can't be genuinely started/
  // completed before its scheduled day has arrived. See the doc comment on
  // isScheduleDateLocked for the exact contradiction (100%/"Hoàn thành" +
  // an enabled start button on a not-yet-arrived day) this closes.
  const now = new Date("2026-07-29T12:00:00Z");
  assert.equal(isScheduleDateLocked(sched(2026, 7, 28), now, "Asia/Ho_Chi_Minh"), true);
  assert.equal(isScheduleDateLocked(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"), false);
  assert.equal(isScheduleDateLocked(sched(2026, 7, 30), now, "Asia/Ho_Chi_Minh"), true);
});

test("isScheduleDateLocked: defaults to APP_SCHEDULE_TIME_ZONE (Asia/Ho_Chi_Minh) when no zone is passed", () => {
  assert.equal(APP_SCHEDULE_TIME_ZONE, "Asia/Ho_Chi_Minh");
  const now = new Date("2026-07-29T18:00:00Z"); // 2026-07-30 in Asia/Ho_Chi_Minh
  assert.equal(isScheduleDateLocked(sched(2026, 7, 29), now), true);
});

test("assertScheduleDateEditable: no-op for today only", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.doesNotThrow(() => assertScheduleDateEditable(sched(2026, 7, 29), now, "Asia/Ho_Chi_Minh"));
});

test("assertScheduleDateEditable: throws ScheduleLockedError (business error, not an arbitrary 401/403) for a past date", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.throws(
    () => assertScheduleDateEditable(sched(2026, 7, 28), now, "Asia/Ho_Chi_Minh"),
    (err: unknown) => {
      assert.ok(err instanceof ScheduleLockedError);
      assert.equal((err as ScheduleLockedError).status, 409);
      assert.equal((err as ScheduleLockedError).code, "SCHEDULE_DATE_LOCKED");
      return true;
    },
  );
});

test("SECURITY: assertScheduleDateEditable throws for a future date — a session cannot be started/completed before it has occurred (§3.3 regression)", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.throws(
    () => assertScheduleDateEditable(sched(2026, 7, 30), now, "Asia/Ho_Chi_Minh"),
    (err: unknown) => {
      assert.ok(err instanceof ScheduleLockedError);
      assert.equal((err as ScheduleLockedError).status, 409);
      assert.equal((err as ScheduleLockedError).code, "SCHEDULE_DATE_LOCKED");
      return true;
    },
  );
});

test("currentWeekRange: a Wednesday resolves to that week's Monday-Sunday boundaries", () => {
  // 2026-07-15 is a Wednesday.
  const now = new Date("2026-07-15T12:00:00Z");
  const { start, end } = currentWeekRange(now, "Asia/Ho_Chi_Minh");
  assert.equal(scheduledDateLabel(start), "2026-07-13"); // Monday
  assert.equal(scheduledDateLabel(end), "2026-07-19"); // Sunday
});

test("currentWeekRange: Monday itself is the start of its own week (boundary)", () => {
  const now = new Date("2026-07-13T01:00:00Z"); // 08:00 in Asia/Ho_Chi_Minh, still Monday
  const { start, end } = currentWeekRange(now, "Asia/Ho_Chi_Minh");
  assert.equal(scheduledDateLabel(start), "2026-07-13");
  assert.equal(scheduledDateLabel(end), "2026-07-19");
});

test("currentWeekRange: Sunday itself is the end of its own week (boundary)", () => {
  const now = new Date("2026-07-19T12:00:00Z"); // Sunday
  const { start, end } = currentWeekRange(now, "Asia/Ho_Chi_Minh");
  assert.equal(scheduledDateLabel(start), "2026-07-13");
  assert.equal(scheduledDateLabel(end), "2026-07-19");
});

test("currentWeekRange: correctly spans a month boundary", () => {
  // 2026-08-01 is a Saturday; that week is 2026-07-27 (Mon) - 2026-08-02 (Sun).
  const now = new Date("2026-08-01T12:00:00Z");
  const { start, end } = currentWeekRange(now, "Asia/Ho_Chi_Minh");
  assert.equal(scheduledDateLabel(start), "2026-07-27");
  assert.equal(scheduledDateLabel(end), "2026-08-02");
});

test("currentWeekRange: timezone matters at the day boundary — a UTC instant just after Asia/Ho_Chi_Minh midnight can fall in the next week", () => {
  // 2026-07-19 17:01 UTC = 2026-07-20 00:01 in Asia/Ho_Chi_Minh (Monday of the NEXT week).
  const now = new Date("2026-07-19T17:01:00Z");
  const { start } = currentWeekRange(now, "Asia/Ho_Chi_Minh");
  assert.equal(scheduledDateLabel(start), "2026-07-20");
});
