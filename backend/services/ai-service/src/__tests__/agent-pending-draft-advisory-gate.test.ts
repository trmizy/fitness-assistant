/**
 * V1 RC (2026-11-12), Priority 3 — a PENDING workout draft must only change on a real revision request.
 *
 *   1. "Tạo lịch tập cho tôi" + "1 tiếng"  → a WORKOUT_PLAN_PREVIEW draft (PENDING FitnessAgentAction)
 *   2. hypothetical / advisory questions    → the draft payload is byte-identical afterwards (no silent edit)
 *   3. a real revision ("Ngày chân nhẹ hơn.") still edits the SAME draft
 *   4. confirm executes exactly once
 * Real isolated test DB; only HTTP-boundary tools are stubbed; no model call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext, extract: fitnessAgentDeps.profileExtractor.extract,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName, getExerciseSubstitute: fitnessAgentDeps.tools.getExerciseSubstitute,
  validatePlanEquipment: fitnessAgentDeps.tools.validatePlanEquipment, importAiPlanToSchedule: fitnessAgentDeps.tools.importAiPlanToSchedule,
};
test.afterEach(() => { Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: original.getUserFitnessContext, searchExerciseByName: original.searchExerciseByName, getExerciseSubstitute: original.getExerciseSubstitute, validatePlanEquipment: original.validatePlanEquipment, importAiPlanToSchedule: original.importAiPlanToSchedule }); fitnessAgentDeps.profileExtractor.extract = original.extract; });
test.after(async () => { await prisma.$disconnect(); });

const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function stub() {
  const days = [1, 2, 3, 4, 5];
  const imports: unknown[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days, sessionMinutes: null }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [], training: { trainingDaysPerWeek: 5, availableEquipment: ["barbell", "dumbbell", "cable", "rack", "bodyweight"], injuries: [], preferredTrainingDays: days } } } as any);
  fitnessAgentDeps.tools.searchExerciseByName = async (_i: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
  fitnessAgentDeps.tools.getExerciseSubstitute = async (_i: any, id: string) => ({ id: `sub-${id}`, exerciseName: `Thay thế cho ${id}` });
  fitnessAgentDeps.tools.validatePlanEquipment = async () => ({ valid: true, violations: [], skippedNoUserEquipment: false } as any);
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, payload: any) => { imports.push(payload); return { message: "đã lưu" } as any; };
  return { imports };
}

const ADVISORY_WHILE_DRAFT_PENDING = [
  "Nếu tập 6 buổi thì sao?",
  "Nếu bỏ squat thì có ảnh hưởng gì không?",
  "Giả sử ngày chân nhẹ hơn thì có tốt hơn không?",
  "Tập 5 buổi có nhiều không?",
  "Squat có tốt cho người mới không?",
];

test("pending workflow slot: a HYPOTHETICAL is not taken as the slot answer (no draft generated); a real answer still is", async () => {
  stub();
  const userId = `agent-pending-slot-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "pending slot gate" } });
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    await fitnessAgent.tryTurn("Nếu tập 90 phút thì có quá dài không?", identity, session.id);
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } }), 0, "a hypothetical must not complete the slot and generate a draft");
    const r3 = await fitnessAgent.tryTurn("1 tiếng", identity, session.id);
    assert.equal(r3!.blocks[0].type, "WORKOUT_PLAN_PREVIEW", "the real answer still resumes the workflow");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { userId } }).catch(() => {});
  }
});

test("pending workout draft: hypothetical/advisory questions never edit it; a real revision does; confirm writes once", async () => {
  const { imports } = stub();
  const userId = `agent-pending-gate-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "pending draft gate" } });
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("1 tiếng", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKOUT_PLAN_PREVIEW");
    const actionId = (r2!.blocks[0] as any).actionId as string;
    const snapshot = async () => JSON.stringify((await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } }))!.payload);
    const before = await snapshot();

    const changedBy: string[] = [];
    let prev = before;
    for (const q of ADVISORY_WHILE_DRAFT_PENDING) {
      await fitnessAgent.tryTurn(q, identity, session.id);
      const now = await snapshot();
      if (now !== prev) {
        const a = JSON.parse(prev), b = JSON.parse(now);
        changedBy.push(`${q} [${[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(",")}]`);
      }
      prev = now;
    }
    assert.deepEqual(changedBy, [], "an advisory/hypothetical turn silently edited the pending draft");
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } }), 1, "no second draft");

    const r3 = await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", identity, session.id);
    assert.equal((r3!.blocks[0] as any).actionId, actionId, "a real revision edits the SAME draft");
    assert.notEqual(await snapshot(), before, "a real revision must change the draft");

    await fitnessAgent.execute(identity, actionId, true);
    await fitnessAgent.execute(identity, actionId, true).catch(() => {});
    assert.equal(imports.length, 1, "confirm persists exactly once");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { userId } }).catch(() => {});
  }
});
