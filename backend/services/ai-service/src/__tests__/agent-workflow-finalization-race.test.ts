/**
 * Finalization race closure: confirm and dismiss compete on ONE atomic DB transition
 * (PENDING -> EXECUTING | CANCELLED). Deterministic barriers pause the business call so the
 * losing operation's response can be asserted, not just the final DB status.
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


// ── deterministic barriers ───────────────────────────────────────────────────
function barrier() {
  let enter!: () => void; let open!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const opened = new Promise<void>((r) => { open = r; });
  return { entered, opened, enter, open };
}
/** Replace the workout import boundary with a gated one; returns controls. */
function gateWorkout(rig: Rig, opts: { failWith?: string } = {}) {
  const b = barrier();
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, payload: any) => {
    rig.calls.import.push(payload);
    b.enter();
    await b.opened;
    if (opts.failWith) throw new Error(opts.failWith);
    return { message: "đã lưu" } as any;
  };
  return b;
}
function gateNutrition(rig: Rig, opts: { failWith?: string } = {}) {
  const b = barrier();
  fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan = async (_i: any, payload: any) => {
    rig.calls.save.push(payload);
    b.enter();
    await b.opened;
    if (opts.failWith) throw new Error(opts.failWith);
    return { message: "đã lưu" } as any;
  };
  return b;
}
async function workoutPreview(rig: Rig) {
  const s = await newSession();
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", s.identity, s.sessionId);
  return { ...s, action: (await pendingAction(s.userId, "CREATE_WORKOUT_PLAN"))!, rig };
}
async function nutritionPreview(rig: Rig) {
  const s = await newSession();
  await fitnessAgent.tryTurn("Tạo thực đơn cho tôi, chia 4 bữa", s.identity, s.sessionId);
  const action = (await pendingAction(s.userId, "CREATE_NUTRITION_PLAN"))!;
  complete(rig, (action.payload as any).planId, planContent());
  await fitnessAgent.tryTurn("xong chưa", s.identity, s.sessionId);
  return { ...s, action, rig };
}
const statusOf = async (id: string) => (await prisma.fitnessAgentAction.findUnique({ where: { id } }))!.status;
const msg = (b: unknown) => String((b as any)?.message ?? "");
const SAVED_RE = /Đã lưu|đã lưu/;
const DISMISSED_RE = /Đã bỏ qua bản nháp này — chưa lưu gì/;

for (const kind of ["WORKOUT", "NUTRITION"] as const) {
  const setup = async () => {
    const rig = stubRig({ days: [1, 3, 5] });
    const ctx = kind === "WORKOUT" ? await workoutPreview(rig) : await nutritionPreview(rig);
    const gate = kind === "WORKOUT" ? gateWorkout(rig) : gateNutrition(rig);
    const writes = () => (kind === "WORKOUT" ? rig.calls.import.length : rig.calls.save.length);
    return { ...ctx, gate, writes };
  };

  test(`${kind} race, CONFIRM wins: dismiss arriving mid-write must NOT report a successful cancellation; exactly one write; final COMPLETED`, async () => {
    const { gate, writes, identity, action } = await setup();
    const confirmP = fitnessAgent.execute(identity, action.id, true);
    await gate.entered; // confirm has claimed and is inside the business call
    assert.equal(await statusOf(action.id), "EXECUTING");
    const dismissed = await fitnessAgent.dismissDraft(identity, action.id);
    assert.doesNotMatch(msg(dismissed), DISMISSED_RE, "dismiss must not claim 'nothing saved' while confirm owns the write");
    assert.match(msg(dismissed), /đang được lưu nên không thể bỏ qua/);
    assert.equal(await statusOf(action.id), "EXECUTING", "the losing dismiss must not change state");
    gate.open();
    const confirmed = await confirmP;
    assert.match(msg(confirmed), SAVED_RE);
    assert.equal(await statusOf(action.id), "COMPLETED");
    assert.equal(writes(), 1);
    // late dismiss after completion stays truthful
    assert.match(msg(await fitnessAgent.dismissDraft(identity, action.id)), /đã được lưu/);
    assert.equal(await statusOf(action.id), "COMPLETED");
  });

  test(`${kind} race, DISMISS wins: confirm arriving afterwards is rejected; zero writes; final CANCELLED`, async () => {
    const { gate, writes, identity, action } = await setup();
    const dismissed = await fitnessAgent.dismissDraft(identity, action.id);
    assert.match(msg(dismissed), DISMISSED_RE);
    await assert.rejects(() => fitnessAgent.execute(identity, action.id, true), /CANCELLED/);
    gate.open();
    assert.equal(writes(), 0);
    assert.equal(await statusOf(action.id), "CANCELLED");
  });

  test(`${kind} race, truly concurrent confirm||dismiss x25: exactly ONE winner, and both responses agree with it`, async () => {
    const rig = stubRig({ days: [1, 3, 5] });
    let confirmWins = 0, dismissWins = 0;
    for (let i = 0; i < 25; i += 1) {
      const ctx = kind === "WORKOUT" ? await workoutPreview(rig) : await nutritionPreview(rig);
      const before = kind === "WORKOUT" ? rig.calls.import.length : rig.calls.save.length;
      const [c, d] = await Promise.allSettled([fitnessAgent.execute(ctx.identity, ctx.action.id, true), fitnessAgent.dismissDraft(ctx.identity, ctx.action.id)]);
      const writes = (kind === "WORKOUT" ? rig.calls.import.length : rig.calls.save.length) - before;
      const finalStatus = await statusOf(ctx.action.id);
      if (finalStatus === "COMPLETED") {
        confirmWins += 1;
        assert.equal(c.status, "fulfilled"); assert.match(msg((c as any).value), SAVED_RE);
        assert.equal(writes, 1);
        assert.equal(d.status, "fulfilled"); assert.doesNotMatch(msg((d as any).value), DISMISSED_RE, "loser must not claim success");
      } else {
        dismissWins += 1;
        assert.equal(finalStatus, "CANCELLED");
        assert.equal(c.status, "rejected", "confirm must be rejected when dismiss won");
        assert.equal(writes, 0);
        assert.equal(d.status, "fulfilled"); assert.match(msg((d as any).value), DISMISSED_RE);
      }
    }
    assert.equal(confirmWins + dismissWins, 25);
  });

  test(`${kind}: double confirm -> one business write; the second request is honestly rejected while the first is executing`, async () => {
    const { gate, writes, identity, action } = await setup();
    const p1 = fitnessAgent.execute(identity, action.id, true);
    await gate.entered;
    await assert.rejects(() => fitnessAgent.execute(identity, action.id, true), /already being executed/);
    gate.open();
    assert.match(msg(await p1), SAVED_RE);
    assert.equal(writes(), 1);
    assert.deepEqual(await fitnessAgent.execute(identity, action.id, true), await p1, "replay after completion is idempotent");
    assert.equal(writes(), 1);
  });

  test(`${kind}: concurrent double dismiss -> one cancellation, coherent responses`, async () => {
    const { identity, action, writes } = await setup();
    const [a, b] = await Promise.all([fitnessAgent.dismissDraft(identity, action.id), fitnessAgent.dismissDraft(identity, action.id)]);
    assert.match(msg(a), DISMISSED_RE); assert.match(msg(b), DISMISSED_RE);
    assert.equal(await statusOf(action.id), "CANCELLED");
    assert.equal(writes(), 0);
  });

  test(`${kind}: business FAILURE after the claim hands the action back to PENDING (retryable), records no fake COMPLETED, retry then succeeds once`, async () => {
    const rig = stubRig({ days: [1, 3, 5] });
    const ctx = kind === "WORKOUT" ? await workoutPreview(rig) : await nutritionPreview(rig);
    const failing = kind === "WORKOUT" ? gateWorkout(rig, { failWith: "downstream 503" }) : gateNutrition(rig, { failWith: "downstream 503" });
    failing.open();
    const failed = await fitnessAgent.execute(ctx.identity, ctx.action.id, true);
    assert.match(msg(failed), /Không lưu được/);
    assert.equal(await statusOf(ctx.action.id), "PENDING", "state must agree with the real outcome");
    // a failed write leaves the draft dismissible and retryable
    const ok = kind === "WORKOUT" ? gateWorkout(rig) : gateNutrition(rig);
    ok.open();
    assert.match(msg(await fitnessAgent.execute(ctx.identity, ctx.action.id, true)), SAVED_RE);
    assert.equal(await statusOf(ctx.action.id), "COMPLETED");
  });
}

test("crash recovery: a STALE executing claim is reclaimable (retry safe via downstream idempotency); a FRESH one is not, and cannot be dismissed", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const ctx = await workoutPreview(rig);
  await prisma.fitnessAgentAction.update({ where: { id: ctx.action.id }, data: { status: "EXECUTING", result: { executingSince: new Date().toISOString() } } });
  await assert.rejects(() => fitnessAgent.execute(ctx.identity, ctx.action.id, true), /already being executed/);
  assert.match(msg(await fitnessAgent.dismissDraft(ctx.identity, ctx.action.id)), /đang được lưu nên không thể bỏ qua/);
  assert.equal(rig.calls.import.length, 0);
  await prisma.fitnessAgentAction.update({ where: { id: ctx.action.id }, data: { result: { executingSince: new Date(Date.now() - 10 * 60_000).toISOString() } } });
  assert.match(msg(await fitnessAgent.execute(ctx.identity, ctx.action.id, true)), SAVED_RE);
  assert.equal(rig.calls.import.length, 1);
  assert.equal(await statusOf(ctx.action.id), "COMPLETED");
});

test("an execution-owned (EXECUTING) draft is not an editable pending draft: it receives no revision turns", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const ctx = await workoutPreview(rig);
  await prisma.fitnessAgentAction.update({ where: { id: ctx.action.id }, data: { status: "EXECUTING", result: { executingSince: new Date().toISOString() } } });
  assert.equal(await fitnessAgent.tryTurn("Tôi tập được thứ 3, 5, 7", ctx.identity, ctx.sessionId), null);
});

test("ownership: another user can neither confirm nor dismiss (404), and the action is untouched", async () => {
  const rig = stubRig({ days: [1, 3, 5] });
  const ctx = await workoutPreview(rig);
  const stranger = { userId: `stranger-${randomUUID()}` } as any;
  await assert.rejects(() => fitnessAgent.execute(stranger, ctx.action.id, true), /not found/i);
  await assert.rejects(() => fitnessAgent.dismissDraft(stranger, ctx.action.id), /not found/i);
  assert.equal(await statusOf(ctx.action.id), "PENDING");
  assert.equal(rig.calls.import.length, 0);
});
