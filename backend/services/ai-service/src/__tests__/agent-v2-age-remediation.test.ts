/**
 * V2 Minor Gate — remediation R-B (owner decision M7-P5A.3), two verified P1 gaps:
 *   (1) "Em mới CÓ mười lăm tuổi" — the filler "có" between the marker and the age used to drop the written age (explicit [] → not minor);
 *   (2) DIRECTIONAL approximations "sắp / gần N", "chưa tới|đến|đủ|tròn N", "dưới N" with N <= 18 — V1 reads "sắp 18" as an approximate ADULT 18,
 *       V2 now reads "under N" (N-1) for a first-person subject.
 * OFFLINE. Evidence labels: TEST FIXTURE (phrase tables over the pure parser) and BACKEND INTEGRATION (the REAL supervisor over mocked providers and an
 * in-memory session store, same harness as agent-v2-age-semantics.test.ts). Not a real user flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyStatedAge, statesMinorAge, resolveAgeVerdict, type ProfileAgeRead } from "../agent-v2/minor-gate";
import { findAgeMentions } from "../agent-v2/vietnamese-age";
import { system, say, USER_A, SID } from "./m5-benchmark/harness";
import { readSession, reusableContext, hasStatedMinorAge } from "../agent-v2/session-context";

const ADULT: ProfileAgeRead = { status: "OK", age: 30 };
const explicitOf = (q: string): number[] => classifyStatedAge(q).explicit;
const NONE = { explicit: [], ambiguous: false, thirdParty: false };

// ── item 1: "có" between marker and written/digit age ─────────────────────────────────────────────────────────────────────────
const CO_EXPLICIT: Array<[string, number]> = [
  ["Em mới có mười lăm tuổi, em uống mấy muỗng whey mỗi ngày?", 15], ["em moi co muoi lam tuoi, em uong may muong whey moi ngay?", 15], ["EM MỚI CÓ MƯỜI LĂM TUỔI", 15],
  ["EM MOI CO MUOI LAM TUOI", 15], ["Em chỉ có mười lăm tuổi", 15], ["em chi co muoi lam tuoi", 15], ["Em có mười lăm tuổi", 15], ["em co muoi lam tuoi", 15],
  ["Em mới được mười lăm tuổi", 15], ["em moi duoc muoi lam tuoi", 15], ["Em vừa được mười lăm tuổi", 15], ["em vua duoc muoi lam tuoi", 15],
  ["Cháu mới có mười lăm tuổi", 15], ["chau moi co muoi lam tuoi", 15], ["Mình mới có mười lăm tuổi", 15], ["Tôi mới có mười lăm tuổi", 15], ["Em mới có 15 tuổi", 15],
  ["em moi co 15 tuoi", 15], ["Em chỉ có 15 tuổi", 15], ["Em vừa được 15 tuổi", 15], ["Em mới có tám tuổi", 8], ["Em mới có 8 tuổi", 8], ["em moi co 9 tuoi", 9],
  ["Em mới có mười ba tuổi, tập gym được không?", 13], ["Chào anh, em mới có mười lăm tuổi", 15],
];
CO_EXPLICIT.forEach(([q, age], i) => {
  test(`RB-co ${i + 1}: "${q}" → explicit first-person age ${age}, minor (USER_REPORTED only)`, () => {
    assert.deepEqual(classifyStatedAge(q), { explicit: [age], ambiguous: false, thirdParty: false });
    assert.equal(statesMinorAge(q), true);
    const v = resolveAgeVerdict(ADULT, q);
    assert.equal(v.status, "MINOR"); assert.deepEqual(v.minorBy, ["CURRENT_TURN"], "a typed age is never PROFILE"); assert.equal(v.conflict, true);
  });
});

test("RB-co-third: third-person subjects stay third-party ('Con tôi mới có mười lăm tuổi')", () => {
  for (const q of ["Con tôi mới có mười lăm tuổi", "con toi moi co muoi lam tuoi", "CON TÔI MỚI CÓ MƯỜI LĂM TUỔI", "Cháu tôi mới có mười lăm tuổi", "Em trai tôi có mười lăm tuổi",
    "Bạn tôi có mười lăm tuổi", "Con tôi mới có 15 tuổi", "Em gái mình chỉ có mười hai tuổi", "Các em mới có mười lăm tuổi"]) {
    const c = classifyStatedAge(q);
    assert.deepEqual(c.explicit, [], q); assert.equal(c.ambiguous, false, q); assert.equal(c.thirdParty, true, q); assert.equal(statesMinorAge(q), false, q);
  }
});

test("RB-co-negation: 'em không có mười lăm tuổi' / 'chưa' are not read as an asserted 15", () => {
  assert.deepEqual(classifyStatedAge("em không có mười lăm tuổi"), NONE);
  assert.deepEqual(classifyStatedAge("Em không có mười lăm tuổi"), NONE);
  assert.deepEqual(classifyStatedAge("em khong co muoi lam tuoi"), NONE);
  assert.deepEqual(classifyStatedAge("Tôi không phải mới có mười lăm tuổi"), NONE);
  assert.deepEqual(explicitOf("em chưa có mười tám tuổi"), [17], "'chưa có 18' = not yet 18 (the 'có' is dropped from the V1 copy so V1's not-yet rule applies)");
  assert.deepEqual(explicitOf("giả sử em mới có mười lăm tuổi"), [15], "hypothetical minor still counts (conservative, as V1)");
});

test("RB-co-adults: 'có' with an adult age stays an adult", () => {
  assert.deepEqual(explicitOf("Em mới có hai mươi lăm tuổi"), [25]);
  assert.deepEqual(explicitOf("Tôi có ba mươi tuổi"), [30]);
  assert.deepEqual(explicitOf("tôi mới có 18 tuổi"), [18]);
  assert.equal(statesMinorAge("Tôi mới có mười tám tuổi"), false);
});

test("RB-co-unchanged: 'có' next to an ambiguous / unknown head keeps the previous reading (no new ambiguity, no new third-party)", () => {
  assert.deepEqual(classifyStatedAge("bạn có mười lăm tuổi"), NONE, "written, no pronoun: still dropped (OTHER-like)");
  assert.deepEqual(classifyStatedAge("Con có mười lăm tuổi"), NONE);
  assert.deepEqual(explicitOf("con có 15 tuổi"), [15], "digits, V1 parity as before");
  assert.deepEqual(explicitOf("Tập gym có 15 tuổi"), [15]);
});

// ── item 1 false-positive guard ───────────────────────────────────────────────────────────────────────────────────────────────
const FALSE_POSITIVES = [
  "em mới có 3 tháng kinh nghiệm", "Em mới có 3 tháng kinh nghiệm", "tôi có mười lăm năm kinh nghiệm", "Tôi có mười lăm năm kinh nghiệm", "em sắp tập 15 phút",
  "tôi dưới 60 kg", "Tôi dưới 60 kg", "em sắp lên 20 kg", "Cho em hỏi sắp tới 18/11 tập gì", "em mới có 15 phút", "em mới có mười lăm phút", "em chỉ có 15 kg tạ", "em chỉ có mười lăm kg",
  "tôi có mười lăm", "em mới có mười lăm", "Em mới có 15", "tôi có 15 buổi", "em chỉ có mười lăm ngày", "em mới tập 13 tháng", "em tập 15 năm", "em mới 15 phút",
  "em dưới 60 kg tập gì", "tôi sắp tập 18 tuần", "em gần 18 giờ mới tập xong", "sắp tới em tập 18 buổi", "em chưa tới 18 buổi",
];
FALSE_POSITIVES.forEach((q, i) => {
  test(`RB-fp ${i + 1}: "${q}" is not an age`, () => {
    assert.deepEqual(classifyStatedAge(q), NONE);
    assert.equal(findAgeMentions(q).mentions.length, 0);
  });
});

// ── item 2: directional approximations ───────────────────────────────────────────────────────────────────────────────────────────
const DIRECTIONAL: Array<[string, number]> = [
  ["Em sắp mười tám tuổi, hôm nay tập gì?", 17], ["Em sắp 18 tuổi", 17], ["em sap muoi tam tuoi", 17], ["em sap 18 tuoi", 17], ["EM SẮP MƯỜI TÁM TUỔI", 17], ["EM SẮP 18 TUỔI", 17],
  ["EM SAP MUOI TAM TUOI", 17], ["Em sắp mười sáu tuổi", 15], ["em sắp 16 tuổi", 15], ["Em gần mười tám tuổi", 17], ["em gần 18 tuổi", 17], ["em gan 18 tuoi", 17],
  ["Em chưa tới 18 tuổi", 17], ["em chua toi 18 tuoi", 17], ["Em chưa đến mười tám tuổi", 17], ["em chua den muoi tam tuoi", 17], ["Em chưa đủ 18 tuổi", 17],
  ["Em chưa tròn mười tám tuổi", 17], ["em chua tron 18 tuoi", 17], ["Em chưa được 18 tuổi", 17], ["Em dưới 18 tuổi", 17], ["em duoi 18 tuoi", 17], ["Em dưới mười tám tuổi", 17],
  ["em sắp tròn 18 tuổi", 17], ["Em sắp tròn mười tám tuổi", 17], ["Em sắp 9 tuổi", 8],
  ["Cháu sắp mười tám tuổi", 17], ["chau sap muoi tam tuoi", 17], ["Mình sắp 18 tuổi", 17], ["Tôi sắp mười tám tuổi", 17], ["Tôi dưới 18 tuổi", 17], ["Tôi gần 18 tuổi", 17],
  ["Chào anh, em sắp 18 tuổi", 17], ["giả sử em sắp 18 tuổi", 17],
];
DIRECTIONAL.forEach(([q, age], i) => {
  test(`RB-dir ${i + 1}: "${q}" → explicit under-18 age ${age}`, () => {
    assert.deepEqual(classifyStatedAge(q), { explicit: [age], ambiguous: false, thirdParty: false });
    assert.equal(statesMinorAge(q), true);
    const v = resolveAgeVerdict(ADULT, q);
    assert.equal(v.status, "MINOR"); assert.deepEqual(v.minorBy, ["CURRENT_TURN"]);
  });
});

test("RB-dir-adult: thresholds above 18 and non-directional words stay adult (V1 behaviour kept)", () => {
  const cases: Array<[string, number]> = [["Em sắp 20 tuổi", 20], ["em sắp hai mươi tuổi", 20], ["Em sắp 25 tuổi", 25], ["em gần 30 tuổi", 30], ["em chưa tới 20 tuổi", 20], ["em dưới 30 tuổi", 30],
    ["Em trên 18 tuổi", 18], ["Em hơn 18 tuổi", 18], ["Em ngoài 18 tuổi", 18], ["Em đã 18 tuổi", 18], ["Em đủ 18 tuổi", 18], ["Em tròn 18 tuổi", 18],
    ["Tôi hơn hai mươi tuổi", 20]];
  for (const [q, age] of cases) {
    assert.deepEqual(explicitOf(q), [age], q);
    assert.equal(statesMinorAge(q), false, q);
  }
});

test("RB-dir-adult-words: written adult forms with trên / đủ are not a minor (they are not located at all: pre-existing, unchanged)", () => {
  for (const q of ["em trên mười tám tuổi", "em đủ mười tám tuổi"]) assert.equal(statesMinorAge(q), false, q);
});

test("RB-dir-nondirectional: 'khoảng / tầm' approximations keep today's behaviour", () => {
  assert.deepEqual(explicitOf("em khoảng 15 tuổi"), [15]);
  assert.deepEqual(explicitOf("em tầm 15 tuổi"), [15]);
  assert.deepEqual(explicitOf("em khoảng mười lăm tuổi"), [15]);
  assert.deepEqual(explicitOf("em khoảng 18 tuổi"), [18], "khoảng 18 is not directional: V1 reading 18 kept");
  assert.deepEqual(explicitOf("em tầm 18 tuổi"), [18]);
  assert.deepEqual(explicitOf("em tầm mười tám tuổi"), [18]);
});

test("RB-dir-third: third-person and ambiguous subjects stay as they were", () => {
  for (const q of ["Con tôi sắp 18 tuổi", "Con tôi sắp mười tám tuổi", "Bạn tôi dưới 18 tuổi", "Em trai tôi gần 18 tuổi", "Cháu tôi chưa tới 18 tuổi", "Học sinh sắp 18 tuổi", "Các em sắp mười tám tuổi"]) {
    const c = classifyStatedAge(q);
    assert.deepEqual(c.explicit, [], q); assert.equal(c.thirdParty, true, q); assert.equal(statesMinorAge(q), false, q);
  }
  assert.deepEqual(classifyStatedAge("Chào anh em sắp mười sáu tuổi"), { explicit: [], ambiguous: true, thirdParty: false }, "A1 ambiguous pattern unchanged (a directional word does not turn it into an explicit age)");
  assert.deepEqual(classifyStatedAge("Bạn sắp mười sáu tuổi"), { explicit: [], ambiguous: true, thirdParty: false });
});

test("RB-dir-negation: negation and not-yet rules still apply to the directional forms", () => {
  assert.deepEqual(classifyStatedAge("Em không phải sắp 18 tuổi"), NONE);
  assert.deepEqual(classifyStatedAge("Em không phải sắp mười tám tuổi"), NONE);
  assert.deepEqual(explicitOf("Tôi chưa đủ mười tám tuổi"), [17]);
  assert.deepEqual(explicitOf("Tôi chưa đủ 18 tuổi"), [17]);
  assert.deepEqual(explicitOf("Em chưa mười tám tuổi"), [17]);
  assert.deepEqual(explicitOf("Em chưa 18 tuổi"), [17]);
});

test("RB-dir-mixed: the user's own directional age counts next to an adult number, in any order; the third party's does not", () => {
  assert.deepEqual(explicitOf("Tôi 25 tuổi, em sắp 18 tuổi"), [25, 17]);
  assert.deepEqual(explicitOf("Em sắp 18 tuổi, con tôi 25 tuổi"), [17]);
  assert.equal(statesMinorAge("Tôi 40 tuổi, con tôi sắp 18 tuổi"), false);
});

test("RB-dir-not-an-age: 'sắp/gần/dưới' next to non-age numbers never produce an age", () => {
  for (const q of ["em sắp 18 kg", "em dưới 18 kg", "em gần 18 phút", "Em sắp 18 buổi nữa"]) assert.deepEqual(classifyStatedAge(q), NONE, q);
});

// ── mentions shape: the rewritten V1 copy is what V1 reads (no leftover directional word) ─────────────────────────────────────────
test("RB-mentions: the V1 copy of a directional / 'có' mention is rewritten to the plain 'em N tuoi' form", () => {
  assert.equal(findAgeMentions("em sắp 18 tuổi").mentions[0].text, "em 17 tuổi", "digits keep their own unit text");
  assert.equal(findAgeMentions("em sắp mười tám tuổi").mentions[0].text, "em 17 tuoi");
  assert.equal(findAgeMentions("em mới có mười lăm tuổi").mentions[0].text, "em mới 15 tuoi");
  assert.equal(findAgeMentions("em dưới 18 tuổi").mentions[0].text, "em 17 tuổi");
});

// ── REAL supervisor: persistence like any other explicit minor ────────────────────────────────────────────────────────────────
async function storedMinor(s: ReturnType<typeof system>): Promise<boolean> {
  const r = await readSession(s.store, USER_A, SID);
  return r.status === "ok" && hasStatedMinorAge(reusableContext(r.raw, USER_A, SID, s.clock()).all);
}
const FIRST_TURN_NOTE = /Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên/;

for (const q of ["Em mới có mười lăm tuổi, em uống mấy muỗng whey mỗi ngày?", "Em sắp mười tám tuổi, hôm nay tập gì?", "Em sắp 18 tuổi, hôm nay tập gì?", "Em dưới 18 tuổi, hôm nay tập gì?"]) {
  test(`RB-S1 (BACKEND INTEGRATION) "${q}" → MINOR from the profile-age-30 user's own statement, persisted; the next adult claim does not lift it`, async () => {
    const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
    s.prov.training.script(say("Khởi động kỹ rồi tập nhẹ nhàng nhé."));
    const r1 = await s.ask(USER_A, q);
    assert.equal(s.traces[0].ageGate?.status, "MINOR"); assert.ok(s.traces[0].ageGate?.minorBy.includes("CURRENT_TURN"), "the statement is read from this turn");
    if (r1.status === "ANSWERED") assert.match(r1.answer, FIRST_TURN_NOTE);
    assert.equal(await storedMinor(s), true, "persisted as the user's own USER_REPORTED statement");
    const r2 = await s.ask(USER_A, "Tôi 30 tuổi, lịch tập hôm nay của tôi là gì?");
    assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"]);
  });
}

test("RB-S2 (BACKEND INTEGRATION) third-party 'Con tôi mới có mười lăm tuổi' persists nothing and does not restrict the user", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  s.prov.training.script(say("Ok"), say("Ok"));
  await s.ask(USER_A, "Con tôi mới có mười lăm tuổi, nó uống whey được không?");
  assert.notEqual(s.traces[0].ageGate?.status, "MINOR"); assert.equal(await storedMinor(s), false);
  const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
  assert.notEqual(r2.status, "MINOR_PROTECTED"); assert.equal(s.traces[1].ageGate?.status, "ADULT");
});
