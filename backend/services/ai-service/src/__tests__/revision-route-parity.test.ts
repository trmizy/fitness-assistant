/**
 * Phase 3 Batch 4 — end-to-end route-parity via real fitnessAgent.tryTurn() calls: the flag's off/on
 * behavior, cross-domain continuity (PT revision mid-workout-workflow), stale-proposal supersession,
 * the honest permanent-swap guard, LLM-call-count discipline, and safety (zero writes).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { llmService } from "../services/llm.service";
import { conversationService } from "../services/conversation.service";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  getNutritionTargetPreview: fitnessAgentDeps.tools.getNutritionTargetPreview,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName,
  extract: fitnessAgentDeps.profileExtractor.extract,
  narrateRecommendations: fitnessAgentDeps.narrateRecommendations,
  getHealthStatus: llmService.getHealthStatus,
  queueNutritionPlanGeneration: conversationService.queueNutritionPlanGeneration,
};
const originalUnifiedCoach = process.env.GYMINI_UNIFIED_AI_COACH;
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  fitnessAgentDeps.tools.getNutritionTargetPreview = original.getNutritionTargetPreview;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.narrateRecommendations = original.narrateRecommendations;
  llmService.getHealthStatus = original.getHealthStatus;
  conversationService.queueNutritionPlanGeneration = original.queueNutritionPlanGeneration;
  if (originalUnifiedCoach === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = originalUnifiedCoach;
});
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function stubExerciseResolution() {
  fitnessAgentDeps.tools.searchExerciseByName = async (_identity: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
}
test.after(async () => { await prisma.$disconnect(); });

function ptCandidate(id: string, name: string) {
  return { id, name, specialties: ["Tăng cơ", "MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5, history: { count: 1 } };
}
let narrationCalls = 0;
function stubPtSearch() {
  narrationCalls = 0;
  const profile = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000, reviewRequired: false, experience: "INTERMEDIATE", goalIntent: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.tools.findPTCandidates = async () => ({ candidates: [ptCandidate("pt-1", "PT An"), ptCandidate("pt-2", "PT Bình"), ptCandidate("pt-3", "PT Cường")], historyAuditId: "h1", truncated: false } as any);
  fitnessAgentDeps.narrateRecommendations = (async (ranked: any[]) => { narrationCalls += 1; return { narrations: ranked.map((r: any) => ({ candidateId: r.candidate.id, summary: "phù hợp", strengths: [], tradeoffs: [], uncertainty: "", evidenceRefs: [] })), usedFallback: false }; }) as any;
}

const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "revision route parity" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};

test("flag OFF (default): 'Không thích người thứ hai' after a PT recommendation falls through to generic chat, never intercepted", async () => {
  delete process.env.GYMINI_UNIFIED_AI_COACH;
  const userId = `u-${randomUUID()}`;
  stubPtSearch();
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(r1 && (r1.blocks[0] as any)?.type === "PT_RECOMMENDATIONS", "must get the real initial recommendation");
    const r2 = await fitnessAgent.tryTurn("Không thích người thứ hai, còn ai khác?", { userId } as any, session.id);
    // With the flag off, the revision hook never runs — the message falls through to whatever the
    // pre-Batch-4 pipeline already did with it (generic chat / null), never the new "Mình đã bỏ lựa
    // chọn..." answer.
    if (r2) assert.ok(!r2.answer.includes("Mình đã bỏ lựa chọn bạn không thích"));
    const recCount = await prisma.fitnessRecommendation.count({ where: { userId } });
    assert.equal(recCount, 1, "flag off must never create a second recommendation row");
  } finally { await cleanup(userId, session.id); }
});

test("flag ON: 'Không thích người thứ hai, còn ai khác?' excludes the real second candidate and reruns the real pipeline, exactly one narration call", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubPtSearch();
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(r1);
    assert.equal(narrationCalls, 1);
    const r2 = await fitnessAgent.tryTurn("Không thích người thứ hai, còn ai khác?", { userId } as any, session.id);
    assert.ok(r2);
    assert.match(r2!.answer, /bỏ lựa chọn bạn không thích/);
    const candidates = ((r2!.blocks[0] as any)?.candidates ?? []) as Array<{ id: string }>;
    assert.ok(!candidates.some((c) => c.id === "pt-2"), "the excluded candidate must never reappear");
    assert.equal(narrationCalls, 2, "exactly one more narration call for the revision — no extra LLM calls added by the revision layer itself");
    const recCount = await prisma.fitnessRecommendation.count({ where: { userId } });
    assert.equal(recCount, 2, "a revision persists a NEW recommendation row (same mechanism as any other re-search)");
  } finally { await cleanup(userId, session.id); }
});

test("T20/T21 stale-proposal safety: a workout draft revised twice, then confirmed, applies ONLY the latest version — reuses the existing in-place-update mechanism (no new mechanism needed)", async () => {
  delete process.env.GYMINI_UNIFIED_AI_COACH;
  const userId = `u-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 2, 3, 4, 5], sessionMinutes: null }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 5, availableEquipment: ["barbell", "dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: [1, 2, 3, 4, 5] } },
  } as any);
  const session = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId } as any, session.id);
    await fitnessAgent.tryTurn("1 tiếng", { userId } as any, session.id); // resumes -> real draft (version A)
    const draftAfterA = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.ok(draftAfterA, "version A must exist as a real pending action");
    const actionId = draftAfterA!.id;

    const r3 = await fitnessAgent.tryTurn("3 buổi thôi", { userId } as any, session.id); // revise -> version B
    assert.ok(r3);
    const rows = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(rows.length, 1, "the revision must update the SAME row, never create a second competing proposal");
    assert.equal(rows[0].id, actionId);

    const confirmed = await fitnessAgent.execute({ userId } as any, actionId, true);
    assert.equal((confirmed as any).type, "ACTION_RESULT");
    const final = await prisma.fitnessAgentAction.findUnique({ where: { id: actionId } });
    const finalPayload = final!.payload as any;
    assert.equal(finalPayload.weeklySchedule.length, 3, "confirming must apply version B (3 sessions), never the superseded version A (5 sessions)");
  } finally { await cleanup(userId, session.id); }
});

test("T19 at tryTurn level: an exercise-swap phrase with no pending workout draft never claims a permanent change, zero active-program writes", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Đổi Bulgarian Split Squat luôn.", { userId } as any, session.id);
    assert.ok(r);
    assert.match(r!.answer, /chưa thể thay đổi vĩnh viễn/);
    const actionCount = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(actionCount, 0, "must never create or touch any action — zero writes for an unsupported permanent swap");
  } finally { await cleanup(userId, session.id); }
});

test("T27 cross-domain continuity: a PT recommendation + revision while an UNRELATED CREATE_NUTRITION_PLAN draft is pending never touches that draft, which remains revisable afterward", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubPtSearch();
  llmService.getHealthStatus = async () => ({ llmAvailable: true } as any);
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: "ACTIVE_GOAL", goalId: "goal-1", calories: 1800, protein: 135, carbs: 180, fat: 60 } as any);
  conversationService.queueNutritionPlanGeneration = async () => ({ planId: "plan-1", jobId: "job-1" } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: "WEIGHT_LOSS", currentWeightKg: 70, heightCm: 170, age: 30, gender: "FEMALE", activityLevel: "MODERATE" } } as any);
  const session = await newSession(userId);
  try {
    // Start an UNRELATED nutrition draft first (a different FitnessAgentAction domain entirely — no
    // keyword overlap with the PT revision language, so routePendingDraftTurn's own domain-cue
    // matching never mistakes the PT turn for a nutrition edit).
    await fitnessAgent.tryTurn("Tạo kế hoạch dinh dưỡng cho tôi", { userId } as any, session.id);
    const r1 = await fitnessAgent.tryTurn("3 bữa", { userId } as any, session.id); // resolves the mealsPerDay slot -> queues generation
    assert.ok(r1, "must queue the nutrition draft");
    const nutritionBefore = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    assert.ok(nutritionBefore, "a real pending nutrition draft action must exist");
    const beforeSnapshot = { id: nutritionBefore!.id, status: nutritionBefore!.status, payload: JSON.stringify(nutritionBefore!.payload) };

    const r2 = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(r2 && (r2.blocks[0] as any)?.type === "PT_RECOMMENDATIONS");
    const r3 = await fitnessAgent.tryTurn("Không thích người thứ hai, còn ai khác?", { userId } as any, session.id);
    assert.ok(r3);
    assert.match(r3!.answer, /bỏ lựa chọn bạn không thích/, "the PT/PROGRAM revision module must handle this, not be blocked by the unrelated pending nutrition draft");

    const nutritionAfter = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    const afterSnapshot = { id: nutritionAfter!.id, status: nutritionAfter!.status, payload: JSON.stringify(nutritionAfter!.payload) };
    assert.deepEqual(afterSnapshot, beforeSnapshot, "the PT recommendation revision must never touch the unrelated pending nutrition draft");

    // The nutrition draft is still perfectly revisable afterward — proving it was never corrupted.
    const r4 = await fitnessAgent.tryTurn("ít bữa hơn", { userId } as any, session.id);
    assert.ok(r4, "the nutrition draft must still accept its own normal revision after the unrelated PT detour");
    const rows = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "CREATE_NUTRITION_PLAN" } });
    assert.equal(rows.length, 1, "revising must never create a second, competing nutrition draft row");
  } finally { await cleanup(userId, session.id); }
});

test("safety: a pure recommendation-only revision creates zero FitnessAgentAction rows", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubPtSearch();
  const session = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    await fitnessAgent.tryTurn("Không thích người thứ hai, còn ai khác?", { userId } as any, session.id);
    const actionCount = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(actionCount, 0, "a recommendation revision never creates a FitnessAgentAction — it is read-only until SELECT/prepare/execute");
  } finally { await cleanup(userId, session.id); }
});
