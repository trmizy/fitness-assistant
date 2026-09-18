/**
 * Adaptive Cycle Evaluation via chat (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md, phases C/D) — proves fitness-agent
 * .service.ts's tryEvaluateCycle (read-only, formats the already-computed
 * aiSummary/nutritionAiHeadline fields, no separate LLM call) and
 * tryReviewRecommendation (accept/reject — real prescription change, so
 * still goes through prepare()->ACTION_CONFIRMATION, never applies
 * anything itself). Stubs fitnessAgentDeps.tools.* (same mutable-xDeps
 * pattern as the substitution tests) — no live fitness-service HTTP call.
 *
 * Real DB (ai-service has no separate *_test database split — see
 * personalized-service.test.ts's own header comment) — run against the ai
 * test DB explicitly:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test" \
 *     npx tsx --test src/__tests__/fitness-agent-evaluate-review.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const originalGetActiveCycle = fitnessAgentDeps.tools.getActiveCycle;
const originalEvaluateCycle = fitnessAgentDeps.tools.evaluateCycle;
const originalGetLatestAssessment = fitnessAgentDeps.tools.getLatestAssessment;
const originalReviewRecommendation = fitnessAgentDeps.tools.reviewRecommendation;

test.afterEach(() => {
  fitnessAgentDeps.tools.getActiveCycle = originalGetActiveCycle;
  fitnessAgentDeps.tools.evaluateCycle = originalEvaluateCycle;
  fitnessAgentDeps.tools.getLatestAssessment = originalGetLatestAssessment;
  fitnessAgentDeps.tools.reviewRecommendation = originalReviewRecommendation;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Evaluate/review test" } });
}

const CYCLE_ID = "11111111-1111-1111-1111-111111111111";

test("tryTurn EVALUATE: no active cycle -> a clear answer, never throws", async () => {
  fitnessAgentDeps.tools.getActiveCycle = async () => {
    throw Object.assign(new Error("No active training cycle"), { status: 404 });
  };
  const userId = `agent-eval-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("đánh giá chu kỳ tập của tôi", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.includes("chưa có chu kỳ"));
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn EVALUATE: formats the already-computed aiSummary/nutritionAiHeadline, mentions what's pending", async () => {
  fitnessAgentDeps.tools.getActiveCycle = async () => ({ cycle: { id: CYCLE_ID } } as any);
  fitnessAgentDeps.tools.evaluateCycle = async () =>
    ({
      id: "a1", cycleId: CYCLE_ID, decision: "ADJUST", aiSummary: "Bạn đang tiến bộ tốt, cần điều chỉnh nhẹ khối lượng tập.",
      userDecision: "PENDING", nutritionDecision: "PROPOSE_ADJUSTMENT",
      nutritionAiHeadline: "Đề xuất giảm nhẹ calo", nutritionAiExplanation: "Cân nặng chững lại 3 tuần liên tiếp.",
      nutritionUserDecision: "PENDING",
    } as any);
  const userId = `agent-eval-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("chu kỳ tập của tôi thế nào rồi", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.includes("Điều chỉnh nhỏ"), "must use the Vietnamese label, not the raw ADJUST code");
    assert.ok(result!.answer.includes("Bạn đang tiến bộ tốt"));
    assert.ok(result!.answer.includes("Đề xuất điều chỉnh"));
    assert.ok(result!.answer.includes("Đề xuất giảm nhẹ calo"));
    assert.ok(result!.answer.includes("chấp nhận") && result!.answer.includes("từ chối"));
    assert.equal(result!.blocks[0].type, "CYCLE_EVALUATION_RESULT");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn REVIEW: both training and nutrition pending, no target stated -> asks which, never guesses", async () => {
  fitnessAgentDeps.tools.getActiveCycle = async () => ({ cycle: { id: CYCLE_ID } } as any);
  fitnessAgentDeps.tools.getLatestAssessment = async () =>
    ({ id: "a1", cycleId: CYCLE_ID, decision: "ADJUST", userDecision: "PENDING", nutritionDecision: "PROPOSE_ADJUSTMENT", nutritionUserDecision: "PENDING" } as any);
  const userId = `agent-review-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi chấp nhận đề xuất đó", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.toLowerCase().includes("tập luyện") && result!.answer.toLowerCase().includes("dinh dưỡng"));
    assert.equal(result!.blocks.length, 0, "must not create any confirmable action while still ambiguous");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn REVIEW: explicit nutrition target with a real pending one creates an ACTION_CONFIRMATION, applies nothing yet", async () => {
  fitnessAgentDeps.tools.getActiveCycle = async () => ({ cycle: { id: CYCLE_ID } } as any);
  fitnessAgentDeps.tools.getLatestAssessment = async () =>
    ({ id: "a1", cycleId: CYCLE_ID, decision: "KEEP", userDecision: "PENDING", nutritionDecision: "PROPOSE_ADJUSTMENT", nutritionUserDecision: "PENDING" } as any);
  let reviewCalled = false;
  fitnessAgentDeps.tools.reviewRecommendation = async () => {
    reviewCalled = true;
    return {};
  };
  const userId = `agent-review-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi chấp nhận đề xuất dinh dưỡng", { userId }, session.id);
    assert.ok(result);
    assert.equal(result!.blocks.length, 1);
    assert.equal(result!.blocks[0].type, "ACTION_CONFIRMATION");
    assert.equal((result!.blocks[0] as any).kind, "ACCEPT_NUTRITION_RECOMMENDATION");
    assert.equal(reviewCalled, false, "must not apply anything until the user explicitly confirms the action");

    // Real FitnessAgentAction row must exist, PENDING, for the follow-up /confirm call.
    const action = await prisma.fitnessAgentAction.findUnique({ where: { id: (result!.blocks[0] as any).actionId } });
    assert.ok(action);
    assert.equal(action!.status, "PENDING");
    assert.equal(action!.kind, "ACCEPT_NUTRITION_RECOMMENDATION");
    assert.equal(action!.risk, "MEDIUM");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn REVIEW: target stated but nothing pending for it -> a clear answer, no action created", async () => {
  fitnessAgentDeps.tools.getActiveCycle = async () => ({ cycle: { id: CYCLE_ID } } as any);
  fitnessAgentDeps.tools.getLatestAssessment = async () =>
    ({ id: "a1", cycleId: CYCLE_ID, decision: "KEEP", userDecision: "ACCEPTED", nutritionDecision: null, nutritionUserDecision: "PENDING" } as any);
  const userId = `agent-review-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi chấp nhận đề xuất tập luyện", { userId }, session.id);
    assert.ok(result);
    assert.equal(result!.blocks.length, 0);
    assert.ok(result!.answer.includes("không có gì đang chờ"));
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("execute(): confirming an ACCEPT_NUTRITION_RECOMMENDATION action calls reviewRecommendation with the right payload", async () => {
  fitnessAgentDeps.tools.reviewRecommendation = async (_identity, params) => {
    assert.equal(params.target, "NUTRITION");
    assert.equal(params.decision, "ACCEPT");
    assert.equal(params.cycleId, CYCLE_ID);
    return {};
  };
  const userId = `agent-review-exec-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId, sessionId: session.id, recommendationId: null, kind: "ACCEPT_NUTRITION_RECOMMENDATION", risk: "MEDIUM",
        payload: { cycleId: CYCLE_ID, assessmentId: "a1", target: "NUTRITION", decision: "ACCEPT" },
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const block = await fitnessAgent.execute({ userId }, action.id, true);
    assert.equal(block.type, "ACTION_RESULT");
    assert.ok((block as any).message.includes("dinh dưỡng"));
    const updated = await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert.equal(updated.status, "COMPLETED");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
