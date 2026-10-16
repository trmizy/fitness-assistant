import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A fail-safety requirement: when neither INTERNAL_SERVICE_SECRET
 * nor INTERNAL_API_SECRET is configured, both call sites must NOT send an
 * empty/undefined x-internal-secret header - they must skip the HTTP call
 * entirely and log a distinct, observable configuration error. Critically,
 * the room-close sweep's own real business outcome (status transition +
 * in-app notification) must still land - a missing chat secret is a
 * best-effort-notification gap, not a reason to break the sweep.
 */

function startMockChatServer() {
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url });
    res.writeHead(200).end("{}");
  });
  return new Promise<{ url: string; requests: unknown[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test("user-service -> chat: missing both secret env vars skips the HTTP call for both call sites, logs config errors, sweep outcome still lands", async () => {
  const mock = await startMockChatServer();
  process.env.CHAT_SERVICE_URL = mock.url;
  delete process.env.INTERNAL_SERVICE_SECRET;
  delete process.env.INTERNAL_API_SECRET;

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);

  const { notificationService } = await import("../services/notification.service");
  const { runRoomCloseResolution } = await import("../services/room-close-resolution.service");
  const { prisma } = await import("../repositories/profile.repository");

  const userId = randomUUID();
  try {
    // pushTransient was removed in a later, unrelated commit - create() is
    // now the only path that reaches pushToSocket.
    await notificationService.create({
      userId,
      text: "nudge",
      eventType: "WORKOUT_UPCOMING",
      entityType: "WORKOUT_SCHEDULE",
      entityId: randomUUID(),
    });

    const notified: string[] = [];
    const fakeDeps = {
      findDue: async () => [
        {
          id: "session-4",
          contractId: "contract-4",
          clientUserId: "client-4",
          ptUserId: "pt-4",
          scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
          roomPtJoinedAt: null,
          roomClientJoinedAt: null,
        },
      ],
      transitionStatus: async () => true,
      compensateNoShowMoney: async () => {},
      compensateLateArrivalMoney: async () => {},
      checkAndCompleteContract: async () => undefined,
      notify: async (p: { userId: string }) => {
        notified.push(p.userId);
      },
    };
    const result = await runRoomCloseResolution(fakeDeps as any);
    assert.equal(result.resolved, 1, "the sweep's real business outcome must land despite the missing chat secret");
    assert.equal(notified.length, 2, "both participants must still be notified in-app");

    // Give any (incorrectly) fired fire-and-forget request a moment to arrive, then assert none did.
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(mock.requests.length, 0, "no HTTP call must be attempted by either call site when the secret is unconfigured");
    assert.ok(errorCalls.length >= 2, "missing configuration must be logged as an observable error for both call sites");
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await mock.close();
  }
});
