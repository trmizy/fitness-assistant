/**
 * Phase 3 (AI plan) / audit BDG-19 — a CREATE_PLAN_BUNDLE confirm that only PARTLY succeeded used to be recorded as COMPLETED (no
 * retry of the missing parts), and re-creating everything would accept a second roadmap. Now each step's progress is stored on the action
 * and a re-confirm runs ONLY what is not done. Real DB (ai test DB) + real fitnessAgent.execute; the business calls are stubbed and counted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

const tools = fitnessAgentDeps.tools as any;
const saved = { accept: tools.acceptRoadmapDraft, activate: tools.activateRoadmap, apply: tools.applyTrainingPlan, boot: tools.bootstrapNutrition };
test.afterEach(() => { tools.acceptRoadmapDraft = saved.accept; tools.activateRoadmap = saved.activate; tools.applyTrainingPlan = saved.apply; tools.bootstrapNutrition = saved.boot; });
test.after(async () => { if (canUseDb) { await prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "bundle-" } } }); await prisma.chatSession.deleteMany({ where: { userId: { startsWith: "bundle-" } } }); await prisma.$disconnect(); } });

type Behaviour = { activateFails?: number; applyFails?: number; nutritionFails?: number; nutritionInsufficient?: number };
async function rig(withWorkout = true, b: Behaviour = {}) {
  const userId = `bundle-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "bundle" } });
  const calls = { accept: 0, activate: 0, apply: 0, boot: 0 };
  const left = { ...b };
  tools.acceptRoadmapDraft = async () => { calls.accept++; return { roadmap: { id: `roadmap-${calls.accept}` } }; };
  tools.activateRoadmap = async () => { calls.activate++; if (left.activateFails) { left.activateFails--; throw new Error("activate blew up"); } return {}; };
  tools.applyTrainingPlan = async () => { calls.apply++; if (left.applyFails) { left.applyFails--; throw new Error("apply blew up"); } return {}; };
  tools.bootstrapNutrition = async () => {
    calls.boot++;
    if (left.nutritionFails) { left.nutritionFails--; throw new Error("nutrition blew up"); }
    if (left.nutritionInsufficient) { left.nutritionInsufficient--; return { data: { status: "insufficient_data", missingFields: ["activityLevel"] } }; }
    return { data: { status: "CREATED" } };
  };
  const payload = {
    roadmapDraft: { goalType: "WEIGHT_LOSS", plannedStartAt: new Date().toISOString(), phases: [], summary: "s", reasoningSummary: "r", confidence: 0.8, warnings: [], assumptions: [] },
    workoutCandidate: withWorkout ? { id: "prog-1", fingerprint: "fp", name: "P" } : null,
    preferences: {}, timeframe: { source: "DEFAULT", weeks: 16 },
  };
  const action = await prisma.fitnessAgentAction.create({ data: { userId, sessionId: session.id, kind: "CREATE_PLAN_BUNDLE", risk: "MEDIUM", payload: payload as any, status: "PENDING", expiresAt: new Date(Date.now() + 15 * 60000) } });
  const identity = { userId } as any;
  const run = () => fitnessAgent.execute(identity, action.id, true) as Promise<any>;
  const row = () => prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: action.id } });
  return { calls, run, row };
}

test("all three steps succeed -> COMPLETED, each business call exactly once", dbOpts, async () => {
  const r = await rig();
  const out = await r.run();
  assert.match(out.message, /Đã tạo và kích hoạt/);
  assert.deepEqual(r.calls, { accept: 1, activate: 1, apply: 1, boot: 1 });
  assert.equal((await r.row()).status, "COMPLETED");
});

test("nutrition fails after roadmap+workout succeeded -> truthful partial result, action stays PENDING with progress; re-confirm retries ONLY nutrition", dbOpts, async () => {
  const r = await rig(true, { nutritionFails: 1 });
  const first = await r.run();
  assert.match(first.message, /chưa tạo được/);
  assert.match(first.message, /thử lại CHỈ các phần chưa tạo/);
  assert.deepEqual(first.steps.map((s: string) => s.slice(0, 1)), ["✅", "✅", "❌"]);
  const mid = await r.row();
  assert.equal(mid.status, "PENDING", "not recorded as COMPLETED while something retryable is missing");
  assert.deepEqual((mid.payload as any).bundleProgress, { roadmapId: "roadmap-1", roadmapActive: true, workoutDone: true });
  const second = await r.run();
  assert.match(second.message, /Đã tạo và kích hoạt/);
  assert.deepEqual(r.calls, { accept: 1, activate: 1, apply: 1, boot: 2 }, "the roadmap was NOT accepted twice, the workout NOT applied twice");
  assert.equal((await r.row()).status, "COMPLETED");
  assert.ok(second.steps[0].includes("đã tạo từ lần trước"));
});

test("activation fails after the roadmap was accepted -> retry only ACTIVATES the stored roadmap (no second accept)", dbOpts, async () => {
  const r = await rig(true, { activateFails: 1 });
  const first = await r.run();
  assert.deepEqual(first.steps.map((s: string) => s.slice(0, 1)), ["❌", "✅", "✅"]);
  assert.equal(((await r.row()).payload as any).bundleProgress.roadmapId, "roadmap-1");
  assert.equal(((await r.row()).payload as any).bundleProgress.roadmapActive, undefined);
  await r.run();
  assert.deepEqual(r.calls, { accept: 1, activate: 2, apply: 1, boot: 1 });
  assert.equal((await r.row()).status, "COMPLETED");
});

test("workout apply fails transiently -> retry applies the workout only", dbOpts, async () => {
  const r = await rig(true, { applyFails: 1 });
  await r.run();
  await r.run();
  assert.deepEqual(r.calls, { accept: 1, activate: 1, apply: 2, boot: 1 });
});

test("profile data missing for nutrition (insufficient_data) is retryable after the user fixes the profile", dbOpts, async () => {
  const r = await rig(true, { nutritionInsufficient: 1 });
  const first = await r.run();
  assert.match(first.steps[2], /thiếu dữ liệu hồ sơ \(activityLevel\)/);
  assert.equal((await r.row()).status, "PENDING");
  await r.run();
  assert.deepEqual(r.calls, { accept: 1, activate: 1, apply: 1, boot: 2 });
  assert.equal((await r.row()).status, "COMPLETED");
});

test("a PERMANENT failure (no matching workout program) does not keep the action open forever: COMPLETED, reported ❌", dbOpts, async () => {
  const r = await rig(false);
  const out = await r.run();
  assert.deepEqual(out.steps.map((s: string) => s.slice(0, 1)), ["✅", "❌", "✅"]);
  assert.match(out.steps[1], /Không có chương trình tập phù hợp/);
  assert.match(out.message, /Một số phần chưa tạo được/);
  assert.doesNotMatch(out.message, /Xác nhận lại/, "no retry promise for a failure a retry cannot fix");
  assert.equal((await r.row()).status, "COMPLETED");
});

test("a permanent failure PLUS a transient one: the transient part stays retryable, the permanent one is not re-attempted into a loop", dbOpts, async () => {
  const r = await rig(false, { nutritionFails: 1 });
  const first = await r.run();
  assert.equal((await r.row()).status, "PENDING");
  assert.match(first.message, /thử lại CHỈ các phần chưa tạo/);
  const second = await r.run();
  assert.equal((await r.row()).status, "COMPLETED");
  assert.deepEqual(r.calls, { accept: 1, activate: 1, apply: 0, boot: 2 });
  assert.deepEqual(second.steps.map((s: string) => s.slice(0, 1)), ["✅", "❌", "✅"]);
});

test("two concurrent confirms of the same partially-done action never double-create (atomic EXECUTING claim kept)", dbOpts, async () => {
  const r = await rig(true, { nutritionFails: 1 });
  await r.run();
  const results = await Promise.allSettled([r.run(), r.run(), r.run()]);
  assert.ok(results.some((x) => x.status === "fulfilled"));
  assert.ok(r.calls.accept === 1 && r.calls.apply === 1, JSON.stringify(r.calls));
  assert.ok(r.calls.boot <= 3 && r.calls.boot >= 2);
  assert.equal((await r.row()).status, "COMPLETED");
});
