/**
 * CREATE_WORKOUT_PLAN — standalone "tạo lịch tập cho tôi" workflow
 * (docs/standalone-workout-workflow-design.md). Exercises the REAL chain
 * against a real DB (same convention as agent-workflow-roadmap-e2e.test.ts),
 * stubbing only the HTTP-boundary tools (searchExerciseByName,
 * getExerciseSubstitute, importAiPlanToSchedule, getUserFitnessContext,
 * profileExtractor.extract). intentRouter/inputParser/recommendationEngine
 * run for REAL — this is a new CALLER of the existing deterministic
 * generation pipeline, not a second implementation of it.
 *
 *   fitnessAgent.tryTurn("tạo lịch tập cho tôi")
 *     -> daysPerWeek already known (context.profile.days.length), only
 *        sessionMinutes is missing -> WORKFLOW_MISSING_DATA
 *   fitnessAgent.tryTurn("1 tiếng")
 *     -> workflow completes (WORKFLOW_ONLY, no PROFILE_FACT confirmation)
 *        -> auto-resumes CREATE_WORKOUT_PLAN -> real draft -> WORKOUT_PLAN_PREVIEW
 *   fitnessAgent.tryTurn("Ngày chân nhẹ hơn.")
 *     -> draft-only set reduction on the matched day, SAME action id
 *   fitnessAgent.tryTurn("Đổi squat.")
 *     -> draft-only substitution via the real substitution-service tool,
 *        canonical exerciseId only — never a raw name
 *   fitnessAgent.execute(actionId, true)
 *     -> importAiPlanToSchedule called exactly once; a repeated confirm
 *        never duplicates the write
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  extract: fitnessAgentDeps.profileExtractor.extract,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName,
  getExerciseSubstitute: fitnessAgentDeps.tools.getExerciseSubstitute,
  importAiPlanToSchedule: fitnessAgentDeps.tools.importAiPlanToSchedule,
};

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.tools.getExerciseSubstitute = original.getExerciseSubstitute;
  fitnessAgentDeps.tools.importAiPlanToSchedule = original.importAiPlanToSchedule;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Create workout plan workflow test" } });
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Shared fixture rig — a 5-day/week, fully-equipped MUSCLE_GAIN profile so
 * recommendationEngine's real template includes a "Legs A" day (Back
 * Squat/Romanian Deadlift/...) for the muscle-group and named-exercise
 * revision assertions below (see recommendation_engine.ts::legsDayA). */
function stubWorkoutFixtures(overrides: { days?: number[]; sessionMinutes?: number | null } = {}) {
  const profile: Record<string, unknown> = {
    goal: "MUSCLE_GAIN", days: overrides.days ?? [1, 2, 3, 4, 5],
    sessionMinutes: overrides.sessionMinutes ?? null,
  };
  const calls = {
    importAiPlanToSchedule: [] as any[], getExerciseSubstitute: [] as any[],
  };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: {
        trainingDaysPerWeek: (profile.days as number[]).length,
        availableEquipment: ["barbell", "dumbbell", "cable", "rack", "bodyweight"],
        injuries: [], preferredTrainingDays: profile.days,
      },
    },
  } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_identity: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
  fitnessAgentDeps.tools.getExerciseSubstitute = async (_identity: any, exerciseId: string, excludeExerciseIds: string[] = []) => {
    calls.getExerciseSubstitute.push({ exerciseId, excludeExerciseIds });
    return { id: `sub-${exerciseId}`, exerciseName: `Thay thế cho ${exerciseId}` };
  };
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_identity: any, payload: any) => {
    calls.importAiPlanToSchedule.push(payload);
    return { message: "đã lưu" } as any;
  };
  return { profile, calls };
}

test("CREATE_WORKOUT_PLAN golden flow (real DB): asks only for sessionMinutes, resumes into a real draft, revises twice draft-only, confirms exactly once", async () => {
  const { calls } = stubWorkoutFixtures();
  const userId = `agent-workflow-workout-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // Turn 1: daysPerWeek (5) is already known from context.profile.days —
    // only sessionMinutes must be asked.
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.ok(r1, "turn 1 must produce an answer");
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.deepEqual((r1!.blocks[0] as any).missing, ["thời lượng mỗi buổi"], "daysPerWeek must never be re-asked when already known from context");

    // Turn 2: "1 tiếng" resolves sessionMinutes -> workflow completes
    // (WORKFLOW_ONLY, no PROFILE_FACT confirmation needed) -> auto-resumes
    // straight into a real generated draft.
    const r2 = await fitnessAgent.tryTurn("1 tiếng", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "must resume straight into the real draft, never stop at a bare acknowledgement");
    const block2 = r2!.blocks[0] as any;
    assert.equal(block2.sessionMinutes, 60);
    assert.ok(block2.daysPerWeek >= 1);
    assert.ok(Array.isArray(block2.days) && block2.days.length > 0);
    const actionId = block2.actionId as string;
    const actionAfterCreate = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal(actionAfterCreate!.kind, "CREATE_WORKOUT_PLAN");
    const payloadAfterCreate = actionAfterCreate!.payload as any;
    assert.ok(
      payloadAfterCreate.weeklySchedule.every((d: any) => d.exercises.every((e: any) => typeof e.exerciseId === "string" && e.exerciseId.length > 0)),
      "every exercise must already carry a resolved canonical exerciseId — never a raw name",
    );
    const legsDayBefore = payloadAfterCreate.weeklySchedule.find((d: any) => /legs/i.test(d.day));
    assert.ok(legsDayBefore, "fixture profile must produce a Legs day to exercise the revision assertions below");
    const setsBefore = legsDayBefore.exercises[0].sets as number;

    // Turn 3: "Ngày chân nhẹ hơn." — draft-only set reduction on the
    // matched day(s), same action id, zero business writes.
    const r3 = await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", identity, session.id);
    assert.equal(r3!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r3!.blocks[0] as any).actionId, actionId, "a revision must update the SAME pending action, never create a second CREATE_WORKOUT_PLAN");
    const actionAfterLighten = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const payloadAfterLighten = actionAfterLighten!.payload as any;
    const legsDayAfterLighten = payloadAfterLighten.weeklySchedule.find((d: any) => /legs/i.test(d.day));
    assert.ok(legsDayAfterLighten.exercises[0].sets < setsBefore, "the matched day's sets must genuinely decrease, not just echo the same draft back");

    // Turn 4: "Đổi squat." — named-exercise substitution via the real
    // substitution-service tool; must resolve to a NEW canonical
    // exerciseId, never a raw string.
    const r4 = await fitnessAgent.tryTurn("Đổi squat.", identity, session.id);
    assert.equal(r4!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r4!.blocks[0] as any).actionId, actionId);
    assert.ok(calls.getExerciseSubstitute.length > 0, "must call the real substitution-service tool, not a coarse local swap");
    const actionAfterSwap = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const payloadAfterSwap = actionAfterSwap!.payload as any;
    const allExerciseIds = payloadAfterSwap.weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
    assert.ok(allExerciseIds.every((id: string) => typeof id === "string" && id.length > 0), "every exercise must still carry a resolved canonical exerciseId after revision — never a raw name");
    assert.ok(!allExerciseIds.some((id: string) => id === "ex-back-squat"), "the excluded exercise must genuinely be gone from the draft, not merely relabeled");

    // Turn 5: explicit confirm via the EXISTING, unmodified execute() path.
    const r5 = await fitnessAgent.execute(identity, actionId, true);
    assert.equal((r5 as any).type, "ACTION_RESULT");
    assert.equal(calls.importAiPlanToSchedule.length, 1, "must persist exactly once");
    assert.equal(calls.importAiPlanToSchedule[0].sourcePlanId, actionId);
    const finalAction = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal(finalAction!.status, "COMPLETED");

    // Re-confirming (double-click/SSE-retry) must never duplicate the write.
    const r5b = await fitnessAgent.execute(identity, actionId, true);
    assert.deepEqual(r5b, r5, "re-confirming an already-COMPLETED action must return the stored result, not re-run");
    assert.equal(calls.importAiPlanToSchedule.length, 1, "must not import the plan a second time");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN no-repeat E2E (real DB): when daysPerWeek and sessionMinutes are already known, the AI never asks and no workflow row is ever created", async () => {
  stubWorkoutFixtures({ sessionMinutes: 45 });
  const userId = `agent-workflow-workout-norepeat-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "with every required slot already known, the very first turn must go straight to the real draft — no WORKFLOW_MISSING_DATA turn at all");
    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.equal(rows.length, 0, "no workflow row should ever be created when there is nothing to collect");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN session-length revision (real DB): 'Buổi tập ngắn xuống 20 phút.' retrims exercises and is never misread as a day-count change", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-duration-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const before = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const exerciseCountBefore = (before!.payload as any).weeklySchedule[0].exercises.length;

    const r2 = await fitnessAgent.tryTurn("Buổi tập ngắn xuống 20 phút.", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r2!.blocks[0] as any).sessionMinutes, 20, "must be read as a session-length change (20), never a day-count change (from the bare digit '20')");
    const after = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const payloadAfter = after!.payload as any;
    assert.equal(payloadAfter.sessionMinutes, 20);
    assert.ok(payloadAfter.weeklySchedule[0].exercises.length <= exerciseCountBefore, "a shorter session must never end up with MORE exercises than the original draft");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN unsupported revision (real DB): 'Thêm superset.' is answered honestly, never silently accepted or misread as an exercise edit", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-superset-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const r2 = await fitnessAgent.tryTurn("Thêm superset.", identity, session.id);
    assert.match(r2!.answer, /chưa hỗ trợ/i);
    assert.equal((r2!.blocks[0] as any).actionId, actionId, "must still return the current draft unchanged, not drop it");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN save-collision guard (real DB): a free-text 'lưu lịch tập này' while a draft is pending is redirected to the real pending draft, never a competing SAVE_GENERATED_PLAN action", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-collision-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const r2 = await fitnessAgent.tryTurn("lưu lịch tập này", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r2!.blocks[0] as any).actionId, actionId, "must redirect to the SAME pending CREATE_WORKOUT_PLAN action, never create a competing SAVE_GENERATED_PLAN one");
    const competing = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "SAVE_GENERATED_PLAN" } });
    assert.equal(competing.length, 0);
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
