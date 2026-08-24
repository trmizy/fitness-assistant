import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkoutPlanInvariants } from "../services/workout-plan-invariant.service";

const chest = { id: "chest-1", exerciseName: "Chest Press" };
const legs = { id: "legs-1", exerciseName: "Leg Press" };
const catalogs = [
  { dayIndex: 0, dayGoal: "Nguc", focusMuscleGroups: ["CHEST"], exercises: [chest] },
  { dayIndex: 1, dayGoal: "Chan", focusMuscleGroups: ["LEGS"], exercises: [legs] },
];

function plan() {
  return {
    goal: "muscle gain",
    durationWeeks: 4,
    daysPerWeek: 2,
    exercisesPerDay: 1,
    weeklySchedule: [
      { day: "Day 1", goal: "Nguc", exercises: [{ exerciseId: chest.id, order: 1, name: chest.exerciseName, sets: 3, reps: "8-12", restSeconds: 90 }] },
      { day: "Day 2", goal: "Chan", exercises: [{ exerciseId: legs.id, order: 1, name: legs.exerciseName, sets: 3, reps: "8-12", restSeconds: 90 }] },
    ],
    progressionNotes: [],
    recoveryNotes: [],
  };
}

function validate(content: unknown) {
  return validateWorkoutPlanInvariants({ content, daysPerWeek: 2, exercisesPerDay: 1, allowedExercises: [chest, legs], perDayCatalogs: catalogs });
}

test("accepts a plan that matches its deterministic skeleton and day candidates", () => {
  assert.equal(validate(plan()).ok, true);
});

test("rejects missing days instead of allowing completed state", () => {
  const content = plan();
  content.weeklySchedule.pop();
  const result = validate(content);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.violations.some((item) => item.code === "days_per_week_mismatch"));
});

test("rejects duplicate day labels", () => {
  const content = plan();
  content.weeklySchedule[1].day = "Day 1";
  const result = validate(content);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.violations.some((item) => item.code === "duplicate_day"));
});

test("rejects an unknown exercise ID", () => {
  const content = plan();
  content.weeklySchedule[0].exercises[0].exerciseId = "invented";
  const result = validate(content);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.violations.some((item) => item.code === "invalid_exercise_id"));
});

test("rejects a globally valid exercise placed in the wrong muscle-day candidate set", () => {
  const content = plan();
  content.weeklySchedule[0].exercises[0].exerciseId = legs.id;
  const result = validate(content);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.violations.some((item) => item.code === "exercise_outside_day_candidates"));
});

test("rejects an empty day and invalid prescription", () => {
  const content = plan();
  content.weeklySchedule[0].exercises = [];
  content.weeklySchedule[1].exercises[0].sets = 0;
  const result = validate(content);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.violations.some((item) => item.code === "empty_day"));
    assert(result.violations.some((item) => item.code === "invalid_sets"));
  }
});

