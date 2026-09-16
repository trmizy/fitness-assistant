/**
 * Conversational AI Coach workflow orchestration — FIND_TRAINING_PROGRAM
 * DB-backed E2E. Exercises a real bug this module's own development caught:
 * FIND_PT/FIND_TRAINING_PROGRAM collect goal/days (WORKFLOW_ONLY —
 * deliberately never written to UserProfile, see find-pt-program.workflow.ts)
 * into workflow-local state, and the resumed dispatch in
 * fitness-agent.service.ts::tryTurn must thread those collected values back
 * in (`resumeKnownSlots`) or it would re-derive preferences from the
 * (unchanged) profile alone and immediately re-ask what the user just
 * answered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  getScientificEvidence: fitnessAgentDeps.tools.getScientificEvidence,
};

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.tools.getScientificEvidence = original.getScientificEvidence;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Program workflow E2E test" } });
}

test("FIND_TRAINING_PROGRAM E2E (real DB): collects goal+days over chat (never persisted to profile), then auto-resumes the REAL program search with exactly those values — never re-asks", async () => {
  // Deliberately empty goal/days — nothing for the workflow to reuse from
  // the profile, so BOTH slots must be asked over chat.
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { goal: null, experience: "BEGINNER", days: [], sessionMinutes: 60, budgetVnd: null,
      reviewRequired: false, injuries: [], equipment: [], goalIntent: null },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  let findCalledWith: any = null;
  fitnessAgentDeps.tools.findTrainingPrograms = async (_identity: any, preferences: any) => {
    findCalledWith = preferences;
    return { programs: [{ id: "prog-e2e", name: "Program", goal: preferences.goal, daysPerWeek: 3, durationWeeks: 8,
      estimatedMinutes: 60, experienceLevel: "BEGINNER", focusMuscles: [], fingerprint: "fp-prog-e2e", dataOrigin: "REAL", days: [] }], warnings: [] } as any;
  };
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;

  const userId = `agent-workflow-program-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("Gợi ý chương trình tập cho tôi", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA", "with no goal/days known anywhere, the workflow must ask before searching");
    assert.equal(findCalledWith, null, "must not search before required preferences are known");

    const r2 = await fitnessAgent.tryTurn("tăng cơ", identity, session.id);
    assert.equal(r2!.blocks[0].type, "WORKFLOW_MISSING_DATA", "days is still missing — must ask next, not search yet");
    assert.equal((r2!.blocks[0] as any).missing.length, 1);

    const r3 = await fitnessAgent.tryTurn("T2 T4 T6", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROGRAM_RECOMMENDATIONS", "once both WORKFLOW_ONLY slots are known, the workflow must auto-resume straight into the real search — not ask the user to repeat 'Gợi ý chương trình tập cho tôi'");
    assert.ok(findCalledWith, "the real findTrainingPrograms boundary must have been called");
    const called = findCalledWith as Record<string, any>;
    assert.equal(called.goal, "MUSCLE_GAIN", "the goal collected over chat must reach the real search, even though it was never written to the profile");
    assert.deepEqual(called.days, [1, 3, 5], "the days collected over chat must reach the real search");

    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.equal(rows.filter(r => r.status !== "COMPLETED").length, 0, "the workflow must be COMPLETED, not left dangling, once resumed");
  } finally {
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
