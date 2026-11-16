/**
 * M9.5-T1B — CORE-LEVEL tests of the bounded emergency engine (llm/emergency/*). TEST FIXTURE: synthetic sentences, pure function, no model / DB / network.
 * Class A of the T1B brief: these must stay GREEN. They exercise the engine DIRECTLY (risk class, domain, subject, evidence spans, resource bounds), not the guard's reply text.
 * Policy-pending behaviour (overdose / stroke-like signs / hyperbole boundary) is labelled [POLICY]: the CLASSIFICATION is the proposed one, the medical content is not approved.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/emergency-engine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assessEmergency, DOMAIN_RANK } from "../llm/emergency/assess";
import { normalizeForEmergency } from "../llm/emergency/normalize";
import type { Domain, RiskClass, Subject } from "../llm/emergency/types";

type Row = { q: string; cls: RiskClass; domain?: Domain; subject?: Subject; tag?: string };
const ROWS: Row[] = [
  // self-harm: direct, third party
  { q: "Tôi muốn tự tử.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" }, { q: "Mình không muốn sống nữa.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" },
  { q: "I want to die right now.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" }, { q: "I don't wanna live anymore.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" },
  { q: "I am thinking about suicide.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" }, { q: "toi muon tu sat", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF" },
  { q: "Bạn tôi nói rằng bạn ấy sắp tự sát.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "OTHER" }, { q: "My friend says he is going to kill himself.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "OTHER" },
  { q: "I'm so tired of everything and I want to die.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF", tag: "distress is not exertion" },
  { q: "I hate my workout routine and I want to die.", cls: "POSSIBLE_HIGH_RISK", domain: "SELF_HARM", subject: "SELF", tag: "[POLICY] ambiguous hyperbole is POSSIBLE, not certain, not safe" },
  // self-harm: not an emergency
  { q: "Tôi không có ý định tự tử.", cls: "NO_EMERGENCY_DETECTED" }, { q: "I am not suicidal.", cls: "NO_EMERGENCY_DETECTED" }, { q: "What is suicide?", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL" },
  { q: "Dấu hiệu nhận biết người muốn tự tử là gì?", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL" }, { q: "Tôi từng muốn tự tử hồi cấp ba.", cls: "HISTORICAL_OR_THIRD_PARTY_CONCERN" },
  { q: "Tập xong mệt muốn chết.", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL", tag: "benign hyperbole" }, { q: "My legs hurt so bad I want to die lol.", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL", tag: "benign hyperbole" },
  { q: "Tôi muốn kết thúc cuộc đời độc thân.", cls: "NO_EMERGENCY_DETECTED" }, { q: "Tự làm hại bản thân là gì?", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL" },
  // scope: another clause / segment must not switch a present risk off or on
  { q: "Last year I lost my job and I want to kill myself.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", subject: "SELF", tag: "past marker of ANOTHER fact" },
  { q: "Nếu cần thì gọi giúp, tôi bị co giật.", cls: "IMMEDIATE_EMERGENCY", domain: "SEIZURE", tag: "hypothesis in ANOTHER clause" },
  { q: "Tôi muốn giảm 9kg trong 1 tuần, I want to die right now.", cls: "IMMEDIATE_EMERGENCY", domain: "SELF_HARM", tag: "multi-clause, mixed language" },
  // seizure / neurological
  { q: "Tôi đang bị co giật.", cls: "IMMEDIATE_EMERGENCY", domain: "SEIZURE", subject: "SELF" }, { q: "My brother is having a seizure right now.", cls: "IMMEDIATE_EMERGENCY", domain: "SEIZURE", subject: "OTHER" },
  { q: "My friend is unconscious and jerking on the floor.", cls: "IMMEDIATE_EMERGENCY", domain: "SEIZURE", subject: "OTHER" }, { q: "Tay phải tôi đang co giật và tôi không nói được.", cls: "IMMEDIATE_EMERGENCY", domain: "SEIZURE" },
  { q: "My brother had a seizure and if it happens again what should I do", cls: "POSSIBLE_HIGH_RISK", domain: "SEIZURE", subject: "OTHER", tag: "recent event, time unknown" },
  { q: "I had a seizure ten years ago.", cls: "HISTORICAL_OR_THIRD_PARTY_CONCERN" }, { q: "I am not having a seizure.", cls: "NO_EMERGENCY_DETECTED" }, { q: "What does having a seizure feel like?", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL" },
  { q: "Cơ bắp chân tôi bị co giật nhẹ sau khi tập, có sao không?", cls: "NO_EMERGENCY_DETECTED", tag: "muscle twitch" }, { q: "Tôi bị động kinh, tập gym được không?", cls: "NO_EMERGENCY_DETECTED", tag: "chronic condition is not an acute event" },
  { q: "Ba tôi đột nhiên lú lẫn, nói ngọng, méo miệng.", cls: "IMMEDIATE_EMERGENCY", domain: "NEUROLOGICAL", subject: "OTHER", tag: "[POLICY] stroke-like signs; reply pending" },
  { q: "My dad is suddenly confused and can't speak clearly.", cls: "IMMEDIATE_EMERGENCY", domain: "NEUROLOGICAL", subject: "OTHER", tag: "[POLICY] stroke-like signs; reply pending" },
  // overdose / heat
  { q: "Tôi vừa uống cả vỉ thuốc ngủ.", cls: "IMMEDIATE_EMERGENCY", domain: "OVERDOSE_POISONING", subject: "SELF", tag: "[POLICY] class not approved; reply pending" }, { q: "I took too many pills on purpose.", cls: "IMMEDIATE_EMERGENCY", domain: "OVERDOSE_POISONING", subject: "SELF", tag: "[POLICY]" },
  { q: "Quá liều caffeine nguy hiểm thế nào?", cls: "NO_EMERGENCY_DETECTED", tag: "[POLICY] education about supplements" },
  { q: "Tôi chạy ngoài nắng, người nóng ran và lú lẫn.", cls: "IMMEDIATE_EMERGENCY", domain: "HEAT_ILLNESS", subject: "SELF" }, { q: "Sốc nhiệt có làm lú lẫn không?", cls: "GENERAL_EDUCATION_OR_HYPOTHETICAL" },
  // two subjects / two conditions never merge
  { q: "Tôi nóng ran sau khi chạy. Bạn tôi lú lẫn vì mất ngủ.", cls: "NO_EMERGENCY_DETECTED", tag: "two people" }, { q: "Tay tôi co giật nhẹ sau khi tập. Mẹ tôi không nói được.", cls: "NO_EMERGENCY_DETECTED", tag: "two people" },
  // ordinary
  { q: "Hôm nay tôi tập gì?", cls: "NO_EMERGENCY_DETECTED" }, { q: "", cls: "NO_EMERGENCY_DETECTED" },
];

test("EE-1 classification table: risk class, domain and subject for every row (direct, third-party, past, negated, educational, hyperbole, multi-clause, multi-subject)", () => {
  const bad: string[] = [];
  for (const r of ROWS) {
    const a = assessEmergency(r.q);
    if (a.riskClass !== r.cls) bad.push(`${JSON.stringify(r.q)} → ${a.riskClass}/${a.domain} (want ${r.cls})`);
    else { if (r.domain && a.domain !== r.domain) bad.push(`${JSON.stringify(r.q)} domain ${a.domain} (want ${r.domain})`); if (r.subject && a.subject !== r.subject) bad.push(`${JSON.stringify(r.q)} subject ${a.subject} (want ${r.subject})`); }
  }
  assert.deepEqual(bad, []);
});

test("EE-2 pure and deterministic: identical output for identical input, whatever was assessed before; evidence of one message never leaks into the next", () => {
  const qs = ROWS.map((r) => r.q);
  const alone = qs.map((q) => JSON.stringify(assessEmergency(q)));
  const shuffled = [...qs].reverse().map((q) => JSON.stringify(assessEmergency(q))).reverse();
  assert.deepEqual(shuffled, alone);
  const a = assessEmergency("Tôi muốn tự tử."), b = assessEmergency("Hôm nay tôi tập gì?");
  assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY"); assert.equal(b.riskClass, "NO_EMERGENCY_DETECTED"); assert.equal(b.evidence.length, 0);
});

test("EE-3 evidence spans point into the RAW text (UTF-16 offsets, end exclusive), subject / tense / negation are recorded, and non-counted evidence is KEPT with its reason", () => {
  const raw = "Hôm qua trời đẹp.  Tôi muốn tự\nsát,  I am not suicidal.";
  const a = assessEmergency(raw);
  const sh = a.evidence.find((e) => e.lexicon === "SH_INTENT_ACT")!;
  assert.equal(sh.disposition, "COUNTED_IMMEDIATE"); assert.equal(sh.subject, "SELF"); assert.equal(sh.negated, false);
  assert.match(raw.slice(sh.span.start, sh.span.end).replace(/\s+/g, " "), /muốn tự sát/); assert.ok(sh.span.start >= 0 && sh.span.end <= raw.length && sh.span.start < sh.span.end);
  const neg = a.evidence.find((e) => e.lexicon === "SH_EN_SUICIDE")!;
  assert.equal(neg.negated, true); assert.equal(neg.disposition, "NEGATED"); assert.match(raw.slice(neg.span.start, neg.span.end), /suicidal/i); assert.notEqual(neg.clause, sh.clause);
});

test("EE-4 whitespace variants of one phrase (double space, NBSP, tab, line break, mixed) all reach the same verdict", () => {
  for (const q of ["Tôi muốn tự sát.", "Tôi muốn tự  sát.", "Tôi muốn tự sát.", "Tôi muốn tự\tsát.", "Tôi muốn tự\nsát.", "  Tôi \n muốn\t tự   sát  "]) {
    const a = assessEmergency(q); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY", JSON.stringify(q)); assert.equal(a.domain, "SELF_HARM");
  }
});

test("EE-5 Unicode: surrogate pairs, decomposed (NFD) text, stacked combining marks, lone surrogates and a very long combining chain neither crash nor misplace spans", () => {
  const raw = "😀😀 Tôi muốn tự sát 😀";
  const a = assessEmergency(raw); assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY");
  const e = a.evidence.find((x) => x.disposition === "COUNTED_IMMEDIATE")!; assert.match(raw.slice(e.span.start, e.span.end), /muốn tự sát/);
  const nfd = "Tôi muốn tự sát".normalize("NFD"); const b = assessEmergency(nfd); assert.equal(b.riskClass, "IMMEDIATE_EMERGENCY");
  const eb = b.evidence.find((x) => x.disposition === "COUNTED_IMMEDIATE")!; assert.ok(eb.span.end <= nfd.length); assert.match(nfd.slice(eb.span.start, eb.span.end).normalize("NFC"), /muốn tự sát/);
  assert.equal(assessEmergency("\ud83d tôi muốn tự sát \ude00").riskClass, "IMMEDIATE_EMERGENCY");
  const chain = `a${"́̂̃̄".repeat(500)} tôi muốn tự sát`; assert.equal(assessEmergency(chain).riskClass, "IMMEDIATE_EMERGENCY");
  const n = normalizeForEmergency("ế".normalize("NFD") + "😀" + "   " + "x");
  assert.equal(n.nfc.text, "ế😀 x".normalize("NFC").toLowerCase()); assert.equal(n.nfc.start.length, n.nfc.text.length); assert.equal(n.ascii.start.length, n.ascii.text.length);
  for (let i = 1; i < n.nfc.start.length; i++) assert.ok(n.nfc.start[i] >= n.nfc.start[i - 1], "raw offsets never go backwards");
});

test("EE-6 never a silent cap: 600 benign / negated events followed by one real signal in the SAME clause is still found (the engine has no event limit)", () => {
  const q = `${"không muốn tự tử ".repeat(116)}em muốn chết đi`; assert.ok(q.length <= 2000); assert.equal(assessEmergency(q).riskClass, "IMMEDIATE_EMERGENCY");
  const many = `${"I am not suicidal ".repeat(600)}I am suicidal`; const a = assessEmergency(many, { maxUnits: 100_000 });
  assert.equal(a.riskClass, "IMMEDIATE_EMERGENCY"); assert.ok(a.evidence.length >= 600, `all ${a.evidence.length} matches were examined and kept`);
});

test("EE-7 limits: over the HTTP limit the engine still scans COMPLETELY (a dangerous last span is found) but never answers 'no emergency' — it says UNABLE_TO_ASSESS; beyond its ceiling it does not scan; bad input is an explicit error", () => {
  const benign = "Hôm nay tôi nên tập ngực hay lưng? ".repeat(80); assert.ok(benign.length > 2000);
  const b = assessEmergency(benign); assert.equal(b.riskClass, "UNABLE_TO_ASSESS"); assert.equal(b.uncertainty, "INPUT_LIMIT"); assert.equal(b.withinLimit, false); assert.equal(b.scanned, true);
  const d = assessEmergency(`${benign}Tôi muốn tự sát`); assert.equal(d.riskClass, "IMMEDIATE_EMERGENCY"); assert.equal(d.withinLimit, false);
  assert.equal(assessEmergency("x".repeat(300), { maxUnits: 100, hardCeilingUnits: 200 }).scanned, false);
  assert.equal(assessEmergency("x".repeat(300), { maxUnits: 100, hardCeilingUnits: 200 }).riskClass, "UNABLE_TO_ASSESS");
  for (const bad of [undefined, null, 42, {}, ["x"]]) { const a = assessEmergency(bad); assert.equal(a.riskClass, "UNABLE_TO_ASSESS"); assert.equal(a.uncertainty, "INTERNAL_ERROR"); }
  assert.equal(assessEmergency("a".repeat(2000)).riskClass, "NO_EMERGENCY_DETECTED", "exactly the limit is within the limit");
  assert.equal(assessEmergency("a".repeat(2001)).riskClass, "UNABLE_TO_ASSESS");
});

test("EE-8 priority is policy data: SELF_HARM outranks every other domain, a SELF subject decides before another person, and any IMMEDIATE evidence beats POSSIBLE", () => {
  assert.deepEqual(Object.entries(DOMAIN_RANK).sort((x, y) => x[1] - y[1]).map(([k]) => k), ["SELF_HARM", "OVERDOSE_POISONING", "SEIZURE", "NEUROLOGICAL", "HEAT_ILLNESS"]);
  assert.equal(assessEmergency("Tôi đang bị co giật. Tôi muốn tự tử.").domain, "SELF_HARM");
  assert.equal(assessEmergency("Bạn tôi nói rằng bạn ấy sắp tự sát. Tôi muốn tự sát.").subject, "SELF");
  const m = assessEmergency("I hate my workout routine and I want to die. I am having a seizure right now."); assert.equal(m.riskClass, "IMMEDIATE_EMERGENCY"); assert.equal(m.domain, "SEIZURE");
});

test("EE-9 [stress, bounded] pathological shapes at the HTTP limit and far beyond it finish quickly, return a valid class and never throw", () => {
  const shapes: Record<string, (n: number) => string> = {
    subjects: (n) => `${"bạn tôi tôi ".repeat(Math.ceil(n / 12)).slice(0, n)} tôi muốn tự tử`, events: (n) => `${"không muốn tự tử ".repeat(Math.ceil(n / 17))}`.slice(0, n),
    clauses: (n) => `${"tôi ổn, ".repeat(Math.ceil(n / 8)).slice(0, n)} I want to die`, heat: (n) => "nóng ran lú lẫn ".repeat(Math.ceil(n / 16)).slice(0, n),
    marks: (n) => "ế".normalize("NFD").repeat(Math.ceil(n / 3)).slice(0, n), spaces: (n) => " ".repeat(n), punct: (n) => "?!.,;".repeat(Math.ceil(n / 5)).slice(0, n), emoji: (n) => "😀".repeat(Math.ceil(n / 2)).slice(0, n),
  };
  for (const [k, f] of Object.entries(shapes)) for (const n of [2000, 100_000, 190_000]) {
    const q = f(n); const t0 = Date.now(); const a = assessEmergency(q); const ms = Date.now() - t0;
    assert.ok(["IMMEDIATE_EMERGENCY", "POSSIBLE_HIGH_RISK", "HISTORICAL_OR_THIRD_PARTY_CONCERN", "GENERAL_EDUCATION_OR_HYPOTHETICAL", "NO_EMERGENCY_DETECTED", "UNABLE_TO_ASSESS"].includes(a.riskClass), `${k}/${n}`);
    assert.ok(ms < 3000, `${k}/${n}: ${ms} ms`); assert.ok(a.evidence.length <= q.length, `${k}/${n}: evidence ${a.evidence.length} > input ${q.length}`);
  }
});

test("EE-10 observed complexity (a measurement, NOT a proof of O(n)): a 4x longer input costs well under the 16x a quadratic algorithm would — five adversarial shapes", () => {
  const shapes: Record<string, (n: number) => string> = {
    subjects: (n) => `${"bạn tôi tôi ".repeat(Math.ceil(n / 12)).slice(0, n)} tôi muốn tự tử`, events: (n) => `${"không muốn tự tử ".repeat(Math.ceil(n / 17))}`.slice(0, n),
    clauses: (n) => `${"tôi ổn, ".repeat(Math.ceil(n / 8)).slice(0, n)} I want to die`, heat: (n) => "nóng ran lú lẫn ".repeat(Math.ceil(n / 16)).slice(0, n), benign: (n) => "Hôm nay tôi nên tập ngực hay lưng? ".repeat(Math.ceil(n / 36)).slice(0, n),
  };
  const timeOf = (q: string) => { let best = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); assessEmergency(q); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); } return Math.max(best, 1); };
  const lines: string[] = [];
  for (const [k, f] of Object.entries(shapes)) { const a = timeOf(f(40_000)), b = timeOf(f(160_000)); lines.push(`${k}: 40k ${a.toFixed(0)} ms → 160k ${b.toFixed(0)} ms (${(b / a).toFixed(1)}x for 4x)`); assert.ok(b / a < 9, lines[lines.length - 1]); }
  console.log("ENGINE_SCALING " + lines.join(" | "));
});

test("EE-11 [memory sanity] a near-ceiling input does not retain memory after the call (needs --expose-gc; otherwise only the evidence bound is asserted)", () => {
  const q = "bạn tôi tôi ".repeat(15_000).slice(0, 190_000) + " tôi muốn tự tử"; assert.equal(assessEmergency(q).evidence.length <= q.length, true);
  const gc = (globalThis as { gc?: () => void }).gc; if (!gc) return;
  gc(); const before = process.memoryUsage().heapUsed; for (let i = 0; i < 5; i++) assessEmergency(q); gc(); const after = process.memoryUsage().heapUsed;
  assert.ok(after - before < 50 * 1024 * 1024, `retained ${((after - before) / 1e6).toFixed(1)} MB`);
});

// B-01 / B-02 — documented, NOT claimed fixed here. The normalization stage is the plug-in point (see normalize.ts header).
for (const [label, q] of [["zero-width space (U+200B) between the words", "Tôi muốn tự​sát."], ["word joiner (U+2060)", "Tôi muốn tự⁠sát."], ["full-width Latin letters", "ｔｏｉ ｍｕｏｎ ｔｕ ｓａｔ"]] as const) {
  test(`EE-GAP B-01/B-02 (documented, not fixed in T1B) ${label} is still an emergency`, { todo: "B-01 invisible separator / B-02 full-width: not addressed in M9.5-T1B" }, () => { assert.equal(assessEmergency(q).riskClass, "IMMEDIATE_EMERGENCY"); });
}
// known false negatives of the PROPOSED lexicon (not fixed; reported, never hidden)
for (const [label, q] of [["indirect ideation", "Tôi muốn biến mất vĩnh viễn."], ["method statement", "Tôi muốn nhảy lầu."], ["thinking about death", "Tôi đang nghĩ về cái chết."], ["seizure described without the keyword", "Cả người tôi giật giật, mắt trợn ngược."]] as const) {
  test(`EE-FN [known limitation of the rule-based lexicon] ${label}: ${q}`, { todo: "wording outside the lexicon: reported as a false negative, see M9-B03-SAFETY-ARCHITECTURE.md §10" }, () => { assert.notEqual(assessEmergency(q).riskClass, "NO_EMERGENCY_DETECTED"); });
}
