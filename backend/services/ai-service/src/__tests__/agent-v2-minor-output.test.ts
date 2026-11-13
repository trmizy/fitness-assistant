/**
 * V2 Multi-Agent M7-P0.1 — MG-1 minor output safety: the deterministic general-only output policy (answer-guards.ts
 * guardGeneralOnlyAnswer) in the bounded engine (single agent) and again at supervisor composition (multi agent).
 * OFFLINE: scripted mock models, synthetic fixtures, network / provider blocked. A mock model that disobeys the prompt
 * stands in for a real one — this is NOT a live-model measurement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { bedrockRuntimeDeps } from "../services/bedrock.client";
import { guardGeneralOnlyAnswer, GENERAL_ONLY_FALLBACK_VI } from "../agent-v2/answer-guards";
import { runNutritionAgentTurn } from "../agent-v2/nutrition-agent";
import { createNutritionToolRegistry, NUTRITION_AGENT_PILOT_POLICY } from "../agent-v2/nutrition-tools";
import type { TurnTrace } from "../agent-v2/turn-trace";
import { call, mockProvider, say, system, T0, use, USER_A, world } from "./m5-benchmark/harness";

const SUPERVISION = /Vì bạn dưới 18 tuổi/;
const GENERAL_Q = "Protein có vai trò gì trong phục hồi cơ?";
const UNSAFE = /\b(20|25) tuổi|\b(20|25) tuoi|trưởng thành|truong thanh|người lớn|1[.,\s]?[25]00\s*(kcal|calo)|2400|120 g/i;

let blocked = 0;
const saved = { fetch: globalThis.fetch, send: bedrockRuntimeDeps.send, get: axios.get, post: axios.post };
test.before(() => {
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  (axios as any).get = async () => { blocked++; throw new Error("network blocked"); };
  (axios as any).post = async () => { blocked++; throw new Error("network blocked"); };
});
test.after(() => { globalThis.fetch = saved.fetch; bedrockRuntimeDeps.send = saved.send; (axios as any).get = saved.get; (axios as any).post = saved.post; });

const g = (s: string) => guardGeneralOnlyAnswer(s);
const removedBy = (s: string) => g(s).actions.filter((a) => !a.startsWith("minor_output_fallback")).map((a) => a.split(":")[0].replace("minor_output_", ""));

// ── unit: what is removed ────────────────────────────────────────────────────────────────────────────────────────────
test("MO-1 unsafe personal claims are removed (accented): adult age, adulthood, kcal/day, weight-loss kcal, macro, plan, body", () => {
  const cases: Array<[string, string]> = [
    ["Bạn 20 tuổi.", "age"],
    ["Bạn đã 20 tuổi nên có thể tập nặng hơn.", "age"],
    ["Em năm nay 17 tuổi nên cần chú ý.", "age"],
    ["Ở tuổi 25, bạn có thể tăng cường độ.", "age"],
    ["Vì bạn đã trưởng thành nên có thể ăn theo chế độ người lớn.", "adult"],
    ["Bạn là người trưởng thành.", "adult"],
    ["Bạn đã đủ 18 tuổi rồi.", "adult"],
    ["Bạn cần 1500 kcal/ngày.", "kcal"],
    ["Để giảm cân, bạn nên ăn 1200 calo mỗi ngày.", "kcal"],
    ["Để giảm cân, nên ăn 1.200 calo mỗi ngày.", "kcal"],
    ["Mục tiêu của bạn là 2.400 kcal.", "kcal"],
    ["Hãy thâm hụt 500 kcal mỗi ngày để giảm mỡ.", "kcal"],
    ["Bạn nên giảm 5 kg trong tháng này.", "weight"],
    ["Bạn cần khoảng 120 g protein mỗi ngày.", "macro"],
    ["Đây là thực đơn cho bạn trong tuần này.", "plan"],
    ["Bạn nên ăn kiêng để giảm mỡ bụng.", "plan"],
    ["Nhu cầu calo của bạn là khá cao.", "body"],
    ["Bạn đang thừa cân nhẹ.", "body"],
  ];
  for (const [s, rule] of cases) {
    const r = g(`Protein hỗ trợ sửa chữa mô cơ. ${s}`);
    assert.deepEqual(removedBy(`Protein hỗ trợ sửa chữa mô cơ. ${s}`), [rule], s);
    assert.ok(!r.answer.includes(s.trim()), s);
    assert.match(r.answer, /Protein hỗ trợ sửa chữa mô cơ\./, `${s} — the general sentence is kept`);
  }
});

test("MO-2 unaccented Vietnamese and number / unit formats (1500, 1.500, 1,500, 1 500, ranges, kcal/calo/cal/ca-lo)", () => {
  for (const s of [
    "ban 20 tuoi.", "vi ban da truong thanh nen an nhu nguoi lon.", "ban can 1500 kcal/ngay.", "de giam can ban nen an 1200 calo moi ngay.",
    "Bạn cần 1.500 kcal mỗi ngày.", "Bạn cần 1,500 kcal mỗi ngày.", "Bạn cần 1 500 kcal mỗi ngày.", "Bạn nên ăn 1500-1800 calo mỗi ngày.",
    "Bạn nên nạp 1.800–2.000 kcal mỗi ngày.", "Bạn cần 1500kcal.", "Bạn cần 1500 cal mỗi ngày.", "Bạn cần 1500 ca-lo mỗi ngày.",
    "You are 20, so you need 2000 kcal a day.", "Mỗi ngày bạn chỉ nên ăn 1200 Kcal.",
  ]) {
    const r = g(`Protein hỗ trợ sửa chữa mô cơ. ${s}`);
    assert.ok(r.actions.length > 0, s);
    assert.equal(r.answer, "Protein hỗ trợ sửa chữa mô cơ.", s);
  }
});

test("MO-3 false positives: general education (with numbers / 'tuổi' / 'protein' / 'kcal') is kept unchanged", () => {
  for (const s of [
    "Protein hỗ trợ sửa chữa mô cơ sau tập.",
    "Năng lượng cần thiết cho hoạt động thể chất.",
    "Nhu cầu dinh dưỡng thay đổi theo tuổi và mức vận động.",
    "Kcal là đơn vị đo năng lượng có trong thực phẩm.",
    "1 g protein cung cấp khoảng 4 kcal, 1 g chất béo cung cấp khoảng 9 kcal.",
    "Một quả chuối cỡ vừa có khoảng 100 kcal.",
    "Ở tuổi dậy thì, cơ thể cần đủ năng lượng để phát triển.",
    "Trẻ em 13 tuổi nên vận động ít nhất 60 phút mỗi ngày.",
    "Thanh thiếu niên nên ngủ 8–10 giờ mỗi đêm.",
    "Bạn nên ăn đủ bữa, nhiều rau và uống đủ nước.",
    "Người dưới 18 tuổi nên tập dưới sự giám sát của huấn luyện viên.",
    "Bạn có thể hỏi thêm về protein bất cứ lúc nào.",
    "Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên có chứng chỉ giám sát.",
  ]) {
    const r = g(s);
    assert.deepEqual(r.actions, [], s); assert.equal(r.answer, s, s);
  }
});

test("MO-4 the mandatory supervision line survives; an answer with nothing safe left becomes the fixed general fallback", () => {
  const note = "👨‍👩‍👧 Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên có chứng chỉ giám sát và trao đổi với phụ huynh hoặc bác sĩ nhi khoa trước khi thay đổi chế độ tập hoặc ăn uống.";
  const r = g(`Bạn 25 tuổi nên cần 2400 kcal mỗi ngày.\n\n${note}`);
  assert.ok(r.answer.includes(note)); assert.ok(r.answer.startsWith(GENERAL_ONLY_FALLBACK_VI)); assert.ok(r.actions.includes("minor_output_fallback:1"));
  const only = g("Bạn 25 tuổi nên cần 2400 kcal mỗi ngày.");
  assert.equal(only.answer, GENERAL_ONLY_FALLBACK_VI); assert.doesNotMatch(GENERAL_ONLY_FALLBACK_VI, /\d/);
  assert.deepEqual(g(""), { answer: "", actions: [] });
});

// ── integration ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("MO-5 PR-10b regression — multi-agent minor general turn: adult-age / kcal claims never reach the final answer", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 16 } });
  s.prov.nutrition.script(say("Bạn 25 tuổi nên có thể theo mục tiêu 2400 kcal. Protein giúp cơ phục hồi sau tập."));
  s.prov.recovery.script(say("Vì bạn đã trưởng thành, bạn cần 1500 kcal/ngày. Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const r = await s.ask(USER_A, GENERAL_Q);
  assert.deepEqual([...r.decision!.agents].sort(), ["nutrition", "recovery"]);
  assert.equal(s.traces[0].ageGate?.status, "MINOR"); assert.equal(s.traces[0].ageGate?.decision, "GENERAL_ONLY");
  assert.doesNotMatch(r.answer, UNSAFE, r.answer);
  assert.match(r.answer, /Protein giúp cơ phục hồi sau tập/); assert.match(r.answer, /Ngủ đủ giấc giúp cơ phục hồi tốt hơn/);
  assert.match(r.answer, SUPERVISION);
  assert.deepEqual(s.w.calls, [], "no personal tool call");
  const deleg = s.traces[0].delegations;
  assert.ok(deleg.every((d) => Object.keys(d.guardInterventions).some((k) => k.startsWith("minor_output_"))), JSON.stringify(deleg.map((d) => d.guardInterventions)));
});

test("MO-6 single-agent minor general turn (bounded engine alone): filtered before the note; tool input userId/age ignored", async () => {
  const w = world(() => T0);
  const prov = mockProvider("nutrition");
  prov.script(use(call("nutrition.get_target", { userId: "22222222-2222-4222-8222-222222222222", age: 25 })), say("Bạn 20 tuổi. Bạn cần 1500 kcal/ngày. Protein hỗ trợ sửa chữa mô cơ."));
  const traces: TurnTrace[] = [];
  const r = await runNutritionAgentTurn(
    { question: GENERAL_Q, context: { userId: USER_A, authorizationHeader: "Bearer t" } },
    { provider: prov, registry: createNutritionToolRegistry({ enabled: true, deps: w.nutrition, traceSink: () => {} }), policy: NUTRITION_AGENT_PILOT_POLICY,
      enabled: true, now: () => T0, getVerifiedProfileAge: async () => ({ status: "OK", age: 16 }), traceSink: (t) => traces.push(t) });
  assert.equal(r.status, "ANSWERED");
  assert.doesNotMatch(r.answer, UNSAFE, r.answer); assert.match(r.answer, /Protein hỗ trợ sửa chữa mô cơ/); assert.match(r.answer, SUPERVISION);
  assert.deepEqual(w.calls, []); assert.ok(r.tools.every((t) => t.outcome !== "ok"), "the personal tool was not offered");
  assert.ok(r.guardActions.includes("minor_output_age:1") && r.guardActions.includes("minor_output_kcal:1"), r.guardActions.join());
  assert.equal(traces[0].ageGate?.status, "MINOR", "the model cannot change the verdict");
  // everything unsafe → the fixed general answer + the note (never MODEL_REFUSED, never the unsafe text)
  const p2 = mockProvider("nutrition"); p2.script(say("Bạn 25 tuổi nên cần 2400 kcal mỗi ngày."));
  const r2 = await runNutritionAgentTurn({ question: GENERAL_Q, context: { userId: USER_A } },
    { provider: p2, registry: createNutritionToolRegistry({ enabled: true, deps: w.nutrition, traceSink: () => {} }), policy: NUTRITION_AGENT_PILOT_POLICY,
      enabled: true, now: () => T0, getVerifiedProfileAge: async () => ({ status: "OK", age: 16 }), traceSink: () => {} });
  assert.equal(r2.status, "ANSWERED"); assert.ok(r2.answer.startsWith(GENERAL_ONLY_FALLBACK_VI)); assert.match(r2.answer, SUPERVISION);
});

test("MO-7 composition backstop: a runner NOT built on the bounded engine is filtered by the supervisor too", async () => {
  // the bounded engine already filters; to exercise the supervisor layer alone, the agent's text arrives unfiltered
  const { runSupervisorTurn } = await import("../agent-v2/supervisor");
  const { CAP } = await import("./m5-benchmark/harness");
  const traces: any[] = [];
  const rogue = { capability: CAP.nutrition, async run(req: any) {
    return { delegationId: req.delegationId, agentId: "nutrition", agentTurnId: null, completion: "COMPLETE", agentStatus: "ANSWERED",
      answer: "Vì bạn đã trưởng thành, mục tiêu của bạn là 1.500 kcal mỗi ngày. Protein hỗ trợ sửa chữa mô cơ.", facts: {}, guardActions: [], evidence: [],
      usage: { modelCalls: 1, toolCalls: 0, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.00001, latencyMs: 1 } };
  } };
  const r = await runSupervisorTurn({ question: "Protein là gì?", context: { userId: USER_A } },
    { runners: [rogue as any], profileReader: async () => ({ status: "PROFILE_OK", age: 16 }), enabled: true, now: () => T0, traceSink: (t) => traces.push(t) });
  assert.equal(traces[0].ageGate.decision, "GENERAL_ONLY");
  assert.doesNotMatch(r.answer, UNSAFE, r.answer); assert.match(r.answer, /Protein hỗ trợ sửa chữa mô cơ/); assert.match(r.answer, SUPERVISION);
  assert.deepEqual(traces[0].generalOnlyOutput, { minor_output_adult: 1 });
});

test("MO-8 privacy: traces carry rule codes and counts only — no removed text, age value or profile", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 16 } });
  s.prov.nutrition.script(say("Bạn 25 tuổi nên có thể theo mục tiêu 2400 kcal. Protein giúp cơ phục hồi sau tập."));
  s.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  await s.ask(USER_A, GENERAL_Q);
  const json = JSON.stringify({ t: s.traces, a: s.agentTraces });
  for (const bad of ["25 tuổi", "2400", "Bạn 25", '"age"', ":16,", "Bearer"]) assert.ok(!json.includes(bad), bad);
});

test("MO-9 not applied to a verified adult; AGE_UNKNOWN high-risk still fails closed; unverified general turn is filtered", async () => {
  const adult = system({ reader: { status: "PROFILE_OK", age: 30 } });
  adult.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const ar = await adult.ask(USER_A, "Mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(ar.status, "ANSWERED"); assert.match(ar.answer, /2400 kcal/); assert.doesNotMatch(ar.answer, SUPERVISION);
  assert.equal(adult.traces[0].generalOnlyOutput ?? null, null);
  const ag = system({ reader: { status: "PROFILE_OK", age: 30 } });
  ag.prov.nutrition.script(say("Với người trưởng thành như bạn, protein hỗ trợ sửa chữa mô cơ."));
  ag.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const agr = await ag.ask(USER_A, GENERAL_Q);
  assert.match(agr.answer, /người trưởng thành như bạn/, "adult general turn: no minor filtering");
  const unknown = system({ reader: { status: "AGE_UNKNOWN" } });
  const ur = await unknown.ask(USER_A, "Tôi muốn giảm 5 kg, tiến độ cân nặng của tôi thế nào?");
  assert.equal(ur.status, "PROFILE_UNVERIFIED"); assert.equal(unknown.modelRequests(), 0);
  const unv = system({ reader: { status: "PROFILE_ACCESS_DENIED" } });
  unv.prov.nutrition.script(say("Bạn cần 1500 kcal/ngày. Protein giúp cơ phục hồi sau tập."));
  unv.prov.recovery.script(say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const vr = await unv.ask(USER_A, GENERAL_Q);
  assert.equal(unv.traces[0].ageGate?.decision, "GENERAL_ONLY"); assert.doesNotMatch(vr.answer, /1500/); assert.deepEqual(unv.w.calls, []);
});

test("MO-10 flag OFF: DISABLED, nothing runs; no network / provider call in the whole file", async () => {
  const off = system({ reader: { status: "PROFILE_OK", age: 16 }, enabled: false });
  const r = await off.ask(USER_A, GENERAL_Q);
  assert.equal(r.status, "DISABLED"); assert.equal(off.modelRequests(), 0); assert.deepEqual(off.w.calls, []);
  assert.equal(blocked, 0);
});
