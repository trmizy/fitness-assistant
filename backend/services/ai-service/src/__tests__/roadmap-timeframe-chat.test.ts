/**
 * Phase 3 (AI plan) / audit BDG-18 — the chat path no longer hard-codes a 16-week roadmap. Real DB (ai test DB) for sessions, actions and
 * conversation history; real proposePlanBundle / tryReviseRoadmapDraft; only the roadmap generator, profile and program lookup are stubbed
 * (the generator records exactly what it was asked and returns a draft of a controllable real length).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

const saved = {
  extract: fitnessAgentDeps.profileExtractor.extract,
  gen: fitnessAgentDeps.tools.generateRoadmapDraft,
  progs: fitnessAgentDeps.tools.findTrainingPrograms,
};
test.afterEach(() => {
  fitnessAgentDeps.profileExtractor.extract = saved.extract;
  fitnessAgentDeps.tools.generateRoadmapDraft = saved.gen;
  fitnessAgentDeps.tools.findTrainingPrograms = saved.progs;
});
test.after(async () => { if (canUseDb) { await prisma.conversation.deleteMany({ where: { userId: { startsWith: "tf-chat-" } } }); await prisma.fitnessAgentAction.deleteMany({ where: { userId: { startsWith: "tf-chat-" } } }); await prisma.chatSession.deleteMany({ where: { userId: { startsWith: "tf-chat-" } } }); await prisma.$disconnect(); } });

const draftOf = (weeks: number, goalType = "WEIGHT_LOSS", constraints: string[] = []) => {
  const start = new Date("2026-11-02T00:00:00Z");
  const mid = new Date(start.getTime() + Math.floor(weeks / 2) * 7 * 86_400_000);
  const end = new Date(start.getTime() + weeks * 7 * 86_400_000);
  return {
    goalType, summary: `Draft ${weeks} tuần (constraints: ${constraints.join(" | ") || "none"})`, reasoningSummary: "fixture", confidence: 0.8, warnings: [], assumptions: [],
    plannedStartAt: start.toISOString(),
    phases: [
      { phaseType: "FAT_LOSS", name: "P1", plannedStartAt: start.toISOString(), plannedEndAt: mid.toISOString() },
      { phaseType: "FAT_LOSS", name: "P2", plannedStartAt: mid.toISOString(), plannedEndAt: end.toISOString() },
    ],
  };
};

async function rig(opts: { weeksFor?: (call: any, n: number) => number } = {}) {
  const userId = `tf-chat-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "roadmap timeframe" } });
  const calls: any[] = [];
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeightKg: 80, gender: "MALE", training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3 } } })) as any;
  fitnessAgentDeps.tools.generateRoadmapDraft = (async (_i: any, input: any) => {
    calls.push(input);
    const weeks = opts.weeksFor ? opts.weeksFor(input, calls.length) : (input.timeframeWeeks ?? 20);
    return draftOf(weeks, input.goalType, input.constraints ?? []);
  }) as any;
  fitnessAgentDeps.tools.findTrainingPrograms = (async () => ({ programs: [], warnings: [] })) as any;
  const identity = { userId } as any;
  const say = async (question: string) => prisma.conversation.create({ data: { userId, sessionId: session.id, question, answer: "ok", modelUsed: "t", responseTime: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  const payload = async () => (await prisma.fitnessAgentAction.findFirstOrThrow({ where: { userId, sessionId: session.id, kind: "CREATE_PLAN_BUNDLE" }, orderBy: { createdAt: "desc" } })).payload as any;
  return { userId, sessionId: session.id, identity, calls, say, payload };
}

test("a stated deadline is used: 'tạo lộ trình 12 tuần' -> generator asked for 12, the reply says so, the draft stores the contract", dbOpts, async () => {
  const r = await rig();
  const out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "Tạo lộ trình 12 tuần cho tôi");
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].timeframeWeeks, 12);
  assert.match(out.answer, /Lộ trình dài 12 tuần theo yêu cầu của bạn/);
  assert.deepEqual((await r.payload()).timeframe, { source: "USER", weeks: 12, capped: false });
});

test("'không giới hạn thời gian' -> NO timeframeWeeks is sent (no hidden number) and the reply says no deadline was imposed", dbOpts, async () => {
  const r = await rig({ weeksFor: () => 20 });
  const out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "Tạo lộ trình không giới hạn thời gian");
  assert.equal(r.calls.length, 1);
  assert.equal("timeframeWeeks" in r.calls[0], false);
  assert.match(out.answer, /không ép khung thời gian; lộ trình AI đề xuất dài 20 tuần/);
  assert.deepEqual((await r.payload()).timeframe, { source: "UNLIMITED", weeks: null });
});

test("nothing said about time -> the NAMED default (16) is used AND disclosed; it is never presented as the user's choice", dbOpts, async () => {
  const r = await rig();
  const out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "Tạo lộ trình cho tôi");
  assert.equal(r.calls[0].timeframeWeeks, 16);
  assert.match(out.answer, /chưa nêu thời hạn nên mình dùng mặc định 16 tuần/);
  assert.deepEqual((await r.payload()).timeframe, { source: "DEFAULT", weeks: 16 });
});

test("the deadline stated in an EARLIER turn of the conversation counts (the confirming turn 'ok tạo đi' has no time of its own)", dbOpts, async () => {
  const r = await rig();
  await r.say("Tôi muốn giảm cân trong 10 tuần");
  await r.say("tôi nặng 80kg");
  await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "ok tạo đi");
  assert.equal(r.calls[0].timeframeWeeks, 10);
});

test("conflicting statements -> the agent asks; the generator is not called and nothing is stored", dbOpts, async () => {
  const r = await rig();
  const out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "Không giới hạn thời gian nhưng muốn xong trong 12 tuần");
  assert.equal(r.calls.length, 0);
  assert.equal(out.blocks.length, 0);
  assert.match(out.answer, /chưa chắc bạn muốn lộ trình dài bao lâu/);
  assert.equal(await prisma.fitnessAgentAction.count({ where: { userId: r.userId } }), 0);
});

test("the generator misses the requested length -> ONE corrective retry; the closer draft wins; a remaining gap is disclosed, never hidden", dbOpts, async () => {
  // 1st call returns 24 weeks, the corrective retry returns 12
  let r = await rig({ weeksFor: (_c, n) => (n === 1 ? 24 : 12) });
  let out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "lộ trình 12 tuần");
  assert.equal(r.calls.length, 2, "exactly one corrective retry");
  assert.match(r.calls[1].constraints.at(-1), /PHẢI đúng 12 tuần/);
  assert.match(out.answer, /Lộ trình dài 12 tuần theo yêu cầu/);
  // both calls miss -> keep the closer one and say so
  r = await rig({ weeksFor: (_c, n) => (n === 1 ? 30 : 24) });
  out = await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "lộ trình 12 tuần");
  assert.equal(r.calls.length, 2);
  assert.match(out.answer, /yêu cầu 12 tuần nhưng AI chỉ xếp được 24 tuần/);
  assert.equal(draftSummaryWeeks(await r.payload()), 24, "the stored draft is the one actually shown");
});
const draftSummaryWeeks = (p: any) => Math.round((new Date(p.roadmapDraft.phases.at(-1).plannedEndAt).getTime() - new Date(p.roadmapDraft.phases[0].plannedStartAt).getTime()) / (7 * 86_400_000));

test("revision keeps the stored contract (no re-hard-coding to 16) and 'đổi sang 8 tuần' / 'không giới hạn' change it", dbOpts, async () => {
  const r = await rig();
  await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "lộ trình 12 tuần");
  r.calls.length = 0;
  const a = await fitnessAgent.tryReviseRoadmapDraft("Tập nhẹ nhàng hơn giúp tôi", r.identity, r.sessionId);
  assert.ok(a);
  assert.equal(r.calls[0].timeframeWeeks, 12, "a non-time revision keeps 12, not 16");
  assert.deepEqual((await r.payload()).timeframe, { source: "USER", weeks: 12, capped: false });
  r.calls.length = 0;
  const b = await fitnessAgent.tryReviseRoadmapDraft("đổi sang 8 tuần", r.identity, r.sessionId);
  assert.equal(r.calls[0].timeframeWeeks, 8);
  assert.match(b!.answer, /Lộ trình dài 8 tuần theo yêu cầu/);
  r.calls.length = 0;
  const c = await fitnessAgent.tryReviseRoadmapDraft("thôi không giới hạn thời gian", r.identity, r.sessionId);
  assert.equal("timeframeWeeks" in r.calls[0], false);
  assert.match(c!.answer, /không ép khung thời gian/);
  assert.deepEqual((await r.payload()).timeframe, { source: "UNLIMITED", weeks: null });
});

test("a legacy pending draft without a stored contract is revised under the NAMED default, and says so", dbOpts, async () => {
  const r = await rig();
  await fitnessAgent.proposePlanBundle(r.identity, r.sessionId, "tạo lộ trình");
  const row = await prisma.fitnessAgentAction.findFirstOrThrow({ where: { userId: r.userId, kind: "CREATE_PLAN_BUNDLE" } });
  const { timeframe: _drop, ...legacy } = row.payload as any;
  await prisma.fitnessAgentAction.update({ where: { id: row.id }, data: { payload: legacy } });
  r.calls.length = 0;
  const out = await fitnessAgent.tryReviseRoadmapDraft("ăn chay giúp tôi", r.identity, r.sessionId);
  assert.equal(r.calls[0].timeframeWeeks, 16);
  assert.match(out!.answer, /mặc định 16 tuần/);
});
