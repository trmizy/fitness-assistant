import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A/14B regression test: user-service -> chat-service internal auth
 * caller bug, for both affected call sites -
 * notification.service.ts::pushToSocket (reached via the exported
 * notificationService.create - pushTransient was removed in a later,
 * unrelated commit that merged into this branch; create() is now the only
 * path that reaches pushToSocket) and open-room-call.service.ts::
 * endOpenRoomCall (reached via room-close-resolution.service.ts's exported,
 * fully dependency-injected runRoomCloseResolution). Both used to read ONLY
 * INTERNAL_API_SECRET, which this Lambda is never configured with, so they
 * always sent an empty x-internal-secret header, always rejected by
 * chat-service's real /internal/push-notification and
 * /internal/calls/end-by-session contract (app.ts), mirrored here by the
 * local mock server.
 *
 * create() writes a real row via notificationRepository.create - this
 * service's own established test convention is the real local dev DB, no
 * separate test-DB gating (see notification-preferences-and-pt-feedback.
 * integration.test.ts), so this test follows the same convention and
 * cleans up what it creates.
 *
 * FAKE secret only. Env vars are set BEFORE the dynamic import, since the
 * resolved secret/URL are module-level consts captured once at import
 * time. Both pushToSocket and endOpenRoomCall are fire-and-forget (the
 * caller never awaits the HTTP call) so requests are observed via an
 * event-based waiter instead of awaiting the triggering call itself.
 */

const FAKE_SECRET = "FAKE-user-caller-secret-not-real";

function startMockChatServer(expectedSecret: string) {
  const requests: Array<{ path?: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const waiters: Array<(r: (typeof requests)[number]) => void> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      let body: unknown = null;
      try {
        body = data ? JSON.parse(data) : null;
      } catch {
        body = data;
      }
      const rec = { path: req.url, headers: req.headers, body };
      requests.push(rec);
      const waiter = waiters.shift();
      if (waiter) waiter(rec);
      const secret = req.headers["x-internal-secret"];
      if (!secret || secret !== expectedSecret) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise<{
    url: string;
    requests: typeof requests;
    waitForRequest: (timeoutMs?: number) => Promise<(typeof requests)[number] | null>;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        waitForRequest: (timeoutMs = 2000) =>
          new Promise((r) => {
            if (requests.length > 0) return r(requests[requests.length - 1]);
            const timer = setTimeout(() => r(null), timeoutMs);
            waiters.push((rec) => {
              clearTimeout(timer);
              r(rec);
            });
          }),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("user-service -> chat: pushToSocket (via notificationService.create) sends x-internal-secret with INTERNAL_API_SECRET value when both are set, payload unchanged", async () => {
  // Priority order proven live (2026-10-08): INTERNAL_API_SECRET must win
  // when both are set, since that's the one value chat-service's receiver
  // has always actually checked.
  const mock = await startMockChatServer(FAKE_SECRET);
  process.env.CHAT_SERVICE_URL = mock.url;
  process.env.INTERNAL_API_SECRET = FAKE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = "FAKE-different-value-not-real";

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);

  const { notificationService } = await import("../services/notification.service");
  const { prisma } = await import("../repositories/profile.repository");

  const userId = randomUUID();
  try {
    const created = await notificationService.create({
      userId,
      text: "Buổi tập sắp diễn ra",
      eventType: "WORKOUT_UPCOMING",
      entityType: "WORKOUT_SCHEDULE",
      entityId: randomUUID(),
    });
    assert.ok(created, "a real notification row must be created (default-enabled preference)");

    const req = await mock.waitForRequest();
    assert.ok(req, "pushToSocket must send a request when a secret is configured");
    assert.equal(req!.headers["x-internal-secret"], FAKE_SECRET);
    assert.equal(req!.body.userId, userId);
    assert.equal(req!.body.notification.eventType, "WORKOUT_UPCOMING");
    assert.equal(errorCalls.length, 0, "a successful push must not log an error");
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await mock.close();
  }
});

test("user-service -> chat: endOpenRoomCall (via runRoomCloseResolution Case 1) sends x-internal-secret with INTERNAL_API_SECRET value when both are set", async () => {
  const mock = await startMockChatServer(FAKE_SECRET);
  process.env.CHAT_SERVICE_URL = mock.url;
  process.env.INTERNAL_API_SECRET = FAKE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = "FAKE-different-value-not-real";

  const { runRoomCloseResolution } = await import("../services/room-close-resolution.service");

  const notified: Array<{ userId: string; eventType: string }> = [];
  const fakeDeps = {
    findDue: async () => [
      {
        id: "session-1",
        contractId: "contract-1",
        clientUserId: "client-1",
        ptUserId: "pt-1",
        scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
        roomPtJoinedAt: null,
        roomClientJoinedAt: null,
      },
    ],
    transitionStatus: async () => true,
    compensateNoShowMoney: async () => {},
    compensateLateArrivalMoney: async () => {},
    checkAndCompleteContract: async () => undefined,
    notify: async (params: { userId: string; eventType: string }) => {
      notified.push({ userId: params.userId, eventType: params.eventType });
    },
  };

  try {
    const result = await runRoomCloseResolution(fakeDeps as any);
    assert.equal(result.scanned, 1);
    assert.equal(result.resolved, 1, "the sweep's real business outcome must land regardless of the chat call");
    assert.equal(notified.length, 2, "both participants must still be notified in-app");

    const req = await mock.waitForRequest();
    assert.ok(req, "endOpenRoomCall must send a request when a secret is configured");
    assert.equal(req!.headers["x-internal-secret"], FAKE_SECRET);
    assert.equal(req!.body.coachingSessionId, "session-1");
    assert.equal(req!.body.reason, "room_cancelled_nobody_joined");
  } finally {
    await mock.close();
  }
});
