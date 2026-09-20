/**
 * AI Coach product remediation #1 (Codex product E2E #1: M1-M7 + L1). Real
 * AI-service DB rows (FitnessAgentAction / AgentWorkflowSession); external
 * HTTP boundaries (context, catalog, substitution, import, queue, target)
 * stubbed explicitly, same convention as the other agent-workflow suites.
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
const utcWeekday = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
const scheduleNames = (payload: any): string[] => payload.weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.name as string));

// ── M1 ────────────────────────────────────────────────────────────────────────
test("M1: opening-message dietary restriction survives slot collection and reaches the queued generation (merge, not replace)", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  const r1 = await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi. Tôi không ăn cá.", identity, sessionId);
  assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
  assert.deepEqual((r1!.blocks[0] as any).missing, ["số bữa mỗi ngày"], "asks ONLY mealsPerDay");
  assert.equal(rig.calls.queue.length, 0);
  const r2 = await fitnessAgent.tryTurn("4 bữa", identity, sessionId);
  assert.equal(rig.calls.queue.length, 1);
  assert.equal(rig.calls.queue[0].mealsPerDay, 4);
  assert.deepEqual(rig.calls.queue[0].excludedFoodKeys, ["fish"], "the ENFORCED exclusion must carry through");
  assert.ok(rig.calls.queue[0].restrictions.some((r: string) => /không ăn cá/i.test(r)));
  assert.equal(rig.calls.save.length, 0, "no NutritionProgram write before confirm");
  assert.match(r2!.answer, /loại trừ/i);
  // A duplicate restatement in the final turn must not duplicate it.
  const rig2 = stubRig();
  const s2 = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi. Tôi không ăn cá.", s2.identity, s2.sessionId);
  await fitnessAgent.tryTurn("4 bữa, không ăn cá và không ăn tôm", s2.identity, s2.sessionId);
  assert.deepEqual([...rig2.calls.queue[0].excludedFoodKeys].sort(), ["fish", "shellfish"]);
  void userId;
});

// ── M2 (chat-side) ───────────────────────────────────────────────────────────
test("M2 chat: a restriction that cannot be ENFORCED is refused (nothing queued), never silently downgraded to a prompt hint", async () => {
  const rig = stubRig();
  const { identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi. Tôi không ăn cay.", identity, sessionId);
  const r = await fitnessAgent.tryTurn("3 bữa", identity, sessionId);
  assert.match(r!.answer, /chưa thể ĐẢM BẢO/i);
  assert.equal(rig.calls.queue.length, 0);
});

test("M2 chat: a plan that violates a declared exclusion is never previewed (defense in depth over the processor)", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa, không ăn cá", identity, sessionId);
  const action = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (action!.payload as any).planId, planContent({ item: "Salmon, Atlantic" }));
  const r = await fitnessAgent.tryPollOrReviseNutritionPlanDraft("xong chưa", identity, sessionId);
  assert.equal(r!.blocks.length, 0);
  assert.match(r!.answer, /vi phạm/i);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: action!.id } }))!.status, "CANCELLED");
});

// ── M3 ────────────────────────────────────────────────────────────────────────
test("M3: generation receives the AUTHORITATIVE target (active goal / deterministic prescription), never the processor's generic default", async () => {
  const rig = stubRig({ target: { status: "COMPUTED", calories: 1992, protein: 128, carbs: 246, fat: 55, professionalReviewRequired: false } });
  const { identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const q = rig.calls.queue[0];
  assert.equal(q.dailyCaloriesTarget, 1992);
  assert.equal(q.proteinTargetG, 128);
  assert.equal(q.carbTargetG, 246);
  assert.equal(q.fatTargetG, 55);
});

test("M3: an ACTIVE NutritionGoal is the target; every revision re-resolves it fresh and re-sends it", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (a!.payload as any).planId, planContent());
  const preview = await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  assert.match(String((preview!.blocks[0] as any).targetNote), /mục tiêu dinh dưỡng đang hoạt động.*1800 kcal/);
  rig.target.current = { status: "ACTIVE_GOAL", goalId: "goal-1", calories: 1700, protein: 145, carbs: 150, fat: 50 }; // goal changed meanwhile
  await fitnessAgent.tryTurn("Tôi không ăn cá", identity, sessionId);
  assert.equal(rig.calls.queue[1].dailyCaloriesTarget, 1700, "the revision must use the CURRENT authoritative target");
});

test("M3: insufficient profile data -> ask, never fall back to a generic prescription", async () => {
  const rig = stubRig({ target: { status: "insufficient_data", missingFields: ["heightCm", "age"] } });
  const { identity, sessionId } = await newSession();
  const r = await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  assert.match(r!.answer, /chiều cao, tuổi/);
  assert.equal(rig.calls.queue.length, 0);
});

test("M3: confirm fails closed when the authoritative target changed after the preview; nothing is saved", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (a!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  rig.target.current = { status: "ACTIVE_GOAL", goalId: "goal-1", calories: 1500, protein: 150, carbs: 100, fat: 50 };
  await assert.rejects(() => fitnessAgent.execute(identity, a!.id, true), /đã thay đổi/);
  assert.equal(rig.calls.save.length, 0);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: a!.id } }))!.status, "PENDING");
});

test("Nutrition preview == saved content (hash-checked) and revised restriction reaches persistence; double confirm = one write", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  const firstPlan = (a!.payload as any).planId;
  complete(rig, firstPlan, planContent({ item: "Cá hồi" }));
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  await fitnessAgent.tryTurn("Tôi không ăn cá", identity, sessionId);
  const revisedPlan = ((await prisma.fitnessAgentAction.findUnique({ where: { id: a!.id } }))!.payload as any).planId;
  assert.notEqual(revisedPlan, firstPlan);
  complete(rig, revisedPlan, planContent({ item: "Ức gà" }));
  const p = await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  assert.equal((p!.blocks[0] as any).type, "NUTRITION_PLAN_PREVIEW");
  assert.deepEqual((p!.blocks[0] as any).excludedFoods, ["cá"]);
  // Content mutated after the user reviewed it -> refuse to save.
  rig.plans.set(revisedPlan, { ...rig.plans.get(revisedPlan), plan: planContent({ item: "Ức gà", calories: 2600 }) });
  const bad = await fitnessAgent.execute(identity, a!.id, true);
  assert.match(String((bad as any).message), /đã thay đổi sau khi bạn xem/);
  assert.equal(rig.calls.save.length, 0);
});

// ── M4 ────────────────────────────────────────────────────────────────────────
test("M4-A: nutrition GENERATING -> PT search -> unrelated follow-up is NOT swallowed; deliberate return to the menu still works", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const pt = await fitnessAgent.tryTurn("Khoan, tìm PT cho tôi trước", identity, sessionId);
  assert.equal(pt!.blocks[0].type, "PT_RECOMMENDATIONS");
  const unrelated = await fitnessAgent.tryTurn("Chứng chỉ đó có ý nghĩa gì?", identity, sessionId);
  assert.equal(unrelated, null, "must fall through to normal chat, not 'Thực đơn vẫn đang được tính toán'");
  const back = await fitnessAgent.tryTurn("Thực đơn của tôi xong chưa?", identity, sessionId);
  assert.match(back!.answer, /vẫn đang được tính toán/, "an explicit nutrition cue deliberately returns to the pending job");
  assert.equal(rig.calls.queue.length, 1, "polling never queues a duplicate job");
  void userId;
});

test("M4: rapid 'xong chưa' while GENERATING only polls — never a duplicate job", async () => {
  const rig = stubRig();
  const { identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  for (let i = 0; i < 3; i += 1) await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  assert.equal(rig.calls.queue.length, 1);
});

test("M4-B: old Workout preview + newer Nutrition preview -> a meal edit updates the NUTRITION draft, the workout draft is untouched", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const workoutBefore = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const n = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (n!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  const r = await fitnessAgent.tryTurn("Đổi bữa sáng, tôi có 20 phút nấu ăn.", identity, sessionId);
  assert.match(r!.answer, /tính lại TOÀN BỘ thực đơn/);
  assert.equal(rig.calls.queue.length, 2);
  const workoutAfter = await prisma.fitnessAgentAction.findUnique({ where: { id: workoutBefore!.id } });
  assert.equal((workoutAfter!.payload as any).sessionMinutes, 60, "the workout draft's duration must NOT be changed by a nutrition edit");
  assert.deepEqual(workoutAfter!.payload, workoutBefore!.payload);
});

test("M4-C: Nutrition preview + newer Workout preview -> a workout edit updates the WORKOUT draft only", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const n = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (n!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const w = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const setsBefore = (w!.payload as any).weeklySchedule.find((d: any) => /legs/i.test(d.day)).exercises[0].sets;
  const r = await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", identity, sessionId);
  assert.equal(r!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
  assert.equal(rig.calls.queue.length, 1, "no nutrition regeneration");
  const after = await prisma.fitnessAgentAction.findUnique({ where: { id: w!.id } });
  assert.ok((after!.payload as any).weeklySchedule.find((d: any) => /legs/i.test(d.day)).exercises[0].sets < setsBefore);
});

test("M4-D: both drafts pending + an ambiguous bare 'đổi lại' -> ask which plan, change nothing", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi, chia 4 bữa", identity, sessionId);
  const n = await pendingAction(userId, "CREATE_NUTRITION_PLAN");
  complete(rig, (n!.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", identity, sessionId);
  const w0 = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const r = await fitnessAgent.tryTurn("đổi lại", identity, sessionId);
  assert.match(r!.answer, /nhiều bản nháp.*Bạn muốn chỉnh cái nào/s);
  assert.equal(r!.blocks.length, 0);
  assert.equal(rig.calls.queue.length, 1);
  assert.deepEqual((await prisma.fitnessAgentAction.findUnique({ where: { id: w0!.id } }))!.payload, w0!.payload);
});

test("M4: a roadmap-bundle draft no longer swallows a generic turn once another task (PT search) happened after it", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "CREATE_PLAN_BUNDLE", risk: "MEDIUM", payload: { roadmapDraft: { goalType: "WEIGHT_LOSS" } }, expiresAt: new Date(Date.now() + 600000) } });
  await new Promise((r) => setTimeout(r, 20));
  await fitnessAgent.tryTurn("Tìm PT cho tôi", identity, sessionId);
  const out = await fitnessAgent.tryTurn("Chứng chỉ đó có ý nghĩa gì?", identity, sessionId);
  assert.equal(out, null);
  void rig;
});

// ── L1 ────────────────────────────────────────────────────────────────────────
test("L1: dismissing a draft cancels it server-side (truthful 'bỏ qua'), later turns no longer route to it, and other users/kinds are refused", async () => {
  stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const w = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  await assert.rejects(() => fitnessAgent.dismissDraft({ userId: "someone-else" } as any, w!.id), /not found/i);
  const res = await fitnessAgent.dismissDraft(identity, w!.id);
  assert.match(String((res as any).message), /chưa lưu gì/);
  assert.equal((await prisma.fitnessAgentAction.findUnique({ where: { id: w!.id } }))!.status, "CANCELLED");
  assert.equal(await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", identity, sessionId), null, "a dismissed draft must not receive later turns");
  const other = await prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "NUTRITION_LOG_MEAL", risk: "LOW", payload: {}, expiresAt: new Date(Date.now() + 60000) } });
  await assert.rejects(() => fitnessAgent.dismissDraft(identity, other.id), /cannot be dismissed/);
});

// ── M5 ────────────────────────────────────────────────────────────────────────
test("M5: real extracted training.injuries produces the promised warning (initial preview AND after a revision); beginner honesty note is shown; no medical gate is invented", async () => {
  stubRig({ injuries: ["knee pain"], experience: "BEGINNER" });
  const { userId, identity, sessionId } = await newSession();
  const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const warnings = (r1!.blocks[0] as any).warnings as string[];
  assert.ok(warnings.some((w) => /knee pain/.test(w) && /CHỈ có cảnh báo/.test(w)), "injury warning must be present and honest that it is warning-only");
  assert.ok(warnings.some((w) => /không lọc bài theo trình độ/.test(w)));
  const r2 = await fitnessAgent.tryTurn("Buổi tập ngắn xuống 45 phút", identity, sessionId);
  assert.ok(((r2!.blocks[0] as any).warnings as string[]).some((w) => /knee pain/.test(w)), "warning survives revision");
  void userId;
});

// ── M6 ────────────────────────────────────────────────────────────────────────
test("M6: 'Tôi không có máy cable.' removes/substitutes EVERY cable exercise with canonical ids, never re-introduces cable, draft only", async () => {
  const rig = stubRig({
    // First candidate is itself a cable move — must be rejected and retried.
    substitute: (_id, _ex, n) => (n % 2 === 1 ? { id: `cable-alt-${n}`, exerciseName: "Cable Crossover" } : { id: `alt-${n}`, exerciseName: `Dumbbell Move ${n}` }),
  });
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const before = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  assert.ok(scheduleNames(before!.payload).some((n) => /cable/i.test(n)), "fixture draft must contain cable exercises");
  const r = await fitnessAgent.tryTurn("Tôi không có máy cable.", identity, sessionId);
  assert.equal(r!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "must NOT return null (Codex M6)");
  const after = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  assert.equal(after!.id, before!.id);
  assert.equal(scheduleNames(after!.payload).filter((n) => /cable/i.test(n)).length, 0);
  assert.ok((after!.payload as any).weeklySchedule.every((d: any) => d.exercises.every((e: any) => typeof e.exerciseId === "string" && e.exerciseId.length > 0)));
  assert.equal(rig.calls.import.length, 0, "draft-only: zero WorkoutSchedule writes");
  assert.deepEqual((after!.payload as any).exclusions, ["cable"]);
  // A later regeneration re-applies the durable exclusion.
  await fitnessAgent.tryTurn("Tôi tập được 4 buổi", identity, sessionId);
  const regen = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  assert.equal(scheduleNames(regen!.payload).filter((n) => /cable/i.test(n)).length, 0, "exclusion must survive regeneration");
});

test("M6: 'Tôi không muốn deadlift.' matches BOTH Deadlift and Romanian Deadlift (token match), unrelated exercises untouched", async () => {
  const rig = stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const before = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const beforeNames = scheduleNames(before!.payload);
  assert.ok(beforeNames.some((n) => /deadlift/i.test(n)));
  await fitnessAgent.tryTurn("Tôi không muốn deadlift.", identity, sessionId);
  const after = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const afterNames = scheduleNames(after!.payload);
  assert.equal(afterNames.filter((n) => /deadlift/i.test(n)).length, 0);
  const unrelated = beforeNames.filter((n) => !/deadlift/i.test(n));
  for (const n of unrelated) assert.ok(afterNames.includes(n), `unrelated exercise ${n} must remain`);
  assert.equal(rig.calls.import.length, 0);
});

test("M6: 'tránh squat' / 'đổi squat' both work; a phrase naming nothing in the draft falls through (null), never a fake edit", async () => {
  stubRig();
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const r = await fitnessAgent.tryTurn("Tránh squat giúp tôi", identity, sessionId);
  assert.equal(r!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
  assert.equal(scheduleNames((await pendingAction(userId, "CREATE_WORKOUT_PLAN"))!.payload).filter((n) => /squat/i.test(n)).length, 0);
  assert.equal(await fitnessAgent.tryTurn("Tôi không muốn kayak", identity, sessionId), null);
});

// ── M7 ────────────────────────────────────────────────────────────────────────
test("M7: Mon/Wed/Fri preview labels == the selectedWeekdays sent to import == the first dates shown; real import payload carries them", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const { userId, identity, sessionId } = await newSession();
  const r = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const block = r!.blocks[0] as any;
  assert.deepEqual(block.days.map((d: any) => d.day.split(" ")[0] + " " + d.day.split(" ")[1]), ["Thứ 2", "Thứ 4", "Thứ 6"]);
  assert.deepEqual(block.days.map((d: any) => utcWeekday(d.firstDate)), [1, 3, 5], "each shown first date falls on the labelled weekday");
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  assert.deepEqual((a!.payload as any).selectedWeekdays, [1, 3, 5]);
  await fitnessAgent.execute(identity, a!.id, true);
  assert.equal(rig.calls.import.length, 1);
  assert.deepEqual(rig.calls.import[0].selectedWeekdays, [1, 3, 5], "import must receive the reviewed weekday pattern");
  assert.equal(rig.calls.import[0].daysPerWeek, 3);
});

test("M7: 'Tôi tập được thứ 3, 5, 7' relabels the same draft, updates selectedWeekdays, and the save uses exactly those weekdays", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const r = await fitnessAgent.tryTurn("Tôi tập được thứ 3, 5, 7", identity, sessionId);
  const block = r!.blocks[0] as any;
  assert.deepEqual(block.days.map((d: any) => d.day.split(" ").slice(0, 2).join(" ")), ["Thứ 3", "Thứ 5", "Thứ 7"]);
  assert.deepEqual(block.days.map((d: any) => utcWeekday(d.firstDate)), [2, 4, 6]);
  await fitnessAgent.execute(identity, a!.id, true);
  assert.deepEqual(rig.calls.import[0].selectedWeekdays, [2, 4, 6]);
});

test("M7: changing the weekday COUNT regenerates with the chosen weekdays (Chủ nhật = 0), never a count-only save", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const r = await fitnessAgent.tryTurn("Tôi chỉ tập được thứ 2 và chủ nhật", identity, sessionId);
  const block = r!.blocks[0] as any;
  assert.equal(block.daysPerWeek, 2);
  assert.deepEqual(block.days.map((d: any) => utcWeekday(d.firstDate)), [1, 0]);
  await fitnessAgent.execute(identity, a!.id, true);
  assert.deepEqual(rig.calls.import[0].selectedWeekdays, [1, 0]);
  assert.equal(rig.calls.import[0].daysPerWeek, 2);
});

test("Workout: double confirm = one logical import (idempotent) with unchanged reviewed content", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const { userId, identity, sessionId } = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, sessionId);
  const a = await pendingAction(userId, "CREATE_WORKOUT_PLAN");
  const first = await fitnessAgent.execute(identity, a!.id, true);
  const second = await fitnessAgent.execute(identity, a!.id, true);
  assert.deepEqual(second, first);
  assert.equal(rig.calls.import.length, 1);
});
