import test from "node:test";
import assert from "node:assert/strict";
import {
  countSlotsFromRows,
  type SlotAvailabilityRow,
  type SlotBookedRow,
  type SlotExceptionRow,
} from "../services/availability.service";
import { DayOfWeek } from "../generated/prisma";

/**
 * The number this produces is shown to a client before they hand over money — "this PT has
 * 6 slots free in the next 4 weeks, your package has 10 sessions" — so it has to mean what
 * it says. It did not: booked sessions and days off were both being ignored, because the
 * day being walked was keyed with `toISOString()` (UTC) while the sessions were keyed from
 * `getHours()` (local). East of Greenwich those are different days, so no booking ever
 * matched a slot and the count was simply every hour the PT had ever published.
 *
 * Every Date here is built with the local-time constructor, and the counter keys on local
 * days, so these assertions hold whatever timezone the suite is run in.
 */

const PT = "pt-1";
const OTHER_PT = "pt-2";

/** Monday. The window below runs two full weeks from here, through Sunday the 30th. */
const WINDOW_FROM = new Date(2026, 7, 17, 0, 0, 0, 0);
const WINDOW_TO = new Date(2026, 7, 30, 23, 59, 59, 999);

const WEEKDAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
];

/** 09:00–17:00, Monday to Friday: eight 60-minute slots a day, forty a week. */
function weekdayNineToFive(ptUserId = PT): SlotAvailabilityRow[] {
  return WEEKDAYS.map((dayOfWeek) => ({
    ptUserId,
    dayOfWeek,
    startTime: "09:00",
    endTime: "17:00",
    isActive: true,
  }));
}

function count(opts: {
  availabilities?: SlotAvailabilityRow[];
  exceptions?: SlotExceptionRow[];
  bookedSessions?: SlotBookedRow[];
  ptUserIds?: string[];
  sessionDurationMinutes?: number;
}): Record<string, number> {
  return countSlotsFromRows({
    ptUserIds: opts.ptUserIds ?? [PT],
    availabilities: opts.availabilities ?? weekdayNineToFive(),
    exceptions: opts.exceptions ?? [],
    bookedSessions: opts.bookedSessions ?? [],
    fromDate: WINDOW_FROM,
    toDate: WINDOW_TO,
    sessionDurationMinutes: opts.sessionDurationMinutes ?? 60,
  });
}

test("an empty diary counts every published hour", () => {
  // 8 slots/day × 5 weekdays × 2 weeks.
  assert.equal(count({})[PT], 80);
});

test("three confirmed sessions remove exactly three slots", () => {
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 9, 0) },
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 10, 0) },
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 18, 9, 0) },
  ];
  assert.equal(count({ bookedSessions: booked })[PT], 77);
});

test("a morning booking is subtracted — the timezone bug this pins down", () => {
  // 09:00 local is the case that broke: its UTC date is the previous day east of Greenwich,
  // so the booking was filed under a day the loop never looked at and the slot stayed free.
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 9, 0) },
  ];
  assert.equal(count({ bookedSessions: booked })[PT], 79);
});

test("a Friday booking is subtracted rather than falling off the week", () => {
  // The sharpest form of the old bug. Keying the loop in UTC shifted every day back by one,
  // so a Friday booking was filed against Saturday — a day with no published hours — and
  // vanished. A PT booked solid on Friday still advertised Friday as free.
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 21, 9, 0) },
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 28, 9, 0) },
  ];
  assert.equal(count({ bookedSessions: booked })[PT], 78);
});

test("a booking the day before a day off is still subtracted", () => {
  // Tuesday's booking used to shift onto Wednesday, which is skipped entirely as a day off,
  // so it disappeared: 8 slots removed for the day off and nothing for the booking.
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date(2026, 7, 19) }];
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 18, 9, 0) },
  ];
  assert.equal(count({ exceptions, bookedSessions: booked })[PT], 71);
});

test("a day off removes exactly that day's slots", () => {
  // Wednesday 19 August.
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date(2026, 7, 19) }];
  assert.equal(count({ exceptions })[PT], 72);
});

test("a day off on a day the PT does not work changes nothing", () => {
  // Saturday 22 August — outside the Mon–Fri blocks, so there is nothing to remove.
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date(2026, 7, 22) }];
  assert.equal(count({ exceptions })[PT], 80);
});

test("a booking on a day off is not double-counted", () => {
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date(2026, 7, 19) }];
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 19, 9, 0) },
  ];
  // The whole Wednesday is gone; the booking inside it must not subtract a ninth slot.
  assert.equal(count({ exceptions, bookedSessions: booked })[PT], 72);
});

test("an exception stored as UTC midnight lands on the right local day", () => {
  // addException does `new Date("2026-08-19")`, which parses as UTC midnight. In a UTC+7
  // process that is 07:00 on the 19th — still the 19th, which is what must be removed.
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date("2026-08-19T00:00:00Z") }];
  const removed = 80 - count({ exceptions })[PT];
  assert.ok(removed === 8 || removed === 0, `expected a whole day or nothing, removed ${removed}`);
});

test("an inactive block sells nothing", () => {
  const availabilities = weekdayNineToFive().map((a) =>
    a.dayOfWeek === DayOfWeek.MONDAY ? { ...a, isActive: false } : a,
  );
  assert.equal(count({ availabilities })[PT], 64, "the two Mondays drop out");
});

test("a block that does not divide evenly does not sell a partial session", () => {
  const availabilities: SlotAvailabilityRow[] = [
    { ptUserId: PT, dayOfWeek: DayOfWeek.MONDAY, startTime: "09:00", endTime: "17:30", isActive: true },
  ];
  // 8.5 hours holds eight whole sessions; the trailing 30 minutes is not a slot.
  assert.equal(count({ availabilities })[PT], 16, "eight per Monday, two Mondays");
});

test("a 90-minute session yields fewer slots than a 60-minute one", () => {
  assert.equal(count({ sessionDurationMinutes: 90 })[PT], 50, "five per day, ten days");
});

test("each PT is counted from their own rows", () => {
  const availabilities = [...weekdayNineToFive(PT), ...weekdayNineToFive(OTHER_PT)];
  const booked: SlotBookedRow[] = [
    { ptUserId: OTHER_PT, scheduledStartAt: new Date(2026, 7, 17, 9, 0) },
  ];
  const result = count({ availabilities, bookedSessions: booked, ptUserIds: [PT, OTHER_PT] });
  assert.equal(result[PT], 80, "one PT's booking does not touch the other's count");
  assert.equal(result[OTHER_PT], 79);
});

test("a PT with no published hours counts zero rather than going missing", () => {
  const result = count({ availabilities: [], ptUserIds: [PT] });
  assert.equal(result[PT], 0, "the key must exist — a missing entry reads as undefined downstream");
});
