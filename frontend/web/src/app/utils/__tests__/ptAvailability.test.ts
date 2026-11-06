import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupCurrentPtAvailability } from "../ptAvailability";

describe("current PT availability projection", () => {
  it("reads full backend weekdays, keeps multiple ranges in order, and excludes inactive rows", () => {
    const week = groupCurrentPtAvailability([
      { dayOfWeek: "MONDAY", startTime: "15:00", endTime: "18:00", isActive: true },
      { dayOfWeek: "MONDAY", startTime: "08:00", endTime: "11:00", isActive: true },
      { dayOfWeek: "TUESDAY", startTime: "08:00", endTime: "10:00", isActive: false },
    ]);
    assert.equal(week.length, 7);
    assert.deepEqual(week[0].ranges, [
      { startTime: "08:00", endTime: "11:00" },
      { startTime: "15:00", endTime: "18:00" },
    ]);
    assert.deepEqual(week[1].ranges, []);
  });

  it("does not turn historical abbreviated application days or malformed values into current hours", () => {
    const week = groupCurrentPtAvailability([
      { dayOfWeek: "Mon", startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: "FRIDAY", startTime: "17:00", endTime: "09:00" },
      { dayOfWeek: "SATURDAY", startTime: "not-time", endTime: "15:00" },
    ]);
    assert.ok(week.every((day) => day.ranges.length === 0));
    assert.ok(groupCurrentPtAvailability(null).every((day) => day.ranges.length === 0));
  });
});
