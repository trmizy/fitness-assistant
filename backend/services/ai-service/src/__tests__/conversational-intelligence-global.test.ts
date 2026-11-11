/**
 * CI-V2 GLOBAL coverage — BACKEND INTEGRATION (real DB, real orchestrator, stubbed business services):
 *  READ ≠ FIND ≠ WRITE, standalone recommendations, interruptions that preserve a waiting workflow, goal changes that stay
 *  behind the confirmation card, fresh state after a write, no writes from pure Q&A.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { readerDeps } from "../conversational-intelligence/global/readers";
import { llmRouteDeps } from "../conversational-intelligence/global/llm-route";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import { evaluateGlobal, type GlobalCase } from "../conversational-intelligence/global/evaluate-global";

const originalFlag = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  extract: fitnessAgentDeps.profileExtractor.extract,
  get: readerDeps.get,
};
test.afterEach(() => {
  Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: original.getUserFitnessContext, updateProfileFields: original.updateProfileFields, findPTCandidates: original.findPTCandidates });
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  readerDeps.get = original.get;
  if (originalFlag === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = originalFlag;
});
test.after(async () => { await prisma.$disconnect(); });

const CORPUS = path.resolve(__dirname, "../../../../../test/conversational-intelligence/global-blind.json");

function stubWorld(opts: { contracts?: any[]; goal?: string } = {}) {
  const profile: Record<string, unknown> = {
    goal: opts.goal ?? "MUSCLE_GAIN", age: 22, gender: "MALE", heightCm: 173, currentWeight: 80, targetWeight: null, days: [1, 3, 5],
    sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER", goalIntent: null,
  };
  const calls = { updateProfileFields: [] as any[], findPTCandidates: [] as any[], readerGets: [] as string[] };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, fields: any) => { calls.updateProfileFields.push(fields); Object.assign(profile, fields); return {}; };
  // Phase 3 Batch 1 — readers.ts's readNutritionTarget/readProgram/readNutritionProgram now read
  // nutritionGoal/currentWorkoutProgram/currentNutritionProgram off THIS stub (via the Enterprise
  // Data Layer, routed through profileExtractor.extract) instead of readerDeps.get's own
  // /nutrition/goals /workouts/programs/current stubs below — mirror the same fixture values here
  // so both the old (contracts/PT) and migrated (nutrition goal/program) reads stay consistent.
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal, age: profile.age, heightCm: profile.heightCm, currentWeightKg: profile.currentWeight, gender: profile.gender,
      training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3 },
      nutritionGoal: { calories: 2187, protein: 193, carbs: 201, fat: 68 },
    },
    currentWorkoutProgram: { name: "Full body 3 ngày", daysPerWeek: 3, dayCount: 3 },
  } as any);
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, prefs: any) => { calls.findPTCandidates.push(prefs); return { candidates: [], truncated: false, historyAuditId: "h", preferences: prefs } as any; };
  readerDeps.get = async (url: string) => {
    calls.readerGets.push(url);
    if (url.endsWith("/contracts/client")) return { status: 200, data: opts.contracts ?? [] };
    if (url.endsWith("/nutrition/goals")) return { status: 200, data: { id: "g1", calories: 2187, protein: 193, carbs: 201, fat: 68, status: "ACTIVE" } };
    if (url.endsWith("/workouts/programs/current")) return { status: 200, data: { success: true, data: { program: { id: "p1", name: "Full body 3 ngày", daysPerWeek: 3 } } } };
    if (url.endsWith("/nutrition/plans/current")) return { status: 200, data: { success: true, data: null } };
    return { status: 404, data: {} };
  };
  return { profile, calls };
}
const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "ci global" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
const workflowRows = (userId: string) => prisma.agentWorkflowSession.findMany({ where: { userId } });

test("blind corpus gates (post-remediation) : READ/FIND/RECOMMEND/interruption/reference/multi-intent all ≥ 98 %, zero unsafe misroutes", () => {
  const ev = evaluateGlobal(JSON.parse(fs.readFileSync(CORPUS, "utf8")) as GlobalCase[]);
  assert.ok(ev.total >= 150);
  assert.equal(ev.unsafeMisroutes, 0);
  for (const [k, t] of Object.entries(ev.metrics)) assert.ok(t.n === 0 || t.ok / t.n >= 0.98, `${k}: ${t.ok}/${t.n}\n${ev.failures.join("\n")}`);
});

test("READ ≠ FIND (flag ON): 'Tôi đang có PT chưa?' reads the real contract state — no PT search, no workflow, no write", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { calls } = stubWorld({ contracts: [{ id: "c1", status: "PENDING_REVIEW", packageName: "Gói 10 buổi", ptProfile: { firstName: "Linh", lastName: "Phạm" } }] });
  const userId = `g-read-${randomUUID()}`; const s = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Tôi đang có PT chưa?", { userId, authorizationHeader: "Bearer x" } as any, s.id);
    assert.ok(r, "answered");
    assert.match(r!.answer, /Linh Phạm/);
    assert.match(r!.answer, /chờ PT duyệt/);
    assert.match(r!.answer, /chưa phải hợp đồng đang hoạt động/);
    assert.equal(calls.findPTCandidates.length, 0, "no PT search");
    assert.equal((await workflowRows(userId)).length, 0, "no workflow started");
    assert.equal(calls.updateProfileFields.length, 0);
    assert.ok(calls.readerGets.some((u) => u.endsWith("/contracts/client")), "read from the owning service");
  } finally { await cleanup(userId, s.id); }
});

test("READ ≠ FIND (flag OFF baseline): the same sentence still restarts the PT search — this is the defect the flag fixes", async () => {
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2;
  stubWorld();
  const userId = `g-off-${randomUUID()}`; const s = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Tôi đang có PT chưa?", { userId } as any, s.id);
    assert.ok(r && /ngày|ngân sách|PT/i.test(r.answer));
    assert.equal((await workflowRows(userId)).length >= 1, true, "legacy behaviour: a FIND_PT workflow was started");
  } finally { await cleanup(userId, s.id); }
});

test("FIND stays FIND (flag ON): 'PT nào hợp với tôi?' and 'Tìm PT cho tôi' start the existing PT workflow", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubWorld();
  for (const text of ["PT nào hợp với tôi?", "Tìm PT cho tôi."]) {
    const userId = `g-find-${randomUUID()}`; const s = await newSession(userId);
    try {
      const r = await fitnessAgent.tryTurn(text, { userId } as any, s.id);
      assert.equal(r!.blocks[0].type, "WORKFLOW_MISSING_DATA", text);
      assert.equal((await workflowRows(userId))[0].workflowType, "FIND_PT", text);
    } finally { await cleanup(userId, s.id); }
  }
});

test("PENDING WORKFLOW GOLDEN (flag ON): PT search waits for the budget → 'Macro hiện tại của tôi bao nhiêu?' is answered from the ACTIVE goal, the workflow survives untouched, and '2 triệu.' resumes it", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { calls } = stubWorld();
  const userId = `g-pending-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", identity, s.id);
    const before = (await workflowRows(userId))[0];
        assert.equal(before.expectedSlot, "budgetVnd");

    const side = await fitnessAgent.tryTurn("Macro hiện tại của tôi bao nhiêu?", identity, s.id);
    assert.match(side!.answer, /2\.187 kcal/);
    assert.match(side!.answer, /đạm 193g/);
    assert.match(side!.answer, /Bạn vẫn đang tìm PT dở/);
    assert.match(side!.answer, /ngân sách/i);
    const after = (await workflowRows(userId))[0];
    assert.equal(after.id, before.id, "same workflow row");
    assert.equal(after.status, "COLLECTING_SLOTS");
    assert.equal(after.expectedSlot, "budgetVnd", "the calorie question did NOT fill or move the budget slot");
    assert.equal(calls.findPTCandidates.length, 0);

    const resumed = await fitnessAgent.tryTurn("2 triệu.", identity, s.id);
    assert.equal(calls.findPTCandidates.length, 1, "PT search ran once, after the answer");
    assert.equal(calls.findPTCandidates[0].budgetVnd, 2_000_000);
    assert.ok(resumed);
  } finally { await cleanup(userId, s.id); }
});

test("a knowledge question interrupting a waiting workflow leaves it untouched (RAG answers)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubWorld();
  const userId = `g-qa-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", identity, s.id);
    const before = (await workflowRows(userId))[0];
    const r = await fitnessAgent.tryTurn("protein là gì?", identity, s.id);
    assert.equal(r, null, "falls through to the chat pipeline (RAG)");
    const after = (await workflowRows(userId))[0];
    assert.equal(after.id, before.id);
    assert.equal(after.expectedSlot, before.expectedSlot);
    assert.equal(after.status, "COLLECTING_SLOTS");
  } finally { await cleanup(userId, s.id); }
});

test("GOAL RECOMMENDATION GOLDEN (flag ON): standalone 'nên cut hay bulk?' explains from real data with NO write → 'ok đổi theo đề xuất đó' → confirmation card → confirm → fresh 'mục tiêu hiện tại' answer", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { profile, calls } = stubWorld();
  const userId = `g-goal-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    const rec = await fitnessAgent.tryTurn("với tình trạng hiện tại tôi nên cut hay bulk?", identity, s.id);
    assert.match(rec!.answer, /173cm/);
    assert.match(rec!.answer, /80kg/);
    assert.match(rec!.answer, /BMI khoảng 26,7/);
    assert.match(rec!.answer, /giảm mỡ/);
    assert.match(rec!.answer, /không phải chẩn đoán/);
    assert.equal(calls.updateProfileFields.length, 0, "a recommendation never writes");
    assert.equal(profile.goal, "MUSCLE_GAIN");

    const propose = await fitnessAgent.tryTurn("ok đổi theo đề xuất đó", identity, s.id);
    assert.equal(propose!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    assert.ok(((propose!.blocks[0] as any).changes as any[]).some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS"));
    assert.equal(calls.updateProfileFields.length, 0, "still nothing written before the user confirms");

    const done = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, s.id);
    assert.equal(calls.updateProfileFields.length, 1);
    assert.equal(profile.goal, "WEIGHT_LOSS");
    assert.match(done!.answer, /Đã cập nhật hồ sơ/);

    const fresh = await fitnessAgent.tryTurn("Mục tiêu hiện tại của tôi là gì?", identity, s.id);
    assert.match(fresh!.answer, /giảm mỡ/, "fresh authoritative state after the write");
  } finally { await cleanup(userId, s.id); }
});

test("EXPLAIN + ACT standalone (flag ON): explains from the user's own numbers AND only proposes the goal change", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { profile, calls } = stubWorld();
  const userId = `g-expl-${randomUUID()}`; const s = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Vì sao bạn nghĩ tôi nên giảm mỡ? Nếu hợp lý thì đổi giúp tôi.", { userId } as any, s.id);
    assert.equal(r!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    assert.match(r!.answer, /173cm/);
    assert.match(r!.answer, /không phải chẩn đoán/);
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(profile.goal, "MUSCLE_GAIN");
  } finally { await cleanup(userId, s.id); }
});

test("WRITE stays a proposal: 'Đổi mục tiêu sang giảm mỡ.' only shows the confirmation card; a goal change while another workflow waits asks instead of clobbering it", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { calls } = stubWorld();
  const userId = `g-write-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId } as any;
  try {
    const r = await fitnessAgent.tryTurn("Đổi mục tiêu sang giảm mỡ.", identity, s.id);
    assert.equal(r!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    assert.equal(calls.updateProfileFields.length, 0);
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", identity, s.id);
    const before = (await workflowRows(userId))[0];
    const ask = await fitnessAgent.tryTurn("Đổi mục tiêu sang tăng cơ.", identity, s.id);
    assert.match(ask!.answer, /Bạn đang tìm PT dở/);
    assert.equal((await workflowRows(userId))[0].id, before.id, "the PT workflow was not cancelled");
    assert.equal(calls.updateProfileFields.length, 0);
  } finally { await cleanup(userId, s.id); }
});

test("READ topics use real services (flag ON): calorie target, program, goal, PT with no contract", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubWorld({ contracts: [] });
  const userId = `g-topics-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    assert.match((await fitnessAgent.tryTurn("Tôi đang ăn theo bao nhiêu calo?", identity, s.id))!.answer, /2\.187 kcal/);
    assert.match((await fitnessAgent.tryTurn("Tôi đang theo chương trình nào?", identity, s.id))!.answer, /Full body 3 ngày/);
    assert.match((await fitnessAgent.tryTurn("Mục tiêu hiện tại của tôi là gì?", identity, s.id))!.answer, /tăng cơ/);
    assert.match((await fitnessAgent.tryTurn("Tôi có PT chưa?", identity, s.id))!.answer, /chưa có PT/);
    assert.match((await fitnessAgent.tryTurn("Tôi đang theo thực đơn nào?", identity, s.id))!.answer, /chưa lưu thực đơn/);
    assert.equal((await workflowRows(userId)).length, 0, "reads create no workflow");
  } finally { await cleanup(userId, s.id); }
});

test("READ nutrition-program answers inspect the saved menu instead of generating a new one", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  stubWorld({ contracts: [] });
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: { nutritionGoal: { calories: 2200, protein: 165, carbs: 248, fat: 61 } },
    inBodyHistory: [],
    workoutHistory: [],
    nutritionHistory: [],
    currentNutritionProgram: {
      name: "Cutting Plan",
      dailyCaloriesTarget: 2200,
      proteinTargetGrams: 165,
      carbTargetGrams: 248,
      fatTargetGrams: 61,
      mealsPerDay: 3,
      status: "ACTIVE",
      daySummaries: [{
        dayNumber: 1,
        meals: [
          { mealType: "BREAKFAST", itemNames: ["Yến mạch", "Trứng", "Chuối"] },
          { mealType: "LUNCH", itemNames: ["Cơm trắng", "Cá", "Rau xanh"] },
        ],
      }],
    },
  } as any);
  const userId = `g-menu-read-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    assert.equal(classifyGlobal("đã có thực đơn chưa").route, "READ_STATE");
    assert.equal(classifyGlobal("đã có thực đơn chưa").topic, "NUTRITION_PROGRAM");
    const r = await fitnessAgent.tryTurn("đã có thực đơn chưa", identity, s.id);
    assert.ok(r, "answered");
    assert.match(r!.answer, /Cutting Plan/);
    assert.match(r!.answer, /2\.200 kcal|2200 kcal/);
    assert.match(r!.answer, /Yến mạch/);
    assert.doesNotMatch(r!.answer, /Mình đang tính thực đơn|Gợi Ý Bữa Ăn/);
    assert.equal((await workflowRows(userId)).length, 0, "read creates no nutrition workflow");
  } finally { await cleanup(userId, s.id); }
});

test("PURE Q&A causes no business write and starts no workflow (flag ON)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const { calls } = stubWorld();
  const userId = `g-pure-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId } as any;
  const qs = ["Progressive overload là gì?", "RIR là gì?", "Superset khác dropset thế nào?", "PT là gì?", "Một PT tốt cần có tiêu chí gì?", "Thâm hụt calo là gì?", "Creatine có an toàn không?", "BMI là gì và tính thế nào?"];
  try {
    for (const q of qs) assert.equal(await fitnessAgent.tryTurn(q, identity, s.id), null, `${q} → chat pipeline`);
    assert.equal((await workflowRows(userId)).length, 0);
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId } }), 0);
    assert.equal(calls.updateProfileFields.length, 0);
    assert.equal(calls.findPTCandidates.length, 0);
  } finally { await cleanup(userId, s.id); }
});

test("second held-out set (deterministic router only): never routes a read/recommend/QA/negation turn to something that mutates; accuracy floor 78 % (the LLM fallback covers the rest)", () => {
  const ev = evaluateGlobal(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../test/conversational-intelligence/global-holdout2.json"), "utf8")) as GlobalCase[]);
  assert.equal(ev.unsafeMisroutes, 0);
  assert.ok(ev.metrics.route.ok / ev.metrics.route.n >= 0.78, `${ev.metrics.route.ok}/${ev.metrics.route.n}\n${ev.failures.join("\n")}`);
});

test("LLM routing fallback can NEVER take a turn that belongs to a waiting workflow or a pending confirmation, even when the model always answers READ_STATE (worst case)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
  const realRoute = llmRouteDeps.llmRoute;
  llmRouteDeps.llmRoute = async () => ({ route: "READ_STATE", topic: "GOAL", confidence: 0.6, reason: "worst-case model" } as any);
  const { profile, calls } = stubWorld({ goal: "WEIGHT_LOSS" });
  const userId = `g-llm-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    // a roadmap waiting on the target weight: a generic "suggest for me" belongs to the WORKFLOW, not to a standalone read
    await fitnessAgent.tryTurn("Tạo lộ trình cho tôi", identity, s.id);
    const rec = await fitnessAgent.tryTurn("ok hãy đề xuất cho tôi", identity, s.id);
    assert.match(rec!.answer, /72kg/, "the in-workflow target-weight recommendation policy");
    assert.doesNotMatch(rec!.answer, /^Mục tiêu hiện tại của bạn là/, "NOT the standalone goal read the worst-case model would have produced");
    // a pending confirmation card: the confirmation reply must still confirm
    const propose = await fitnessAgent.tryTurn("74kg", identity, s.id);
    assert.equal(propose!.blocks[0].type, "PROFILE_UPDATE_CONFIRMATION");
    // the confirmation resumes the roadmap preview, whose downstream tools this test does not stub (401) — the write itself already happened
    await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, s.id).catch(() => null);
    assert.equal(calls.updateProfileFields.length, 1, "the confirmation was not swallowed by the fallback");
    assert.equal(profile.targetWeight, 74);
  } finally {
    llmRouteDeps.llmRoute = realRoute; delete process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM;
    await cleanup(userId, s.id);
  }
});

test("regressions found by the live QA run: the RIGHT fact for the question, the arithmetic asked for, meal-content questions are knowledge, injury turns are never handled by the model fallback, roadmap status stays with the roadmap intent", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
  const realRoute = llmRouteDeps.llmRoute;
  const { calls } = stubWorld({ goal: "WEIGHT_LOSS" });
  const profileWith = async () => ({ profile: { goal: "WEIGHT_LOSS", heightCm: 173, currentWeight: 113.6, targetWeight: 80, age: 22 }, coach: {} } as any);
  fitnessAgentDeps.tools.getUserFitnessContext = profileWith;
  const userId = `g-regr-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    assert.match((await fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity, s.id))!.answer, /Chiều cao.*173cm/);
    assert.match((await fitnessAgent.tryTurn("Tôi cần giảm bao nhiêu kg nữa để đạt mục tiêu?", identity, s.id))!.answer, /33,6kg|33\.6kg/);
    assert.equal(await fitnessAgent.tryTurn("Bữa ăn trước khi tập nên có gì?", identity, s.id), null, "meal-content question is knowledge → chat pipeline");
    // a worst-case model that answers RECOMMEND(PT) / READ(PT_STATUS) for everything must not be able to start a PT search or read contracts for an injury sentence
    for (const worst of [{ route: "RECOMMEND", topic: "PT", workflow: "FIND_PT" }, { route: "READ_STATE", topic: "PT_STATUS" }]) {
      llmRouteDeps.llmRoute = async () => ({ ...worst, confidence: 0.6, reason: "worst-case model" } as any);
      const r = await fitnessAgent.tryTurn("Tôi đau lưng nhưng muốn deadlift nặng.", identity, s.id);
      assert.equal(r, null, "injury wording goes to the safety-aware chat pipeline");
      const kx = await fitnessAgent.tryTurn("Kinh nghiệm tập luyện của tôi ở mức nào?", identity, s.id);
      assert.ok(kx === null || !/hợp đồng|PT/.test(kx.answer), "no evidence for a PT read in the text → discarded");
    }
    assert.equal((await workflowRows(userId)).length, 0);
    assert.equal(calls.findPTCandidates.length, 0);
    assert.equal(classifyGlobal("Tôi đã có lộ trình nào đang hoạt động chưa?").topic, "ROADMAP_STATUS");
  } finally { llmRouteDeps.llmRoute = realRoute; delete process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM; await cleanup(userId, s.id); }
});

// ───────────────────────── Phase A: "Tôi cao bao nhiêu?" regression (found live by Codex, mock provider) ─────────────────────────
// Root cause: the DETERMINISTIC router's height vocabulary only recognised the compound noun "chiều cao"; a bare "cao bao nhiêu?"
// (mirroring how "nặng bao nhiêu?" was already handled for weight) fell through to route=UNKNOWN and relied entirely on the typed-LLM
// fallback to rescue it. With CONVERSATIONAL_INTELLIGENCE_V2_LLM=on but the model unavailable/invalid (a mock provider, or — proven
// below — the fallback simply returning null), the turn had no route at all and fitnessAgent.tryTurn returned null. Fixed generally in
// router.ts's height vocabulary (a phrase family, not a literal match on this one sentence) — see the natural variants below.
test("Phase A regression: 'Tôi cao bao nhiêu?' and natural variants resolve WITHOUT any LLM help (deterministic router alone), and never return weight/BMI/target-weight instead of height", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  delete process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM; // fallback OFF — must not be needed for any of these
  const profileWith = async () => ({ profile: { goal: "WEIGHT_LOSS", heightCm: 173, currentWeight: 113.6, targetWeight: 80, age: 22 }, coach: {} } as any);
  fitnessAgentDeps.tools.getUserFitnessContext = profileWith;
  const userId = `g-height-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    for (const q of ["Tôi cao bao nhiêu?", "Chiều cao của tôi là bao nhiêu?", "Tôi cao mấy mét?", "Profile tôi đang lưu chiều cao bao nhiêu?", "toi cao bao nhieu", "height của tôi hiện tại?"]) {
      const r = await fitnessAgent.tryTurn(q, identity, s.id);
      assert.ok(r, `${q} → must not be null`);
      assert.match(r!.answer, /173cm/, q);
      assert.doesNotMatch(r!.answer, /113,6kg|113\.6kg|80kg/, `${q} → must not answer with weight/target-weight instead of height`);
    }
    // cross-check: the sibling weight/target-weight questions still answer their OWN fact, not height
    const w = await fitnessAgent.tryTurn("Tôi nặng bao nhiêu?", identity, s.id);
    assert.match(w!.answer, /113,6kg|113\.6kg/);
    assert.doesNotMatch(w!.answer, /173cm/);
    const tw = await fitnessAgent.tryTurn("Cân nặng mục tiêu của tôi là bao nhiêu?", identity, s.id);
    assert.match(tw!.answer, /80kg/);
    assert.doesNotMatch(tw!.answer, /173cm/);
  } finally { await cleanup(userId, s.id); }
});

test("Phase A regression, exact reproduction: LLM fallback ON but the model call itself fails (mock/unreachable provider) — the height question still resolves via the deterministic router, not null", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
  const realRoute = llmRouteDeps.llmRoute;
  llmRouteDeps.llmRoute = async () => null; // simulates callLlmJson exhausting retries against a mock/invalid provider
  const profileWith = async () => ({ profile: { goal: "WEIGHT_LOSS", heightCm: 173, currentWeight: 113.6, targetWeight: 80, age: 22 }, coach: {} } as any);
  fitnessAgentDeps.tools.getUserFitnessContext = profileWith;
  const userId = `g-height-mock-${randomUUID()}`; const s = await newSession(userId);
  const identity = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    const r = await fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity, s.id);
    assert.ok(r, "must not be null even when the LLM fallback returns nothing");
    assert.match(r!.answer, /173cm/);
  } finally { llmRouteDeps.llmRoute = realRoute; delete process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM; await cleanup(userId, s.id); }
});
