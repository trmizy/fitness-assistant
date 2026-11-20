/**
 * CALL-01 (real-device rehearsal 19/11): about 15 minutes after the socket connected, every chat call failed with
 * "Phiên đăng nhập đã hết hạn" on web AND mobile. Cause: call.handler forwarded socket.handshake.auth.token (captured
 * once at connect time) to user-service /contracts/check-relationship, which re-verifies the bearer on every call -
 * a 401 once that handshake token had expired, mapped to "Session expired".
 *
 * Fix under test: the socket keeps a mutable, re-verified token (socket-auth.ts) that the client refreshes by push
 * (`auth:refresh`) or on demand (`auth:request_token`); a refused / replaced / foreign token disconnects the socket.
 *
 *  - unit cases drive SocketAuth with a fake socket + fake auth-service                                [TEST FIXTURE]
 *  - integration cases run the REAL socket.io server (initSocket) + REAL call.policy/axios clients against
 *    local HTTP stubs standing in for auth-service and user-service                                    [BACKEND INTEGRATION, no DB]
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";
process.env.INTERNAL_API_SECRET ??= "token-refresh-internal-secret";
process.env.SOCKET_TOKEN_PULL_TIMEOUT_MS = "400";
const AUTH_PORT = 38927;
const USER_PORT = 38928;
process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${AUTH_PORT}`;
process.env.USER_SERVICE_URL = `http://127.0.0.1:${USER_PORT}`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}
const NOW = { disconnectDelayMs: 0 };
const nowS = () => Math.floor(Date.now() / 1000);
const tokenFor = (userId: string, expInS: number, sid = "sid-1") => jwt({ userId, sid, exp: nowS() + expInS });

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

// ── unit: SocketAuth ────────────────────────────────────────────────────────────────────────────────────────────────
async function load() {
  return import("../socket/socket-auth");
}

function fakeSocket(answer?: (event: string) => { token?: string } | "silent") {
  const log: string[] = [];
  const socket: any = {
    id: "s-1",
    disconnected: 0,
    disconnect() {
      socket.disconnected++;
    },
    timeout() {
      return {
        emit: (event: string, cb: (err: unknown, res?: unknown) => void) => {
          log.push(event);
          const a = answer?.(event) ?? "silent";
          if (a === "silent") setTimeout(() => cb(new Error("timeout")), 5);
          else setImmediate(() => cb(null, a));
        },
      };
    },
    on() {},
  };
  return { socket, log };
}

test("tokenExpiryMs reads exp of a JWT and is null for anything else", async () => {
  const { tokenExpiryMs } = await load();
  assert.equal(tokenExpiryMs(jwt({ exp: 2000000000 })), 2000000000 * 1000);
  assert.equal(tokenExpiryMs("not-a-jwt"), null);
  assert.equal(tokenExpiryMs(null), null);
});

test("ensureFresh: a still-valid token is returned without asking the client", async () => {
  const { SocketAuth } = await load();
  const { socket, log } = fakeSocket();
  const t = tokenFor("u1", 600);
  const auth = new SocketAuth(socket, "u1", t, { verify: async () => ({ user: { id: "u1" } }), ...NOW });
  try {
    assert.equal(await auth.ensureFresh(), t);
    assert.deepEqual(log, []);
  } finally {
    auth.close();
  }
});

test("ensureFresh: an expired token is replaced by the one the client answers with, after auth-service re-verified it", async () => {
  const { SocketAuth } = await load();
  const fresh = tokenFor("u1", 900);
  const { socket, log } = fakeSocket(() => ({ token: fresh }));
  const verified: string[] = [];
  const auth = new SocketAuth(socket, "u1", tokenFor("u1", -60), {
    verify: async (t: string) => {
      verified.push(t);
      return { user: { id: "u1" } };
    },
  });
  try {
    assert.equal(await auth.ensureFresh(), fresh);
    assert.deepEqual(log, ["auth:request_token"]);
    assert.deepEqual(verified, [fresh]);
    assert.equal(socket.disconnected, 0);
  } finally {
    auth.close();
  }
});

test("ensureFresh: a client that does not answer leaves null (never the stale token) and the socket connected", async () => {
  const { SocketAuth } = await load();
  const { socket } = fakeSocket(() => "silent");
  const auth = new SocketAuth(socket, "u1", tokenFor("u1", -60), { verify: async () => ({ user: { id: "u1" } }), ...NOW });
  try {
    assert.equal(await auth.ensureFresh(), null);
    assert.equal(socket.disconnected, 0);
  } finally {
    auth.close();
  }
});

test("adopt: a token auth-service refuses (401 / SESSION_REPLACED) disconnects the socket and is not kept", async () => {
  const { SocketAuth } = await load();
  const { socket } = fakeSocket();
  const original = tokenFor("u1", 600);
  const auth = new SocketAuth(socket, "u1", original, {
    ...NOW,
    verify: async () => {
      throw Object.assign(new Error("x"), { response: { status: 401, data: { code: "SESSION_REPLACED" } } });
    },
  });
  try {
    const r = await auth.adopt(tokenFor("u1", 900, "sid-old"));
    assert.deepEqual(r, { ok: false, fatal: true, reason: "refused" });
    assert.equal(socket.disconnected, 1);
    assert.equal(auth.current(), original);
  } finally {
    auth.close();
  }
});

test("adopt: a token of ANOTHER user is refused and disconnects the socket", async () => {
  const { SocketAuth } = await load();
  const { socket } = fakeSocket();
  const auth = new SocketAuth(socket, "u1", tokenFor("u1", 600), { verify: async () => ({ user: { id: "someone-else" } }), ...NOW });
  try {
    const r = await auth.adopt(tokenFor("someone-else", 900));
    assert.deepEqual(r, { ok: false, fatal: true, reason: "user-mismatch" });
    assert.equal(socket.disconnected, 1);
  } finally {
    auth.close();
  }
});

test("adopt: auth-service being down is not a verdict - the socket stays, the old token is kept", async () => {
  const { SocketAuth } = await load();
  const { socket } = fakeSocket();
  const original = tokenFor("u1", 600);
  const auth = new SocketAuth(socket, "u1", original, {
    verify: async () => {
      throw Object.assign(new Error("boom"), { response: { status: 503 } });
    },
  });
  try {
    const r = await auth.adopt(tokenFor("u1", 900));
    assert.deepEqual(r, { ok: false, fatal: false, reason: "unavailable" });
    assert.equal(socket.disconnected, 0);
    assert.equal(auth.current(), original);
    assert.equal((await auth.adopt(undefined)).ok, false);
    assert.equal((await auth.adopt("")).ok, false);
  } finally {
    auth.close();
  }
});

test("adopt: an older token never replaces a newer one", async () => {
  const { SocketAuth } = await load();
  const { socket } = fakeSocket();
  const newer = tokenFor("u1", 900);
  const auth = new SocketAuth(socket, "u1", newer, { verify: async () => ({ user: { id: "u1" } }), ...NOW });
  try {
    assert.equal((await auth.adopt(tokenFor("u1", 100))).ok, true);
    assert.equal(auth.current(), newer);
  } finally {
    auth.close();
  }
});

test("registerAuthRefreshHandler: ack {ok:true} for a good token, {ok:false, code} for a refused one", async () => {
  const { SocketAuth, registerAuthRefreshHandler } = await load();
  const { socket } = fakeSocket();
  const handlers = new Map<string, (...a: any[]) => any>();
  const sock: any = socket;
  sock.on = (e: string, h: any) => handlers.set(e, h);
  let refuse = false;
  const auth = new SocketAuth(sock, "u1", tokenFor("u1", 600), {
    ...NOW,
    verify: async () => {
      if (refuse) throw Object.assign(new Error("x"), { response: { status: 401 } });
      return { user: { id: "u1" } };
    },
  });
  registerAuthRefreshHandler(sock, auth);
  try {
    let ack: any;
    await handlers.get("auth:refresh")!({ token: tokenFor("u1", 900) }, (r: unknown) => (ack = r));
    assert.deepEqual(ack, { ok: true });
    refuse = true;
    await handlers.get("auth:refresh")!({ token: tokenFor("u1", 1200) }, (r: unknown) => (ack = r));
    assert.deepEqual(ack, { ok: false, code: "refused" });
    assert.equal(sock.disconnected, 1);
  } finally {
    auth.close();
  }
});

// ── call.handler uses the live token ────────────────────────────────────────────────────────────────────────────────
function handlerHarness(userId: string, tokenSource: { ensureFresh(): Promise<string | null> }) {
  return import("../socket/call.handler").then(({ registerCallHandlers }) => {
    const handlers = new Map<string, (...a: any[]) => any>();
    const emitted: { event: string; payload: any }[] = [];
    const socket: any = {
      id: "s-1",
      handshake: { auth: { token: "STALE-HANDSHAKE-TOKEN" } },
      on: (e: string, h: any) => handlers.set(e, h),
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    };
    registerCallHandlers({} as any, socket, { id: userId, email: `${userId}@x.test` }, tokenSource);
    return { handlers, emitted };
  });
}

test("call:initiate (chat) with no obtainable token says the session expired - and never calls user-service", async () => {
  const { handlers, emitted } = await handlerHarness("caller", { ensureFresh: async () => null });
  await handlers.get("call:initiate")!({ calleeId: "callee", callType: "VOICE", conversationId: "conv-1" });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "call:error");
  assert.match(emitted[0].payload.message, /Phiên đăng nhập đã hết hạn/);
});

// ── integration: real socket.io server ──────────────────────────────────────────────────────────────────────────────
async function loadClient() {
  const clientPath = [
    path.resolve(process.cwd(), "../../../node_modules/.pnpm/socket.io-client@4.8.3/node_modules/socket.io-client/build/esm-debug/index.js"),
    path.resolve(process.cwd(), "../../../frontend/web/node_modules/socket.io-client/build/esm-debug/index.js"),
  ].find((p) => existsSync(p));
  if (!clientPath) return null;
  return (await import(pathToFileURL(clientPath).href)).io as (url: string, opts: object) => any;
}

function decodePayload(token: string): { userId: string; exp: number; sid: string } {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("real socket.io: a socket older than its handshake token still calls (client answers auth:request_token); a replaced session loses its socket", async () => {
  const connect = await loadClient();
  if (!connect) return; // socket.io-client is not a chat-service dependency; without a copy in the workspace this cannot run

  const revokedSids = new Set<string>();
  const seenBy = { checkRelationship: [] as string[] };
  const authStub = http.createServer((req, res) => {
    const token = String(req.headers.authorization || "").replace("Bearer ", "");
    const p = decodePayload(token);
    res.writeHead(p.exp * 1000 < Date.now() ? 401 : revokedSids.has(p.sid) ? 401 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(res.statusCode === 200 ? { user: { id: p.userId, email: `${p.userId}@x.test`, role: "CUSTOMER" } } : { error: "Invalid token" }));
  });
  // user-service: like the real one, it re-verifies the bearer on every call.
  const userStub = http.createServer((req, res) => {
    const token = String(req.headers.authorization || "").replace("Bearer ", "");
    seenBy.checkRelationship.push(token);
    const expired = decodePayload(token).exp * 1000 < Date.now();
    res.writeHead(expired ? 401 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(expired ? { error: "Invalid token" } : { blocked: false }));
  });
  await new Promise<void>((r) => authStub.listen(AUTH_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => userStub.listen(USER_PORT, "127.0.0.1", r));

  const { initSocket } = await import("../socket/index");
  const { chatRepository } = await import("../repositories/chat.repository");
  const { callService } = await import("../services/call.service");
  const restores = [
    patch(chatRepository, "isUserParticipant", async () => true),
    patch(callService, "initiateCall", async () => ({ error: "User is busy" })),
    patch(callService, "findActiveCallForUser", async () => null),
  ];
  const httpServer = http.createServer();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const io = initSocket(httpServer);
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const opts = (token: string) => ({ auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  const waitFor = async (cond: () => boolean, ms = 4000) => {
    for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(cond(), "condition not met in time");
  };
  const callOnce = (client: any) =>
    new Promise<string>((resolve) => {
      client.once("call:error", (e: { message: string }) => resolve(e.message));
      client.emit("call:initiate", { calleeId: "callee-1", callType: "VOICE", conversationId: "conv-1" });
    });

  const clients: any[] = [];
  try {
    // 1) handshake token valid for 1.5 s only; the client keeps answering auth:request_token with a fresh one.
    const shortLived = tokenFor("caller-1", 2);
    const c1 = connect(url, opts(shortLived));
    clients.push(c1);
    let latest = shortLived;
    c1.on("auth:request_token", (ack: (r: unknown) => void) => {
      latest = tokenFor("caller-1", 900);
      ack({ token: latest });
    });
    await new Promise<void>((r) => c1.on("connect", () => r()));
    await new Promise((r) => setTimeout(r, 2300)); // past the handshake token's expiry
    const message = await callOnce(c1);
    assert.equal(message, "Người kia đang bận", "the call got past the permission check with a LIVE token, not 'Session expired'");
    assert.ok(seenBy.checkRelationship.length >= 1);
    assert.notEqual(seenBy.checkRelationship.at(-1), shortLived, "user-service never saw the stale handshake token");
    assert.equal(seenBy.checkRelationship.at(-1), latest);
    assert.equal(c1.connected, true);

    // 2) a client that pushes auth:refresh (after its own REST refresh) works the same without being asked.
    const c2 = connect(url, opts(tokenFor("caller-2", 2)));
    clients.push(c2);
    await new Promise<void>((r) => c2.on("connect", () => r()));
    const pushed = tokenFor("caller-2", 900);
    const ack = await new Promise<any>((r) => c2.emit("auth:refresh", { token: pushed }, r));
    assert.deepEqual(ack, { ok: true });
    await new Promise((r) => setTimeout(r, 2300));
    assert.equal(await callOnce(c2), "Người kia đang bận");
    assert.equal(seenBy.checkRelationship.at(-1), pushed);

    // 3) a client that never answers: the stale token is NOT used - the call says the session expired.
    const c3 = connect(url, opts(tokenFor("caller-3", 2)));
    clients.push(c3);
    await new Promise<void>((r) => c3.on("connect", () => r()));
    await new Promise((r) => setTimeout(r, 2300));
    const before = seenBy.checkRelationship.length;
    assert.match(await callOnce(c3), /Phiên đăng nhập đã hết hạn/);
    assert.equal(seenBy.checkRelationship.length, before, "no user-service call was made with the dead token");
    assert.equal(c3.connected, true, "an unanswering (older) client keeps its socket for chat");

    // 4) SESSION_REPLACED: the replaced session's refresh is refused and its socket is cut.
    const c4 = connect(url, opts(tokenFor("caller-4", 900, "sid-4")));
    clients.push(c4);
    await new Promise<void>((r) => c4.on("connect", () => r()));
    revokedSids.add("sid-4");
    const refused = await new Promise<any>((r) => c4.emit("auth:refresh", { token: tokenFor("caller-4", 1800, "sid-4") }, r));
    assert.equal(refused.ok, false);
    await waitFor(() => c4.connected === false);

    // 5) the same on the expiry pull: the client answers with a token of a replaced session -> disconnected.
    const c5 = connect(url, opts(tokenFor("caller-5", 2, "sid-5")));
    clients.push(c5);
    c5.on("auth:request_token", (ack: (r: unknown) => void) => ack({ token: tokenFor("caller-5", 900, "sid-5") }));
    await new Promise<void>((r, j) => { c5.on("connect", () => r()); c5.on("connect_error", (e: Error) => j(e)); });
    revokedSids.add("sid-5");
    await waitFor(() => c5.connected === false, 6000);
  } finally {
    restores.forEach((r) => r());
    clients.forEach((c) => c.disconnect());
    io.close();
    await new Promise<void>((r) => authStub.close(() => r()));
    await new Promise<void>((r) => userStub.close(() => r()));
  }
});
