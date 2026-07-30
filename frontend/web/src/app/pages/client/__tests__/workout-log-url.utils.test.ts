/**
 * Pure-logic tests for WorkoutLogPage's URL-based navigation restoration —
 * no DOM, no router, no component render needed (this frontend has no
 * jsdom/RTL set up; see RulerSlider.utils.test.ts for the same convention).
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/workout-log-url.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseInitialWorkoutLogState,
  resolveExerciseIndexFromId,
  computeWorkoutLogSearchParams,
} from "../workout-log-url.utils";

describe("parseInitialWorkoutLogState", () => {
  it("a bare URL with no params restores the default overview/main state", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams(""));
    assert.deepEqual(state, { tab: "overview", day: 1, date: null, exerciseId: null, planView: "main" });
  });

  it("?tab=plan&day=2 (no exercise) restores the dayDetail view for day 2", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("tab=plan&day=2"));
    assert.deepEqual(state, { tab: "plan", day: 2, date: null, exerciseId: null, planView: "dayDetail" });
  });

  it("?tab=plan&day=2&exercise=<id> restores the activeExercise view — the reported bug scenario", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("tab=plan&day=2&exercise=abc-123"));
    assert.deepEqual(state, { tab: "plan", day: 2, date: null, exerciseId: "abc-123", planView: "activeExercise" });
  });

  it("an invalid day value (non-numeric) falls back to day 1 instead of crashing", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("tab=plan&day=not-a-number"));
    assert.equal(state.day, 1);
  });

  it("a negative or zero day value falls back to day 1", () => {
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("day=0")).day, 1);
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("day=-5")).day, 1);
  });

  it("an exercise id present without tab=plan is still treated as activeExercise (tab gets corrected by the caller)", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("exercise=xyz"));
    assert.equal(state.planView, "activeExercise");
    assert.equal(state.tab, "overview");
  });

  it("an unrecognized tab value falls back to overview", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("tab=something-else"));
    assert.equal(state.tab, "overview");
  });

  it("a valid date=YYYY-MM-DD is restored — the specific calendar occurrence, not just the day-of-week template", () => {
    const state = parseInitialWorkoutLogState(new URLSearchParams("tab=plan&day=6&date=2026-07-04"));
    assert.equal(state.date, "2026-07-04");
  });

  it("a malformed date param is ignored rather than crashing or restoring a bogus date", () => {
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("date=not-a-date")).date, null);
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("date=2026-13-99")).date, null);
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("date=07-04-2026")).date, null);
  });

  it("no date param at all resolves to null (caller falls back to 'today', e.g. first-ever visit)", () => {
    assert.equal(parseInitialWorkoutLogState(new URLSearchParams("tab=plan&day=1")).date, null);
  });
});

describe("resolveExerciseIndexFromId", () => {
  const exercises = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("finds the matching exercise by stable id, not by a hard-coded index", () => {
    assert.equal(resolveExerciseIndexFromId(exercises, "c"), 2);
  });

  it("finds the first exercise correctly (boundary)", () => {
    assert.equal(resolveExerciseIndexFromId(exercises, "a"), 0);
  });

  it("finds the last exercise correctly (boundary)", () => {
    assert.equal(resolveExerciseIndexFromId(exercises, "d"), 3);
  });

  it("an id that no longer exists in the list falls back to index 0 instead of crashing", () => {
    assert.equal(resolveExerciseIndexFromId(exercises, "does-not-exist"), 0);
  });

  it("a null pending id (no exercise param in the URL) resolves to index 0", () => {
    assert.equal(resolveExerciseIndexFromId(exercises, null), 0);
  });

  it("an empty exercise list never throws, even with a pending id", () => {
    assert.equal(resolveExerciseIndexFromId([], "anything"), 0);
  });

  it("still resolves correctly when the exercise list has been reordered — matches by id, not position", () => {
    // Simulates the list changing order between loads (e.g. a program edit)
    // while ids stay stable; the previously-selected exercise must still be
    // found at its NEW position, not wherever it used to sit.
    const reordered = [{ id: "d" }, { id: "b" }, { id: "a" }, { id: "c" }];
    assert.equal(resolveExerciseIndexFromId(reordered, "a"), 2);
  });
});

describe("computeWorkoutLogSearchParams", () => {
  it("the overview tab produces no navigation params at all", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "overview",
      planView: "main",
      selectedDay: 3,
      selectedDateLabel: "2026-07-04",
      currentExerciseId: "some-id",
    });
    assert.equal(params.toString(), "");
  });

  it("plan tab + main view sets only tab (no day/date/exercise yet)", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "main",
      selectedDay: 1,
      selectedDateLabel: null,
      currentExerciseId: null,
    });
    assert.equal(params.get("tab"), "plan");
    assert.equal(params.get("day"), null);
    assert.equal(params.get("date"), null);
    assert.equal(params.get("exercise"), null);
  });

  it("plan tab + dayDetail view sets tab, day, and date, but not exercise", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "dayDetail",
      selectedDay: 2,
      selectedDateLabel: "2026-07-07",
      currentExerciseId: undefined,
    });
    assert.equal(params.get("tab"), "plan");
    assert.equal(params.get("day"), "2");
    assert.equal(params.get("date"), "2026-07-07");
    assert.equal(params.get("exercise"), null);
  });

  it("plan tab + activeExercise view sets tab, day, date, and exercise — the full restorable position", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "activeExercise",
      selectedDay: 1,
      selectedDateLabel: "2026-07-06",
      currentExerciseId: "exercise-42",
    });
    assert.equal(params.get("tab"), "plan");
    assert.equal(params.get("day"), "1");
    assert.equal(params.get("date"), "2026-07-06");
    assert.equal(params.get("exercise"), "exercise-42");
  });

  it("activeExercise view without a resolvable exercise id (data still loading) omits the exercise param rather than writing a bogus one", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "activeExercise",
      selectedDay: 1,
      selectedDateLabel: "2026-07-06",
      currentExerciseId: undefined,
    });
    assert.equal(params.get("exercise"), null);
  });

  it("dayDetail/activeExercise view with no resolvable date (never-scheduled template day) omits the date param rather than writing a bogus one", () => {
    const params = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "dayDetail",
      selectedDay: 1,
      selectedDateLabel: null,
      currentExerciseId: undefined,
    });
    assert.equal(params.get("date"), null);
  });

  it("round-trips through parseInitialWorkoutLogState (write then read gives back the same position, including date)", () => {
    const written = computeWorkoutLogSearchParams({
      tab: "plan",
      planView: "activeExercise",
      selectedDay: 3,
      selectedDateLabel: "2026-07-18",
      currentExerciseId: "ex-9",
    });
    const readBack = parseInitialWorkoutLogState(written);
    assert.equal(readBack.tab, "plan");
    assert.equal(readBack.day, 3);
    assert.equal(readBack.date, "2026-07-18");
    assert.equal(readBack.exerciseId, "ex-9");
    assert.equal(readBack.planView, "activeExercise");
  });
});
