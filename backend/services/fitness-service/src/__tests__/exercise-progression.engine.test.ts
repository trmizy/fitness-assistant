import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExerciseProgression,
  type ExerciseProgressionInput,
  type ExercisePerformanceSession,
  type PerformanceSetRow,
} from "../services/exercise-progression.engine";

function set(overrides: Partial<PerformanceSetRow> = {}): PerformanceSetRow {
  return {
    weightKg: null,
    reps: null,
    rir: null,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    completed: true,
    setType: "WORKING",
    ...overrides,
  };
}

function session(date: string, sets: PerformanceSetRow[]): ExercisePerformanceSession {
  return { date: new Date(date), sets };
}

function baseInput(overrides: Partial<ExerciseProgressionInput> = {}): ExerciseProgressionInput {
  return {
    loggingMode: "REPS_LOAD",
    experienceLevel: "BEGINNER",
    recentSessions: [],
    cycleDecision: null,
    ...overrides,
  };
}

test("no session history at all -> INSUFFICIENT_DATA, no policy", () => {
  const result = evaluateExerciseProgression(baseInput({ recentSessions: [] }));
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.dataQuality, "NONE");
  assert.equal(result.policyUsed, null);
  assert.deepEqual(result.reasonCodes, ["NO_VALID_SET_HISTORY"]);
});

test("only warmup sets logged -> treated as no valid history (warmup excluded)", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      recentSessions: [session("2026-08-20", [set({ weightKg: 20, reps: 15, setType: "WARMUP" })])],
    }),
  );
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.dataQuality, "NONE");
});

test("only one usable session -> INSUFFICIENT_DATA (LOW_SAMPLE), but currentPerformance is still surfaced", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      recentSessions: [session("2026-08-20", [set({ weightKg: 60, reps: 8 })])],
    }),
  );
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.dataQuality, "LOW_SAMPLE");
  assert.equal(result.currentPerformance?.weightKg, 60);
});

test("LINEAR (beginner): improved weight, no missed RIR -> INCREASE_LOAD with +5% target", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 60, reps: 8, rir: 2 }), set({ weightKg: 60, reps: 8, rir: 2 })]),
        session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "LINEAR");
  assert.equal(result.status, "INCREASE_LOAD");
  assert.equal(result.nextTarget?.weightKg, 63); // 60 + round(60*0.05, step 0.5) = 60+3=63
  assert.equal(result.loadChangeKg, 3);
  assert.ok(result.reasonCodes.includes("COMPLETED_ALL_PRESCRIBED_REPS_WITHIN_TARGET_RIR"));
});

test("LINEAR: two consecutive regressions -> DELOAD with -10% target, overriding local KEEP", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 50, reps: 6, rir: 0 })]),
        session("2026-08-13", [set({ weightKg: 55, reps: 6, rir: 0 })]),
        session("2026-08-06", [set({ weightKg: 60, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.status, "DELOAD");
  assert.ok(result.reasonCodes.includes("MISSED_TARGET_TWO_OR_MORE_SESSIONS_IN_A_ROW"));
  assert.equal(result.nextTarget?.weightKg, 45); // 50 - round(50*0.1)=5 -> 45
});

test("single regression (not yet two in a row) -> stays KEEP, not DELOAD", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 55, reps: 6, rir: 1 })]),
        session("2026-08-13", [set({ weightKg: 60, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.status, "KEEP");
});

test("DOUBLE_PROGRESSION (intermediate): improved -> INCREASE_LOAD", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "INTERMEDIATE",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 80, reps: 10, rir: 2 })]),
        session("2026-08-13", [set({ weightKg: 75, reps: 10, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "DOUBLE_PROGRESSION");
  assert.equal(result.status, "INCREASE_LOAD");
});

test("DOUBLE_PROGRESSION: stagnant, no regression -> INCREASE_REPS (add a rep before adding load)", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "INTERMEDIATE",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 80, reps: 8, rir: 1 })]),
        session("2026-08-13", [set({ weightKg: 80, reps: 8, rir: 1 })]),
      ],
    }),
  );
  assert.equal(result.status, "INCREASE_REPS");
  assert.equal(result.repChange, 1);
});

test("AUTOREGULATED_RIR selected for ADVANCED with RIR data present", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "ADVANCED",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 100, reps: 5, rir: 3 })]),
        session("2026-08-13", [set({ weightKg: 95, reps: 5, rir: 3 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "AUTOREGULATED_RIR");
  assert.equal(result.status, "INCREASE_LOAD");
  assert.ok(result.reasonCodes.includes("RIR_TARGET_MET_WITH_HEADROOM_TO_SPARE"));
});

test("ADVANCED without any RIR data falls back to DOUBLE_PROGRESSION, not AUTOREGULATED_RIR", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "ADVANCED",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 100, reps: 5 })]),
        session("2026-08-13", [set({ weightKg: 95, reps: 5 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "DOUBLE_PROGRESSION");
});

test("BODYWEIGHT_REPS: improved reps -> INCREASE_REPS, +2 target", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      loggingMode: "BODYWEIGHT_REPS",
      recentSessions: [
        session("2026-08-20", [set({ reps: 12 })]),
        session("2026-08-13", [set({ reps: 10 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "BODYWEIGHT_REP_CLIMB");
  assert.equal(result.status, "INCREASE_REPS");
  assert.equal(result.repChange, 2);
  assert.equal(result.nextTarget?.reps, 14);
});

test("TIME logging mode: improved duration -> INCREASE_LOAD (duration target)", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      loggingMode: "TIME",
      recentSessions: [
        session("2026-08-20", [set({ durationSeconds: 45 })]),
        session("2026-08-13", [set({ durationSeconds: 35 })]),
      ],
    }),
  );
  assert.equal(result.policyUsed, "TIMED_PROGRESSION");
  assert.equal(result.status, "INCREASE_LOAD");
  assert.equal(result.nextTarget?.durationSeconds, 50);
});

test("cycle DELOAD envelope overrides a local INCREASE_LOAD signal", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      cycleDecision: "DELOAD",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 60, reps: 8, rir: 2 })]),
        session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.status, "DELOAD");
  assert.equal(result.cycleContext, "DELOAD");
  assert.ok(result.reasonCodes.includes("CYCLE_DELOAD_OVERRIDES_LOCAL_SIGNAL"));
});

test("cycle REBUILD envelope downgrades a local INCREASE_LOAD to REVIEW (no automatic bump)", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      cycleDecision: "REBUILD",
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 60, reps: 8, rir: 2 })]),
        session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.status, "REVIEW");
  assert.equal(result.nextTarget, null);
  assert.ok(result.reasonCodes.includes("CYCLE_REBUILD_BLOCKS_AUTOMATIC_LOCAL_INCREASE"));
});

test("cycle KEEP/PROGRESS/ADJUST do not alter the local decision", () => {
  for (const decision of ["KEEP", "PROGRESS", "ADJUST"] as const) {
    const result = evaluateExerciseProgression(
      baseInput({
        experienceLevel: "BEGINNER",
        cycleDecision: decision,
        recentSessions: [
          session("2026-08-20", [set({ weightKg: 60, reps: 8, rir: 2 })]),
          session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
        ],
      }),
    );
    assert.equal(result.status, "INCREASE_LOAD");
    assert.equal(result.cycleContext, decision);
  }
});

test("no active cycle (cycleDecision null) behaves the same as KEEP — no envelope restriction", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      cycleDecision: null,
      recentSessions: [
        session("2026-08-20", [set({ weightKg: 60, reps: 8, rir: 2 })]),
        session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.status, "INCREASE_LOAD");
  assert.equal(result.cycleContext, "NONE");
});

test("incomplete (not completed) sets are excluded from the comparison", () => {
  const result = evaluateExerciseProgression(
    baseInput({
      experienceLevel: "BEGINNER",
      recentSessions: [
        session("2026-08-20", [
          set({ weightKg: 60, reps: 8, rir: 2, completed: true }),
          set({ weightKg: 999, reps: 20, completed: false }), // should be ignored
        ]),
        session("2026-08-13", [set({ weightKg: 55, reps: 8, rir: 2 })]),
      ],
    }),
  );
  assert.equal(result.currentPerformance?.weightKg, 60);
  assert.equal(result.status, "INCREASE_LOAD");
});
