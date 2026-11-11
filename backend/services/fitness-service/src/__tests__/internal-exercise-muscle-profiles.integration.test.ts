import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

/**
 * Phase 2 (AI plan) — POST /internal/exercises/muscle-profiles: canonical muscle data of real Exercise rows for the AI draft
 * revision "bỏ bài tập chân". REAL HTTP/API against the real Express app + isolated fitness test DB (skipped, not failed, when none).
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.INTERNAL_SERVICE_SECRET = "muscle-profiles-test-secret";
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 60_000 };

let server: import("node:http").Server | undefined;
let base = "";
async function start() {
  if (server) return;
  const app = (await import("../app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const call = (body: unknown, headers: Record<string, string> = { "x-internal-token": process.env.INTERNAL_SERVICE_SECRET!, "x-user-id": "muscle-probe" }) =>
  fetch(`${base}/internal/exercises/muscle-profiles`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); }
  if (canUseIntegrationDb) { const { prisma } = await import("../repositories/prisma"); await prisma.$disconnect(); }
});

test("muscle-profiles: returns the catalog's own bodyPart and muscle groups for real exercise ids; unknown ids are simply absent", skipOpts, async () => {
  await start();
  const { prisma } = await import("../repositories/prisma");
  const [squat, bench] = await Promise.all([
    prisma.exercise.findFirst({ where: { bodyPart: "LOWER_BODY", muscleGroupsActivated: { has: "quadriceps" } }, select: { id: true, exerciseName: true, bodyPart: true, muscleGroupsActivated: true } }),
    prisma.exercise.findFirst({ where: { bodyPart: "UPPER_BODY", muscleGroupsActivated: { has: "chest" } }, select: { id: true, exerciseName: true, bodyPart: true, muscleGroupsActivated: true } }),
  ]);
  assert.ok(squat && bench, "the test catalog has leg and chest exercises");
  const res = await call({ exerciseIds: [squat!.id, bench!.id, "00000000-0000-0000-0000-000000000000", squat!.id] });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.success, true);
  const byId = new Map<string, any>(body.data.exercises.map((e: any) => [e.id, e]));
  assert.equal(byId.size, 2, "unknown id absent, duplicates collapsed");
  assert.equal(byId.get(squat!.id).bodyPart, "LOWER_BODY");
  assert.deepEqual(byId.get(squat!.id).muscleGroups, squat!.muscleGroupsActivated);
  assert.equal(byId.get(squat!.id).name, squat!.exerciseName);
  assert.ok(byId.get(bench!.id).muscleGroups.includes("chest"));
});

test("muscle-profiles: refuses callers without the internal token and malformed/oversized input", skipOpts, async () => {
  await start();
  assert.equal((await call({ exerciseIds: ["x"] }, { "x-user-id": "u" })).status, 401, "no internal token");
  assert.equal((await call({ exerciseIds: ["x"] }, { "x-internal-token": "wrong", "x-user-id": "u" })).status, 401, "wrong internal token");
  for (const bad of [{}, { exerciseIds: [] }, { exerciseIds: "abc" }, { exerciseIds: [1, 2] }, { exerciseIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) }, { exerciseIds: ["x".repeat(65)] }]) {
    assert.equal((await call(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
});
