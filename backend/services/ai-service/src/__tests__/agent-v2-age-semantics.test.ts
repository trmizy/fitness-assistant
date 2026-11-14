/**
 * V2 Minor Gate — AGE SEMANTICS (owner policy M7-P5A.2.3): explicit first-person minor disclosures, third-party ages, ambiguous
 * expressions, "not an age" shapes. OFFLINE: pure functions plus the REAL supervisor over mocked providers and an in-memory session
 * store (no network, DB, Redis, AWS or model). Evidence labels: BACKEND INTEGRATION (supervisor + in-memory store, mocks) / TEST FIXTURE
 * (the phrase tables). Not a real user flow.
 *
 * What the supervisor tests can and cannot say: V1 input safety (`checkInputSafety`, outside this module) reads DIGIT ages itself and
 * refuses some of these sentences before Gate 1 ("Con tôi 15 tuổi, tôi nên tập gì?", "Em 8 tuổi, hôm nay tập gì?" are SAFETY_BLOCKED by V1);
 * those are asserted as such and the Gate-1 verdict is asserted through `resolveAgeVerdict` instead. Sentences V1 lets through are asserted
 * end to end.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatedAge, decideMinorGate, resolveAgeVerdict, statesAmbiguousAge, statesMinorAge, type AgeVerdict, type ProfileAgeRead,
} from "../agent-v2/minor-gate";
import { AMBIGUOUS_PATTERNS, findAgeMentions } from "../agent-v2/vietnamese-age";
import { extractFactsFromText } from "../llm/turn_facts";
import { system, say, USER_A, SID } from "./m5-benchmark/harness";
import { readSession, reusableContext, hasStatedMinorAge } from "../agent-v2/session-context";

const UNKNOWN: ProfileAgeRead = { status: "OK", age: null };
const ADULT: ProfileAgeRead = { status: "OK", age: 30 };
const MINOR16: ProfileAgeRead = { status: "OK", age: 16 };
const FAILED: ProfileAgeRead = { status: "FAILED", reason: "x" };
const verdictOf = (q: string, history: string[] = [], profile: ProfileAgeRead = UNKNOWN, session = false): AgeVerdict => resolveAgeVerdict(profile, q, history, session);
const NONE = { explicit: [], ambiguous: false, thirdParty: false };

// ── 1. explicit first-person minor disclosures (owner list) ─────────────────────────────────────────────────────────────────
const EXPLICIT: Array<[string, number]> = [
  ["Cháu mười lăm tuổi.", 15], ["Em mười lăm tuổi.", 15], ["Chào anh, em mười lăm tuổi.", 15], ["Em mới 13.", 13], ["Em 8 tuổi.", 8],
  ["chau muoi lam tuoi", 15], ["em moi 13", 13], ["em 8 tuoi", 8], ["em tam tuoi", 8],
  ["CHÁU MƯỜI LĂM TUỔI", 15], ["EM MƯỜI LĂM TUỔI.", 15], ["EM MỚI 13", 13], ["EM 8 TUỔI", 8], ["CHAU MUOI LAM TUOI", 15], ["EM TAM TUOI", 8],
  ["Chào bác, cháu mười lăm tuổi", 15], ["Dạ cháu 15 tuổi", 15], ["Cháu 15 tuổi.", 15], ["Mình hiện 14", 14], ["Năm nay em 15", 15], ["Tôi đang 16.", 16],
  ["Tôi mới mười hai tuổi, tập gym được không?", 12], ["Chào anh, em mới 13 tuổi", 13], ["chao anh, em 15 tuoi", 15], ["Tôi là học sinh 15 tuổi", 15],
  ["Em 5 tuổi", 5], ["em 9 tuoi", 9], ["toi muoi sau tuoi", 16], ["Mình mười bảy tuổi", 17], ["Em chín tuổi", 9], ["Tuổi của em là mười lăm", 15], ["Tuổi của em là 15", 15],
  ["Chào coach, em mười lăm tuổi, nên tập gì?", 15], ["Em mới 13, hôm nay tập gì?", 13], ["Em ơi? Không. Em 8 tuổi.", 8], ["Hi, cháu mười ba tuổi", 13],
];
EXPLICIT.forEach(([q, age], i) => {
  test(`AS-explicit ${i + 1}: "${q}" → the user's own age ${age}, minor`, () => {
    assert.deepEqual(classifyStatedAge(q), { explicit: [age], ambiguous: false, thirdParty: false });
    assert.equal(statesMinorAge(q), true);
    assert.equal(statesAmbiguousAge(q), false);
    const v = verdictOf(q);
    assert.equal(v.status, "MINOR"); assert.deepEqual(v.minorBy, ["CURRENT_TURN"]); assert.equal(v.ambiguous, false);
  });
});

test("AS-explicit-adults: an explicit adult age is explicit but never a minor", () => {
  for (const [q, age] of [["Em mười tám tuổi", 18], ["Tôi 30 tuổi", 30], ["Em hai mươi lăm tuổi", 25], ["Cháu hai mươi tuổi", 20], ["Năm nay tôi mười chín", 19]] as const) {
    assert.deepEqual(classifyStatedAge(q), { explicit: [age], ambiguous: false, thirdParty: false }, q);
    assert.equal(statesMinorAge(q), false, q);
    assert.equal(verdictOf(q).status, "UNKNOWN", q);
  }
});

// ── 2. digit / word twins give the same outcome ─────────────────────────────────────────────────────────────────────────────
const TWINS: Array<[digits: string, words: string]> = [
  ["Em 15 tuổi", "Em mười lăm tuổi"], ["Cháu 15 tuổi", "Cháu mười lăm tuổi"], ["Em mới 13.", "Em mới mười ba."], ["Em 8 tuổi.", "Em tám tuổi."],
  ["Con tôi 15 tuổi", "Con tôi mười lăm tuổi"], ["Em trai tôi 13 tuổi", "Em trai tôi mười ba tuổi"], ["con em 9 tuổi", "con em chín tuổi"],
  ["học sinh 15 tuổi", "học sinh mười lăm tuổi"], ["người 16 tuổi có được tập gym không?", "người mười sáu tuổi có được tập gym không?"],
  ["Chào anh em 15 tuổi.", "Chào anh em mười lăm tuổi."], ["Bạn 16 tuổi nên tập gì", "Bạn mười sáu tuổi nên tập gì"], ["Con 15 tuổi nên tập gì?", "Con mười lăm tuổi nên tập gì?"],
  ["Em không phải 16 tuổi", "Em không phải mười sáu tuổi"], ["giả sử em 16 tuổi", "giả sử em mười sáu tuổi"], ["em khoảng 15 tuổi", "em khoảng mười lăm tuổi"],
  ["Tôi chưa đủ 18 tuổi", "Tôi chưa đủ mười tám tuổi"], ["Tôi 25 tuổi, con tôi 15 tuổi", "Tôi hai mươi lăm tuổi, con tôi mười lăm tuổi"],
  ["Chào anh, em 15 tuổi", "Chào anh, em mười lăm tuổi"], ["năm nay em 15 tuổi", "năm nay em mười lăm tuổi"], ["Con trai mình mới 13", "Con trai mình mới mười ba"],
  ["em 13 tuoi", "em muoi ba tuoi"], ["CHÁU 15 TUỔI", "CHÁU MƯỜI LĂM TUỔI"], ["Em mới 15 phút", "Em mới mười lăm phút"],
];
TWINS.forEach(([d, w], i) => {
  test(`AS-twin ${i + 1}: "${d}" ≡ "${w}" (classification and verdict under every profile)`, () => {
    assert.deepEqual(classifyStatedAge(w), classifyStatedAge(d));
    for (const profile of [UNKNOWN, ADULT, MINOR16, FAILED]) {
      const a = verdictOf(d, [], profile); const b = verdictOf(w, [], profile);
      assert.equal(b.status, a.status); assert.deepEqual(b.minorBy, a.minorBy); assert.equal(b.conflict, a.conflict); assert.equal(b.ambiguous, a.ambiguous);
    }
  });
});

// ── 3. third-party ages: digits AND words are never the user's age ─────────────────────────────────────────────────────────
const THIRD = [
  "Con tôi 15 tuổi.", "Cháu tôi mười lăm tuổi.", "Em trai tôi 13 tuổi.", "Em gái mình mười hai tuổi", "con em 9 tuổi", "học sinh 15 tuổi", "người 16 tuổi có được tập gym không?",
  "Cháu gái tôi 14 tuổi", "Con gái mình mới 13", "Bạn tôi 16 tuổi", "Anh trai mình 17 tuổi", "Vợ tôi 16 tuổi", "Các em 15 tuổi tập gì?", "Thằng bé 12 tuổi",
  "Con tôi, 15 tuổi, thích tập", "Mỡ của tôi đang 15.", "cháu tôi 9 tuổi", "CON TÔI 15 TUỔI", "con toi 15 tuoi", "hoc sinh muoi lam tuoi", "nguoi 16 tuoi", "Em gái 12 tuổi",
  "Con trai tôi mới mười ba", "Con tôi mười lăm tuổi, nó nên tập gì?", "Học sinh mười lăm tuổi tập gì?", "Cháu của tôi 15 tuổi", "Bé 14 tuổi nên tập gì", "em gái tôi mười lăm tuổi",
  "Bố mẹ tôi 25 tuổi",
];
THIRD.forEach((q, i) => {
  test(`AS-third ${i + 1}: "${q}" → a third party: not the user's age, no minor, not ambiguous`, () => {
    const c = classifyStatedAge(q);
    assert.deepEqual(c.explicit, []); assert.equal(c.thirdParty, true); assert.equal(c.ambiguous, false);
    assert.equal(statesMinorAge(q), false); assert.equal(statesAmbiguousAge(q), false);
    for (const profile of [UNKNOWN, ADULT]) { const v = verdictOf(q, [], profile); assert.notEqual(v.status, "MINOR"); assert.equal(v.ambiguous, false); }
    assert.equal(verdictOf("Hôm nay tập gì?", [q]).status, "UNKNOWN", "also not an age when it is an earlier user turn");
  });
});

test("AS-third-V1: V1 itself reads the digit third-person sentences as the user's age — V2 deliberately does not (documented divergence)", () => {
  for (const q of ["Con tôi 15 tuổi", "học sinh 15 tuổi", "người 16 tuổi có được tập gym không?", "Em trai tôi 13 tuổi"]) {
    assert.ok((extractFactsFromText(q).ageYears?.value ?? 99) < 18, `V1 alone: ${q}`);
    assert.equal(statesMinorAge(q), false, `V2: ${q}`);
  }
});

// ── 4. mixed sentences ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("AS-mixed: the user's own age counts, the third party's does not (any order, any separator)", () => {
  for (const q of [
    "Tôi 25 tuổi, con tôi 15 tuổi", "Con tôi 15 tuổi, tôi 25 tuổi", "Tôi 25 tuổi và con tôi 15 tuổi", "Tôi 25 tuổi. Con tôi 15 tuổi.", "Con tôi mười lăm tuổi. Tôi hai mươi lăm tuổi.",
    "Tôi hai mươi lăm tuổi, em trai tôi mười ba tuổi", "Tôi 25 tuổi\nem gái tôi 12 tuổi",
  ]) {
    const c = classifyStatedAge(q);
    assert.deepEqual(c.explicit, [25], q); assert.equal(c.thirdParty, true, q); assert.equal(statesMinorAge(q), false, q);
    assert.equal(verdictOf(q).status, "UNKNOWN", q);
  }
  // the user is the minor and a parent/relative is an adult: the minor reading wins
  assert.equal(statesMinorAge("Tôi 16 tuổi, bố tôi 45 tuổi"), true);
  assert.deepEqual(classifyStatedAge("Bố tôi 45 tuổi, tôi mười sáu tuổi").explicit, [16]);
  // two first-person statements: a minor one is never hidden by an earlier adult one (V1 alone keeps only the first)
  assert.equal(statesMinorAge("Tôi 25 tuổi. Em 16 tuổi."), true);
  assert.equal(extractFactsFromText("Tôi 25 tuổi. Em 16 tuổi.").ageYears?.value, 25, "V1 alone");
});

// ── 5. NOT an age ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const NOT_AGE = [
  // training experience
  "Tôi tập gym 15 năm", "15 năm kinh nghiệm", "tập mười lăm năm", "Tôi có mười lăm năm kinh nghiệm", "Tôi mới 15 năm", "Tôi đã tập 15 năm rồi", "tôi tập hai mươi năm",
  // weights
  "15 kg", "mười lăm ký", "Tôi nặng 15 kg", "em mới 15 kg", "Tôi nặng mười lăm ký", "Tạ 15 cân",
  // reps / sets
  "15 reps", "15 cái", "Em tập mười lăm cái", "Tôi tập 3 hiệp 15 reps", "em mới 12 hiệp", "Em mới 12 set", "Em mới 15 lần", "Mỗi bài em làm 15 rep",
  // durations
  "15 phút mỗi ngày", "Em mới 15 phút", "em mới 15 tuần", "em mới mười lăm tháng", "Tôi nghỉ 15 phút", "em mới 15 ngày", "Em mới 15 giờ", "Tôi tập 15 tuần",
  // dates / money / counts
  "Ngày 15 tháng 3 tôi đi khám", "Ngày 15/3 tôi tập", "Tôi trả 15 triệu", "Tôi ăn 15 quả trứng", "Em mất 15 nghìn", "Năm 2015 tôi bắt đầu tập", "Tôi tăng 15% mỡ",
  // no subject marker / no "tuổi"
  "Em 15 rồi", "Em mười lăm", "Tôi 15", "em 15", "em mười lăm rồi", "Tôi mười lăm", "mười lăm tuổi", "Hôm nay tôi tập gì?", "",
];
NOT_AGE.forEach((q, i) => {
  test(`AS-not-age ${i + 1}: "${q}" → no age evidence at all`, () => {
    assert.deepEqual(classifyStatedAge(q), NONE);
    assert.equal(statesMinorAge(q), false); assert.equal(statesAmbiguousAge(q), false);
    assert.equal(verdictOf(q).status, "UNKNOWN"); assert.equal(verdictOf(q).ambiguous, false);
  });
});

// ── 6. ambiguous ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const AMBIGUOUS = [
  "Chào anh em mười lăm tuổi.", "Chào anh em 15 tuổi.", "chao anh em muoi lam tuoi", "CHÀO ANH EM MƯỜI LĂM TUỔI", "Chào chị em mười lăm tuổi", "Chào anh chị em 14 tuổi",
  "Chào bạn em mười lăm tuổi", "Chào bạn mười lăm tuổi", "Chào các bạn mười lăm tuổi", "Bạn 16 tuổi nên tập gì?", "Con mười lăm tuổi nên tập gì?", "Con 15 tuổi nên tập gì?",
  "Chào anh em mới 13", "Chào anh em mười lăm tuổi, hôm nay tập gì?", "Bạn mười sáu tuổi", "chao anh em 12 tuoi",
];
AMBIGUOUS.forEach((q, i) => {
  test(`AS-ambiguous ${i + 1}: "${q}" → AMBIGUOUS: no stated age, no persisted minor, \`ambiguous\` true, status unchanged`, () => {
    assert.deepEqual(classifyStatedAge(q), { explicit: [], ambiguous: true, thirdParty: false });
    assert.equal(statesMinorAge(q), false, "never persisted: statesMinorAge is the persistence predicate");
    assert.equal(statesAmbiguousAge(q), true);
    for (const [profile, status] of [[UNKNOWN, "UNKNOWN"], [ADULT, "ADULT"], [FAILED, "UNVERIFIED"]] as const) {
      const v = verdictOf(q, [], profile);
      assert.equal(v.status, status); assert.deepEqual(v.minorBy, []); assert.equal(v.ambiguous, true);
    }
    const asHistory = verdictOf("Hôm nay tôi tập gì?", [q]);
    assert.equal(asHistory.status, "UNKNOWN"); assert.equal(asHistory.ambiguous, true, "also from an earlier user turn");
  });
});

test("AS-ambiguous-list: the documented pattern list is short and stable", () => {
  assert.equal(AMBIGUOUS_PATTERNS.length, 3);
  assert.ok(AMBIGUOUS_PATTERNS.every((p) => /^A[123] /.test(p)));
});

test("AS-ambiguous-adult: an ambiguous expression with a non-minor age is not worth flagging", () => {
  for (const q of ["Chào anh em hai mươi lăm tuổi", "Chào anh em 30 tuổi", "Bạn 25 tuổi nên tập gì", "Chào anh em mười tám tuổi"]) {
    assert.deepEqual(classifyStatedAge(q), NONE, q);
    assert.equal(verdictOf(q).ambiguous, false, q);
  }
});

test("AS-ambiguous-wins-nothing: an explicit under-18 age in the same text makes the text explicit, not ambiguous", () => {
  for (const q of ["Chào anh em mười lăm tuổi. Em mười ba tuổi.", "Chào anh em 15 tuổi, em 13 tuổi", "Em mười ba tuổi. Chào anh em mười lăm tuổi."]) {
    const c = classifyStatedAge(q);
    assert.deepEqual(c.explicit, [13], q); assert.equal(c.ambiguous, false, q); assert.equal(statesAmbiguousAge(q), false, q); assert.equal(statesMinorAge(q), true, q);
    const v = verdictOf(q); assert.equal(v.status, "MINOR"); assert.equal(v.ambiguous, false);
  }
  // "anh, em" with the comma is explicit
  assert.deepEqual(classifyStatedAge("Chào anh, em mười lăm tuổi"), { explicit: [15], ambiguous: false, thirdParty: false });
  assert.deepEqual(classifyStatedAge("Chào anh em, em mười lăm tuổi"), { explicit: [15], ambiguous: false, thirdParty: false });
});

test("AS-ambiguous-verdict: `ambiguous` is true only when ambiguous evidence exists and the verdict is not MINOR; `status` / decideMinorGate are unchanged", () => {
  const AMB = "Chào anh em mười lăm tuổi.";
  assert.equal(verdictOf(AMB, [], MINOR16).status, "MINOR"); assert.equal(verdictOf(AMB, [], MINOR16).ambiguous, false, "profile minor");
  assert.equal(verdictOf(AMB, ["Tôi mười sáu tuổi"]).ambiguous, false, "explicit minor in history");
  assert.equal(verdictOf("Hôm nay tập gì?", [AMB, "Em mới 13."]).ambiguous, false, "ambiguous earlier + explicit later");
  assert.equal(verdictOf(AMB, [], UNKNOWN, true).status, "MINOR"); assert.equal(verdictOf(AMB, [], UNKNOWN, true).ambiguous, false, "session minor statement");
  assert.equal(verdictOf("Hôm nay tập gì?", [], ADULT).ambiguous, false, "no evidence");
  assert.equal(verdictOf("Hôm nay tập gì?", ["Tôi 30 tuổi"], ADULT).ambiguous, false);
  assert.equal(verdictOf("Tôi 30 tuổi", [AMB], UNKNOWN).ambiguous, true, "a later adult self-report never clears the ambiguity (self-report is not verified data)");
  assert.equal(verdictOf("Tôi 30 tuổi", [AMB], UNKNOWN).status, "UNKNOWN");
  assert.equal(verdictOf(AMB, [], { status: "OK", age: 30 }).conflict, false, "an ambiguous text is not an age conflict");
  // decideMinorGate sees the same status either way
  const amb = verdictOf(AMB); const neutral = verdictOf("Hôm nay tập gì?");
  for (const category of ["GENERAL_KNOWLEDGE", "PERSONAL_ADVICE", "PLAN_REQUEST", "HIGH_RISK"] as const) for (const own of [false, true]) {
    assert.deepEqual(decideMinorGate(amb, category, own), decideMinorGate(neutral, category, own), `${category}/${own}`);
  }
});

test("AS-verdict-shape: the existing AgeVerdict shape is unchanged for exact-shape consumers; `ambiguous` is a readable boolean", () => {
  const v = verdictOf("Hôm nay tập gì?");
  assert.deepEqual(v, { status: "UNKNOWN", minorBy: [], conflict: false, profileRead: "OK" });
  assert.deepEqual(Object.keys(v), ["status", "minorBy", "conflict", "profileRead"]);
  assert.equal(typeof v.ambiguous, "boolean");
  assert.equal(Object.getOwnPropertyDescriptor(v, "ambiguous")?.enumerable, false);
});

// ── 7. parity with V1 where nothing else applies ───────────────────────────────────────────────────────────────────────────
// CONTRACT CHANGE (owner decision M7-P5A.3): "em sắp 18 tuổi" was removed from this V1-parity list — V1 reads the directional "sắp 18" as an adult 18, V2 as 17
// (see agent-v2-age-remediation.test.ts). Every other entry is unchanged.
const V1_PARITY = [
  "Tôi 25 tuổi", "Em 15 tuổi, tập gì?", "Mình 17 tuổi", "Tập gym 15 tuổi có sao không", "I am 15 years old", "Tôi chưa 18 tuổi", "Tôi chưa đủ 18 tuổi", "Tôi không phải 16 tuổi",
  "giả sử em 16 tuổi", "Nếu tôi 16 tuổi thì sao", "em khoảng 15 tuổi", "Tuổi của em 15", "tuổi 15", "Tôi 16 tuoi", "15 tuổi tập gym được không?", "Hôm nay tôi tập gì?",
  "Tôi 12 tuổi",
];
V1_PARITY.forEach((q, i) => {
  test(`AS-v1-parity ${i + 1}: "${q}" → the same age V1 reads (negation / hypothetical / approximation / not-yet rules unchanged)`, () => {
    const f = extractFactsFromText(q).ageYears;
    const v1 = !f || f.status === "NEGATED" || f.status === "UNKNOWN" ? [] : [f.value];
    assert.deepEqual(classifyStatedAge(q).explicit, v1);
  });
});

test("AS-v1-divergence: the three deliberate differences from V1 — third-person digits, digit ages 5-9, marker digits ('em mới 13')", () => {
  assert.equal(extractFactsFromText("Em 8 tuổi").ageYears, undefined, "V1 ignores digit ages below 10");
  assert.deepEqual(classifyStatedAge("Em 8 tuổi").explicit, [8]);
  assert.equal(extractFactsFromText("Em mới 13").ageYears, undefined, "V1 does not read 'em mới 13'");
  assert.deepEqual(classifyStatedAge("Em mới 13").explicit, [13]);
  assert.equal(extractFactsFromText("Con tôi 15 tuổi").ageYears?.value, 15, "V1 reads a third party's digits as the user's age");
  assert.deepEqual(classifyStatedAge("Con tôi 15 tuổi").explicit, []);
  // a digit age below 10 needs a speaker pronoun: a bare "8 tuổi" stays V1-silent
  assert.deepEqual(classifyStatedAge("8 tuổi tập gym được không?"), NONE);
  assert.deepEqual(classifyStatedAge("Tập gym 8 tuổi"), NONE);
  assert.deepEqual(classifyStatedAge("Em 3 tuổi"), NONE, "below 5 is never an age");
});

test("AS-rules-on-new-forms: negation / hypothetical / not-yet / approximation apply to the new shapes too", () => {
  assert.deepEqual(classifyStatedAge("Em không phải 8 tuổi").explicit, [], "negated");
  assert.equal(statesMinorAge("giả sử em mới 13"), true, "hypothetical minor counts, as in V1");
  assert.equal(statesMinorAge("Nếu cháu mười lăm tuổi thì sao"), true);
  assert.deepEqual(classifyStatedAge("Em chưa đủ 8 tuổi").explicit, [7], "not yet 8 = 7 (V1 rule on the sentinel-free value)");
  assert.deepEqual(classifyStatedAge("Cháu chưa đủ mười tám tuổi").explicit, [17]);
  // CONTRACT CHANGE (owner decision M7-P5A.3): V1 parity is an unsafe oracle for directional approximations — "sắp 18" is under 18 (17). Previously pinned as `false`.
  assert.equal(statesMinorAge("cháu sắp mười tám tuổi"), true, "directional approximation: just under 18");
  assert.equal(statesMinorAge("Cháu khoảng mười lăm tuổi"), true);
  assert.equal(statesMinorAge("Em không phải mới 13"), false);
});

// ── 8. misc shapes, accents, hostile input ───────────────────────────────────────────────────────────────────────────────────
test("AS-accents: 'minh', 'toi' and 'chau' without accents count only when the whole text has no Vietnamese diacritics", () => {
  assert.equal(statesMinorAge("minh muoi lam tuoi"), true);
  assert.equal(statesMinorAge("toi moi 13"), true);
  assert.equal(statesMinorAge("Châu mười lăm tuổi, tôi nên tập gì"), false, "Châu (a name / continent), not cháu");
  assert.equal(statesMinorAge("Minh mười lăm tuổi, nên tập gì"), false, "a name when the text has accents");
  assert.equal(statesMinorAge("Cháu mười lăm tuổi, nên tập gì"), true);
});

test("AS-appositive: a comma ends an address, never a relation", () => {
  assert.equal(statesMinorAge("Chào anh, em mười lăm tuổi"), true);
  assert.equal(statesMinorAge("Con tôi, 15 tuổi, thích tập"), false);
  assert.equal(statesMinorAge("Tôi, 16 tuổi, muốn tập ngực"), true);
  assert.equal(statesMinorAge("Tôi là học sinh, 15 tuổi"), true);
});

test("AS-mentions: findAgeMentions exposes subject classes; at most 8 expressions; the residual keeps V1 parity for undetected shapes", () => {
  const m = findAgeMentions("Tôi 25 tuổi, con tôi 15 tuổi, chào anh em 14 tuổi").mentions;
  assert.deepEqual(m.map((x) => x.subject), ["FIRST", "THIRD", "AMBIGUOUS"]);
  assert.ok(findAgeMentions("Em 15 tuổi. ".repeat(50)).mentions.length <= 8);
  assert.deepEqual(findAgeMentions(undefined as never).mentions, []);
});

test("AS-bounded: hostile and oversized input never throws, is bounded to 4000 chars and is fast", () => {
  const start = Date.now();
  const hostile = [
    "em ".repeat(20000), "anh em ".repeat(5000), "em mới ".repeat(5000) + "13", "con tôi ".repeat(3000) + "15 tuổi", "mười ".repeat(20000), "\n".repeat(50000),
    "a".repeat(100000) + " em mười lăm tuổi", "a".repeat(100000) + " em 15 tuổi", "\u0000\uD800 em mười lăm tuổi", "İİİ em mới 13", "Em 15 tuổi. ".repeat(2000), "tuổi của em là ".repeat(3000),
    "em " + "mới ".repeat(3000) + "13", "chào anh em 15 tuổi ".repeat(500), ",".repeat(5000) + "15 tuổi",
  ];
  for (const h of hostile) {
    assert.doesNotThrow(() => classifyStatedAge(h)); assert.doesNotThrow(() => statesMinorAge(h)); assert.doesNotThrow(() => statesAmbiguousAge(h));
    assert.doesNotThrow(() => verdictOf(h, [h, h]));
  }
  for (const v of [undefined, null, 42, {}, [], Symbol.iterator.toString()]) assert.doesNotThrow(() => classifyStatedAge(v as never));
  assert.deepEqual(classifyStatedAge(undefined as never), NONE);
  assert.equal(statesMinorAge("a".repeat(100000) + " em mười lăm tuổi"), false, "beyond the scan cap");
  assert.equal(statesMinorAge("em mười lăm tuổi " + "x ".repeat(5000)), true);
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start}ms`);
});

// ── 9. REAL supervisor: session persistence, restriction, third party, ambiguous ───────────────────────────────────────────────
async function storedMinor(s: ReturnType<typeof system>): Promise<boolean> {
  const r = await readSession(s.store, USER_A, SID);
  return r.status === "ok" && hasStatedMinorAge(reusableContext(r.raw, USER_A, SID, s.clock()).all);
}
const FIRST_TURN_NOTE = /Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên/;

for (const q of ["Em mới 13, hôm nay tập gì?", "Cháu mười lăm tuổi, hôm nay tập gì?", "Em mười lăm tuổi, hôm nay tập gì?", "Chào anh, em mười lăm tuổi, hôm nay tập gì?", "em moi 13, hom nay tap gi?"]) {
  test(`AS-S1 (BACKEND INTEGRATION) explicit "${q}" persists the minor statement; later turns stay restricted even after "Tôi 30 tuổi"`, async () => {
    const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
    s.prov.training.script(say("Khởi động kỹ rồi tập nhẹ nhàng nhé."));
    const r1 = await s.ask(USER_A, q);
    assert.equal(s.traces[0].ageGate?.status, "MINOR"); assert.equal(s.traces[0].ageGate?.decision, "GENERAL_ONLY");
    assert.equal(r1.status, "ANSWERED"); assert.match(r1.answer, FIRST_TURN_NOTE);
    assert.equal(await storedMinor(s), true, "persisted as the user's own USER_REPORTED statement");
    const modelCalls = s.modelRequests();
    const r2 = await s.ask(USER_A, "Tôi 30 tuổi, lịch tập hôm nay của tôi là gì?");
    assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"], "from the session, not the profile");
    const r3 = await s.ask(USER_A, "Tôi hai mươi lăm tuổi rồi, mục tiêu calo của tôi là bao nhiêu?");
    assert.equal(r3.status, "MINOR_PROTECTED");
    assert.equal(s.modelRequests(), modelCalls, "the blocked turns made no model call");
    assert.deepEqual(s.w.calls, [], "no personal tool was called");
  });
}

test("AS-S2 (BACKEND INTEGRATION) 'Em 8 tuổi' is persisted BEFORE V1 input safety refuses it (V1-BLOCKED sentence); the next turn is restricted", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  const r1 = await s.ask(USER_A, "Em 8 tuổi, hôm nay tập gì?");
  assert.equal(r1.status, "SAFETY_BLOCKED"); assert.equal(s.traces[0].ageGate, null, "stopped by V1 input safety before Gate 1");
  assert.equal(await storedMinor(s), true);
  const r2 = await s.ask(USER_A, "Hôm nay tôi tập gì?");
  assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"]);
  assert.equal(s.modelRequests(), 0);
});

for (const q of ["Chào anh em mười lăm tuổi, hôm nay tập gì?", "Chào các bạn mười lăm tuổi, hôm nay tập gì?", "Con mười lăm tuổi, hôm nay tập gì?"]) {
  test(`AS-S3 (BACKEND INTEGRATION) ambiguous "${q}" never creates a persistent minor; a later neutral personal question is not MINOR_PROTECTED from history`, async () => {
    const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
    s.prov.training.script(say("Ok"), say("Ok"));
    await s.ask(USER_A, q);
    assert.notEqual(s.traces[0].ageGate?.status, "MINOR", "no minor reading from an ambiguous expression");
    assert.deepEqual(s.traces[0].ageGate?.minorBy, []);
    assert.equal(await storedMinor(s), false, "nothing persisted");
    const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
    assert.notEqual(r2.status, "MINOR_PROTECTED");
    assert.equal(s.traces[1].ageGate?.status, "ADULT"); assert.deepEqual(s.traces[1].ageGate?.minorBy, []); assert.equal(s.traces[1].ageGate?.decision, "PROCEED");
    // the same sentence replayed by the client as history exposes `ambiguous` (the lead's wiring keeps it unresolved) — still never MINOR
    const v = resolveAgeVerdict({ status: "OK", age: 30 }, "Lịch tập hôm nay của tôi là gì?", [q], false);
    assert.equal(v.status, "ADULT"); assert.equal(v.ambiguous, true);
  });
}

test("AS-S3b (BACKEND INTEGRATION) the digit twin \"Chào anh em 15 tuổi, hôm nay tập gì?\" is refused by V1 input safety (V1-BLOCKED, outside this module); V2 still persists nothing and the next turn is not restricted", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  const r1 = await s.ask(USER_A, "Chào anh em 15 tuổi, hôm nay tập gì?");
  assert.equal(r1.status, "SAFETY_BLOCKED"); assert.equal(s.traces[0].ageGate, null);
  assert.equal(await storedMinor(s), false);
  const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
  assert.notEqual(r2.status, "MINOR_PROTECTED"); assert.equal(s.traces.at(-1)!.ageGate?.status, "ADULT");
});

test("AS-S4 (BACKEND INTEGRATION) third party: 'Con tôi mười lăm tuổi' and the mixed 'Tôi 25 tuổi, con tôi 15 tuổi' do not restrict the user", async () => {
  for (const q of ["Con tôi mười lăm tuổi, tôi nên tập gì?", "Tôi 25 tuổi, con tôi 15 tuổi, tôi nên tập gì?", "Em gái tôi mười hai tuổi, tôi nên tập gì?", "Cháu tôi mười lăm tuổi, tôi nên tập gì?"]) {
    const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
    s.prov.training.script(say("Ok"), say("Ok"));
    const r1 = await s.ask(USER_A, q);
    assert.notEqual(r1.status, "SAFETY_BLOCKED", `V1 lets this one through: ${q}`);
    assert.equal(s.traces[0].ageGate?.status, "ADULT", q); assert.deepEqual(s.traces[0].ageGate?.minorBy, [], q); assert.equal(s.traces[0].ageGate?.decision, "PROCEED", q);
    assert.equal(await storedMinor(s), false, q);
    const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
    assert.notEqual(r2.status, "MINOR_PROTECTED", q); assert.equal(s.traces[1].ageGate?.status, "ADULT", q);
  }
});

test("AS-S5 (BACKEND INTEGRATION) 'Con tôi 15 tuổi, tôi nên tập gì?': V1 input safety itself refuses it (V1-BLOCKED); V2 persists nothing and the user is not a minor for Gate 1", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  const r1 = await s.ask(USER_A, "Con tôi 15 tuổi, tôi nên tập gì?");
  assert.equal(r1.status, "SAFETY_BLOCKED", "V1's digit rule (outside this module) reads 15 as the user's age and refuses");
  assert.equal(await storedMinor(s), false, "V2 persisted no minor restriction for a third party's age");
  const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
  assert.notEqual(r2.status, "MINOR_PROTECTED"); assert.equal(s.traces.at(-1)!.ageGate?.status, "ADULT");
  assert.equal(verdictOf("Con tôi 15 tuổi, tôi nên tập gì?", [], ADULT).status, "ADULT", "Gate-1 verdict in isolation");
  assert.equal(verdictOf("Con tôi 15 tuổi, tôi nên tập gì?", [], ADULT).conflict, false);
});

test("AS-S6 (BACKEND INTEGRATION) a later 'Tôi 30 tuổi' after an explicit minor statement never clears it, with or without a session store", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 }, withStore: false });
  const r1 = await s.ask(USER_A, "Cháu mười lăm tuổi, lịch tập hôm nay của tôi là gì?");
  assert.equal(r1.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[0].ageGate?.minorBy, ["CURRENT_TURN"]);
  const r2 = await s.ask(USER_A, "Tôi 30 tuổi, lịch tập hôm nay của tôi là gì?", { history: [{ role: "user", text: "Em mới 13." }, { role: "assistant", text: "Ok" }] });
  assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"]);
});
