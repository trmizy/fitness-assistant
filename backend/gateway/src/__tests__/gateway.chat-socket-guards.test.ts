/**
 * Chat socket guards on the gateway (N09F-06 typing from an outsider, N09F-03 join ack, Vietnamese refusal text for
 * N09F-02/07/09, N09F-07 socket cut when an admin locks an account).
 *
 * TEST FIXTURE: a fake socket object records what the handlers do, and a stub chat-service answers the REST calls the
 * handlers make. The lock test drives the real gateway app over HTTP with a stub auth-service.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret-chat-guards-test";

type Handler = (...args: any[]) => any;

let chatStub: http.Server;
let authStub: http.Server;
let chatCalls: { method?: string; url?: string; body: string }[] = [];
let chatReply: { status: number; body: unknown } = { status: 200, body: [] };

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });

function fakeSocket(joined: string[] = []) {
  const handlers = new Map<string, Handler>();
  const emitted: { event: string; payload: any }[] = [];
  const relayed: { room: string; event: string; payload: any }[] = [];
  const rooms = new Set<string>(joined.map((id) => `chat:${id}`));
  const socket: any = {
    id: "sock-1",
    rooms,
    data: { authToken: "tok", user: { id: "user-1", role: "CUSTOMER" } },
    on: (event: string, fn: Handler) => handlers.set(event, fn),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    join: async (room: string) => rooms.add(room),
    leave: async (room: string) => rooms.delete(room),
    to: (room: string) => ({
      emit: (event: string, payload: any) => relayed.push({ room, event, payload }),
    }),
  };
  return { socket, handlers, emitted, relayed };
}

test.before(async () => {
  chatStub = http.createServer(async (req, res) => {
    const body = await readBody(req);
    chatCalls.push({ method: req.method, url: req.url, body });
    res.writeHead(chatReply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chatReply.body));
  });
  await new Promise<void>((r) => chatStub.listen(0, "127.0.0.1", r));
  process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${(chatStub.address() as AddressInfo).port}`;

  authStub = http.createServer(async (req, res) => {
    await readBody(req);
    if (req.method === "POST" && req.url === "/auth/verify") {
      const isAdmin = String(req.headers.authorization || "").includes("admin-token");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          user: { id: isAdmin ? "admin-1" : "u-1", email: "x@example.com", role: isAdmin ? "ADMIN" : "CUSTOMER" },
        }),
      );
      return;
    }
    if (req.method === "PATCH" && /^\/auth\/users\/[^/]+\/(disable|enable)$/.test(req.url || "")) {
      if ((req.url || "").includes("/missing/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: "x", isActive: false } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => authStub.listen(0, "127.0.0.1", r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authStub.address() as AddressInfo).port}`;
  process.env.USER_SERVICE_URL = process.env.AUTH_SERVICE_URL;
});

test.beforeEach(() => {
  chatCalls = [];
  chatReply = { status: 200, body: [] };
});

test.after(async () => {
  await new Promise<void>((r) => chatStub.close(() => r()));
  await new Promise<void>((r) => authStub.close(() => r()));
});

async function register(sock: ReturnType<typeof fakeSocket>) {
  const { registerChatHandlers } = await import("../socket/handlers/chat.handlers");
  registerChatHandlers({} as any, sock.socket);
}

test("N09F-06: typing from a socket whose join was refused is not relayed", async () => {
  const sock = fakeSocket([]);
  await register(sock);
  sock.handlers.get("chat:typing")!({ conversationId: "c-1", typing: true });
  assert.equal(sock.relayed.length, 0);
});

test("N09F-06: typing from a socket that joined the room is still relayed to the others", async () => {
  const sock = fakeSocket(["c-1"]);
  await register(sock);
  sock.handlers.get("chat:typing")!({ conversationId: "c-1", typing: true });
  assert.equal(sock.relayed.length, 1);
  assert.equal(sock.relayed[0].room, "chat:c-1");
  assert.equal(sock.relayed[0].payload.typing, true);
});

test("N09F-03: an accepted join is acknowledged, a refused one is acknowledged as failed with a Vietnamese error", async () => {
  const sock = fakeSocket([]);
  await register(sock);
  chatReply = { status: 200, body: [] };
  const okAck: any[] = [];
  await sock.handlers.get("chat:join_conversation")!({ conversationId: "c-1" }, (r: any) => okAck.push(r));
  assert.deepEqual(okAck, [{ ok: true }]);
  assert.ok(sock.socket.rooms.has("chat:c-1"));

  const refused = fakeSocket([]);
  await register(refused);
  chatReply = { status: 403, body: { error: "x" } };
  const noAck: any[] = [];
  await refused.handlers.get("chat:join_conversation")!({ conversationId: "c-2" }, (r: any) => noAck.push(r));
  assert.deepEqual(noAck, [{ ok: false }]);
  assert.ok(!refused.socket.rooms.has("chat:c-2"));
  assert.match(refused.emitted[0].payload.detail, /cuộc trò chuyện/);
});

test("a join without an ack callback still works (older clients)", async () => {
  const sock = fakeSocket([]);
  await register(sock);
  await sock.handlers.get("chat:join_conversation")!({ conversationId: "c-1" });
  assert.ok(sock.socket.rooms.has("chat:c-1"));
});

test("N09F-02/07: a refusal from chat-service reaches the sender as the Vietnamese sentence, old code kept in `message`", async () => {
  const sock = fakeSocket(["c-1"]);
  await register(sock);
  chatReply = { status: 403, body: { error: "Không thể gửi tin nhắn: tài khoản của người nhận hiện không hoạt động" } };
  await sock.handlers.get("chat:message:send")!({ conversationId: "c-1", content: "xin chào" });
  const err = sock.emitted.find((e) => e.event === "chat:error")!;
  assert.equal(err.payload.message, "Failed to send message");
  assert.match(err.payload.detail, /không hoạt động/);
});

test("N09F-09: blank content is refused before anything is forwarded", async () => {
  const sock = fakeSocket(["c-1"]);
  await register(sock);
  await sock.handlers.get("chat:message:send")!({ conversationId: "c-1", content: "   \n " });
  assert.equal(chatCalls.length, 0);
  assert.match(sock.emitted[0].payload.detail, /không được để trống/);
});

test("lockedUserIdFromRequest recognises only PATCH /admin/users/:id/disable", async () => {
  const { lockedUserIdFromRequest } = await import("../socket/lockDisconnect");
  assert.equal(lockedUserIdFromRequest("PATCH", "/admin/users/abc/disable"), "abc");
  assert.equal(lockedUserIdFromRequest("PATCH", "/admin/users/abc/disable?x=1"), "abc");
  assert.equal(lockedUserIdFromRequest("PATCH", "/admin/users/abc/enable"), null);
  assert.equal(lockedUserIdFromRequest("GET", "/admin/users/abc/disable"), null);
  assert.equal(lockedUserIdFromRequest("PATCH", "/admin/users/abc/role"), null);
});

test("N09F-07: a successful admin lock cuts the locked user's sockets; a failed or non-admin one does not", async () => {
  const { initializeSocketServer } = await import("../socket");
  const { default: app } = await import("../app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const io = initializeSocketServer(server);
  const cut: { room: string; close: unknown }[] = [];
  (io as any).in = (room: string) => ({
    disconnectSockets: (close: unknown) => cut.push({ room, close }),
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ok = await fetch(`${base}/admin/users/pt-9/disable`, {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "gian lận" }),
    });
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(cut, [{ room: "user:pt-9", close: true }]);

    cut.length = 0;
    const notFound = await fetch(`${base}/admin/users/missing/disable`, {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token" },
    });
    assert.equal(notFound.status, 404);
    const nonAdmin = await fetch(`${base}/admin/users/pt-9/disable`, {
      method: "PATCH",
      headers: { Authorization: "Bearer customer-token" },
    });
    assert.equal(nonAdmin.status, 403);
    const enable = await fetch(`${base}/admin/users/pt-9/enable`, {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token" },
    });
    assert.equal(enable.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(cut.length, 0);
  } finally {
    io.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
