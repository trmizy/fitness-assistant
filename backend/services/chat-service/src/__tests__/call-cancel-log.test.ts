/**
 * C3-07: a caller who hangs up a ringing call (`call:cancel`) must leave the same "nhỡ" system line in the conversation as a
 * ring timeout does; the callee's reject keeps "bị từ chối". BACKEND INTEGRATION-style unit test: the real socket handler runs
 * against a fake socket/io, with the repository/service seams patched (no database, no network assertions).
 *
 *   npx tsx --test src/__tests__/call-cancel-log.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";
process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

// Loaded lazily: ES imports are hoisted above the env assignments, and joinToken throws at import without a secret.
async function load() {
  const { callService } = await import("../services/call.service");
  const { chatRepository } = await import("../repositories/chat.repository");
  const { registerCallHandlers } = await import("../socket/call.handler");
  return { callService, chatRepository, registerCallHandlers };
}

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

type Handler = (payload: { callSessionId: string }) => Promise<void>;

async function run(event: "call:cancel" | "call:reject", callType: "VOICE" | "VIDEO", origin: "CHAT" | "SESSION" = "CHAT") {
  const { callService, chatRepository, registerCallHandlers } = await load();
  const lines: Array<{ conversationId: string; senderId: string; content: string }> = [];
  const emitted: Array<{ room: string; event: string; payload: any }> = [];
  const call = { id: "call-1", callerId: "caller-1", calleeId: "callee-1", callType, origin, conversationId: "conv-1", status: "X", startedAt: null, endedAt: new Date() };
  const restores = [
    patch(callService, "cancelCall", async () => ({ call })),
    patch(callService, "rejectCall", async () => ({ call })),
    patch(chatRepository, "createMessage", async (conversationId: string, senderId: string, content: string) => {
      lines.push({ conversationId, senderId, content });
      return { id: "m1", senderId, content, createdAt: new Date(), conversationId };
    }),
  ];
  const handlers = new Map<string, Handler>();
  const socket: any = { id: "s1", handshake: { auth: { token: "t" } }, on: (e: string, h: Handler) => handlers.set(e, h), emit: () => undefined };
  const io: any = { to: (room: string) => ({ emit: (e: string, payload: unknown) => void emitted.push({ room, event: e, payload }) }) };
  try {
    // the acting user is the caller for cancel, the callee for reject
    registerCallHandlers(io, socket, event === "call:cancel" ? { id: "caller-1", email: "c@x.test" } : { id: "callee-1", email: "d@x.test" });
    await handlers.get(event)!({ callSessionId: "call-1" });
  } finally {
    restores.forEach((r) => r());
  }
  return { lines, emitted };
}

test("caller cancels a ringing VOICE call -> one 'nhỡ' system line, delivered to both users", async () => {
  const { lines, emitted } = await run("call:cancel", "VOICE");
  assert.deepEqual(lines, [{ conversationId: "conv-1", senderId: "system", content: "📞 Cuộc gọi thoại nhỡ" }]);
  assert.ok(emitted.some((e) => e.room === "user:callee-1" && e.event === "call:cancelled"));
  const chat = emitted.filter((e) => e.event === "chat:message").map((e) => e.room).sort();
  assert.deepEqual(chat, ["user:callee-1", "user:caller-1"]);
});

test("caller cancels a ringing VIDEO call -> 'Cuộc gọi video nhỡ'", async () => {
  const { lines } = await run("call:cancel", "VIDEO");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].content, "📞 Cuộc gọi video nhỡ");
});

test("callee rejects -> still 'bị từ chối' (not 'nhỡ')", async () => {
  const voice = await run("call:reject", "VOICE");
  assert.deepEqual(voice.lines.map((l) => l.content), ["📞 Cuộc gọi thoại bị từ chối"]);
  const video = await run("call:reject", "VIDEO");
  assert.deepEqual(video.lines.map((l) => l.content), ["📞 Cuộc gọi video bị từ chối"]);
});

test("a cancelled SESSION-room call writes no chat line", async () => {
  const { lines } = await run("call:cancel", "VIDEO", "SESSION");
  assert.deepEqual(lines, []);
});
