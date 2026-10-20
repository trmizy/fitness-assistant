import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 4 (PT Copilot, step 1) — roster adherence: AUTHORIZATION + data correctness against the isolated fitness test DB.
 * BACKEND INTEGRATION / REAL HTTP (real Express app, real Prisma). Only the cross-service roster lookup (user-service) and the token
 * verification are stubbed, by the repo's existing convention (coachDeps / authServiceClient).
 *
 * The properties that matter: (1) a PT sees ONLY the clients of their own authoritative roster — data of an outsider and of another PT's
 * client never appears; (2) the roster comes from the verified caller, never from a request parameter; (3) an unreadable roster FAILS
 * instead of looking empty; (4) a client removed from the roster disappears at once (nothing cached); (5) every viewed client is audited.
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 90_000 };

const RUN = randomUUID().slice(0, 8);
const id = (n: string) => `roster-${RUN}-${n}`;
const PT_A = id("pt-a"), PT_B = id("pt-b");
const C = { risk: id("c-risk"), good: id("c-good"), empty: id("c-empty"), nolog: id("c-nolog"), other: id("c-of-b"), outsider: id("outsider") };
const rosters: Record<string, string[] | "DOWN"> = { [PT_A]: [C.risk, C.good, C.empty, C.nolog], [PT_B]: [C.other] };

let prisma: (typeof import("../repositories/prisma"))["prisma"];
let coach: typeof import("../services/coach.service");
let server: import("node:http").Server | undefined;
let base = "";
const dayOffset = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedSchedules(userId: string, statuses: string[]) {
  let i = 1;
  for (const status of statuses) {
    const date = dayOffset(i++); date.setUTCHours(6, 0, 0, 0);
    await prisma.workoutSchedule.create({ data: { userId, date, status, ...(status === "COMPLETED" ? { completedAt: date } : {}) } });
  }
}
async function seedNutritionProgram(userId: string, meals: Array<{ status: string; daysAgo: number }> = []) {
  const program = await prisma.nutritionProgram.create({ data: { userId, name: "p", status: "ACTIVE", sourceType: "MANUAL" } });
  const day = await prisma.nutritionProgramDay.create({ data: { programId: program.id, dayNumber: 1, title: "d" } });
  let n = 0;
  for (const m of meals) {
    const meal = await prisma.nutritionProgramMeal.create({ data: { dayId: day.id, mealType: `M${n++}`, title: "meal" } });
    const logDate = new Date(Date.UTC(dayOffset(m.daysAgo).getUTCFullYear(), dayOffset(m.daysAgo).getUTCMonth(), dayOffset(m.daysAgo).getUTCDate()));
    await prisma.nutritionMealCompletion.create({ data: { userId, mealId: meal.id, logDate, status: m.status, ...(m.status === "COMPLETED" ? { completedAt: new Date() } : {}) } });
  }
}

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  coach = await import("../services/coach.service");
  coach.coachDeps.fetchActiveClientIdsStrict = async (pt: string) => { const r = rosters[pt]; if (r === "DOWN") throw new Error("user-service down"); return r ?? []; };
  // C.risk: 1 of 5 sessions completed -> AT_RISK; C.good: 5/5; C.empty: nothing; C.nolog: good workouts but a program with no logs; outsider: also at risk
  await seedSchedules(C.risk, ["COMPLETED", "SKIPPED", "SKIPPED", "NOT_STARTED", "SKIPPED"]);
  await seedSchedules(C.good, ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
  await seedNutritionProgram(C.good, [{ status: "COMPLETED", daysAgo: 1 }, { status: "COMPLETED", daysAgo: 2 }, { status: "PARTIAL", daysAgo: 3 }]);
  await seedSchedules(C.nolog, ["COMPLETED", "COMPLETED", "COMPLETED"]);
  await seedNutritionProgram(C.nolog);
  await seedSchedules(C.other, ["SKIPPED", "SKIPPED", "SKIPPED"]);
  await seedSchedules(C.outsider, ["SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"]);
});

async function startServer() {
  if (server) return;
  const { authServiceClient } = await import("../clients/auth-service.client");
  (authServiceClient as any).verifyToken = async (header: string) => {
    const token = header.replace("Bearer ", "");
    const map: Record<string, string> = { "pt-a": PT_A, "pt-b": PT_B };
    if (!map[token]) throw new Error("bad token");
    return { user: { id: map[token], email: "", role: "PT" } };
  };
  const app = (await import("../app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); }
  if (!canUseIntegrationDb) return;
  const users = Object.values(C);
  await prisma.nutritionMealCompletion.deleteMany({ where: { userId: { in: users } } });
  await prisma.nutritionProgram.deleteMany({ where: { userId: { in: users } } });
  await prisma.workoutSchedule.deleteMany({ where: { userId: { in: users } } });
  await prisma.coachClientActionAudit.deleteMany({ where: { ptUserId: { in: [PT_A, PT_B] } } });
  await prisma.$disconnect();
});

test("service: a PT sees exactly their own roster — correct statuses, evidence, data gaps, sorted by need; nobody else's data", skipOpts, async () => {
  const r = await coach.coachService.getRosterAdherence(PT_A, 14);
  assert.deepEqual(r.clients.map((c) => c.clientUserId).sort(), [C.risk, C.good, C.empty, C.nolog].sort());
  assert.ok(!r.clients.some((c) => [C.other, C.outsider].includes(c.clientUserId)), "another PT's client and an outsider never appear");
  const by = new Map(r.clients.map((c) => [c.clientUserId, c]));
  const risk = by.get(C.risk)!;
  assert.equal(risk.status, "AT_RISK");
  assert.equal(risk.workout.scheduled, 5);
  assert.equal(risk.workout.completed, 1);
  assert.equal(risk.workout.adherencePercent, 20);
  assert.match(risk.signals[0].evidence, /1\/5 buổi/);
  const good = by.get(C.good)!;
  assert.equal(good.status, "ON_TRACK");
  assert.equal(good.workout.adherencePercent, 100);
  assert.equal(good.nutrition.loggedMeals, 3);
  assert.equal(good.nutrition.logDays, 3);
  const empty = by.get(C.empty)!;
  assert.equal(empty.status, "NO_DATA");
  assert.equal(empty.workout.adherencePercent, null);
  assert.deepEqual(empty.dataGaps, ["NO_SCHEDULED_SESSIONS", "NO_ACTIVE_NUTRITION_PROGRAM"]);
  const nolog = by.get(C.nolog)!;
  assert.equal(nolog.status, "NEEDS_ATTENTION");
  assert.deepEqual(nolog.signals.map((s) => s.code), ["NUTRITION_NOT_LOGGED"]);
  assert.deepEqual(nolog.dataGaps, ["NO_NUTRITION_LOGS"]);
  assert.deepEqual(r.clients.map((c) => c.clientUserId), [C.risk, C.nolog, C.empty, C.good], "AT_RISK, NEEDS_ATTENTION, NO_DATA, ON_TRACK");
  assert.deepEqual(r.summary, { totalClients: 4, AT_RISK: 1, NEEDS_ATTENTION: 1, ON_TRACK: 1, NO_DATA: 1 });
  assert.equal(r.window.days, 14);
});

test("service: the other PT gets only their own client; the first PT's data never leaks across", skipOpts, async () => {
  const r = await coach.coachService.getRosterAdherence(PT_B, 14);
  assert.deepEqual(r.clients.map((c) => c.clientUserId), [C.other]);
  assert.equal(r.clients[0].status, "AT_RISK");
  assert.equal((await coach.coachService.getRosterAdherence(id("nobody"), 14)).clients.length, 0, "no roster, no data (not an error)");
});

test("service: an unreadable roster FAILS with 503 — it never looks like an empty roster, and nothing is audited", skipOpts, async () => {
  const before = await prisma.coachClientActionAudit.count({ where: { ptUserId: PT_A } });
  rosters[PT_A] = "DOWN";
  try {
    await assert.rejects(() => coach.coachService.getRosterAdherence(PT_A, 14), (e: any) => e.status === 503);
  } finally { rosters[PT_A] = [C.risk, C.good, C.empty, C.nolog]; }
  assert.equal(await prisma.coachClientActionAudit.count({ where: { ptUserId: PT_A } }), before);
});

test("service: a client removed from the roster (contract ended) disappears on the very next call — nothing is cached", skipOpts, async () => {
  rosters[PT_A] = [C.good, C.empty];
  try {
    const r = await coach.coachService.getRosterAdherence(PT_A, 14);
    assert.deepEqual(r.clients.map((c) => c.clientUserId).sort(), [C.good, C.empty].sort());
  } finally { rosters[PT_A] = [C.risk, C.good, C.empty, C.nolog]; }
});

test("service: one audit row per viewed client (VIEW_ROSTER_ADHERENCE) bound to the verified PT", skipOpts, async () => {
  await prisma.coachClientActionAudit.deleteMany({ where: { ptUserId: PT_A } });
  await coach.coachService.getRosterAdherence(PT_A, 28);
  const rows = await prisma.coachClientActionAudit.findMany({ where: { ptUserId: PT_A, action: "VIEW_ROSTER_ADHERENCE" } });
  assert.deepEqual(rows.map((x) => x.clientUserId).sort(), [C.risk, C.good, C.empty, C.nolog].sort());
  assert.equal((rows[0].metadata as any).windowDays, 28);
});

test("HTTP: the roster is the TOKEN's — ?ptUserId / ?clientUserIds / ?clientId are ignored; invalid windows are 400; no token is 401", skipOpts, async () => {
  await startServer();
  const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await get("/coach/clients/adherence")).status, 401);
  assert.equal((await get("/coach/clients/adherence", "bad")).status, 401);
  const a: any = await (await get("/coach/clients/adherence?windowDays=14", "pt-a")).json();
  assert.equal(a.success, true);
  assert.equal(a.data.clients.length, 4);
  const b: any = await (await get(`/coach/clients/adherence?windowDays=14&ptUserId=${PT_A}&clientUserIds=${C.risk},${C.good}&clientId=${C.risk}`, "pt-b")).json();
  assert.deepEqual(b.data.clients.map((c: any) => c.clientUserId), [C.other], "PT B cannot reach PT A's clients through any parameter");
  assert.equal((await get("/coach/clients/adherence?windowDays=3", "pt-a")).status, 400);
  assert.equal((await get("/coach/clients/adherence?windowDays=abc", "pt-a")).status, 400);
  rosters[PT_B] = "DOWN";
  try { assert.equal((await get("/coach/clients/adherence", "pt-b")).status, 503); } finally { rosters[PT_B] = [C.other]; }
});

test("HTTP: the per-client routes are untouched — /coach/clients/adherence does not shadow /coach/clients/:clientId/summary", skipOpts, async () => {
  await startServer();
  const r = await fetch(`${base}/coach/clients/${C.risk}/summary`, { headers: { authorization: "Bearer pt-a" } });
  assert.notEqual(r.status, 404, "the summary route still exists");
  assert.equal(r.status, 403, "and still enforces the per-client active relationship (the real check is not stubbed here)");
});
