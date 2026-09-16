/**
 * Training Program Recommendation DB-backed E2E — Codex Independent
 * Evaluation #1's §29/§30/§34/§38 requirement
 * (docs/codex-training-program-recommendation-evaluation-1.md: "DB E2E:
 * BLOCKED/UNVERIFIED... recommendation -> select -> confirmation -> apply
 * PASS by code inspection [only]").
 *
 * Exercises the REAL ai-service orchestration chain end to end, against a
 * real DB (ai-service's own `prisma.fitnessRecommendation`/
 * `fitnessAgentAction` tables), with REAL v2 scoring
 * (scoreTrainingProgramV2), REAL claim-catalog narration (no live LLM in
 * this test environment, so it exercises the deterministic default-selection
 * fallback path — itself a real, meaningful code path, not a mock):
 *
 *   fitnessAgent.tryTurn("PROGRAM" intent)
 *     -> fitnessAgentDeps.tools.findTrainingPrograms()  [STUBBED — the one
 *        real HTTP boundary to fitness-service; same convention as the
 *        existing goal-intent-loop test's findPTCandidates stub]
 *     -> scoreTrainingProgramV2() [REAL]
 *     -> narrateProgramRecommendations() [REAL, deterministic-fallback path]
 *     -> real prisma.fitnessRecommendation row [REAL DB]
 *   fitnessAgent.choose() -> fitnessAgent.prepare()
 *     -> real prisma.fitnessAgentAction row (ACTION_CONFIRMATION) [REAL DB]
 *   fitnessAgent.execute(actionId, confirmed=true)
 *     -> fitnessAgentDeps.tools.applyTrainingPlan() [STUBBED — the one real
 *        HTTP boundary to fitness-service; the fitness-service SIDE of this
 *        boundary — real hard filters, real DB write, idempotency, stale
 *        fingerprint — is independently DB-tested in
 *        fitness-service/src/__tests__/agent-program-apply-idempotency.test.ts
 *        and agent-program-equipment-semantics.test.ts]
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const originalGetContext = fitnessAgentDeps.tools.getUserFitnessContext;
const originalFindPrograms = fitnessAgentDeps.tools.findTrainingPrograms;
const originalGetEvidence = fitnessAgentDeps.tools.getScientificEvidence;
const originalApplyPlan = fitnessAgentDeps.tools.applyTrainingPlan;

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = originalGetContext;
  fitnessAgentDeps.tools.findTrainingPrograms = originalFindPrograms;
  fitnessAgentDeps.tools.getScientificEvidence = originalGetEvidence;
  fitnessAgentDeps.tools.applyTrainingPlan = originalApplyPlan;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Program E2E test" } });
}

function stubContext() {
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: {
      goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null,
      reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER",
      goalIntent: null,
    },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
}

function program(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: `Template ${id}`, goal: "MUSCLE_GAIN", daysPerWeek: 3, durationWeeks: 12,
    estimatedMinutes: 51, experienceLevel: "BEGINNER", focusMuscles: ["CHEST", "BACK"],
    fingerprint: `fp-${id}`, dataOrigin: "REAL", days: [],
    ...overrides,
  };
}

test("Program E2E (real DB, real v2 scoring): recommend -> choose -> confirm -> execute reaches the applyTrainingPlan boundary exactly once, with the REAL top-ranked v2 candidate", async () => {
  stubContext();
  const weakCandidate = program("prog-weak", { estimatedMinutes: 30, id: "prog-weak" });
  const strongCandidate = program("prog-strong", { estimatedMinutes: 51, id: "prog-strong" }); // closer to 85% of 60 = 51 -> real v2 winner
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({
    programs: [weakCandidate, strongCandidate], warnings: [],
  } as any);
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;

  let applyCalledWith: unknown;
  fitnessAgentDeps.tools.applyTrainingPlan = async (_identity: any, payload: any) => {
    applyCalledWith = payload;
    return { createdProgramId: "real-program-id-1", nextUrl: "/client/training" };
  };

  const userId = `agent-program-e2e-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const recommendResult = await fitnessAgent.tryTurn("Gợi ý chương trình tập cho tôi", { userId }, session.id);
    assert.ok(recommendResult, "recommend step must produce a real answer");
    const recBlock = recommendResult.blocks[0] as any;
    assert.equal(recBlock.type, "PROGRAM_RECOMMENDATIONS", "the real intent router must classify this as PROGRAM, not PT");
    assert.equal(recBlock.candidates[0].id, "prog-strong", "real scoreTrainingProgramV2 must rank the closer-to-target session duration first");
    assert.equal(recBlock.candidates[0].compatibility.scoringVersion, "program-compatibility-v2");

    const rec = await prisma.fitnessRecommendation.findFirst({ where: { userId, sessionId: session.id }, orderBy: { createdAt: "desc" } });
    assert.ok(rec, "a real FitnessRecommendation row must be persisted");
    assert.equal(rec!.scoringVersion, "program-compatibility-v2", "the stored scoringVersion must reflect the scorer actually used, not the retired v1 constant");

    // prepare(): real ACTION_CONFIRMATION, real FitnessAgentAction row —
    // the same function tryTurn's own "chọn số N" SELECT-intent branch
    // calls internally (see fitness-agent.service.ts::tryTurn's SELECT
    // handling), called directly here with the real recommendationId/
    // candidateId rather than round-tripping through intent-text parsing,
    // which is a separate, already-covered concern.
    const confirmationBlock = await fitnessAgent.prepare({ userId }, rec!.id, "prog-strong") as any;
    assert.equal(confirmationBlock.type, "ACTION_CONFIRMATION");
    assert.equal(confirmationBlock.kind, "APPLY_TRAINING_PLAN");
    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: confirmationBlock.actionId } });
    assert.ok(action, "a real FitnessAgentAction row must be persisted for the confirmation step");
    assert.equal((action!.payload as any).templateId, "prog-strong", "the confirmed action must reference the REAL top-ranked candidate, not an arbitrary one");

    // execute(confirmed=true) -> the one real HTTP boundary (stubbed here),
    // called with the exact template/fingerprint the user actually confirmed.
    const executeResult = await fitnessAgent.execute({ userId }, confirmationBlock.actionId, true);
    assert.equal((executeResult as any).type, "ACTION_RESULT");
    assert.equal((executeResult as any).createdProgramId, "real-program-id-1");
    assert.equal((applyCalledWith as any).templateId, "prog-strong");
    assert.equal((applyCalledWith as any).fingerprint, "fp-prog-strong");
    assert.equal((applyCalledWith as any).actionId, confirmationBlock.actionId);
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("Program E2E (real DB): confirming the same real ACTION_CONFIRMATION action twice calls the apply boundary at most once per confirm — execute() itself is idempotent via the real FitnessAgentAction row", async () => {
  stubContext();
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({ programs: [program("prog-a")], warnings: [] } as any);
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;
  let applyCallCount = 0;
  fitnessAgentDeps.tools.applyTrainingPlan = async () => {
    applyCallCount++;
    return { createdProgramId: "real-program-id-2", nextUrl: "/client/training" };
  };

  const userId = `agent-program-e2e-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    await fitnessAgent.tryTurn("Gợi ý chương trình tập cho tôi", { userId }, session.id);
    const rec = await prisma.fitnessRecommendation.findFirst({ where: { userId, sessionId: session.id }, orderBy: { createdAt: "desc" } });
    const confirmationBlock = await fitnessAgent.prepare({ userId }, rec!.id, "prog-a") as any;
    const actionId = confirmationBlock.actionId;

    const first = await fitnessAgent.execute({ userId }, actionId, true);
    const second = await fitnessAgent.execute({ userId }, actionId, true);
    assert.equal((first as any).createdProgramId, (second as any).createdProgramId, "re-confirming the same completed action must return the same result, not apply twice");
    assert.equal(applyCallCount, 1, "the real FitnessAgentAction.status===COMPLETED short-circuit must prevent a second HTTP call to fitness-service");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("Program E2E (real DB): apply-boundary rejection (simulating fitness-service's own revalidation 409) propagates as a real error with no local action mutation to COMPLETED", async () => {
  stubContext();
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({ programs: [program("prog-b")], warnings: [] } as any);
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;
  fitnessAgentDeps.tools.applyTrainingPlan = async () => {
    throw Object.assign(new Error("Program or constraints changed. Refresh and confirm again."), { status: 409 });
  };

  const userId = `agent-program-e2e-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    await fitnessAgent.tryTurn("Gợi ý chương trình tập cho tôi", { userId }, session.id);
    const rec = await prisma.fitnessRecommendation.findFirst({ where: { userId, sessionId: session.id }, orderBy: { createdAt: "desc" } });
    const confirmationBlock = await fitnessAgent.prepare({ userId }, rec!.id, "prog-b") as any;
    const actionId = confirmationBlock.actionId;

    await assert.rejects(
      () => fitnessAgent.execute({ userId }, actionId, true),
      (err: any) => { assert.equal(err.status, 409); return true; },
    );
    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    assert.notEqual(action!.status, "COMPLETED", "a rejected apply must never mark the local action COMPLETED");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
