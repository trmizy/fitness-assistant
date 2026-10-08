/**
 * Regression (real phone + web, 7/10): a coaching session's room leaves a call row that nobody
 * ends when its people leave. When user-service's "this session is over" notice never came,
 * that row stayed active for good and both of them were refused every later call with "You are
 * already in a call". A room row that has outlived any possible session must not count as busy.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";

import { callService, isAbandonedRoomCall } from "../services/call.service";
import { callRepository } from "../repositories/call.repository";

const HOUR = 60 * 60 * 1000;

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("only a SESSION room older than any session can last is abandoned", () => {
  const now = Date.now();
  assert.equal(isAbandonedRoomCall({ origin: "SESSION", createdAt: new Date(now - 7 * HOUR) }, now), true);
  assert.equal(isAbandonedRoomCall({ origin: "SESSION", createdAt: new Date(now - 4 * HOUR) }, now), false);
  // A chat call is ended by its own ring/hangup rules — age alone never frees it here.
  assert.equal(isAbandonedRoomCall({ origin: "CHAT", createdAt: new Date(now - 30 * HOUR) }, now), false);
});

async function initiateWith(active: { id: string; origin: string; createdAt: Date; status: string }[]) {
  const ended: string[] = [];
  let created = 0;
  const restores = [
    patch(callRepository, "findActiveCallForUser", async () => active.find((c) => !ended.includes(c.id)) ?? null),
    patch(callRepository, "updateStatus", async (id: string, status: string, extra: { endReason?: string }) => {
      assert.equal(status, "ENDED");
      assert.equal(extra.endReason, "room_abandoned");
      ended.push(id);
      return {};
    }),
    patch(callRepository, "create", async (data: object) => {
      created++;
      return { id: "new-call", ...data };
    }),
  ];
  try {
    const result = await callService.initiateCall({ conversationId: "conv", callerId: "pt", calleeId: "client", callType: "VOICE" as never });
    return { result, ended, created };
  } finally {
    restores.forEach((r) => r());
  }
}

test("an abandoned room row is ended and the new call goes through", async () => {
  const { result, ended, created } = await initiateWith([
    { id: "stale-room", origin: "SESSION", createdAt: new Date(Date.now() - 20 * HOUR), status: "ACTIVE" },
  ]);
  assert.ok(!("error" in result), JSON.stringify(result));
  assert.equal(created, 1);
  assert.ok(ended.includes("stale-room"));
});

test("a room that may still be open keeps its people busy", async () => {
  const { result, ended, created } = await initiateWith([
    { id: "live-room", origin: "SESSION", createdAt: new Date(Date.now() - HOUR), status: "ACTIVE" },
  ]);
  assert.deepEqual(result, { error: "You are already in a call" });
  assert.equal(created, 0);
  assert.deepEqual(ended, []);
});
