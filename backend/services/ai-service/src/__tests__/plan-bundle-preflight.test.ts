/**
 * 2026-11-09 (user test on AWS): a CREATE_PLAN_BUNDLE was confirmed and then failed on all three parts — the roadmap because another
 * one was already ACTIVE (shown as "lỗi tạm thời, thử lại sau"), nutrition because the profile had no activityLevel (shown as the raw
 * key). proposePlanBundle now checks both BEFORE any card; the card no longer promises to "replace" an active roadmap; the leftover
 * activation errors read in Vietnamese. Real DB (ai test DB) for sessions/actions; profile, generator and roadmap lookup are stubbed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { friendlyStepDetail } from "../services/friendly-step-detail";

const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(process.env.DATABASE_URL ?? "");
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

const saved = { extract: fitnessAgentDeps.profileExtractor.extract, gen: fitnessAgentDeps.tools.generateRoadmapDraft, progs: fitnessAgentDeps.tools.findTrainingPrograms, current: fitnessAgentDeps.tools.getCurrentRoadmap };
test.afterEach(() => Object.assign(fitnessAgentDeps.tools, { generateRoadmapDraft: saved.gen, findTrainingPrograms: saved.progs, getCurrentRoadmap: saved.current }) && (fitnessAgentDeps.profileExtractor.extract = saved.extract));
test.after(async () => { if (canUseDb) { await prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "bundle-pre-" } } }); await prisma.chatSession.deleteMany({ where: { userId: { startsWith: "bundle-pre-" } } }); await prisma.$disconnect(); } });

const fullProfile = { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeightKg: 80, gender: "MALE", activityLevel: "MODERATELY_ACTIVE", training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3 } };
const draft = () => {
  const s = new Date("2026-11-09T00:00:00Z"), e = new Date(s.getTime() + 12 * 7 * 86_400_000);
  return { goalType: "WEIGHT_LOSS", summary: "Giảm mỡ 12 tuần", reasoningSummary: "r", confidence: 0.8, warnings: [], assumptions: [], plannedStartAt: s.toISOString(),
    phases: [{ phaseType: "FAT_LOSS", name: "Giảm mỡ", plannedStartAt: s.toISOString(), plannedEndAt: e.toISOString() }] };
};

async function rig(profile: Record<string, unknown>, current: unknown) {
  const userId = `bundle-pre-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "preflight" } });
  let generated = 0;
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile })) as any;
  fitnessAgentDeps.tools.generateRoadmapDraft = (async () => { generated++; return draft(); }) as any;
  fitnessAgentDeps.tools.findTrainingPrograms = (async () => ({ programs: [], warnings: [] })) as any;
  fitnessAgentDeps.tools.getCurrentRoadmap = (async () => { if (current instanceof Error) throw current; return current; }) as any;
  const result = await fitnessAgent.proposePlanBundle({ userId } as any, session.id, "tạo lộ trình giảm mỡ 12 tuần");
  const actions = await prisma.fitnessAgentAction.count({ where: { userId } });
  return { result, actions, generated: () => generated };
}

test("missing activityLevel: asks for it in plain Vietnamese before any card — nothing generated or stored", dbOpts, async () => {
  const { activityLevel: _omit, ...noActivity } = fullProfile;
  const r = await rig(noActivity, new Error("No active fitness roadmap"));
  assert.equal(r.result.blocks.length, 0);
  assert.match(r.result.answer, /mức độ vận động/);
  assert.doesNotMatch(r.result.answer, /activityLevel/);
  assert.equal(r.actions, 0);
  assert.equal(r.generated(), 0);
});

test("an ACTIVE roadmap exists: explains one-at-a-time and the way out, shows no card, writes nothing", dbOpts, async () => {
  const r = await rig(fullProfile, { roadmap: { id: "rm-1", name: "Giảm mỡ mùa thu", status: "ACTIVE" }, phases: [] });
  assert.equal(r.result.blocks.length, 0);
  assert.match(r.result.answer, /Giảm mỡ mùa thu/);
  assert.match(r.result.answer, /chỉ chạy một lộ trình/);
  assert.equal(r.actions, 0);
  assert.equal(r.generated(), 0);
});

test("no active roadmap + complete profile: the card is shown and no longer promises to replace an active roadmap", dbOpts, async () => {
  const r = await rig(fullProfile, new Error("No active fitness roadmap"));
  const card: any = r.result.blocks.find((b: any) => b.type === "ACTION_CONFIRMATION");
  assert.ok(card, "card shown");
  assert.doesNotMatch(card.note, /thay thế lộ trình đang hoạt động/);
  assert.match(card.note, /Tạo lịch tập cho tôi/); // no program template matched -> said up front, not only after confirming
  assert.equal(card.summary.phases.length, 1);
  assert.equal(r.actions, 1);
});

test("leftover activation 409s read in Vietnamese with a next step, never 'lỗi tạm thời'", () => {
  for (const [msg, re] of [
    ["Another roadmap is already ACTIVE", /lộ trình khác đang hoạt động/],
    ["Another phase is already ACTIVE", /chu kỳ tập khác/],
    ["Active cycle already belongs to another roadmap phase", /chu kỳ tập khác/],
    ["Roadmap has no phase to activate", /không có giai đoạn/],
  ] as const) {
    const out = friendlyStepDetail("roadmap", msg)!;
    assert.match(out, re, msg);
    assert.doesNotMatch(out, /lỗi tạm thời/, msg);
  }
});

test("an ACTIVE cycle outside any roadmap is named on the card and in the numbered note; nutrition numbers are shown", dbOpts, async () => {
  const savedCycle = fitnessAgentDeps.tools.getActiveCycle, savedPreview = fitnessAgentDeps.tools.getNutritionTargetPreview;
  fitnessAgentDeps.tools.getActiveCycle = (async () => ({ cycle: { id: "8b0f3c4e-1111-4222-8333-444455556666", name: "Chu kỳ cũ", startDate: "2026-11-01T00:00:00.000Z", roadmapPhaseId: null }, summary: {} })) as any;
  fitnessAgentDeps.tools.getNutritionTargetPreview = (async () => ({ status: "COMPUTED", calories: 2370.4, protein: 145, carbs: 299, fat: 66 })) as any;
  try {
    const r = await rig(fullProfile, new Error("No active fitness roadmap"));
    const card: any = r.result.blocks.find((b: any) => b.type === "ACTION_CONFIRMATION");
    assert.equal(card.summary.legacyCycle.name, "Chu kỳ cũ");
    assert.match(card.note, /\(0\) kết thúc chu kỳ tập đang chạy/);
    assert.deepEqual(card.summary.nutritionPreview, { kept: false, calories: 2370, protein: 145, carbs: 299, fat: 66 });
    const stored = await prisma.fitnessAgentAction.findFirstOrThrow({ where: { id: card.actionId } });
    assert.equal((stored.payload as any).legacyCycle.id, "8b0f3c4e-1111-4222-8333-444455556666"); // only this cycle may be closed on confirm
  } finally {
    fitnessAgentDeps.tools.getActiveCycle = savedCycle; fitnessAgentDeps.tools.getNutritionTargetPreview = savedPreview;
  }
});
