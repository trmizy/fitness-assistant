import test from "node:test";
import assert from "node:assert/strict";
import { classifyDayState } from "../utils/activity-heatmap.util";

/**
 * Roadmap P3.2 "Activity heatmap"
 * (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
 */

const TODAY = "2026-08-26";

test("classifyDayState: a future date is never classified into any of the 5 states", () => {
  const result = classifyDayState({
    dateLabel: "2026-09-01",
    todayLabel: TODAY,
    scheduleStatusAtDate: null,
    hasOriginalPlanMovedAway: false,
  });
  assert.equal(result, null);
});

test("classifyDayState: COMPLETED -> completed", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "COMPLETED", hasOriginalPlanMovedAway: false }),
    "completed",
  );
});

test("classifyDayState: PARTIALLY_COMPLETED -> partial", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "PARTIALLY_COMPLETED", hasOriginalPlanMovedAway: false }),
    "partial",
  );
});

test("classifyDayState: SKIPPED and CANCELLED both collapse to missed", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "SKIPPED", hasOriginalPlanMovedAway: false }),
    "missed",
  );
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "CANCELLED", hasOriginalPlanMovedAway: false }),
    "missed",
  );
});

test("classifyDayState: NOT_STARTED/IN_PROGRESS in the past -> missed (planned but no action taken in time)", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "NOT_STARTED", hasOriginalPlanMovedAway: false }),
    "missed",
  );
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "IN_PROGRESS", hasOriginalPlanMovedAway: false }),
    "missed",
  );
});

test("classifyDayState: no schedule row, but this date is where an original plan moved away from -> rescheduled", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: null, hasOriginalPlanMovedAway: true }),
    "rescheduled",
  );
});

test("classifyDayState: no schedule row, nothing ever planned here -> rest", () => {
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: null, hasOriginalPlanMovedAway: false }),
    "rest",
  );
});

test("classifyDayState: today itself (not future) with a real status is classified normally", () => {
  assert.equal(
    classifyDayState({ dateLabel: TODAY, todayLabel: TODAY, scheduleStatusAtDate: "COMPLETED", hasOriginalPlanMovedAway: false }),
    "completed",
  );
});

test("classifyDayState: a schedule row at this exact date takes priority over a stale hasOriginalPlanMovedAway flag", () => {
  // Defensive case: a date can't simultaneously have a real current
  // schedule AND be "where a plan moved away from" in valid data, but
  // the function should still resolve deterministically (the real
  // schedule wins) if it somehow did.
  assert.equal(
    classifyDayState({ dateLabel: "2026-08-20", todayLabel: TODAY, scheduleStatusAtDate: "COMPLETED", hasOriginalPlanMovedAway: true }),
    "completed",
  );
});
