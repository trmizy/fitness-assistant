import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";

// Phase 4.4 — BACKEND INTEGRATION (isolated *_test Postgres). The user-service side is a local stand-in HTTP
// server (same pattern other fitness-service suites use via USER_SERVICE_URL); cycle/roadmap rows are real.

const dbUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(dbUrl) && process.env.NODE_ENV === "test";
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skip = { skip: !canUseIntegrationDb ? "needs isolated *_test Postgres + NODE_ENV=test" : false } as const;

const users = new Map<string, { inbody: any[]; profile: any }>();
let failUserService = false;
const server = http.createServer((req, res) => {
  const m = /^\/internal\/(inbody|profile)\/([^/?]+)/.exec(req.url ?? "");
  if (failUserService) { res.statusCode = 503; res.end("{}"); return; }
  const u = m ? users.get(decodeURIComponent(m[2])) : undefined;
  res.setHeader("content-type", "application/json");
  if (!m || !u) { res.statusCode = m?.[1] === "profile" ? 404 : 200; res.end(m?.[1] === "inbody" ? "[]" : "{}"); return; }
  res.end(JSON.stringify(m[1] === "inbody" ? u.inbody : { profile: u.profile }));
});

const createdUsers: string[] = [];
let prisma: (typeof import("../repositories/prisma"))["prisma"] | undefined;
test.before(async () => {
  if (!canUseIntegrationDb) return;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  delete process.env.USER_LAMBDA_NAME;
  prisma = (await import("../repositories/prisma")).prisma;
});
test.after(async () => {
  server.close();
  if (!prisma) return;
  for (const userId of createdUsers) {
    await prisma.trainingCycle.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.fitnessRoadmap.deleteMany({ where: { userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const row = (daysAgo: number, weight: number, extra: any = {}) => ({ id: randomUUID(), date: iso(daysAgo), weight, bodyFatPct: 20, muscleMass: 33, status: "manual", ...extra });

test("real cycle + roadmap rows, typed baseline, A/B isolation, upstream failure (real DB)", skip, async () => {
  const { getBodyGoalState } = await import("../services/body-goal-state.service");
  const A = `p44-a-${randomUUID()}`;
  const B = `p44-b-${randomUUID()}`;
  createdUsers.push(A, B);
  users.set(A, {
    inbody: [row(50, 86), row(30, 84.5), row(10, 83)],
    profile: { goal: "WEIGHT_LOSS", targetWeight: 75, currentWeight: 82, startingWeight: 87 },
  });
  users.set(B, { inbody: [], profile: { goal: "MAINTENANCE", targetWeight: null, currentWeight: null } });

  const cycle = await prisma!.trainingCycle.create({
    data: {
      userId: A, status: "ACTIVE", startDate: new Date(Date.now() - 50 * 86_400_000), endDate: new Date(Date.now() + 10 * 86_400_000),
      baselineMetrics: { source: "INBODY", weight: 86, bodyFatPct: 20, muscleMass: 33, bmr: null, measuredAt: iso(50), inbodyId: "i" },
      targetMetrics: { source: "GOAL_AT_CYCLE_START", targetWeight: 76 },
    },
  });
  const roadmap = await prisma!.fitnessRoadmap.create({
    data: {
      userId: A, name: "p44", goalType: "WEIGHT_LOSS", status: "ACTIVE", plannedStartAt: new Date(Date.now() - 50 * 86_400_000), plannedEndAt: new Date(Date.now() + 40 * 86_400_000),
      targetMetrics: { whatever: "free-form-should-not-be-read" },
      phases: { create: [{ phaseIndex: 0, name: "Cut", phaseType: "FAT_LOSS", status: "ACTIVE", plannedStartAt: new Date(Date.now() - 50 * 86_400_000), plannedEndAt: new Date(Date.now() + 10 * 86_400_000) }] },
    },
    include: { phases: true },
  });

  const a = await getBodyGoalState(A, { lookbackDays: 90 });
  assert.equal(a.body.dataQuality, "SUFFICIENT");
  assert.equal(a.body.trends.weight.direction, "DOWN");
  assert.equal(a.body.latest?.weightKg, 83);
  assert.equal(a.goal.gap.state === "AVAILABLE" && a.goal.gap.currentKg, 83, "measured InBody weight, not profile 82");
  assert.equal(a.body.profileReportedWeight?.kg, 82);
  assert.equal(a.goal.startingState.state, "AVAILABLE");
  assert.equal(a.goal.roadmap.state === "ACTIVE" && a.goal.roadmap.roadmapId, roadmap.id);
  assert.equal(a.goal.roadmap.state === "ACTIVE" && a.goal.roadmap.currentPhase?.id, roadmap.phases[0].id);
  assert.ok(!JSON.stringify(a).includes("free-form-should-not-be-read"));
  assert.equal(a.goal.trajectory.onTrack.status, "NOT_EVALUABLE");
  void cycle;

  const b = await getBodyGoalState(B, { lookbackDays: 90 });
  assert.equal(b.body.dataQuality, "NO_DATA");
  assert.deepEqual(b.goal.gap, { state: "NOT_AVAILABLE", reason: "NO_TARGET" });
  assert.equal(b.goal.roadmap.state, "NONE");
  assert.equal(b.goal.startingState.state, "NOT_AVAILABLE");
  assert.ok(!JSON.stringify(b).includes(roadmap.id));

  // upstream (user-service) failure must THROW, never become an empty body state
  failUserService = true;
  await assert.rejects(() => getBodyGoalState(A, { lookbackDays: 90 }));
  failUserService = false;
});
