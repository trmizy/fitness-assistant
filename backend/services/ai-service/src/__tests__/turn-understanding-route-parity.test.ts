/**
 * Phase 3 Batch 2 — route-parity evidence (docs/ai-product/phase3-batch2-unified-turn.md §13).
 * The new turn_understanding diagnostic hooks in fitness-agent.service.ts::tryTurnUnguarded must
 * never change which branch wins. Each test here drives a REAL fitnessAgent.tryTurn() call (same
 * convention as the existing agent-workflow-create-workout-plan.test.ts /
 * conversational-intelligence-global.test.ts suites) and asserts the dispatched outcome is
 * exactly what the pre-Batch-2 behavior already was — these are the SAME scenarios those files
 * already prove pass/fail on their own; this file's job is only to confirm the new diagnostic
 * hooks sitting in front of them never throw and never redirect the outcome.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { readerDeps } from "../conversational-intelligence/global/readers";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  extract: fitnessAgentDeps.profileExtractor.extract,
  readerGet: readerDeps.get,
};
const originalCiV2 = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  readerDeps.get = original.readerGet;
  if (originalCiV2 === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalCiV2;
});
test.after(async () => { await prisma.$disconnect(); });

function stubProfile(overrides: Record<string, unknown> = {}) {
  const profile = { goal: "MUSCLE_GAIN", age: 28, gender: "MALE", heightCm: 175, currentWeight: 80, targetWeight: null, days: [1, 3, 5], sessionMinutes: null as number | null, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], experience: "INTERMEDIATE", goalIntent: null, ...overrides };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, age: profile.age, heightCm: profile.heightCm, currentWeightKg: profile.currentWeight, gender: profile.gender,
      experienceLevel: profile.experience,
      training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3, availableEquipment: [], injuries: [] },
      nutritionGoal: { calories: 2200, protein: 150, carbs: 220, fat: 70 },
    },
    currentWorkoutProgram: null,
  } as any);
  readerDeps.get = async (url: string) => {
    if (url.endsWith("/contracts/client")) return { status: 200, data: [] };
    return { status: 404, data: {} };
  };
}

const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "turn-understanding parity" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};

// ───────────────────────── CI-V2 OFF (today's real default) ─────────────────────────
test("legacy default (CI-V2 off): workout workflow start still asks only the missing slot — diagnostic hook does not alter the outcome", async () => {
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Tạo lịch tập cho tôi", { userId } as any, session.id);
    assert.ok(r, "must still answer (same as before this batch)");
    assert.equal(r!.blocks[0].type, "WORKFLOW_MISSING_DATA");
  } finally { await cleanup(userId, session.id); }
});

test("legacy default (CI-V2 off): an unrecognized message still falls through to null (never forced into a business intent by the diagnostic hook)", async () => {
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("asdkjaslkdj random gibberish xyz", { userId } as any, session.id);
    assert.equal(r, null, "no recognizable intent -> must still fall through exactly as before");
  } finally { await cleanup(userId, session.id); }
});

test("legacy default (CI-V2 off): 'xác nhận' with nothing pending is still answered honestly by the existing confirmation boundary, not hijacked by the new diagnostic hook", async () => {
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("xác nhận", { userId } as any, session.id);
    assert.ok(r, "confirmation boundary must still own this turn");
    assert.match(r!.answer, /chưa|không có/i);
  } finally { await cleanup(userId, session.id); }
});

// ───────────────────────── CI-V2 ON ─────────────────────────
test("CI-V2 on: READ_STATE (nutrition target question) still answers from the real data, diagnostic hook present and silent", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Mục tiêu dinh dưỡng hiện tại của tôi là gì?", { userId } as any, session.id);
    assert.ok(r);
    assert.match(r!.answer, /2.200 kcal|2200 kcal/i);
  } finally { await cleanup(userId, session.id); }
});

test("CI-V2 on: CANCEL route still cancels a waiting workflow (bare 'thôi'), diagnostic hook present and silent", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("Tìm PT cho tôi", { userId } as any, session.id);
    assert.ok(r1, "must start the PT workflow and ask a slot question");
    const r2 = await fitnessAgent.tryTurn("thôi", { userId } as any, session.id);
    assert.match(r2!.answer, /đã hủy|hủy/i);
    const rows = await prisma.agentWorkflowSession.findMany({ where: { userId } });
    assert.equal(rows[0]?.status, "CANCELLED");
  } finally { await cleanup(userId, session.id); }
});

test("CI-V2 on: a knowledge question not tied to the user's own data still falls through to the generic chat pipeline (route pass-through unaffected)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubProfile();
  const userId = `tu-parity-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Progressive overload là gì?", { userId } as any, session.id);
    // KNOWLEDGE_QA with no waiting workflow -> runGlobalTurn returns bare {route} (pass-through);
    // tryTurnUnguarded's own effectiveKind-null branch then returns null here (no RAG stub wired
    // in this test) — the assertion that matters is that the diagnostic hook never throws and
    // never redirects this into a business workflow.
    assert.equal(r, null);
  } finally { await cleanup(userId, session.id); }
});

// ───────────────────────── diagnostic hook never throws, even on edge-case input ─────────────────────────
test("the diagnostic hook never throws on an empty/whitespace-only message in either CI-V2 mode", async () => {
  for (const mode of ["off", "on"]) {
    if (mode === "off") delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
    stubProfile();
    const userId = `tu-parity-${randomUUID()}`;
    const session = await newSession(userId);
    try {
      await assert.doesNotReject(() => fitnessAgent.tryTurn("   ", { userId } as any, session.id));
    } finally { await cleanup(userId, session.id); }
  }
});
