import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A: a 401 from chat-service (secret desync) must be logged as a
 * distinct, observable auth/config error for both affected call sites -
 * never silently collapsed into the generic "chat-service unreachable"
 * warn, and never thrown back into the caller's own business logic.
 */

const CALLER_SECRET = "FAKE-caller-side-secret-not-real";
const SERVER_EXPECTS = "FAKE-server-side-secret-not-real";

function startMockChatServer() {
  const requests: Array<{ headers: http.IncomingHttpHeaders }> = [];
  const waiters: Array<(r: (typeof requests)[number]) => void> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const rec = { headers: req.headers };
      requests.push(rec);
      const waiter = waiters.shift();
      if (waiter) waiter(rec);
      const secret = req.headers["x-internal-secret"];
      res.writeHead(!secret || secret !== SERVER_EXPECTS ? 401 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: secret === SERVER_EXPECTS }));
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
        // Waits for the NEXT new request from the moment it is called, not
        // any already-arrived one - this mock server is reused across two
        // call sites and several retries within a single test, so a naive
        // "any request ever arrived" check would short-circuit on a stale,
        // already-observed request instead of waiting for a fresh one.
        waitForRequest: (timeoutMs = 2000) => {
          const startLen = requests.length;
          return new Promise((r) => {
            if (requests.length > startLen) return r(requests[requests.length - 1]);
            const timer = setTimeout(() => r(null), timeoutMs);
            waiters.push((rec) => {
              clearTimeout(timer);
              r(rec);
            });
          });
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * This environment's loopback connection setup is sometimes slower than the
 * production code's own fixed 3000ms axios timeout (observed under full
 * suite load, not just in isolation) - a real axios-level connection
 * timeout races the mock server's response, which would make a request
 * never arrive at all rather than slowly. Retrying the trigger a few times
 * (each a fresh connection attempt) absorbs that environment flakiness
 * without weakening the production timeout or the actual assertions below.
 */
async function waitForRequestWithRetries(
  trigger: () => void,
  mock: { waitForRequest: (timeoutMs?: number) => Promise<unknown> },
  attempts = 5,
  perAttemptTimeoutMs = 2000,
): Promise<unknown> {
  for (let i = 0; i < attempts; i++) {
    trigger();
    const req = await mock.waitForRequest(perAttemptTimeoutMs);
    if (req) return req;
  }
  return null;
}

test("user-service -> chat: a 401 auth rejection is logged as a distinct error for both call sites, never thrown, secret never logged", async () => {
  const mock = await startMockChatServer();
  process.env.CHAT_SERVICE_URL = mock.url;
  delete process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = CALLER_SECRET;

  // Prime the loopback connection once up front too - cheap, and usually
  // enough on its own; the retry loop below is the real safety net.
  await new Promise<void>((resolve) => {
    http.get(mock.url, (res) => res.resume().on("end", resolve)).on("error", () => resolve());
  });
  mock.requests.length = 0;

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);
  (logger as any).warn = (...args: unknown[]) => warnCalls.push(args);

  const { notificationService } = await import("../services/notification.service");
  const { runRoomCloseResolution } = await import("../services/room-close-resolution.service");
  const { prisma } = await import("../repositories/profile.repository");

  const userId = randomUUID();
  try {
    // Call site 1: pushToSocket via notificationService.create (pushTransient
    // was removed in a later, unrelated commit - create() is now the only
    // path that reaches pushToSocket).
    const req1 = await waitForRequestWithRetries(
      () =>
        void notificationService.create({
          userId,
          text: "nudge",
          eventType: "WORKOUT_UPCOMING",
          entityType: "WORKOUT_SCHEDULE",
          entityId: randomUUID(),
        }),
      mock,
    );
    assert.ok(req1, "a request must still be attempted (the secret IS configured, just mismatched)");

    // Call site 2: endOpenRoomCall via the sweep's Case 1 branch.
    const fakeDeps = {
      findDue: async () => [
        {
          id: "session-2",
          contractId: "contract-2",
          clientUserId: "client-2",
          ptUserId: "pt-2",
          scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
          roomPtJoinedAt: null,
          roomClientJoinedAt: null,
        },
      ],
      transitionStatus: async () => true,
      compensateNoShowMoney: async () => {},
      compensateLateArrivalMoney: async () => {},
      checkAndCompleteContract: async () => undefined,
      notify: async () => undefined,
    };
    // Run the sweep once for real and assert its business outcome - this
    // result must not depend on the fire-and-forget chat call's own timing.
    const firstResult = await runRoomCloseResolution(fakeDeps as any);
    assert.equal(firstResult.resolved, 1, "the sweep's real outcome must land even though the chat call is rejected");

    // The HTTP side-effect may lag behind runRoomCloseResolution's own
    // resolution (it is fired-and-forgotten before the function returns);
    // if it hasn't landed yet, re-running the sweep only retries the chat
    // call - its business-outcome result is intentionally not re-checked.
    let req2 = await mock.waitForRequest(2000);
    for (let i = 0; i < 4 && !req2; i++) {
      void runRoomCloseResolution(fakeDeps as any);
      req2 = await mock.waitForRequest(2000);
    }
    assert.ok(req2, "a request must still be attempted for endOpenRoomCall too");

    // Retries on either call site may have produced more than one request
    // each (a "slow" earlier attempt can still land after this test moved
    // on to retrying) - only a lower bound is meaningful here.
    assert.ok(mock.requests.length >= 2, "both call sites must have attempted the request");

    // The mock server records a request as soon as it arrives, before its
    // 401 response is even written - the client's own .catch() handler
    // (which logs the error) runs slightly later, after the response round
    // trip completes. Poll briefly instead of asserting immediately.
    for (let i = 0; i < 20 && errorCalls.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(errorCalls.length >= 2, "both a 401 from pushToSocket and from endOpenRoomCall must be logged as errors");
    // push.service.ts separately warns about Firebase not being configured in this test
    // environment - unrelated to the chat-auth fix. Only the two generic "best-effort
    // failure" messages this fix must NOT emit for a definite 401 are checked here.
    const chatRelatedWarnText = JSON.stringify(warnCalls);
    assert.ok(
      !chatRelatedWarnText.includes("Failed to push realtime notification") &&
        !chatRelatedWarnText.includes("Failed to end lingering call"),
      "a definite auth rejection must not be collapsed into the generic warn path",
    );

    const allLoggedText = JSON.stringify([...errorCalls, ...warnCalls]);
    assert.ok(!allLoggedText.includes(CALLER_SECRET), "the caller's secret value must never appear in any log call");
    assert.ok(!allLoggedText.includes(SERVER_EXPECTS), "the server's secret value must never appear in any log call");
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await mock.close();
  }
});
