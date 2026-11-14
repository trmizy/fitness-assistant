import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";

/**
 * FIX-USER round 14/11/2026 - the REAL Express app over HTTP on an isolated `*_test` database.
 * auth-service is a TEST FIXTURE (token -> identity table at the authServiceClient boundary); fitness-service is blocked by the
 * outbound guard (its reassessment trigger is best-effort and never affects the response).
 *
 *  N13G-01  InBody PATCH/POST write only whitelisted fields; A cannot move or edit B's entry
 *  N13G-02/03  range + type validation -> 400 with a stable code, never 500
 *  N13G-04  DELETE /inbody/:id (owner only, 404 otherwise) + profile weight re-sync
 *  N13A-04  PUT /profile/me limits -> 400
 *  N13A-08  GET /notifications bad paging -> 400
 *  N13A-10  PATCH /profile/me/accepting-clients is PT-only (403)
 *  N13C-01  requestContract refuses ptUserId === caller (400 SELF_CONTRACT_NOT_ALLOWED)
 */

const tag = randomUUID().slice(0, 8);
const A = `n13a-${tag}`;
const B = `n13b-${tag}`;
const PT = `n13pt-${tag}`;
const identities = new Map<string, { id: string; email: string; role: string }>([
  ["tok-a", { id: A, email: `${A}@t.local`, role: "CUSTOMER" }],
  ["tok-b", { id: B, email: `${B}@t.local`, role: "CUSTOMER" }],
  ["tok-pt", { id: PT, email: `${PT}@t.local`, role: "PT" }],
]);
const orig = authServiceClient.verifyToken;
let server: http.Server;
let base = "";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: json, text };
}

dbTest.before(async () => {
  if (skip) return;
  authServiceClient.verifyToken = (async (header: string) => {
    const user = identities.get(String(header).replace(/^Bearer /, ""));
    if (!user) throw Object.assign(new Error("bad"), { response: { status: 401, data: {} } });
    return { status: 200, data: { user } };
  }) as typeof authServiceClient.verifyToken;
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const { profileRepository } = await import("../repositories/profile.repository");
  for (const u of [A, B, PT]) await profileRepository.upsert(u, {});
  await prisma.userProfile.update({ where: { userId: PT }, data: { isPT: true } });
});
dbTest.after(async () => {
  authServiceClient.verifyToken = orig;
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  const users = [A, B, PT];
  await prisma.inBodyEntry.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.$disconnect();
});

const entry = (over: Record<string, unknown> = {}) => ({
  date: "2026-01-10T00:00:00.000Z",
  weight: 70,
  muscleMass: 30,
  bodyFat: 12,
  ...over,
});

dbTest("N13G-01: A cannot edit or move B's entry (404, B's row untouched)", async () => {
  const b = await call("POST", "/inbody", "tok-b", entry());
  assert.equal(b.status, 200, b.text);
  const before = await prisma.inBodyEntry.findUnique({ where: { id: b.body.id } });

  for (const patch of [{ weight: 99 }, { userId: A }, { userId: A, weight: 99, id: "x" }]) {
    const r = await call("PATCH", `/inbody/${b.body.id}`, "tok-a", patch);
    assert.equal(r.status, 404, JSON.stringify(patch));
    assert.equal(r.body.code, "INBODY_NOT_FOUND");
  }
  const after = await prisma.inBodyEntry.findUnique({ where: { id: b.body.id } });
  assert.deepEqual(after, before, "row byte-for-byte unchanged");
});

dbTest("N13G-01: PATCH userId / id / createdAt / dateOnly in the body are ignored; the row stays A's", async () => {
  const a = await call("POST", "/inbody", "tok-a", entry({ date: "2026-01-11T00:00:00.000Z" }));
  assert.equal(a.status, 200, a.text);
  const before = await prisma.inBodyEntry.findUnique({ where: { id: a.body.id } });
  const r = await call("PATCH", `/inbody/${a.body.id}`, "tok-a", {
    weight: 71.5,
    userId: B,
    id: randomUUID(),
    createdAt: "2000-01-01T00:00:00.000Z",
    dateOnly: "2000-01-01",
    updatedAt: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(r.status, 200, r.text);
  const after = await prisma.inBodyEntry.findUnique({ where: { id: a.body.id } });
  assert.equal(after!.userId, A);
  assert.equal(after!.id, before!.id);
  assert.equal(after!.createdAt.getTime(), before!.createdAt.getTime());
  assert.equal(after!.dateOnly.getTime(), before!.dateOnly.getTime());
  assert.equal(after!.weight, 71.5, "the legitimate field did change");
  assert.equal((await prisma.inBodyEntry.count({ where: { id: a.body.id, userId: B } })), 0);
});

dbTest("N13G-01: POST with userId / id in the body creates the row for the CALLER with a server id", async () => {
  const forcedId = randomUUID();
  const r = await call("POST", "/inbody", "tok-a", entry({ date: "2026-01-12T00:00:00.000Z", userId: B, id: forcedId }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.userId, A);
  assert.notEqual(r.body.id, forcedId);
  assert.equal(await prisma.inBodyEntry.count({ where: { userId: B, dateOnly: new Date("2026-01-12T00:00:00.000Z") } }), 0);
});

dbTest("N13G-02/03: bad ranges, types and dates are 400 INBODY_INVALID_INPUT with a Vietnamese message (never 500)", async () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["weight -5", { weight: -5 }],
    ["weight 0", { weight: 0 }],
    ["weight 9999", { weight: 9999 }],
    ["height 0", { height: 0 }],
    ["height 500", { height: 500 }],
    ["bodyFatPct 150", { bodyFatPct: 150 }],
    ["bmr 99999", { bmr: 99999 }],
    ["visceralFat 99", { visceralFat: 99 }],
    ["muscle >= weight", { muscleMass: 80 }],
    ["date 2030", { date: "2030-01-01T00:00:00.000Z" }],
    ["date 1850", { date: "1850-01-01T00:00:00.000Z" }],
    ["date abc", { date: "abc" }],
    ["weight abc", { weight: "abc" }],
    ["weight object", { weight: { $gt: 0 } }],
    ["status junk", { status: "root" }],
  ];
  for (const [label, over] of bad) {
    const r = await call("POST", "/inbody", "tok-a", entry(over));
    assert.equal(r.status, 400, `${label}: ${r.text}`);
    assert.equal(r.body.code, "INBODY_INVALID_INPUT", label);
    assert.match(r.body.error, /[À-ỹ]/, `${label}: Vietnamese`);
  }
  // missing weight / muscle / body fat; empty and non-object bodies
  const { weight: _w, ...noWeight } = entry();
  const { muscleMass: _m, ...noMuscle } = entry();
  const { bodyFat: _b, ...noFat } = entry();
  for (const body of [noWeight, noMuscle, noFat, {}, [], "text"]) {
    const r = await call("POST", "/inbody", "tok-a", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    // a bare JSON string is already refused by express.json (strict) with its own 400 INVALID_JSON
    assert.equal(r.body.code, typeof body === "string" ? "INVALID_JSON" : "INBODY_INVALID_INPUT");
  }
  // nothing from the refused calls was saved
  assert.equal(await prisma.inBodyEntry.count({ where: { userId: A, weight: { in: [-5, 0, 9999] } } }), 0);
});

dbTest("N13G-02: PATCH is validated too (range, type, required-null, cross-field with the stored row, empty patch)", async () => {
  const a = await call("POST", "/inbody", "tok-a", entry({ date: "2026-01-13T00:00:00.000Z" }));
  const id = a.body.id;
  for (const patch of [{ weight: -5 }, { weight: "abc" }, { weight: null }, { date: "2030-01-01T00:00:00.000Z" }, { muscleMass: 71 }, { weight: 25 }, {}, { userId: B }]) {
    const r = await call("PATCH", `/inbody/${id}`, "tok-a", patch);
    assert.equal(r.status, 400, JSON.stringify(patch) + " " + r.text);
    assert.equal(r.body.code, "INBODY_INVALID_INPUT");
  }
  const row = await prisma.inBodyEntry.findUnique({ where: { id } });
  assert.equal(row!.weight, 70, "refused patches wrote nothing");
});

dbTest("N13G-04: DELETE is owner-only (404 for others / unknown), removes the row and re-syncs the profile weight", async () => {
  const older = await call("POST", "/inbody", "tok-b", entry({ date: "2026-02-01T00:00:00.000Z", weight: 80, muscleMass: 35, bodyFat: 16 }));
  const newer = await call("POST", "/inbody", "tok-b", entry({ date: "2026-02-02T00:00:00.000Z", weight: 85, muscleMass: 36, bodyFat: 18 }));
  assert.equal(newer.status, 200, newer.text);
  assert.equal((await prisma.userProfile.findUnique({ where: { userId: B } }))!.currentWeight, 85);

  // someone else's entry and an unknown id look the same
  const other = await call("DELETE", `/inbody/${newer.body.id}`, "tok-a");
  assert.equal(other.status, 404);
  assert.equal(other.body.code, "INBODY_NOT_FOUND");
  assert.equal((await call("DELETE", `/inbody/${randomUUID()}`, "tok-b")).status, 404);
  assert.equal(await prisma.inBodyEntry.count({ where: { id: newer.body.id } }), 1, "A's attempt deleted nothing");

  const ok = await call("DELETE", `/inbody/${newer.body.id}`, "tok-b");
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body, { deleted: true, id: newer.body.id });
  assert.equal(await prisma.inBodyEntry.count({ where: { id: newer.body.id } }), 0);
  assert.equal(await prisma.inBodyEntry.count({ where: { id: older.body.id } }), 1, "the other entry is kept");
  assert.equal((await prisma.userProfile.findUnique({ where: { userId: B } }))!.currentWeight, 80, "profile weight follows the new latest entry");
  assert.equal((await call("DELETE", `/inbody/${newer.body.id}`, "tok-b")).status, 404, "second delete = 404");
});

dbTest("N13A-04: PUT /profile/me with implausible values is 400 (invalid date included, never 500)", async () => {
  const bodies: Array<Record<string, unknown>> = [
    { heightCm: 30 },
    { heightCm: 99999 },
    { currentWeight: 5 },
    { currentWeight: 700 },
    { targetWeight: 1e9 },
    { dateOfBirth: "abc" },
    { dateOfBirth: "2099-01-01" },
    { dateOfBirth: new Date().toISOString().slice(0, 10) },
    { dietaryPreference: "x".repeat(10_000) },
    { injuries: Array(100).fill("a") },
  ];
  for (const b of bodies) {
    const r = await call("PUT", "/profile/me", "tok-a", b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 60) + " " + r.text.slice(0, 120));
    assert.ok(Array.isArray(r.body.details), "zod details with the Vietnamese messages");
  }
});

dbTest("N13A-08: GET /notifications with bad paging is 400 INVALID_PAGINATION; valid paging is 200", async () => {
  for (const q of ["page=-1&limit=100000", "page=-1", "limit=100000", "page=0", "limit=0", "page=abc"]) {
    const r = await call("GET", `/notifications?${q}`, "tok-a");
    assert.equal(r.status, 400, q + " " + r.text);
    assert.equal(r.body.code, "INVALID_PAGINATION");
  }
  assert.equal((await call("GET", "/notifications?page=1&limit=20", "tok-a")).status, 200);
  assert.equal((await call("GET", "/notifications", "tok-a")).status, 200);
});

dbTest("N13A-10: PATCH /profile/me/accepting-clients - a non-PT is 403 and writes no audit row; a PT still works", async () => {
  const before = await prisma.auditLog.count({ where: { actorUserId: A } });
  const r = await call("PATCH", "/profile/me/accepting-clients", "tok-a", { isAcceptingClients: false, notAcceptingReason: "x" });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.code, "PT_ONLY");
  assert.equal(await prisma.auditLog.count({ where: { actorUserId: A } }), before, "no PT audit row for a client");
  assert.equal((await prisma.userProfile.findUnique({ where: { userId: A } }))!.isAcceptingClients, true, "profile unchanged");

  const bad = await call("PATCH", "/profile/me/accepting-clients", "tok-pt", { isAcceptingClients: "no" });
  assert.equal(bad.status, 400);
  const ok = await call("PATCH", "/profile/me/accepting-clients", "tok-pt", { isAcceptingClients: false, notAcceptingReason: "Đủ khách" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await prisma.userProfile.findUnique({ where: { userId: PT } }))!.isAcceptingClients, false);
});

dbTest("N13C-01: a PT requesting a contract on their OWN package is 400 SELF_CONTRACT_NOT_ALLOWED and creates nothing", async () => {
  const before = await prisma.contract.count({ where: { OR: [{ ptUserId: PT }, { clientUserId: PT }] } });
  const r = await call("POST", "/contracts/request", "tok-pt", { ptUserId: PT, packageId: randomUUID() });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.code, "SELF_CONTRACT_NOT_ALLOWED");
  assert.match(r.body.error, /chính mình/);
  assert.equal(await prisma.contract.count({ where: { OR: [{ ptUserId: PT }, { clientUserId: PT }] } }), before);
});
