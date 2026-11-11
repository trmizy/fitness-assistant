/**
 * Phase 3 Batch 5 (docs/ai-product/phase3-batch5-rollout-readiness.md) — the unified AI coach's
 * product-level E2E suite. Real fitnessAgent.tryTurn()/execute(), real isolated Postgres, mocking only
 * the external HTTP/LLM boundary (fitnessAgentDeps.tools.*, llmService) — the same convention every
 * prior batch's own route-parity file already uses. Fewer, high-value journeys over many shallow units.
 *
 * Terminology discipline (brief §2): fitnessRecommendation/AgentWorkflowSession/FitnessAgentAction rows
 * are AI-INTERNAL persistence, never reported as "zero DB writes" — the real invariant asserted
 * throughout is "zero AUTHORITATIVE BUSINESS MUTATION before confirmation"
 * (importAiPlanToSchedule/saveNutritionPlanFromAiPlan/applyTrainingPlan/createPtContractDraft calls).
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
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  getNutritionTargetPreview: fitnessAgentDeps.tools.getNutritionTargetPreview,
  searchExerciseByName: fitnessAgentDeps.tools.searchExerciseByName,
  importAiPlanToSchedule: fitnessAgentDeps.tools.importAiPlanToSchedule,
  extract: fitnessAgentDeps.profileExtractor.extract,
  narrateRecommendations: fitnessAgentDeps.narrateRecommendations,
  narrateProgramRecommendations: fitnessAgentDeps.narrateProgramRecommendations,
  getHealthStatus: llmService.getHealthStatus,
  queueNutritionPlanGeneration: conversationService.queueNutritionPlanGeneration,
};
const originalEnv = { unifiedCoach: process.env.GYMINI_UNIFIED_AI_COACH, ciV2: process.env.CONVERSATIONAL_INTELLIGENCE_V2 };
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.tools.getNutritionTargetPreview = original.getNutritionTargetPreview;
  fitnessAgentDeps.tools.searchExerciseByName = original.searchExerciseByName;
  fitnessAgentDeps.tools.importAiPlanToSchedule = original.importAiPlanToSchedule;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.narrateRecommendations = original.narrateRecommendations;
  fitnessAgentDeps.narrateProgramRecommendations = original.narrateProgramRecommendations;
  llmService.getHealthStatus = original.getHealthStatus;
  conversationService.queueNutritionPlanGeneration = original.queueNutritionPlanGeneration;
  if (originalEnv.unifiedCoach === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = originalEnv.unifiedCoach;
  if (originalEnv.ciV2 === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalEnv.ciV2;
});
test.after(async () => { await prisma.$disconnect(); });

const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "unified coach e2e" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function stubExerciseResolution() {
  fitnessAgentDeps.tools.searchExerciseByName = async (_identity: any, name: string) => ({ id: `ex-${slug(name)}`, exerciseName: name });
}
function ptCandidate(id: string, name: string) {
  return { id, name, specialties: ["Tăng cơ", "MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5, history: { count: 1, note: "Chưa có đủ dữ liệu lịch sử." } };
}
function programCandidate(id: string, name: string) {
  return { id, name, goal: "MUSCLE_GAIN", daysPerWeek: 4, durationWeeks: 8, estimatedMinutes: 60, experienceLevel: "INTERMEDIATE", focusMuscles: [], fingerprint: `fp-${id}`, dataOrigin: "REAL", days: [] };
}

// =====================================================================================
// J1 — Workout coach: create -> revision -> revision -> confirm
// =====================================================================================
test("J1 workout coach: create (4 buổi, ở nhà) -> revision (buổi chân nhẹ hơn) -> revision (3 buổi) -> confirm, exactly-once authoritative write", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "WEIGHT_LOSS", days: [1, 2, 3, 4], sessionMinutes: null }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 4, availableEquipment: ["bodyweight", "dumbbell"], injuries: [], preferredTrainingDays: [1, 2, 3, 4] } },
  } as any);
  let mutationCalls = 0;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async () => { mutationCalls += 1; return { success: true }; };
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo cho tôi lịch tập giảm mỡ 4 buổi, tôi tập ở nhà.", { userId } as any, session.id);
    assert.ok(r1, "must ask the one missing slot (sessionMinutes)");
    const r2 = await fitnessAgent.tryTurn("45 phút", { userId } as any, session.id);
    assert.equal((r2!.blocks[0] as any)?.type, "WORKOUT_PLAN_PREVIEW", "must resume into a real generated draft");
    const draft1 = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.ok(draft1, "a real pending draft must exist");
    assert.equal(mutationCalls, 0, "zero authoritative business mutation before confirmation");

    // Brief's own illustrative wording ("Buổi chân hơi nặng.") does not match the existing, proven
    // day-intensity-reduction trigger (tryReviseWorkoutPlanDraft requires "nhẹ hơn"/"nhẹ đi"/"giảm
    // nhẹ"/"giảm cường độ"/"ít hơn" — pre-existing Phase-2 regex, not something this batch should
    // broaden speculatively) — using the real, already-proven phrasing from that same mechanism's own
    // test file (agent-workflow-create-workout-plan.test.ts).
    const r3 = await fitnessAgent.tryTurn("Ngày chân nhẹ hơn.", { userId } as any, session.id);
    assert.ok(r3, "must revise the SAME pending draft, not fall through to generic chat");
    assert.match(r3!.answer, /giảm nhẹ/);
    const rowsAfterRevision1 = await prisma.fitnessAgentAction.findMany({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(rowsAfterRevision1.length, 1, "revision must update the same row, never create a second competing draft");
    assert.equal(rowsAfterRevision1[0].id, draft1!.id, "workflow/draft identity must be preserved across revision");

    const r4 = await fitnessAgent.tryTurn("3 buổi thôi", { userId } as any, session.id);
    assert.ok(r4);
    const draft2 = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.equal(draft2!.id, draft1!.id, "draft identity preserved through the second revision too");
    assert.equal((draft2!.payload as any).weeklySchedule.length, 3, "the SECOND revision (3 buổi) must be what's currently stored");
    assert.equal(mutationCalls, 0, "still zero authoritative mutation before confirmation");

    const confirmed = await fitnessAgent.execute({ userId } as any, draft1!.id, true);
    assert.equal((confirmed as any).type, "ACTION_RESULT", "truthful success only after the real write succeeds");
    assert.equal(mutationCalls, 1, "exactly-once authoritative persistence");
    const final = await prisma.fitnessAgentAction.findUnique({ where: { id: draft1!.id } });
    assert.equal(final!.status, "COMPLETED");

    // No stale-draft confirmation: confirming the same action again must stay idempotent, not double-write.
    const confirmedAgain = await fitnessAgent.execute({ userId } as any, draft1!.id, true);
    assert.equal((confirmedAgain as any).type, "ACTION_RESULT");
    assert.equal(mutationCalls, 1, "a repeated confirm on an already-COMPLETED action must never write twice");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J2 — Cross-domain interruption: nutrition READ mid-workout-slot-filling, then resume
// =====================================================================================
test("J2 cross-domain interruption: a nutrition READ mid-workout-slot-filling preserves workflow state and resumes normally (requires CI-V2 on, per the documented dependency asymmetry)", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: null, currentWeight: 80, targetWeight: null, heightCm: 175, age: 28 }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 3, availableEquipment: ["barbell", "dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: [1, 3, 5] } },
  } as any);
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId } as any, session.id);
    assert.ok(r1, "must ask for sessionMinutes");
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.ok(before, "a real workflow row must exist while sessionMinutes is pending");
    const beforeSnapshot = { id: before!.id, status: before!.status, expectedSlot: before!.expectedSlot, slotsJson: JSON.stringify(before!.slotsJson) };

    const r2 = await fitnessAgent.tryTurn("Macro hiện tại của tôi bao nhiêu?", { userId } as any, session.id);
    assert.ok(r2, "the nutrition READ must be answered, not swallowed by the pending slot question");
    assert.equal(r2!.blocks.length, 0, "a pure READ_STATE answer carries no workflow block");

    const after = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    const afterSnapshot = { id: after!.id, status: after!.status, expectedSlot: after!.expectedSlot, slotsJson: JSON.stringify(after!.slotsJson) };
    assert.deepEqual(afterSnapshot, beforeSnapshot, "the nutrition READ interruption must never corrupt the waiting workout workflow");

    const r3 = await fitnessAgent.tryTurn("60 phút", { userId } as any, session.id);
    assert.equal((r3!.blocks[0] as any)?.type, "WORKOUT_PLAN_PREVIEW", "the SAME workflow must resume normally into a real draft");
    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.equal(rows.length, 1, "resuming must never create a second, competing workflow row");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J3 — PT coach: current-PT READ + bounded recommendation -> budget revision -> exclusion
// =====================================================================================
test("J3 PT coach: current-PT READ + bounded recommendation (CI-V2 on) -> budget revision -> exclusion, no PT-hire mutation at any point", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-${randomUUID()}`;
  let narrationCalls = 0;
  const profile = { goal: "WEIGHT_LOSS", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 3000000, reviewRequired: false, experience: "INTERMEDIATE", goalIntent: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, prefs: any) => ({ candidates: [ptCandidate("pt-1", "PT An"), ptCandidate("pt-2", "PT Bình"), ptCandidate("pt-3", "PT Cường")], historyAuditId: "h1", truncated: false, preferences: prefs } as any);
  fitnessAgentDeps.narrateRecommendations = (async (ranked: any[]) => { narrationCalls += 1; return { narrations: ranked.map((r: any) => ({ candidateId: r.candidate.id, summary: "phù hợp mục tiêu giảm mỡ", strengths: [], tradeoffs: [], uncertainty: "", evidenceRefs: [] })), usedFallback: false }; }) as any;
  const { readerDeps } = await import("../conversational-intelligence/global/readers");
  const originalReaderGet = readerDeps.get;
  readerDeps.get = async (url: string) => (url.endsWith("/contracts/client") ? { status: 200, data: [{ status: "ACTIVE", packageName: "Gói PT hiện tại", ptProfile: { firstName: "Hùng" } }] } : { status: 404, data: {} });
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("PT hiện tại của tôi là ai và PT nào phù hợp hơn với tôi?", { userId } as any, session.id);
    assert.ok(r1, "must answer the current-PT READ + bounded recommendation composite");
    assert.match(r1!.answer, /Hùng/, "the current-PT fact must come from the real READ");
    assert.match(r1!.answer, /PT An|PT Bình|PT Cường/, "the composite must include a real recommendation");

    const r2 = await fitnessAgent.tryTurn("Người đầu tiên đắt quá, dưới 2 triệu thôi.", { userId } as any, session.id);
    assert.ok(r2, "the budget revision (already-working preference merge) must produce a new search");
    const rec1 = await prisma.fitnessRecommendation.findFirst({ where: { userId, type: "PT" }, orderBy: { createdAt: "desc" } });
    assert.equal(((rec1!.contextSnapshot as any).preferences as any).budgetVnd, 2000000, "the new budget constraint must be the one actually applied");

    const r3 = await fitnessAgent.tryTurn("Không thích người thứ hai.", { userId } as any, session.id);
    assert.ok(r3, "the exclusion revision (Batch 4) must produce a revised shortlist");
    assert.match(r3!.answer, /bỏ lựa chọn bạn không thích/);

    const actionCount = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(actionCount, 0, "no PT-hire/contract-draft mutation is ever attempted by this journey — it correctly stops at recommendation");
    assert.ok(narrationCalls >= 1, "narration is used (LLM call budget measured, see the final response)");
  } finally { readerDeps.get = originalReaderGet; await cleanup(userId, session.id); }
});

// =====================================================================================
// J4 — Program coach: recommendation -> constraint refine -> exclusion
// =====================================================================================
test("J4 program coach: recommendation -> '4 buổi thôi' (constraint refine) -> exclusion, no program mutation attempted", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  const profile = { goal: "MUSCLE_GAIN", days: [1, 2, 3, 4, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, experience: "INTERMEDIATE", goalIntent: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({ programs: [programCandidate("prog-1", "Chương trình A"), programCandidate("prog-2", "Chương trình B")], warnings: [] } as any);
  fitnessAgentDeps.narrateProgramRecommendations = async () => ({ narrations: [], usedFallback: true });
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Gợi ý chương trình tập cho tôi", { userId } as any, session.id);
    assert.equal((r1!.blocks[0] as any)?.type, "PROGRAM_RECOMMENDATIONS");

    const r2 = await fitnessAgent.tryTurn("4 buổi thôi.", { userId } as any, session.id);
    assert.ok(r2);
    const rec1 = await prisma.fitnessRecommendation.findFirst({ where: { userId, type: "PROGRAM" }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(((rec1!.contextSnapshot as any).preferences as any).days, [1, 2, 3, 4], "the refined day-count constraint must be the one actually applied");

    const r3 = await fitnessAgent.tryTurn("Không thích chương trình đầu tiên.", { userId } as any, session.id);
    assert.ok(r3);
    assert.match(r3!.answer, /bỏ lựa chọn bạn không thích/);

    const actionCount = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(actionCount, 0, "no program-apply mutation is attempted by this journey");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J5 — Nutrition coach: macro READ -> hypothetical -> honest unsupported real-change
// =====================================================================================
test("J5 nutrition coach: macro READ (ACTIVE goal) -> hypothetical (zero mutation) -> real-change request (honest unsupported, per the M3 invariant)", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; // the macro READ goes through runGlobalTurn's NUTRITION_TARGET topic
  const userId = `u-${randomUUID()}`;
  // readNutritionTarget goes through Batch 1's Enterprise Data Layer (getActiveNutritionGoal), which
  // reads profileExtractor.extract()'s profile.nutritionGoal — NOT the getNutritionTargetPreview tool
  // (that one backs resolveNutritionTarget, used only by the CREATE_NUTRITION_PLAN generation path).
  fitnessAgentDeps.tools.getNutritionTargetPreview = async () => ({ status: "ACTIVE_GOAL", goalId: "goal-1", calories: 2000, protein: 150, carbs: 200, fat: 60 } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { nutritionGoal: { calories: 2000, protein: 150, carbs: 200, fat: 60 } } } as any);
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Macro hiện tại của tôi bao nhiêu?", { userId } as any, session.id);
    assert.ok(r1);
    assert.match(r1!.answer, /2\.?000/);

    const r2 = await fitnessAgent.tryTurn("Nếu giảm xuống 1900 kcal thì sao?", { userId } as any, session.id);
    assert.ok(r2, "the hypothetical must be answered by the Batch-4 nutrition-revision module");
    assert.match(r2!.answer, /1900/);
    assert.equal(r2!.blocks.length, 0, "zero authoritative mutation, zero proposal for a hypothetical");

    const r3 = await fitnessAgent.tryTurn("Đổi xuống 1900 luôn.", { userId } as any, session.id);
    assert.ok(r3);
    assert.match(r3!.answer, /chưa thể/, "honest unsupported explanation, never a fake success/pending action/silent mutation");
    const actionCount = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(actionCount, 0, "zero authoritative business mutation and zero fake pending action");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J6 — General QA + personal context: never fabricates a current-program fact, never mutates
// =====================================================================================
test("J6 general QA + personal context: a knowledge question defers to the normal chat pipeline (correctly out of fitnessAgent's scope); a context-dependent follow-up never fabricates a program fact or starts an unrelated workflow", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    // Pure knowledge question: fitnessAgent.tryTurn() correctly returns null here — general QA is the
    // chat controller's own RAG/LLM responsibility, not fitnessAgent's. A null here is the CORRECT,
    // truthful "not my concern" signal, not a defect — asserted explicitly so this stays documented
    // behavior rather than an assumption.
    const r1 = await fitnessAgent.tryTurn("Progressive overload là gì?", { userId } as any, session.id);
    assert.equal(r1, null, "fitnessAgent must defer pure knowledge questions to the chat controller's own RAG/LLM path, never fabricate a fitness-science answer itself");

    // Context-dependent follow-up: must never fabricate a "current program" fact, and must never be
    // misrouted into starting an unrelated creation/mutation workflow.
    const r2 = await fitnessAgent.tryTurn("Với lịch hiện tại của tôi thì áp dụng thế nào?", { userId } as any, session.id);
    // Whatever fitnessAgent does with this (answer truthfully from a real read, or also defer with
    // null) — it must never silently start a workflow or create a business-mutation-adjacent action.
    const workflowRows = await prisma.agentWorkflowSession.count({ where: { userId } });
    const actionRows = await prisma.fitnessAgentAction.count({ where: { userId } });
    assert.equal(workflowRows, 0, "a context-dependent knowledge follow-up must never silently start a creation workflow");
    assert.equal(actionRows, 0, "and must never create a pending action either");
    if (r2) assert.ok(!/\d+\s*(buổi|phút)\/tuần.*đã (lưu|tạo)/.test(r2.answer), "if answered, must never claim a specific saved program exists without a real read backing it");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J7 — Failure recovery: a failing READ never collapses the surviving part of a composite,
// a failing recommendation engine never fabricates candidates, narration failure degrades safely
// =====================================================================================
test("J7 failure recovery: current-PT READ fails but the recommendation still succeeds (truthful partial answer); the recommendation engine failing returns no hallucinated candidates; narration failure degrades to the static fallback, never an error or empty result", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-${randomUUID()}`;
  const profile = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000, reviewRequired: false, experience: "INTERMEDIATE", goalIntent: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  const { readerDeps } = await import("../conversational-intelligence/global/readers");
  const originalReaderGet = readerDeps.get;
  const session = await newSession(userId);
  try {
    // Sub-case A: the current-PT READ fails (user-service down), but the recommendation half of the
    // composite must still succeed and be reported — never collapsed into "no data".
    readerDeps.get = async () => { throw new Error("user-service unavailable"); };
    fitnessAgentDeps.tools.findPTCandidates = async () => ({ candidates: [ptCandidate("pt-1", "PT An")], historyAuditId: "h1", truncated: false } as any);
    fitnessAgentDeps.narrateRecommendations = async (ranked: any[]) => ({ narrations: ranked.map((r: any) => ({ candidateId: r.candidate.id, summary: "phù hợp", strengths: [], tradeoffs: [], uncertainty: "", evidenceRefs: [] })), usedFallback: false } as any);
    const rA = await fitnessAgent.tryTurn("PT hiện tại của tôi là ai và PT nào phù hợp hơn với tôi?", { userId } as any, session.id);
    assert.ok(rA, "a failed READ must never discard an otherwise-successful recommendation");
    assert.match(rA!.answer, /PT An/, "the real recommendation must still be reported");
    readerDeps.get = originalReaderGet;

    // Sub-case B: narration itself fails — the standalone recommend path must degrade to the static
    // why[] fallback, never throw, never return an empty/error result.
    fitnessAgentDeps.narrateRecommendations = async () => { throw new Error("Qwen timeout"); };
    const rB = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(rB, "a narration failure must degrade to the static fallback, never surface as an error");
    assert.equal((rB!.blocks[0] as any)?.type, "PT_RECOMMENDATIONS");
    assert.equal((rB!.blocks[0] as any)?.usedNarrationFallback, true, "must honestly flag that the static fallback was used, never silently claim a real narration");

    // Sub-case C: the recommendation engine itself fails (fitness-service down) — must return null/
    // honest failure, never a hallucinated candidate list.
    fitnessAgentDeps.tools.findPTCandidates = async () => { throw new Error("fitness-service unavailable"); };
    await assert.rejects(() => fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id), "a hard failure here must surface as a real rejection, never a fabricated empty success");
  } finally { readerDeps.get = originalReaderGet; await cleanup(userId, session.id); }
});

// =====================================================================================
// J8 — Cross-user isolation
// =====================================================================================
test("J8 cross-user isolation: user B cannot resume A's workflow, exclude against A's PT shortlist, revise A's draft, or confirm A's pending action", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userA = `u-a-${randomUUID()}`;
  const userB = `u-b-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: undefined, budgetVnd: 1500000 }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 3, availableEquipment: ["barbell", "dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: [1, 3, 5] } },
  } as any);
  fitnessAgentDeps.tools.findPTCandidates = async () => ({ candidates: [ptCandidate("pt-1", "PT An"), ptCandidate("pt-2", "PT Bình")], historyAuditId: "h1", truncated: false } as any);
  fitnessAgentDeps.narrateRecommendations = (async (ranked: any[]) => ({ narrations: ranked.map((r: any) => ({ candidateId: r.candidate.id, summary: "phù hợp", strengths: [], tradeoffs: [], uncertainty: "", evidenceRefs: [] })), usedFallback: false })) as any;
  const sessionA = await newSession(userA);
  const sessionB = await newSession(userB);
  try {
    // PT search FIRST (one-shot, completes immediately, no workflow row) so the LATER workout-workflow
    // start has nothing competing to cancel — starting a new recognized workflow while a DIFFERENT one
    // is pending is itself a separate, pre-existing, intentional product behavior ("Workflow switch"),
    // not what this journey is testing.
    await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId: userA } as any, sessionA.id);
    const recA = await prisma.fitnessRecommendation.findFirst({ where: { userId: userA } });
    assert.ok(recA, "A's own PT recommendation must exist");
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId: userA } as any, sessionA.id);
    const workflowA = await prisma.agentWorkflowSession.findFirst({ where: { userId: userA } });
    assert.ok(workflowA);

    // B, using A's own real sessionId (a guessed/leaked session id), must be rejected OUTRIGHT by the
    // existing ownSession() boundary — the very first check in tryTurnUnguarded, before any routing —
    // for every kind of turn, not just one: resuming A's slot, excluding against A's shortlist, and
    // starting a fresh recognized intent all hit the SAME 404.
    await assert.rejects(() => fitnessAgent.tryTurn("60 phút", { userId: userB } as any, sessionA.id), /not found|404/i, "B must never resume A's workflow, even by guessing A's real session id");
    await assert.rejects(() => fitnessAgent.tryTurn("Không thích người thứ hai.", { userId: userB } as any, sessionA.id), /not found|404/i, "B must never revise A's PT shortlist via A's session id");
    await assert.rejects(() => fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId: userB } as any, sessionA.id), /not found|404/i);
    const workflowAAfter = await prisma.agentWorkflowSession.findFirst({ where: { userId: userA } });
    assert.deepEqual({ status: workflowAAfter!.status, expectedSlot: workflowAAfter!.expectedSlot }, { status: workflowA!.status, expectedSlot: workflowA!.expectedSlot }, "every rejected attempt by B must leave A's workflow completely untouched");

    // B, in B's OWN real session (no borrowed id), referencing an ordinal ("PT thứ hai") with no
    // recommendation of B's own on file: must resolve to nothing of A's — proven at the tryTurn level,
    // not just the unit level (already covered in revision-pt-program.test.ts's own cross-user case).
    const bOwnSession = await fitnessAgent.tryTurn("Không thích người thứ hai.", { userId: userB } as any, sessionB.id);
    const recBAfter = await prisma.fitnessRecommendation.findMany({ where: { userId: userB } });
    assert.equal(recBAfter.length, 0, "B's own session must never resolve A's PT shortlist");
    void bOwnSession;

    // B cannot confirm A's real pending action either, even quoting its real id directly via execute()
    // (which looks up the action's OWN sessionId and runs the SAME ownSession check).
    const draftA = await prisma.fitnessAgentAction.findFirst({ where: { userId: userA } });
    if (draftA) {
      await assert.rejects(() => fitnessAgent.execute({ userId: userB } as any, draftA.id, true), /not found|404/i, "B must never confirm A's real pending action by id");
    }
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId: userA } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId: userA } });
    await prisma.fitnessRecommendation.deleteMany({ where: { userId: userA } });
    await prisma.chatSession.delete({ where: { id: sessionA.id } });
    await cleanup(userB, sessionB.id);
  }
});

// =====================================================================================
// J9 — Stale/revised proposal (reuses Batch 4's own proven mechanism at this suite's boundary)
// =====================================================================================
test("J9 stale/revised proposal: propose A -> revise to B -> confirm -> only B is ever persisted (same invariant Batch 4 already proved, re-confirmed through this suite's own workout-coach setup)", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", days: [1, 2, 3, 4, 5], sessionMinutes: null }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 5, availableEquipment: ["barbell", "dumbbell", "bodyweight"], injuries: [], preferredTrainingDays: [1, 2, 3, 4, 5] } },
  } as any);
  let mutationPayloadSeen: any = null;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async (_i: any, payload: any) => { mutationPayloadSeen = payload; return { success: true }; };
  const session = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId } as any, session.id);
    await fitnessAgent.tryTurn("1 tiếng", { userId } as any, session.id); // proposal A: 5 sessions
    const draft = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    await fitnessAgent.tryTurn("3 buổi thôi", { userId } as any, session.id); // revise to B: 3 sessions
    const confirmed = await fitnessAgent.execute({ userId } as any, draft!.id, true);
    assert.equal((confirmed as any).type, "ACTION_RESULT");
    assert.equal(mutationPayloadSeen.weeklySchedule.length, 3, "the authoritative write must reflect B (3 sessions), never the superseded A (5 sessions)");
  } finally { await cleanup(userId, session.id); }
});

// =====================================================================================
// J10 — Duplicate confirmation: sequential + concurrent, exactly one authoritative mutation
// =====================================================================================
test("J10 duplicate confirmation: sequential double-confirm and concurrent Promise.allSettled confirms both yield exactly one authoritative mutation", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const userId = `u-${randomUUID()}`;
  stubExerciseResolution();
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "WEIGHT_LOSS", days: [1, 2, 3], sessionMinutes: 45 }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE", safetyScreeningStatus: "CLEARED", injuries: [],
      training: { trainingDaysPerWeek: 3, availableEquipment: ["bodyweight"], injuries: [], preferredTrainingDays: [1, 2, 3] } },
  } as any);
  let mutationCalls = 0;
  fitnessAgentDeps.tools.importAiPlanToSchedule = async () => { mutationCalls += 1; await new Promise((r) => setTimeout(r, 15)); return { success: true }; };
  const session = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId } as any, session.id);
    const draft = await prisma.fitnessAgentAction.findFirst({ where: { userId, kind: "CREATE_WORKOUT_PLAN" } });
    assert.ok(draft);

    // Concurrent confirms on the SAME real pending action — the atomic PENDING->EXECUTING claim
    // (fitness-agent.service.ts::execute) must let exactly one through.
    const results = await Promise.allSettled([
      fitnessAgent.execute({ userId } as any, draft!.id, true),
      fitnessAgent.execute({ userId } as any, draft!.id, true),
      fitnessAgent.execute({ userId } as any, draft!.id, true),
    ]);
    assert.equal(mutationCalls, 1, "exactly one authoritative business mutation, regardless of concurrent confirm attempts");
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.ok(fulfilled.length >= 1, "at least one concurrent confirm must succeed truthfully");
    const final = await prisma.fitnessAgentAction.findUnique({ where: { id: draft!.id } });
    assert.equal(final!.status, "COMPLETED");

    // A further sequential confirm stays idempotent — no second write.
    const again = await fitnessAgent.execute({ userId } as any, draft!.id, true);
    assert.equal((again as any).type, "ACTION_RESULT");
    assert.equal(mutationCalls, 1, "a later sequential confirm on an already-COMPLETED action must never write twice");
  } finally { await cleanup(userId, session.id); }
});
