import test from "node:test";
import assert from "node:assert/strict";

/**
 * Phase 14A: a genuinely unreachable chat-service must stay best-effort
 * (the existing generic warn), distinct from a 401 auth/config rejection -
 * this is the one failure mode the brief explicitly says may remain
 * invisible-ish (product-intentional best-effort), so it must NOT be
 * promoted to the new error-level auth-rejection log.
 */

test("fitness-service -> chat: an unreachable chat-service logs a generic warn, not the auth-rejection error, never throws", async () => {
  // Nothing listens here - a real connection failure, not an HTTP 401.
  process.env.CHAT_SERVICE_URL = "http://127.0.0.1:1";
  delete process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = "FAKE-caller-secret-not-real";

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);
  (logger as any).warn = (...args: unknown[]) => warnCalls.push(args);

  const { pushCycleAssessmentNotification } = await import("../clients/notification.client");

  await assert.doesNotReject(() => pushCycleAssessmentNotification("user-3", "cycle-3", "KEEP"));

  assert.equal(errorCalls.length, 0, "an unreachable chat-service must not be classified as an auth/config error");
  assert.ok(warnCalls.length >= 1, "an unreachable chat-service must still produce the existing best-effort warn");
});
