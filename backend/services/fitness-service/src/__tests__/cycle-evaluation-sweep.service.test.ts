import test from "node:test";
import assert from "node:assert/strict";
import { runCycleEvaluationSweep, type CycleEvaluationSweepDeps } from "../services/cycle-evaluation-sweep.service";

/**
 * Adaptive Cycle Evaluation — scheduled/automatic re-evaluation (2026-09-07,
 * docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md, phase E). Same
 * injectable-deps pattern workout-reminder.service.test.ts already uses —
 * proves the SWEEP's own control flow (per-user error isolation, the
 * `triggered` count) only. maybeAutoTriggerInBodyReassessment's own
 * cooldown/actionable-only/atomic-claim gating already has its own
 * dedicated coverage in inbody-reassessment.integration.test.ts — not
 * re-tested here.
 */

function deps(overrides: Partial<CycleEvaluationSweepDeps> = {}): { deps: CycleEvaluationSweepDeps; calls: string[] } {
  const calls: string[] = [];
  const d: CycleEvaluationSweepDeps = {
    findActiveCycleUserIds: async () => {
      calls.push("findActiveCycleUserIds");
      return ["u1"];
    },
    maybeAutoTrigger: async (userId) => {
      calls.push(`maybeAutoTrigger:${userId}`);
      return { triggered: true, cycleId: "c1" };
    },
    ...overrides,
  };
  return { deps: d, calls };
}

test("runCycleEvaluationSweep: calls maybeAutoTrigger for every active-cycle user, counts what actually triggered", async () => {
  const { deps: d, calls } = deps();
  const result = await runCycleEvaluationSweep(d);
  assert.equal(result.scanned, 1);
  assert.equal(result.triggered, 1);
  assert.deepEqual(calls, ["findActiveCycleUserIds", "maybeAutoTrigger:u1"]);
});

test("runCycleEvaluationSweep: a user gated out (cooldown/no-active-cycle) still counts as scanned, not triggered", async () => {
  const { deps: d } = deps({
    maybeAutoTrigger: async () => ({ triggered: false, reason: "TOO_SOON_SINCE_LAST_REVIEW" }),
  });
  const result = await runCycleEvaluationSweep(d);
  assert.equal(result.scanned, 1);
  assert.equal(result.triggered, 0);
});

test("runCycleEvaluationSweep: one user's failure never stops the rest of the batch", async () => {
  const calls: string[] = [];
  const d: CycleEvaluationSweepDeps = {
    findActiveCycleUserIds: async () => ["bad", "good"],
    maybeAutoTrigger: async (userId) => {
      if (userId === "bad") throw new Error("boom");
      calls.push(`triggered:${userId}`);
      return { triggered: true, cycleId: "c-good" };
    },
  };
  const result = await runCycleEvaluationSweep(d);
  assert.equal(result.scanned, 2);
  assert.equal(result.triggered, 1);
  assert.deepEqual(calls, ["triggered:good"]);
});

test("runCycleEvaluationSweep: no users with an active cycle is a real no-op, not an error", async () => {
  const { deps: d } = deps({ findActiveCycleUserIds: async () => [] });
  const result = await runCycleEvaluationSweep(d);
  assert.deepEqual(result, { scanned: 0, triggered: 0 });
});
