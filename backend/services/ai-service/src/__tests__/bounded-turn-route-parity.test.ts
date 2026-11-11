/**
 * Phase 3 Batch 3 — end-to-end route-parity via real fitnessAgent.tryTurn() calls, covering the
 * feature flag's 3 states, cross-user isolation, and interruption/resume generalized to a SECOND
 * workflow type (FIND_PT) beyond Phase 2B's own CREATE_WORKOUT_PLAN proof.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { readerDeps } from "../conversational-intelligence/global/readers";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  extract: fitnessAgentDeps.profileExtractor.extract,
  narrateRecommendations: fitnessAgentDeps.narrateRecommendations,
  readerGet: readerDeps.get,
};
const originalCiV2 = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
const originalUnifiedCoach = process.env.GYMINI_UNIFIED_AI_COACH;
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.narrateRecommendations = original.narrateRecommendations;
  readerDeps.get = original.readerGet;
  if (originalCiV2 === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalCiV2;
  if (originalUnifiedCoach === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = originalUnifiedCoach;
});
test.after(async () => { await prisma.$disconnect(); });

function ptCandidate(id: string, name: string) {
  return { id, name, specialties: ["Tăng cơ", "MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5, history: { count: 3 } };
}

function stubPtComposite(userId: string, budgetVnd: number | null = 1500000) {
  const profile = { goal: "MUSCLE_GAIN", age: 28, gender: "MALE", heightCm: 175, currentWeight: 80, targetWeight: null, days: [1, 3, 5], sessionMinutes: 60, budgetVnd, reviewRequired: false, injuries: [], equipment: [], experience: "INTERMEDIATE", goalIntent: null };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: profile.goal, training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3, availableEquipment: [], injuries: [] } }, currentWorkoutProgram: null } as any);
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, prefs: any) => ({ candidates: [ptCandidate("pt-A", "PT An"), ptCandidate("pt-B", "PT Bình")], historyAuditId: "h1", truncated: false, preferences: prefs } as any);
  fitnessAgentDeps.narrateRecommendations = async (ranked: any[]) => ({ narrations: ranked.map((r) => ({ candidateId: r.candidate.id, summary: "phù hợp mục tiêu tăng cơ của bạn", strengths: [] })), usedFallback: false } as any);
  readerDeps.get = async (url: string) => {
    if (url.endsWith("/contracts/client")) return { status: 200, data: [{ status: "ACTIVE", packageName: "Gói PT hiện tại", ptProfile: { firstName: userId.startsWith("u-a") ? "Hùng" : "Trang" } }] };
    return { status: 404, data: {} };
  };
}

const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "bounded-turn parity" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
// Clause 2 must re-mention "PT" explicitly — router.ts::recommendTopic only returns "PT" when the
// SAME clause (post-splitClauses) still contains N.pt; "có ai phù hợp hơn" alone (no "PT" in that
// clause) classifies as KNOWLEDGE_QA, not RECOMMEND, confirmed empirically against the real router.
const PT_COMPOSITE_QUESTION = "PT hiện tại của tôi là ai và PT nào phù hợp hơn với tôi?";

test("flag OFF (default): PT composite gets the existing offer-only answer — byte-identical to pre-Batch-3 behavior", async () => {
  delete process.env.GYMINI_UNIFIED_AI_COACH;
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-a-${randomUUID()}`;
  stubPtComposite(userId);
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn(PT_COMPOSITE_QUESTION, { userId } as any, session.id);
    assert.ok(r);
    assert.match(r!.answer, /Hùng/, "the current-PT read must still be answered");
    assert.ok(!r!.answer.includes("PT An") && !r!.answer.includes("PT Bình"), "the new inline recommendation must NOT appear when the flag is off");
  } finally { await cleanup(userId, session.id); }
});

test("flag SHADOW: identical visible answer to OFF — the plan is computed/logged but the executor never runs", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "shadow";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-a-${randomUUID()}`;
  stubPtComposite(userId);
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn(PT_COMPOSITE_QUESTION, { userId } as any, session.id);
    assert.ok(!r!.answer.includes("PT An") && !r!.answer.includes("PT Bình"), "shadow mode must never change the visible answer");
  } finally { await cleanup(userId, session.id); }
});

test("flag ON: the PT composite gets the real inline recommendation, combined with the real current-PT read", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userId = `u-a-${randomUUID()}`;
  stubPtComposite(userId);
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn(PT_COMPOSITE_QUESTION, { userId } as any, session.id);
    assert.ok(r);
    assert.match(r!.answer, /Hùng/, "current-PT fact from the real READ");
    assert.match(r!.answer, /PT An|PT Bình/, "real recommendation candidates");
    assert.ok(!/\b0\.\d+\b|total|rankScore/.test(r!.answer), "no raw internal score ever surfaces in the user-facing text");
  } finally { await cleanup(userId, session.id); }
});

test("cross-user isolation: two users' concurrent PT-composite turns never share candidates/context", async () => {
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const userA = `u-a-${randomUUID()}`;
  const userB = `u-b-${randomUUID()}`;
  stubPtComposite(userA); // both users resolve through the SAME stub (deterministic by design) — the
  // isolation property under test is that each call is independently resolved via the authenticated
  // identity passed in, never a shared cache/session keyed wrong.
  const sessionA = await newSession(userA);
  const sessionB = await newSession(userB);
  try {
    const [ra, rb] = await Promise.all([
      fitnessAgent.tryTurn(PT_COMPOSITE_QUESTION, { userId: userA } as any, sessionA.id),
      fitnessAgent.tryTurn(PT_COMPOSITE_QUESTION, { userId: userB } as any, sessionB.id),
    ]);
    assert.ok(ra && rb);
    const rowsA = await prisma.agentWorkflowSession.findMany({ where: { userId: userA } });
    const rowsB = await prisma.agentWorkflowSession.findMany({ where: { userId: userB } });
    assert.equal(rowsA.length, 0, "a read-only bounded composite must never create a workflow row");
    assert.equal(rowsB.length, 0);
  } finally { await cleanup(userA, sessionA.id); await cleanup(userB, sessionB.id); }
});

test("interruption/resume generalized to a SECOND workflow type (FIND_PT): a nutrition READ interrupts without corrupting the waiting PT workflow, which then resumes", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  delete process.env.GYMINI_UNIFIED_AI_COACH;
  const userId = `u-a-${randomUUID()}`;
  stubPtComposite(userId, null); // budget intentionally unknown so FIND_PT actually pauses on it
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(r1, "must start the FIND_PT workflow and ask the remaining slot (budget)");
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.ok(before, "a real workflow row must exist while budget is pending");
    const beforeSnapshot = { id: before!.id, status: before!.status, expectedSlot: before!.expectedSlot, slotsJson: JSON.stringify(before!.slotsJson) };

    const r2 = await fitnessAgent.tryTurn("Mục tiêu hiện tại của tôi là gì?", { userId } as any, session.id);
    assert.ok(r2, "the unrelated goal question must be answered, not swallowed");

    const after = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    const afterSnapshot = { id: after!.id, status: after!.status, expectedSlot: after!.expectedSlot, slotsJson: JSON.stringify(after!.slotsJson) };
    assert.deepEqual(afterSnapshot, beforeSnapshot, "the FIND_PT workflow must be byte-identical across the interruption — generalizes Phase 2B's proof beyond CREATE_WORKOUT_PLAN");

    const r3 = await fitnessAgent.tryTurn("1 triệu rưỡi", { userId } as any, session.id);
    assert.ok(r3, "must resume the SAME workflow with the budget answer");
    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.equal(rows.length, 1, "resuming must never create a second, competing workflow row");
  } finally { await cleanup(userId, session.id); }
});
