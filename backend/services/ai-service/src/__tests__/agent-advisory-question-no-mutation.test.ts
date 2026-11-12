/**
 * V1 stabilization (2026-11-12) — B1-13 end to end through fitnessAgent.tryTurn on the isolated test DB.
 *
 * An advisory question about changing the schedule must fall through to the normal chat answer (tryTurn returns null) and must
 * leave NO agent action, NO workflow session behind. An explicit command for the same change still opens the existing
 * create-workout-plan flow (which itself still ends in a preview + explicit confirmation — not exercised again here).
 * Only HTTP-boundary tools are stubbed; nothing calls a model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const original = { getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext, extract: fitnessAgentDeps.profileExtractor.extract };
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
});
test.after(async () => { await prisma.$disconnect(); });

function stubProfile() {
  const profile = { goal: "MAINTENANCE", days: [1, 3, 5], sessionMinutes: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: profile.goal, experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 3, availableEquipment: ["dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: profile.days } },
  } as any);
}

async function sideEffects(userId: string) {
  const [actions, workflows] = await Promise.all([
    prisma.fitnessAgentAction.count({ where: { userId } }),
    prisma.agentWorkflowSession.count({ where: { userId } }),
  ]);
  return { actions, workflows };
}

for (const question of [
  "Tôi muốn đổi lịch tập từ 3 buổi lên 5 buổi mỗi tuần được không?",
  "Đổi lên 5 buổi được không?",
  "Nếu tập 5 buổi thì thế nào?",
  "Có nên tạo thực đơn riêng không?",
]) {
  test(`advisory question is answered by chat, not by the agent, and writes nothing: "${question}"`, async () => {
    stubProfile();
    const userId = `agent-advisory-${randomUUID()}`;
    const session = await prisma.chatSession.create({ data: { userId, title: "advisory gate" } });
    try {
      const r = await fitnessAgent.tryTurn(question, { userId } as any, session.id);
      assert.equal(r, null, `expected the normal chat path, got agent answer: ${r?.answer}`);
      assert.deepEqual(await sideEffects(userId), { actions: 0, workflows: 0 });
    } finally {
      await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { userId } }).catch(() => {});
    }
  });
}

test("explicit command for the same change still opens the create-workout-plan flow", async () => {
  stubProfile();
  const userId = `agent-advisory-cmd-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "advisory gate command" } });
  try {
    const r = await fitnessAgent.tryTurn("Hãy đổi lịch của tôi lên 5 buổi.", { userId } as any, session.id);
    assert.ok(r, "a command must be handled by the agent");
    assert.equal(r!.blocks[0]?.type, "WORKFLOW_MISSING_DATA", "the existing create flow asks for the missing slot first (no write)");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { userId } }).catch(() => {});
  }
});
