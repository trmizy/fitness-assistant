/**
 * AI Coach product FINAL remediation (Codex final recheck, 3 MEDIUM): accumulating nutrition
 * constraints, compound unsupported exclusions, CANCELLED is terminal. Same rig as
 * agent-workflow-product-remediation-1.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, conversationRepository, PlanStatus } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { conversationService } from "../services/conversation.service";
import { llmService } from "../services/llm.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  extract: fitnessAgentDeps.profileExtractor.extract,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName,
  getExerciseSubstitute: fitnessAgentDeps.tools.getExerciseSubstitute,
  importAiPlanToSchedule: fitnessAgentDeps.tools.importAiPlanToSchedule,
  saveNutritionPlanFromAiPlan: fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan,
  getNutritionTargetPreview: fitnessAgentDeps.tools.getNutritionTargetPreview,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  queue: conversationService.queueNutritionPlanGeneration,
  findNutritionPlanById: conversationRepository.findNutritionPlanById,
  getHealthStatus: llmService.getHealthStatus,
};
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.tools.getExerciseSubstitute = original.getExerciseSubstitute;
  fitnessAgentDeps.tools.importAiPlanToSchedule = original.importAiPlanToSchedule;
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = original.saveNutritionPlanFromAiPlan;
  fitnessAgentDeps.tools.getNutritionTargetPreview = original.getNutritionTargetPreview;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  conversationService.queueNutritionPlanGeneration = original.queue;
  conversationRepository.findNutritionPlanById = original.findNutritionPlanById;
  llmService.getHealthStatus = original.getHealthStatus;
});
test.after(async () => { await prisma.$disconnect(); });

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const users: string[] = [];
async function newSession() {
  const userId = `product-remediation-${randomUUID()}`;
  users.push(userId);
  const session = await prisma.chatSession.create({ data: { userId, title: "product remediation test" } });
  return { userId, identity: { userId } as any, sessionId: session.id };
}
test.after(async () => {
  for (const userId of users) {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.deleteMany({ where: { userId } });
  }
});

type Rig = ReturnType<typeof stubRig>;
function stubRig(opts: {
  days?: number[]; sessionMinutes?: number; injuries?: string[]; experience?: string;
  target?: any; substitute?: (exerciseId: string, exclude: string[], n: number) => { id: string; exerciseName: string } | null;
} = {}) {
  const profile: Record<string, unknown> = { goal: "MUSCLE_GAIN", days: opts.days ?? [1, 2, 3, 4, 5], sessionMinutes: opts.sessionMinutes ?? 60, budgetVnd: 1_500_000 };
  const plans = new Map<string, any>();
  const calls = { import: [] as any[], substitute: [] as any[], queue: [] as any[], save: [] as any[], pt: [] as any[] };
  const target = { current: opts.target ?? { status: "ACTIVE_GOAL", goalId: "goal-1", calories: 1800, protein: 150, carbs: 160, fat: 55 } as any };
  let subN = 0;
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, age: 28, heightCm: 170, currentWeightKg: 75, gender: "FEMALE", activityLevel: "MODERATE",
      experienceLevel: opts.experience ?? "INTERMEDIATE", safetyScreeningStatus: "CLEARED",
      training: { trainingDaysPerWeek: (profile.days as number[]).length, availableEquipment: ["barbell", "dumbbell", "cable", "rack", "bodyweight"], injuries: opts.injuries ?? [], preferredTrainingDays: profile.days },
    },
  } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_i: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
  fitnessAgentDeps.tools.getExerciseSubstitute = async (_i: any, exerciseId: string, exclude: string[] = []) => {
    calls.substitute.push({ exerciseId, exclude });
    subN += 1;
    if (opts.substitute) return opts.substitute(exerciseId, exclude, subN);
    return { id: `alt-${subN}`, exerciseName: `Alt Movement ${subN}` };
  };
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, payload: any) => { calls.import.push(payload); return { message: "đã lưu" } as any; };
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, prefs: any) => { calls.pt.push(prefs); return { candidates: [], truncated: false, historyAuditId: null } as any; };
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => target.current;
  conversationService.queueNutritionPlanGeneration = async (params: any) => {
    calls.queue.push(params);
    const planId = randomUUID();
    plans.set(planId, { id: planId, userId: params.userId, name: "np", goal: params.goal, durationWeeks: 1, mealsPerDay: params.mealsPerDay, plan: {}, status: PlanStatus.QUEUED, failReason: null, archivedAt: null });
    return { planId, jobId: `job-${planId}`, status: PlanStatus.QUEUED };
  };
  conversationRepository.findNutritionPlanById = (async (id: string) => plans.get(id) ?? null) as any;
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = async (_i: any, payload: any) => { calls.save.push(payload); return { message: "đã lưu" } as any; };
  return { profile, plans, calls, target };
}

function planContent(opts: { calories?: number; item?: string; meals?: number } = {}) {
  return {
    goal: "MUSCLE_GAIN", durationWeeks: 1, mealsPerDay: opts.meals ?? 4, dailyCaloriesTarget: opts.calories ?? 1800,
    proteinTargetGrams: 150, carbTargetGrams: 160, fatTargetGrams: 55,
    weeklySchedule: Array.from({ length: 7 }, (_, i) => ({
      dayNumber: i + 1, title: `Ngày ${i + 1}`, totalCalories: 1800, protein: 150, carbs: 160, fat: 55,
      meals: [{ mealType: "BREAKFAST", title: "Bữa sáng", calories: 400, protein: 30, carbs: 40, fat: 10, items: [{ foodId: "f1", name: opts.item ?? "Ức gà", quantity: 150, unit: "g", calories: 300, protein: 30, carbs: 0, fat: 10 }] }],
    })),
  };
}
const complete = (rig: Rig, planId: string, content: any) => rig.plans.set(planId, { ...rig.plans.get(planId), status: PlanStatus.COMPLETED, plan: content });
const pendingAction = (userId: string, kind: string) => prisma.fitnessAgentAction.findFirst({ where: { userId, kind }, orderBy: { createdAt: "desc" } });


import { extractNutritionConstraints } from "../services/nutrition-food-constraints";

// ── M2: compound parser matrix (pure) ────────────────────────────────────────
const keys = (m: string) => extractNutritionConstraints(m).exclusions.map((e) => e.key).sort();
const unsup = (m: string) => extractNutritionConstraints(m).unsupported;
test("M2 parser: supported + unsupported in one clause list, in EVERY order, and 3-item lists", () => {
  for (const m of ["Tôi không ăn cá và không ăn cay", "Tôi không ăn cay và không ăn cá", "Không ăn cá, không ăn cay, không ăn thịt bò", "Không ăn cay, không ăn cá, không ăn thịt bò", "Không ăn thịt bò và không ăn cay và không ăn cá"]) {
    assert.deepEqual(unsup(m), ["không ăn cay"], m);
  }
  assert.deepEqual(keys("Tôi không ăn cá và không ăn cay"), ["fish"]);
  assert.deepEqual(keys("Không ăn cá, không ăn cay, không ăn thịt bò"), ["beef", "fish"]);
  assert.deepEqual(keys("không ăn cá và không ăn thịt bò"), ["beef", "fish"]);
  assert.deepEqual(unsup("không ăn cá và không ăn thịt bò"), []);
  assert.deepEqual(unsup("Tôi không ăn cá. Không ăn cay."), ["không ăn cay"]);
  assert.deepEqual(unsup("không ăn cay"), ["không ăn cay"], "standalone behaviour unchanged");
});
test("M2 parser: non-food clauses / soft hints are NOT mistaken for unsupported hard exclusions; repeated restatement dedupes", () => {
  for (const m of ["không ăn cá, 4 bữa", "không ăn cá, ưu tiên món Việt Nam", "không ăn cá, giảm ngân sách", "Tôi không ăn cá, đổi giúp tôi", "không ăn cá, cho tôi thực đơn dễ mua", "không ăn cá và tôi muốn chia 4 bữa"]) {
    assert.deepEqual(unsup(m), [], m);
    assert.deepEqual(keys(m), ["fish"], m);
  }
  assert.ok(extractNutritionConstraints("không ăn cá, ưu tiên món Việt Nam").hints.length >= 1);
  assert.deepEqual(keys("không ăn cá và không ăn cá"), ["fish"]);
});

// ── M1: accumulation across slot collection ──────────────────────────────────
const workflowRow = (userId: string) => prisma.agentWorkflowSession.findFirst({ where: { userId, workflowType: "CREATE_NUTRITION_PLAN" }, orderBy: { createdAt: "desc" } });
test("M1 three-turn golden: fish (turn 1) + beef (turn 2, while still asking meals) + 4 bữa (turn 3) -> queued with BOTH", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  const r1 = await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá.", identity, sessionId);
  assert.deepEqual((r1!.blocks[0] as any).missing, ["số bữa mỗi ngày"]);
  assert.deepEqual(((await workflowRow(userId))!.slotsJson as any).nutritionConstraints.exclusions.map((e: any) => e.key), ["fish"]);
  const r2 = await fitnessAgent.tryTurn("À tôi cũng không ăn thịt bò.", identity, sessionId);
  assert.ok(r2, "must not fall through to generic chat");
  assert.match(r2!.answer, /mấy bữa/, "still asks the real missing slot");
  const row2 = await workflowRow(userId);
  assert.equal(row2!.status, "COLLECTING_SLOTS");
  assert.equal(row2!.expectedSlot, "mealsPerDay");
  assert.equal((row2!.slotsJson as any).mealsPerDay, undefined, "the constraint message must NOT satisfy mealsPerDay");
  assert.deepEqual(((row2!.slotsJson as any).nutritionConstraints.exclusions.map((e: any) => e.key)).sort(), ["beef", "fish"]);
  assert.equal(rig.calls.queue.length, 0);
  await fitnessAgent.tryTurn("4 bữa", identity, sessionId);
  assert.equal(rig.calls.queue.length, 1);
  assert.equal(rig.calls.queue[0].mealsPerDay, 4);
  assert.deepEqual([...rig.calls.queue[0].excludedFoodKeys].sort(), ["beef", "fish"]);
  assert.equal(rig.calls.save.length, 0);
});

test("M1 same-turn: '4 bữa, và tôi cũng không ăn thịt bò' with fish already known -> mealsPerDay 4 AND fish+beef", async () => {
  const rig = stubRig();
  const { identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá.", identity, sessionId);
  await fitnessAgent.tryTurn("4 bữa, và tôi cũng không ăn thịt bò.", identity, sessionId);
  assert.equal(rig.calls.queue.length, 1);
  assert.equal(rig.calls.queue[0].mealsPerDay, 4);
  assert.deepEqual([...rig.calls.queue[0].excludedFoodKeys].sort(), ["beef", "fish"]);
});

test("M1: restating a known exclusion mid-collection dedupes to ONE canonical fish", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá.", identity, sessionId);
  await fitnessAgent.tryTurn("nhớ là không ăn cá nhé", identity, sessionId);
  assert.equal(((await workflowRow(userId))!.slotsJson as any).nutritionConstraints.exclusions.length, 1);
  await fitnessAgent.tryTurn("3 bữa", identity, sessionId);
  assert.deepEqual(rig.calls.queue[0].excludedFoodKeys, ["fish"]);
});

test("M1 x M2: an UNSUPPORTED exclusion in a middle turn is surfaced immediately (never dropped), nothing is queued, and the workflow is cancelled", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn, tôi không ăn cá.", identity, sessionId);
  const r2 = await fitnessAgent.tryTurn("À tôi cũng không ăn cay.", identity, sessionId);
  assert.match(r2!.answer, /chưa thể ĐẢM BẢO.*không ăn cay/is);
  assert.equal((await workflowRow(userId))!.status, "CANCELLED");
  await fitnessAgent.tryTurn("4 bữa", identity, sessionId);
  assert.equal(rig.calls.queue.length, 0, "no plan may be generated while a hard exclusion is unenforceable");
});

test("M2 golden: compound unsupported (both orders, and a 3-item list) -> refused, NO job queued", async () => {
  for (const msg of ["Tạo thực đơn 4 bữa, tôi không ăn cá và không ăn cay.", "Tạo thực đơn 4 bữa, tôi không ăn cay và không ăn cá.", "Tạo thực đơn 4 bữa. Không ăn cá, không ăn cay, không ăn thịt bò."]) {
    const rig = stubRig();
    const { identity, sessionId } = await newSession();
    const r = await fitnessAgent.tryTurn(msg, identity, sessionId);
    assert.match(r!.answer, /chưa thể ĐẢM BẢO.*không ăn cay/is, msg);
    assert.equal(rig.calls.queue.length, 0, msg);
    assert.equal(r!.blocks.length, 0);
  }
});

test("M2 (revision): an unsupported clause hidden in a compound revision is refused and the current preview is kept", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (a!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  const r = await fitnessAgent.tryTurn("Tôi không ăn cá và không ăn cay", identity, sessionId);
  assert.match(r!.answer, /chưa thể ĐẢM BẢO/i);
  assert.equal(rig.calls.queue.length, 1, "no re-queue");
  assert.equal(r!.blocks[0].type, "NUTRITION_PLAN_PREVIEW");
});

// ── M3: CANCELLED is terminal ────────────────────────────────────────────────
test("M3 workout: dismiss -> stale confirm is REJECTED, zero imports, status stays CANCELLED", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  await fitnessAgent.dismissDraft(identity, a!.id);
  await assert.rejects(() => fitnessAgent.execute(identity, a!.id, true), /CANCELLED/);
  assert.equal(rig.calls.import.length, 0);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: a!.id } }))!.status, "CANCELLED");
});

test("M3 nutrition: dismiss a PREVIEW -> stale confirm is REJECTED, zero saves, status stays CANCELLED", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (a!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  await fitnessAgent.dismissDraft(identity, a!.id);
  await assert.rejects(() => fitnessAgent.execute(identity, a!.id, true), /CANCELLED/);
  assert.equal(rig.calls.save.length, 0);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: a!.id } }))!.status, "CANCELLED");
});

test("M3: a FAILED-job (auto-CANCELLED) nutrition action cannot be confirmed either", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  const planId = (a!.payload as any).planId;
  rig.plans.set(planId, { ...rig.plans.get(planId), status: PlanStatus.FAILED, failReason: "x" });
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  await assert.rejects(() => fitnessAgent.execute(identity, a!.id, true), /CANCELLED/);
  assert.equal(rig.calls.save.length, 0);
});

test("M3: double dismiss is idempotent; dismiss AFTER completion never turns a saved action into CANCELLED", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const d1 = await fitnessAgent.dismissDraft(identity, a!.id);
  const d2 = await fitnessAgent.dismissDraft(identity, a!.id);
  assert.deepEqual(d2, d1);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: a!.id } }))!.status, "CANCELLED");

  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const b = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  assert.notEqual(b!.id, a!.id);
  await fitnessAgent.execute(identity, b!.id, true);
  const late = await fitnessAgent.dismissDraft(identity, b!.id);
  assert.match(String((late as any).message), /đã được lưu/);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: b!.id } }))!.status, "COMPLETED");
  assert.equal(rig.calls.import.length, 1);
});

test("M3 regressions: COMPLETED confirm stays idempotent (one write); EXPIRED still cannot execute; CANCELLED stays out of routing", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const first = await fitnessAgent.execute(identity, a!.id, true);
  assert.deepEqual(await fitnessAgent.execute(identity, a!.id, true), first);
  assert.equal(rig.calls.import.length, 1);

  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const e = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  await prisma.fitnessAgentAction.update({ where: { id: e!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(() => fitnessAgent.execute(identity, e!.id, true), /expired/i);
  assert.equal(rig.calls.import.length, 1);

  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const c = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  await fitnessAgent.dismissDraft(identity, c!.id);
  assert.equal(await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", identity, sessionId), null, "a cancelled draft must not receive later turns");
});
