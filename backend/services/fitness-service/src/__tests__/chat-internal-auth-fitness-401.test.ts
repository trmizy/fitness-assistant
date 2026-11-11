import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A: a 401 from chat-service (secret desync between the two sides)
 * must be logged as a distinct, observable auth/config error - never
 * silently collapsed into the generic "chat-service unreachable" warn, and
 * never thrown back into the caller (the assessment itself is already
 * persisted - this push is best-effort).
 */

const CALLER_SECRET = "FAKE-caller-side-secret-not-real";
const SERVER_EXPECTS = "FAKE-server-side-secret-not-real";

function startMockChatServer(expectedSecret: string) {
  const requests: Array<{ headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      requests.push({ headers: req.headers });
      const secret = req.headers["x-internal-secret"];
      res.writeHead(!secret || secret !== expectedSecret ? 401 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: secret === expectedSecret }));
    });
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test("fitness-service -> chat: a 401 auth rejection is logged as a distinct error, never thrown, secret never logged", async () => {
  const mock = await startMockChatServer(SERVER_EXPECTS);
  process.env.CHAT_SERVICE_URL = mock.url;
  delete process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = CALLER_SECRET;

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);
  (logger as any).warn = (...args: unknown[]) => warnCalls.push(args);

  const { pushCycleAssessmentNotification } = await import("../clients/notification.client");

  try {
    await assert.doesNotReject(() => pushCycleAssessmentNotification("user-2", "cycle-2", "DELOAD"));

    assert.equal(mock.requests.length, 1);
    assert.ok(errorCalls.length >= 1, "a 401 auth rejection must be logged as an error, not silently swallowed");
    assert.equal(warnCalls.length, 0, "a definite auth rejection must not be collapsed into the generic warn path");

    const allLoggedText = JSON.stringify([...errorCalls, ...warnCalls]);
    assert.ok(!allLoggedText.includes(CALLER_SECRET), "the caller's secret value must never appear in any log call");
    assert.ok(!allLoggedText.includes(SERVER_EXPECTS), "the server's secret value must never appear in any log call");
  } finally {
    await mock.close();
  }
});
