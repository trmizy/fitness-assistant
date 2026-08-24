import test from "node:test";
import assert from "node:assert/strict";
import { computeRirTrend, computeE1rmTrend } from "../services/training-cycle-metrics.service";

type SetRowInput = Parameters<typeof computeRirTrend>[0][number];

function set(
  dayOffset: number,
  rir: number | null,
  overrides: Partial<SetRowInput> = {},
): SetRowInput {
  return {
    weight: 50,
    reps: 8,
    rpe: null,
    rir,
    completed: true,
    date: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
    exerciseName: "Squat",
    muscleGroups: ["legs"],
    setType: null,
    ...overrides,
  };
}

const cycleStart = new Date(Date.UTC(2026, 0, 1));

test("computeRirTrend: no RIR data at all returns an empty weeklyAvg and 'stable'", () => {
  const result = computeRirTrend([set(0, null), set(1, null)], cycleStart);
  assert.deepEqual(result.weeklyAvg, []);
  assert.equal(result.trend, "stable");
});

test("computeRirTrend: averages RIR values within the same week", () => {
  const result = computeRirTrend([set(0, 4), set(1, 2)], cycleStart);
  assert.deepEqual(result.weeklyAvg, [3]);
});

test("computeRirTrend: a falling RIR across 3+ weeks is flagged 'decreasing' (working closer to failure over time)", () => {
  const result = computeRirTrend(
    [set(0, 5), set(7, 3), set(14, 1)],
    cycleStart,
  );
  assert.deepEqual(result.weeklyAvg, [5, 3, 1]);
  assert.equal(result.trend, "decreasing");
});

test("computeRirTrend: a rising RIR across 3+ weeks is flagged 'increasing' (more reps held in reserve — easier)", () => {
  const result = computeRirTrend(
    [set(0, 1), set(7, 3), set(14, 5)],
    cycleStart,
  );
  assert.equal(result.trend, "increasing");
});

test("computeRirTrend: ignores sets with a null rir alongside sets that do have one", () => {
  const result = computeRirTrend([set(0, 4), set(0, null)], cycleStart);
  assert.deepEqual(result.weeklyAvg, [4]);
});

// Warm-up exclusion (gap analysis P1 item, docs/OPENGYM_RESEARCH_SOURCES.md
// "product heuristic" table). Critical regression coverage: a naive
// Prisma-side `setType: { not: "WARMUP" }` filter would silently exclude
// every NULL-setType row too (verified empirically against the real dev DB
// before fixing — all 485,741 existing rows are setType=null, predating the
// advanced-set-logging UI). These tests exercise the pure-JS side of the
// same exclusion (computeE1rmTrend), which uses plain `===` and was never
// at risk of the SQL three-valued-logic trap, but is exactly the behavior
// that trap would have broken if copied here uncritically.
test("computeE1rmTrend: a WARMUP-tagged set is excluded from the e1RM trend", () => {
  const result = computeE1rmTrend(
    [
      set(0, null, { weight: 40, reps: 15, setType: "WARMUP" }), // would give a much lower e1RM if counted
      set(0, null, { weight: 100, reps: 5, setType: "WORKING" }),
    ],
    cycleStart,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].weeklyTop[0].e1rm, Math.round(100 * (1 + 5 / 30) * 10) / 10);
});

test("computeE1rmTrend: a null setType (pre-advanced-set-logging row, the overwhelming majority of real data) is still INCLUDED, not treated as a warm-up", () => {
  const result = computeE1rmTrend(
    [set(0, null, { weight: 100, reps: 5, setType: null })],
    cycleStart,
  );
  assert.equal(result.length, 1);
  assert.ok(result[0].weeklyTop.length > 0, "a null-setType set must still count toward the trend");
});
