/**
 * Conversational AI Coach — Remediation #2 (Codex Independent Evaluation #2,
 * decision RETURN_TO_CLAUDE). Covers the one remaining HIGH: a slot
 * candidate accepted while OTHER context was still incomplete (so its own
 * `validateContext` could not yet judge it) must be REVALIDATED once every
 * required slot becomes known, BEFORE it is ever shown inside a
 * `PROFILE_UPDATE_CONFIRMATION` — not just at write time.
 *
 * See docs/codex-conversational-ai-coach-evaluation-2-final-signoff.md §9
 * for the exact finding, and docs/conversational-ai-coach-safety-closure.md
 * for the fix (`finalizeWorkflow`'s new revalidation pass, orchestrator.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { parseTrainingDays, parseMinutes } from "../agent-workflow/slot-values";

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
  return prisma.chatSession.create({ data: { userId, title: "Remediation 2 test" } });
}

function stubRoadmapFixtures(profileOverrides: Record<string, unknown> = {}) {
  const profile: Record<string, unknown> = {
    goal: null, age: null, gender: "MALE", heightCm: null, currentWeight: null, targetWeight: null,
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
// §10 — the exact Codex golden deferred-context case
// ---------------------------------------------------------------------

test("Remediation #2 golden case (real DB): targetWeight=30 extracted before currentWeight is known must NEVER become confirmable once currentWeight arrives", async () => {
  const { calls } = stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, targetWeight: null });
  const userId = `remediation2-golden-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // Initial message: goal/age/height/targetWeight=30 all present, but
    // currentWeight is NOT mentioned — targetWeightSlot.validateContext
    // cannot judge 30kg yet (no currentWeight to check direction against),
    // so it is accepted as a candidate per its own "never block on missing
    // data" contract.
    const r1 = await fitnessAgent.tryTurn(
      "Tôi muốn tạo lộ trình và chương trình tập cho tôi. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, mục tiêu 30kg.",
      identity, session.id,
    );
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    let row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal((row!.slotsJson as any).targetWeight, 30, "30kg is provisionally accepted while currentWeight is still unknown — this is correct at THIS point");
    assert.equal(row!.expectedSlot, "currentWeightKg", "currentWeight must be the only thing still asked for");
    assert.equal(calls.updateProfileFields.length, 0);

    // Now currentWeight arrives — every contextual slot must be
    // REVALIDATED against the now-complete context before any
    // confirmation is shown.
    const r2 = await fitnessAgent.tryTurn("80kg", identity, session.id);
    assert.notEqual(r2!.blocks[0]?.type, "PROFILE_UPDATE_CONFIRMATION", "an unsafe targetWeight must NEVER reach a confirmable state, even after deferred context arrives");
    assert.equal(calls.updateProfileFields.length, 0, "zero writes — the unsafe candidate must never even be proposed, let alone written");

    row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.status, "COLLECTING_SLOTS", "must return to collecting, not sit in AWAITING_SLOT_CONFIRMATION with an unsafe value");
    assert.equal(row!.expectedSlot, "targetWeight", "must specifically re-ask for the field that failed revalidation");
    const slotsAfterRejection = row!.slotsJson as Record<string, unknown>;
    assert.equal(slotsAfterRejection.targetWeight, undefined, "the invalid candidate must be REMOVED from known slots, not just hidden");
    assert.equal(slotsAfterRejection.currentWeightKg, 80, "everything else already known must be preserved — the user must not have to repeat age/height/currentWeight");
    assert.equal(slotsAfterRejection.age, 25);
    assert.equal(slotsAfterRejection.heightCm, 175);
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §11 — recovery after rejection
// ---------------------------------------------------------------------

test("Remediation #2 recovery (real DB): after the deferred-context rejection, a valid corrected target weight resumes the SAME workflow normally", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, targetWeight: null });
  const userId = `remediation2-recovery-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tôi muốn tạo lộ trình và chương trình tập cho tôi. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, mục tiêu 30kg.", identity, session.id);
    await fitnessAgent.tryTurn("80kg", identity, session.id); // triggers the deferred-context rejection

    const r3 = await fitnessAgent.tryTurn("72kg", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "a valid corrected value must produce a real confirmation");
    const changes = (r3!.blocks[0] as any).changes as Array<{ field: string; newValue: unknown }>;
    assert.equal(changes.find((c) => c.field === "targetWeight")?.newValue, 72);

    const r4 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.equal(r4!.blocks[0].type, "ACTION_CONFIRMATION", "must auto-resume into the real roadmap preview — the rejection must not be a dead end");
    assert.equal(calls.updateProfileFields.length, 1);
    assert.equal(profile.targetWeight, 72);
    assert.equal(calls.generateRoadmapDraft.length, 1);
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §12 — reverse order regression (currentWeight known first)
// ---------------------------------------------------------------------

test("Remediation #2 reverse-order regression (real DB): currentWeight known BEFORE targetWeight still rejects an unsafe target at candidate time (no dead-end path skipped)", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: "WEIGHT_LOSS", age: 30, heightCm: 180, currentWeight: 80, gender: "MALE", targetWeight: null });
  const userId = `remediation2-reverse-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("30 kg", identity, session.id);
    assert.equal(r2!.blocks.length, 0, "rejected at the candidate stage (handleSlotReply) — the earlier, faster net still works");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);

    const r3 = await fitnessAgent.tryTurn("72 kg", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §14/§15 — batch multi-slot (all in one message)
// ---------------------------------------------------------------------

test("Remediation #2 batch multi-slot unsafe (real DB): an unsafe target arriving in the SAME message as everything else must still never become confirmable", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, targetWeight: null });
  const userId = `remediation2-batch-unsafe-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn(
      "Tôi muốn tạo lộ trình và chương trình tập cho tôi. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, hiện tại 80kg, mục tiêu 30kg.",
      identity, session.id,
    );
    assert.notEqual(r1!.blocks[0]?.type, "PROFILE_UPDATE_CONFIRMATION", "every value arriving in one message must still be revalidated together before any confirmation");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.expectedSlot, "targetWeight");
    assert.equal((row!.slotsJson as any).currentWeightKg, 80, "the other, safe values extracted in the same message must be preserved");
  } finally {
    await cleanup(userId, session.id);
  }
});

test("Remediation #2 batch multi-slot safe regression (real DB): a safe target arriving in one rich message still produces exactly one batch confirmation", async () => {
  const { calls } = stubRoadmapFixtures({ goal: null, age: null, heightCm: null, currentWeight: null, targetWeight: null });
  const userId = `remediation2-batch-safe-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    // gender defaults to "MALE" in stubRoadmapFixtures (not overridden
    // here), so this one rich message alone resolves all 6 required slots
    // — gender itself is never extracted from free text (see roadmap.
    // workflow.ts's own disclosed scope boundary), but it's already known
    // from context, so nothing further needs to be asked.
    const r1 = await fitnessAgent.tryTurn(
      "Tôi muốn tạo lộ trình và chương trình tập cho tôi. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, hiện tại 80kg, mục tiêu 72kg.",
      identity, session.id,
    );
    assert.equal(r1!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION", "every value extracted from the one rich message + already-known gender must resolve in a single turn");
    const changes = (r1!.blocks[0] as any).changes as Array<{ field: string }>;
    assert.equal(changes.length, 5, "one batch confirmation covering every extracted field (goal/age/heightCm/currentWeight/targetWeight) — no multi-slot UX regression from the new revalidation pass");
    assert.equal(calls.generateRoadmapDraft.length, 0, "still a preview only, no write yet");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §16 — pre-write safety regression (must still exist, unchanged)
// ---------------------------------------------------------------------

test("Remediation #2 pre-write safety regression (real DB): a value safe at propose time, made unsafe by fresh context at confirm time, is still rejected at write", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: "WEIGHT_LOSS", age: 30, heightCm: 180, currentWeight: 80, gender: "MALE", targetWeight: null });
  const userId = `remediation2-prewrite-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("65 kg", identity, session.id); // safe at 180cm (BMI ~20.1)
    assert.equal(r2!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    profile.heightCm = 200; // makes 65kg newly unsafe (BMI 16.25)
    const r3 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.equal(r3!.blocks.length, 0);
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §17 — PROFILE_FACT use-once regression
// ---------------------------------------------------------------------

test("Remediation #2 use-once regression (real DB): still refused for every PROFILE_FACT field after the revalidation change", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 80, gender: "MALE", targetWeight: null });
  const userId = `remediation2-useonce-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    await fitnessAgent.tryTurn("72 kg", identity, session.id);
    const r3 = await fitnessAgent.tryTurn("Chỉ dùng cho lần này", identity, session.id);
    assert.equal(r3!.blocks.length, 0);
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §18 — correction regression (including unsafe correction)
// ---------------------------------------------------------------------

test("Remediation #2 correction regression (real DB): a correction to an UNSAFE value is not accepted as a valid correction", async () => {
  const { profile, calls } = stubRoadmapFixtures({ goal: "WEIGHT_LOSS", age: 30, heightCm: 180, currentWeight: 80, gender: "MALE", targetWeight: null });
  const userId = `remediation2-unsafe-correction-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("tôi muốn tạo lộ trình và chương trình tập cho tôi", identity, session.id);
    await fitnessAgent.tryTurn("72 kg", identity, session.id);
    const r3 = await fitnessAgent.tryTurn("Không, 30kg", identity, session.id);
    // "30kg" fails validateContext, so tryDetectCorrection must not accept
    // it as a replacement — falls through to the bare-decline path instead.
    assert.equal(r3!.blocks.length, 0, "must not show a confirmation containing the unsafe 30kg replacement");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.targetWeight, null);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.status, "AWAITING_SLOT_CONFIRMATION", "the original safe 72kg proposal must remain pending, untouched by the rejected correction attempt");
    const pending = row!.pendingProfileUpdate as any[];
    assert.equal(pending.find((c) => c.slotKey === "targetWeight")?.newValue, 72, "the ORIGINAL safe value must still be what's pending");
  } finally {
    await cleanup(userId, session.id);
  }
});

// ---------------------------------------------------------------------
// §15/§20-21 — parser variants (unit-level, no DB needed)
// ---------------------------------------------------------------------

test("Remediation #2 training-days parser variants", () => {
  for (const [input, expected] of [
    ["T2 T4 T6", [1, 3, 5]],
    ["thứ 2 4 6", [1, 3, 5]],
    ["thứ 2, 4, 6", [1, 3, 5]],
    ["thứ 2, thứ 4, thứ 6", [1, 3, 5]],
    ["thứ 2 - thứ 4 - thứ 6", [1, 3, 5]],
  ] as const) {
    const result = parseTrainingDays(input);
    assert.equal(result.ok, true, `expected ${input} to parse`);
    assert.deepEqual((result as any).value, expected, `${input} should parse to ${JSON.stringify(expected)}`);
  }
});

test("Remediation #2 duration parser variants", () => {
  for (const [input, expected] of [
    ["60 phút", 60], ["90 phút", 90], ["1 giờ", 60], ["1 tiếng", 60],
    ["1 giờ 30 phút", 90], ["1.5 giờ", 90], ["1,5 giờ", 90],
  ] as const) {
    const result = parseMinutes(input);
    assert.equal(result.ok, true, `expected ${input} to parse`);
    assert.equal((result as any).value, expected, `${input} should parse to ${expected} minutes`);
  }
});

// ---------------------------------------------------------------------
// No-cap PT budget — real end-to-end (Remediation #2's other change)
// ---------------------------------------------------------------------

test("Remediation #2 no-cap PT budget (real DB): resumes to real PT search with no numeric budget, never persists a fake value", async () => {
  const originalFindPT = fitnessAgentDeps.tools.findPTCandidates;
  const originalEvidence = fitnessAgentDeps.tools.getScientificEvidence;
  const profile: Record<string, unknown> = { goal: "WEIGHT_LOSS", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null,
    reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER", goalIntent: null };
  const calls = { findPTCandidates: [] as any[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  (fitnessAgentDeps.tools as any).findPTCandidates = async (_identity: any, preferences: any) => {
    calls.findPTCandidates.push(preferences);
    return { historyAuditId: "audit", truncated: false, candidates: [{ id: "11111111-1111-4111-8111-111111111111", name: "PT",
      packages: [{ id: "22222222-2222-4222-8222-222222222222", price: 1_500_000, sessions: 8 }], dataOrigin: "REAL",
      history: { count: 0, note: "none" }, specialties: [], availableDays: [1, 3, 5] }] } as any;
  };
  (fitnessAgentDeps.tools as any).getScientificEvidence = () => [] as any;

  const userId = `remediation2-nocap-${randomUUID()}`;
  const session = await seedSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", identity, session.id);
    const r2 = await fitnessAgent.tryTurn("Không giới hạn", identity, session.id);
    assert.equal(r2!.blocks[0].type, "PT_RECOMMENDATIONS", "no-cap must resume into the real search, not re-ask forever");
    assert.equal((calls.findPTCandidates[0] as any).budgetVnd, undefined, "no-cap must never smuggle a fake numeric budget (0 or MAX_VALUE) into real search preferences");
    assert.equal(profile.budgetVnd, null, "no-cap must never be persisted as a false profile fact");
  } finally {
    fitnessAgentDeps.tools.findPTCandidates = originalFindPT;
    fitnessAgentDeps.tools.getScientificEvidence = originalEvidence;
    await cleanup(userId, session.id);
  }
});
