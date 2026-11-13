/**
 * V2 M7-P5A.2 privacy controls — A: contact-identifier redaction of the routing-model request; B (provider side): the routing
 * model is called only when the supervisor-supplied clearance says VERIFIED adult. OFFLINE: the routing model is a counting mock
 * AgentModelProvider (no network, no AWS, no real model). Redaction is best-effort minimization — the BYPASSES test documents
 * what it does NOT catch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { redactForRouting, REDACTION_MAX_INPUT_CHARS } from "../agent-v2/routing-redaction";
import { createHybridDecisionProvider, buildRoutingRequest, sanitizeHybridMeta, ROUTING_MODEL_LIMITS, type HybridRoutingMeta } from "../agent-v2/hybrid-router";
import { SUPERVISOR_BUDGET } from "../agent-v2/supervisor";
import { foldVi } from "../llm/speech_act";
import type { AgentModelProvider, AgentModelRequest, AgentModelResponse } from "../agent-v2/model-provider";
import type { AgentId, DecisionInput, RoutingModelClearance } from "../agent-v2/multi-agent-contracts";

const red = (q: string) => { const r = redactForRouting(q); assert.equal(r.ok, true, `ok for ${q}`); return r.ok ? r : (null as never); };

// ── A. redaction: contact identifiers ────────────────────────────────────────────────────────────────────────────────
test("RR-1 emails (incl. adjacent punctuation) become [EMAIL]; trailing dot stays outside", () => {
  const cases: Array<[string, string]> = [
    ["mail tôi: a.b+c@mail.example.vn nhé", "mail tôi: [EMAIL] nhé"],
    ["(a.b+c@mail.example.vn), tập gì?", "([EMAIL]), tập gì?"],
    ["gửi tới <john_doe-1@sub.domain.co.uk>.", "gửi tới <[EMAIL]>."],
    ["liên hệ nam@gmail.com.", "liên hệ [EMAIL]."],
    ["\"x@y.io\"; 'z@w.vn'", "\"[EMAIL]\"; '[EMAIL]'"],
  ];
  for (const [i, o] of cases) assert.equal(red(i).text, o, i);
  assert.equal(red("a@b.com và c@d.vn").counts.email, 2);
});

test("RR-2 phones: Vietnamese + international forms become [PHONE]", () => {
  const phones = ["0912345678", "0912 345 678", "091.234.5678", "091-234-5678", "+84 912 345 678", "+84912345678", "(+84) 912-345-678", "84 912 345 678", "84912345678",
    "028 3822 1234", "(028) 3822 1234", "02838221234", "+1 415 555 2671", "+14155552671", "+44 20 7946 0958", "+33 6 12 34 56 78", "(415) 555-2671", "415-555-2671", "415 555 2671", "912 345 678", "09 12 34 56 78"];
  for (const p of phones) {
    const r = red(`gọi cho tôi số ${p} nhé`);
    assert.equal(r.text, "gọi cho tôi số [PHONE] nhé", `phone form: ${p}`);
    assert.deepEqual(r.counts, { email: 0, phone: 1 });
  }
  assert.equal(red("sđt:0912345678.").text, "sđt:[PHONE].");
  assert.equal(red("sdt0912345678").text, "sdt[PHONE]");
});

test("RR-3 a phone followed by an intent number does not swallow it", () => {
  assert.equal(red("0912 345 678 60 phút tập gì").text, "[PHONE] 60 phút tập gì");
  assert.equal(red("+1 415 555 2671 60 phút").text, "[PHONE] 60 phút");
  assert.equal(red("0912345678, 2400 kcal").text, "[PHONE], 2400 kcal");
});

test("RR-4 intent numbers are preserved byte-for-byte", () => {
  const preserved = ["2400 kcal", "5 kg", "0.5 kg", "4 hiệp", "12 reps", "8-12 reps", "3x10", "1RM 100kg", "80-90%", "13/11/2026", "18:30", "2026", "60 phút", "1500 calo", "120/80",
    // extra look-alikes: ranges / dates / ramps that contain 9+ digits across separators
    "5000-10000 bước", "1800-2000-2200 kcal", "100-120-140 kg", "03.11.2026 18:30", "08-12-2026 18", "2026-11-13", "0600-0800", "0.25-0.5-0.75 kg", "10 12 15 18 20 reps", "70 72 75 78 80 kg",
    "1500 2000 2500 kcal", "3 hiệp x 12 reps, nghỉ 90 giây", "tăng 2.5kg mỗi tuần", "BMI 22.5, mỡ 18.5%", "+5 kg", "+10 12 15"];
  for (const p of preserved) assert.equal(red(p).text, p, `must be untouched: ${p}`);
  const sentence = "Tôi 72 kg, mục tiêu 2400 kcal, 5 kg trong 12 tuần, 4 hiệp 8-12 reps, 1RM 100kg, ăn 80-90% protein, ngày 13/11/2026 lúc 18:30, 60 phút, huyết áp 120/80, 1500 calo";
  assert.equal(red(sentence).text, sentence);
  assert.deepEqual(red(sentence).counts, { email: 0, phone: 0 });
});

test("RR-5 multiple identifiers + mixed text", () => {
  const r = red("Email a@b.vn, số 0912 345 678 hoặc +84 988 111 222; cũng c.d@e.com — 2400 kcal, 8-12 reps");
  assert.equal(r.text, "Email [EMAIL], số [PHONE] hoặc [PHONE]; cũng [EMAIL] — 2400 kcal, 8-12 reps");
  assert.deepEqual(r.counts, { email: 2, phone: 2 });
});

test("RR-6 invalid input -> ok:false (never passed on)", () => {
  for (const bad of [undefined, null, 5, {}, [], ["a@b.com"], true]) assert.deepEqual(redactForRouting(bad), { ok: false, reason: "INVALID_INPUT" });
  assert.deepEqual(redactForRouting("x".repeat(REDACTION_MAX_INPUT_CHARS + 1)), { ok: false, reason: "INVALID_INPUT" });
  assert.equal(redactForRouting("x".repeat(REDACTION_MAX_INPUT_CHARS)).ok, true);
  assert.equal(redactForRouting("").ok, true);
});

test("RR-7 deterministic, pure, and linear on adversarial input", () => {
  const q = "a@b.com 0912 345 678 " + "1 ".repeat(500) + "9".repeat(900);
  assert.deepEqual(redactForRouting(q), redactForRouting(q));
  const t0 = Date.now();
  redactForRouting("a".repeat(1990) + "@x");
  redactForRouting("0-".repeat(1000));
  redactForRouting(("(+8" + "4 ").repeat(600));
  assert.ok(Date.now() - t0 < 500, "no catastrophic backtracking");
});

// ── buildRoutingRequest: redact BEFORE truncating to 600 ────────────────────────────────────────────────────────────
const userJson = (req: AgentModelRequest) => JSON.parse(req.messages[0].content.map((b) => (b.type === "text" ? b.text : "")).join("")) as { availableAgents: string[]; recentDomains: string[]; question: string };
const build = (q: string) => buildRoutingRequest(q, ["training", "nutrition"], [], 40, new AbortController().signal);
const AT_ADDRESS = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+\.[A-Za-z]{2,}/;
const LONG_DIGITS = /\d(?:[ .\-)(]?\d){8,}/; // 9+ digits with optional single separators

test("RR-8 an identifier straddling char 600 is fully redacted; no fragment survives truncation", () => {
  const filler = (n: number) => "tập ngực ".repeat(Math.ceil(n / 9)).slice(0, n);
  const email = "nguyen.van.anh+gym@example-mail.vn";
  const phone = "0912 345 678";
  for (const [id, frag] of [[email, "nguyen.van"], [email, "anh+gym@"], [email, "example-mail"], [phone, "09123"], [phone, "0912 3"], [phone, "345 678"]] as const) {
    for (const cut of [-8, -3, 0, 3, 8]) {
      const prefix = filler(600 - Math.floor(id.length / 2) + cut);
      const q = prefix + " " + id + " " + filler(200);
      const r = userJson(build(q));
      assert.ok(!r.question.includes(frag), `fragment "${frag}" leaked at cut ${cut}`);
      assert.ok(!AT_ADDRESS.test(r.question) && !LONG_DIGITS.test(r.question));
      assert.ok(r.question.length <= ROUTING_MODEL_LIMITS.maxQuestionChars);
    }
  }
  // the identifier sits fully BEFORE the cut after redaction (the placeholder is shorter) and stays redacted
  const q2 = filler(590) + " 0912 345 678 " + filler(100);
  assert.ok(userJson(build(q2)).question.includes("[PHONE]"));
});

test("RR-9 the built request never contains an @-address or a 9+ digit phone run for a corpus", () => {
  const corpus = [
    "Mail me at a.b+c@mail.example.vn, 0912345678 — tập gì?", "sdt +84 912 345 678 / (028) 3822 1234 ăn gì", "x@y.co 0912.345.678 +1 415 555 2671 (415) 555-2671",
    "nam@gmail.com".repeat(40), "0912 345 678 ".repeat(40), "contact: (+84) 912-345-678, 84912345678, +84912345678, 02838221234",
    "ngủ ít, mỏi cơ; liên hệ 0988111222 hoặc t_r@a-b.org.vn.", "u1@a.vn u2@b.vn u3@c.vn 0911111111 0922222222 0933333333",
  ];
  for (const q of corpus) {
    const req = build(q);
    const all = JSON.stringify(req);
    assert.ok(!AT_ADDRESS.test(all.replace(/\\"/g, '"')) && !LONG_DIGITS.test(userJson(req).question), `leak in: ${q.slice(0, 40)}`);
    assert.deepEqual(Object.keys(userJson(req)).sort(), ["availableAgents", "question", "recentDomains"]);
  }
});

test("RR-10 buildRoutingRequest throws on non-string / over-long input (no request is built)", () => {
  assert.throws(() => build(5 as unknown as string), /could not be redacted/);
  assert.throws(() => build("x".repeat(2001)), /could not be redacted/);
});

// ── decide(): control A + B with a counting mock model ──────────────────────────────────────────────────────────────
const ok = (agentIds: string[]): AgentModelResponse => ({ stopReason: "end_turn", rawStopReason: "end_turn", content: [{ type: "text", text: JSON.stringify({ agentIds }) }], usage: { inputTokens: 300, outputTokens: 10 } });
function counting(resp: AgentModelResponse = ok(["training"])) {
  const requests: AgentModelRequest[] = [];
  const model: AgentModelProvider = { modelId: "mock-router", supportsCancellation: false, async converse(r) { requests.push(structuredClone({ ...r, signal: undefined }) as unknown as AgentModelRequest); return resp; } };
  return { model, requests };
}
const eligible = async (): Promise<RoutingModelClearance> => ({ eligible: true, reason: "VERIFIED_ADULT" });
const input = (q: string, o: Partial<DecisionInput> = {}): DecisionInput => ({
  question: q, folded: foldVi(q), available: ["training", "nutrition", "recovery", "progress"] as AgentId[], budget: { ...SUPERVISOR_BUDGET }, routingModelClearance: eligible, ...o,
});
const metaOf = (d: { hybrid?: HybridRoutingMeta }) => d.hybrid as HybridRoutingMeta;
const Q = "Tập ngực thế nào cho đúng, và ăn bao nhiêu protein?";

for (const mode of ["selective", "always"] as const) {
  test(`RR-11 [${mode}] eligible -> exactly one call; user message keys are exactly availableAgents/recentDomains/question; question redacted`, async () => {
    const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode });
    const q = "Tập ngực thế nào, mail a.b@c.vn, số 0912 345 678, và ăn bao nhiêu protein?";
    const d = await p.decide(input(q));
    assert.equal(m.requests.length, 1); assert.equal(p.modelCalls(), 1);
    const u = userJson(m.requests[0]);
    assert.deepEqual(Object.keys(u), ["availableAgents", "recentDomains", "question"]);
    assert.equal(u.question, "Tập ngực thế nào, mail [EMAIL], số [PHONE], và ăn bao nhiêu protein?");
    assert.ok(!JSON.stringify(m.requests[0]).includes("a.b@c.vn") && !JSON.stringify(m.requests[0]).includes("345"));
    const h = metaOf(d);
    assert.equal(h.routingModelCalled, true); assert.equal(h.routingClearance, "VERIFIED_ADULT"); assert.deepEqual(h.redactions, { email: 1, phone: 1 });
    assert.equal(h.selection, "MODEL_ASSISTED");
    // the deterministic plan used the ORIGINAL question (redaction applies to the model request only)
    assert.ok(h.deterministicAgentIds.length > 0);
  });

  test(`RR-12 [${mode}] a question that cannot be redacted -> REDACTION_FAILED, NO model call, no clearance consulted`, async () => {
    const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode });
    let cleared = 0;
    const clearance = async () => { cleared++; return { eligible: true, reason: "VERIFIED_ADULT" } as RoutingModelClearance; };
    const long = "toi nen tap nguc the nao va an gi de tang co? " + "x".repeat(2000);
    const d1 = await p.decide(input(long, { routingModelClearance: clearance }));
    const d2 = await p.decide(input("toi nen tap gi va an gi? " + "y".repeat(REDACTION_MAX_INPUT_CHARS + 1), { routingModelClearance: clearance }));
    assert.equal(m.requests.length, 0); assert.equal(p.modelCalls(), 0); assert.equal(cleared, 0);
    assert.equal(metaOf(d1).fallbackReasonCode, "REDACTION_FAILED"); assert.equal(metaOf(d1).routingModelCalled, false); assert.equal(metaOf(d1).routingClearance, "NOT_REQUESTED");
    assert.equal(metaOf(d2).fallbackReasonCode, "REDACTION_FAILED");
    assert.ok(["DETERMINISTIC_FALLBACK", "UNDETERMINED"].includes(metaOf(d1).selection));
  });

  test(`RR-13 [${mode}] clearance absent -> NO_CLEARANCE_CONTEXT, no call, MODEL_ROUTING_NOT_ELIGIBLE`, async () => {
    const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode });
    const d = await p.decide(input(Q, { routingModelClearance: undefined }));
    assert.equal(m.requests.length, 0);
    const h = metaOf(d);
    assert.equal(h.routingClearance, "NO_CLEARANCE_CONTEXT"); assert.equal(h.fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE"); assert.equal(h.routingModelCalled, false); assert.equal(h.routingValidationStatus, "NOT_CALLED");
    assert.equal(d.usage?.modelCalls, 0);
  });

  test(`RR-14 [${mode}] clearance not eligible (each reason) -> no call; the reason is recorded`, async () => {
    for (const reason of ["MINOR_RESTRICTION", "AGE_UNKNOWN", "PROFILE_UNVERIFIED", "SESSION_UNAVAILABLE"] as const) {
      const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode });
      const d = await p.decide(input(Q, { routingModelClearance: async () => ({ eligible: false, reason }) }));
      assert.equal(m.requests.length, 0, reason);
      assert.equal(metaOf(d).routingClearance, reason); assert.equal(metaOf(d).fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE"); assert.equal(metaOf(d).routingModelCalled, false);
    }
  });

  test(`RR-15 [${mode}] clearance throws / rejects / returns garbage / contradicts -> CLEARANCE_ERROR, no call`, async () => {
    const variants: Array<() => Promise<unknown>> = [
      async () => { throw new Error("profile read exploded"); },
      () => Promise.reject(new Error("nope")),
      async () => null, async () => "yes", async () => ({ eligible: true, reason: "AGE_UNKNOWN" }), async () => ({ eligible: true }), async () => ({ eligible: "true", reason: "VERIFIED_ADULT" }),
    ];
    for (const v of variants) {
      const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode });
      const d = await p.decide(input(Q, { routingModelClearance: v as () => Promise<RoutingModelClearance> }));
      assert.equal(m.requests.length, 0);
      assert.equal(metaOf(d).routingClearance, "CLEARANCE_ERROR"); assert.equal(metaOf(d).fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE");
    }
  });
}

test("RR-16 clearance is consulted AFTER the budget checks: a budget failure never touches it (NOT_REQUESTED)", async () => {
  const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode: "always" });
  let cleared = 0;
  const d = await p.decide(input(Q, { budget: undefined, routingModelClearance: async () => { cleared++; return { eligible: true, reason: "VERIFIED_ADULT" }; } }));
  assert.equal(cleared, 0); assert.equal(m.requests.length, 0);
  assert.equal(metaOf(d).fallbackReasonCode, "NO_BUDGET_CONTEXT"); assert.equal(metaOf(d).routingClearance, "NOT_REQUESTED");
  // selective + no risk signal: deterministic is kept without any clearance read
  const p2 = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode: "selective" });
  const d2 = await p2.decide(input("Tôi nên ăn bao nhiêu calo mỗi ngày?", { routingModelClearance: async () => { cleared++; return { eligible: true, reason: "VERIFIED_ADULT" }; } }));
  assert.equal(m.requests.length, 0); assert.equal(metaOf(d2).routingClearance, "NOT_REQUESTED");
  assert.equal(cleared, 0);
});

test("RR-17 not-eligible follows the existing fallback table (ROUTING_UNDETERMINED when the deterministic plan is unsafe)", async () => {
  const m = counting(); const p = createHybridDecisionProvider({ model: m.model, maxAgents: 2, mode: "always" });
  // an ambiguous multi-domain high-risk ask: fallbackAllowed is false -> UNDETERMINED, no agents
  const q = "Tôi muốn giảm 10kg trong 2 tuần, ăn kiêng cực đoan và tập tối đa, uống thuốc giảm cân";
  const d = await p.decide(input(q, { routingModelClearance: async () => ({ eligible: false, reason: "MINOR_RESTRICTION" }) }));
  assert.equal(m.requests.length, 0);
  assert.equal(metaOf(d).fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE");
  assert.ok(["DETERMINISTIC_FALLBACK", "UNDETERMINED"].includes(metaOf(d).selection));
  if (metaOf(d).selection === "UNDETERMINED") assert.deepEqual(d.agents, []);
});

test("RR-18 sanitizeHybridMeta: strict allowlists for the new fields", () => {
  const base = sanitizeHybridMeta({});
  assert.ok(base); assert.equal(base.routingClearance, "NOT_REQUESTED"); assert.deepEqual(base.redactions, { email: 0, phone: 0 });
  for (const c of ["VERIFIED_ADULT", "MINOR_RESTRICTION", "AGE_UNKNOWN", "PROFILE_UNVERIFIED", "SESSION_UNAVAILABLE", "NOT_REQUESTED", "NO_CLEARANCE_CONTEXT", "CLEARANCE_ERROR"])
    assert.equal(sanitizeHybridMeta({ routingClearance: c })?.routingClearance, c);
  assert.equal(sanitizeHybridMeta({ routingClearance: "a@b.com" })?.routingClearance, "NOT_REQUESTED");
  assert.equal(sanitizeHybridMeta({ routingClearance: { x: 1 } })?.routingClearance, "NOT_REQUESTED");
  assert.equal(sanitizeHybridMeta({ fallbackReasonCode: "MODEL_ROUTING_NOT_ELIGIBLE" })?.fallbackReasonCode, "MODEL_ROUTING_NOT_ELIGIBLE");
  assert.equal(sanitizeHybridMeta({ fallbackReasonCode: "REDACTION_FAILED" })?.fallbackReasonCode, "REDACTION_FAILED");
  assert.equal(sanitizeHybridMeta({ fallbackReasonCode: "0912345678" })?.fallbackReasonCode, "NONE");
  assert.deepEqual(sanitizeHybridMeta({ redactions: { email: 2.9, phone: -1, text: "a@b.com" } })?.redactions, { email: 2, phone: 0 });
  assert.deepEqual(sanitizeHybridMeta({ redactions: { email: "3", phone: 1e9 } })?.redactions, { email: 0, phone: 1000 });
  assert.deepEqual(Object.keys(sanitizeHybridMeta({ redactions: { email: 1, phone: 1, text: "x" } })!.redactions), ["email", "phone"]);
  assert.deepEqual(sanitizeHybridMeta({ redactions: "a@b.com" })?.redactions, { email: 0, phone: 0 });
});

test("RR-19 KNOWN BYPASSES (documented, not caught): obfuscated / spelled-out / non-ASCII identifiers and names", () => {
  for (const q of ["a [at] b [dot] com", "không chín một hai ba bốn năm sáu bảy tám", "０９１２３４５６７８", "Nguyễn Văn An, 12 Lê Lợi", "a@b"]) {
    assert.equal(red(q).text, q, `bypass documented: ${q}`);
  }
});
