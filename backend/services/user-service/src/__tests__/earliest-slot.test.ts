import test from "node:test";
import assert from "node:assert/strict";
import {
  findEarliestSlotFromRows,
  type SlotAvailabilityRow,
  type SlotBookedRow,
  type SlotExceptionRow,
} from "../services/availability.service";
import { DayOfWeek } from "../generated/prisma";

/**
 * findEarliestSlotFromRows powers the "PT is booked solid — nearest opening is <date>"
 * fallback the low-availability warning offers. Same local-day arithmetic as
 * countSlotsFromRows (see slot-counting.test.ts for why that matters), reused here rather
 * than re-derived, so these tests are about "which slot comes first", not the timezone
 * arithmetic already pinned elsewhere.
 */

const PT = "pt-1";
const OTHER_PT = "pt-2";

/** Monday 17 Aug 2026. */
const WINDOW_FROM = new Date(2026, 7, 17, 0, 0, 0, 0);
const WINDOW_TO = new Date(2026, 7, 30, 23, 59, 59, 999);

const WEEKDAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
];

function weekdayNineToFive(ptUserId = PT): SlotAvailabilityRow[] {
  return WEEKDAYS.map((dayOfWeek) => ({
    ptUserId,
    dayOfWeek,
    startTime: "09:00",
    endTime: "17:00",
    isActive: true,
  }));
}

function earliest(opts: {
  ptUserId?: string;
  availabilities?: SlotAvailabilityRow[];
  exceptions?: SlotExceptionRow[];
  bookedSessions?: SlotBookedRow[];
  sessionDurationMinutes?: number;
  toDate?: Date;
}) {
  return findEarliestSlotFromRows({
    ptUserId: opts.ptUserId ?? PT,
    availabilities: opts.availabilities ?? weekdayNineToFive(),
    exceptions: opts.exceptions ?? [],
    bookedSessions: opts.bookedSessions ?? [],
    fromDate: WINDOW_FROM,
    toDate: opts.toDate ?? WINDOW_TO,
    sessionDurationMinutes: opts.sessionDurationMinutes ?? 60,
  });
}

test("an empty diary's earliest slot is the very first published hour", () => {
  assert.deepEqual(earliest({}), { date: "2026-08-17", startTime: "09:00" });
});

test("a booked opening slot pushes the answer to the next slot the same day", () => {
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 9, 0) },
  ];
  assert.deepEqual(earliest({ bookedSessions: booked }), {
    date: "2026-08-17",
    startTime: "10:00",
  });
});

test("a fully booked day rolls over to the next working day", () => {
  const booked: SlotBookedRow[] = Array.from({ length: 8 }, (_, i) => ({
    ptUserId: PT,
    scheduledStartAt: new Date(2026, 7, 17, 9 + i, 0),
  }));
  assert.deepEqual(earliest({ bookedSessions: booked }), {
    date: "2026-08-18",
    startTime: "09:00",
  });
});

test("a day off is skipped entirely, same as a fully booked day", () => {
  const exceptions: SlotExceptionRow[] = [{ ptUserId: PT, date: new Date(2026, 7, 17) }];
  assert.deepEqual(earliest({ exceptions }), { date: "2026-08-18", startTime: "09:00" });
});

test("a weekend with no published hours is skipped — Friday's last slot rolls to Monday", () => {
  // Book out the whole first week; Saturday/Sunday have no availability blocks at all, so
  // the search must not stop there — it has to keep walking to the next Monday.
  const booked: SlotBookedRow[] = [];
  for (let day = 17; day <= 21; day++) {
    for (let h = 9; h < 17; h++) {
      booked.push({ ptUserId: PT, scheduledStartAt: new Date(2026, 7, day, h, 0) });
    }
  }
  assert.deepEqual(earliest({ bookedSessions: booked }), {
    date: "2026-08-24",
    startTime: "09:00",
  });
});

test("a second, later block on the same day is found once the first block is full", () => {
  const availabilities: SlotAvailabilityRow[] = [
    { ptUserId: PT, dayOfWeek: DayOfWeek.MONDAY, startTime: "06:00", endTime: "07:00", isActive: true },
    { ptUserId: PT, dayOfWeek: DayOfWeek.MONDAY, startTime: "18:00", endTime: "19:00", isActive: true },
  ];
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 6, 0) },
  ];
  assert.deepEqual(earliest({ availabilities, bookedSessions: booked }), {
    date: "2026-08-17",
    startTime: "18:00",
  });
});

test("an inactive block is never offered", () => {
  const availabilities: SlotAvailabilityRow[] = [
    { ptUserId: PT, dayOfWeek: DayOfWeek.MONDAY, startTime: "09:00", endTime: "17:00", isActive: false },
    { ptUserId: PT, dayOfWeek: DayOfWeek.TUESDAY, startTime: "09:00", endTime: "17:00", isActive: true },
  ];
  assert.deepEqual(earliest({ availabilities }), { date: "2026-08-18", startTime: "09:00" });
});

test("nothing open in the search window returns null rather than a wrong guess", () => {
  const shortWindow = new Date(2026, 7, 17, 23, 59, 59, 999);
  const booked: SlotBookedRow[] = Array.from({ length: 8 }, (_, i) => ({
    ptUserId: PT,
    scheduledStartAt: new Date(2026, 7, 17, 9 + i, 0),
  }));
  assert.equal(earliest({ bookedSessions: booked, toDate: shortWindow }), null);
});

test("rows belonging to a different PT are never mixed in", () => {
  const availabilities = [...weekdayNineToFive(PT), ...weekdayNineToFive(OTHER_PT)];
  const booked: SlotBookedRow[] = [
    { ptUserId: PT, scheduledStartAt: new Date(2026, 7, 17, 9, 0) },
    // Booking OTHER_PT's identical slot must not affect PT's answer.
    { ptUserId: OTHER_PT, scheduledStartAt: new Date(2026, 7, 17, 10, 0) },
  ];
  assert.deepEqual(earliest({ availabilities, bookedSessions: booked, ptUserId: PT }), {
    date: "2026-08-17",
    startTime: "10:00",
  });
});
