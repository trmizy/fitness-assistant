/**
 * Phase 3 R2 — N4: draft-time equipment validation must never present a
 * degraded/unchecked draft as if it had been verified compatible. Confirm-time
 * validation (fitness-service's own hard backstop) is untouched by this file —
 * only the PREVIEW-time truthfulness of applyEquipmentFiltering/
 * generateWorkoutDraft (fitness-agent.service.ts) is covered here, reusing the
 * real tryTurn()/proposeWorkoutPlan() path, same stubbing convention as
 * agent-workflow-create-workout-plan.test.ts (stub only the HTTP-boundary
 * tools; intentRouter/inputParser/recommendationEngine run for real).
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
  return prisma.chatSession.create({ data: { userId, title: "N4 equipment preview degraded test" } });
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function stubCommonFixtures(validatePlanEquipment: typeof fitnessAgentDeps.tools.validatePlanEquipment) {
  const profile: Record<string, unknown> = { goal: "MUSCLE_GAIN", days: [1, 2, 3], sessionMinutes: 60 };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: (profile.days as number[]).length, availableEquipment: ["barbell", "dumbbell"], injuries: [], preferredTrainingDays: profile.days },
    },
  } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_identity: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
  fitnessAgentDeps.tools.getExerciseSubstitute = async () => ({ id: `sub-x`, exerciseName: "Thay thế" });
  fitnessAgentDeps.tools.validatePlanEquipment = validatePlanEquipment as any;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_identity: any, payload: any) => ({ message: "đã lưu", sourcePlanId: payload.sourcePlanId } as any);
}

test("A. validator reachable, no violations: normal draft, no degraded warning", async () => {
  stubCommonFixtures(async () => ({ valid: true, violations: [], skippedNoUserEquipment: false }));
  const identity = { userId: `n4-a-${randomUUID()}` } as any;
  const session = await seedSession(identity.userId);
  const r = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
  const block = r!.blocks[0] as any;
  assert.equal(block.type, "WORKOUT_PLAN_PREVIEW");
  assert.ok(!block.warnings.some((w: string) => /chưa kiểm tra được/.test(w)), "no degraded-equipment warning when the validator genuinely ran");
});

test("B. validator throws (network/timeout): draft is still shown but carries a truthful degraded warning, not silence", async () => {
  stubCommonFixtures(async () => { throw new Error("ECONNREFUSED"); });
  const identity = { userId: `n4-b-${randomUUID()}` } as any;
  const session = await seedSession(identity.userId);
  const r = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
  const block = r!.blocks[0] as any;
  assert.equal(block.type, "WORKOUT_PLAN_PREVIEW", "draft generation itself must not fail just because the validator is down");
  assert.ok(block.warnings.some((w: string) => /chưa kiểm tra được/.test(w)), "must truthfully disclose that equipment was not verified");
  // Never hallucinate compatibility: no substitution/drop claim when nothing was actually checked.
  assert.ok(!/đổi .* bài tập sang phiên bản phù hợp|không phù hợp với thiết bị/.test(r!.answer));
});

test("C. validator returns a malformed shape: same safe degraded result, no crash", async () => {
  stubCommonFixtures(async () => (null as any));
  const identity = { userId: `n4-c-${randomUUID()}` } as any;
  const session = await seedSession(identity.userId);
  const r = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
  const block = r!.blocks[0] as any;
  assert.equal(block.type, "WORKOUT_PLAN_PREVIEW");
  assert.ok(Array.isArray(block.days) && block.days.length > 0, "a null/malformed validator response must not break draft generation");
});

test("D. no authoritative persistence while degraded: proposing a degraded draft never calls importAiPlanToSchedule", async () => {
  let importCalls = 0;
  stubCommonFixtures(async () => { throw new Error("ETIMEDOUT"); });
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_identity: any, payload: any) => { importCalls += 1; return { message: "đã lưu", sourcePlanId: payload.sourcePlanId } as any; };
  const identity = { userId: `n4-d-${randomUUID()}` } as any;
  const session = await seedSession(identity.userId);
  await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
  assert.equal(importCalls, 0, "proposing/previewing a draft must never itself persist, degraded or not");
});

test("E. validator recovers on a later turn: a regenerated draft in the same session no longer carries the degraded warning", async () => {
  let shouldFail = true;
  stubCommonFixtures(async () => {
    if (shouldFail) throw new Error("ECONNREFUSED");
    return { valid: true, violations: [], skippedNoUserEquipment: false };
  });
  const identity = { userId: `n4-e-${randomUUID()}` } as any;
  const session = await seedSession(identity.userId);
  const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
  assert.ok((r1!.blocks[0] as any).warnings.some((w: string) => /chưa kiểm tra được/.test(w)), "first proposal must disclose the outage");

  shouldFail = false;
  const r2 = await fitnessAgent.tryTurn("4 buổi mỗi tuần", identity, session.id);
  const block2 = r2!.blocks[0] as any;
  assert.equal(block2.type, "WORKOUT_PLAN_PREVIEW");
  assert.ok(!block2.warnings.some((w: string) => /chưa kiểm tra được/.test(w)), "once the validator is reachable again, the degraded warning must not persist on a fresh regeneration");
});
