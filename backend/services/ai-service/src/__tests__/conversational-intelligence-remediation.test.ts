/**
 * CI-V2 targeted remediation — BACKEND INTEGRATION (real test DB, real fitnessAgent/orchestrator, stubbed business services).
 *  1. a pending DRAFT is conversation state: a revision cue routes to the draft (CORRECTION → existing draft router) and the typed-LLM
 *     fallback is never consulted while a draft awaits confirmation;
 *  2. a missing profile (422 "Complete your profile first") is guidance, not a 500 — while authorization / unexpected failures stay errors;
 *  3. traces carry correlation + attribution and no profile values.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { readerDeps } from "../conversational-intelligence/global/readers";
import { llmRouteDeps } from "../conversational-intelligence/global/llm-route";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import { runGlobalTurn } from "../conversational-intelligence/global/global-turn";
import { classifyProfileReadError, MISSING_PROFILE_ANSWER, PROFILE_UNAVAILABLE_ANSWER } from "../conversational-intelligence/global/profile-errors";
import { PROFILE_READ_ORIGIN } from "../services/fitness-agent-tools";
import { classifyConfirmationUtterance, confirmationBoundaryAnswer, deriveConfirmationState } from "../services/confirmation-boundary";

const flags = { v2: process.env.CONVERSATIONAL_INTELLIGENCE_V2, llm: process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM };
const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext, updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  extract: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, llmRoute: llmRouteDeps.llmRoute, info: logger.info.bind(logger),
};
const restoreEnv = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
test.afterEach(() => {
  Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: original.getUserFitnessContext, updateProfileFields: original.updateProfileFields });
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  readerDeps.get = original.get; llmRouteDeps.llmRoute = original.llmRoute; (logger as any).info = original.info;
  restoreEnv("CONVERSATIONAL_INTELLIGENCE_V2", flags.v2); restoreEnv("CONVERSATIONAL_INTELLIGENCE_V2_LLM", flags.llm);
});
test.after(async () => { await prisma.$disconnect(); });

const PROFILE = { goal: "WEIGHT_LOSS", age: 28, gender: "MALE", heightCm: 173, currentWeight: 81, targetWeight: null, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], experience: "BEGINNER", goalIntent: null };
const stubProfile = () => {
  const calls = { updateProfileFields: 0 };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...PROFILE }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async () => { calls.updateProfileFields += 1; return {}; };
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: {} } as any);
  readerDeps.get = async (url: string) => (url.endsWith("/contracts/client") ? { status: 200, data: [] } : { status: 404, data: {} });
  return calls;
};
// a failure raised BY the profile read (carries the origin marker the real tool sets); `fromProfileRead=false` models any other tool's failure
const throwing = (status: number | undefined, message: string, fromProfileRead = true) => { fitnessAgentDeps.tools.getUserFitnessContext = async () => { throw Object.assign(new Error(message), status === undefined ? {} : { status }, fromProfileRead ? { origin: PROFILE_READ_ORIGIN } : {}); }; };
const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "ci remediation" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
const addPendingDraft = (userId: string, sessionId: string) => prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: {}, status: "PENDING", expiresAt: new Date(Date.now() + 10 * 60000) } });
const identity = (userId: string) => ({ userId, authorizationHeader: "Bearer test" });
const deps = () => ({ getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext, updateProfileFields: fitnessAgentDeps.tools.updateProfileFields });

// ───────────────────────── 1. pending draft is conversation state ─────────────────────────
test("router: a revision cue with a value while a DRAFT is pending is CORRECTION; without the draft the classification is unchanged; real questions are not swallowed", () => {
  assert.equal(classifyGlobal("sai rồi, phải là 5 buổi mỗi tuần", { draft: true }).route, "CORRECTION");
  assert.equal(classifyGlobal("à khoan, tôi nói nhầm, phải là 3 buổi", { draft: true }).route, "CORRECTION");
  assert.equal(classifyGlobal("à khoan, tôi nói nhầm, phải là 3 buổi", {}).route, "UNKNOWN", "no draft, no workflow: nothing to correct — unchanged");
  assert.equal(classifyGlobal("Tôi đang có PT chưa?", { draft: true }).route, "READ_STATE");
  assert.equal(classifyGlobal("với tình trạng hiện tại tôi nên cut hay bulk?", { draft: true }).route, "RECOMMEND");
  assert.equal(classifyGlobal("Protein là gì?", { draft: true }).route, "KNOWLEDGE_QA");
});

test("pending draft: a revision turn is handed back (CORRECTION, no answer of its own), the LLM fallback is NOT consulted, nothing is written", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
  const calls = stubProfile(); let llm = 0;
  llmRouteDeps.llmRoute = async () => { llm += 1; return { route: "RECOMMEND", topic: "SESSIONS", confidence: 0.6, reason: "typed LLM fallback" } as any; };
  const userId = `rem-draft-${randomUUID()}`; const s = await newSession(userId); await addPendingDraft(userId, s.id);
  try {
    const out = await runGlobalTurn("sai rồi, phải là 5 buổi mỗi tuần", identity(userId), s.id, null, deps(), "corr-draft-1");
    assert.equal(out?.route.route, "CORRECTION");
    assert.equal(out?.result, undefined, "the draft's own router answers, not CI-V2");
    assert.equal(llm, 0);
    assert.equal(calls.updateProfileFields, 0);
  } finally { await cleanup(userId, s.id); }
});

test("LLM fallback is never consulted while a draft is pending — and IS consulted for the same utterance when no draft exists (the guard is what changed the outcome)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
  stubProfile(); let llm = 0;
  llmRouteDeps.llmRoute = async () => { llm += 1; return { route: "RECOMMEND", topic: "SESSIONS", confidence: 0.6, reason: "typed LLM fallback" } as any; };
  const utterance = "5 buổi thôi nhé";
  assert.equal(classifyGlobal(utterance, {}).route, "UNKNOWN", "precondition: the deterministic router cannot place this turn");
  const userId = `rem-llm-${randomUUID()}`; const s = await newSession(userId);
  try {
    await runGlobalTurn(utterance, identity(userId), s.id, null, deps(), "corr-llm-0");
    assert.equal(llm, 1, "no pending draft: the fallback is eligible");
    llm = 0; await addPendingDraft(userId, s.id);
    const out = await runGlobalTurn(utterance, identity(userId), s.id, null, deps(), "corr-llm-1");
    assert.equal(llm, 0, "pending draft: the turn belongs to the draft router");
    assert.notEqual(out?.route.route, "RECOMMEND");
    assert.equal(out?.result, undefined);
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── 2. missing profile ─────────────────────────
test("classifyProfileReadError: the five conditions are distinguished — by ORIGIN first, then status", () => {
  const fromRead = (status: number | undefined, message: string) => Object.assign(new Error(message), status === undefined ? {} : { status }, { origin: PROFILE_READ_ORIGIN });
  assert.equal(classifyProfileReadError(fromRead(422, "Complete your profile first")), "PROFILE_MISSING");
  assert.equal(classifyProfileReadError(fromRead(503, "Domain service unavailable")), "UPSTREAM_UNAVAILABLE");
  assert.equal(classifyProfileReadError(fromRead(504, "Domain service unavailable")), "UPSTREAM_UNAVAILABLE");
  assert.equal(classifyProfileReadError(fromRead(403, "Request rejected")), "AUTHORIZATION");
  assert.equal(classifyProfileReadError(fromRead(401, "Request rejected")), "AUTHORIZATION");
  assert.equal(classifyProfileReadError(fromRead(500, "Domain service unavailable")), "UNEXPECTED");
  assert.equal(classifyProfileReadError(Object.assign(new TypeError("x is not a function"), { origin: PROFILE_READ_ORIGIN })), "UNEXPECTED");
  assert.equal(classifyProfileReadError(fromRead(422, "Some other validation")), "UNEXPECTED", "only the named missing-profile 422 is guidance");
  // X1: the SAME status/message from any OTHER tool is not a profile condition
  for (const [status, message] of [[422, "Complete your profile first"], [503, "Domain service unavailable"], [504, "Domain service unavailable"], [401, "Request rejected"], [403, "Request rejected"]] as const) {
    assert.equal(classifyProfileReadError(Object.assign(new Error(message), { status })), "UNEXPECTED", `no origin marker → not a profile error (${status})`);
    assert.equal(classifyProfileReadError(Object.assign(new Error(message), { status, origin: "other-tool" })), "UNEXPECTED");
  }
});

for (const question of ["Tôi cao bao nhiêu?", "Cân nặng hiện tại của tôi là bao nhiêu?", "Mục tiêu hiện tại của tôi là gì?", "với tình trạng hiện tại tôi nên cut hay bulk?"]) {
  test(`profile EXISTS: "${question}" is answered from the real profile (no guidance text, no error)`, async () => {
    process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
    const userId = `rem-ok-${randomUUID()}`; const s = await newSession(userId);
    try {
      const r = await fitnessAgent.tryTurn(question, identity(userId), s.id, "corr-ok");
      assert.ok(r && r.answer.length > 10);
      assert.doesNotMatch(r.answer, /chưa có hồ sơ|gián đoạn/);
    } finally { await cleanup(userId, s.id); }
  });
  test(`profile MISSING (422): "${question}" → guided Vietnamese answer, no throw, nothing written or started`, async () => {
    process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; const calls = stubProfile(); throwing(422, "Complete your profile first");
    const userId = `rem-missing-${randomUUID()}`; const s = await newSession(userId);
    try {
      const r = await fitnessAgent.tryTurn(question, identity(userId), s.id, "corr-missing");
      assert.equal(r?.answer, MISSING_PROFILE_ANSWER);
      assert.match(r!.answer, /chiều cao/); assert.match(r!.answer, /cân nặng/); assert.match(r!.answer, /mục tiêu/);
      assert.deepEqual(r!.blocks, []);
      assert.equal(calls.updateProfileFields, 0);
      assert.equal(await prisma.agentWorkflowSession.count({ where: { userId } }), 0, "no workflow started");
      assert.equal(await prisma.fitnessAgentAction.count({ where: { userId } }), 0, "no action/draft created");
    } finally { await cleanup(userId, s.id); }
  });
}

test("upstream UNAVAILABLE (503): a transient, honest answer — not a 500, not the missing-profile text", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile(); throwing(503, "Domain service unavailable");
  const userId = `rem-503-${randomUUID()}`; const s = await newSession(userId);
  try {
    const r = await fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id, "corr-503");
    assert.equal(r?.answer, PROFILE_UNAVAILABLE_ANSWER);
    assert.doesNotMatch(r!.answer, /chưa có hồ sơ/);
  } finally { await cleanup(userId, s.id); }
});

test("UNEXPECTED upstream failure (500) and non-HTTP errors stay real errors (visible, not disguised as guidance)", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  const userId = `rem-500-${randomUUID()}`; const s = await newSession(userId);
  try {
    throwing(500, "Domain service unavailable");
    await assert.rejects(() => fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id), /Domain service unavailable/);
    throwing(undefined, "boom");
    await assert.rejects(() => fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id), /boom/);
  } finally { await cleanup(userId, s.id); }
});

test("AUTHORIZATION failure (401/403) is NEVER turned into a successful answer", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  const userId = `rem-403-${randomUUID()}`; const s = await newSession(userId);
  try {
    for (const status of [401, 403]) {
      throwing(status, "Request rejected");
      await assert.rejects(() => fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id), (e: any) => e.status === status);
    }
    // the recommendation sub-step used to swallow errors: an authorization failure there must not be swallowed either
    throwing(403, "Request rejected");
    await assert.rejects(() => fitnessAgent.tryTurn("với tình trạng hiện tại tôi nên cut hay bulk?", identity(userId), s.id), (e: any) => e.status === 403);
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── 3. trace: correlation, attribution, no profile values ─────────────────────────
test("ci_global_trace carries correlationId + userId + sessionId + the router's context, and never profile values or message text", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  const lines: any[] = [];
  (logger as any).info = (obj: any, msg?: string) => { if (msg === "ci_global_trace") lines.push(obj); return original.info(obj, msg); };
  const userId = `rem-trace-${randomUUID()}`; const s = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("Chiều cao của tôi là bao nhiêu?", identity(userId), s.id, "corr-trace-1");
    assert.equal(lines.length, 1);
    const t = lines[0];
    assert.equal(t.correlationId, "corr-trace-1"); assert.equal(t.userId, userId); assert.equal(t.sessionId, s.id);
    assert.equal(t.route, "READ_STATE"); assert.equal(t.deterministicRoute, "READ_STATE"); assert.equal(t.llmCalled, false); assert.equal(t.pendingDraft, false);
    assert.equal(t.facts, undefined); assert.equal(t.patch, undefined);
    const values = Object.values(t);
    assert.ok(!values.some((v) => v === 173 || v === 81 || v === "WEIGHT_LOSS"), "no profile value in the trace");
    assert.ok(!values.some((v) => typeof v === "string" && v.includes("Chiều cao của tôi")), "no message text in the trace");
    assert.deepEqual(t.factKeys.sort(), ["age", "currentWeight", "goal", "heightCm", "targetWeight"]);
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── X1 — origin, not status ─────────────────────────
test("X1: with CI-V2 on, a 503/422/401 raised by ANOTHER tool (not the profile read) passes through tryTurn untouched; only the profile read is translated", async () => {
  // CI-V2 must be ON for "Tôi cao bao nhiêu?" to reach a profile read at all (with it off, this question never touches
  // getUserFitnessContext through any path — that CI-V2-off/food-substitution case is covered by codex-remediation-boundary.test.ts).
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  const userId = `rem-x1-${randomUUID()}`; const s = await newSession(userId);
  try {
    for (const [status, message] of [[503, "Domain service unavailable"], [422, "Complete your profile first"], [401, "No token provided"]] as const) {
      throwing(status, message, false); // not from the profile read
      await assert.rejects(() => fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id), (e: any) => e.status === status && e.message === message, `on/${status}`);
    }
    throwing(503, "Domain service unavailable", true); // from the profile read → guidance
    assert.equal((await fitnessAgent.tryTurn("Tôi cao bao nhiêu?", identity(userId), s.id))?.answer, PROFILE_UNAVAILABLE_ANSWER);
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── X3 — CI-on regression: the actual causes ─────────────────────────
test("X3: a topic-less RECOMMEND (\"hôm nay tôi nên tập chân hay tập lưng?\") reads NO profile and falls through to the normal chat", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  let profileReads = 0;
  fitnessAgentDeps.tools.getUserFitnessContext = async () => { profileReads += 1; throw Object.assign(new Error("No token provided"), { status: 401, origin: PROFILE_READ_ORIGIN }); };
  const userId = `rem-x3a-${randomUUID()}`; const s = await newSession(userId);
  try {
    assert.equal(classifyGlobal("hôm nay tôi nên tập chân hay tập lưng?", {}).route, "RECOMMEND");
    assert.equal(classifyGlobal("hôm nay tôi nên tập chân hay tập lưng?", {}).topic, undefined, "precondition: RECOMMEND without a topic");
    assert.equal(await fitnessAgent.tryTurn("hôm nay tôi nên tập chân hay tập lưng?", { userId }, s.id), null);
    assert.equal(profileReads, 0, "nothing to recommend → no profile read (so no failure to swallow or propagate)");
  } finally { await cleanup(userId, s.id); }
});

test("X3: the typed-LLM fallback yields to the legacy deterministic specialists (food substitution / meal log), and is still used for other unplaceable turns", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on"; stubProfile();
  let llm = 0;
  llmRouteDeps.llmRoute = async () => { llm += 1; return { route: "RECOMMEND", topic: "MEALS", confidence: 0.6, reason: "typed LLM fallback" } as any; };
  const extract = fitnessAgentDeps.extractFoodSubstitutionIntent;
  fitnessAgentDeps.extractFoodSubstitutionIntent = async () => null as any;
  const userId = `rem-x3b-${randomUUID()}`; const s = await newSession(userId);
  try {
    for (const q of ["tôi muốn ăn cá hồi thay ức gà", "tôi muốn ăn cá hồi thay ức gà vào buổi nào đó"]) {
      assert.equal(classifyGlobal(q, {}).route, "UNKNOWN", `precondition: deterministic router cannot place "${q}"`);
      const r = await fitnessAgent.tryTurn(q, identity(userId), s.id);
      assert.ok(!r || !/gợi ý khoảng \d+ bữa/.test(r.answer), `not hijacked into a meals recommendation: ${q}`);
    }
    assert.equal(llm, 0, "no LLM consultation for a message a legacy specialist owns");
    await fitnessAgent.tryTurn("5 buổi thôi nhé", identity(userId), s.id);
    assert.equal(llm, 1, "control: an unplaceable turn with no specialist cue still gets the second opinion");
  } finally { fitnessAgentDeps.extractFoodSubstitutionIntent = extract; await cleanup(userId, s.id); }
});

// ───────────────────────── X4 — confirmation-intent boundary ─────────────────────────
test("X4 — classifyConfirmationUtterance: anchored recognition; knowledge questions and ordinary sentences never match", () => {
  const confirm = ["Xác nhận cập nhật.", "Xác nhận.", "Ok lưu đi.", "Tôi đồng ý.", "Coi như tôi đã xác nhận.", "Ổn rồi, lưu đi.", "Lưu đi", "chốt luôn", "Đồng ý", "save it", "confirm"];
  const status = ["Đã lưu thành công chưa?", "lưu xong chưa", "cập nhật xong chưa"];
  for (const t of confirm) assert.equal(classifyConfirmationUtterance(t), "CONFIRM", t);
  // X4 collision exclusion: a phrase naming a specific artifact keeps its OWN existing collision-aware redirect (proposeSaveGeneratedPlan /
  // routePendingDraftTurn) unshadowed — this boundary must not claim it.
  for (const t of ["lưu lịch tập này", "lưu thực đơn này", "gán lịch tập vào hệ thống"]) assert.equal(classifyConfirmationUtterance(t), null, t);
  for (const t of status) assert.equal(classifyConfirmationUtterance(t), "STATUS", t);
  for (const t of ["Giải thích cơ chế xác nhận cập nhật là gì.", "Xác nhận là gì?", "Lưu ý khi tập squat là gì?", "Tôi muốn cập nhật cân nặng thành 70kg", "Làm sao để xác nhận đơn hàng PT?", "Tôi đồng ý với quan điểm đó nhưng tại sao lại như vậy", "chốt kèo với PT thứ hai được không", "ok", "Vâng", "cập nhật hồ sơ giúp tôi", "Progressive overload là gì?"])
    assert.equal(classifyConfirmationUtterance(t), null, t);
});

test("X4 — deriveConfirmationState + answers: every state has an honest answer; none claims a completed save unless the DB says so", () => {
  const now = new Date(); const future = new Date(now.getTime() + 60000); const past = new Date(now.getTime() - 60000);
  assert.equal(deriveConfirmationState([], now), "NONE");
  assert.equal(deriveConfirmationState([{ status: "PENDING", expiresAt: future }], now), "PENDING");
  assert.equal(deriveConfirmationState([{ status: "PENDING", expiresAt: past }], now), "EXPIRED");
  assert.equal(deriveConfirmationState([{ status: "COMPLETED", expiresAt: past }], now), "COMPLETED");
  assert.equal(deriveConfirmationState([{ status: "CANCELLED", expiresAt: past }], now), "CANCELLED");
  assert.equal(deriveConfirmationState([{ status: "EXECUTING", expiresAt: future }], now), "EXECUTING");
  assert.equal(deriveConfirmationState([{ status: "COMPLETED", expiresAt: past }, { status: "PENDING", expiresAt: future }], now), "PENDING", "any live pending action wins");
  for (const state of ["NONE", "PENDING", "CANCELLED", "EXPIRED"] as const) for (const intent of ["CONFIRM", "STATUS"] as const)
    assert.doesNotMatch(confirmationBoundaryAnswer(intent, state), /✅|đã lưu thành công|hoàn tất|đã cập nhật/i, `${intent}/${state}`);
  assert.match(confirmationBoundaryAnswer("STATUS", "COMPLETED"), /^Rồi/);
});

const CONFIRM_TEXTS = ["Xác nhận cập nhật.", "Xác nhận.", "Ok lưu đi.", "Tôi đồng ý.", "Coi như tôi đã xác nhận.", "Đã lưu thành công chưa?"];
// a minimal but well-formed CREATE_WORKOUT_PLAN payload — routePendingDraftTurn's revision logic (substituteMatchingExercises) iterates payload.weeklySchedule
// for ANY unrecognized message while a draft is pending, so an empty {} payload would crash it; this is what a real draft always has.
const seedAction = (userId: string, sessionId: string, status: string, expiresAt: Date) => prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: { weeklySchedule: [] }, status, expiresAt } });
for (const flag of ["off", "on"]) {
  const states: [string, (u: string, s: string) => Promise<unknown>, RegExp][] = [
    ["nothing pending", async () => undefined, /chưa có bản nháp hay thao tác nào đang chờ xác nhận|Chưa có thay đổi nào được lưu/],
    ["draft PENDING", (u, s) => seedAction(u, s, "PENDING", new Date(Date.now() + 600000)), /Mình chưa lưu gì cả|Chưa — mình chưa lưu gì cả/],
    ["already CONFIRMED", (u, s) => seedAction(u, s, "COMPLETED", new Date(Date.now() + 600000)), /đã được xác nhận và lưu/],
    ["DISMISSED (cancelled)", (u, s) => seedAction(u, s, "CANCELLED", new Date(Date.now() + 600000)), /đã được bỏ qua/],
    ["EXPIRED", (u, s) => seedAction(u, s, "PENDING", new Date(Date.now() - 60000)), /đã hết hạn/],
  ];
  for (const [name, seed, expected] of states) {
    test(`X4 (CI-V2 ${flag}, ${name}): bare confirmation utterances get a deterministic, truthful answer — no model, no write, nothing created`, async () => {
      process.env.CONVERSATIONAL_INTELLIGENCE_V2 = flag; process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM = "on";
      const calls = stubProfile(); let llm = 0;
      llmRouteDeps.llmRoute = async () => { llm += 1; return null; };
      const userId = `rem-x4-${randomUUID()}`; const s = await newSession(userId); await seed(userId, s.id);
      const before = await prisma.fitnessAgentAction.findMany({ where: { userId }, select: { id: true, status: true } });
      try {
        for (const t of CONFIRM_TEXTS) {
          const r = await fitnessAgent.tryTurn(t, identity(userId), s.id);
          assert.ok(r, t); assert.match(r!.answer, expected, t); assert.doesNotMatch(r!.answer, /✅|đã lưu thành công|hoàn tất/i, t); assert.deepEqual(r!.blocks, [], t);
        }
        assert.equal(llm, 0, "the model is never consulted for a confirmation utterance");
        assert.equal(calls.updateProfileFields, 0, "no profile write");
        assert.equal(await prisma.agentWorkflowSession.count({ where: { userId } }), 0, "no workflow created");
        assert.deepEqual(await prisma.fitnessAgentAction.findMany({ where: { userId }, select: { id: true, status: true } }), before, "no action created or changed");
      } finally { await cleanup(userId, s.id); }
    });
  }
  test(`X4 (CI-V2 ${flag}): a KNOWLEDGE question about confirmation is not intercepted (falls through to the normal chat)`, async () => {
    process.env.CONVERSATIONAL_INTELLIGENCE_V2 = flag; stubProfile();
    const userId = `rem-x4k-${randomUUID()}`; const s = await newSession(userId);
    try {
      assert.equal(await fitnessAgent.tryTurn("Giải thích cơ chế xác nhận cập nhật là gì.", identity(userId), s.id), null);
      assert.equal(await fitnessAgent.tryTurn("Xác nhận là gì?", identity(userId), s.id), null);
    } finally { await cleanup(userId, s.id); }
  });
}

test("X4: a REAL pending confirmation still works — the waiting workflow (stored proposal → profile card) owns its text confirmations and the write happens once", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  const profile: Record<string, unknown> = { ...PROFILE, goal: "MUSCLE_GAIN", currentWeight: 95, days: [1, 3, 5] };
  const writes: any[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { ...profile }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, fields: any) => { writes.push(fields); Object.assign(profile, fields); return {}; };
  fitnessAgentDeps.profileExtractor.extract = async () => ({ profile: { goal: profile.goal, age: 28, heightCm: 173, currentWeightKg: 95, gender: "MALE", training: { preferredTrainingDays: [1, 3, 5], trainingDaysPerWeek: 3 } } } as any);
  const userId = `rem-x4w-${randomUUID()}`; const s = await newSession(userId);
  try {
    await fitnessAgent.tryTurn("với tình trạng hiện tại tôi nên cut hay bulk?", identity(userId), s.id);
    const card = await fitnessAgent.tryTurn("ok đổi theo đề xuất đó", identity(userId), s.id);
    assert.ok(card?.blocks.some((b: any) => b.type === "PROFILE_UPDATE_CONFIRMATION"), "a confirmation card is pending");
    assert.equal(writes.length, 0, "nothing written before the confirmation");
    const done = await fitnessAgent.tryTurn("Xác nhận cập nhật.", identity(userId), s.id);
    assert.match(done!.answer, /Đã cập nhật hồ sơ/);
    assert.equal(writes.length, 1, "exactly one write, by the workflow — not by the boundary");
    assert.equal(writes[0].goal, "WEIGHT_LOSS");
    // X4 follow-up (docs/conversational-intelligence-x4-followup-fix.md): the profile write above
    // completed a real AgentWorkflowSession (UPDATE_GOAL), not a FitnessAgentAction — repeating the
    // same confirmation text must now truthfully say it was ALREADY saved, not falsely claim there
    // was never anything to confirm in the first place (the old, buggy NONE-state wording).
    const after = await fitnessAgent.tryTurn("Xác nhận cập nhật.", identity(userId), s.id);
    assert.match(after!.answer, /đã được xác nhận và lưu rồi/, "once consumed, a repeat confirms it was already saved — not that nothing was ever pending");
    assert.equal(writes.length, 1, "repeating the confirmation triggers no second write");
    // X4 follow-up golden sequence: "Đã lưu thành công chưa?" must truthfully report the completed
    // profile write (this is the exact defect Codex reported — see
    // docs/codex-conversational-intelligence-final-closure-signoff.md), and asking must not itself write anything.
    const status = await fitnessAgent.tryTurn("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(status!.answer, /^Rồi/, "truthful positive status answer, grounded in the completed AgentWorkflowSession — not a false denial");
    assert.doesNotMatch(status!.answer, /Chưa có thay đổi nào được lưu/i, "must never falsely deny a real, completed write");
    assert.equal(writes.length, 1, "the status question itself writes nothing");
    assert.equal(profile.goal, "WEIGHT_LOSS", "a follow-up read still sees the correct new goal");
  } finally { await cleanup(userId, s.id); }
});

test("X4: cross-user — another user cannot reach (or confirm inside) a session they do not own", async () => {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; stubProfile();
  const owner = `rem-x4o-${randomUUID()}`; const other = `rem-x4x-${randomUUID()}`; const s = await newSession(owner);
  await seedAction(owner, s.id, "PENDING", new Date(Date.now() + 600000));
  try {
    await assert.rejects(() => fitnessAgent.tryTurn("Xác nhận cập nhật.", identity(other), s.id), /not found|Conversation/i);
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId: owner, status: "PENDING" } }), 1, "the owner's pending action is untouched");
  } finally { await cleanup(owner, s.id); }
});
