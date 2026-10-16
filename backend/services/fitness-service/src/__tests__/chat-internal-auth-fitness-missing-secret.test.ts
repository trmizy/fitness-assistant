import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A fail-safety requirement: when neither INTERNAL_SERVICE_SECRET
 * nor INTERNAL_API_SECRET is configured, the caller must NOT send an
 * empty/undefined x-internal-secret header (chat-service would just
 * reject it anyway) - it must skip the HTTP call entirely and log a
 * distinct, observable configuration error instead of silently doing
 * nothing or crashing the caller.
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

test("fitness-service -> chat: missing both secret env vars skips the HTTP call entirely and logs a config error", async () => {
  const mock = await startMockChatServer();
  process.env.CHAT_SERVICE_URL = mock.url;
  delete process.env.INTERNAL_SERVICE_SECRET;
  delete process.env.INTERNAL_API_SECRET;

  const { logger } = await import("@gym-coach/shared");
  const errorCalls: unknown[][] = [];
  (logger as any).error = (...args: unknown[]) => errorCalls.push(args);

  const { pushCycleAssessmentNotification } = await import("../clients/notification.client");

  try {
    await assert.doesNotReject(() => pushCycleAssessmentNotification("user-4", "cycle-4", "ADJUST"));

    assert.equal(mock.requests.length, 0, "no HTTP call must be attempted when the secret is unconfigured");
    assert.ok(errorCalls.length >= 1, "missing configuration must be logged as an observable error");
  } finally {
    await mock.close();
  }
});
