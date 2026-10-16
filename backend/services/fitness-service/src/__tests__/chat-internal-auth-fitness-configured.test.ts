import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A regression test: fitness-service -> chat-service internal auth
 * caller bug. pushCycleAssessmentNotification used to read ONLY
 * INTERNAL_API_SECRET, which this Lambda is never configured with, so it
 * always sent an empty x-internal-secret header and was always rejected by
 * chat-service's real /internal/push-notification contract (app.ts:
 * missing/mismatched x-internal-secret -> 401, matching -> 200, mirrored by
 * the local mock server below).
 *
 * FAKE secret only. Env vars are set BEFORE the dynamic import of the
 * module under test, since CHAT_INTERNAL_SECRET/CHAT_SERVICE_URL are
 * resolved once at module-load time from process.env - every scenario that
 * needs a different env configuration lives in its own file/process
 * (tsx --test runs each matched *.test.ts file as its own subprocess).
 */

const FAKE_SECRET = "FAKE-fitness-caller-secret-not-real";

function startMockChatServer(expectedSecret: string) {
  const requests: Array<{ path?: string; headers: http.IncomingHttpHeaders; body: any }> = [];
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
      requests.push({ path: req.url, headers: req.headers, body });
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
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("fitness-service -> chat: pushCycleAssessmentNotification sends x-internal-secret with INTERNAL_API_SECRET value (not INTERNAL_SERVICE_SECRET) when both are set, payload unchanged", async () => {
  // Priority order proven live (2026-10-08, see notification.client.ts's own
  // comment): INTERNAL_API_SECRET must win when both are set, since that's
  // the one value chat-service's receiver has always actually checked -
  // INTERNAL_SERVICE_SECRET-first broke local dev, where the two are
  // configured to different real values.
  const mock = await startMockChatServer(FAKE_SECRET);
  process.env.CHAT_SERVICE_URL = mock.url;
  process.env.INTERNAL_API_SECRET = FAKE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = "FAKE-different-value-not-real";

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);

  const { pushCycleAssessmentNotification } = await import("../clients/notification.client");

  try {
    await pushCycleAssessmentNotification("user-1", "cycle-1", "PROGRESS");

    assert.equal(mock.requests.length, 1);
    const req = mock.requests[0];
    assert.equal(req.headers["x-internal-secret"], FAKE_SECRET);
    assert.equal(req.body.userId, "user-1");
    assert.equal(req.body.notification.eventType, "CYCLE_ASSESSMENT_READY");
    assert.equal(req.body.notification.entityId, "cycle-1");
    assert.equal(errorCalls.length, 0, "a successful push must not log an error");
  } finally {
    await mock.close();
  }
});
