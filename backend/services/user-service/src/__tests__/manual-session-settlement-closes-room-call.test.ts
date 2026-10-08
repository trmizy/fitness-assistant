import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { SessionStatus } from "../generated/prisma";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "../services/notification.service";

/**
 * Regression (real phone + web, 7/10): the call row of an online session's room is never ended
 * by someone leaving it — only the room-close sweep did that, and only for sessions the sweep
 * itself moved out of CONFIRMED. A trainer who reported the session delivered before the next
 * sweep tick left the row active for good, and both people were refused every later call with
 * "You are already in a call". Settling a session by hand must close its room too.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function sessionFixture(sessionMode: "ONLINE" | "OFFLINE") {
  return {
    id: randomUUID(),
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    sessionMode,
    scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
  };
}

async function settle(sessionMode: "ONLINE" | "OFFLINE", run: (sessionId: string) => Promise<unknown>) {
  const session = sessionFixture(sessionMode);
  const posts: { url: string; body: any }[] = [];
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus) => ({ ...session, status }) as any),
    patch(notificationService, "create", async () => ({}) as any),
    patch(axios, "post", async (url: string, body: any) => {
      posts.push({ url, body });
      return { data: {} };
    }),
  ];
  try {
    await run(session.id);
  } finally {
    restores.forEach((r) => r());
  }
  return { session, roomCalls: posts.filter((p) => p.url.endsWith("/internal/calls/end-by-session")) };
}

test("a trainer reporting an online session delivered ends the room's call", async () => {
  const { session, roomCalls } = await settle("ONLINE", (id) => bookingService.completeSession(id, "pt-1"));
  assert.equal(roomCalls.length, 1);
  assert.equal(roomCalls[0].body.coachingSessionId, session.id);
});

test("a client reporting the trainer absent ends the room's call", async () => {
  const { roomCalls } = await settle("ONLINE", (id) => bookingService.reportPtNoShow(id, "client-1", "PT không vào phòng"));
  assert.equal(roomCalls.length, 1);
});

test("a trainer reporting the client absent ends the room's call", async () => {
  const { roomCalls } = await settle("ONLINE", (id) => bookingService.markNoShow(id, "pt-1", "CLIENT"));
  assert.equal(roomCalls.length, 1);
});

test("an in-person session has no room to close", async () => {
  const { roomCalls } = await settle("OFFLINE", (id) => bookingService.completeSession(id, "pt-1"));
  assert.equal(roomCalls.length, 0);
});
