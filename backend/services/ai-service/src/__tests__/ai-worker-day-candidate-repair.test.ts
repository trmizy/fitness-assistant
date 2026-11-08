import assert from "node:assert/strict";
import test from "node:test";
import { repairDayCandidateExercises } from "../workers/ai.worker";
import { validateWorkoutPlanInvariants } from "../services/workout-plan-invariant.service";

/**
 * Regression for the 2026-10-22 live failure: "Final workout plan
 * invariant failed: exercise_outside_day_candidates" repeated across
 * nearly every day of a generated plan, even though the per-day
 * candidate catalogs themselves were built correctly (confirmed via
 * CloudWatch: 8 muscle-group-correct exercises per day) — Nova Pro was
 * not reliably honoring the prompt's "use ONLY ids under Day N"
 * instruction. repairDayCandidateExercises is the fix: swap each
 * violating slot for an unused exercise already proven correct for that
 * exact day, sourced only from perDayCatalogs, never a wider pool.
 */

const chest1 = { id: "chest-1", exerciseName: "Bench Press" };
const chest2 = { id: "chest-2", exerciseName: "Incline Dumbbell Press" };
const legs1 = { id: "legs-1", exerciseName: "Back Squat" };
const legs2 = { id: "legs-2", exerciseName: "Leg Press" };

const catalogs = [
  { dayIndex: 0, dayGoal: "Nguc", focusMuscleGroups: ["CHEST"], exercises: [chest1, chest2] },
  { dayIndex: 1, dayGoal: "Chan", focusMuscleGroups: ["LEGS"], exercises: [legs1, legs2] },
];

function plan() {
  return {
    goal: "muscle gain",
    durationWeeks: 4,
    daysPerWeek: 2,
    exercisesPerDay: 2,
    weeklySchedule: [
      {
        day: "Day 1",
        goal: "Nguc",
        exercises: [
          { exerciseId: legs1.id, order: 1, name: legs1.exerciseName, sets: 4, reps: "6-10", restSeconds: 120 },
          { exerciseId: legs2.id, order: 2, name: legs2.exerciseName, sets: 3, reps: "8-12", restSeconds: 75 },
        ],
      },
      {
        day: "Day 2",
        goal: "Chan",
        exercises: [
          { exerciseId: legs1.id, order: 1, name: legs1.exerciseName, sets: 4, reps: "6-10", restSeconds: 120 },
          { exerciseId: legs2.id, order: 2, name: legs2.exerciseName, sets: 3, reps: "8-12", restSeconds: 75 },
        ],
      },
    ],
    progressionNotes: [],
    recoveryNotes: [],
  };
}

function validate(content: unknown) {
  return validateWorkoutPlanInvariants({
    content,
    daysPerWeek: 2,
    exercisesPerDay: 2,
    allowedExercises: [chest1, chest2, legs1, legs2],
    perDayCatalogs: catalogs,
  });
}

test("repairs both Day 1 slots from Day 1's own catalog, leaving Day 2 (already valid) untouched", () => {
  const content = plan();
  const before = validate(content);
  assert.equal(before.ok, false);
  if (before.ok) throw new Error("unreachable");

  const repairs = repairDayCandidateExercises(content, before.violations, catalogs as any);
  assert.equal(repairs.length, 2);
  assert.deepEqual(
    repairs.map((r) => r.dayIndex),
    [0, 0],
  );

  const day1Ids = content.weeklySchedule[0].exercises.map((e: any) => e.exerciseId).sort();
  assert.deepEqual(day1Ids, [chest1.id, chest2.id].sort());
  // Day 2 was already valid (legs on a legs day) — untouched by the repair.
  assert.deepEqual(
    content.weeklySchedule[1].exercises.map((e: any) => e.exerciseId),
    [legs1.id, legs2.id],
  );

  const after = validate(content);
  assert.equal(after.ok, true);
});

test("does not invent a replacement when the day's catalog has no spare exercise left", () => {
  const content = plan();
  // Make Day 1 need 3 distinct exercises, but its catalog only has 2.
  content.exercisesPerDay = 3;
  content.weeklySchedule[0].exercises.push({
    exerciseId: legs1.id,
    order: 3,
    name: legs1.exerciseName,
    sets: 3,
    reps: "8-12",
    restSeconds: 75,
  });

  const before = validateWorkoutPlanInvariants({
    content,
    daysPerWeek: 2,
    exercisesPerDay: 3,
    allowedExercises: [chest1, chest2, legs1, legs2],
    perDayCatalogs: catalogs,
  });
  assert.equal(before.ok, false);
  if (before.ok) throw new Error("unreachable");

  const repairs = repairDayCandidateExercises(content, before.violations, catalogs as any);
  // Only 2 spares (chest1, chest2) exist for Day 1's 3 violating/duplicate slots — at most 2 get repaired.
  assert.ok(repairs.length <= 2);

  const after = validateWorkoutPlanInvariants({
    content,
    daysPerWeek: 2,
    exercisesPerDay: 3,
    allowedExercises: [chest1, chest2, legs1, legs2],
    perDayCatalogs: catalogs,
  });
  // Still genuinely unrepairable (not enough distinct Day-1 candidates) — must still fail, never silently pass.
  assert.equal(after.ok, false);
});

test("is a no-op when the plan already satisfies every day-candidate constraint", () => {
  const content = plan();
  content.weeklySchedule[0].exercises = [
    { exerciseId: chest1.id, order: 1, name: chest1.exerciseName, sets: 4, reps: "6-10", restSeconds: 120 },
    { exerciseId: chest2.id, order: 2, name: chest2.exerciseName, sets: 3, reps: "8-12", restSeconds: 75 },
  ];
  const result = validate(content);
  assert.equal(result.ok, true);
  const repairs = repairDayCandidateExercises(content, [], catalogs as any);
  assert.equal(repairs.length, 0);
});
