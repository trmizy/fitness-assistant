import test from "node:test";
import assert from "node:assert/strict";
import {
  runUpcomingReminderSweep,
  runUnfinishedReminderSweep,
  type WorkoutReminderDeps,
} from "../services/workout-reminder.service";

/**
 * Roadmap P4.1 "Notifications/reminders" (§27) — "upcoming workout" and
 * "unfinished active workout". Same injectable-deps pattern user-
 * service's session-autoconfirm.service.ts own tests already use — this
 * proves the sweep's OWN control flow (idempotency marking, per-row
 * error isolation), not `createPersistentNotification`'s cross-service
 * HTTP call (a separate concern, not re-tested here).
 */

function upcomingDeps(overrides: Partial<WorkoutReminderDeps> = {}): { deps: WorkoutReminderDeps; calls: string[] } {
  const calls: string[] = [];
  const d: WorkoutReminderDeps = {
    findUpcomingCandidates: async () => {
      calls.push("findUpcomingCandidates");
      return [{ id: "s1", userId: "u1" }];
    },
    markUpcomingReminderSent: async (id) => {
      calls.push(`markUpcomingReminderSent:${id}`);
      return {};
    },
    findUnfinishedCandidates: async () => [],
    markUnfinishedReminderSent: async () => ({}),
    notify: async (params) => {
      calls.push(`notify:${params.eventType}:${params.entityId}`);
      return {};
    },
    ...overrides,
  };
  return { deps: d, calls };
}

test("runUpcomingReminderSweep: notifies and marks each candidate exactly once", async () => {
  const { deps, calls } = upcomingDeps();
  const result = await runUpcomingReminderSweep(deps);
  assert.equal(result.scanned, 1);
  assert.equal(result.notified, 1);
  assert.deepEqual(calls, ["findUpcomingCandidates", "notify:WORKOUT_UPCOMING:s1", "markUpcomingReminderSent:s1"]);
});

test("runUpcomingReminderSweep: never marks a row that failed to notify (stays eligible for the next tick)", async () => {
  const { deps, calls } = upcomingDeps({
    notify: async () => {
      throw new Error("network blip");
    },
  });
  const result = await runUpcomingReminderSweep(deps);
  assert.equal(result.notified, 0);
  assert.ok(!calls.some((c) => c.startsWith("markUpcomingReminderSent")));
});

test("runUpcomingReminderSweep: one row's failure does not stop the rest of the batch", async () => {
  const calls: string[] = [];
  const deps: WorkoutReminderDeps = {
    findUpcomingCandidates: async () => [
      { id: "bad", userId: "u1" },
      { id: "good", userId: "u2" },
    ],
    markUpcomingReminderSent: async (id) => {
      calls.push(`marked:${id}`);
      return {};
    },
    findUnfinishedCandidates: async () => [],
    markUnfinishedReminderSent: async () => ({}),
    notify: async (params) => {
      if (params.entityId === "bad") throw new Error("boom");
      calls.push(`notified:${params.entityId}`);
      return {};
    },
  };
  const result = await runUpcomingReminderSweep(deps);
  assert.equal(result.scanned, 2);
  assert.equal(result.notified, 1);
  assert.deepEqual(calls, ["notified:good", "marked:good"]);
});

test("runUnfinishedReminderSweep: notifies and marks each candidate exactly once", async () => {
  const calls: string[] = [];
  const deps: WorkoutReminderDeps = {
    findUpcomingCandidates: async () => [],
    markUpcomingReminderSent: async () => ({}),
    findUnfinishedCandidates: async () => {
      calls.push("findUnfinishedCandidates");
      return [{ id: "s2", userId: "u1" }];
    },
    markUnfinishedReminderSent: async (id) => {
      calls.push(`markUnfinishedReminderSent:${id}`);
      return {};
    },
    notify: async (params) => {
      calls.push(`notify:${params.eventType}:${params.entityId}`);
      return {};
    },
  };
  const result = await runUnfinishedReminderSweep(deps);
  assert.equal(result.scanned, 1);
  assert.equal(result.notified, 1);
  assert.deepEqual(calls, ["findUnfinishedCandidates", "notify:WORKOUT_UNFINISHED:s2", "markUnfinishedReminderSent:s2"]);
});

test("runUpcomingReminderSweep: an empty candidate set is a real no-op, not an error", async () => {
  const { deps } = upcomingDeps({ findUpcomingCandidates: async () => [] });
  const result = await runUpcomingReminderSweep(deps);
  assert.deepEqual(result, { scanned: 0, notified: 0 });
});
