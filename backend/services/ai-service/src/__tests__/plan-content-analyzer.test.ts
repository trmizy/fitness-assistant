import test from "node:test";
import assert from "node:assert/strict";
import { analyzePlanContent, type PlanContentLike } from "../services/plan-content-analyzer";

function day(name: string, exercises: Array<{ exerciseId: string; sets: number }>): PlanContentLike["weeklySchedule"][number] {
  return { day: name, exercises: exercises.map((e) => ({ ...e, name: e.exerciseId, reps: "10" })) };
}

test("a normal 3-day plan with rest days and progression notes -> no rule flags", () => {
  const content: PlanContentLike = {
    daysPerWeek: 3,
    weeklySchedule: [day("Day 1", [{ exerciseId: "a", sets: 3 }]), day("Day 2", [{ exerciseId: "b", sets: 3 }]), day("Day 3", [{ exerciseId: "c", sets: 3 }])],
    progressionNotes: ["Tăng dần khối lượng"],
    recoveryNotes: ["Nghỉ 1-2 ngày giữa các buổi"],
  };
  const result = analyzePlanContent(content);
  assert.deepEqual(result.ruleFlags, []);
  assert.equal(result.computedStats.daysPerWeek, 3);
  assert.equal(result.computedStats.restDaysPerWeek, 4);
});

test("7 days/week -> NO_REST_DAY flag", () => {
  const content: PlanContentLike = {
    daysPerWeek: 7,
    weeklySchedule: Array.from({ length: 7 }, (_, i) => day(`Day ${i + 1}`, [{ exerciseId: "a", sets: 3 }])),
  };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("NO_REST_DAY"));
});

test("high frequency (6+ days) without progressionNotes -> flagged", () => {
  const content: PlanContentLike = {
    daysPerWeek: 6,
    weeklySchedule: Array.from({ length: 6 }, (_, i) => day(`Day ${i + 1}`, [{ exerciseId: "a", sets: 3 }])),
    progressionNotes: [],
  };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("HIGH_FREQUENCY_WITHOUT_PROGRESSION_NOTES"));
});

test("a session with 30+ total sets -> EXCESSIVE_VOLUME_PER_SESSION", () => {
  const content: PlanContentLike = {
    daysPerWeek: 1,
    weeklySchedule: [day("Day 1", Array.from({ length: 10 }, (_, i) => ({ exerciseId: `ex-${i}`, sets: 4 })))],
  };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("EXCESSIVE_VOLUME_PER_SESSION"));
  assert.equal(result.computedStats.maxSetsInASession, 40);
});

test("a single exercise with 8+ sets -> EXCESSIVE_SETS_SINGLE_EXERCISE", () => {
  const content: PlanContentLike = {
    daysPerWeek: 1,
    weeklySchedule: [day("Day 1", [{ exerciseId: "a", sets: 8 }])],
  };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("EXCESSIVE_SETS_SINGLE_EXERCISE"));
});

test("the same exercise repeated within one day -> DUPLICATE_EXERCISE_SAME_SESSION", () => {
  const content: PlanContentLike = {
    daysPerWeek: 1,
    weeklySchedule: [day("Day 1", [{ exerciseId: "a", sets: 3 }, { exerciseId: "a", sets: 3 }])],
  };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("DUPLICATE_EXERCISE_SAME_SESSION"));
  assert.equal(result.computedStats.sessionsWithDuplicateExercise, 1);
});

test("an empty schedule -> EMPTY_SCHEDULE flag, no crash", () => {
  const content: PlanContentLike = { daysPerWeek: 0, weeklySchedule: [] };
  const result = analyzePlanContent(content);
  assert.ok(result.ruleFlags.includes("EMPTY_SCHEDULE"));
  assert.equal(result.computedStats.averageSetsPerSession, 0);
});

test("high frequency WITH recovery notes does not fire MISSING_RECOVERY_NOTES_HIGH_FREQUENCY", () => {
  const content: PlanContentLike = {
    daysPerWeek: 6,
    weeklySchedule: Array.from({ length: 6 }, (_, i) => day(`Day ${i + 1}`, [{ exerciseId: "a", sets: 3 }])),
    progressionNotes: ["note"],
    recoveryNotes: ["Nghỉ ngơi đầy đủ"],
  };
  const result = analyzePlanContent(content);
  assert.ok(!result.ruleFlags.includes("MISSING_RECOVERY_NOTES_HIGH_FREQUENCY"));
});
