/**
 * Phase 4.2 — CoachStateV0.training → user-facing training-progress answers.
 * docs/ai-product/phase4-2-training-coach-integration.md
 *
 * Evidence labels: pure sections = TEST FIXTURE; the `tryTurn` sections run the real orchestrator + real
 * workflow DB (isolated *_test Postgres only; skipped otherwise) with axios/profile stubs = BACKEND INTEGRATION.
 * No real model is ever called: llmService.callLLM is replaced by a counting stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { llmService } from "../services/llm.service";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import {
  classifyTrainingQuestion,
  renderTrainingAnswer,
  validateNarration,
  trainingCoachDeps,
  answerTrainingProgress,
} from "../conversational-intelligence/global/training-coach";
import type { TrainingCoachState as CoachStateV0 } from "../services/coach-state/coach-state";
import { profileExtractor } from "../llm/profile_extractor";

const dbUrl = process.env.DATABASE_URL || process.env.AI_DATABASE_URL || "";
const canUseDb = /(_test|postgres-test)/i.test(dbUrl) && process.env.NODE_ENV === "test";

// ── fixtures ────────────────────────────────────────────────────────────

type Training = CoachStateV0["training"];
function training(over: Partial<Training> = {}): Training {
  return {
    period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
    adherence: { state: "MEASURED", scheduledSessions: 9, completedSessions: 8, missedSessions: 1, completionRate: 0.89, dataQuality: "SUFFICIENT" },
    frequency: { completedPerWeek: 2.3, scheduledPerWeek: 2.3, trainingDaysLogged: 9, weeklyVolumeConsistency: 0.8, dataQuality: "SUFFICIENT" },
    volume: { totalVolumeLoadKg: 10440, byMuscleGroupKg: { quadriceps: 6000, glutes: 6000, chest: 4440 }, byWeek: [{ week: 0, totalVolumeKg: 2000, byMuscleGroup: {} }, { week: 3, totalVolumeKg: 2600, byMuscleGroup: {} }], volumeTrendPercent: 30, completedSetCount: 18, loadedSetCount: 18, dataQuality: "SUFFICIENT" },
    progression: {
      exercises: [{ exerciseId: "ex-bench", exerciseName: "Barbell Bench Press", baselineE1rmKg: 100, currentE1rmKg: 110, changePct: 10, weeksObserved: 4, dataQuality: "SUFFICIENT" }],
      dataQuality: "SUFFICIENT",
    },
    plateau: { status: "NOT_AVAILABLE", reason: "n/a" },
    effort: {
      rpe: { observedSets: 4, totalCompletedSets: 18, weeklyAvg: [8, 8, 8, 8], trend: "stable", dataQuality: "PARTIAL" },
      rir: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
      sessionFeedback: { feedbackCount: 0, averageSessionRpe: 8, sessionRpeSource: "set_rpe_fallback", averagePainScore: null, recoveryScore: null, dataQuality: "NO_DATA" },
    },
    signals: [{ code: "TRAINING_ADHERENCE_GOOD", basis: { completionPct: 89, thresholdPct: 80 } }],
    dataQuality: "SUFFICIENT",
    ...over,
  };
}
const state = (t: Training = training()): CoachStateV0 => ({ asOf: "2026-10-10T12:00:00.000Z", goal: { type: "MUSCLE_GAIN" }, training: t });

const NO_DATA = training({
  adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: "NO_DATA" },
  frequency: { completedPerWeek: null, scheduledPerWeek: null, trainingDaysLogged: 0, weeklyVolumeConsistency: null, dataQuality: "NO_DATA" },
  volume: { totalVolumeLoadKg: 0, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 0, loadedSetCount: 0, dataQuality: "NO_DATA" },
  progression: { exercises: [], dataQuality: "NO_DATA" },
  signals: [], dataQuality: "NO_DATA",
});

// ── A. recognition & routing (pure) ─────────────────────────────────────

test("classification: supported training-progress questions are recognised; knowledge/recommendation/edit/other domains are not", () => {
  const yes: Array<[string, string]> = [
    ["28 ngày qua tôi tập đều không?", "ADHERENCE"],
    ["Tôi tập có đều không?", "ADHERENCE"],
    ["Tôi bỏ bao nhiêu buổi?", "ADHERENCE"],
    ["28 ngày qua tôi hoàn thành bao nhiêu buổi?", "ADHERENCE"],
    ["Tháng này tôi tập được bao nhiêu buổi?", "FREQUENCY"],
    ["Bench của tôi dạo này có tiến bộ không?", "PROGRESSION"],
    ["Volume chân của tôi tháng này thế nào?", "VOLUME"],
    ["Dạo này cường độ tập của tôi ra sao?", "EFFORT"],
    ["Tôi đang plateau không?", "PLATEAU"],
    ["Tôi tập gần đây ổn không?", "SUMMARY"],
  ];
  for (const [q, cls] of yes) assert.equal(classifyTrainingQuestion(q), cls, q);
  const no = [
    "Training volume là gì?",                       // C: general knowledge
    "RIR là gì?",
    "Tôi nên tập bao nhiêu buổi một tuần?",         // recommendation
    "Tôi tập không đều, chỉnh lịch giúp tôi",       // analytics + mutation → never claimed here
    "Macro hiện tại của tôi bao nhiêu?",            // nutrition
    "Tôi đang có PT chưa?",
    "Lịch hiện tại của tôi là gì?",                 // A: business state, existing reader
  ];
  for (const q of no) assert.equal(classifyTrainingQuestion(q), null, q);
});

test("routing: flag ON → READ_STATE/TRAINING_PROGRESS; flag OFF → byte-identical legacy route (never TRAINING_PROGRESS)", () => {
  for (const q of ["28 ngày qua tôi tập đều không?", "Bench của tôi dạo này có tiến bộ không?", "Tôi tập gần đây ổn không?"]) {
    const on = classifyGlobal(q, { trainingCoach: true });
    const off = classifyGlobal(q, {});
    assert.equal(on.route, "READ_STATE", q);
    assert.equal(on.topic, "TRAINING_PROGRESS", q);
    assert.notEqual(off.topic, "TRAINING_PROGRESS", q);
    assert.deepEqual(classifyGlobal(q, { trainingCoach: false }), off, q);
  }
  // other domains unaffected by the flag
  for (const q of ["Macro hiện tại của tôi bao nhiêu?", "Tôi đang có PT chưa?", "RIR là gì?", "Tìm PT cho tôi."]) {
    assert.deepEqual(classifyGlobal(q, { trainingCoach: true }), classifyGlobal(q, {}), q);
  }
});

test("routing: a question while a workflow waits is an interrupting READ; the value reply is still the slot answer", () => {
  const ctx = { active: { wf: "CREATE_WORKOUT_PLAN", slot: "sessionMinutes" }, trainingCoach: true };
  const q = classifyGlobal("28 ngày qua tôi tập đều không?", ctx);
  assert.equal(q.route, "READ_STATE");
  assert.equal(q.topic, "TRAINING_PROGRESS");
  assert.equal(q.interrupts, true);
  assert.equal(classifyGlobal("60 phút.", ctx).route, "SLOT_ANSWER");
});

// ── B. deterministic rendering (pure, 0 LLM) ────────────────────────────

test("adherence 9/8/1: facts rendered from state, signal threshold from fitness-service", () => {
  const a = renderTrainingAnswer(state(), "ADHERENCE", "28 ngày qua tôi tập đều không?");
  assert.match(a, /9 buổi theo lịch/);
  assert.match(a, /hoàn thành 8/);
  assert.match(a, /chưa hoàn thành 1/);
  assert.match(a, /89%/);
  assert.match(a, /từ 80% trở lên/);
});

test("NO_SCHEDULE + logs: reports logged days, never fabricates adherence", () => {
  const t = training({
    adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: "NO_DATA" },
    frequency: { completedPerWeek: 1.5, scheduledPerWeek: null, trainingDaysLogged: 6, weeklyVolumeConsistency: null, dataQuality: "PARTIAL" },
    signals: [], dataQuality: "PARTIAL",
  });
  const a = renderTrainingAnswer(state(t), "ADHERENCE", "Tôi tập có đều không?");
  assert.match(a, /6 ngày tập được ghi nhận/);
  assert.match(a, /không có lịch tập nào/);
  assert.doesNotMatch(a, /%/);
});

test("NO_DATA: truthful no-data answer — not poor adherence, not plateau", () => {
  for (const cls of ["ADHERENCE", "VOLUME", "PROGRESSION", "SUMMARY", "EFFORT"] as const) {
    const a = renderTrainingAnswer(state(NO_DATA), cls, "x");
    assert.match(a, /Chưa có dữ liệu tập/);
    assert.doesNotMatch(a, /plateau đang|chưa đều|thấp/);
  }
});

test("STALE: says nothing new in the window, not 'never trained'", () => {
  const a = renderTrainingAnswer(state({ ...NO_DATA, dataQuality: "STALE" }), "ADHERENCE", "x");
  assert.match(a, /Không có buổi tập hay lịch tập nào trong 28 ngày gần đây/);
  assert.match(a, /trước đó bạn đã có dữ liệu/);
  assert.doesNotMatch(a, /chưa từng/);
});

test("progression: sufficient observation uses baseline/current/changePct/weeks from state", () => {
  const a = renderTrainingAnswer(state(), "PROGRESSION", "Bench của tôi dạo này có tiến bộ không?");
  assert.match(a, /Barbell Bench Press/);
  assert.match(a, /100 kg lên 110 kg/);
  assert.match(a, /\+10%/);
  assert.match(a, /4 tuần/);
});

test("progression: insufficient weeks → no trend claim", () => {
  const t = training({
    progression: { exercises: [{ exerciseId: "ex-bench", exerciseName: "Barbell Bench Press", baselineE1rmKg: 100, currentE1rmKg: 100, changePct: null, weeksObserved: 1, dataQuality: "INSUFFICIENT_HISTORY" }], dataQuality: "INSUFFICIENT_HISTORY" },
    dataQuality: "INSUFFICIENT_HISTORY",
  });
  const a = renderTrainingAnswer(state(t), "PROGRESSION", "Bench của tôi có tiến bộ không?");
  assert.match(a, /chưa đủ lịch sử/);
  assert.doesNotMatch(a, /tăng|giảm|%/);
});

test("progression: exercise not in analytics, and ambiguous exercise → says so / asks", () => {
  const none = renderTrainingAnswer(state(), "PROGRESSION", "Squat của tôi có tiến bộ không?");
  assert.match(none, /chưa thấy bài đó/);
  const two = training({
    progression: {
      exercises: [
        { exerciseId: "a", exerciseName: "Barbell Bench Press", baselineE1rmKg: 1, currentE1rmKg: 2, changePct: 1, weeksObserved: 3, dataQuality: "SUFFICIENT" },
        { exerciseId: "b", exerciseName: "Dumbbell Bench Press", baselineE1rmKg: 1, currentE1rmKg: 2, changePct: 1, weeksObserved: 3, dataQuality: "SUFFICIENT" },
      ],
      dataQuality: "SUFFICIENT",
    },
  });
  assert.match(renderTrainingAnswer(state(two), "PROGRESSION", "Bench của tôi có tiến bộ không?"), /Bạn muốn xem bài nào\?/);
});

test("plateau NOT_AVAILABLE: no positive or negative plateau classification; may show factual progression", () => {
  const a = renderTrainingAnswer(state(), "PLATEAU", "Tôi đang plateau không?");
  assert.match(a, /chưa có phân loại plateau đủ tin cậy/);
  assert.match(a, /không kết luận/);
  assert.doesNotMatch(a, /bạn đang plateau\b|bạn không plateau/i);
  assert.match(a, /Barbell Bench Press/);
});

test("volume: matches the metric's own terminology (no 'effective sets'), muscle readback, no value judgement", () => {
  const all = renderTrainingAnswer(state(), "VOLUME", "Volume hiện tại của tôi có ổn không?");
  assert.match(all, /Σ tạ × số lần/);
  assert.match(all, /chưa đánh giá mức này cao hay thấp/);
  assert.doesNotMatch(all, /effective|hiệu quả|set hiệu dụng/i);
  const legs = renderTrainingAnswer(state(), "VOLUME", "Volume chân của tôi tháng này thế nào?");
  assert.match(legs, /quadriceps 6\.000 kg/);
  assert.doesNotMatch(legs, /chest/);
});

test("RPE/RIR partial: coverage stated, missing is not zero", () => {
  const a = renderTrainingAnswer(state(), "EFFORT", "Dạo này cường độ tập của tôi ra sao?");
  assert.match(a, /RPE được nhập ở 4\/18 set/);
  assert.match(a, /RIR: bạn chưa nhập ở set nào/);
  assert.match(a, /chỉ được nhập ở một phần số set/);
});

// ── C. narration validation & budget ─────────────────────────────────────

test("narration validator rejects unsupported claims (sleep, plateau, invented numbers)", () => {
  const s = state();
  assert.equal(validateNarration("Bạn ngủ không đủ nên tập chưa đều.", s).ok, false);
  assert.equal(validateNarration("Bạn đang plateau ở bench.", s).ok, false);
  assert.equal(validateNarration("Bạn hoàn thành 15 buổi trong 28 ngày.", s).ok, false);
  assert.equal(validateNarration("Bạn hoàn thành 8 trên 9 buổi theo lịch trong 28 ngày gần đây, rất ổn định.", s).ok, true);
});

test("answerTrainingProgress: direct readback = 0 model calls; read never uses a model for the counts", async () => {
  const origGet = axios.get; const origCall = llmService.callLLM; const origFlag = process.env.GYMINI_UNIFIED_AI_COACH;
  let llm = 0; let narr = 0;
  const origNarrate = trainingCoachDeps.narrate;
  (llmService as any).callLLM = async () => { llm++; return { answer: "{}" }; };
  trainingCoachDeps.narrate = async () => { narr++; return null; };
  (axios as any).get = async () => ({ data: JSON.parse(JSON.stringify(window9_8_1())) });
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  try {
    const r = await answerTrainingProgress({ userId: "u1", authorizationHeader: "Bearer a" } as any, "28 ngày qua tôi hoàn thành bao nhiêu buổi?");
    assert.match(r.text, /hoàn thành 8/);
    assert.equal(llm, 0);
    assert.equal(narr, 0);
    assert.equal(r.facts.llmCalls, 0);
  } finally {
    axios.get = origGet; llmService.callLLM = origCall; trainingCoachDeps.narrate = origNarrate;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
});

function window9_8_1() {
  const t = training();
  return { period: t.period, adherence: t.adherence, frequency: t.frequency, volume: t.volume, progression: t.progression, plateau: t.plateau, effort: t.effort, signals: t.signals, dataQuality: t.dataQuality };
}

async function withHolistic(narrate: (s: CoachStateV0, u: string) => Promise<string | null>, fn: (counters: { narr: number }) => Promise<void>) {
  const origGet = axios.get; const origFlag = process.env.GYMINI_UNIFIED_AI_COACH; const origNarrate = trainingCoachDeps.narrate;
  const c = { narr: 0 };
  trainingCoachDeps.narrate = async (s, u) => { c.narr++; return narrate(s, u); };
  (axios as any).get = async () => ({ data: JSON.parse(JSON.stringify(window9_8_1())) });
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const origExtract = profileExtractor.extract;
  profileExtractor.extract = (async () => ({ profile: { goal: "MUSCLE_GAIN" }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
  try { await fn(c); } finally {
    axios.get = origGet; trainingCoachDeps.narrate = origNarrate; profileExtractor.extract = origExtract;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
}
const ident = { userId: "u1", authorizationHeader: "Bearer a" } as any;

test("holistic summary: exactly one narration call; valid wording is used", async () => {
  await withHolistic(async () => "Bạn hoàn thành 8 trên 9 buổi theo lịch trong 28 ngày gần đây, khá đều đặn.", async (c) => {
    const r = await answerTrainingProgress(ident, "Tôi tập gần đây ổn không?");
    assert.equal(c.narr, 1);
    assert.equal(r.facts.usedNarration, true);
    assert.match(r.text, /8 trên 9 buổi/);
  });
});

test("holistic summary: narration timeout/failure → deterministic CoachState summary with the facts", async () => {
  await withHolistic(async () => { throw new Error("timeout"); }, async (c) => {
    const r = await answerTrainingProgress(ident, "Tôi tập gần đây ổn không?");
    assert.equal(c.narr, 1);
    assert.equal(r.facts.usedNarration, false);
    assert.match(r.text, /9 buổi theo lịch, hoàn thành 8/);
  });
});

test("holistic summary: hallucinated narration ('ngủ không đủ' / 'plateau') is discarded for the deterministic summary", async () => {
  for (const bad of ["Bạn ngủ không đủ nên tập chưa tốt.", "Bạn đang plateau, hãy giảm tải."]) {
    await withHolistic(async () => bad, async (c) => {
      const r = await answerTrainingProgress(ident, "Tôi tập gần đây ổn không?");
      assert.equal(c.narr, 1);
      assert.equal(r.facts.usedNarration, false);
      assert.doesNotMatch(r.text, /ngủ|plateau/i);
      assert.match(r.text, /hoàn thành 8/);
    });
  }
});

test("holistic summary: NO_DATA state never calls the model", async () => {
  const origGet = axios.get; const origFlag = process.env.GYMINI_UNIFIED_AI_COACH; const origNarrate = trainingCoachDeps.narrate;
  let narr = 0; trainingCoachDeps.narrate = async () => { narr++; return "x"; };
  (axios as any).get = async () => ({ data: { period: NO_DATA.period, adherence: NO_DATA.adherence, frequency: NO_DATA.frequency, volume: NO_DATA.volume, progression: NO_DATA.progression, plateau: NO_DATA.plateau, effort: NO_DATA.effort, signals: [], dataQuality: "NO_DATA" } });
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const origExtract = profileExtractor.extract;
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
  try {
    const r = await answerTrainingProgress(ident, "Tôi tập gần đây ổn không?");
    assert.equal(narr, 0);
    assert.match(r.text, /Chưa có dữ liệu tập/);
  } finally {
    axios.get = origGet; trainingCoachDeps.narrate = origNarrate; profileExtractor.extract = origExtract;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
});

test("upstream failure: reported as unavailable — never 'no data', never 0%", async () => {
  const origGet = axios.get; const origFlag = process.env.GYMINI_UNIFIED_AI_COACH;
  (axios as any).get = async () => { throw Object.assign(new Error("boom"), { response: { status: 500 } }); };
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  try {
    const r = await answerTrainingProgress(ident, "28 ngày qua tôi tập đều không?");
    assert.match(r.text, /chưa đọc được dữ liệu tập luyện/);
    assert.doesNotMatch(r.text, /Chưa có dữ liệu tập|0%/);
    assert.equal(r.facts.analyticsReadOutcome, "error");
  } finally {
    axios.get = origGet;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
});

// ── D. end-to-end through the real orchestrator (isolated test DB) ───────

const skipDb = { skip: !canUseDb ? "needs isolated *_test Postgres + NODE_ENV=test" : false } as const;

async function world() {
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const { readerDeps } = await import("../conversational-intelligence/global/readers");
  const { prisma } = await import("../repositories/conversation.repository");
  return { fitnessAgent, fitnessAgentDeps, readerDeps, prisma };
}

test("tryTurn: B asks → only B's metrics (A's never reach B); training endpoint fetched once with B's credential", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.GYMINI_UNIFIED_AI_COACH = "on";
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN" }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "MUSCLE_GAIN" } })) as any;
  readerDeps.get = async () => ({ status: 404, data: {} });
  const urls: string[] = [];
  (axios as any).get = async (url: string, cfg: any) => {
    urls.push(`${url}|${cfg?.headers?.Authorization}`);
    if (cfg?.headers?.Authorization === "Bearer token-a") return { data: window9_8_1() };
    return { data: { ...window9_8_1(), adherence: NO_DATA.adherence, frequency: NO_DATA.frequency, volume: NO_DATA.volume, progression: NO_DATA.progression, signals: [], dataQuality: "NO_DATA" } };
  };
  const userB = `t42-b-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId: userB, title: "t42" } });
  try {
    const r = await fitnessAgent.tryTurn("28 ngày qua tôi tập đều không?", { userId: userB, authorizationHeader: "Bearer token-b" } as any, s.id);
    assert.ok(r);
    assert.match(r!.answer, /Chưa có dữ liệu tập/);
    assert.doesNotMatch(r!.answer, /89%|Barbell Bench/);
    const training = urls.filter((u) => u.includes("/stats/training-window"));
    assert.equal(training.length, 1, "fetched once");
    assert.ok(training[0].endsWith("Bearer token-b"));
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId: userB } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId: userB } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax;
    if (saved.ci === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = saved.ci;
    if (saved.uc === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = saved.uc;
  }
});

test("tryTurn: pending workflow survives a training question and resumes on the value reply; no business write", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, upd: fitnessAgentDeps.tools.updateProfileFields, pt: fitnessAgentDeps.tools.findPTCandidates, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const writes: unknown[] = []; const searches: unknown[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN", age: 22, gender: "MALE", heightCm: 173, currentWeight: 80, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, injuries: [], equipment: [], experience: "BEGINNER" }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, f: any) => { writes.push(f); return {}; };
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, p: any) => { searches.push(p); return { candidates: [], truncated: false, historyAuditId: "h", preferences: p } as any; };
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "MUSCLE_GAIN" } })) as any;
  readerDeps.get = async () => ({ status: 404, data: {} });
  (axios as any).get = async () => ({ data: window9_8_1() });
  const userId = `t42-p-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId, title: "t42" } });
  const id = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", id, s.id);
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(before?.expectedSlot, "budgetVnd");
    const r = await fitnessAgent.tryTurn("28 ngày qua tôi tập đều không?", id, s.id);
    assert.match(r!.answer, /hoàn thành 8/);
    assert.match(r!.answer, /Bạn vẫn đang tìm PT dở/);
    const after = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(after?.id, before?.id);
    assert.equal(after?.status, "COLLECTING_SLOTS");
    assert.equal(after?.expectedSlot, "budgetVnd");
    assert.equal(writes.length, 0, "read-only: no profile write");
    assert.equal(searches.length, 0);
    await fitnessAgent.tryTurn("2 triệu.", id, s.id);
    assert.equal(searches.length, 1, "workflow resumed exactly once");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx, updateProfileFields: saved.upd, findPTCandidates: saved.pt });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax;
    if (saved.ci === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = saved.ci;
    if (saved.uc === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = saved.uc;
  }
});

test("tryTurn context demand + OFF parity: nutrition/knowledge never fetch training analytics; flag off never fetches", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "MUSCLE_GAIN" }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "MUSCLE_GAIN", nutritionGoal: { calories: 2187, protein: 193, carbs: 201, fat: 68 } } })) as any;
  readerDeps.get = async (url: string) => (url.endsWith("/nutrition/goals") ? { status: 200, data: { id: "g1", calories: 2187, protein: 193, carbs: 201, fat: 68, status: "ACTIVE" } } : { status: 404, data: {} });
  let trainingFetches = 0;
  (axios as any).get = async (url: string) => { if (url.includes("/stats/training-window")) trainingFetches++; return { data: window9_8_1() }; };
  const userId = `t42-d-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId, title: "t42" } });
  const id = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    process.env.GYMINI_UNIFIED_AI_COACH = "on";
    await fitnessAgent.tryTurn("Macro hiện tại của tôi bao nhiêu?", id, s.id);
    await fitnessAgent.tryTurn("Tôi đang có PT chưa?", id, s.id);
    assert.equal(trainingFetches, 0, "unrelated domains never fetch training analytics");
    // flag OFF: same training question → legacy path, no fetch, no CoachState answer
    delete process.env.GYMINI_UNIFIED_AI_COACH;
    const off = await fitnessAgent.tryTurn("28 ngày qua tôi tập đều không?", id, s.id);
    assert.equal(trainingFetches, 0);
    assert.ok(off === null || !/hoàn thành 8/.test(off.answer));
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax;
    if (saved.ci === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = saved.ci;
    if (saved.uc === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = saved.uc;
  }
});

test.after(async () => {
  if (canUseDb) { const { prisma } = await import("../repositories/conversation.repository"); await prisma.$disconnect(); }
});
