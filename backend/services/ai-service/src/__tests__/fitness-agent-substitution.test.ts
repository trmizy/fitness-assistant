/**
 * AI Coach nutrition actions (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md) — proves fitness-agent.service.ts's
 * trySubstitution routing/mapping: the keyword gate, the extraction ->
 * tool-call -> chat-answer pipeline, and that every non-APPLIED status
 * (ambiguous/not-found/locked/etc.) is surfaced as a real answer rather
 * than silently swallowed or thrown. Stubs fitnessAgentDeps.tools.
 * substituteMealItem and fitnessAgentDeps.extractFoodSubstitutionIntent
 * (same mutable-xDeps pattern as personalized-service-autoaccept-sweep
 * .test.ts) — no live LLM call, no live fitness-service HTTP call; the
 * actual substitution math is already proven for real in fitness-service's
 * own nutrition-agent.service.integration.test.ts.
 *
 * Real DB (ai-service has no separate *_test database split the way
 * fitness-service does — see personalized-service.test.ts's own header
 * comment) — run against the ai test DB explicitly:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test" \
 *     npx tsx --test src/__tests__/fitness-agent-substitution.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const originalExtract = fitnessAgentDeps.extractFoodSubstitutionIntent;
const originalSubstitute = fitnessAgentDeps.tools.substituteMealItem;

test.afterEach(() => {
  fitnessAgentDeps.extractFoodSubstitutionIntent = originalExtract;
  fitnessAgentDeps.tools.substituteMealItem = originalSubstitute;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Substitution test" } });
}

test("tryTurn: a message with no substitution keyword never calls the LLM extractor at all", async () => {
  let called = false;
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => {
    called = true;
    return null;
  };
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("hôm nay tôi nên tập chân hay tập lưng?", { userId }, session.id);
    assert.equal(result, null);
    assert.equal(called, false, "the keyword gate must short-circuit before any LLM call");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn: keyword matches but the LLM says it's not actually a substitution request -> falls through to null", async () => {
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({
    isFoodSubstitutionRequest: false, currentFoodMention: null, desiredFoodMention: null, mealHint: null,
  });
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    // Contains "đổi" but is actually about changing training days, not food.
    const result = await fitnessAgent.tryTurn("tôi muốn đổi lịch tập sang thứ 3", { userId }, session.id);
    assert.equal(result, null);
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn: APPLIED result is surfaced as the tool's own message, with a SUBSTITUTE_RESULT block", async () => {
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({
    isFoodSubstitutionRequest: true, currentFoodMention: "ức gà", desiredFoodMention: "cá hồi", mealHint: null,
  });
  fitnessAgentDeps.tools.substituteMealItem = async () =>
    ({ status: "APPLIED", message: "Đã đổi \"Ức gà\" thành \"Fish, salmon, NFS\" (150g, 411 kcal) trong Bữa trưa — Ngày 1." } as any);
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi muốn ăn cá hồi thay ức gà vào buổi nào đó", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.includes("Fish, salmon, NFS"));
    assert.equal(result!.blocks.length, 1);
    assert.equal(result!.blocks[0].type, "SUBSTITUTE_RESULT");
    assert.equal((result!.blocks[0] as any).status, "APPLIED");
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn: AMBIGUOUS_MEAL lists every candidate meal in the answer text, never silently picks one", async () => {
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({
    isFoodSubstitutionRequest: true, currentFoodMention: "ức gà", desiredFoodMention: "cá hồi", mealHint: null,
  });
  fitnessAgentDeps.tools.substituteMealItem = async () =>
    ({
      status: "AMBIGUOUS_MEAL",
      message: 'Có 2 bữa trong thực đơn có món "ức gà". Bạn muốn đổi ở bữa nào?',
      candidates: [
        { mealId: "m1", label: "Bữa trưa — Ngày 1", itemName: "Ức gà" },
        { mealId: "m2", label: "Bữa tối — Ngày 1", itemName: "Ức gà áp chảo" },
      ],
    } as any);
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi muốn ăn cá hồi thay ức gà", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.includes("Bữa trưa — Ngày 1"));
    assert.ok(result!.answer.includes("Bữa tối — Ngày 1"));
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn: NOT_FOUND is surfaced as a real answer, not thrown or swallowed", async () => {
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({
    isFoodSubstitutionRequest: true, currentFoodMention: "bánh flan", desiredFoodMention: null, mealHint: null,
  });
  fitnessAgentDeps.tools.substituteMealItem = async () =>
    ({ status: "NOT_FOUND", message: 'Không tìm thấy món "bánh flan" trong thực đơn hiện tại của bạn.' } as any);
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("đổi bánh flan sang món khác", { userId }, session.id);
    assert.ok(result);
    assert.ok(result!.answer.includes("Không tìm thấy"));
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn: no currentFoodMention extracted at all -> returns null (falls through to normal chat), never calls the tool", async () => {
  let toolCalled = false;
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({
    isFoodSubstitutionRequest: true, currentFoodMention: null, desiredFoodMention: null, mealHint: null,
  });
  fitnessAgentDeps.tools.substituteMealItem = async () => {
    toolCalled = true;
    return { status: "APPLIED", message: "should never happen" } as any;
  };
  const userId = `agent-sub-route-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tôi muốn đổi món ăn", { userId }, session.id);
    assert.equal(result, null);
    assert.equal(toolCalled, false);
  } finally {
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
