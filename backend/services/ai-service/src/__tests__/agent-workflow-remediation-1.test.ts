/**
 * Conversational AI Coach — Remediation #1 (Codex Independent Evaluation #1,
 * decision RETURN_TO_CLAUDE). DB-backed regression coverage for every fix
 * required in docs/codex-conversational-ai-coach-evaluation-1.md's
 * "Required Re-Review Cases" (§54), beyond what the evaluator itself
 * already exercises (backend/services/ai-service/src/evaluation/
 * conversational-workflow/evaluate_conversational_workflow.ts — not
 * modified by this pass, re-run separately as its own evidence).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { workflowStateRepository } from "../agent-workflow/workflow-state.repository";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  generateRoadmapDraft: fitnessAgentDeps.tools.generateRoadmapDraft,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  extract: fitnessAgentDeps.profileExtractor.extract,
};
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.updateProfileFields = original.updateProfileFields;
  fitnessAgentDeps.tools.generateRoadmapDraft = original.generateRoadmapDraft;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
});
test.after(async () => {
  await prisma.$disconnect();
});

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Remediation 1 test" } });
}

function stubRoadmapFixtures(profileOverrides: Record<string, unknown> = {}) {
  const profile: Record<string, unknown> = {
    goal: "WEIGHT_LOSS", age: 30, gender: "MALE", heightCm: 170, currentWeight: 80, targetWeight: null,
    days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [],
    experience: "BEGINNER", goalIntent: null, ...profileOverrides,
  };
  const calls = { updateProfileFields: [] as any[], generateRoadmapDraft: [] as any[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_identity: any, fields: any) => {
    calls.updateProfileFields.push(fields);
    Object.assign(profile, fields);
    return {};
  };
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { goal: profile.goal, age: profile.age, heightCm: profile.heightCm, currentWeightKg: profile.currentWeight, gender: profile.gender,
      training: { preferredTrainingDays: profile.days, trainingDaysPerWeek: (profile.days as number[]).length } },
  } as any);
  fitnessAgentDeps.tools.generateRoadmapDraft = async (_identity: any, input: any) => {
    calls.generateRoadmapDraft.push(input);
    const start = new Date();
    return { goalType: input.goalType, summary: "fixture", reasoningSummary: "fixture", confidence: 0.8, warnings: [], assumptions: [],
      plannedStartAt: start.toISOString(),
      phases: [{ phaseType: "FAT_LOSS", plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 8 * 7 * 86_400_000).toISOString(), name: "Phase 1" }] };
  };
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({ programs: [{ id: "prog", name: "Program", goal: "WEIGHT_LOSS", daysPerWeek: 3,
    durationWeeks: 8, estimatedMinutes: 60, experienceLevel: "BEGINNER", focusMuscles: [], fingerprint: "fp", dataOrigin: "REAL", days: [] }], warnings: [] } as any);
  return { profile, calls };
}

async function cleanup(userId: string, sessionId: string) {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
}

// ---------------------------------------------------------------------
// Fix B — contextual target-weight safety (Codex HIGH finding)
// ---------------------------------------------------------------------

test("Remediation Fix B (real DB): the exact Codex reproduction (180cm/80kg -> 30kg target) is rejected — zero write, workflow stays pending", async () => {
  const { profile, calls } = stubRoadmapFixtures({ heightCm: 180, currentWeight: 80, targetWeight: null });
  const userId = `remediation-unsafe-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("30 kg", identity, session.id);
    assert.equal(r2!.blocks.length, 0, "an unsafe target must re-ask, never show a confirmable proposal");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.status, "COLLECTING_SLOTS");
    assert.equal(row!.expectedSlot, "targetWeight");

    // A safe follow-up value must still work.
    const r3 = await fitnessAgent.tryTurn("72 kg", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix B (real DB): safety re-runs immediately before write using fresh context, not just at propose time", async () => {
  const { profile, calls } = stubRoadmapFixtures({ heightCm: 180, currentWeight: 80, targetWeight: null });
  const userId = `remediation-unsafe-fresh-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    // 65kg is safe at 180cm today (BMI ~20.1) — proposes normally.
    const r2 = await fitnessAgent.tryTurn("65 kg", identity, session.id);
    assert.equal(r2!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    // Height changes underneath the pending proposal to something that makes
    // 65kg newly unsafe (65 / (1.0)^2 = 65 BMI is still safe; use a height
    // that makes 65kg cross under 18.5 instead: heightCm 200 -> BMI 65/4=16.25).
    profile.heightCm = 200;
    const r3 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.equal(r3!.blocks.length, 0, "the second safety check must re-ask, not proceed to a business preview");
    assert.equal(calls.updateProfileFields.length, 0, "must not write once the value is unsafe under freshly reloaded context");
    assert.equal(profile.targetWeight, null);
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix B (real DB): ordinary weight-loss/gain targets are NOT over-rejected", async () => {
  stubRoadmapFixtures({ heightCm: 170, currentWeight: 80, targetWeight: null, goal: "WEIGHT_LOSS" });
  const userIdLoss = `remediation-safe-loss-${randomUUID()}`;
  const sessionLoss = await seedSession(userIdLoss);
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", { userId: userIdLoss } as any, sessionLoss.id);
    const r2 = await fitnessAgent.tryTurn("72 kg", { userId: userIdLoss } as any, sessionLoss.id);
    assert.equal(r2!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "a normal, safe weight-loss target must not be rejected");
  } finally {
    await cleanup(userIdLoss, sessionLoss.id);
  }

  stubRoadmapFixtures({ heightCm: 175, currentWeight: 65, targetWeight: null, goal: "MUSCLE_GAIN" });
  const userIdGain = `remediation-safe-gain-${randomUUID()}`;
  const sessionGain = await seedSession(userIdGain);
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", { userId: userIdGain } as any, sessionGain.id);
    const r2 = await fitnessAgent.tryTurn("72 kg", { userId: userIdGain } as any, sessionGain.id);
    assert.equal(r2!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "a normal, safe muscle-gain target must not be rejected");
  } finally {
    await cleanup(userIdGain, sessionGain.id);
  }
});

// ---------------------------------------------------------------------
// Fix C — initial/follow-up multi-slot extraction
// ---------------------------------------------------------------------

test("Remediation Fix C (real DB): a rich initial message resolves multiple slots at once, asks only what's genuinely missing", async () => {
  stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, gender: null, targetWeight: null });
  const userId = `remediation-multislot-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn(
      "tôi muốn tạo lộ trình và chương trình tập cho tôi. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, 80kg, mục tiêu 72kg.",
      identity, session.id,
    );
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    const slots = row!.slotsJson as Record<string, unknown>;
    assert.equal(slots.goal, "WEIGHT_LOSS");
    assert.equal(slots.age, 25);
    assert.equal(slots.heightCm, 175);
    assert.equal(slots.currentWeightKg, 80);
    assert.equal(slots.targetWeight, 72);
    assert.equal(row!.expectedSlot, "gender", "gender is the only genuinely-missing field — never re-derived from free text (false-positive risk)");

    const r2 = await fitnessAgent.tryTurn("nam", identity, session.id);
    assert.equal(r2!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "once gender is answered, every required slot is resolved");
    const changes = (r2!.blocks[0] as any).changes as Array<{ field: string; newValue: unknown }>;
    assert.equal(changes.length, 6, "all 6 profile facts extracted/answered must be part of ONE batch confirmation");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix C (real DB): ambiguous unlabeled numbers in the initial message are never guessed", async () => {
  stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, gender: null, targetWeight: null });
  const userId = `remediation-ambiguous-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const r1 = await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi. 80, 72.", { userId } as any, session.id);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    const slots = row!.slotsJson as Record<string, unknown>;
    assert.equal(slots.currentWeightKg, undefined, "an unlabeled '80, 72' must never be guessed as current/target weight");
    assert.equal(slots.targetWeight, undefined);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix C (real DB): follow-up multi-slot — a reply to ONE expected slot also resolves other still-missing slots mentioned in the same message", async () => {
  stubRoadmapFixtures({ goal: "WEIGHT_LOSS", age: null, heightCm: null, currentWeight: null, gender: "MALE", targetWeight: null });
  const userId = `remediation-followup-multislot-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    assert.equal((r1!.blocks[0] as any).missing.length, 4); // age, heightCm, currentWeightKg, targetWeight (goal=WEIGHT_LOSS makes it required too)
    const r2 = await fitnessAgent.tryTurn("25 tuổi, cao 175cm, hiện 80kg", identity, session.id);
    // age/heightCm/currentWeightKg were all answered in one message — only
    // targetWeight (which depends on all being known first) remains.
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    const slots = row!.slotsJson as Record<string, unknown>;
    assert.equal(slots.age, 25);
    assert.equal(slots.heightCm, 175);
    assert.equal(slots.currentWeightKg, 80);
    assert.equal(r2!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.equal((r2!.blocks[0] as any).missing.length, 1, "only targetWeight should remain");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// Fix D — correction before confirm
// ---------------------------------------------------------------------

test("Remediation Fix D (real DB): 'Không, 70 kg.' after a 72kg proposal replaces the pending value, never treated as decline", async () => {
  const { profile, calls } = stubRoadmapFixtures({ targetWeight: null });
  const userId = `remediation-correction-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    await fitnessAgent.tryTurn("72 kg", identity, session.id);
    const r3 = await fitnessAgent.tryTurn("Không, 70 kg.", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "a correction must produce a new confirmation, not complete/resume");
    const changes = (r3!.blocks[0] as any).changes as Array<{ field: string; newValue: unknown }>;
    assert.equal(changes.find((c) => c.field === "targetWeight")?.newValue, 70);
    assert.equal(calls.updateProfileFields.length, 0, "a correction must never write by itself");
    assert.equal(profile.targetWeight, null);

    const r4 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.equal(r4!.blocks[0].type, "ACTION_CONFIRMATION");
    assert.equal(calls.updateProfileFields.length, 1);
    assert.equal(profile.targetWeight, 70, "the FINAL corrected value (70), not the original proposal (72), must be what gets written");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix D (real DB): a genuine bare decline (no replacement value) is still refused for PROFILE_FACT, not silently treated as a correction", async () => {
  const { profile, calls } = stubRoadmapFixtures({ targetWeight: null });
  const userId = `remediation-bare-decline-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    await fitnessAgent.tryTurn("72 kg", identity, session.id);
    const r3 = await fitnessAgent.tryTurn("Không.", identity, session.id);
    assert.equal(r3!.blocks.length, 0, "must re-explain, not proceed to a business preview");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.status, "AWAITING_SLOT_CONFIRMATION", "must stay pending, not silently resume");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// Fix E — DB-enforced concurrency invariant
// ---------------------------------------------------------------------

test("Remediation Fix E (real DB, real concurrency): 20 concurrent workflow-start requests for the same user/session produce exactly one active row", async () => {
  stubRoadmapFixtures({ targetWeight: null });
  const userId = `remediation-concurrent-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id)),
    );
    assert.ok(results.every((r) => r !== null), "every concurrent request must get SOME answer, never throw");
    const activeRows = await prisma.agentWorkflowSession.findMany({
      where: { userId, sessionId: session.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } },
    });
    assert.equal(activeRows.length, 1, "exactly one active AgentWorkflowSession row must exist after 20 concurrent starts — the DB-level unique index must have rejected every other concurrent insert");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation Fix E (real DB): workflowStateRepository.create() returns null (never throws) when it loses the DB-level race", async () => {
  const userId = `remediation-create-race-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const first = await workflowStateRepository.create(userId, session.id, "CREATE_ROADMAP", {});
    assert.ok(first);
    const second = await workflowStateRepository.create(userId, session.id, "FIND_PT", {});
    assert.equal(second, null, "a second concurrent/overlapping active row must be rejected by the DB, surfaced as null, never thrown");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// Fix F — budget parser (real end-to-end through FIND_PT)
// ---------------------------------------------------------------------

function stubPtFixtures(profileOverrides: Record<string, unknown> = {}) {
  const profile: Record<string, unknown> = {
    goal: "WEIGHT_LOSS", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false,
    injuries: [], equipment: [], experience: "BEGINNER", goalIntent: null, ...profileOverrides,
  };
  const calls = { findPTCandidates: [] as any[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  (fitnessAgentDeps.tools as any).findPTCandidates = async (_identity: any, preferences: any) => {
    calls.findPTCandidates.push(preferences);
    return { historyAuditId: "audit", truncated: false, candidates: [{ id: "11111111-1111-4111-8111-111111111111", name: "PT",
      packages: [{ id: "22222222-2222-4222-8222-222222222222", price: 1_500_000, sessions: 8 }], dataOrigin: "REAL",
      history: { count: 0, note: "none" }, specialties: [], availableDays: [1, 3, 5] }] } as any;
  };
  (fitnessAgentDeps.tools as any).getScientificEvidence = () => [] as any;
  return { profile, calls };
}

test("Remediation Fix F (real DB): a Vietnamese dot-thousands budget reply ('1.500.000') reaches the real PT search as 1,500,000 VND", async () => {
  const originalFindPT = fitnessAgentDeps.tools.findPTCandidates;
  const originalEvidence = fitnessAgentDeps.tools.getScientificEvidence;
  const { calls } = stubPtFixtures({ budgetVnd: null });
  const userId = `remediation-budget-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("1.500.000", identity, session.id);
    assert.equal(r2!.blocks[0].type, "PT_RECOMMENDATIONS");
    assert.equal((calls.findPTCandidates[0] as any).budgetVnd, 1_500_000);
  } finally {
    fitnessAgentDeps.tools.findPTCandidates = originalFindPT;
    fitnessAgentDeps.tools.getScientificEvidence = originalEvidence;
    await cleanup(userId, session.id);
  }
});
