/**
 * Month calendar logic of the booking / reschedule sheets (pure, no React).
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/bookingCalendar.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BOOKING_LEAD_HOURS, RESCHEDULE_LEAD_HOURS } from "../services/sessions";
import {
  CALENDAR_HORIZON_DAYS,
  activeWeekdays,
  addMonths,
  bookingRange,
  candidateDays,
  canGoNext,
  canGoPrev,
  clampMonth,
  dayLabel,
  dayState,
  daysWithFreeSlots,
  freeSlotsOfDay,
  inRange,
  isTappable,
  monthGrid,
  monthTitle,
  parseDateKey,
  toDateKey,
} from "../services/bookingCalendar";

// Sunday 25/10/2026, 10:00 local.
const NOW = new Date(2026, 9, 25, 10, 0, 0);

describe("monthGrid (week starts Monday)", () => {
  it("October 2026 starts on a Thursday: 3 empty cells, 31 days, 5 rows", () => {
    const grid = monthGrid({ year: 2026, month: 9 });
    assert.equal(grid.length, 5);
    assert.ok(grid.every((row) => row.length === 7));
    assert.deepEqual(grid[0].slice(0, 4).map((c) => c?.day ?? null), [null, null, null, 1]);
    assert.equal(grid.flat().filter(Boolean).length, 31);
    assert.equal(grid[0][3]?.key, "2026-10-01");
    assert.equal(grid[4][5]?.key, "2026-10-31"); // Saturday
  });

  it("a month that begins on Monday has no leading blanks (June 2026) and 5 rows", () => {
    const grid = monthGrid({ year: 2026, month: 5 });
    assert.equal(grid[0][0]?.key, "2026-06-01");
    assert.equal(grid.length, 5);
  });

  it("a month that begins on Sunday has 6 leading blanks and 6 rows (March 2026)", () => {
    const grid = monthGrid({ year: 2026, month: 2 });
    assert.equal(grid[0].slice(0, 6).every((c) => c === null), true);
    assert.equal(grid[0][6]?.key, "2026-03-01");
    assert.equal(grid.length, 6);
  });

  it("February 2027 (28 days, starts Monday) fills exactly 4 rows", () => {
    const grid = monthGrid({ year: 2027, month: 1 });
    assert.equal(grid.length, 4);
    assert.equal(grid.flat().filter(Boolean).length, 28);
  });

  it("leap February 2028 has 29 days", () => {
    assert.equal(monthGrid({ year: 2028, month: 1 }).flat().filter(Boolean).length, 29);
  });
});

describe("month arithmetic", () => {
  it("rolls over the year both ways", () => {
    assert.deepEqual(addMonths({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
    assert.deepEqual(addMonths({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
    assert.deepEqual(addMonths({ year: 2026, month: 9 }, 0), { year: 2026, month: 9 });
  });

  it("titles in Vietnamese", () => {
    assert.equal(monthTitle({ year: 2026, month: 9 }), "Tháng 10, 2026");
  });

  it("parses only real calendar days", () => {
    assert.equal(parseDateKey("2026-10-27")?.getDate(), 27);
    assert.equal(parseDateKey("2026-02-30"), null);
    assert.equal(parseDateKey("27/10/2026"), null);
    assert.equal(toDateKey(new Date(2026, 0, 5)), "2026-01-05");
  });

  it("labels a day the way the sessions list does", () => {
    assert.equal(dayLabel("2026-10-27"), "Th 3, 27/10");
    assert.equal(dayLabel("2026-11-01"), "CN, 01/11");
    assert.equal(dayLabel("nope"), "");
  });
});

describe("bookingRange", () => {
  it("a new booking starts tomorrow (24h lead) and reaches the horizon", () => {
    const range = bookingRange({ now: NOW, leadHours: 24 });
    assert.equal(range?.minKey, "2026-10-26");
    assert.equal(range?.maxKey, toDateKey(new Date(2026, 9, 25 + CALENDAR_HORIZON_DAYS)));
  });

  it("late in the day the first day is still the one holding now + 24h", () => {
    const range = bookingRange({ now: new Date(2026, 9, 25, 23, 30), leadHours: 24 });
    assert.equal(range?.minKey, "2026-10-26"); // 25/10 23:30 + 24h = 26/10 23:30
  });

  it("a reschedule obeys the same 24h lead as a booking (B27) — client and PT side", () => {
    assert.equal(RESCHEDULE_LEAD_HOURS, BOOKING_LEAD_HOURS);
    assert.equal(bookingRange({ now: NOW, leadHours: RESCHEDULE_LEAD_HOURS })?.minKey, "2026-10-26");
    // 25/10 10:00: a slot at 26/10 09:00 is inside 24h and not offered, 10:00 is.
    assert.deepEqual(freeSlotsOfDay(["09:00", "10:00"], "2026-10-26", { now: NOW, leadHours: RESCHEDULE_LEAD_HOURS }), ["10:00"]);
  });

  it("a zero lead would start today (only for callers that really have none)", () => {
    assert.equal(bookingRange({ now: NOW, leadHours: 0 })?.minKey, "2026-10-25");
  });

  it("the contract end caps the range", () => {
    const range = bookingRange({ now: NOW, leadHours: 24, contractEnd: new Date(2026, 10, 10, 23, 59).toISOString() });
    assert.equal(range?.maxKey, "2026-11-10");
  });

  it("a contract end beyond the horizon does not extend it", () => {
    const range = bookingRange({ now: NOW, leadHours: 24, contractEnd: "2030-01-01T00:00:00.000Z" });
    assert.equal(range?.maxKey, toDateKey(new Date(2026, 9, 25 + CALENDAR_HORIZON_DAYS)));
  });

  it("a contract that ends before the lead time allows leaves nothing", () => {
    assert.equal(bookingRange({ now: NOW, leadHours: 24, contractEnd: new Date(2026, 9, 25, 20).toISOString() }), null);
  });

  it("a contract start in the future moves the first day (reschedule rule)", () => {
    const range = bookingRange({ now: NOW, leadHours: RESCHEDULE_LEAD_HOURS, contractStart: new Date(2026, 10, 3, 8).toISOString() });
    assert.equal(range?.minKey, "2026-11-03");
  });

  it("inRange is inclusive on both ends and false for null", () => {
    const range = { minKey: "2026-10-26", maxKey: "2026-10-28" };
    assert.equal(inRange("2026-10-26", range), true);
    assert.equal(inRange("2026-10-28", range), true);
    assert.equal(inRange("2026-10-25", range), false);
    assert.equal(inRange("2026-10-29", range), false);
    assert.equal(inRange("2026-10-27", null), false);
  });
});

describe("month navigation limits", () => {
  const range = { minKey: "2026-10-26", maxKey: "2026-12-24" };
  it("cannot go before the first month or after the last", () => {
    assert.equal(canGoPrev({ year: 2026, month: 9 }, range), false);
    assert.equal(canGoPrev({ year: 2026, month: 10 }, range), true);
    assert.equal(canGoNext({ year: 2026, month: 11 }, range), false);
    assert.equal(canGoNext({ year: 2026, month: 10 }, range), true);
  });
  it("no range means no navigation", () => {
    assert.equal(canGoPrev({ year: 2026, month: 9 }, null), false);
    assert.equal(canGoNext({ year: 2026, month: 9 }, null), false);
  });
  it("clamps a stale month back inside", () => {
    assert.deepEqual(clampMonth({ year: 2027, month: 3 }, range), { year: 2026, month: 11 });
    assert.deepEqual(clampMonth({ year: 2026, month: 0 }, range), { year: 2026, month: 9 });
    assert.deepEqual(clampMonth({ year: 2026, month: 10 }, range), { year: 2026, month: 10 });
  });
});

describe("which days are worth asking the slot endpoint about", () => {
  const range = { minKey: "2026-10-26", maxKey: "2026-11-05" };

  it("reads the PT's weekly pattern, ignoring inactive rows", () => {
    const weekdays = activeWeekdays([
      { dayOfWeek: "MONDAY", isActive: true },
      { dayOfWeek: "WEDNESDAY", isActive: true },
      { dayOfWeek: "FRIDAY", isActive: false },
    ]);
    assert.deepEqual([...weekdays!].sort(), [1, 3]);
  });

  it("an empty or unreadable pattern is 'unknown', not 'closed'", () => {
    assert.equal(activeWeekdays([]), null);
    assert.equal(activeWeekdays(undefined), null);
    assert.equal(activeWeekdays({ error: "x" }), null);
  });

  it("limits to range and worked weekdays", () => {
    const days = candidateDays({ year: 2026, month: 9 }, range, new Set([1, 3])); // Mon, Wed
    assert.deepEqual(days, ["2026-10-26", "2026-10-28"]);
    const nov = candidateDays({ year: 2026, month: 10 }, range, new Set([1, 3]));
    assert.deepEqual(nov, ["2026-11-02", "2026-11-04"]);
  });

  it("with an unknown pattern every in-range day of the month is asked", () => {
    assert.equal(candidateDays({ year: 2026, month: 9 }, range, null).length, 6); // 26..31 Oct
  });

  it("no range -> nothing to ask", () => {
    assert.deepEqual(candidateDays({ year: 2026, month: 9 }, null, null), []);
  });
});

describe("free slots", () => {
  const rules = { now: NOW, leadHours: 24 };

  it("drops slots inside the 24h lead time (same rule as bookableSlots)", () => {
    // now = 25/10 10:00 -> earliest 26/10 10:00
    assert.deepEqual(freeSlotsOfDay(["08:00", "10:00", "17:00"], "2026-10-26", rules), ["10:00", "17:00"]);
    assert.deepEqual(freeSlotsOfDay(["08:00", "17:00"], "2026-10-25", rules), []);
  });

  it("drops slots that start after the contract ends", () => {
    const end = new Date(2026, 10, 3, 9, 30).toISOString();
    assert.deepEqual(freeSlotsOfDay(["08:00", "09:00", "10:00"], "2026-11-03", { ...rules, contractEnd: end }), ["08:00", "09:00"]);
  });

  it("drops slots before the contract starts (reschedule)", () => {
    const start = new Date(2026, 10, 3, 9, 0).toISOString();
    assert.deepEqual(
      freeSlotsOfDay(["08:00", "09:00", "10:00"], "2026-11-03", { now: NOW, leadHours: RESCHEDULE_LEAD_HOURS, contractStart: start }),
      ["09:00", "10:00"],
    );
  });

  it("a day is 'free' only when at least one slot survives", () => {
    const free = daysWithFreeSlots(
      {
        "2026-10-26": ["09:00"], // before 10:00 -> dropped
        "2026-10-27": ["09:00"],
        "2026-10-28": [],
        "2026-10-29": undefined,
      },
      rules,
    );
    assert.deepEqual([...free], ["2026-10-27"]);
  });
});

describe("day state", () => {
  const range = { minKey: "2026-10-26", maxKey: "2026-10-30" };
  const ctx = {
    range,
    free: new Set(["2026-10-27", "2026-10-28"]),
    pending: new Set(["2026-10-29"]),
    selected: "2026-10-28",
  };

  it("classifies each case", () => {
    assert.equal(dayState("2026-10-25", ctx), "out");
    assert.equal(dayState("2026-10-31", ctx), "out");
    assert.equal(dayState("2026-10-27", ctx), "free");
    assert.equal(dayState("2026-10-28", ctx), "selected");
    assert.equal(dayState("2026-10-29", ctx), "pending");
    assert.equal(dayState("2026-10-30", ctx), "none");
  });

  it("only free / selected days can be tapped", () => {
    assert.deepEqual(
      (["out", "free", "selected", "pending", "none"] as const).map(isTappable),
      [false, true, true, false, false],
    );
  });
});
