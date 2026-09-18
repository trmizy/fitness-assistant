/**
 * Image -> GoalContext -> Recommendation loop closure
 * (docs/ai-agent-implementation-report.md's own named gap, closed
 * 2026-09-14 in the hardening pass). Proves end-to-end, at the code level
 * (no live LLM/vision call — those paths are unchanged and out of scope
 * for this pass), that a confirmed goal-image's categorical attributes
 * actually reach the Recommendation Narrator's grounding input, rather
 * than dead-ending at persistence as the implementation report originally
 * found.
 *
 * Real DB (chat session only — same convention as
 * fitness-agent-substitution.test.ts): run against the ai test DB
 * explicitly, e.g.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test" \
 *     npx tsx --test src/__tests__/fitness-agent-goal-intent-loop.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { extractGoalIntentGrounding } from "../llm/recommendation_narrator";

const originalGetContext = fitnessAgentDeps.tools.getUserFitnessContext;
const originalFindPT = fitnessAgentDeps.tools.findPTCandidates;
const originalGetEvidence = fitnessAgentDeps.tools.getScientificEvidence;
const originalNarrate = fitnessAgentDeps.narrateRecommendations;

test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = originalGetContext;
  fitnessAgentDeps.tools.findPTCandidates = originalFindPT;
  fitnessAgentDeps.tools.getScientificEvidence = originalGetEvidence;
  fitnessAgentDeps.narrateRecommendations = originalNarrate;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Goal-intent loop test" } });
}

const ptCandidate: any = {
  id: "pt-goal-intent-1", name: "PT Test", photoUrl: null, specialties: ["Giảm mỡ"],
  yearsExperience: "3", languages: ["vi"], certificates: [],
  packages: [{ id: "pkg-1", name: "10 buổi", price: 1_800_000, sessions: 10, sessionMinutes: 60, mode: "OFFLINE" }],
  availableDays: [1, 3, 5], availableSlots: 10, averageRating: 4.6, reviewCount: 10,
  clientsStarted: 5, clientsCompleted: 4, cancellationRate: 0.1, noShowRate: 0.05,
  dataOrigin: "REAL",
  history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null, medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL", similarityVersion: "journey-distance-v1", note: "Not enough historical evidence." },
};

function stubContext(goalIntent: unknown) {
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: {
      goal: "WEIGHT_LOSS", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 2_000_000,
      reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER",
      goalIntent,
    },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
}

test("tryTurn PT flow: a confirmed image-derived goalIntent reaches narrateRecommendations' grounding input", async () => {
  stubContext({
    primaryGoal: "WEIGHT_LOSS", focusMuscles: ["SHOULDERS", "ARMS"],
    muscularity: "MODERATE", relativeLeanness: "LEAN_APPEARANCE",
    source: "REFERENCE_IMAGE", confirmedByUser: true, version: "goal-intent-v1", confirmedAt: new Date().toISOString(),
  });
  fitnessAgentDeps.tools.findPTCandidates = async () => ({ candidates: [ptCandidate], historyAuditId: "audit-1", truncated: false } as any);
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;

  let capturedGoalIntent: unknown;
  fitnessAgentDeps.narrateRecommendations = async (_candidates, _evidence, opts) => {
    capturedGoalIntent = opts.goalIntent;
    return { narrations: [], usedFallback: true };
  };

  const userId = `agent-goal-intent-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tìm pt cho tôi", { userId }, session.id);
    assert.ok(result, "PT flow should produce a real answer");
    assert.deepEqual(capturedGoalIntent, {
      primaryGoal: "WEIGHT_LOSS", muscularity: "MODERATE",
      relativeLeanness: "LEAN_APPEARANCE", focusMuscles: ["SHOULDERS", "ARMS"],
    }, "only the safe categorical fields reach the narrator — version/confirmedAt/source are dropped");
  } finally {
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("tryTurn PT flow: a text-only user with no confirmed goal image still gets a full recommendation (goalIntent undefined, not a blocker)", async () => {
  stubContext(null);
  fitnessAgentDeps.tools.findPTCandidates = async () => ({ candidates: [ptCandidate], historyAuditId: "audit-2", truncated: false } as any);
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;

  let capturedGoalIntent: unknown = "not-called";
  fitnessAgentDeps.narrateRecommendations = async (_candidates, _evidence, opts) => {
    capturedGoalIntent = opts.goalIntent;
    return { narrations: [], usedFallback: true };
  };

  const userId = `agent-goal-intent-it-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const result = await fitnessAgent.tryTurn("tìm pt cho tôi", { userId }, session.id);
    assert.ok(result, "PT flow must still work for a text-only user");
    assert.equal(capturedGoalIntent, undefined);
  } finally {
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});

test("extractGoalIntentGrounding: never leaks non-categorical/unexpected fields", () => {
  const grounding = extractGoalIntentGrounding({
    primaryGoal: "MUSCLE_GAIN", focusMuscles: ["CHEST"], muscularity: "HIGH",
    exactBodyFatPct: 14.2, ageEstimate: 27, someOtherField: "should not appear",
  });
  assert.deepEqual(grounding, { primaryGoal: "MUSCLE_GAIN", focusMuscles: ["CHEST"], muscularity: "HIGH" });
});

test("extractGoalIntentGrounding: returns undefined for null/non-object/empty input", () => {
  assert.equal(extractGoalIntentGrounding(null), undefined);
  assert.equal(extractGoalIntentGrounding(undefined), undefined);
  assert.equal(extractGoalIntentGrounding("a string"), undefined);
  assert.equal(extractGoalIntentGrounding({}), undefined);
});
