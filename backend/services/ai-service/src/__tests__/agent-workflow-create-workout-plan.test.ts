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
  validatePlanEquipment: fitnessAgentDeps.tools.validatePlanEquipment,
  importAiPlanToSchedule: fitnessAgentDeps.tools.importAiPlanToSchedule,
};

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.tools.getExerciseSubstitute = original.getExerciseSubstitute;
  fitnessAgentDeps.tools.validatePlanEquipment = original.validatePlanEquipment;
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
function stubWorkoutFixtures(overrides: {
  days?: number[]; sessionMinutes?: number | null;
  // Phase 2 (FR09/EX03/AC25/AC09) hooks — default is "fully equipment-compliant,
  // never called the real fitness-service". A test opts into a violation
  // scenario by naming which generated exerciseIds should fail the
  // equipment check; getExerciseSubstitute's return can likewise be
  // overridden per-exerciseId (e.g. to force "no substitute exists").
  violatingExerciseIds?: (weeklySchedule: any[]) => string[];
  substituteFor?: (exerciseId: string) => { id: string; exerciseName: string } | null;
} = {}) {
  const profile: Record<string, unknown> = {
    goal: "MUSCLE_GAIN", days: overrides.days ?? [1, 2, 3, 4, 5],
    sessionMinutes: overrides.sessionMinutes ?? null,
  };
  const calls = {
    importAiPlanToSchedule: [] as any[], getExerciseSubstitute: [] as any[], validatePlanEquipment: [] as any[],
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
    if (overrides.substituteFor) return overrides.substituteFor(exerciseId);
    return { id: `sub-${exerciseId}`, exerciseName: `Thay thế cho ${exerciseId}` };
  };
  fitnessAgentDeps.tools.validatePlanEquipment = async (_identity: any, weeklySchedule: any[]) => {
    calls.validatePlanEquipment.push(weeklySchedule);
    const violating = overrides.violatingExerciseIds ? overrides.violatingExerciseIds(weeklySchedule) : [];
    return {
      valid: violating.length === 0,
      violations: violating.map((exerciseId) => ({ exerciseId })),
      skippedNoUserEquipment: false,
    };
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

test("CREATE_WORKOUT_PLAN exercise-count revision (real DB): '8 bai tap cho 1 ngay' is handled as draft shaping, never slow general QA", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-exercise-count-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const before = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const beforePayload = before!.payload as any;

    const r2 = await fitnessAgent.tryTurn("tôi muốn nâng lên 8 bài tập cho 1 ngày", identity, session.id);
    assert.ok(r2, "exercise-count revision must be owned by the pending workout draft");
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r2!.blocks[0] as any).actionId, actionId);
    assert.match(r2!.answer, /8 b[aà]i/i, "must answer about the requested exercises-per-session count");
    assert.match(r2!.answer, /chưa thay đổi lịch|chua thay doi lich/i, "unsafe over-capacity requests must not silently mutate the draft");

    const after = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.deepEqual((after!.payload as any).weeklySchedule, beforePayload.weeklySchedule, "requesting more exercises than the current duration supports must leave the draft unchanged");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN exercise-count revision with no live draft is answered deterministically, never delegated to general QA", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-exercise-count-no-draft-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r = await fitnessAgent.tryTurn("tôi muốn nâng lên 8 bài tập cho 1 ngày", identity, session.id);
    assert.ok(r, "no-draft exercise-count correction must not return null to the LLM path");
    assert.equal(r!.blocks.length, 0);
    assert.match(r!.answer, /bản nháp lịch tập|ban nhap lich tap/i);
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

// ───────────────────────── Phase 2B GAP-A: interruption/resume ─────────────────────────
// FR15/EX09/EX10/AC31/AC32, CREATE_WORKOUT_PLAN-specific (the traceability matrix's own PARTIAL
// note: the mechanism is proven generically for OTHER workflows, not yet for this one). The real
// interruption-preserving mechanism (global/global-turn.ts's runGlobalTurn) only engages when
// CONVERSATIONAL_INTELLIGENCE_V2="on" (confirmed: production's own default is "off" —
// docs/research/workout-plan-bpm/02-as-is-process.md:8-10 — so this test explicitly opts the flag
// on for its own duration, exactly like the existing conversational-intelligence-remediation.test.ts/
// conversational-intelligence-v2.test.ts files already do for other workflows; it is not inventing a
// new mechanism, just exercising this workflow against the one the codebase already built and tests
// elsewhere).
const originalCiV2 = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
test.afterEach(() => {
  if (originalCiV2 === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalCiV2;
});

test("CREATE_WORKOUT_PLAN interruption/resume (real DB): an unrelated supported READ (goal question) while sessionMinutes is still pending does not corrupt workflow state, and the SAME workflow resumes afterward (FR15/AC31/AC32)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubWorkoutFixtures({ sessionMinutes: null }); // sessionMinutes genuinely missing -> T1 asks for it
  const userId = `agent-workflow-workout-interrupt-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // T1 — start CREATE_WORKOUT_PLAN; daysPerWeek is already known (profile.days), only
    // sessionMinutes must be asked -> a real AgentWorkflowSession row, COLLECTING_SLOTS.
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.ok(before, "a real workflow row must exist while sessionMinutes is pending");
    assert.equal(before!.status, "COLLECTING_SLOTS");
    assert.equal(before!.expectedSlot, "sessionMinutes");
    const beforeSnapshot = { id: before!.id, workflowType: before!.workflowType, userId: before!.userId, sessionId: before!.sessionId, status: before!.status, expectedSlot: before!.expectedSlot, slotsJson: JSON.stringify(before!.slotsJson) };

    // T2 — an unrelated, already-supported READ (route: READ_STATE, topic: GOAL — see
    // conversational-intelligence/global/router.ts) phrased as a real question. Must route to the
    // deterministic Enterprise Data read, NOT be interpreted as a sessionMinutes answer/correction.
    const r2 = await fitnessAgent.tryTurn("Mục tiêu tập luyện hiện tại của tôi là gì?", identity, session.id);
    assert.ok(r2, "the unrelated read must be answered, not silently dropped");
    assert.match(r2!.answer, /Mục tiêu hiện tại của bạn là/i, "must answer from the real profile read (readGoal), never interpreted as a workout slot reply");
    assert.match(r2!.answer, /vẫn đang.*dở/is, "must remind the user the workout workflow is still waiting (reminder())");
    assert.equal(r2!.blocks.length, 0, "a pure READ_STATE answer carries no WORKOUT_PLAN_PREVIEW/WORKFLOW_MISSING_DATA block");

    const afterInterrupt = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.ok(afterInterrupt, "the workflow row must still exist — never cancelled/replaced by the interruption");
    const afterSnapshot = { id: afterInterrupt!.id, workflowType: afterInterrupt!.workflowType, userId: afterInterrupt!.userId, sessionId: afterInterrupt!.sessionId, status: afterInterrupt!.status, expectedSlot: afterInterrupt!.expectedSlot, slotsJson: JSON.stringify(afterInterrupt!.slotsJson) };
    assert.deepEqual(afterSnapshot, beforeSnapshot, "every semantic field (identity, type, ownership, status, expectedSlot, candidate slot values) must be byte-identical before vs after the interruption — only updatedAt (not compared) may legitimately change");
    const rowCountAfterInterrupt = await prisma.agentWorkflowSession.count({ where: { userId } });
    assert.equal(rowCountAfterInterrupt, 1, "the interruption must never create a second/competing workflow row");
    const actionsAfterInterrupt = await prisma.fitnessAgentAction.count({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(actionsAfterInterrupt, 0, "the interruption must never produce a premature draft/WorkoutProgram");

    // T3 — resume with the originally-requested slot value. Must continue the SAME workflow row
    // (no restart) straight through to a real generated draft (EX10/AC32).
    const r3 = await fitnessAgent.tryTurn("1 tiếng", identity, session.id);
    assert.equal(r3!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "must resume straight into the real draft, not re-ask or restart");
    const actionId = (r3!.blocks[0] as any).actionId as string;
    const rowCountAfterResume = await prisma.agentWorkflowSession.count({ where: { userId } });
    assert.equal(rowCountAfterResume, 1, "resuming must complete the SAME row, never create a second one");
    const resumedWorkflow = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(resumedWorkflow!.id, beforeSnapshot.id, "the completed row must be the SAME id the interruption left untouched");
    assert.equal(resumedWorkflow!.status, "COMPLETED");

    // T4 — valid continuation: explicit confirmation of the preserved draft.
    const r4 = await fitnessAgent.execute(identity, actionId, true);
    assert.equal((r4 as any).type, "ACTION_RESULT");
    const finalAction = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal(finalAction!.status, "COMPLETED", "the draft preserved across the interruption must still be confirmable end-to-end");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN equipment-aware draft generation (real DB): a violating exercise is substituted with a real equipment-compatible alternative before the user ever sees it (FR09/AC09/AC25/EX03)", async () => {
  const { calls } = stubWorkoutFixtures({
    sessionMinutes: 60,
    violatingExerciseIds: (weeklySchedule) => {
      const ids = weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
      return ids.includes("ex-back-squat") ? ["ex-back-squat"] : [];
    },
  });
  const userId = `agent-workflow-workout-equip-sub-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.ok(calls.validatePlanEquipment.length > 0, "the draft-time equipment check must actually run, not just the confirm-time one");
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const allIds = (action!.payload as any).weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
    assert.ok(!allIds.includes("ex-back-squat"), "the equipment-violating exercise must never reach the presented draft");
    assert.ok(allIds.includes("sub-ex-back-squat"), "it must be replaced with a real substitute, not just dropped");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN equipment-aware draft generation (real DB): a violating exercise with no real substitute is dropped and honestly disclosed, not silently kept (EX03 recovery path)", async () => {
  stubWorkoutFixtures({
    sessionMinutes: 60,
    violatingExerciseIds: (weeklySchedule) => {
      const ids = weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
      return ids.includes("ex-back-squat") ? ["ex-back-squat"] : [];
    },
    substituteFor: () => null,
  });
  const userId = `agent-workflow-workout-equip-drop-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "one dropped exercise must not block the whole plan");
    assert.match(r1!.answer, /không phù hợp với thiết bị/i, "must honestly disclose the equipment-based drop, not silently omit it");
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const allIds = (action!.payload as any).weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
    assert.ok(!allIds.includes("ex-back-squat"), "the violating exercise must be gone");
    assert.ok(!allIds.includes("sub-ex-back-squat"), "with no real substitute it must be DROPPED, never a fabricated placeholder");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN equipment-aware draft generation (real DB): if every candidate exercise is equipment-incompatible with no substitutes, generation fails honestly instead of persisting a misleading empty draft (AC29/EX07)", async () => {
  stubWorkoutFixtures({
    sessionMinutes: 60,
    violatingExerciseIds: (weeklySchedule) => weeklySchedule.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId)),
    substituteFor: () => null,
  });
  const userId = `agent-workflow-workout-equip-empty-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.ok(r1, "must still answer honestly, not throw or hang");
    assert.equal(r1!.blocks.length, 0, "must never show a WORKOUT_PLAN_PREVIEW block for an empty result");
    const actions = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(actions.length, 0, "an empty generation must leave no misleading FitnessAgentAction row behind");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN daysPerWeek correction (real DB): 'Tôi muốn tập 3 buổi.' then 'Không, đổi thành 5 buổi.' resolves to 5 — never 3, never an average (AC05/AC26)", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-dayscorrect-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;

    const r2 = await fitnessAgent.tryTurn("Tôi muốn tập 3 buổi.", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r2!.blocks[0] as any).actionId, actionId, "a day-count correction must update the SAME pending action");
    assert.equal((r2!.blocks[0] as any).daysPerWeek, 3, "the first stated value must take effect");

    const r3 = await fitnessAgent.tryTurn("Không, đổi thành 5 buổi.", identity, session.id);
    assert.equal(r3!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r3!.blocks[0] as any).actionId, actionId);
    assert.equal((r3!.blocks[0] as any).daysPerWeek, 5, "the LATER correction must win outright — never 3, and never an average of 3 and 5");

    const final = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal((final!.payload as any).weeklySchedule.length, 5);
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN downstream persistence failure at confirm (real DB): a failed importAiPlanToSchedule call releases the action back to PENDING, never stuck EXECUTING or falsely COMPLETED (AC38/EX16)", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-downfail-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async () => { throw Object.assign(new Error("fitness-service unavailable"), { status: 503 }); };
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;

    const r2 = await fitnessAgent.execute(identity, actionId, true);
    assert.equal((r2 as any).type, "ACTION_RESULT", "must answer honestly, not throw, when the downstream write fails");
    assert.match((r2 as any).message, /Không lưu được/);

    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.equal(action!.status, "PENDING", "a downstream failure must release the claim back to PENDING, never leave it stuck EXECUTING or falsely mark it COMPLETED");
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

test("CREATE_WORKOUT_PLAN weekday exercise-count revision (real DB): '8 bai tap cho thu 7' stays on the pending draft and never falls through to RAG", async () => {
  stubWorkoutFixtures({ days: [1, 2, 3, 4, 5, 6], sessionMinutes: 60 });
  const userId = `agent-workflow-workout-exercise-count-weekday-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("tao lich tap cho toi", identity, session.id);
    const actionId = (r1!.blocks[0] as any).actionId as string;
    const before = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const beforePayload = before!.payload as any;

    const r2 = await fitnessAgent.tryTurn("bay gio tang 8 bai tap cho thu 7", identity, session.id);
    assert.ok(r2, "weekday exercise-count revision must be owned by the workout draft");
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    assert.equal((r2!.blocks[0] as any).actionId, actionId);
    assert.match(r2!.answer, /8 b[aÃ ]i/i);
    assert.match(r2!.answer, /Thứ 7|Thu 7/i);
    assert.match(r2!.answer, /chưa thay đổi lịch|chua thay doi lich/i);

    const after = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.deepEqual((after!.payload as any).weeklySchedule, beforePayload.weeklySchedule, "over-capacity weekday revision must leave the draft unchanged");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("CREATE_WORKOUT_PLAN preview block normalizes exerciseName-shaped draft items instead of rendering blank bullets", async () => {
  stubWorkoutFixtures({ sessionMinutes: 60 });
  const userId = `agent-workflow-workout-preview-shape-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await prisma.fitnessAgentAction.create({
      data: {
        userId,
        sessionId: session.id,
        recommendationId: null,
        kind: "CREATE_WORKOUT_PLAN",
        risk: "MEDIUM",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 10 * 60000),
        payload: {
          goal: "MUSCLE_GAIN",
          sessionMinutes: 60,
          selectedWeekdays: [6],
          exclusions: [],
          weeklySchedule: [{
            day: "Thu 7 (Push)",
            goal: "Chest + shoulders",
            exercises: [
              { exerciseId: "ex-bench", exerciseName: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90 },
              { exerciseId: "ex-incline", exercise: { exerciseName: "Incline Dumbbell Press" }, sets: 3, reps: "10-12", restSeconds: 75 },
              { exerciseId: "ex-empty", sets: 3, reps: "12" },
            ],
          }],
        },
      },
    });

    const r = await fitnessAgent.tryTurn("them superset", identity, session.id);
    assert.ok(r, "unsupported revision must still return the current preview");
    assert.equal(r!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    const exercises = ((r!.blocks[0] as any).days[0].exercises as any[]);
    assert.deepEqual(exercises.map((e) => e.name), ["Bench Press", "Incline Dumbbell Press"]);
    assert.ok(exercises.every((e) => typeof e.name === "string" && e.name.length > 0), "preview must not emit blank exercise names");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
