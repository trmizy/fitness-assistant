/**
 * Chat thread paging + send guards (fix round 10/11/2026).
 *
 * N09F-01  a thread shows the NEWEST messages (page 1 = latest N, oldest-first) and a `before` cursor loads older ones.
 * N09F-07  a message to a conversation whose other participant is a locked account is refused (nothing stored).
 * N09F-09  whitespace-only content is rejected, stored text is trimmed (REST path).
 * N09F-02/10/11  refusal text is Vietnamese (message length, call type, call errors).
 *
 * TEST FIXTURE: prisma.message / chatRepository methods are replaced by in-memory fakes and auth-service is a stub HTTP
 * server started in this process. No database or dev service is touched (a *_test DB is not required).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

// ── pure: the shared validation schema ──────────────────────────────────────────────────────────────────────────────
test("N09F-09: sendMessageSchema rejects whitespace-only content with a Vietnamese reason and trims the rest", async () => {
  const { sendMessageSchema } = await import("../models/chat.models");
  for (const blank of ["   ", "\n\t ", "  "]) {
    const r = sendMessageSchema.safeParse({ content: blank });
    assert.equal(r.success, false, JSON.stringify(blank));
    if (!r.success) assert.equal(r.error.errors[0].message, "Tin nhắn không được để trống");
  }
  const ok = sendMessageSchema.safeParse({ content: "  xin chào \n" });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.content, "xin chào");
});

test("N09F-02: over-long content is refused with a Vietnamese length message; exactly 5000 is accepted", async () => {
  const { sendMessageSchema } = await import("../models/chat.models");
  const r = sendMessageSchema.safeParse({ content: "a".repeat(5001) });
  assert.equal(r.success, false);
  if (!r.success) assert.match(r.error.errors[0].message, /quá dài/);
  assert.equal(sendMessageSchema.safeParse({ content: "a".repeat(5000) }).success, true);
  assert.equal(sendMessageSchema.safeParse({ content: "  " + "a".repeat(5000) + "  " }).success, true, "length is measured after trimming");
});

test("non-string / missing content gives a Vietnamese message, not zod's English one", async () => {
  const { sendMessageSchema } = await import("../models/chat.models");
  for (const body of [{}, { content: 5 }, { content: ["x"] }]) {
    const r = sendMessageSchema.safeParse(body);
    assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.errors[0].message, /[ăâđêôơưáàảãạéèíóòúùý]/i);
  }
});

test("paginationSchema keeps page/limit defaults (mobile sends page=1&limit=30) and accepts an optional uuid cursor", async () => {
  const { paginationSchema } = await import("../models/chat.models");
  assert.deepEqual(paginationSchema.parse({ page: "1", limit: "30" }), { page: 1, limit: 30 });
  assert.deepEqual(paginationSchema.parse({}), { page: 1, limit: 20 });
  const id = "71445a1e-b3d6-4fd0-b8ea-23550ada2441";
  assert.equal(paginationSchema.parse({ before: id, limit: "30" }).before, id);
  assert.equal(paginationSchema.safeParse({ before: "not-a-uuid" }).success, false);
  assert.equal(paginationSchema.safeParse({ limit: "101" }).success, false);
  assert.equal(paginationSchema.safeParse({ page: "0" }).success, false);
});

// ── N09F-01: repository paging, on an in-memory message table ───────────────────────────────────────────────────────
type Row = { id: string; conversationId: string; createdAt: Date; senderId: string; content: string };

function makeThread(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      conversationId: "conv-1",
      createdAt: new Date(Date.UTC(2026, 10, 9, 10, 0, i)),
      senderId: "u1",
      content: `msg #${String(i).padStart(2, "0")}`,
    });
  }
  return rows;
}

/** Just enough of prisma.message.{findFirst,findMany} for the repository's two queries. */
function installFakeMessageTable(rows: Row[], prisma: any) {
  const matches = (r: Row, where: any): boolean => {
    if (where.conversationId && r.conversationId !== where.conversationId) return false;
    if (where.id && r.id !== where.id) return false;
    if (where.OR) {
      return where.OR.some((clause: any) => {
        if (clause.createdAt?.lt) return r.createdAt < clause.createdAt.lt;
        if (clause.createdAt instanceof Date) return r.createdAt.getTime() === clause.createdAt.getTime() && r.id < clause.id.lt;
        return false;
      });
    }
    return true;
  };
  prisma.message.findFirst = async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null;
  prisma.message.findMany = async ({ where, orderBy, skip = 0, take }: any) => {
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }], "newest first, ties broken by id");
    const sorted = rows
      .filter((r) => matches(r, where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    return sorted.slice(skip, skip + take);
  };
}

test("N09F-01: page 1 of a 35-message thread is the NEWEST 30, oldest-first; page 2 is the 5 before them", async () => {
  const { chatRepository, prisma } = await import("../repositories/chat.repository");
  const rows = makeThread(35);
  installFakeMessageTable(rows, prisma);

  const page1 = await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 30 });
  assert.equal(page1.length, 30);
  assert.equal(page1[0].content, "msg #06");
  assert.equal(page1[29].content, "msg #35", "the newest message is on the first page");
  assert.deepEqual(
    page1.map((m) => m.content),
    [...page1.map((m) => m.content)].sort(),
    "returned oldest-first",
  );

  const page2 = await chatRepository.findMessagesByConversationId("conv-1", { skip: 30, take: 30 });
  assert.deepEqual(page2.map((m) => m.content), ["msg #01", "msg #02", "msg #03", "msg #04", "msg #05"]);
});

test("N09F-01: the `before` cursor returns the messages older than that one, even after newer ones arrived", async () => {
  const { chatRepository, prisma } = await import("../repositories/chat.repository");
  const rows = makeThread(35);
  installFakeMessageTable(rows, prisma);

  const page1 = await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 30 });
  const oldestShown = page1[0];
  // Five more messages arrive while the user is reading: a page-number based "page 2" would now repeat rows.
  rows.push(...makeThread(40).slice(35));
  const older = await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 30, beforeId: oldestShown.id });
  assert.deepEqual(older.map((m) => m.content), ["msg #01", "msg #02", "msg #03", "msg #04", "msg #05"]);

  // A cursor that is not in this conversation gives nothing, not another thread's history.
  assert.deepEqual(await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 30, beforeId: "00000000-0000-4000-8000-0000000000ff" }), []);
});

test("N09F-01: messages sharing the same timestamp are neither lost nor repeated across the cursor", async () => {
  const { chatRepository, prisma } = await import("../repositories/chat.repository");
  const same = new Date(Date.UTC(2026, 10, 9, 11, 0, 0));
  const rows: Row[] = [1, 2, 3, 4].map((i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    conversationId: "conv-1",
    createdAt: same,
    senderId: "u1",
    content: `same #${i}`,
  }));
  installFakeMessageTable(rows, prisma);
  const newest2 = await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 2 });
  assert.deepEqual(newest2.map((m) => m.content), ["same #3", "same #4"]);
  const older = await chatRepository.findMessagesByConversationId("conv-1", { skip: 0, take: 2, beforeId: newest2[0].id });
  assert.deepEqual(older.map((m) => m.content), ["same #1", "same #2"]);
});

// ── N09F-07: a locked participant ───────────────────────────────────────────────────────────────────────────────────
let authStub: http.Server;
let userStatus: Record<string, number | boolean> = {};

test.before(async () => {
  authStub = http.createServer((req, res) => {
    const m = /^\/auth\/internal\/users\/([^/]+)$/.exec(req.url || "");
    if (!m) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const v = userStatus[decodeURIComponent(m[1])];
    if (typeof v === "number") {
      res.statusCode = v;
      res.end("{}");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: { id: m[1], firstName: "A", lastName: "B", role: "PT", isActive: v !== false } }));
  });
  await new Promise<void>((r) => authStub.listen(0, "127.0.0.1", r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authStub.address() as AddressInfo).port}`;
});
test.after(async () => {
  await new Promise<void>((r) => authStub.close(() => r()));
});

async function serviceWithFakeRepo() {
  const { chatRepository } = await import("../repositories/chat.repository");
  const stored: { conversationId: string; senderId: string; content: string }[] = [];
  const repo = chatRepository as any;
  repo.isUserParticipant = async (_c: string, u: string) => u === "sender" || u === "peer";
  repo.findConversationById = async (id: string) => ({
    id,
    participants: [{ userId: "sender" }, { userId: "peer" }],
  });
  repo.createMessage = async (conversationId: string, senderId: string, content: string) => {
    stored.push({ conversationId, senderId, content });
    return { id: "m-1", conversationId, senderId, content, createdAt: new Date() };
  };
  const { chatService } = await import("../services/chat.service");
  return { chatService, stored };
}

test("N09F-07: sending to a conversation whose other participant is locked is refused, nothing stored", async () => {
  userStatus = { peer: false };
  const { chatService, stored } = await serviceWithFakeRepo();
  await assert.rejects(
    () => chatService.sendMessage("conv-1", "sender", "xin chào"),
    (err: any) => err.statusCode === 403 && /không hoạt động/.test(err.message),
  );
  assert.equal(stored.length, 0);
});

test("N09F-07: an active peer can be messaged; an auth-service outage does not silence chat (fail-open, only a definite isActive=false refuses)", async () => {
  const { chatService, stored } = await serviceWithFakeRepo();
  userStatus = { peer: true };
  const sent = await chatService.sendMessage("conv-1", "sender", "xin chào");
  assert.equal(sent.id, "m-1");
  userStatus = { peer: 500 };
  await chatService.sendMessage("conv-1", "sender", "vẫn gửi được");
  assert.equal(stored.length, 2);
});

test("a non-participant still gets a Vietnamese 403", async () => {
  const { chatService } = await serviceWithFakeRepo();
  await assert.rejects(
    () => chatService.sendMessage("conv-1", "stranger", "hi"),
    (err: any) => err.statusCode === 403 && /không thuộc cuộc trò chuyện/.test(err.message),
  );
});

// ── N09F-10 / N09F-11: call error text ──────────────────────────────────────────────────────────────────────────────
test("N09F-10/11: call errors the user can see are Vietnamese; join-token errors stay recognisable to the clients", async () => {
  const { callErrorText, VALID_CALL_TYPES } = await import("../utils/callErrors");
  assert.deepEqual([...VALID_CALL_TYPES], ["VOICE", "VIDEO"]);
  assert.match(callErrorText("Invalid call type"), /Loại cuộc gọi không hợp lệ/);
  assert.equal(callErrorText("User is busy"), "Người kia đang bận");
  assert.equal(callErrorText("You are already in a call"), "Bạn đang trong một cuộc gọi khác");
  assert.match(callErrorText("One or both accounts are deactivated"), /vô hiệu hóa/);
  assert.equal(callErrorText(undefined), "Cuộc gọi gặp lỗi, vui lòng thử lại");
  // Web and mobile detect these two by the words "join"/"token" and show their own text.
  assert.equal(callErrorText("Invalid or expired join token"), "Invalid or expired join token");
  // None of the translations may accidentally contain the words that trigger that detection.
  const { callErrorText: t } = await import("../utils/callErrors");
  for (const k of ["User is busy", "Not allowed", "Call not found", "Failed to initiate call", "Missing required fields"]) {
    assert.doesNotMatch(t(k), /token|join/i, k);
  }
});

test("N09F-10: an invalid callType over the socket is refused with the Vietnamese text before any permission lookup", async () => {
  process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";
  const { registerCallHandlers } = await import("../socket/call.handler");
  const handlers = new Map<string, (...a: any[]) => any>();
  const emitted: { event: string; payload: any }[] = [];
  const socket: any = {
    id: "s1",
    handshake: { auth: { token: "t" } },
    on: (e: string, fn: (...a: any[]) => any) => handlers.set(e, fn),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  };
  registerCallHandlers({} as any, socket, { id: "caller", email: "c@example.com" });
  await handlers.get("call:initiate")!({ calleeId: "callee", callType: "HOLOGRAM", conversationId: "conv-1" });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "call:error");
  assert.match(emitted[0].payload.message, /Loại cuộc gọi không hợp lệ/);
});
