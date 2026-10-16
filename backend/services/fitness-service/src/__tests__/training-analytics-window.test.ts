import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingAnalyticsWindow,
  normalizeWindowDays,
  resolveTrainingWindow,
  type TrainingWindowInputs,
  type TrainingWindowSetRow,
} from "../services/training-analytics-window.service";
import {
  computeVolumeByWeek,
  computeVolumeChangePct,
  computeE1rmTrend,
  computeRpeTrend,
  computeRirTrend,
} from "../services/training-cycle-metrics.service";
import { estimate1RM } from "../utils/estimated-1rm.util";

// Phase 4.1 — DB-free unit coverage of the window assembly. Every metric is
// produced by the REAL production functions (the same ones the cycle report
// uses); these tests pin that the window layer only attaches window/quality
// semantics on top and never recomputes a different number.

const FROM = new Date("2026-09-13T00:00:00.000Z"); // 28 UTC days ending 2026-10-10
const TO = new Date("2026-10-10T12:00:00.000Z");

type SetSpec = Partial<Omit<TrainingWindowSetRow, "date">> & { date: string; muscleGroups?: string[] };
function set(s: SetSpec) {
  return {
    date: new Date(s.date),
    weight: s.weight ?? null,
    reps: s.reps ?? null,
    rpe: s.rpe ?? null,
    rir: s.rir ?? null,
    exerciseName: s.exerciseName ?? "Bench Press",
    exerciseId: s.exerciseId ?? "ex-bench",
    setType: s.setType ?? null,
    completed: true,
    muscleGroups: s.muscleGroups ?? ["chest"],
  };
}

function inputs(sets: ReturnType<typeof set>[], over: Partial<TrainingWindowInputs> = {}): TrainingWindowInputs {
  const volumeByWeek = computeVolumeByWeek(sets, FROM);
  return {
    from: FROM,
    to: TO,
    days: 28,
    adherence: { completed: 0, total: 0, percent: null },
    workout: {
      sets,
      volumeByWeek,
      volumeChangePct: computeVolumeChangePct(volumeByWeek),
      e1rmTrend: computeE1rmTrend(sets, FROM),
      rpeTrend: computeRpeTrend(sets, FROM),
      rirTrend: computeRirTrend(sets, FROM),
    },
    sessionFeedback: [],
    hasActivityBeforeWindow: false,
    ...over,
  };
}

test("window: 28 UTC days ending on asOf's day; future excluded by to=asOf", () => {
  const { from, to } = resolveTrainingWindow(new Date("2026-10-10T12:34:56.000Z"), 28);
  assert.equal(from.toISOString(), "2026-09-13T00:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-10T12:34:56.000Z");
  assert.equal(normalizeWindowDays(undefined), 28);
  assert.throws(() => normalizeWindowDays(3), RangeError);
  assert.throws(() => normalizeWindowDays(500), RangeError);
  assert.throws(() => normalizeWindowDays(10.5), RangeError);
});

test("empty history → NO_DATA, adherence NO_SCHEDULE (not 0%), no signals", () => {
  const w = buildTrainingAnalyticsWindow(inputs([]));
  assert.equal(w.dataQuality, "NO_DATA");
  assert.equal(w.adherence.state, "NO_SCHEDULE");
  assert.equal(w.adherence.completionRate, null);
  assert.equal(w.adherence.missedSessions, null);
  assert.equal(w.adherence.dataQuality, "NO_DATA");
  assert.equal(w.frequency.completedPerWeek, null);
  assert.equal(w.progression.exercises.length, 0);
  assert.equal(w.progression.dataQuality, "NO_DATA");
  assert.deepEqual(w.signals, []);
  assert.equal(w.plateau.status, "NOT_AVAILABLE");
});

test("empty window but earlier history exists → STALE, not NO_DATA", () => {
  const w = buildTrainingAnalyticsWindow(inputs([], { hasActivityBeforeWindow: true }));
  assert.equal(w.dataQuality, "STALE");
  assert.deepEqual(w.signals, []);
});

test("scheduled + completed + missed: exact adherence from existing semantics (9/12 = 75%)", () => {
  const w = buildTrainingAnalyticsWindow(inputs([], { adherence: { completed: 9, total: 12, percent: 75 } }));
  assert.equal(w.adherence.state, "MEASURED");
  assert.equal(w.adherence.scheduledSessions, 12);
  assert.equal(w.adherence.completedSessions, 9);
  assert.equal(w.adherence.missedSessions, 3);
  assert.equal(w.adherence.completionRate, 0.75);
  assert.equal(w.adherence.dataQuality, "SUFFICIENT");
  assert.equal(w.frequency.scheduledPerWeek, 3);
  assert.equal(w.frequency.completedPerWeek, 2.3);
  // 75% sits between the repository's declining (60) and progressing (80) thresholds
  assert.deepEqual(w.signals, []);
});

test("signals use cycleThresholds.classification (80 good / 60 low) and only with a sufficient sample", () => {
  const good = buildTrainingAnalyticsWindow(inputs([], { adherence: { completed: 10, total: 12, percent: 83 } }));
  assert.deepEqual(good.signals.map((s) => s.code), ["TRAINING_ADHERENCE_GOOD"]);
  const low = buildTrainingAnalyticsWindow(inputs([], { adherence: { completed: 5, total: 12, percent: 42 } }));
  assert.deepEqual(low.signals.map((s) => s.code), ["TRAINING_ADHERENCE_LOW"]);
  const tiny = buildTrainingAnalyticsWindow(inputs([], { adherence: { completed: 0, total: 2, percent: 0 } }));
  assert.equal(tiny.adherence.dataQuality, "PARTIAL");
  assert.ok(!tiny.signals.some((s) => s.code === "TRAINING_ADHERENCE_LOW"));
});

test("ad-hoc logs without any schedule: no planned adherence; frequency/progression still reported", () => {
  const sets = [
    set({ date: "2026-09-15T10:00:00Z", weight: 80, reps: 8 }),
    set({ date: "2026-09-22T10:00:00Z", weight: 82.5, reps: 8 }),
    set({ date: "2026-09-29T10:00:00Z", weight: 85, reps: 7 }),
  ];
  const w = buildTrainingAnalyticsWindow(inputs(sets));
  assert.equal(w.adherence.state, "NO_SCHEDULE");
  assert.equal(w.adherence.completionRate, null);
  assert.equal(w.frequency.trainingDaysLogged, 3);
  assert.equal(w.frequency.completedPerWeek, 0.8);
  assert.equal(w.frequency.scheduledPerWeek, null);
  assert.equal(w.progression.exercises.length, 1);
  assert.equal(w.dataQuality, "PARTIAL");
  assert.deepEqual(w.signals, []);
});

test("progression: reuses e1RM engine; no trend label; quality follows weeks observed", () => {
  const sets = [
    set({ date: "2026-09-14T10:00:00Z", weight: 80, reps: 8 }),
    set({ date: "2026-09-21T10:00:00Z", weight: 82.5, reps: 8 }),
    set({ date: "2026-09-28T10:00:00Z", weight: 85, reps: 7 }),
    set({ date: "2026-09-14T10:30:00Z", weight: 40, reps: 10, exerciseName: "Row", exerciseId: "ex-row" }),
  ];
  const w = buildTrainingAnalyticsWindow(inputs(sets));
  const bench = w.progression.exercises.find((e) => e.exerciseName === "Bench Press")!;
  const first = Math.round(estimate1RM(80, 8) * 10) / 10;
  const last = Math.round(estimate1RM(85, 7) * 10) / 10;
  assert.equal(bench.exerciseId, "ex-bench");
  assert.equal(bench.baselineE1rmKg, first);
  assert.equal(bench.currentE1rmKg, last);
  assert.equal(bench.changePct, Math.round(((last - first) / first) * 1000) / 10);
  assert.equal(bench.weeksObserved, 3);
  assert.equal(bench.dataQuality, "SUFFICIENT");
  assert.ok(!("trend" in bench));
  const row = w.progression.exercises.find((e) => e.exerciseName === "Row")!;
  assert.equal(row.changePct, null);
  assert.equal(row.dataQuality, "INSUFFICIENT_HISTORY");
  assert.equal(w.progression.dataQuality, "SUFFICIENT");
});

test("progression: warm-up sets never feed e1RM; sets within one week = INSUFFICIENT_HISTORY", () => {
  const sets = [
    set({ date: "2026-09-14T10:00:00Z", weight: 100, reps: 3, setType: "WARMUP" }),
    set({ date: "2026-09-14T10:05:00Z", weight: 60, reps: 8 }),
    set({ date: "2026-09-14T10:10:00Z", weight: 60, reps: 8 }),
    set({ date: "2026-09-14T10:15:00Z", weight: 60, reps: 8 }),
  ];
  const w = buildTrainingAnalyticsWindow(inputs(sets));
  const bench = w.progression.exercises[0];
  assert.equal(bench.baselineE1rmKg, Math.round(estimate1RM(60, 8) * 10) / 10);
  assert.equal(bench.dataQuality, "INSUFFICIENT_HISTORY");
  assert.equal(w.dataQuality, "INSUFFICIENT_HISTORY");
  assert.deepEqual(w.signals.map((s) => s.code), ["INSUFFICIENT_TRAINING_HISTORY"]);
});

test("volume: Σ weight×reps per muscle group; bodyweight sets counted but unloaded", () => {
  const sets = [
    set({ date: "2026-09-14T10:00:00Z", weight: 100, reps: 5, exerciseName: "Squat", exerciseId: "sq", muscleGroups: ["quads", "glutes"] }),
    set({ date: "2026-09-14T10:10:00Z", weight: 100, reps: 5, exerciseName: "Squat", exerciseId: "sq", muscleGroups: ["quads", "glutes"] }),
    set({ date: "2026-09-15T10:00:00Z", weight: 50, reps: 10, muscleGroups: ["chest"] }),
    set({ date: "2026-09-15T10:10:00Z", weight: null, reps: 12, exerciseName: "Push-up", exerciseId: "pu", muscleGroups: ["chest"] }),
  ];
  const w = buildTrainingAnalyticsWindow(inputs(sets));
  assert.equal(w.volume.totalVolumeLoadKg, 100 * 5 * 2 + 50 * 10);
  assert.equal(w.volume.byMuscleGroupKg.quads, 1000);
  assert.equal(w.volume.byMuscleGroupKg.glutes, 1000);
  assert.equal(w.volume.byMuscleGroupKg.chest, 500);
  assert.equal(w.volume.completedSetCount, 4);
  assert.equal(w.volume.loadedSetCount, 3);
  assert.equal(w.volume.byWeek.length, 1);
});

test("sparse RPE/RIR: missing values are not zero; quality reflects partial observation", () => {
  const sets = [
    set({ date: "2026-09-14T10:00:00Z", weight: 80, reps: 8, rpe: 8 }),
    set({ date: "2026-09-14T10:05:00Z", weight: 80, reps: 8 }),
    set({ date: "2026-09-14T10:10:00Z", weight: 80, reps: 8 }),
    set({ date: "2026-09-21T10:00:00Z", weight: 80, reps: 8 }),
  ];
  const w = buildTrainingAnalyticsWindow(inputs(sets));
  assert.equal(w.effort.rpe.observedSets, 1);
  assert.equal(w.effort.rpe.totalCompletedSets, 4);
  assert.deepEqual(w.effort.rpe.weeklyAvg, [8]);
  assert.equal(w.effort.rpe.trend, null);
  assert.equal(w.effort.rpe.dataQuality, "INSUFFICIENT_HISTORY");
  assert.equal(w.effort.rir.observedSets, 0);
  assert.equal(w.effort.rir.dataQuality, "NO_DATA");
  assert.equal(w.effort.sessionFeedback.dataQuality, "NO_DATA");
  assert.equal(w.effort.sessionFeedback.sessionRpeSource, "set_rpe_fallback");
});

test("session feedback: averages only over answered fields (existing computeFatigueRecoveryMetrics)", () => {
  const w = buildTrainingAnalyticsWindow(
    inputs([], {
      sessionFeedback: [
        { readinessScore: 8, sessionRpe: 7, painScore: null, date: "2026-09-20T00:00:00Z" },
        { readinessScore: null, sessionRpe: 9, painScore: 2, date: "2026-09-22T00:00:00Z" },
        { readinessScore: 6, sessionRpe: null, painScore: null, date: "2026-09-24T00:00:00Z" },
      ],
    }),
  );
  const f = w.effort.sessionFeedback;
  assert.equal(f.feedbackCount, 3);
  assert.equal(f.averageSessionRpe, 8);
  assert.equal(f.averagePainScore, 2);
  assert.equal(f.recoveryScore, 0.7);
  assert.equal(f.dataQuality, "PARTIAL");
});
