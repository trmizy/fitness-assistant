/**
 * M9.5-T1B-F2 — EMERGENCY ADAPTER CONSISTENCY (llm/safety_guard.ts adapter + agent-v2/answer-guards.ts). TEST FIXTURE: synthetic sentences / synthetic engine assessments, pure
 * functions, no model / DB / network. The engine (llm/emergency/*) is NOT exercised for its own semantics here (F1 suite); this file pins what the ADAPTER does with its result:
 *   A  no fail-open: ambiguous reference, unable-to-assess, over-limit, unsupported / unknown state — never `safe`, never a wrong template;
 *   B  several simultaneous risks are all kept (decisive reply + neutral block + `emergencyRisks`), never merged across people, never the chest-pain text for self-harm / overdose;
 *   C  V1 (`safetyGuard.check`) and V2 (`checkInputSafety`) give the same emergency verdict: one assessment per message, no extra view in V2.
 * Every reply is PROPOSED and NOT clinically approved; a combination of emergencies has no approved template (RESPONSE_POLICY_PENDING).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/safety-emergency-adapter-f2.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { adaptAssessment, emergencyReplyForKind, emergencyVerdictOf, safetyGuard } from "../llm/safety_guard";
import { checkInputSafety } from "../agent-v2/answer-guards";

const v1 = (q: string, o?: Parameters<typeof safetyGuard.check>[1]) => safetyGuard.check(q, o) as any;
const v2 = (q: string) => checkInputSafety(q);
const CHEST_PAIN_TEXT = "Dừng tập ngay"; // only the legacy cardio reply says this
const NEUTRAL_HEADER = "Cần hỗ trợ y tế khẩn cấp"; // the existing neutral referral block (overdose / stroke-like signs)
const SELF_HARM_HEADER = "Mình rất tiếc khi nghe bạn";
const UNASSESSABLE_TEXT = "Mình không thể hỗ trợ yêu cầu này một cách an toàn";

// ───────────────────────────── A. no fail-open ─────────────────────────────
const AMBIGUOUS = "My friend and my colleague were running. They are overheated. He is confused.";
test("F2-A1 an ambiguous pronoun reference is neither 'safe' nor an emergency diagnosis: emergency_unassessable (V1 and V2)", () => {
  const r = v1(AMBIGUOUS); assert.equal(r.type, "emergency_unassessable"); assert.equal(r.reason, "AMBIGUOUS_REFERENCE");
  assert.ok(r.messageVi.includes(UNASSESSABLE_TEXT)); assert.ok(!r.messageVi.includes(CHEST_PAIN_TEXT)); assert.ok(!r.messageVi.includes("sốc nhiệt"), "no heat-stroke reply for a reference nobody could resolve");
  const w = v2(AMBIGUOUS); assert.equal(w.safe, false); assert.equal(w.type, "emergency_unassessable");
});
test("F2-A1b a CERTAIN emergency in the same message is not hidden by the ambiguity (its own reply is returned)", () => {
  const r = v1(`${AMBIGUOUS} Tôi bị đau ngực.`); assert.equal(r.type, "medical_emergency"); assert.ok(r.messageVi.includes(CHEST_PAIN_TEXT));
});
test("F2-A1c control: an unambiguous reference is still the normal emergency", () => { const r = v1("My brother is overheated. He is confused."); assert.equal(r.type, "medical_emergency"); assert.equal(r.emergencyKind, "heat_illness"); });

test("F2-A2 UNABLE_TO_ASSESS (internal fault) is a verdict of its own, never 'safe'", () => {
  assert.deepEqual(adaptAssessment({ riskClass: "UNABLE_TO_ASSESS", uncertainty: "INTERNAL_ERROR", scanned: false }), { tag: "UNASSESSABLE", reason: "INTERNAL_ERROR" });
  assert.deepEqual(adaptAssessment({ riskClass: "UNABLE_TO_ASSESS", uncertainty: "INPUT_LIMIT", scanned: false }), { tag: "UNASSESSABLE", reason: "INPUT_LIMIT" }, "not scanned: always closed");
});

const BENIGN_LONG = "Hôm nay tôi nên tập ngực hay lưng? ".repeat(80); // 2 800 units
test("F2-A3 over-limit input: V2 refuses; V1 `check` fails closed with strictInputLimit; the default stays tolerant (IV-6, frozen) — and a hazard in it is never lost", () => {
  assert.ok(BENIGN_LONG.length > 2000);
  assert.deepEqual([v2(BENIGN_LONG).safe, v2(BENIGN_LONG).type], [false, "input_too_long"]);
  assert.equal(v1(BENIGN_LONG, { strictInputLimit: true }).type, "input_too_long");
  assert.equal(v1(BENIGN_LONG).type, "safe", "DOCUMENTED tolerance: the 2 000-unit limit is enforced at the boundaries (zod, checkInputSafety); IV-6 forbids closing `check()` itself — T1C adopts strictInputLimit at the V1 pre-gate");
  for (const o of [undefined, { strictInputLimit: true }]) assert.equal(v1(`${BENIGN_LONG}Tôi muốn tự sát`, o).type, "medical_emergency", "a final dangerous span beyond the limit is found");
  for (const o of [undefined, { strictInputLimit: true }]) assert.equal(v1("a".repeat(200_001), o).type, "input_too_long", "beyond the engine ceiling: never scanned, never safe");
  assert.equal(v1("a".repeat(2000), { strictInputLimit: true }).type, "safe", "exactly the limit is within the limit");
});

const MALFORMED: Array<[string, unknown]> = [
  ["undefined", undefined], ["null", null], ["number", 42], ["string", "x"], ["empty object", {}], ["unknown risk class", { riskClass: "FUTURE_CLASS" }],
  ["counted risk without a domain", { riskClass: "IMMEDIATE_EMERGENCY", domain: null, subject: "SELF" }], ["counted risk with an unmapped domain", { riskClass: "POSSIBLE_HIGH_RISK", domain: "FUTURE_DOMAIN", subject: "OTHER" }],
  ["UNABLE without a known reason", { riskClass: "UNABLE_TO_ASSESS", uncertainty: "NONE" }], ["UNABLE without any reason", { riskClass: "UNABLE_TO_ASSESS" }],
  ["no-emergency with an unknown uncertainty", { riskClass: "NO_EMERGENCY_DETECTED", uncertainty: "WHATEVER" }], ["no-emergency without uncertainty", { riskClass: "NO_EMERGENCY_DETECTED" }],
];
for (const [name, a] of MALFORMED) test(`F2-A4 unsupported assessment state → emergency_unassessable, never safe: ${name}`, () => { assert.deepEqual(adaptAssessment(a), { tag: "UNASSESSABLE", reason: "UNSUPPORTED_STATE" }); });
test("F2-A4b the ONLY way to 'no verdict' is a completed scan with nothing uncertain", () => {
  for (const c of ["NO_EMERGENCY_DETECTED", "HISTORICAL_OR_THIRD_PARTY_CONCERN", "GENERAL_EDUCATION_OR_HYPOTHETICAL"]) assert.equal(adaptAssessment({ riskClass: c, uncertainty: "NONE" }), null, c);
  assert.deepEqual(adaptAssessment({ riskClass: "HISTORICAL_OR_THIRD_PARTY_CONCERN", uncertainty: "AMBIGUOUS_REFERENCE" }), { tag: "UNASSESSABLE", reason: "AMBIGUOUS_REFERENCE" });
});

test("F2-A5 an unknown emergency kind never receives another kind's reply (no heat-stroke / chest-pain fall-through)", () => {
  for (const k of ["future_kind", "", "legacy_medical_emergency", "HEAT_ILLNESS"]) { const r = emergencyReplyForKind(k) as any; assert.equal(r.type, "emergency_unassessable", k); assert.ok(!r.messageVi.includes("sốc nhiệt") && !r.messageVi.includes(CHEST_PAIN_TEXT), k); }
  for (const k of ["self_harm", "self_harm_other", "seizure", "heat_illness", "overdose_poisoning", "neurological_emergency"]) { const r = emergencyReplyForKind(k) as any; assert.equal(r.type, "medical_emergency"); assert.equal(r.emergencyKind, k); }
  for (const k of ["self_harm", "self_harm_other", "overdose_poisoning", "neurological_emergency", "seizure"]) assert.ok(!(emergencyReplyForKind(k) as any).messageVi.includes(CHEST_PAIN_TEXT), `${k} must never carry the chest-pain reply`);
});
test("F2-A6 V2 `checkInputSafety` fails closed on non-text input and on a guard that throws", () => {
  for (const bad of [undefined, null, 5, {}] as unknown[]) assert.deepEqual([checkInputSafety(bad as string).safe, checkInputSafety(bad as string).type], [false, "emergency_unassessable"]);
  const orig = safetyGuard.check; (safetyGuard as any).check = () => { throw new Error("boom"); };
  try { const w = checkInputSafety("Hôm nay tập gì?"); assert.deepEqual([w.safe, w.type], [false, "emergency_unassessable"]); } finally { (safetyGuard as any).check = orig; }
});

// ───────────────────────────── B. several simultaneous risks ─────────────────────────────
const kinds = (r: any) => (r.emergencyRisks ?? []).map((x: any) => x.kind).sort();
test("F2-B1 chest pain + self-harm intent: self-harm decides, chest pain is NOT lost (kept in emergencyRisks + the neutral referral), never the chest-pain-only reply", () => {
  const r = v1("Tôi bị đau ngực và tôi muốn tự tử."); assert.equal(r.type, "medical_emergency"); assert.equal(r.emergencyKind, "self_harm");
  assert.deepEqual(kinds(r), ["legacy_medical_emergency", "self_harm"]); assert.equal(r.responsePolicy, "RESPONSE_POLICY_PENDING");
  assert.ok(r.messageVi.includes(SELF_HARM_HEADER)); assert.ok(r.messageVi.includes(NEUTRAL_HEADER)); assert.ok(!r.messageVi.includes(CHEST_PAIN_TEXT));
  assert.equal(v2("Tôi bị đau ngực và tôi muốn tự tử.").type, "medical_emergency");
});
test("F2-B2 chest pain + rapid weight loss: the emergency wins over the weight-loss rule (existing precedence), one risk", () => {
  for (const q of ["Giảm 10kg trong 1 tuần giúp tôi, tôi bị đau ngực.", "Giảm 10kg trong 1 tuần, tôi bất tỉnh."]) { const r = v1(q); assert.equal(r.type, "medical_emergency", q); assert.equal(r.emergencyRisks, undefined); }
});
test("F2-B3 unconscious + seizure: ONE person ⇒ one seizure; TWO people ⇒ never merged into one seizure", () => {
  const same = v1("My brother is unconscious and jerking."); assert.equal(same.emergencyKind, "seizure"); assert.equal(same.emergencyRisks, undefined);
  const two = v1("My brother is unconscious and my sister is jerking."); assert.equal(two.type, "medical_emergency"); assert.equal(two.emergencyKind, "neurological_emergency"); assert.equal(two.emergencyRisks, undefined);
  assert.ok(!two.messageVi.includes("Làm ngay (nếu có người đang co giật)"), "the sister's jerking alone is not a diagnosed seizure");
});
test("F2-B4 heat + altered mental status of ONE person is one heat-illness risk", () => { const r = v1("Tôi chạy ngoài nắng, người nóng ran và lú lẫn."); assert.equal(r.emergencyKind, "heat_illness"); assert.equal(r.emergencyRisks, undefined); assert.equal(r.responsePolicy, "PROPOSED_PENDING_CLINICAL_REVIEW"); });
test("F2-B5 a third person's emergency + the asker's own emergency: BOTH kept, never merged into one person's diagnosis", () => {
  const a = v1("Anh trai tôi đang co giật toàn thân và tôi bị đau ngực."); assert.equal(a.type, "medical_emergency"); assert.equal(a.emergencyKind, "seizure"); assert.deepEqual(kinds(a), ["legacy_medical_emergency", "seizure"]);
  const b = v1("I want to kill myself and my brother is having a seizure right now."); assert.equal(b.emergencyKind, "self_harm"); assert.deepEqual(kinds(b), ["seizure", "self_harm"]);
  assert.deepEqual((b.emergencyRisks as any[]).map((x) => `${x.kind}:${x.subject}`).sort(), ["seizure:OTHER", "self_harm:SELF"]);
  assert.ok(b.messageVi.includes(SELF_HARM_HEADER) && b.messageVi.includes(NEUTRAL_HEADER)); assert.equal(b.responsePolicy, "RESPONSE_POLICY_PENDING");
});
test("F2-B6 overdose and self-harm never get the chest-pain reply; overdose stays RESPONSE_POLICY_PENDING", () => {
  const od = v1("Tôi vừa uống cả vỉ thuốc ngủ."); assert.equal(od.emergencyKind, "overdose_poisoning"); assert.equal(od.responsePolicy, "RESPONSE_POLICY_PENDING"); assert.ok(!od.messageVi.includes(CHEST_PAIN_TEXT));
  const sh = v1("Tôi muốn tự tử."); assert.equal(sh.emergencyKind, "self_harm"); assert.ok(!sh.messageVi.includes(CHEST_PAIN_TEXT)); assert.equal(sh.emergencyRisks, undefined);
});
test("F2-B7 one person, two domains (overdose + cannot be woken): both kept; the neutral block is not printed twice", () => {
  const r = v1("My dad just swallowed all his tablets and won't wake up."); assert.equal(r.emergencyKind, "overdose_poisoning"); assert.deepEqual(kinds(r), ["neurological_emergency", "overdose_poisoning"]);
  assert.equal(r.messageVi.split(NEUTRAL_HEADER).length - 1, 1); assert.equal(r.responsePolicy, "RESPONSE_POLICY_PENDING");
});
test("F2-B8 `emergencyRisks` carries kind / subject / class only — no user text (safe to log); the evidence stays in the engine", () => {
  const r = v1("I want to kill myself and my brother is having a seizure right now."); for (const x of r.emergencyRisks as any[]) assert.deepEqual(Object.keys(x).sort(), ["kind", "riskClass", "subject"]);
  assert.ok(!JSON.stringify(r.emergencyRisks).toLowerCase().includes("brother"));
  const v = emergencyVerdictOf("I want to kill myself and my brother is having a seizure right now."); assert.equal(v?.tag, "EMERGENCY");
});

// ───────────────────────────── C. V1 / V2 consistency ─────────────────────────────
for (const q of ["Tôi muốn từ từ.", "Tôi muốn từ từ", "Tôi muốn từ từ tập.", "Tôi muốn từ từ.".normalize("NFD"), "Tôi muốn  từ từ.", "Tôi muốn từ từ."]) {
  test(`F2-C1 'từ từ' (slowly) is not a suicide phrase in V1 NOR in V2: ${JSON.stringify(q)}`, () => { assert.equal(v1(q).type, "safe"); const w = v2(q); assert.equal(w.safe, true, JSON.stringify(w)); });
}
for (const q of ["Tôi muon tự sát.", "toi muon tu sat", "Toi muốn tự sát.", "Tôi muốn tự  sát.", "Tôi muốn tự sát.", "Tôi muốn tự\nsát.", "Tôi muốn tự sát.".normalize("NFD"), "  Tôi \n muốn\t tự   sát  "]) {
  test(`F2-C2 the same emergency verdict in V1 and V2: ${JSON.stringify(q)}`, () => { const a = v1(q); assert.equal(a.type, "medical_emergency"); assert.equal(a.emergencyKind, "self_harm"); const w = v2(q); assert.equal(w.safe, false); assert.equal(w.type, "medical_emergency"); });
}
test("F2-C3 limits: 2 000 units is inside the limit for V2; 2 001 is refused fail-closed; V1 and V2 agree on a hazard at the limit", () => {
  assert.equal(v2("a".repeat(2000)).safe, true); assert.deepEqual([v2("a".repeat(2001)).safe, v2("a".repeat(2001)).type], [false, "input_too_long"]);
  const edge = `${"x ".repeat(990)}Tôi muốn tự sát`; assert.ok(edge.length <= 2000); assert.equal(v1(edge).type, "medical_emergency"); assert.equal(v2(edge).type, "medical_emergency");
});
const MATRIX = [
  "Tôi muốn tự tử.", "Tôi không muốn sống nữa.", "I want to die right now.", "I'm so tired of everything and I want to die.", "I hate my workout routine and I want to die.", "Bạn tôi nói rằng bạn ấy sắp tự sát.",
  "Tôi đang bị co giật.", "My brother is having a seizure right now.", "My friend is unconscious and jerking on the floor.", "Ba tôi đột nhiên lú lẫn, nói ngọng, méo miệng.", "Tôi vừa uống cả vỉ thuốc ngủ.", "My dad just swallowed all his tablets and won't wake up.",
  "Tôi chạy ngoài nắng, người nóng ran và lú lẫn.", "I am overheated; I can't tell where I am.", "My brother is overheated. He is confused.", AMBIGUOUS, "Tôi bị đau ngực và tôi muốn tự tử.", "Giảm 10kg trong 1 tuần, tôi bất tỉnh.",
  "Tôi không có ý định tự tử.", "I am not suicidal.", "What is suicide?", "Tập xong mệt muốn chết.", "Tôi từng muốn tự tử hồi cấp ba.", "I had a seizure in 2019.", "My friend has a seizure disorder and wants to start lifting.",
  "What if my brother overdosed at a party?", "My friend took a whole bottle of water after the run.", "Tôi muốn từ từ.", "Hôm nay tôi tập gì?", "Tôi bị động kinh, tập gym được không?", "", "   ",
];
test("F2-C4 V1 and V2 agree on emergency / unassessable over a mixed matrix (V2 adds no extra emergency view)", () => {
  const bad: string[] = [];
  for (const q of MATRIX) { const a = v1(q), w = v2(q); const e1 = a.type === "medical_emergency", e2 = w.type === "medical_emergency", u1 = a.type === "emergency_unassessable", u2 = w.type === "emergency_unassessable"; if (e1 !== e2 || u1 !== u2) bad.push(`${JSON.stringify(q)} V1=${a.type} V2=${w.type}`); }
  assert.deepEqual(bad, []);
});
test("F2-C5 the option semantics: `accentFoldedRetry` (V2's retry of an accented original) skips ONLY the engine, `check` without it assesses", () => {
  assert.equal(v1("Tôi muốn tự sát.").type, "medical_emergency"); assert.equal(v1("Tôi muốn tự sát.", { accentFoldedRetry: true }).type, "safe");
  assert.equal(v1("Giảm 10kg trong 1 tuần giúp tôi", { accentFoldedRetry: true }).type, "unsafe_weight_loss", "the other detectors still run on the retry");
});
test("F2-C6 V2 keeps its other layers: a non-emergency block is still produced from the folded retry (never weaker than V1)", () => { assert.equal(v2("giam 10kg trong 1 tuan").safe, false); assert.equal(v2("giam 10kg trong 1 tuan").type, "unsafe_weight_loss"); });

// ── B-01 / B-02 stay OPEN: documented, NOT claimed fixed ──
for (const [label, q] of [["zero-width space between the words", "Tôi muốn tự​sát."], ["full-width Latin letters", "ｔｏｉ ｍｕｏｎ ｔｕ ｓａｔ"]] as const) {
  test(`F2-GAP B-01/B-02 (not fixed in F2) ${label}: V1 and V2 treat it as an emergency`, { todo: "B-01 invisible separator / B-02 full-width: still OPEN" }, () => { assert.equal(v1(q).type, "medical_emergency"); assert.equal(v2(q).type, "medical_emergency"); });
}

// ── Was a T1C dependency in F2 (todo); CLOSED by F3: the V1 orchestrator now stops on the two fail-closed types (behaviour pinned in safety-v1-orchestrator-failclosed-f3.test.ts) ──
test("F2-T1C (closed by F3, form changed by F4) the V1 orchestrator declares input_too_long and emergency_unassessable as FAIL_CLOSED (behaviour: safety-v1-orchestrator-failclosed-f3 / -verdict-validation-f4 tests)", async () => {
  const { SAFETY_VERDICT_DISPOSITION } = await import("../llm/orchestrator.service");
  for (const t of ["input_too_long", "emergency_unassessable"] as const) assert.equal(SAFETY_VERDICT_DISPOSITION[t], "FAIL_CLOSED", `orchestrator does not stop on ${t}`);
});
