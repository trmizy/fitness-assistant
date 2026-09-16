import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_SCORING, scoreTrainingProgram, type AgentPreferences, type TrainingProgramCandidate } from "@gym-coach/shared";

function program(overrides: Partial<TrainingProgramCandidate> = {}): TrainingProgramCandidate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Hypertrophy 3 Days",
    goal: "MUSCLE_GAIN",
    daysPerWeek: 3,
    durationWeeks: 12,
    estimatedMinutes: 55,
    experienceLevel: "BEGINNER",
    focusMuscles: ["CHEST", "BACK", "LEGS"],
    fingerprint: "fp",
    dataOrigin: "REAL",
    days: [],
    ...overrides,
  };
}

const prefs: AgentPreferences = {
  goal: "MUSCLE_GAIN",
  days: [1, 3, 5],
  sessionMinutes: 60,
  durationWeeks: 12,
  demo: false,
};

test("scoreTrainingProgram: exact eligible program scores 100 without outcome-history claims", () => {
  const score = scoreTrainingProgram(program({ estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  assert.equal(score.scoringVersion, PROGRAM_SCORING.version);
  assert.equal(score.total, 100);
  assert.equal(score.components.goal, 1);
  assert.equal(score.components.experience, 1);
  assert.equal(score.components.schedule, 1);
  assert.equal(score.components.equipment, 1);
  assert.deepEqual(score.reasons?.filter(r => r.endsWith("_MATCH") || r === "PROGRAM_EQUIPMENT_FULL_MATCH"), [
    "PROGRAM_GOAL_MATCH",
    "PROGRAM_EXPERIENCE_MATCH",
    "PROGRAM_SCHEDULE_MATCH",
    "PROGRAM_EQUIPMENT_FULL_MATCH",
    "PROGRAM_SESSION_DURATION_STRONG_MATCH",
    "PROGRAM_FOCUS_MUSCLE_MATCH",
    "PROGRAM_DURATION_WEEKS_MATCH",
  ]);
});

test("scoreTrainingProgram: longer program near the session limit is not rewarded merely for being longer", () => {
  const nearTarget = scoreTrainingProgram(program({ estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER" });
  const atLimit = scoreTrainingProgram(program({ estimatedMinutes: 60 }), prefs, { userExperience: "BEGINNER" });
  assert.ok(nearTarget.components.sessionDuration > atLimit.components.sessionDuration);
  assert.ok(nearTarget.total >= atLimit.total);
});

test("scoreTrainingProgram: optional focus and week fields are omitted when user did not provide them", () => {
  const score = scoreTrainingProgram(program(), { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, demo: false }, { userExperience: "BEGINNER" });
  assert.equal("focusMuscle" in score.components, false);
  assert.equal("durationWeeks" in score.components, false);
});

test("scoreTrainingProgram: ranking is deterministic on total score then id", () => {
  const rows = [
    program({ id: "22222222-2222-2222-2222-222222222222", estimatedMinutes: 60 }),
    program({ id: "11111111-1111-1111-1111-111111111111", estimatedMinutes: 60 }),
    program({ id: "33333333-3333-3333-3333-333333333333", estimatedMinutes: 51 }),
  ];
  const ranked = rows
    .map(p => ({ p, score: scoreTrainingProgram(p, prefs, { userExperience: "BEGINNER" }) }))
    .sort((a, b) => b.score.total - a.score.total || a.p.id.localeCompare(b.p.id))
    .map(r => r.p.id);
  assert.deepEqual(ranked, [
    "33333333-3333-3333-3333-333333333333",
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);
});

test("scoreTrainingProgram: generated 100-case matrix is deterministic and bounded", () => {
  const first = Array.from({ length: 100 }, (_, i) => scoreTrainingProgram(program({
    id: `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    estimatedMinutes: 30 + (i % 31),
    durationWeeks: 6 + (i % 20),
    focusMuscles: i % 2 ? ["CHEST"] : ["LEGS"],
  }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }));
  const second = Array.from({ length: 100 }, (_, i) => scoreTrainingProgram(program({
    id: `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    estimatedMinutes: 30 + (i % 31),
    durationWeeks: 6 + (i % 20),
    focusMuscles: i % 2 ? ["CHEST"] : ["LEGS"],
  }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }));
  assert.deepEqual(first, second);
  for (const score of first) assert.ok(score.total >= 0 && score.total <= 100);
});
