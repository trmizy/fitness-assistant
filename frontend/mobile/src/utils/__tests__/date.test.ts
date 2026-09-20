/**
 * Date helpers shared by the dashboard, the week view and InBody. The date-only parsing case is
 * the one that matters most: reading a `YYYY-MM-DD` label as an instant shifts it by a day for
 * anyone not in UTC, and web shipped that bug once.
 *
 * Runs with: npx tsx --test src/utils/__tests__/date.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  greetingForHour,
  inBodyDateKey,
  parseApiDateOnly,
  sortInBodyNewestFirst,
  startOfWeek,
  toDateInputValue,
} from "../date";

describe("toDateInputValue", () => {
  it("formats the LOCAL calendar day", () => {
    assert.equal(toDateInputValue(new Date(2026, 8, 5, 23, 59)), "2026-09-05");
    assert.equal(toDateInputValue(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
  });
});

describe("parseApiDateOnly", () => {
  it("keeps the date label of an ISO string with a UTC suffix", () => {
    const d = parseApiDateOnly("2026-09-14T00:00:00.000Z");
    assert.equal(toDateInputValue(d), "2026-09-14");
    assert.equal(d.getHours(), 0);
  });

  it("normalizes a Date to local midnight", () => {
    const d = parseApiDateOnly(new Date(2026, 8, 14, 17, 45));
    assert.equal(toDateInputValue(d), "2026-09-14");
    assert.equal(d.getHours(), 0);
  });
});

describe("inBodyDateKey", () => {
  it("prefers dateOnly, then date, then createdAt", () => {
    assert.equal(inBodyDateKey({ dateOnly: "2026-09-01", date: "2026-08-01", createdAt: "2026-07-01" }), "2026-09-01");
    assert.equal(inBodyDateKey({ date: "2026-08-01T10:00:00Z", createdAt: "2026-07-01" }), "2026-08-01");
    assert.equal(inBodyDateKey({ createdAt: "2026-07-01T00:00:00Z" }), "2026-07-01");
  });

  it("normalizes the DD/MM/YYYY and DD-MM-YYYY forms manual entry and OCR produce", () => {
    assert.equal(inBodyDateKey({ date: "05/09/2026" }), "2026-09-05");
    assert.equal(inBodyDateKey({ date: "05-09-2026" }), "2026-09-05");
  });

  it("sorts a missing or unparseable date to the end instead of pretending it is newest", () => {
    assert.equal(inBodyDateKey({}), "9999-12-31");
    assert.equal(inBodyDateKey({ date: "hôm qua" }), "9999-12-31");
  });
});

describe("sortInBodyNewestFirst", () => {
  it("orders by measurement date descending, createdAt breaking ties, without mutating", () => {
    const records = [
      { id: "old", date: "2026-08-01", createdAt: "2026-08-01T08:00:00Z" },
      { id: "new-early", date: "2026-09-01", createdAt: "2026-09-01T08:00:00Z" },
      { id: "new-late", date: "2026-09-01", createdAt: "2026-09-01T20:00:00Z" },
    ];
    const sorted = sortInBodyNewestFirst(records);
    assert.deepEqual(
      sorted.map((r) => r.id),
      ["new-late", "new-early", "old"],
    );
    assert.equal(records[0].id, "old", "input order is left untouched");
  });
});

describe("startOfWeek / addDays", () => {
  it("weeks start on Monday — Sunday belongs to the week that began six days earlier", () => {
    assert.equal(toDateInputValue(startOfWeek(new Date(2026, 8, 20, 12))), "2026-09-14"); // Sunday
    assert.equal(toDateInputValue(startOfWeek(new Date(2026, 8, 14, 1))), "2026-09-14"); // Monday
    assert.equal(toDateInputValue(startOfWeek(new Date(2026, 8, 16))), "2026-09-14"); // Wednesday
  });

  it("adds days across month and year boundaries", () => {
    assert.equal(toDateInputValue(addDays(new Date(2026, 8, 28), 6)), "2026-10-04");
    assert.equal(toDateInputValue(addDays(new Date(2026, 11, 31), 1)), "2027-01-01");
    assert.equal(toDateInputValue(addDays(new Date(2026, 8, 1), -1)), "2026-08-31");
  });
});

describe("greetingForHour", () => {
  it("past midnight is still evening, not morning (caught on device at 00:42)", () => {
    assert.equal(greetingForHour(0), "Chào buổi tối,");
    assert.equal(greetingForHour(3), "Chào buổi tối,");
  });

  it("switches at 04:00, 11:00 and 18:00", () => {
    assert.equal(greetingForHour(4), "Chào buổi sáng,");
    assert.equal(greetingForHour(10), "Chào buổi sáng,");
    assert.equal(greetingForHour(11), "Chào buổi chiều,");
    assert.equal(greetingForHour(17), "Chào buổi chiều,");
    assert.equal(greetingForHour(18), "Chào buổi tối,");
    assert.equal(greetingForHour(23), "Chào buổi tối,");
  });
});
