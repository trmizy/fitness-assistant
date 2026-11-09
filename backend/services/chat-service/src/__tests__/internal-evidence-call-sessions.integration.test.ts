/**
 * Dispute Case slice 2 / S2.3 - chat-service GET /internal/call-sessions against the REAL app (the route mounted by src/app.ts), the REAL repository and
 * a REAL isolated *_test database (no fake repository). Evidence labels: REAL HTTP + BACKEND INTEGRATION.
 * Seeded data is SYNTHETIC and includes rows that must NOT come back: another coaching session, plain chat calls, the conversation they belong to and its
 * messages (private text that must never be returned).
 *
 * Runs only through the preload that accepted a *_test database (DB_ISOLATION=accepted):
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_chat_<x>_test?schema=public" npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";

const usable = process.env.DB_ISOLATION === "accepted" && /_test$/.test(new URL(process.env.CHAT_DATABASE_URL ?? "postgresql://x/y").pathname.slice(1));
const skip = usable ? false : "Requires the preload to have accepted TEST_DATABASE_URL (an isolated *_test database).";
const SECRET = "s23-chat-route-test-secret";
process.env.INTERNAL_API_SECRET = SECRET;

let server: http.Server;
let base = "";
let db: typeof import("../repositories/chat.repository").prisma;
const made = { calls: [] as string[], conversations: [] as string[] };
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();
const PRIVATE_TEXT = "PRIVATE-MESSAGE-TEXT-must-never-leave-chat-service";

test.before(async () => {
  if (skip) return;
  const { default: app } = await import("../app");
  db = (await import("../repositories/chat.repository")).prisma;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const conv = await db.conversation.create({
    data: { participants: { create: [{ userId: "pt-1" }, { userId: "client-1" }] }, messages: { create: [{ senderId: "client-1", content: PRIVATE_TEXT }] } },
  });
  made.conversations.push(conv.id);
  const call = async (data: Record<string, unknown>) => {
    const c = await db.callSession.create({ data: { callType: "VIDEO", ...data } as any });
    made.calls.push(c.id);
    return c;
  };
  // the two rows of SESSION_A (the first inside a conversation), one of SESSION_B, two plain chat calls without a coaching session
  await call({ conversationId: conv.id, callerId: "pt-1", calleeId: "client-1", origin: "SESSION", coachingSessionId: SESSION_A, status: "ENDED", startedAt: new Date("2026-10-01T10:16:00Z"), answeredAt: new Date("2026-10-01T10:15:58Z"), endedAt: new Date("2026-10-01T11:00:00Z"), endReason: "hangup", createdAt: new Date("2026-10-01T10:15:50Z") });
  await call({ callerId: "client-1", calleeId: "pt-1", origin: "SESSION", coachingSessionId: SESSION_A, status: "MISSED", endReason: "timeout", createdAt: new Date("2026-10-01T10:20:00Z") });
  await call({ callerId: "pt-9", calleeId: "client-9", origin: "SESSION", coachingSessionId: SESSION_B, status: "ENDED", createdAt: new Date("2026-10-01T10:15:50Z") });
  await call({ callerId: "pt-1", calleeId: "client-1", origin: "CHAT", status: "ENDED" });
  await call({ conversationId: conv.id, callerId: "pt-1", calleeId: "client-1", origin: "CHAT", status: "ENDED" });
});

test.after(async () => {
  if (!skip && db) {
    await db.callSession.deleteMany({ where: { id: { in: made.calls } } });
    await db.message.deleteMany({ where: { conversationId: { in: made.conversations } } });
    await db.conversationParticipant.deleteMany({ where: { conversationId: { in: made.conversations } } });
    await db.conversation.deleteMany({ where: { id: { in: made.conversations } } });
    await db.$disconnect();
  }
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

const get = async (qs: string, secret: string | null = SECRET) => {
  const res = await fetch(`${base}/internal/call-sessions${qs}`, { headers: secret === null ? {} : { "x-internal-secret": secret } });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

test("wrong / missing / near-miss secret -> 401 and nothing is read", { skip }, async () => {
  for (const secret of [null, "", "wrong", SECRET + "x", SECRET.toUpperCase()]) assert.equal((await get(`?coachingSessionId=${SESSION_A}`, secret)).status, 401, String(secret));
});

test("a missing key, a malformed key, an extra / repeated parameter, a listing attempt -> 400", { skip }, async () => {
  for (const qs of ["", "?coachingSessionId=", "?coachingSessionId=abc", `?coachingSessionId=${SESSION_A}&limit=500`, `?coachingSessionId=${SESSION_A}&coachingSessionId=${SESSION_B}`, "?all=true", "?conversationId=x", "?userId=pt-1"]) {
    assert.equal((await get(qs)).status, 400, qs);
  }
});

test("exactly the rows of that coaching session, oldest first, nine fields, no message content, no conversation", { skip }, async () => {
  const r = await get(`?coachingSessionId=${SESSION_A}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const rows = JSON.parse(r.text).data as any[];
  assert.equal(rows.length, 2, "not SESSION_B's row, not the plain chat calls");
  assert.deepEqual(rows.map((x) => x.status), ["ENDED", "MISSED"]);
  for (const x of rows) assert.deepEqual(Object.keys(x).sort(), ["answeredAt", "calleeId", "callerId", "endReason", "endedAt", "id", "origin", "startedAt", "status"]);
  assert.deepEqual([rows[0].callerId, rows[0].calleeId, rows[0].origin, rows[0].endReason], ["pt-1", "client-1", "SESSION", "hangup"]);
  assert.equal(rows[0].startedAt, "2026-10-01T10:16:00.000Z");
  for (const leak of [PRIVATE_TEXT, "conversationId", "content", "messages", "callType", "VIDEO", "createdAt", "updatedAt", made.conversations[0]]) assert.equal(r.text.includes(leak), false, `leaked ${leak}`);
  const b = JSON.parse((await get(`?coachingSessionId=${SESSION_B}`)).text).data as any[];
  assert.deepEqual(b.map((x) => x.callerId), ["pt-9"]);
});

test("a coaching session with no call is an empty list (a fact), and the row cap holds on real data", { skip }, async () => {
  assert.deepEqual(JSON.parse((await get(`?coachingSessionId=${randomUUID()}`)).text), { data: [] });
  const many = randomUUID();
  const rows = Array.from({ length: 55 }, (_, i) => ({ callerId: "a", calleeId: "b", callType: "VOICE" as const, origin: "SESSION" as const, coachingSessionId: many, status: "ENDED" as const, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)) }));
  const created = await Promise.all(rows.map((d) => db.callSession.create({ data: d })));
  made.calls.push(...created.map((c) => c.id));
  assert.equal(JSON.parse((await get(`?coachingSessionId=${many}`)).text).data.length, 50);
});

test("only GET is served", { skip }, async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await fetch(`${base}/internal/call-sessions?coachingSessionId=${SESSION_A}`, { method, headers: { "x-internal-secret": SECRET } });
    assert.ok(res.status === 404 || res.status === 405, `${method} -> ${res.status}`);
  }
});
