/**
 * The "day the PT works" marker shared by the booking calendar and the reschedule picker (pure). TEST FIXTURE - no browser run.
 * Run: npx tsx --test src/app/utils/__tests__/ptWeeklyHours.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isWorkingDay, latestEndByWeekday } from "../ptWeeklyHours";

const rows = [
  { dayOfWeek: "MONDAY", startTime: "06:00", endTime: "11:00", isActive: true },
  { dayOfWeek: "MONDAY", startTime: "14:00", endTime: "20:30", isActive: true },
  { dayOfWeek: "TUESDAY", startTime: "06:00", endTime: "09:00", isActive: false },
  { dayOfWeek: "SATURDAY", startTime: "08:00", endTime: "12:00", isActive: true },
];

describe("latestEndByWeekday", () => {
  it("keeps the latest end per active weekday and skips inactive rows", () => {
    const m = latestEndByWeekday(rows);
    assert.equal(m.get(1), 20 * 60 + 30);
    assert.equal(m.get(6), 12 * 60);
    assert.equal(m.has(2), false);
  });
  it("is empty for anything that is not a list", () => {
    assert.equal(latestEndByWeekday(null).size, 0);
    assert.equal(latestEndByWeekday({ data: rows }).size, 0);
  });
});

describe("isWorkingDay", () => {
  const monday = new Date(2030, 4, 6); // Monday 6 May 2030, local midnight
  const map = latestEndByWeekday(rows);
  it("true for a working weekday far enough ahead, false for a day off", () => {
    const now = new Date(2030, 4, 1).getTime();
    assert.equal(isWorkingDay(monday, map, now), true);
    assert.equal(isWorkingDay(new Date(2030, 4, 7), map, now), false); // Tuesday, inactive
  });
  it("false when the last start of the window is inside the 24 h lead", () => {
    const now = new Date(2030, 4, 6, 12, 0).getTime(); // Monday noon: last start 19:30 is < 24 h away
    assert.equal(isWorkingDay(monday, map, now), false);
  });
});

describe("both calendars use the shared marker", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app", rel), "utf8");
  it("the reschedule picker (DateSlotPicker) and the booking page import it", () => {
    assert.match(read("components/booking/DateSlotPicker.tsx"), /isWorkingDay\(dateObj, latestEnd\)/);
    assert.match(read("pages/client/BookingPage.tsx"), /isWorkingDay\(dateObj, ptLatestEndByWeekday\)/);
  });
});
