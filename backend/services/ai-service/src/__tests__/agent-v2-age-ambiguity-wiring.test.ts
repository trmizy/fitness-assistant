/**
 * M7-P5A.2.3 — AMBIGUOUS self-reported age, wired through the REAL supervisor (lead-owned integration test).
 *
 * "Chào anh em mười lăm tuổi" could be a minor, an adult greeting a group, or a quote. The contract while it is unresolved:
 *   - NO persisted minor restriction (and nothing else persisted), NO assumption of adulthood;
 *   - NO routing-model call, NO personalised recommendation, NO personal tool read, NO agent for a personal / HIGH_RISK ask;
 *   - safe GENERAL-only answers stay available; the user is told what is missing (accurate text, not "your profile has no age");
 *   - a known minor (explicit statement / profile / session) stays MINOR — ambiguity never downgrades or clears it.
 * Deterministic AND hybrid (always) mode, mocked providers, no network. Evidence label: BACKEND INTEGRATION (real supervisor + real
 * hybrid provider + real minor-gate; mocked models / domain deps). Not a REAL HTTP / BROWSER run — see agent-v2-age-ambiguity-http.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bedrockRuntimeDeps } from "../services/bedrock.client";
import { createHybridDecisionProvider } from "../agent-v2/hybrid-router";
import type { ProfileReadResult } from "../agent-v2/multi-agent-contracts";
import { system, mockProvider, say, use, call, USER_A } from "./m5-benchmark/harness";

let netCalls = 0;
const saved = { send: bedrockRuntimeDeps.send, fetch: globalThis.fetch };
test.before(() => {
  bedrockRuntimeDeps.send = (async () => { netCalls++; throw new Error("blocked"); }) as typeof bedrockRuntimeDeps.send;
  globalThis.fetch = (async () => { netCalls++; throw new Error("blocked"); }) as typeof fetch;
});
test.after(() => { bedrockRuntimeDeps.send = saved.send; globalThis.fetch = saved.fetch; });

const ADULT: ProfileReadResult = { status: "PROFILE_OK", age: 30 };
const MINOR: ProfileReadResult = { status: "PROFILE_OK", age: 16 };
const AMBIGUOUS_PREFIX = "Mình chưa chắc câu bạn vừa viết đang nói về tuổi của chính bạn";
const AGE_REQUIRED_PREFIX = "Hồ sơ của bạn chưa có tuổi";
const UNSAFE_PREFIX = "Mình không thể đưa ra kế hoạch hay con số cá nhân";

type Mode = "deterministic" | "hybrid";
function rig(reader: ProfileReadResult, mode: Mode, routerAgents: string[] = ["nutrition"]) {
  const router = mockProvider("router");
  const deps = mode === "hybrid" ? { decisionProvider: createHybridDecisionProvider({ model: router, maxAgents: 2, mode: "always" }) } : {};
  const s = system({ reader, deps });
  const ask = async (q: string, answer = "Câu trả lời chung.", tryPersonal = true) => {
    router.script(say(JSON.stringify({ agentIds: routerAgents })));
    // with tryPersonal every agent first TRIES a personal read, then answers — a personalised run would show up in s.w.calls
    const step = (tool: string) => (tryPersonal ? [use(call(tool)), say(answer)] : [say(answer)]);
    s.prov.nutrition.script(...step("nutrition.get_target"));
    s.prov.training.script(...step("training.get_today_schedule"));
    s.prov.recovery.script(...step("recovery.get_recent_sessions"));
    s.prov.progress.script(...step("progress.get_body_measurements"));
    const personal0 = s.w.calls.filter((c) => !c.startsWith("WRITE:")).length, agent0 = s.modelRequests(), router0 = router.requests.length;
    const r = await s.ask(USER_A, q);
    const tr = s.traces[s.traces.length - 1];
    const out = { r, tr, agentCalls: s.modelRequests() - agent0, routerCalls: router.requests.length - router0, personalReads: s.w.calls.filter((c) => !c.startsWith("WRITE:")).length - personal0 };
    for (const p of Object.values(s.prov)) p.drain();
    router.drain();
    return out;
  };
  return { s, ask, router };
}

const PERSONAL_DOSE = "Chào anh em mười lăm tuổi, tôi uống mấy muỗng whey mỗi ngày?";
// V1 rates a supplement question HIGH_RISK even when educational (so an unverified user is told to clarify); a plain exercise-knowledge question is GENERAL_KNOWLEDGE
const GENERAL = "Chào anh em mười lăm tuổi, squat là bài tập gì?";
const AGGRESSIVE_UNROUTED = "Chào anh em mười lăm tuổi, giảm 5 kg trong 2 tuần thế nào?";

for (const mode of ["deterministic", "hybrid"] as const) {
  test(`AW-${mode}-1 ambiguous age + a personalised dose: blocked with the ACCURATE text — no agent, no routing model, no personal read, nothing persisted`, async () => {
    const t = rig(ADULT, mode, ["nutrition"]);
    const o = await t.ask(PERSONAL_DOSE);
    assert.equal(o.r.status, "PROFILE_UNVERIFIED"); assert.ok(o.r.answer.startsWith(AMBIGUOUS_PREFIX), o.r.answer);
    assert.ok(!o.r.answer.startsWith(AGE_REQUIRED_PREFIX), "not the 'profile has no age' text");
    assert.equal(o.tr.ageGate?.decision, "BLOCK_AGE_AMBIGUOUS"); assert.equal(o.tr.ageGate?.status, "ADULT", "the profile status is reported, adulthood is not assumed from it");
    assert.deepEqual(o.tr.ageGate?.minorBy, []);
    assert.equal(o.agentCalls, 0); assert.equal(o.routerCalls, 0, "an ambiguous age is never eligible for the routing model"); assert.equal(o.personalReads, 0);
    assert.deepEqual(o.r.executedAgents, []);
  });

  test(`AW-${mode}-2 ambiguous age + a GENERAL question: answered in general-only mode (no personal tool read, no routing-model call)`, async () => {
    const t = rig(ADULT, mode, ["training"]);
    const o = await t.ask(GENERAL, "Squat là bài tập gập gối và hông.", false);
    assert.equal(o.r.status, "ANSWERED"); assert.equal(o.tr.ageGate?.decision, "GENERAL_ONLY");
    assert.match(o.r.answer, /Squat là bài tập/);
    assert.equal(o.routerCalls, 0); assert.equal(o.personalReads, 0);
    // an agent that TRIES a personal read in this state is refused by the tool policy — it never reaches the domain
    const p = await rig(ADULT, mode, ["training"]).ask(GENERAL, "x", true);
    assert.equal(p.personalReads, 0, "general-only: the personal tool attempt never reaches the domain"); assert.notEqual(p.r.status, "PARTIAL");
  });

  test(`AW-${mode}-3 ambiguous age + an UNROUTED aggressive ask ("Giảm 5 kg trong 2 tuần…"): clarification, never the adult fixed text, never an agent`, async () => {
    const t = rig(ADULT, mode, []);
    const o = await t.ask(AGGRESSIVE_UNROUTED);
    assert.equal(o.r.status, "PROFILE_UNVERIFIED"); assert.ok(o.r.answer.startsWith(AMBIGUOUS_PREFIX), o.r.answer);
    assert.ok(!o.r.answer.startsWith(UNSAFE_PREFIX)); assert.equal(o.tr.ageGate?.decision, "BLOCK_AGE_AMBIGUOUS");
    assert.equal(o.agentCalls, 0); assert.equal(o.routerCalls, 0); assert.equal(o.personalReads, 0); assert.deepEqual(o.r.executedAgents, []);
  });

  test(`AW-${mode}-4 unknown profile age + ambiguous sentence: still blocked for personal asks, still no routing model`, async () => {
    const t = rig({ status: "AGE_UNKNOWN" }, mode, ["nutrition"]);
    const o = await t.ask(PERSONAL_DOSE);
    assert.equal(o.r.status, "PROFILE_UNVERIFIED"); assert.equal(o.agentCalls, 0); assert.equal(o.routerCalls, 0); assert.equal(o.personalReads, 0);
  });

  test(`AW-${mode}-5 an explicit / known minor is NEVER downgraded by ambiguity: profile minor + an ambiguous sentence → MINOR_PROTECTED`, async () => {
    const t = rig(MINOR, mode, ["nutrition"]);
    const o = await t.ask(PERSONAL_DOSE);
    assert.equal(o.r.status, "MINOR_PROTECTED"); assert.equal(o.tr.ageGate?.status, "MINOR");
    assert.equal(o.agentCalls, 0); assert.equal(o.routerCalls, 0); assert.equal(o.personalReads, 0);
  });

  test(`AW-${mode}-6 explicit first-person minor ("Em mười lăm tuổi…") is MINOR (persisted); the ambiguous twin is not`, async () => {
    const e = rig(ADULT, mode, ["nutrition"]);
    const o1 = await e.ask("Em mười lăm tuổi, em uống mấy muỗng whey mỗi ngày?");
    assert.notEqual(o1.r.status, "ANSWERED"); assert.equal(o1.agentCalls, 0); assert.equal(o1.routerCalls, 0);
    const a = rig(ADULT, mode, ["nutrition"]);
    const o2 = await a.ask(PERSONAL_DOSE);
    assert.equal(o2.tr.ageGate?.status, "ADULT", "ambiguity is not a minor reading");
  });

  test(`AW-${mode}-7 third-party age ("Con tôi mười lăm tuổi…") does not restrict, does not make the turn ambiguous`, async () => {
    const t = rig(ADULT, mode, ["training"]);
    const o = await t.ask("Con tôi mười lăm tuổi, hôm nay tôi nên tập gì?", "Hôm nay bạn nên tập nhẹ.");
    assert.equal(o.tr.ageGate?.status, "ADULT"); assert.notEqual(o.tr.ageGate?.decision, "BLOCK_AGE_AMBIGUOUS");
    assert.notEqual(o.r.status, "MINOR_PROTECTED");
  });

  test(`AW-${mode}-8 ambiguity is not persisted: the next turn (no mention) is a normal verified-adult turn`, async () => {
    const t = rig(ADULT, mode, ["nutrition"]);
    await t.ask(PERSONAL_DOSE);
    const o = await t.ask("Whey protein là gì?", "Whey là protein từ sữa.");
    assert.equal(o.r.status, "ANSWERED"); assert.equal(o.tr.ageGate?.status, "ADULT"); assert.deepEqual(o.tr.ageGate?.minorBy, []);
    if (mode === "hybrid") assert.equal(o.routerCalls, 1, "a verified adult with no ambiguity is eligible again");
  });

  test(`AW-${mode}-9 the same ambiguous sentence replayed by the CLIENT as history keeps the turn unresolved (personal ask blocked)`, async () => {
    const t = rig(ADULT, mode, ["nutrition"]);
    t.router.script(say(JSON.stringify({ agentIds: ["nutrition"] })));
    t.s.prov.nutrition.script(say("x"));
    const r = await t.s.ask(USER_A, "Tôi uống mấy muỗng whey mỗi ngày?", { history: [{ role: "user", text: "Chào anh em mười lăm tuổi" }] } as never);
    for (const p of Object.values(t.s.prov)) p.drain();
    t.router.drain();
    assert.equal(r.status, "PROFILE_UNVERIFIED"); assert.ok(r.answer.startsWith(AMBIGUOUS_PREFIX), r.answer); assert.equal(t.router.requests.length, 0);
  });
}

test("AW-10 zero real network / provider calls", () => { assert.equal(netCalls, 0); });
