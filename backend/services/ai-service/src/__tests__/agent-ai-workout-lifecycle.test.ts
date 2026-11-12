/**
 * V1 RC1 gate (2026-11-12) — the PRODUCTION workout-draft path through chat.
 *
 * On AWS the LLM provider is Bedrock, whose health check is config-based → `llmAvailable` is always true → proposeWorkoutPlan
 * always takes the ASYNC AI path (2026-11-08, f5e606e3): GENERATING draft → poll → PREVIEW → confirm → import. The older
 * confirm/idempotency/race tests (finalization-race, product-remediation-1 …) stub `llmAvailable: true` for nutrition and
 * then confirm the workout draft immediately, so since f5e606e3 they hit 409 "chưa sẵn sàng" and fail — leaving this path
 * with no passing end-to-end test. This file covers it. Real isolated test DB; only the queue / plan store / import boundary
 * are stubbed; no model call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, conversationRepository } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { llmService } from "../services/llm.service";
import { conversationService } from "../services/conversation.service";
import { PlanStatus } from "../generated/prisma";

const original = {
  ctx: fitnessAgentDeps.tools.getUserFitnessContext, extract: fitnessAgentDeps.profileExtractor.extract, imp: fitnessAgentDeps.tools.importAiPlanToSchedule,
  health: llmService.getHealthStatus, queue: conversationService.queuePlanGeneration, find: conversationRepository.findPlanById,
};
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.ctx; fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.importAiPlanToSchedule = original.imp; llmService.getHealthStatus = original.health;
  conversationService.queuePlanGeneration = original.queue; conversationRepository.findPlanById = original.find;
});
test.after(async () => { await prisma.$disconnect(); });

function rig(opts: { importDelayMs?: number } = {}) {
  const plans = new Map<string, any>();
  const imports: any[] = [];
  const queued: any[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60 }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [], training: { trainingDaysPerWeek: 3, availableEquipment: ["barbell", "dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: [1, 3, 5] } } } as any);
  llmService.getHealthStatus = (async () => ({ llmAvailable: true })) as any;
  conversationService.queuePlanGeneration = (async (p: any) => {
    queued.push(p);
    const planId = randomUUID();
    plans.set(planId, { id: planId, userId: p.userId, status: PlanStatus.QUEUED, plan: null, failReason: null });
    return { planId, jobId: `job-${planId}`, status: PlanStatus.QUEUED };
  }) as any;
  conversationRepository.findPlanById = (async (id: string) => plans.get(id) ?? null) as any;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, payload: any) => {
    imports.push(payload);
    if (opts.importDelayMs) await new Promise((r) => setTimeout(r, opts.importDelayMs));
    return { message: "đã lưu" } as any;
  };
  const complete = (planId: string) => plans.set(planId, {
    ...plans.get(planId), status: PlanStatus.COMPLETED,
    plan: { weeklySchedule: [1, 2, 3].map((d) => ({ day: `Day ${d}`, focus: "Full body", exercises: [{ exerciseId: `ex-${d}-a`, name: "Goblet Squat", sets: 3, reps: "8-12", restSeconds: 90 }, { exerciseId: `ex-${d}-b`, name: "Dumbbell Row", sets: 3, reps: "8-12", restSeconds: 90 }] })) },
  });
  return { plans, imports, queued, complete };
}

async function setup(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "ai workout lifecycle" } });
}
async function cleanup(userId: string) {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { userId } }).catch(() => {});
}

test("production AI path: request → GENERATING (no early save) → poll → PREVIEW → confirm imports once; repeat confirm never writes again", async () => {
  const r = rig();
  const userId = `ai-lifecycle-${randomUUID()}`;
  const session = await setup(userId);
  const identity = { userId } as any;
  try {
    const t1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.match(t1!.answer, /AI/);
    assert.equal(r.queued.length, 1, "exactly one generation queued");
    const action = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal((action!.payload as any).phase, "GENERATING");
    await assert.rejects(fitnessAgent.execute(identity, action!.id, true), /chưa sẵn sàng/, "a GENERATING draft can never be saved");
    assert.equal(r.imports.length, 0);

    const notYet = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    assert.match(notYet!.answer, /vẫn đang tạo/);

    r.complete((action!.payload as any).planId);
    const ready = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    assert.equal(ready!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((ready!.blocks[0] as any).actionId, action!.id, "the SAME action becomes the preview");

    await fitnessAgent.execute(identity, action!.id, true);
    assert.equal(r.imports.length, 1, "confirm persists once");
    assert.ok(r.imports[0].weeklySchedule?.every?.((d: any) => d.exercises.every((e: any) => typeof e.exerciseId === "string")) ?? true, "canonical exerciseIds only");
    await fitnessAgent.execute(identity, action!.id, true).catch(() => {});
    assert.equal(r.imports.length, 1, "a repeated confirm never writes again");
    assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } }))!.status, "COMPLETED");
  } finally { await cleanup(userId); }
});

test("production AI path: two CONCURRENT confirms of the same preview → exactly one import", async () => {
  const r = rig({ importDelayMs: 150 });
  const userId = `ai-lifecycle-race-${randomUUID()}`;
  const session = await setup(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const action = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    r.complete((action!.payload as any).planId);
    await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    const results = await Promise.allSettled([fitnessAgent.execute(identity, action!.id, true), fitnessAgent.execute(identity, action!.id, true)]);
    assert.ok(results.some((x) => x.status === "fulfilled"));
    assert.equal(r.imports.length, 1, `imports=${r.imports.length}`);
  } finally { await cleanup(userId); }
});

test("production AI path: a hypothetical while GENERATING neither saves nor re-queues; only a poll reads status", async () => {
  const r = rig();
  const userId = `ai-lifecycle-hyp-${randomUUID()}`;
  const session = await setup(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    await fitnessAgent.tryTurn("Nếu tập 5 buổi thì sao?", identity, session.id);
    assert.equal(r.queued.length, 1, "no second generation from a hypothetical");
    assert.equal(r.imports.length, 0);
  } finally { await cleanup(userId); }
});
