/**
 * Dispute Case slice 2 / S2.3 - chat-service GET /internal/call-sessions (read-only evidence).
 * Evidence label: REAL HTTP on a local ephemeral port against the REAL router; the repository is a TEST FIXTURE (an in-memory fake that records the
 * arguments it was called with) - no database. The Prisma query itself is CODE AUDIT (internal-evidence.repository.ts: where {coachingSessionId},
 * select = the nine evidence fields, take = MAX_ROWS).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.INTERNAL_API_SECRET = "test-only-internal-api-secret";

import { createInternalEvidenceRoutes, MAX_ROWS, type CallSessionEvidenceRow } from "../routes/internal-evidence.routes";

const SESSION = "11111111-1111-4111-8111-111111111111";
const calls: Array<{ id: string; take: number }> = [];
let rows: any[] = [];
let failing = false;

const app = express();
app.use("/internal", createInternalEvidenceRoutes({
  findCallSessionsByCoachingSession: async (id, take) => {
    calls.push({ id, take });
    if (failing) throw new Error("db down");
    return rows as CallSessionEvidenceRow[];
  },
}));
const server = app.listen(0, "127.0.0.1");
test.before(() => new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r()))));
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => new Promise<void>((r) => server.close(() => r())));
test.beforeEach(() => {
  calls.length = 0;
  rows = [];
  failing = false;
});

const get = (qs: string, secret: string | null = process.env.INTERNAL_API_SECRET!) =>
  fetch(`${base()}/internal/call-sessions${qs}`, { headers: secret === null ? {} : { "x-internal-secret": secret } });

test("a wrong or missing secret -> 401 and the repository is never asked", async () => {
  assert.equal((await get(`?coachingSessionId=${SESSION}`, "wrong")).status, 401);
  assert.equal((await get(`?coachingSessionId=${SESSION}`, "")).status, 401);
  assert.equal((await get(`?coachingSessionId=${SESSION}`, null)).status, 401);
  assert.equal((await get(`?coachingSessionId=${SESSION}`, process.env.INTERNAL_API_SECRET + "x")).status, 401);
  assert.equal(calls.length, 0);
});

test("no secret configured on the service -> 503 (closed, never open)", async () => {
  const keep = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  try {
    assert.equal((await get(`?coachingSessionId=${SESSION}`, "anything")).status, 503);
  } finally {
    process.env.INTERNAL_API_SECRET = keep;
  }
  assert.equal(calls.length, 0);
});

test("a missing key, a malformed key, an empty value, an extra parameter, a repeated parameter, a 'list all' attempt -> 400, repository never asked", async () => {
  for (const qs of ["", "?coachingSessionId=", "?coachingSessionId=abc", `?coachingSessionId=${SESSION}&limit=1000`, `?coachingSessionId=${SESSION}&coachingSessionId=${SESSION}`, "?all=true", `?coachingSessionId[$ne]=x`, `?userId=u1`]) {
    const r = await get(qs);
    assert.equal(r.status, 400, qs);
  }
  assert.equal(calls.length, 0);
});

test("a valid request returns ONLY the nine evidence fields of that session's rows, capped, with no-store", async () => {
  rows = [
    {
      id: "c1", status: "ENDED", startedAt: new Date("2026-10-01T10:00:00Z"), answeredAt: new Date("2026-10-01T10:00:02Z"), endedAt: new Date("2026-10-01T10:30:00Z"), endReason: "hangup", callerId: "pt", calleeId: "client", origin: "OPEN_ROOM",
      // fields a careless repository might return - they must never reach the wire
      conversationId: "conv-secret", callType: "VIDEO", messages: [{ content: "private text" }], createdAt: new Date(), updatedAt: new Date(),
    },
  ];
  const r = await get(`?coachingSessionId=${SESSION}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const body: any = await r.json();
  assert.deepEqual(calls, [{ id: SESSION, take: MAX_ROWS }]);
  assert.deepEqual(Object.keys(body.data[0]).sort(), ["answeredAt", "calleeId", "callerId", "endReason", "endedAt", "id", "origin", "startedAt", "status"]);
  assert.equal(JSON.stringify(body).includes("conv-secret") || JSON.stringify(body).includes("private text") || JSON.stringify(body).includes("VIDEO"), false);
  rows = Array.from({ length: MAX_ROWS + 20 }, (_, i) => ({ id: `r${i}`, status: "ENDED", startedAt: null, answeredAt: null, endedAt: null, endReason: null, callerId: "a", calleeId: "b", origin: "CHAT" }));
  assert.equal(((await (await get(`?coachingSessionId=${SESSION}`)).json()) as any).data.length, MAX_ROWS);
});

test("no rows is an empty list (a fact: no connection recorded), a failing source is a 500 - never an empty list pretending to be 'none'", async () => {
  const empty = await get(`?coachingSessionId=${SESSION}`);
  assert.deepEqual(await empty.json(), { data: [] });
  failing = true;
  assert.equal((await get(`?coachingSessionId=${SESSION}`)).status, 500);
});

test("only GET exists: POST / PUT / DELETE on the route are not served", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await fetch(`${base()}/internal/call-sessions?coachingSessionId=${SESSION}`, { method, headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET! } });
    assert.ok(r.status === 404 || r.status === 405, `${method} -> ${r.status}`);
  }
  assert.equal(calls.length, 0);
});
