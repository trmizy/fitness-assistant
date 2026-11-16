/**
 * M9.5-T1B-F1 — CORE SEMANTICS of the emergency engine (llm/emergency/*). TEST FIXTURE: synthetic sentences (the first group are the findings of the independent Codex
 * Desktop review of 039c1dba), pure function, no model / DB / network. Engine level only: the guard adapter, HTTP, Supervisor and bridge are NOT exercised here (F2 / T1C).
 * Every expectation is the PROPOSED safety policy (clinical review pending), not "whatever the engine printed".
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/emergency-engine-semantics-f1.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assessEmergency } from "../llm/emergency/assess";
import type { Domain, EmergencyAssessment, Evidence, RiskClass, Subject } from "../llm/emergency/types";

const counted = (a: EmergencyAssessment, domain?: Domain) => a.evidence.filter((e) => e.disposition.startsWith("COUNTED") && (!domain || e.domain === domain));
const find = (a: EmergencyAssessment, p: (e: Evidence) => boolean) => a.evidence.filter(p);
const risks = (a: EmergencyAssessment) => (a as unknown as { risks?: Array<{ domain: Domain; subject: Subject; subjectKey: string; riskClass: RiskClass }> }).risks ?? [];
const show = (a: EmergencyAssessment) => `${a.riskClass}/${a.domain}/${a.subject}`;

// ── A. negation and hyperbole scope: a negated or benign word in ANOTHER segment must not switch a clear self-harm statement off ──
for (const q of ["I am not hurt and want to die.", "I'm not tired and I want to die.", "Tôi không đau và tôi muốn chết.", "My legs hurt and I want to die.", "I did not eat all day and I want to die."]) {
  test(`F1-A1 negation / sensation of another segment does not erase self-harm: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY", show(a)); assert.equal(a.domain, "SELF_HARM"); assert.equal(a.subject, "SELF"); });
}
for (const q of ["I don't want to die.", "Tôi không muốn tự tử.", "I am not suicidal.", "My legs hurt so bad I want to die lol.", "Tập xong mệt muốn chết.", "Đau chân muốn chết."]) {
  test(`F1-A2 control — still NOT an emergency: ${q}`, () => { const a = assessEmergency(q); assert.notEqual(a.riskClass, "IMMEDIATE_EMERGENCY", show(a)); assert.notEqual(a.riskClass, "POSSIBLE_HIGH_RISK", show(a)); });
}
test("F1-A3 control — exertion words alone stay AMBIGUOUS (POSSIBLE), never erased and never certain", () => { const a = assessEmergency("I hate my workout routine and I want to die."); assert.equal(a.riskClass, "POSSIBLE_HIGH_RISK"); assert.equal(a.domain, "SELF_HARM"); });

// ── B. subject isolation ──
for (const q of ["My brother is unconscious and my sister is jerking.", "My brother is unconscious. My sister is jerking."]) {
  test(`F1-B1 two people are never merged into one seizure, and the brother's own risk is kept: ${q}`, () => {
    const a = assessEmergency(q);
    assert.equal(counted(a, "SEIZURE").length, 0, "no seizure is counted for anybody");
    assert.ok(a.riskClass === "IMMEDIATE_EMERGENCY" || a.riskClass === "POSSIBLE_HIGH_RISK", show(a));
    assert.equal(a.subject, "OTHER");
    const r = risks(a); assert.equal(r.length, 1, JSON.stringify(r)); assert.equal(r[0].subjectKey, "my brother"); assert.equal(r[0].domain, "NEUROLOGICAL");
    const jerk = find(a, (e) => e.lexicon === "SZ_JERK_LOC"); assert.equal(jerk.length, 1); assert.equal(jerk[0].disposition, "UNPAIRED"); assert.equal(jerk[0].subjectKey, "my sister");
  });
}
test("F1-B2 the same person unconscious AND jerking is still ONE seizure (control)", () => { const a = assessEmergency("My brother is unconscious and jerking."); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY"); assert.equal(a.domain, "SEIZURE"); assert.equal(a.subject, "OTHER"); });
test("F1-B3 reversed order: sister unconscious, brother jerking → still two people, still the unconscious one is a risk", () => { const a = assessEmergency("My brother is jerking and my sister is unconscious."); assert.equal(counted(a, "SEIZURE").length, 0); assert.equal(risks(a).length, 1); assert.equal(risks(a)[0].subjectKey, "my sister"); });
test("F1-B4 two independent emergencies of two people are BOTH kept in the assessment", () => {
  const a = assessEmergency("My brother just overdosed and my sister is having a seizure right now."); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY");
  const r = risks(a); assert.equal(r.length, 2, JSON.stringify(r)); assert.deepEqual(r.map((x) => x.domain).sort(), ["OVERDOSE_POISONING", "SEIZURE"]); assert.deepEqual(r.map((x) => x.subjectKey).sort(), ["my brother", "my sister"]);
});
test("F1-B5 my own overheating and a friend's confusion are not one case of heat illness", () => { const a = assessEmergency("I am overheated and my friend is confused."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); assert.equal(counted(a).length, 0); });
test("F1-B6 'his friend' is another person than 'my friend' (a possessive noun phrase is not the previous subject)", () => { const a = assessEmergency("My friend is overheated. His friend is confused."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); });

// ── C. pronoun reference ──
for (const [q, subj] of [["My brother is overheated. He is confused.", "my brother"], ["Bạn tôi bị nóng ran. Bạn ấy lú lẫn.", "bạn tôi"], ["My sister is overheated. She is confused.", "my sister"]] as const) {
  test(`F1-C1 an unambiguous pronoun is linked to its antecedent: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY", show(a)); assert.equal(a.domain, "HEAT_ILLNESS"); assert.equal(a.subject, "OTHER"); assert.equal(counted(a, "HEAT_ILLNESS")[0].subjectKey, subj); });
}
test("F1-C2 a topic 'confused about the plan' is not a clinical sign, and it is another person's state anyway", () => {
  const a = assessEmergency("My coach is overheated; I'm confused about the workout plan."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); assert.equal(counted(a).length, 0);
  assert.ok(find(a, (e) => e.domain === "HEAT_ILLNESS" && e.disposition === "UNPAIRED").length === 1, "the coach's heat sign is kept as UNPAIRED"); assert.ok(find(a, (e) => e.disposition === "NON_CLINICAL_USE").length === 1, "the reason for dropping 'confused about' is kept");
});
test("F1-C3 a clinical confusion of the SAME speaker is still paired with their heat sign (control)", () => { const a = assessEmergency("I am overheated and confused about where I am."); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY"); assert.equal(a.domain, "HEAT_ILLNESS"); assert.equal(a.subject, "SELF"); });
test("F1-C4 a pronoun with two possible antecedents is NOT linked: no pairing, and the uncertainty is reported", () => {
  const a = assessEmergency("My friend and my colleague were running. They are overheated. He is confused."); assert.equal(counted(a).length, 0);
  assert.equal(a.uncertainty, "AMBIGUOUS_REFERENCE", show(a)); assert.ok(find(a, (e) => e.referenceAmbiguous === true).length >= 1, "evidence whose subject is an unresolved pronoun is flagged");
});
test("F1-C5 gender narrows the antecedent: 'she' is the sister, 'he' the brother, so a heat sign and a confusion of two people stay apart", () => { const a = assessEmergency("My brother and my sister were running. She is overheated. He is confused."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); assert.equal(a.uncertainty, "NONE"); });
test("F1-C6 a pronoun far away (two sentences back) is not linked to a stale antecedent", () => { const a = assessEmergency("My brother is overheated. We talked. It rained. He is confused."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); });

// ── D. medical emergency descriptions (signs, not diagnoses) ──
for (const [q, dom, subj] of [
  ["My dad just swallowed all his tablets and won't wake up.", "OVERDOSE_POISONING", "OTHER"], ["I am overheated; I can't tell where I am.", "HEAT_ILLNESS", "SELF"], ["He fell to the floor and won't respond; his body keeps jerking.", "SEIZURE", "OTHER"],
] as const) {
  test(`F1-D1 sign-based emergency description is recognised: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY", show(a)); assert.equal(a.domain, dom); assert.equal(a.subject, subj); });
}
test("F1-D2 a diagnosis statement is not an emergency sign", () => {
  for (const q of ["The doctor said my friend has a seizure disorder.", "He was diagnosed with heat stroke last summer.", "My dad has epilepsy and takes his tablets every day."]) { const a = assessEmergency(q); assert.notEqual(a.riskClass, "IMMEDIATE_EMERGENCY", `${q} → ${show(a)}`); assert.notEqual(a.riskClass, "POSSIBLE_HIGH_RISK", `${q} → ${show(a)}`); }
});

// ── E. false positives that must stay quiet ──
test("F1-E1 'a whole bottle of water' is not an overdose (no medication noun, no OD evidence at all)", () => { const a = assessEmergency("My friend took a whole bottle of water after the run."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED"); assert.equal(find(a, (e) => e.domain === "OVERDOSE_POISONING").length, 0); });
test("F1-E2 a hypothetical overdose is not an emergency, and the evidence is kept with its reason", () => { const a = assessEmergency("What if my brother overdosed at a party?"); assert.equal(a.riskClass, "GENERAL_EDUCATION_OR_HYPOTHETICAL", show(a)); assert.ok(find(a, (e) => e.domain === "OVERDOSE_POISONING" && e.disposition === "HYPOTHETICAL_OTHER").length === 1); });
test("F1-E2b a hypothetical overdose about ONESELF is not dismissed (it may disguise intent): POSSIBLE, never certain and never ignored", () => { const a = assessEmergency("What if I took too many pills?"); assert.equal(a.riskClass, "POSSIBLE_HIGH_RISK", show(a)); assert.equal(a.domain, "OVERDOSE_POISONING"); assert.equal(a.subject, "SELF"); });
test("F1-E3 a chronic 'seizure disorder' is not a seizure now", () => { const a = assessEmergency("My friend has a seizure disorder and wants to start lifting."); assert.equal(a.riskClass, "NO_EMERGENCY_DETECTED", show(a)); assert.equal(counted(a).length, 0); });
for (const q of ["What is facial droop and what causes it?", "Facial droop can be a sign of stroke; how do I recognize it?", "Dấu hiệu méo miệng là gì?"]) {
  test(`F1-E4 educational facial-droop question is not an emergency: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "GENERAL_EDUCATION_OR_HYPOTHETICAL", show(a)); });
}
for (const q of ["Tiền sử co giật năm 2019.", "I had a seizure in 2019.", "Tôi từng bị co giật hồi cấp ba."]) {
  test(`F1-E5 a seizure history is HISTORICAL, not an emergency: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "HISTORICAL_OR_THIRD_PARTY_CONCERN", show(a)); });
}
for (const q of ["Nếu tôi bị sốc nhiệt và lú lẫn thì tôi nên làm gì?", "If someone gets heat stroke and becomes confused, what should I do?"]) {
  test(`F1-E6 a hypothetical heat-stroke question is not an emergency: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "GENERAL_EDUCATION_OR_HYPOTHETICAL", show(a)); });
}

// ── F. a benign sentence must not disable a dangerous sign in ANOTHER clause / sentence ──
for (const [q, dom, subj] of [
  ["What is facial droop? My dad has slurred speech and arm weakness right now.", "NEUROLOGICAL", "OTHER"],
  ["I had a seizure in 2019, but my brother is having a seizure right now.", "SEIZURE", "OTHER"],
  ["What if my brother overdosed at a party? My dad just swallowed all his tablets and won't wake up.", "OVERDOSE_POISONING", "OTHER"],
  ["My friend took a whole bottle of water. I want to kill myself.", "SELF_HARM", "SELF"],
  ["Tôi không bị lú lẫn, nhưng bạn tôi đang co giật toàn thân.", "SEIZURE", "OTHER"],
  ["Nếu trời nóng thì tôi nên làm gì? Tôi đang nóng ran và lú lẫn.", "HEAT_ILLNESS", "SELF"],
  ["My friend has a seizure disorder and wants to start lifting, but he is unconscious and jerking right now.", "SEIZURE", "OTHER"],
] as const) {
  test(`F1-F1 benign context elsewhere does not disable the real sign: ${q}`, () => { const a = assessEmergency(q); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY", show(a)); assert.equal(a.domain, dom); assert.equal(a.subject, subj); });
}
test("F1-F2 nothing is dropped: every non-counted match is still present in the evidence with a reason", () => {
  const a = assessEmergency("I had a seizure in 2019, but my brother is having a seizure right now."); const past = find(a, (e) => e.disposition === "PAST"); assert.equal(past.length, 1); assert.equal(past[0].subject, "SELF");
});
