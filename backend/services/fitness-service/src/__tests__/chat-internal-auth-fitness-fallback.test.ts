import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 14A/14B: whichever of the two secret env vars is actually present
 * must be used (never an empty header) when only one is configured -
 * INTERNAL_API_SECRET is the Chat-named variable (present when only that's
 * configured), INTERNAL_SERVICE_SECRET is the one every Lambda actually has
 * (the real AWS scenario, where INTERNAL_API_SECRET is never set).
 */

const FAKE_SECRET = "FAKE-api-secret-fallback-not-real";

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

test("fitness-service -> chat: uses INTERNAL_API_SECRET when INTERNAL_SERVICE_SECRET is unset", async () => {
  const mock = await startMockChatServer(FAKE_SECRET);
  process.env.CHAT_SERVICE_URL = mock.url;
  delete process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_API_SECRET = FAKE_SECRET;

  const { pushCycleAssessmentNotification } = await import("../clients/notification.client");

  try {
    await pushCycleAssessmentNotification("user-fallback", "cycle-fallback", "REBUILD");
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].headers["x-internal-secret"], FAKE_SECRET);
  } finally {
    await mock.close();
  }
});
