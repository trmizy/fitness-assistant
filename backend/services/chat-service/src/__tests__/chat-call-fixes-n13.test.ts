/**
 * Fix round 14/11/2026 (N13H-02/06/07/08, N11F-03) for chat-service.
 *
 *   N13H-02  conversation list: never-written conversations (lastMessageAt NULL) go LAST, then createdAt desc.   [BACKEND INTEGRATION, *_test DB]
 *   N13H-06  two tabs accepting one call: exactly one wins (single conditional UPDATE), the loser is told in Vietnamese. [BACKEND INTEGRATION + TEST FIXTURE]
 *   N13H-07  calling yourself is refused (service + socket handler), nothing rings, no "nhỡ" line.                  [TEST FIXTURE]
 *   N13H-08  a caller who reconnects inside the grace window: peer_reconnected is sent and call:rejoin is accepted.  [TEST FIXTURE + real socket.io server]
 *   N11F-03  a locked account's own token (403) is reported as a locked account, not as "cannot verify status";
 *            POST /internal/users/:id/disconnect cuts that user's chat sockets.                                      [TEST FIXTURE + REAL HTTP against the app]
 *
 * DB suites run only after the preload accepted an isolated *_test database (TEST_DATABASE_URL, see setup/README.md).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";
process.env.INTERNAL_API_SECRET = "n13-fixes-internal-secret";
// The service clients read their base URL once at import, so the stubs below use fixed loopback ports set before any import.
const AUTH_STUB_PORT = 38917;
const USER_STUB_PORT = 38918;
process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${AUTH_STUB_PORT}`;
process.env.USER_SERVICE_URL = `http://127.0.0.1:${USER_STUB_PORT}`;

const dbUsable = process.env.DB_ISOLATION === "accepted" && /_test$/.test(new URL(process.env.CHAT_DATABASE_URL ?? "postgresql://x/y").pathname.slice(1));
const dbSkip = dbUsable ? false : "Requires the preload to have accepted TEST_DATABASE_URL (an isolated *_test database).";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

// ── N13H-02 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N13H-02: conversations with a message come first (newest message first); empty ones last, newest-created first", { skip: dbSkip }, async () => {
  const { prisma, chatRepository } = await import("../repositories/chat.repository");
  const me = `n13-me-${Date.now()}`;
  const mk = (peer: string, data: { lastMessageAt?: Date | null; createdAt: Date }) =>
    prisma.conversation.create({
      data: { type: "DIRECT", lastMessageAt: data.lastMessageAt ?? null, createdAt: data.createdAt, participants: { create: [{ userId: me }, { userId: `${me}-${peer}` }] } },
    });
  const emptyNewest = await mk("e1", { createdAt: new Date("2026-11-10T10:00:00Z") });
  const olderMsg = await mk("o", { createdAt: new Date("2026-11-01T10:00:00Z"), lastMessageAt: new Date("2026-11-02T10:00:00Z") });
  const emptyOlder = await mk("e2", { createdAt: new Date("2026-11-05T10:00:00Z") });
  const newerMsg = await mk("n", { createdAt: new Date("2026-10-20T10:00:00Z"), lastMessageAt: new Date("2026-11-09T10:00:00Z") });
  const ids = [emptyNewest.id, olderMsg.id, emptyOlder.id, newerMsg.id];
  try {
    const list = await chatRepository.findConversationsByUserId(me);
    assert.deepEqual(
      list.map((c) => c.id),
      [newerMsg.id, olderMsg.id, emptyNewest.id, emptyOlder.id],
    );
  } finally {
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

// ── N13H-06 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N13H-06: two simultaneous accepts of one ringing call -> exactly one wins, the other is 'alreadyHandled'", { skip: dbSkip }, async () => {
  const { prisma } = await import("../repositories/chat.repository");
  const { callService } = await import("../services/call.service");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const call = await prisma.callSession.create({
    data: { callerId: `caller-${stamp}`, calleeId: `callee-${stamp}`, callType: "VIDEO", origin: "CHAT", status: "RINGING" },
  });
  try {
    for (let round = 0; round < 1; round++) {
      const results = await Promise.all(Array.from({ length: 6 }, () => callService.acceptCall(call.id, call.calleeId)));
      const winners = results.filter((r) => "call" in r && r.call);
      const losers = results.filter((r) => "error" in r);
      assert.equal(winners.length, 1, "exactly one accept wins");
      assert.equal(losers.length, 5);
      for (const l of losers) assert.equal((l as any).alreadyHandled, true);
    }
    const row = await prisma.callSession.findUnique({ where: { id: call.id } });
    assert.equal(row!.status, "ACCEPTED");
    assert.ok(row!.answeredAt);
  } finally {
    await prisma.callSession.delete({ where: { id: call.id } });
    await prisma.$disconnect();
  }
});

test("N13H-06: accepting a call that was cancelled is 'no longer ringing', not 'accepted elsewhere'; a stranger is refused", { skip: dbSkip }, async () => {
  const { prisma } = await import("../repositories/chat.repository");
  const { callService } = await import("../services/call.service");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const call = await prisma.callSession.create({
    data: { callerId: `caller-${stamp}`, calleeId: `callee-${stamp}`, callType: "VOICE", origin: "CHAT", status: "CANCELLED" },
  });
  try {
    const r: any = await callService.acceptCall(call.id, call.calleeId);
    assert.equal(r.error, "Call is no longer ringing");
    assert.equal(r.alreadyHandled, false);
    const stranger: any = await callService.acceptCall(call.id, "someone-else");
    assert.equal(stranger.error, "Not authorized");
  } finally {
    await prisma.callSession.delete({ where: { id: call.id } });
    await prisma.$disconnect();
  }
});

// ── socket-handler fixtures ─────────────────────────────────────────────────────────────────────────────────────────
type Handler = (payload: any) => Promise<void>;
async function handlerFor(userId: string) {
  const { registerCallHandlers } = await import("../socket/call.handler");
  const handlers = new Map<string, Handler>();
  const toSocket: Array<{ event: string; payload: any }> = [];
  const toRoom: Array<{ room: string; event: string; payload: any }> = [];
  const socket: any = {
    id: "s-1",
    handshake: { auth: { token: "t" } },
    on: (e: string, h: Handler) => handlers.set(e, h),
    emit: (event: string, payload: any) => void toSocket.push({ event, payload }),
  };
  const io: any = { to: (room: string) => ({ emit: (event: string, payload: any) => void toRoom.push({ room, event, payload }) }) };
  registerCallHandlers(io, socket, { id: userId, email: `${userId}@x.test` });
  return { handlers, toSocket, toRoom };
}

test("N13H-07: call:initiate with calleeId = self is refused in Vietnamese; nothing is created, rung or logged", async () => {
  const { callService } = await import("../services/call.service");
  const { chatRepository } = await import("../repositories/chat.repository");
  let created = 0;
  let logged = 0;
  const restores = [
    patch(callService, "initiateCall", async () => {
      created++;
      return { error: "x" };
    }),
    patch(chatRepository, "createMessage", async () => {
      logged++;
      return {};
    }),
  ];
  try {
    const { handlers, toSocket, toRoom } = await handlerFor("u-1");
    await handlers.get("call:initiate")!({ calleeId: "u-1", callType: "VIDEO", conversationId: "conv-1" });
    assert.deepEqual(toSocket, [{ event: "call:error", payload: { message: "Bạn không thể gọi cho chính mình" } }]);
    assert.equal(toRoom.length, 0);
    assert.equal(created, 0);
    assert.equal(logged, 0);
  } finally {
    restores.forEach((r) => r());
  }
});

test("N13H-07: the service refuses a self call on its own (REST path), before touching the database", async () => {
  const { callService } = await import("../services/call.service");
  const r = await callService.initiateCall({ callerId: "u-1", calleeId: "u-1", callType: "VOICE" as any, conversationId: "c" });
  assert.deepEqual(r, { error: "You cannot call yourself" });
});

test("N13H-06: the tab that loses the accept race gets accepted_elsewhere + a Vietnamese error; the caller is not told twice", async () => {
  const { callService } = await import("../services/call.service");
  const restore = patch(callService, "acceptCall", async () => ({ error: "Call is no longer ringing", alreadyHandled: true }));
  try {
    const { handlers, toSocket, toRoom } = await handlerFor("callee-1");
    await handlers.get("call:accept")!({ callSessionId: "call-1" });
    assert.ok(toSocket.some((e) => e.event === "call:accepted_elsewhere" && e.payload.callSessionId === "call-1"));
    assert.ok(toSocket.some((e) => e.event === "call:error" && e.payload.message === "Cuộc gọi đã được nhận ở thiết bị khác"));
    assert.equal(toRoom.filter((e) => e.event === "call:accepted").length, 0, "the loser never re-notifies the caller");
  } finally {
    restore();
  }
});

// ── N13H-08 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N13H-08: call:rejoin after the reconnect already cleared the grace timer is accepted and the peer gets peer_reconnected", async () => {
  const { callService } = await import("../services/call.service");
  const calls: Record<string, any> = {
    live: { id: "live", callerId: "caller-1", calleeId: "callee-1", status: "ACTIVE" },
    ended: { id: "ended", callerId: "caller-1", calleeId: "callee-1", status: "ENDED" },
  };
  const restore = patch(callService, "findById", async (id: string) => calls[id] ?? null);
  try {
    const caller = await handlerFor("caller-1");
    await caller.handlers.get("call:rejoin")!({ callSessionId: "live" });
    assert.deepEqual(caller.toRoom, [{ room: "user:callee-1", event: "call:peer_reconnected", payload: { callSessionId: "live" } }]);
    assert.equal(caller.toSocket.length, 0);

    // a finished call, an unknown call and an outsider are all refused with the Vietnamese "no longer in the reconnect window"
    for (const [uid, id] of [["caller-1", "ended"], ["caller-1", "nope"], ["stranger", "live"]] as const) {
      const h = await handlerFor(uid);
      await h.handlers.get("call:rejoin")!({ callSessionId: id });
      assert.equal(h.toRoom.length, 0, `${uid}/${id}`);
      assert.equal(h.toSocket[0].event, "call:error");
      assert.equal(h.toSocket[0].payload.message, "Cuộc gọi này không còn trong thời gian kết nối lại");
    }
  } finally {
    restore();
  }
});

test("N13H-08: a reconnect inside the grace window cancels the timer and tells the other side peer_reconnected (real socket.io server)", async () => {
  const clientPath = [
    path.resolve(process.cwd(), "../../../node_modules/.pnpm/socket.io-client@4.8.3/node_modules/socket.io-client/build/esm-debug/index.js"),
    path.resolve(process.cwd(), "../../../frontend/web/node_modules/socket.io-client/build/esm-debug/index.js"),
  ].find((p) => existsSync(p));
  if (!clientPath) return; // socket.io-client is not a chat-service dependency; without a copy in the workspace this case cannot run
  const { io: connect } = await import(pathToFileURL(clientPath).href);

  const authStub = http.createServer((req, res) => {
    const token = String(req.headers.authorization || "").replace("Bearer ", "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: { id: token, email: `${token}@x.test`, role: "CUSTOMER" } }));
  });
  await new Promise<void>((r) => authStub.listen(AUTH_STUB_PORT, "127.0.0.1", r));

  const { initSocket } = await import("../socket/index");
  const { graceTimers } = await import("../socket/call.handler");
  const { callService } = await import("../services/call.service");
  const call = { id: "call-g", callerId: "caller-1", calleeId: "callee-1", status: "ACTIVE", origin: "CHAT" };
  const restore = patch(callService, "findActiveCallForUser", async (u: string) => (u === "caller-1" ? call : null));
  const httpServer = http.createServer();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const io = initSocket(httpServer);
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const opts = (token: string) => ({ auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  const received: string[] = [];
  const callee = connect(url, opts("callee-1"));
  callee.on("call:peer_disconnected", () => received.push("peer_disconnected"));
  callee.on("call:peer_reconnected", () => received.push("peer_reconnected"));
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(cond(), "condition not met in time");
  };
  try {
    await new Promise<void>((r) => callee.on("connect", () => r()));
    const first = connect(url, opts("caller-1"));
    await new Promise<void>((r) => first.on("connect", () => r()));
    first.disconnect();
    await waitFor(() => received.includes("peer_disconnected") && graceTimers.has("caller-1"));

    const second = connect(url, opts("caller-1"));
    await new Promise<void>((r) => second.on("connect", () => r()));
    await waitFor(() => received.includes("peer_reconnected"));
    assert.equal(graceTimers.has("caller-1"), false, "grace timer cancelled by the reconnect");

    // N11F-03: the lock relay (POST /internal/users/:id/disconnect on the real app) really drops that user's live socket
    const { default: app } = await import("../app");
    const appServer = http.createServer(app);
    await new Promise<void>((r) => appServer.listen(0, "127.0.0.1", r));
    const appBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
    let dropped = false;
    second.on("disconnect", () => (dropped = true));
    try {
      const res = await fetch(`${appBase}/internal/users/caller-1/disconnect`, { method: "POST", headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET! } });
      assert.equal(res.status, 200);
      await waitFor(() => dropped);
      assert.equal(second.connected, false);
      assert.equal(callee.connected, true, "other users are untouched");
    } finally {
      await new Promise<void>((r) => appServer.close(() => r()));
    }
    await new Promise((r) => setTimeout(r, 200));
    for (const g of graceTimers.values()) clearTimeout(g.timeout);
    graceTimers.clear();
    callee.disconnect();
  } finally {
    restore();
    for (const g of graceTimers.values()) clearTimeout(g.timeout);
    graceTimers.clear();
    io.close();
    await new Promise<void>((r) => authStub.close(() => r()));
  }
});

// ── N11F-03 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N11F-03: canInitiateCallFromChat names a locked account (403) and an expired token (401); an outage stays 'cannot verify'", async () => {
  let replyStatus = 403;
  const userStub = http.createServer((_req, res) => {
    res.writeHead(replyStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "x" }));
  });
  await new Promise<void>((r) => userStub.listen(USER_STUB_PORT, "127.0.0.1", r));
  const { chatRepository } = await import("../repositories/chat.repository");
  const restore = patch(chatRepository, "isUserParticipant", async () => true);
  try {
    const { canInitiateCallFromChat } = await import("../services/call.policy");
    const { callErrorText } = await import("../utils/callErrors");
    const reasonFor = async (status: number) => {
      replyStatus = status;
      return (await canInitiateCallFromChat("a", "b", "conv", "tok")).reason;
    };
    const locked = await reasonFor(403);
    assert.equal(locked, "Your account is deactivated");
    assert.match(callErrorText(locked), /Tài khoản của bạn đã bị vô hiệu hóa/);
    assert.equal(await reasonFor(401), "Session expired");
    assert.equal(await reasonFor(503), "Cannot verify account status right now");
    assert.equal(await reasonFor(500), "Cannot verify account status right now");
  } finally {
    restore();
    await new Promise<void>((r) => userStub.close(() => r()));
  }
});

test("N11F-03: POST /internal/users/:id/disconnect needs the internal secret and cuts exactly that user's room", async () => {
  const { default: app } = await import("../app");
  const socketIndex = await import("../socket/index");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const noSecret = await fetch(`${base}/internal/users/u-9/disconnect`, { method: "POST" });
    assert.equal(noSecret.status, 401);
    const wrong = await fetch(`${base}/internal/users/u-9/disconnect`, { method: "POST", headers: { "x-internal-secret": "nope" } });
    assert.equal(wrong.status, 401);
    const cut: Array<{ room: string; close: unknown }> = [];
    const fake: any = { in: (room: string) => ({ disconnectSockets: (close: unknown) => void cut.push({ room, close }) }) };
    assert.equal(socketIndex.disconnectUserSockets(fake, "u-9"), true);
    assert.deepEqual(cut, [{ room: "user:u-9", close: true }]);
    assert.equal(socketIndex.disconnectUserSockets(null, "u-9"), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
