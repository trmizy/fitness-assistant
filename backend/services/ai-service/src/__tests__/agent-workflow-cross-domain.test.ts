/**
 * Cross-workflow behavior spanning CREATE_ROADMAP / CREATE_WORKOUT_PLAN /
 * CREATE_NUTRITION_PLAN / FIND_PT — required by the AI Coach product
 * capability expansion task (§46-47): real context (goal/days/
 * sessionMinutes/profile facts) must be reused across DIFFERENT workflows
 * without redundant re-asking, and switching to a different workflow while
 * one is pending must cancel the old one cleanly with no slot leakage.
 * Each workflow's own dedicated E2E file already covers its internal
 * behavior in depth — this file only covers the SEAMS between them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { conversationService } from "../services/conversation.service";
import { llmService } from "../services/llm.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  extract: fitnessAgentDeps.profileExtractor.extract,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  queueNutritionPlanGeneration: conversationService.queueNutritionPlanGeneration,
  getNutritionTargetPreview: fitnessAgentDeps.tools.getNutritionTargetPreview,
  getHealthStatus: llmService.getHealthStatus,
};

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  conversationService.queueNutritionPlanGeneration = original.queueNutritionPlanGeneration;
  fitnessAgentDeps.tools.getNutritionTargetPreview = original.getNutritionTargetPreview;
  llmService.getHealthStatus = original.getHealthStatus;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Cross-domain workflow test" } });
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function stubCrossDomainFixtures() {
  // A "real profile" already carrying goal/days/sessionMinutes — the exact
  // context CREATE_WORKOUT_PLAN, CREATE_NUTRITION_PLAN and FIND_PT all read
  // from, so reuse across them is exercised for real rather than assumed.
  const profile: Record<string, unknown> = {
    goal: "MUSCLE_GAIN", days: [1, 2, 3, 4, 5], sessionMinutes: 60, budgetVnd: 1_500_000,
  };
  const calls = { findPTCandidates: [] as any[], queueNutritionPlanGeneration: [] as any[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: (profile.days as number[]).length, availableEquipment: ["barbell", "dumbbell", "cable", "rack"], injuries: [], preferredTrainingDays: profile.days },
    },
  } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_identity: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
  fitnessAgentDeps.tools.findPTCandidates = async (_identity: any, preferences: any) => {
    calls.findPTCandidates.push(preferences);
    return { candidates: [], truncated: false, historyAuditId: null } as any;
  };
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: "COMPUTED", calories: 2000, protein: 140, carbs: 220, fat: 60 } as any);
  conversationService.queueNutritionPlanGeneration = async (params: any) => {
    calls.queueNutritionPlanGeneration.push(params);
    return { planId: randomUUID(), jobId: `job-${randomUUID()}`, status: "QUEUED" } as any;
  };
  return { profile, calls };
}

test("Cross-workflow context reuse (real DB): CREATE_WORKOUT_PLAN then CREATE_NUTRITION_PLAN both reuse the SAME already-known goal/days/sessionMinutes, no redundant re-asking", async () => {
  stubCrossDomainFixtures();
  const userId = `agent-workflow-crossdomain-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // CREATE_WORKOUT_PLAN: daysPerWeek(5) and sessionMinutes(60) are both
    // already known from context — must go straight to a real draft, no
    // WORKFLOW_MISSING_DATA turn re-asking either.
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "daysPerWeek/sessionMinutes must be reused from context, not re-asked");

    // CREATE_NUTRITION_PLAN: goal is reused from the SAME context
    // (profileExtractor.extract's profile.goal); only mealsPerDay (which
    // has no context source at all) needs asking.
    const r2 = await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.deepEqual((r2!.blocks[0] as any).missing, ["số bữa mỗi ngày"], "goal must never be asked again — CREATE_NUTRITION_PLAN has no goal slot of its own precisely because it already reuses profile.goal");
    const r3 = await fitnessAgent.tryTurn("4 bữa", identity, session.id);
    assert.match(r3!.answer, /tính toán|1-2 phút/i);
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("Workflow switch (real DB): a pending CREATE_WORKOUT_PLAN is cleanly cancelled by 'Khoan, tìm PT cho tôi trước', with no slot leakage into FIND_PT", async () => {
  const { calls } = stubCrossDomainFixtures();
  const userId = `agent-workflow-switch-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // Force CREATE_WORKOUT_PLAN to genuinely have a slot pending: no
    // sessionMinutes on file for THIS test's profile variant. `undefined`
    // (not `null`) — fitness-agent.service.ts's shared PT/PROGRAM
    // preferences builder passes context.profile.sessionMinutes straight
    // into AgentPreferencesSchema.parse() with no `?? undefined` guard, so
    // a literal `null` here would throw a ZodError once the switch below
    // reaches FIND_PT's own preferences build — `undefined` is what a
    // genuinely-unset EnterpriseContext field looks like.
    fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
      profile: { goal: "MUSCLE_GAIN", days: [1, 2, 3, 4, 5], sessionMinutes: undefined, budgetVnd: 1_500_000 },
      coach: { training_summary: {}, nutrition_summary: {} },
    } as any);
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    const activeBefore = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(activeBefore!.workflowType, "CREATE_WORKOUT_PLAN");
    assert.equal(activeBefore!.status, "COLLECTING_SLOTS");

    // Switching to FIND_PT (a DIFFERENT gatesIntentKind) must cancel the
    // pending CREATE_WORKOUT_PLAN and start FIND_PT fresh — goal/days ARE
    // legitimately reused (both slots read the exact same EnterpriseContext
    // fields FIND_PT's own workflow defines), but the workout-specific
    // sessionMinutes slot answer must never leak into FIND_PT's state, and
    // FIND_PT must ask for its OWN still-missing requirement (budgetVnd is
    // known here, so nothing should be missing at all — straight to search).
    const r2 = await fitnessAgent.tryTurn("Khoan, tìm PT cho tôi trước", identity, session.id);
    const cancelledWorkout = await prisma.agentWorkflowSession.findFirst({ where: { userId, workflowType: "CREATE_WORKOUT_PLAN" } });
    assert.equal(cancelledWorkout!.status, "CANCELLED", "switching workflows must cancel the old one explicitly, never leave it dangling as still-active");
    assert.ok(calls.findPTCandidates.length > 0, "must reach the real PT search, not get stuck asking about the abandoned workout workflow");
    const searchedPreferences = calls.findPTCandidates[0];
    assert.equal(searchedPreferences.goal, "MUSCLE_GAIN");
    assert.deepEqual(searchedPreferences.days, [1, 2, 3, 4, 5]);
    assert.equal(searchedPreferences.sessionMinutes, undefined, "FIND_PT's own default 60 comes from AgentPreferencesSchema, not a leaked CREATE_WORKOUT_PLAN slot answer");
    assert.equal(r2!.blocks[0].type, "PT_RECOMMENDATIONS");

    // The abandoned workout draft must never resurface as a competing
    // pending action once the user goes back to workout later.
    const pendingWorkoutActions = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(pendingWorkoutActions.length, 0, "no CREATE_WORKOUT_PLAN action should exist — it never got far enough to create one before being switched away from");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
