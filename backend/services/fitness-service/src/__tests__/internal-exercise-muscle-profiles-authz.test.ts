import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

/**
 * POST /internal/exercises/muscle-profiles — authorization at the fitness-service boundary (V2 Gate 2, 2026-11-12).
 * Offline: the REAL router + REAL internalAuthMiddleware + REAL controller over HTTP on 127.0.0.1, with the Exercise table
 * replaced by an in-memory stand-in that evaluates the exact `where` the controller sends (no database, no network).
 * The DB-backed version of these checks is internal-exercise-muscle-profiles.integration.test.ts (needs a *_test DB).
 */
process.env.FITNESS_DISABLE_REDIS = "true";
process.env.INTERNAL_SERVICE_SECRET = "muscle-authz-unit-secret";
process.env.NODE_ENV = "test";

import express from "express";
import { prisma } from "../repositories/prisma";

const ME = "user-me";
const OTHER = "user-other";
type Row = { id: string; exerciseName: string; bodyPart: string; muscleGroupsActivated: string[]; source: string; ownerId: string | null; status: string; archivedAt: Date | null };
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, exerciseName: `name-${id}`, bodyPart: "LOWER_BODY", muscleGroupsActivated: ["quadriceps"], source: "SYSTEM", ownerId: null, status: "PUBLISHED", archivedAt: null, ...over,
});
const ROWS: Row[] = [
  row("sys-pub"),
  row("sys-pub-2", { bodyPart: "UPPER_BODY", muscleGroupsActivated: ["chest"] }),
  row("sys-staging", { status: "STAGING" }),
  row("sys-review", { status: "REVIEW_REQUIRED" }),
  row("sys-approved", { status: "APPROVED" }),
  row("sys-deprecated", { status: "DEPRECATED" }),
  row("sys-rejected", { status: "REJECTED" }),
  row("sys-archived", { archivedAt: new Date("2026-10-01") }),
  row("my-custom", { source: "USER_CUSTOM", ownerId: ME, exerciseName: "My Hip Thrust" }),
  row("my-custom-archived", { source: "USER_CUSTOM", ownerId: ME, archivedAt: new Date("2026-10-01") }),
  row("other-custom", { source: "USER_CUSTOM", ownerId: OTHER, exerciseName: "Secret Custom Of Other" }),
  row("ownerless-custom", { source: "USER_CUSTOM", ownerId: null }),
];

// ── in-memory Exercise.findMany honouring the operators the controller uses (equality, null, { in }, OR, AND-by-keys) ──
function matches(r: Record<string, unknown>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as any[]).some((c) => matches(r, c));
    if (k === "AND") return (cond as any[]).every((c) => matches(r, c));
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return (cond.in as unknown[]).includes(r[k]);
      if ("equals" in cond) return r[k] === cond.equals;
      throw new Error(`unsupported operator on ${k}: ${JSON.stringify(cond)}`);
    }
    return r[k] === cond;
  });
}
const calls: Array<{ where: any; select: any }> = [];
let mode: "honest" | "ignores-where" | "throws" = "honest";
const fakeExercise = {
  async findMany(args: { where: any; select: any }) {
    calls.push(args);
    if (mode === "throws") throw new Error("connection to db failed while reading other-custom for user-other");
    const hits = mode === "ignores-where" ? ROWS : ROWS.filter((r) => matches(r as any, args.where));
    return hits.map((r) => Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, (r as any)[k]])));
  },
};
Object.defineProperty(prisma, "exercise", { value: fakeExercise, configurable: true, writable: true });

let base = "";
let server: import("node:http").Server | undefined;
async function start() {
  if (server) return;
  const internalRoutes = (await import("../routes/internal.routes")).default;
  const app = express();
  app.use(express.json());
  app.use("/internal", internalRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
test.after(async () => { if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); } });

const H = (userId?: string, token: string | null = process.env.INTERNAL_SERVICE_SECRET!) => ({
  ...(token !== null ? { "x-internal-token": token } : {}), ...(userId !== undefined ? { "x-user-id": userId } : {}),
});
async function call(body: unknown, headers: Record<string, string> = H(ME)) {
  await start();
  const res = await fetch(`${base}/internal/exercises/muscle-profiles`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}
const idsOf = (b: any) => (b?.data?.exercises ?? []).map((e: any) => e.id).sort();

test("authz-1 public exercise (SYSTEM + PUBLISHED) is returned with the unchanged contract shape", async () => {
  mode = "honest";
  const r = await call({ exerciseIds: ["sys-pub"] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, data: { exercises: [{ id: "sys-pub", name: "name-sys-pub", bodyPart: "LOWER_BODY", muscleGroups: ["quadriceps"] }] } });
});

test("authz-2 the caller's OWN private (USER_CUSTOM) exercise is returned", async () => {
  const r = await call({ exerciseIds: ["my-custom"] });
  assert.deepEqual(idsOf(r.body), ["my-custom"]); assert.equal(r.body.data.exercises[0].name, "My Hip Thrust");
});

test("authz-3 another user's private exercise is NOT returned, and the answer is identical to a non-existent id", async () => {
  const forbidden = await call({ exerciseIds: ["other-custom"] });
  const missing = await call({ exerciseIds: ["does-not-exist"] });
  assert.equal(forbidden.status, 200); assert.equal(forbidden.text, missing.text, "indistinguishable from 'does not exist'");
  assert.deepEqual(forbidden.body, { success: true, data: { exercises: [] } });
  // the OWNER still sees it — the rule is per caller, not a global hide
  assert.deepEqual(idsOf((await call({ exerciseIds: ["other-custom"] }, H(OTHER))).body), ["other-custom"]);
  // an owner-less USER_CUSTOM row is nobody's
  assert.deepEqual(idsOf((await call({ exerciseIds: ["ownerless-custom"] })).body), []);
});

test("authz-4 no authenticated context → 401 and the catalog is never queried", async () => {
  calls.length = 0;
  assert.equal((await call({ exerciseIds: ["sys-pub"] }, H(undefined))).status, 401, "no x-user-id");
  assert.equal((await call({ exerciseIds: ["sys-pub"] }, H("   "))).status, 401, "blank x-user-id");
  assert.equal((await call({ exerciseIds: ["sys-pub"] }, H(ME, null))).status, 401, "no internal token");
  assert.equal((await call({ exerciseIds: ["sys-pub"] }, H(ME, "wrong"))).status, 401, "wrong internal token");
  assert.equal(calls.length, 0);
  // the controller itself also fails closed if it is ever mounted without the middleware
  const { internalController } = await import("../controllers/internal.controller");
  let status = 0; let payload: any;
  const res: any = { status(c: number) { status = c; return this; }, json(p: unknown) { payload = p; return this; } };
  await internalController.exerciseMuscleProfiles({ body: { exerciseIds: ["sys-pub"] }, headers: {} } as any, res);
  assert.equal(status, 401); assert.equal(payload.success, false); assert.equal(calls.length, 0);
});

test("authz-5 a non-existent id is simply absent (200, no error)", async () => {
  const r = await call({ exerciseIds: ["does-not-exist", "00000000-0000-0000-0000-000000000000"] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.exercises, []);
});

test("authz-6 hidden / disabled exercises (STAGING, REVIEW_REQUIRED, APPROVED, DEPRECATED, REJECTED, archived) are not returned", async () => {
  const hidden = ["sys-staging", "sys-review", "sys-approved", "sys-deprecated", "sys-rejected", "sys-archived", "my-custom-archived"];
  for (const id of hidden) assert.deepEqual(idsOf((await call({ exerciseIds: [id] })).body), [], id);
});

test("authz-7 mixed batch → only the exercises this caller may see; never an error, never a partial row", async () => {
  const r = await call({ exerciseIds: ["sys-pub", "other-custom", "my-custom", "sys-staging", "does-not-exist", "sys-archived", "sys-pub-2", "sys-pub"] });
  assert.equal(r.status, 200);
  assert.deepEqual(idsOf(r.body), ["my-custom", "sys-pub", "sys-pub-2"]);
  for (const e of r.body.data.exercises) assert.deepEqual(Object.keys(e).sort(), ["bodyPart", "id", "muscleGroups", "name"]);
});

test("authz-8 no leakage: nothing about forbidden rows in bodies, errors carry no ids/details, identity in the body is ignored", async () => {
  // a body-supplied owner/user id never widens access (identity = x-user-id from the trusted internal caller only)
  const spoof = await call({ exerciseIds: ["other-custom"], ownerId: OTHER, userId: OTHER });
  assert.deepEqual(spoof.body.data.exercises, []);
  const mixed = await call({ exerciseIds: ["other-custom", "sys-pub"] });
  for (const s of ["other-custom", "Secret Custom", OTHER, "USER_CUSTOM", "ownerId", "status", "archivedAt", "source"]) assert.ok(!mixed.text.includes(s), s);
  // a DB failure answers with a generic message only
  mode = "throws";
  try {
    const failed = await call({ exerciseIds: ["other-custom"] });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { success: false, error: "Failed to load exercise muscle profiles" });
  } finally { mode = "honest"; }
  // validation errors do not echo the input
  const bad = await call({ exerciseIds: ["x".repeat(65)] });
  assert.equal(bad.status, 400); assert.ok(!bad.text.includes("xxxxx"));
});

test("authz-9 the query carries the visibility rule, and the rows are re-checked (a query that ignored it still cannot leak)", async () => {
  calls.length = 0;
  await call({ exerciseIds: ["sys-pub"] });
  assert.deepEqual(calls[0].where, {
    id: { in: ["sys-pub"] }, archivedAt: null,
    OR: [{ status: "PUBLISHED", source: "SYSTEM" }, { source: "USER_CUSTOM", ownerId: ME }],
  });
  mode = "ignores-where";
  try {
    const r = await call({ exerciseIds: ["sys-pub"] });
    assert.deepEqual(idsOf(r.body), ["my-custom", "sys-pub", "sys-pub-2"], "only visible rows survive the in-code re-check");
  } finally { mode = "honest"; }
});

test("authz-10 V1 consumer compatibility: valid (public + own) ids give the same result as before; input validation unchanged", async () => {
  // ai.worker.ts (adjust pool) and fitness-agent-tools.getExerciseMuscleProfiles send { exerciseIds } with x-user-id = the plan owner
  const r = await call({ exerciseIds: ["sys-pub", "sys-pub-2", "my-custom"] });
  assert.deepEqual(r.body.data.exercises.map((e: any) => [e.id, e.name, e.bodyPart, e.muscleGroups]).sort(), [
    ["my-custom", "My Hip Thrust", "LOWER_BODY", ["quadriceps"]],
    ["sys-pub", "name-sys-pub", "LOWER_BODY", ["quadriceps"]],
    ["sys-pub-2", "name-sys-pub-2", "UPPER_BODY", ["chest"]],
  ]);
  for (const bad of [{}, { exerciseIds: [] }, { exerciseIds: "abc" }, { exerciseIds: [1, 2] }, { exerciseIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) }, { exerciseIds: ["x".repeat(65)] }]) {
    assert.equal((await call(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
});
