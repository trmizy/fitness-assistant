/**
 * Contract activation -> chat (owner's manual test): POST /internal/contracts/connect makes sure the PT and the client share
 * a 1-1 conversation and posts ONE "connected via contract" system line, idempotently.
 *
 * TEST FIXTURE (BACKEND INTEGRATION-style unit test): chatRepository is replaced by an in-memory fake with the same
 * contracts as the real one (per-pair get-or-create; message insert under a fixed id fails the second time). The Express
 * app is exercised over real HTTP on an ephemeral port. No database, no dev service.
 *
 *   npx tsx --test src/__tests__/contract-connect.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";
process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

const PT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function fixture() {
  const { chatRepository } = await import("../repositories/chat.repository");
  const conversations = new Map<string, { id: string; participants: Array<{ userId: string }> }>();
  const messages = new Map<string, { id: string; conversationId: string; senderId: string; content: string; createdAt: Date }>();
  const restores = [
    patch(chatRepository, "findOrCreateDirectConversation", async (a: string, b: string) => {
      const key = [a, b].sort().join("|");
      const existing = conversations.get(key);
      if (existing) return { conversation: existing, created: false };
      const conversation = { id: `conv-${conversations.size + 1}`, participants: [{ userId: a }, { userId: b }] };
      conversations.set(key, conversation);
      return { conversation, created: true };
    }),
    patch(chatRepository, "createMessageOnce", async (id: string, conversationId: string, senderId: string, content: string) => {
      if (messages.has(id)) return null; // primary-key conflict, like the real P2002 path
      const m = { id, conversationId, senderId, content, createdAt: new Date() };
      messages.set(id, m);
      return m;
    }),
  ];
  return { conversations, messages, restore: () => restores.forEach((r) => r()) };
}

async function post(path: string, body: unknown, secret?: string) {
  const { default: app } = await import("../app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const payload = JSON.stringify(body);
    return await new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...(secret ? { "x-internal-secret": secret } : {}) } },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("the system line id is a stable UUID per contract (different contracts differ)", async () => {
  const { contractConnectedMessageId } = await import("../services/chat.service");
  const a = contractConnectedMessageId("contract-a");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a, contractConnectedMessageId("contract-a"));
  assert.notEqual(a, contractConnectedMessageId("contract-b"));
});

test("connect: creates the conversation and posts the Vietnamese system line once; a replay posts nothing and reuses the conversation", async () => {
  const f = await fixture();
  try {
    const body = { ptUserId: PT, clientUserId: CLIENT, contractId: "contract-1", packageName: "Gói 12 buổi" };
    const first = await post("/internal/contracts/connect", body, process.env.INTERNAL_API_SECRET);
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.data, { conversationId: "conv-1", conversationCreated: true, messagePosted: true });
    const replay = await post("/internal/contracts/connect", body, process.env.INTERNAL_API_SECRET);
    assert.deepEqual(replay.json.data, { conversationId: "conv-1", conversationCreated: false, messagePosted: false });
    // the client-side order of the pair does not matter either
    await post("/internal/contracts/connect", { ...body, ptUserId: CLIENT, clientUserId: PT }, process.env.INTERNAL_API_SECRET);

    assert.equal(f.conversations.size, 1);
    assert.equal(f.messages.size, 1, "exactly one system line");
    const [m] = [...f.messages.values()];
    assert.equal(m.senderId, "system");
    assert.equal(m.content, "Hai bạn đã kết nối qua hợp đồng Gói 12 buổi. Hãy nhắn tin để trao đổi lịch tập.");
  } finally {
    f.restore();
  }
});

test("a second contract between the same pair reuses the conversation but gets its own line", async () => {
  const f = await fixture();
  try {
    const s = process.env.INTERNAL_API_SECRET;
    await post("/internal/contracts/connect", { ptUserId: PT, clientUserId: CLIENT, contractId: "c-1", packageName: "A" }, s);
    await post("/internal/contracts/connect", { ptUserId: PT, clientUserId: CLIENT, contractId: "c-2", packageName: "B" }, s);
    assert.equal(f.conversations.size, 1);
    assert.equal(f.messages.size, 2);
  } finally {
    f.restore();
  }
});

test("connect is internal-only: no/wrong secret -> 401 (nothing created); bad body -> 400", async () => {
  const f = await fixture();
  try {
    const body = { ptUserId: PT, clientUserId: CLIENT, contractId: "c-1" };
    assert.equal((await post("/internal/contracts/connect", body)).status, 401);
    assert.equal((await post("/internal/contracts/connect", body, "wrong")).status, 401);
    assert.equal((await post("/internal/contracts/connect", { ptUserId: "not-a-uuid", clientUserId: CLIENT, contractId: "c" }, process.env.INTERNAL_API_SECRET)).status, 400);
    assert.equal((await post("/internal/contracts/connect", { ptUserId: PT, clientUserId: PT, contractId: "c" }, process.env.INTERNAL_API_SECRET)).status, 400);
    assert.equal(f.conversations.size, 0);
    assert.equal(f.messages.size, 0);
  } finally {
    f.restore();
  }
});

// ── real repository against the isolated *_test database (skipped unless the preload accepted one) ──────────────────
const dbUsable = process.env.DB_ISOLATION === "accepted" && /_test$/.test(new URL(process.env.CHAT_DATABASE_URL ?? "postgresql://x/y").pathname.slice(1));
const dbSkip = dbUsable ? false : "Requires the preload to have accepted TEST_DATABASE_URL (an isolated *_test database).";

test("[DB] findOrCreateDirectConversation: 8 simultaneous callers make ONE conversation; createMessageOnce stores the line once", { skip: dbSkip }, async () => {
  const { prisma, chatRepository } = await import("../repositories/chat.repository");
  const { contractConnectedMessageId } = await import("../services/chat.service");
  const a = `cc-a-${Date.now()}`;
  const b = `cc-b-${Date.now()}`;
  let conversationId: string | undefined;
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => chatRepository.findOrCreateDirectConversation(i % 2 ? a : b, i % 2 ? b : a)),
    );
    assert.equal(new Set(results.map((r) => r.conversation.id)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
    conversationId = results[0].conversation.id;
    const id = contractConnectedMessageId(`cc-contract-${Date.now()}`);
    const [first, second] = [
      await chatRepository.createMessageOnce(id, conversationId, "system", "x"),
      await chatRepository.createMessageOnce(id, conversationId, "system", "x"),
    ];
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(await prisma.message.count({ where: { conversationId } }), 1);
  } finally {
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } });
    await prisma.$disconnect();
  }
});
