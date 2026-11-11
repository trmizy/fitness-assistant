/**
 * Conversational Intelligence V2 — regression gates.
 *  1. corpus gates (safety-critical error counts must be ZERO; per-capability accuracy floors)
 *  2. the real failure as a GOLDEN conversation through the real workflow orchestrator (real DB, stubbed business tools)
 *  3. flag OFF keeps the legacy behaviour byte-for-byte for the same input
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { evaluateCorpus, type CorpusCase } from "../conversational-intelligence/evaluate";
import { interpretDeterministic, recommendTargetWeight } from "../conversational-intelligence";

const CORPUS_DIR = path.resolve(__dirname, "../../../../../test/conversational-intelligence");
const load = (f: string): CorpusCase[] => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8"));
const ratio = (t: { n: number; ok: number }) => (t.n ? t.ok / t.n : 1);

test("corpus gates (development corpus): zero unit mistakes / cross-field contamination / confirmation bypass; every capability ≥ 98%", () => {
  const ev = evaluateCorpus(load("corpus.json"));
  assert.ok(ev.totalCases >= 150, `corpus has ${ev.totalCases} cases`);
  assert.equal(ev.unitMistakes, 0);
  assert.equal(ev.crossFieldContamination, 0);
  assert.equal(ev.confirmationBypasses, 0);
  for (const [k, t] of Object.entries(ev.metrics)) assert.ok(ratio(t) >= 0.98, `${k}: ${t.ok}/${t.n}\n${ev.failures.join("\n")}`);
});

test("held-out corpus: safety-critical counts stay at zero; entity accuracy ≥ 95%", () => {
  const ev = evaluateCorpus(load("holdout.json"));
  assert.equal(ev.unitMistakes, 0);
  assert.equal(ev.crossFieldContamination, 0);
  assert.equal(ev.confirmationBypasses, 0);
  assert.ok(ratio(ev.metrics.entity) >= 0.95, ev.failures.join("\n"));
});

test("'1m73' is a height in every spelling and never becomes a weight", () => {
  for (const t of ["cao 1m73", "1m 73", "1.73m", "1,73m", "173cm", "173 cm", "cao 1m73 nặng 80kg", "1m73 80kg", "toi cao 1m73 nang 80kg"]) {
    const i = interpretDeterministic(t, {});
    assert.ok(i.entities.some((e) => e.type === "HEIGHT_CM" && e.value === 173), t);
    assert.ok(!i.entities.some((e) => e.type !== "HEIGHT_CM" && !e.negated && e.value === 73), `${t} produced a 73 that is not the height`);
  }
});

test("the target-weight recommendation is DERIVED from the user's own numbers (not a hard-coded value)", () => {
  const a = recommendTargetWeight({ heightCm: 173, currentWeightKg: 80, goal: "WEIGHT_LOSS" });
  const tall = recommendTargetWeight({ heightCm: 190, currentWeightKg: 80, goal: "WEIGHT_LOSS" }); // BMI 22.2 → no loss advised
  const c = recommendTargetWeight({ heightCm: 173, currentWeightKg: 95, goal: "WEIGHT_LOSS" });
  assert.equal(a.kind, "LOSS");
  assert.equal(tall.kind, "MAINTAIN", "height changes the conclusion: the same 80kg on a 190cm frame is not a loss case");
  assert.ok(a.kind === "LOSS" && c.kind === "LOSS");
  if (a.kind === "LOSS" && c.kind === "LOSS") {
    assert.notEqual(a.recommendedKg, c.recommendedKg, "weight changes the recommended value");
    assert.ok(a.recommendedKg < 80 && a.recommendedKg >= 21 * 1.73 * 1.73, "never below the BMI floor");
    assert.ok(a.checkpoints.every((x) => x < 80));
  }
  assert.equal(recommendTargetWeight({ heightCm: 173, goal: "WEIGHT_LOSS" }).kind, "INSUFFICIENT");
  assert.equal(recommendTargetWeight({ heightCm: 173, currentWeightKg: 80, goal: "MUSCLE_GAIN" }).kind, "GAIN_NOT_ADVISED");
});

// ───────────────────────── golden conversation through the real orchestrator ─────────────────────────

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  generateRoadmapDraft: fitnessAgentDeps.tools.generateRoadmapDraft,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  extract: fitnessAgentDeps.profileExtractor.extract,
};
const originalFlag = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
test.afterEach(() => {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.updateProfileFields = original.updateProfileFields;
  fitnessAgentDeps.tools.generateRoadmapDraft = original.generateRoadmapDraft;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  if (originalFlag === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalFlag;
});
test.after(async () => { await prisma.$disconnect(); });

function stubProfile(overrides: Record<string, unknown> = {}) {
  const profile: Record<string, unknown> = {
    goal: "MUSCLE_GAIN", age: 22, gender: "MALE", heightCm: 173, currentWeight: 80, targetWeight: null,
    days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER", goalIntent: null, ...overrides,
  };
  const calls = { updateProfileFields: [] as any[], generateRoadmapDraft: 0 };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: { training_summary: {}, nutrition_summary: {} } } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, fields: any) => { calls.updateProfileFields.push(fields); Object.assign(profile, fields); return {}; };
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: profile.goal, age: profile.age, heightCm: profile.heightCm, currentWeightKg: profile.currentWeight, gender: profile.gender, training: { preferredTrainingDays: profile.days, trainingDaysPerWeek: 3 } } } as any);
  fitnessAgentDeps.tools.generateRoadmapDraft = async (_i: any, input: any) => {
    calls.generateRoadmapDraft += 1;
    const start = new Date();
    return { goalType: input.goalType, summary: "fixture", reasoningSummary: "fixture", confidence: 0.8, warnings: [], assumptions: [], plannedStartAt: start.toISOString(),
      phases: [{ phaseType: "FAT_LOSS", plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 8 * 7 * 86_400_000).toISOString(), name: "Phase 1" }] };
  };
  fitnessAgentDeps.tools.findTrainingPrograms = async () => ({ programs: [{ id: "p", name: "P", goal: "WEIGHT_LOSS", daysPerWeek: 3, durationWeeks: 8, estimatedMinutes: 60, experienceLevel: "BEGINNER", focusMuscles: [], fingerprint: "fp", dataOrigin: "REAL", days: [] }], warnings: [] } as any);
  return { profile, calls };
}
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};

test("GOLDEN (real DB, flag ON): 'mục tiêu 70kg' → 'hãy đề xuất' → '74kg' → the long natural sentence — no repeated validator loop, 1m73 stays a height, goal change is only PROPOSED and needs confirmation", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { profile, calls } = stubProfile();
  const userId = `ci-golden-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "ci golden" } });
  const identity = { userId } as any;
  try {
    const r0 = await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, session.id);
    assert.equal(r0!.blocks[0].type, "WORKFLOW_MISSING_DATA");

    // 1. "mục tiêu 70kg" (stored goal = muscle gain, weight 80) → a CONFLICT question, not a validator rejection
    const r1 = await fitnessAgent.tryTurn("mục tiêu 70kg", identity, session.id);
    assert.match(r1!.answer, /thấp hơn cân nặng hiện tại/);
    assert.match(r1!.answer, /giảm mỡ/);
    assert.doesNotMatch(r1!.answer, /Bạn cho mình một mức cao hơn cân nặng hiện tại nhé/);

    // 2. "ok hãy đề xuất cho tôi" → a recommendation DERIVED from height/weight, not "give me a specific number"
    const r2 = await fitnessAgent.tryTurn("ok hãy đề xuất cho tôi", identity, session.id);
    assert.doesNotMatch(r2!.answer, /con số cụ thể/);
    assert.match(r2!.answer, /173cm/);
    assert.match(r2!.answer, /80kg/);
    assert.match(r2!.answer, /72kg/);
    assert.equal(calls.updateProfileFields.length, 0);

    // 3. "74kg" → follows the direction the assistant itself proposed → PROPOSED goal change + target, behind confirmation
    const r3 = await fitnessAgent.tryTurn("74kg", identity, session.id);
    assert.equal(r3!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    const changes3 = (r3!.blocks[0] as any).changes as Array<{ field: string; newValue: unknown }>;
    assert.ok(changes3.some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS"));
    assert.ok(changes3.some((c) => c.field === "targetWeight" && c.newValue === 74));
    assert.equal(calls.updateProfileFields.length, 0, "nothing is written before the user confirms");
    assert.equal(profile.goal, "MUSCLE_GAIN");
  } finally { await cleanup(userId, session.id); }
});

test("GOLDEN 4th turn (real DB, flag ON): '…1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp' → height 173, current 80, target 72 (never 73), conflict resolved as a PROPOSED goal change, HITL preserved end to end", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { profile, calls } = stubProfile();
  const userId = `ci-golden4-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "ci golden 4" } });
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, session.id);
    const r = await fitnessAgent.tryTurn("với chiều cao 1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp", identity, session.id);
    assert.equal(r!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    const changes = (r!.blocks[0] as any).changes as Array<{ field: string; newValue: unknown }>;
    assert.ok(changes.some((c) => c.field === "targetWeight" && c.newValue === 72), JSON.stringify(changes));
    assert.ok(changes.some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS"), JSON.stringify(changes));
    assert.ok(!changes.some((c) => c.newValue === 73), "1m73 must never leak into a weight");
    assert.doesNotMatch(r!.answer, /không cao hơn cân nặng hiện tại/, "the stale muscle-gain validator message must not come back");
    assert.doesNotMatch(r!.answer, /béo phì|thừa cân/, "no diagnosis from a casual remark");
    assert.equal(calls.updateProfileFields.length, 0);

    // explicit confirmation → single authoritative write → the original roadmap request RESUMES into its own confirmable preview
    const r2 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.equal(calls.updateProfileFields.length, 1);
    assert.equal(profile.goal, "WEIGHT_LOSS");
    assert.equal(profile.targetWeight, 72);
    assert.equal((r2!.blocks[0] as any).type, "ACTION_CONFIRMATION");
    assert.equal(calls.generateRoadmapDraft, 1);
  } finally { await cleanup(userId, session.id); }
});

test("mid-workflow goal change (real DB, flag ON): 'Thôi tôi thấy mình đang quá nặng, đổi sang giảm mỡ đi.' is NOT a cancel — it proposes the change; a bare 'thôi' still cancels", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { calls } = stubProfile();
  const userId = `ci-midgoal-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "ci mid goal" } });
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, session.id);
    const r = await fitnessAgent.tryTurn("Thôi tôi thấy mình đang quá nặng, đổi sang giảm mỡ đi.", identity, session.id);
    assert.doesNotMatch(r!.answer, /Đã hủy/);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(row!.status, "COLLECTING_SLOTS");
    assert.equal((row!.slotsJson as any).goal, "WEIGHT_LOSS");
    assert.equal(calls.updateProfileFields.length, 0);
    const bare = await fitnessAgent.tryTurn("thôi", identity, session.id);
    assert.match(bare!.answer, /Đã hủy/);
  } finally { await cleanup(userId, session.id); }
});

test("correction supersedes a stale candidate (real DB, flag ON): 'không phải 74, là 72'; 'why' is answered from the stored recommendation; loop-free", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubProfile({ goal: "WEIGHT_LOSS" });
  const userId = `ci-corr-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "ci corr" } });
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, session.id);
    const rec = await fitnessAgent.tryTurn("bạn tự đề xuất đi", identity, session.id);
    assert.match(rec!.answer, /72kg/);
    const why = await fitnessAgent.tryTurn("vì sao bạn đề xuất vậy?", identity, session.id);
    assert.match(why!.answer, /173cm/);
    assert.match(why!.answer, /không phải chẩn đoán/);
    const fix = await fitnessAgent.tryTurn("không phải 74, là 72", identity, session.id);
    assert.equal(fix!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    assert.ok(((fix!.blocks[0] as any).changes as any[]).some((c) => c.field === "targetWeight" && c.newValue === 72));
  } finally { await cleanup(userId, session.id); }
});

test("flag OFF keeps the legacy behaviour: 'mục tiêu 70kg' is answered by the old validator message, not the semantic layer", async () => {
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  stubProfile();
  const userId = `ci-off-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "ci off" } });
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, session.id);
    const r = await fitnessAgent.tryTurn("mục tiêu 70kg", identity, session.id);
    assert.match(r!.answer, /không cao hơn cân nặng hiện tại/);
  } finally { await cleanup(userId, session.id); }
});

import { semanticTurn } from "../conversational-intelligence";
test("explanation + action: 'tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi' explains from the user's own numbers (no diagnosis) AND only PROPOSES the change", async () => {
  const profile = { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE" };
  const r = await semanticTurn({ text: "tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi", userId: "t", profile, known: {}, expectedSlot: "targetWeight", slotKeys: new Set(["goal", "targetWeight", "heightCm", "currentWeightKg"]) });
  assert.equal(r.decision.action, "PROPOSE_PROFILE_CHANGE");
  assert.deepEqual(r.decision.patch, { goal: "WEIGHT_LOSS" });
  assert.match(r.decision.preface ?? "", /173cm/);
  assert.match(r.decision.preface ?? "", /không phải chẩn đoán/);
  assert.doesNotMatch(r.decision.preface ?? "", /béo phì/);
  assert.match(r.decision.preface ?? "", /chưa thay đổi gì cho tới khi bạn xác nhận/);
});
