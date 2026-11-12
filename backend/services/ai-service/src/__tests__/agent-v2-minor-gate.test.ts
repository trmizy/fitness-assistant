/**
 * V2 Training Agent — Gate 1 (minor safety). Offline: scripted mock model, mocked V1 tools, injected profile-age reader,
 * no network. Checks that the age policy is decided BEFORE any model round / tool offer and that the model cannot change it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runTrainingAgentTurn, SYSTEM_PROMPT } from "../agent-v2/training-agent";
import { createTrainingToolRegistry, TRAINING_AGENT_PILOT_POLICY, type TrainingToolDeps } from "../agent-v2/training-tools";
import { decideMinorGate, NON_PERSONAL_TOOL_IDS, readVerifiedProfileAge, resolveAgeVerdict, type ProfileAgeRead } from "../agent-v2/minor-gate";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { AgentBlock, AgentModelProvider, AgentModelRequest, AgentModelResponse } from "../agent-v2/model-provider";
import { safetyGuard } from "../llm/safety_guard";

const ME = "11111111-1111-4111-8111-111111111111";
const CTX = { userId: ME, authorizationHeader: "Bearer t" };
const MINOR_MSG = (safetyGuard.minorAgeResult() as { messageVi: string }).messageVi;
const SUPERVISION = /Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên/;

function setup(profile: ProfileAgeRead | (() => Promise<ProfileAgeRead>), steps: AgentModelResponse[] = []) {
  const order: string[] = [];
  const domainCalls: string[] = [];
  const requests: AgentModelRequest[] = [];
  const deps = {
    getActiveCycle: async () => { domainCalls.push("getActiveCycle"); return { cycle: { id: "c", userId: ME, status: "ACTIVE", startDate: "2026-11-02", endDate: "2026-11-29", weekNumber: 2 }, summary: {} }; },
    getTodaySchedule: async () => { domainCalls.push("getTodaySchedule"); return [{ id: "s-1", userId: ME, scheduledDate: "2026-11-12", status: "SCHEDULED", title: "Upper", exercises: [{}] }]; },
    getUserFitnessContext: async () => { domainCalls.push("getUserFitnessContext"); return { profile: { goal: "MUSCLE_GAIN", days: [1, 3], injuries: [], equipment: [] } }; },
  } as unknown as TrainingToolDeps;
  const provider: AgentModelProvider = {
    modelId: "mock-model", supportsCancellation: false,
    async converse(r: AgentModelRequest) { order.push("model"); requests.push(structuredClone({ ...r, signal: undefined }) as unknown as AgentModelRequest); const s = steps.shift(); if (!s) throw new Error("no scripted step"); return s; },
  };
  const traces: TurnTrace[] = [];
  const reader = async () => { order.push("profile"); return typeof profile === "function" ? profile() : profile; };
  const run = (question: string, history?: Array<{ role: "user" | "assistant"; text: string }>) =>
    runTrainingAgentTurn({ question, context: CTX, history }, {
      provider, registry: createTrainingToolRegistry({ enabled: true, deps, traceSink: () => {} }), policy: TRAINING_AGENT_PILOT_POLICY,
      enabled: true, traceSink: (t) => traces.push(t), getVerifiedProfileAge: reader,
    });
  return { run, order, domainCalls, requests, traces };
}
const U = { inputTokens: 100, outputTokens: 20 };
const say = (text: string): AgentModelResponse => ({ stopReason: "end_turn", rawStopReason: "end_turn", content: [{ type: "text", text }], usage: U });
const use = (...b: AgentBlock[]): AgentModelResponse => ({ stopReason: "tool_use", rawStopReason: "tool_use", content: b, usage: U });
const offeredIds = (r: AgentModelRequest) => r.tools.map((t) => t.name.replace(/__/g, "."));
const OK = (age: number | null): ProfileAgeRead => ({ status: "OK", age });

test("G1-1 profile 16, user says 20 (personal advice) → minor reading wins: triage, no model call, no tool call", async () => {
  const s = setup(OK(16));
  const r = await s.run("Tôi 20 tuổi, mỗi tuần nên tập mấy buổi?");
  assert.equal(r.status, "MINOR_PROTECTED"); assert.equal(r.answer, MINOR_MSG);
  assert.equal(s.requests.length, 0); assert.deepEqual(s.domainCalls, []);
  assert.deepEqual(s.traces[0].ageGate, { status: "MINOR", minorBy: ["PROFILE"], conflict: true, profileRead: "OK", decision: "BLOCK" });
});

test("G1-2 profile 20, user says 15 → minor (this turn, or earlier in the conversation)", async () => {
  // stated in THIS turn: V1's question-only detector already blocks it; either way the minors' triage, never the model
  const a = setup(OK(20));
  const r1 = await a.run("Em 15 tuổi, mỗi tuần em nên tập mấy buổi?");
  assert.ok(["SAFETY_BLOCKED", "MINOR_PROTECTED"].includes(r1.status), r1.status);
  assert.match(r1.answer, /phụ huynh/); assert.equal(a.requests.length, 0); assert.deepEqual(a.domainCalls, []);
  assert.deepEqual(resolveAgeVerdict(OK(20), "Em 15 tuổi, mỗi tuần em nên tập mấy buổi?"), { status: "MINOR", minorBy: ["CURRENT_TURN"], conflict: true, profileRead: "OK" });
  // stated EARLIER in the conversation: only the gate can see it
  const b = setup(OK(20));
  const r2 = await b.run("Mỗi tuần em nên tập mấy buổi?", [{ role: "user", text: "Em 15 tuổi ạ." }, { role: "assistant", text: "Chào em." }]);
  assert.equal(r2.status, "MINOR_PROTECTED"); assert.equal(b.requests.length, 0);
  assert.deepEqual(b.traces[0].ageGate?.minorBy, ["HISTORY"]);
});

test("G1-3 no profile age → UNKNOWN: normal agent (V1 parity); a stated minor age still applies", async () => {
  const s = setup(OK(null), [say("Khoảng 3–4 buổi mỗi tuần là hợp lý cho người mới.")]);
  const r = await s.run("Tôi mới tập, mỗi tuần nên tập mấy buổi?");
  assert.equal(r.status, "ANSWERED"); assert.equal(s.traces[0].ageGate?.status, "UNKNOWN");
  assert.equal(offeredIds(s.requests[0]).length, TRAINING_AGENT_PILOT_POLICY.allowedTools.length);
  assert.doesNotMatch(r.answer, SUPERVISION);
  assert.equal(resolveAgeVerdict(OK(null), "Mình 16 tuổi, tập tạ có bị lùn không?").status, "MINOR");
});

test("G1-4 valid adult (profile 30) → normal agent: all READ tools, unchanged system prompt, no supervision line", async () => {
  const s = setup(OK(30), [use({ type: "toolUse", toolUseId: "a1", name: "training__get_today_schedule", input: {} }), say("Hôm nay bạn tập Upper.")]);
  const r = await s.run("Buổi hôm nay tôi cần tập gì?");
  assert.equal(r.status, "ANSWERED"); assert.equal(r.answer, "Hôm nay bạn tập Upper.");
  assert.equal(s.requests[0].system, SYSTEM_PROMPT);
  assert.equal(offeredIds(s.requests[0]).length, TRAINING_AGENT_PILOT_POLICY.allowedTools.length);
  assert.deepEqual(s.domainCalls, ["getTodaySchedule"]);
  assert.deepEqual(s.traces[0].ageGate, { status: "ADULT", minorBy: [], conflict: false, profileRead: "OK", decision: "PROCEED" });
});

test("G1-5 high-intensity plan request: minor → triage before anything; adult → not age-blocked", async () => {
  const q = "Tạo lịch tập 6 buổi cường độ cao cho tôi";
  const m = setup(OK(16));
  const r = await m.run(q);
  assert.equal(r.status, "MINOR_PROTECTED"); assert.equal(m.requests.length, 0); assert.deepEqual(m.domainCalls, []);
  const a = setup(OK(25));
  const r2 = await a.run(q);
  assert.notEqual(r2.status, "MINOR_PROTECTED"); assert.equal(r2.status, "CONFIRMATION_REQUIRED", "adult: plan changes go through the existing confirmation flow");
  for (const hi of ["Tập HIIT mỗi ngày được không?", "Mức tạ tối đa 1RM bench press của tôi nên là bao nhiêu?"]) {
    const x = setup(OK(17)); const rr = await x.run(hi);
    assert.equal(rr.status, "MINOR_PROTECTED", hi); assert.equal(x.requests.length, 0, hi);
  }
});

test("G1-6 minor + general training knowledge → answered generally: non-personal tools only, V1 minor note, supervision line", async () => {
  const s = setup(OK(16), [
    // the model tries a personal tool anyway → never offered, refused by the controller, no domain call
    use({ type: "toolUse", toolUseId: "g1", name: "training__get_today_schedule", input: {} }),
    say("Không. Tập sức mạnh có giám sát không làm chậm phát triển chiều cao."),
  ]);
  const r = await s.run("Tập tạ có làm chậm phát triển chiều cao không?");
  assert.equal(r.status, "ANSWERED");
  assert.match(r.answer, /^Không\. Tập sức mạnh/); assert.match(r.answer, SUPERVISION);
  const offered = offeredIds(s.requests[0]);
  assert.ok(offered.length > 0 && offered.every((id) => NON_PERSONAL_TOOL_IDS.has(id)), offered.join(","));
  assert.match(s.requests[0].system, /người dùng dưới 18 tuổi/);
  assert.deepEqual(r.tools, [{ toolId: "(unknown)", outcome: "TOOL_NOT_OFFERED" }]); assert.deepEqual(s.domainCalls, []);
  assert.equal(s.traces[0].ageGate?.decision, "GENERAL_ONLY");
});

test("G1-6b minor + a question about their OWN schedule (no dose words) is personal → triage, not a general answer", async () => {
  const s = setup(OK(16));
  const r = await s.run("Buổi hôm nay tôi cần tập gì?");
  assert.equal(r.status, "MINOR_PROTECTED"); assert.equal(s.requests.length, 0); assert.deepEqual(s.domainCalls, []);
});

test("G1-6c the model cannot change the age: an answer claiming the user is an adult still gets the supervision line", async () => {
  const s = setup(OK(15), [say("Vì bạn đã 20 tuổi nên cứ tập thoải mái. Khởi động kỹ trước khi tập.")]);
  const r = await s.run("Khởi động trước khi tập có cần thiết không?");
  assert.equal(r.status, "ANSWERED"); assert.match(r.answer, SUPERVISION);
  assert.equal(s.traces[0].ageGate?.status, "MINOR");
});

test("G1-7 conflicting ages → conservative (any source < 18 wins), conflict flagged", async () => {
  const a = setup(OK(17));
  const r = await a.run("Mỗi tuần tôi nên tập mấy buổi?", [{ role: "user", text: "Tôi 25 tuổi." }]);
  assert.equal(r.status, "MINOR_PROTECTED"); assert.equal(a.traces[0].ageGate?.conflict, true);
  const b = setup(OK(25));
  const r2 = await b.run("Tôi 25 tuổi, mỗi tuần nên tập mấy buổi?", [{ role: "user", text: "Tôi 16 tuổi." }]);
  assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(b.traces[0].ageGate?.minorBy, ["HISTORY"]); assert.equal(b.requests.length, 0);
  // a NEGATED age is not a claim; assistant text is never an age source
  assert.equal(resolveAgeVerdict(OK(30), "Tôi không phải 16 tuổi đâu, mỗi tuần nên tập mấy buổi?").status, "ADULT");
  assert.equal(resolveAgeVerdict(OK(30), "Mỗi tuần nên tập mấy buổi?", []).status, "ADULT");
});

test("G1-8 profile cannot be read (no permission / outage / reader throws) → UNVERIFIED: personal refused, general allowed without personal tools", async () => {
  for (const failing of [{ status: "FAILED", reason: "http_403" } as ProfileAgeRead, () => Promise.reject(new Error("boom")), () => Promise.resolve({ weird: 1 } as any)]) {
    const p = setup(failing);
    const r = await p.run("Buổi hôm nay tôi cần tập gì?");
    assert.equal(r.status, "PROFILE_UNVERIFIED"); assert.equal(p.requests.length, 0); assert.deepEqual(p.domainCalls, []);
    assert.equal(p.traces[0].ageGate?.profileRead, "FAILED");
  }
  const g = setup({ status: "FAILED", reason: "http_403" }, [say("Khởi động 5–10 phút giúp giảm nguy cơ chấn thương.")]);
  const r = await g.run("Khởi động trước khi tập có cần thiết không?");
  assert.equal(r.status, "ANSWERED"); assert.doesNotMatch(r.answer, SUPERVISION);
  assert.ok(offeredIds(g.requests[0]).every((id) => NON_PERSONAL_TOOL_IDS.has(id)));
  assert.equal(g.requests[0].system, SYSTEM_PROMPT);
  // a stated minor age is still honoured when the profile is unreadable
  assert.equal(resolveAgeVerdict({ status: "FAILED", reason: "x" }, "Em 16 tuổi").status, "MINOR");
  // the default reader never calls out without the user's own credentials
  assert.deepEqual(await readVerifiedProfileAge({ userId: ME }), { status: "FAILED", reason: "no_credentials" });
});

test("G1-9 the gate runs before the first model round, and the trace never carries the age value", async () => {
  const s = setup(OK(16), [say("Khởi động giúp cơ thể sẵn sàng.")]);
  await s.run("Khởi động trước khi tập có cần thiết không?");
  assert.deepEqual(s.order, ["profile", "model"]);
  const g = s.traces[0].ageGate!;
  assert.deepEqual(Object.keys(g).sort(), ["conflict", "decision", "minorBy", "profileRead", "status"]);
  assert.ok(Object.values(g).every((v) => typeof v !== "number"));
  // the profile is not read for turns that end before the gate (flag off / unauthenticated / input safety)
  const u = setup(OK(16));
  await u.run("Tôi muốn giảm 10kg trong 1 tuần thì tập thế nào?");
  assert.deepEqual(u.order, []); assert.equal(u.traces[0].ageGate, null);
});

test("G1-10 decideMinorGate: the decision table", () => {
  const v = (status: any) => ({ status, minorBy: [], conflict: false, profileRead: "OK" as const });
  assert.equal(decideMinorGate(v("MINOR"), "GENERAL_KNOWLEDGE", false).action, "GENERAL_ONLY");
  for (const c of ["PERSONAL_ADVICE", "PLAN_REQUEST", "HIGH_RISK"] as const) assert.equal(decideMinorGate(v("MINOR"), c, false).action, "BLOCK");
  assert.equal(decideMinorGate(v("MINOR"), "GENERAL_KNOWLEDGE", true).action, "BLOCK");
  assert.deepEqual(decideMinorGate(v("UNVERIFIED"), "GENERAL_KNOWLEDGE", false), { action: "GENERAL_ONLY", addMinorNote: false });
  assert.equal(decideMinorGate(v("UNVERIFIED"), "PERSONAL_ADVICE", false).action, "BLOCK");
  for (const st of ["ADULT", "UNKNOWN"]) for (const c of ["GENERAL_KNOWLEDGE", "PERSONAL_ADVICE", "PLAN_REQUEST", "HIGH_RISK"] as const) assert.equal(decideMinorGate(v(st), c, true).action, "PROCEED");
});
