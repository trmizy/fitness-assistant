/**
 * Mobile E2/E3 — what chat-service asks user-service to push (pure builders), and the lookup a
 * phone woken by the "đang gọi" push uses to find the call still ringing for it (`call:sync`).
 *
 * Run with (from backend/services/chat-service):
 *   CHAT_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_chat_test" \
 *     npx tsx --test src/__tests__/push-relay.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

const chatDatabaseUrl = process.env.CHAT_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /_test/i.test(chatDatabaseUrl);
if (process.env.CHAT_DATABASE_URL) process.env.DATABASE_URL = process.env.CHAT_DATABASE_URL;
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Requires CHAT_DATABASE_URL pointing at a *_test database.",
};

const call = { id: "k1", calleeId: "u2", callType: "VIDEO", conversationId: "c1" };

test("incoming call push: caller's name, ring-length TTL, tag shared with the missed notice", async () => {
  const { incomingCallPush, missedCallPush, CALL_RING_SECONDS } = await import("../services/push-relay");
  const ring = incomingCallPush(call, "Huấn luyện viên A");
  assert.equal(ring.userId, "u2");
  assert.equal(ring.title, "Huấn luyện viên A");
  assert.equal(ring.body, "Đang gọi video cho bạn…");
  assert.equal(ring.kind, "CALL");
  assert.equal(ring.link, "/client/messages/c1");
  assert.equal(ring.ttlSeconds, CALL_RING_SECONDS);
  assert.deepEqual(ring.data, { callSessionId: "k1", conversationId: "c1" });

  const missed = missedCallPush({ ...call, callType: "VOICE" }, "Huấn luyện viên A");
  assert.equal(missed.body, "Cuộc gọi thoại nhỡ");
  assert.equal(missed.tag, ring.tag, "the missed notice must replace the ringing one");
  assert.equal(missed.ttlSeconds, undefined, "a missed call stays deliverable");
});

test("chat push: one shade entry per conversation, preview flattened and capped", async () => {
  const { chatMessagePush, messagePreview } = await import("../services/push-relay");
  const p = chatMessagePush("u2", "c1", "An", "Chào\n\n  bạn   nhé");
  assert.equal(p.body, "Chào bạn nhé");
  assert.equal(p.kind, "CHAT");
  assert.equal(p.tag, "chat-c1");
  assert.equal(p.link, "/client/messages/c1");
  const long = messagePreview("x".repeat(500));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
});

test("pushNewMessage skips the sender and a conversation with nobody else in it", async () => {
  const { pushNewMessage } = await import("../services/push-relay");
  // Only the sender — must return without looking anything up or sending anything.
  await pushNewMessage({ conversationId: "c1", senderId: "u1", content: "hi", participantIds: ["u1"] });
});

test("call:sync lookup: only a CHAT call still RINGING for this callee within the ring window", skipOpts, async () => {
  const { callRepository } = await import("../repositories/call.repository");
  const { prisma } = await import("../repositories/chat.repository");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const callee = `callee-${stamp}`;
  const ids: string[] = [];
  const make = async (data: Record<string, unknown>) => {
    const row = await prisma.callSession.create({
      data: { callerId: `caller-${stamp}`, calleeId: callee, callType: "VIDEO", origin: "CHAT", status: "RINGING", ...data } as any,
    });
    ids.push(row.id);
    return row;
  };
  try {
    const since = new Date(Date.now() - 30_000);
    assert.equal(await callRepository.findRingingChatCallForCallee(callee, since), null);

    await make({ status: "MISSED" });
    await make({ origin: "SESSION" });
    await make({ createdAt: new Date(Date.now() - 60_000) });
    assert.equal(await callRepository.findRingingChatCallForCallee(callee, since), null, "missed / room / stale never ring");

    const ringing = await make({});
    const found = await callRepository.findRingingChatCallForCallee(callee, since);
    assert.equal(found?.id, ringing.id);
    assert.equal(await callRepository.findRingingChatCallForCallee(`someone-else-${stamp}`, since), null);
  } finally {
    await prisma.callSession.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
