/**
 * Contract activation -> chat: connectContractPartiesInChat is BEST-EFFORT. On AWS chat-service runs on ECS on-demand (often
 * OFF) while user-service runs on Lambda, so an unreachable/refusing/slow chat-service must never throw into the activation.
 *
 * TEST FIXTURE: a local HTTP server stands in for chat-service (CHAT_SERVICE_URL is read per call). No database.
 *
 *   npx tsx --test src/__tests__/chat-connect-best-effort.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.INTERNAL_API_SECRET = "chat-connect-test-secret";

const contract = { id: "contract-1", ptUserId: "pt-1", clientUserId: "client-1", packageName: "Gói 12 buổi" };

async function withStub(handler: http.RequestListener, run: (url: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("success: POSTs the pair + contract id to /internal/contracts/connect with the internal secret", async () => {
  const { connectContractPartiesInChat } = await import("../services/chat-connect.service");
  let seen: any = null;
  await withStub(
    (req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen = { url: req.url, secret: req.headers["x-internal-secret"], body: JSON.parse(raw) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: {} }));
      });
    },
    async (url) => {
      process.env.CHAT_SERVICE_URL = url;
      assert.equal(await connectContractPartiesInChat(contract), true);
    },
  );
  assert.equal(seen.url, "/internal/contracts/connect");
  assert.equal(seen.secret, "chat-connect-test-secret");
  assert.deepEqual(seen.body, { ptUserId: "pt-1", clientUserId: "client-1", contractId: "contract-1", packageName: "Gói 12 buổi" });
});

test("chat-service OFF (connection refused), 503 from the ALB or 401: resolves false, never throws", async () => {
  const { connectContractPartiesInChat } = await import("../services/chat-connect.service");
  // nothing listens on this port
  process.env.CHAT_SERVICE_URL = "http://127.0.0.1:1";
  assert.equal(await connectContractPartiesInChat(contract), false);
  for (const status of [503, 401, 500]) {
    await withStub(
      (_req, res) => {
        res.statusCode = status;
        res.end("{}");
      },
      async (url) => {
        process.env.CHAT_SERVICE_URL = url;
        assert.equal(await connectContractPartiesInChat(contract), false, `status ${status}`);
      },
    );
  }
});

test("no internal secret configured: skipped without a network call", async () => {
  const { connectContractPartiesInChat } = await import("../services/chat-connect.service");
  const saved = [process.env.INTERNAL_API_SECRET, process.env.INTERNAL_SERVICE_SECRET];
  delete process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_SERVICE_SECRET;
  let hits = 0;
  try {
    await withStub(
      (_req, res) => {
        hits++;
        res.end("{}");
      },
      async (url) => {
        process.env.CHAT_SERVICE_URL = url;
        assert.equal(await connectContractPartiesInChat(contract), false);
      },
    );
    assert.equal(hits, 0);
  } finally {
    if (saved[0] !== undefined) process.env.INTERNAL_API_SECRET = saved[0];
    if (saved[1] !== undefined) process.env.INTERNAL_SERVICE_SECRET = saved[1];
  }
});
