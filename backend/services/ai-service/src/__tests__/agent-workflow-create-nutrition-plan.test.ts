/**
 * CREATE_NUTRITION_PLAN — standalone "tạo kế hoạch dinh dưỡng cho tôi"
 * workflow (docs/standalone-nutrition-workflow-design.md). Exercises the
 * REAL chain against a real DB (same convention as
 * agent-workflow-create-workout-plan.test.ts), stubbing only:
 *   - conversationService.queueNutritionPlanGeneration (the real BullMQ
 *     enqueue call — stubbed so tests don't need a running worker/Ollama)
 *   - conversationRepository.findNutritionPlanById (simulates the async
 *     job completing between chat turns)
 *   - llmService.getHealthStatus
 *   - fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan (the real
 *     fitness-service persistence boundary)
 *
 *   fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng giảm mỡ cho tôi")
 *     -> mealsPerDay missing -> WORKFLOW_MISSING_DATA
 *   fitnessAgent.tryTurn("4 bữa")
 *     -> workflow completes -> queues generation -> "đang tính toán..."
 *   fitnessAgent.tryTurn("xong chưa")
 *     -> polls the (still-simulated-COMPLETED) plan -> NUTRITION_PLAN_PREVIEW
 *   fitnessAgent.tryTurn("Tôi không ăn cá, đổi giúp tôi")
 *     -> re-queues with the restriction genuinely included, back to GENERATING
 *   fitnessAgent.execute(actionId, true)
 *     -> saveNutritionPlanFromAiPlan called exactly once
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, PlanStatus } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { conversationService } from "../services/conversation.service";
import { conversationRepository } from "../repositories/conversation.repository";
import { llmService } from "../services/llm.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  extract: fitnessAgentDeps.profileExtractor.extract,
  saveNutritionPlanFromAiPlan: fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan,
  getNutritionTargetPreview: fitnessAgentDeps.tools.getNutritionTargetPreview,
  queueNutritionPlanGeneration: conversationService.queueNutritionPlanGeneration,
  findNutritionPlanById: conversationRepository.findNutritionPlanById,
  getHealthStatus: llmService.getHealthStatus,
};

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = original.saveNutritionPlanFromAiPlan;
  fitnessAgentDeps.tools.getNutritionTargetPreview = original.getNutritionTargetPreview;
  conversationService.queueNutritionPlanGeneration = original.queueNutritionPlanGeneration;
  conversationRepository.findNutritionPlanById = original.findNutritionPlanById;
  llmService.getHealthStatus = original.getHealthStatus;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Create nutrition plan workflow test" } });
}

function nutritionPlanContentFixture(overrides: { restrictions?: string[]; mealsPerDay?: number } = {}) {
  const mealsPerDay = overrides.mealsPerDay ?? 4;
  return {
    goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay, dailyCaloriesTarget: 1800,
    proteinTargetGrams: 150, carbTargetGrams: 160, fatTargetGrams: 55,
    weeklySchedule: Array.from({ length: 7 }, (_, i) => ({
      dayNumber: i + 1, title: `Ngày ${i + 1}`, totalCalories: 1800, protein: 150, carbs: 160, fat: 55,
      meals: [{
        mealType: "BREAKFAST", title: "Bữa sáng", calories: 400, protein: 30, carbs: 40, fat: 10,
        items: [{ foodId: "food-1", name: overrides.restrictions?.length ? "Ức gà" : "Cá hồi", quantity: 150, unit: "g", calories: 300, protein: 30, carbs: 0, fat: 10 }],
      }],
    })),
  };
}

/** Shared fixture rig. `plans` is a mutable Map<planId, plan-row> so the
 * stubbed queue/find functions behave like a REAL async job pipeline:
 * queueNutritionPlanGeneration creates a QUEUED row; the test itself
 * flips a plan to COMPLETED (simulating the worker) before the next
 * tryTurn poll — never silently pre-completing, so the GENERATING phase
 * is genuinely exercised. */
function stubNutritionFixtures() {
  const plans = new Map<string, any>();
  const calls = { queue: [] as any[], save: [] as any[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { goal: "WEIGHT_LOSS", days: [1, 2, 3], sessionMinutes: 60 },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: "WEIGHT_LOSS", age: 28, heightCm: 170, currentWeightKg: 75, gender: "FEMALE",
      experienceLevel: "INTERMEDIATE", activityLevel: "MODERATE",
      training: { trainingDaysPerWeek: 3, availableEquipment: [], injuries: [], preferredTrainingDays: [1, 2, 3] },
    },
  } as any);
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: "ACTIVE_GOAL", goalId: "goal-1", calories: 1800, protein: 150, carbs: 160, fat: 55 } as any);
  conversationService.queueNutritionPlanGeneration = async (params: any) => {
    calls.queue.push(params);
    const planId = randomUUID();
    plans.set(planId, {
      id: planId, userId: params.userId, name: `Ke hoach - ${params.goal}`, goal: params.goal,
      durationWeeks: 1, mealsPerDay: params.mealsPerDay, plan: {}, status: PlanStatus.QUEUED,
      jobId: `job-${planId}`, failReason: null, archivedAt: null,
    });
    return { planId, jobId: `job-${planId}`, status: PlanStatus.QUEUED };
  };
  conversationRepository.findNutritionPlanById = (async (planId: string) => plans.get(planId) ?? null) as any;
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = async (_identity: any, payload: any) => {
    calls.save.push(payload);
    return { message: "đã lưu" } as any;
  };
  return { plans, calls };
}

test("CREATE_NUTRITION_PLAN golden flow (real DB): asks only for mealsPerDay, queues real generation, polls to a real preview, revises with a genuine restriction, confirms exactly once", async () => {
  const { plans, calls } = stubNutritionFixtures();
  const userId = `agent-workflow-nutrition-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng giảm mỡ cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.deepEqual((r1!.blocks[0] as any).missing, ["số bữa mỗi ngày"]);
    assert.equal(calls.queue.length, 0, "must not queue generation before mealsPerDay is known");

    const r2 = await fitnessAgent.tryTurn("4 bữa", identity, session.id);
    assert.equal(calls.queue.length, 1, "workflow completion must queue the real generation exactly once");
    assert.equal(calls.queue[0].mealsPerDay, 4);
    assert.equal(r2!.blocks.length, 0, "must not show a preview before the job is actually done");
    assert.match(r2!.answer, /tính toán|1-2 phút/i);

    const pendingAction = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    assert.ok(pendingAction, "a pending CREATE_NUTRITION_PLAN action must track the queued job across turns");
    const queuedPlanId = (pendingAction!.payload as any).planId as string;

    // Simulate the worker finishing between turns.
    plans.set(queuedPlanId, { ...plans.get(queuedPlanId), status: PlanStatus.COMPLETED, plan: nutritionPlanContentFixture({ mealsPerDay: 4 }) });

    const r3 = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    assert.equal(r3!.blocks[0].type, "NUTRITION_PLAN_PREVIEW", "polling a COMPLETED job must produce the real preview");
    const block3 = r3!.blocks[0] as any;
    assert.equal(block3.mealsPerDay, 4);
    assert.equal(block3.dailyCaloriesTarget, 1800);
    const actionId = block3.actionId as string;

    // Revision: a genuine dietary restriction must reach the NEXT
    // generation's real `restrictions` param, not be silently dropped.
    const r4 = await fitnessAgent.tryTurn("Tôi không ăn cá, đổi giúp tôi", identity, session.id);
    assert.equal(calls.queue.length, 2, "a recognized revision must re-queue a fresh generation");
    assert.ok(calls.queue[1].restrictions.some((r: string) => /không ăn cá/i.test(r)), "the restriction must genuinely reach the re-queued generation params");
    assert.match(r4!.answer, /tính lại|1-2 phút/i);
    const actionAfterRevision = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal((actionAfterRevision!.payload as any).phase, "GENERATING", "must go back to GENERATING while the revised plan is (re)computed");

    const revisedPlanId = (actionAfterRevision!.payload as any).planId as string;
    plans.set(revisedPlanId, { ...plans.get(revisedPlanId), status: PlanStatus.COMPLETED, plan: nutritionPlanContentFixture({ mealsPerDay: 4, restrictions: ["không ăn cá"] }) });

    const r5 = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    assert.equal(r5!.blocks[0].type, "NUTRITION_PLAN_PREVIEW");
    assert.equal((r5!.blocks[0] as any).actionId, actionId, "revision must update the SAME pending action, never create a second CREATE_NUTRITION_PLAN");

    // Confirm via the EXISTING, unmodified execute() path.
    const r6 = await fitnessAgent.execute(identity, actionId, true);
    assert.equal((r6 as any).type, "ACTION_RESULT");
    assert.equal(calls.save.length, 1, "must persist exactly once");
    assert.deepEqual(calls.save[0].weeklySchedule[0].meals[0].items[0].name, "Ức gà", "must persist the REVISED content the user actually saw, not the original fish-containing draft");
    const finalAction = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal(finalAction!.status, "COMPLETED");

    const r6b = await fitnessAgent.execute(identity, actionId, true);
    assert.deepEqual(r6b, r6, "re-confirming an already-COMPLETED action must return the stored result, not re-run");
    assert.equal(calls.save.length, 1, "must not save a second time");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_NUTRITION_PLAN async job-failure (real DB): a FAILED job is reported honestly, never silently retried into a fake preview", async () => {
  const { plans } = stubNutritionFixtures();
  const userId = `agent-workflow-nutrition-fail-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("3 bữa", identity, session.id);
    const pendingAction = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    const planId = (pendingAction!.payload as any).planId as string;
    plans.set(planId, { ...plans.get(planId), status: PlanStatus.FAILED, failReason: "LLM timeout" });

    const r3 = await fitnessAgent.tryTurn("xong chưa", identity, session.id);
    assert.match(r3!.answer, /chưa tạo được|LLM timeout/i);
    assert.equal(r3!.blocks.length, 0);
    const finalAction = await prisma.fitnessAgentAction.findUnique({ where: { id: pendingAction!.id } });
    assert.equal(finalAction!.status, "CANCELLED", "a failed job must never be left as an active pending action a later message could accidentally resume");
    void r2;
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_NUTRITION_PLAN no-repeat E2E (real DB): a mealsPerDay stated up front is never re-asked", async () => {
  stubNutritionFixtures();
  const userId = `agent-workflow-nutrition-norepeat-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 5 bữa", identity, session.id);
    assert.match(r1!.answer, /tính toán|1-2 phút/i, "mealsPerDay stated in the triggering message must resolve the workflow in the SAME turn — no WORKFLOW_MISSING_DATA turn at all");
    // Unlike CREATE_WORKOUT_PLAN's daysPerWeek/sessionMinutes (both have a
    // real EnterpriseContext fallback and so can skip creating a workflow
    // row entirely), mealsPerDay has NO context source — it is always
    // genuinely extracted from text, so a short-lived COMPLETED workflow
    // row is expected here, not zero rows. The real "no-repeat" guarantee
    // being tested is that the extracted value is trusted immediately
    // rather than asked for again, which the assertions below verify.
    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.ok(rows.every(r => r.status === "COMPLETED"), "any workflow row created here must already be COMPLETED, never left COLLECTING_SLOTS");
    const pendingAction = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    assert.equal((pendingAction!.payload as any).mealsPerDay, 5);
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
