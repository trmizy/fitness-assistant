/**
 * V2 Minor Gate — Vietnamese WRITTEN ages ("Em mười lăm tuổi", "muoi lam tuoi"; owner decision C). OFFLINE: pure functions plus the
 * REAL supervisor over mocked providers and an in-memory session store. No network, DB, Redis, AWS or model.
 * Evidence label: BACKEND INTEGRATION (supervisor + in-memory store, mocks) / TEST FIXTURE (the phrase tables). Not a real user flow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAgeVerdict, statesMinorAge, type ProfileAgeRead } from "../agent-v2/minor-gate";
import { parseVietnameseNumberWords, rewriteWrittenAgeSentences } from "../agent-v2/vietnamese-age";
import { extractFactsFromText } from "../llm/turn_facts";
import { foldVi } from "../llm/speech_act";
import { system, say, USER_A, SID } from "./m5-benchmark/harness";
import { readSession, reusableContext, hasStatedMinorAge } from "../agent-v2/session-context";

const UNKNOWN: ProfileAgeRead = { status: "OK", age: null };
const ADULT: ProfileAgeRead = { status: "OK", age: 30 };
const verdictOf = (q: string, history: string[] = [], profile: ProfileAgeRead = UNKNOWN) => resolveAgeVerdict(profile, q, history);

// ── number words ────────────────────────────────────────────────────────────────────────────────────────────────────────
const WORDS: Record<number, string> = {
  10: "mười", 11: "mười một", 12: "mười hai", 13: "mười ba", 14: "mười bốn", 15: "mười lăm", 16: "mười sáu", 17: "mười bảy",
  18: "mười tám", 19: "mười chín", 20: "hai mươi", 21: "hai mươi mốt", 22: "hai mươi hai", 24: "hai mươi tư", 25: "hai mươi lăm", 30: "ba mươi",
};
test("VA-1 parseVietnameseNumberWords: standard forms, folded; lăm/nhăm/mốt/tư; rejects non-numbers and non-standard forms", () => {
  for (const [n, w] of Object.entries(WORDS)) assert.equal(parseVietnameseNumberWords(foldVi(w)), Number(n), w);
  for (const [w, n] of [["nam", 5], ["sau", 6], ["bay", 7], ["tam", 8], ["chin", 9], ["muoi nham", 15], ["hai muoi nham", 25], ["hai muoi bon", 24], ["chin muoi chin", 99]] as const) assert.equal(parseVietnameseNumberWords(w), n, w);
  for (const w of ["", "muoi nam", "hai muoi nam", "tu muoi", "muoi tu", "mot muoi", "lam", "muoi muoi", "hai muoi ruoi", "muoi lam tuoi", "hai", "ba"]) assert.equal(parseVietnameseNumberWords(w), null, w);
  assert.equal(parseVietnameseNumberWords(undefined as never), null);
});

// ── 10–17 → minor, in every spelling ────────────────────────────────────────────────────────────────────────────────────
const MINOR_AGES = [10, 11, 12, 13, 14, 15, 16, 17] as const;
for (const n of MINOR_AGES) {
  const w = WORDS[n];
  for (const [label, q] of [
    ["accented", `Em ${w} tuổi.`], ["unaccented", `em ${foldVi(w)} tuoi`], ["UPPER", `TÔI ${w.toUpperCase()} TUỔI`], ["UPPER unaccented", `MINH ${foldVi(w).toUpperCase()} TUOI`.replace("MINH", "EM")],
  ] as const) {
    test(`VA-minor ${n} ${label}: "${q}" → minor (CURRENT_TURN), same age value as the digit twin`, () => {
      assert.equal(statesMinorAge(q), true);
      const v = verdictOf(q);
      assert.equal(v.status, "MINOR"); assert.deepEqual(v.minorBy, ["CURRENT_TURN"]);
      const seg = rewriteWrittenAgeSentences(q);
      assert.equal(seg.length, 1);
      assert.equal(extractFactsFromText(seg[0]).ageYears?.value, n);
      assert.equal(extractFactsFromText(`Em ${n} tuổi.`).ageYears?.value, n, "digit twin");
    });
  }
}

test("VA-2 the requested sentences", () => {
  for (const q of ["Em mười lăm tuổi.", "Tôi mười sáu tuổi.", "Mình mười bảy tuổi.", "Em mới mười ba.", "Tôi 15 tuổi.", "mình mới mười bốn tuổi", "năm nay em mười lăm", "Năm nay em mười lăm tuổi", "Tôi năm nay mười sáu tuổi", "em đã tròn mười bảy tuổi rồi", "Tôi mới mười hai tuổi, tập gym được không?", "em mới mười một", "Mình hiện mười bốn", "Tôi đang mười lăm", "tui mười sáu tuổi", "em muoi lam tuoi", "toi muoi sau tuoi", "minh moi muoi ba", "Chào anh, em mười lăm tuổi", "Tuổi của em là mười lăm", "tuoi cua toi la muoi bon", "Em mười nhăm tuổi"])
    assert.equal(statesMinorAge(q), true, q);
});

test("VA-3 adults in words are not minors (and are still parsed: no age < 18)", () => {
  for (const q of ["Tôi hai mươi lăm tuổi", "mình mới mười tám", "Em mười tám tuổi", "Tôi ba mươi tuổi", "tôi hai mươi mốt tuổi", "em hai muoi tu tuoi", "Tôi bốn mươi lăm tuổi", "TÔI HAI MƯƠI TUỔI", "Năm nay tôi mười chín"]) {
    assert.equal(statesMinorAge(q), false, q);
    assert.notEqual(verdictOf(q).status, "MINOR", q);
  }
  assert.equal(verdictOf("Tôi hai mươi lăm tuổi").status, "UNKNOWN");
  assert.equal(extractFactsFromText(rewriteWrittenAgeSentences("Tôi hai mươi lăm tuổi")[0]).ageYears?.value, 25);
});

// ── NOT an age ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const NOT_AGE = [
  // weights / loads
  "Tôi nặng mười lăm ký", "Tôi tập mười lăm kg", "em mới mười lăm kg", "Tạ mười lăm cân", "Tôi mới mười lăm ký thôi", "em đang mười lăm kg",
  // sets / reps / duration
  "Em tập mười lăm cái", "Tôi mới mười lăm lần", "Mỗi bài em làm mười lăm rep", "Em mới mười hai hiệp", "Tôi tập mười lăm set", "em mới mười lăm phút", "Tôi nghỉ mười lăm phút", "em mới mười lăm tuần", "Tôi tập mười lăm ngày", "em mới mười hai tháng",
  // years of experience — "năm" is a unit of time, not "năm nay"
  "Tôi tập mười lăm năm", "Tôi có mười lăm năm kinh nghiệm", "Tôi mười lăm năm kinh nghiệm", "tôi mới mười lăm năm", "Tôi đã tập gym mười lăm năm rồi", "Mình có 15 năm kinh nghiệm", "Tôi tập 15 năm", "tôi tập hai mươi năm", "em tập mười năm",
  // dates / money / plain numbers
  "Ngày mười lăm tháng ba tôi đi khám", "Tôi trả mười lăm triệu", "Em mất mười lăm nghìn", "Em mới mười lăm giờ", "Tôi cao một mét bảy", "Tôi ăn mười lăm quả trứng", "em mới mười lăm tới", "em mới mười lăm quả",
  // no pronoun / no marker
  "Em mười lăm", "Tôi mười lăm", "mười lăm tuổi", "Mười lăm tuổi có tập gym được không?",
  // third person
  "Con tôi mười lăm tuổi", "con em mười ba tuổi", "Cháu tôi mười lăm tuổi", "học sinh mười lăm tuổi", "người mười sáu tuổi có được tập gym không?", "Bạn tôi mười sáu tuổi", "Bạn mình mười lăm tuổi", "em gái tôi mười lăm tuổi", "Anh trai mình mười bảy tuổi", "Vợ tôi mười sáu tuổi", "Các em mười lăm tuổi tập gì?", "con trai mình mới mười ba", "con gái em mười hai tuổi", "Bố mẹ tôi hai mươi lăm tuổi", "Minh mười lăm tuổi, tôi nên tập gì?", "bé mười lăm tuổi nên tập gì",
  // negated
  "Em không phải mười sáu tuổi", "Tôi không phải mười lăm tuổi",
  // unsupported shapes (documented)
  "em mười lăm rồi", "Em 15 rồi", "em mười lăm tuổi rưỡi".replace("em", "Con em"),
];
NOT_AGE.forEach((q, i) => {
  test(`VA-not-age ${i + 1}: "${q}" → no written age, not a minor`, () => {
    assert.equal(statesMinorAge(q), false);
    assert.equal(rewriteWrittenAgeSentences(q).length, 0, JSON.stringify(rewriteWrittenAgeSentences(q)));
    assert.equal(verdictOf(q).status, "UNKNOWN");
  });
});

test("VA-4 V1 rules apply to the rewritten copy: negation, 'chưa đủ', hypothetical, approximation", () => {
  assert.equal(statesMinorAge("Em không phải mười sáu tuổi"), false, "negated");
  assert.equal(statesMinorAge("Tôi không phải 16 tuổi"), false, "digit twin of the negation");
  assert.equal(statesMinorAge("Tôi chưa đủ mười tám tuổi"), true, "not yet 18 = 17");
  assert.equal(statesMinorAge("Tôi chưa đủ 18 tuổi"), true, "digit twin");
  assert.equal(statesMinorAge("Em chưa mười tám tuổi"), true);
  assert.equal(statesMinorAge("giả sử em mười sáu tuổi thì tập gì"), true, "hypothetical minor counts (conservative, as V1)");
  assert.equal(statesMinorAge("giả sử em 16 tuổi thì tập gì"), true, "digit twin");
  assert.equal(statesMinorAge("Nếu tôi mười sáu tuổi thì sao?"), true);
  assert.equal(statesMinorAge("Giả sử tôi hai mươi lăm tuổi"), false);
  assert.equal(statesMinorAge("em khoảng mười lăm tuổi"), true);
  // CONTRACT CHANGE (owner decision M7-P5A.3): V1 parity is an UNSAFE oracle for DIRECTIONAL approximations. "sắp / gần / chưa tới / dưới N" means UNDER N,
  // so a first-person "sắp 18" is 17 (minor), not V1's approximate adult 18. Previously pinned as `false`. Non-directional ("khoảng/tầm", "hơn", "sắp 20") unchanged.
  assert.equal(statesMinorAge("em sắp mười tám tuổi"), true, "directional: just under 18 = 17");
  assert.equal(statesMinorAge("em sắp 18 tuổi"), true, "digit twin (CONTRACT CHANGE M7-P5A.3, see above)");
  assert.equal(statesMinorAge("em sắp hai mươi tuổi"), false, "sắp 20 = 19: still an adult");
  assert.equal(statesMinorAge("Tôi hơn hai mươi tuổi"), false);
});

// ── V1 parity (digit twin vs written twin) ────────────────────────────────────────────────────────────────────────────────
const PARITY: Array<[digits: string, written: string]> = [
  ["Em 15 tuổi", "Em mười lăm tuổi"], ["Tôi 16 tuổi.", "Tôi mười sáu tuổi."], ["Mình 17 tuổi", "Mình mười bảy tuổi"], ["mình mới 14 tuổi", "mình mới mười bốn tuổi"],
  ["Tôi 25 tuổi", "Tôi hai mươi lăm tuổi"], ["Tôi 18 tuổi", "Tôi mười tám tuổi"], ["em 13 tuoi", "em muoi ba tuoi"], ["Em 12 tuổi, tập gì?", "Em mười hai tuổi, tập gì?"],
  ["giả sử em 16 tuổi", "giả sử em mười sáu tuổi"], ["Tôi không phải 16 tuổi", "Tôi không phải mười sáu tuổi"], ["Tôi chưa đủ 18 tuổi", "Tôi chưa đủ mười tám tuổi"],
  ["em khoảng 15 tuổi", "em khoảng mười lăm tuổi"], ["năm nay em 15 tuổi", "năm nay em mười lăm tuổi"], ["Tôi 30 tuổi", "Tôi ba mươi tuổi"],
];
PARITY.forEach(([d, w], i) => {
  test(`VA-parity ${i + 1}: "${d}" ≡ "${w}" (statesMinorAge, verdict status, minorBy)`, () => {
    assert.equal(statesMinorAge(w), statesMinorAge(d));
    for (const profile of [UNKNOWN, ADULT, { status: "OK", age: 16 } as ProfileAgeRead, { status: "FAILED", reason: "x" } as ProfileAgeRead]) {
      const a = resolveAgeVerdict(profile, d); const b = resolveAgeVerdict(profile, w);
      assert.equal(b.status, a.status); assert.deepEqual(b.minorBy, a.minorBy); assert.equal(b.conflict, a.conflict);
    }
    const dv = extractFactsFromText(d).ageYears; const seg = rewriteWrittenAgeSentences(w);
    if (dv && dv.status !== "NEGATED") { assert.equal(extractFactsFromText(seg[0]).ageYears?.value, dv.value); assert.equal(extractFactsFromText(seg[0]).ageYears?.status, dv.status); }
  });
});

test("VA-5 documented divergence from V1: V1 reads digits in a third-person sentence as the user's age; V2 reads NEITHER the digit nor the written form (owner decision C + M7-P5A.2.3)", () => {
  assert.equal(extractFactsFromText("Con tôi 15 tuổi").ageYears?.value, 15, "V1 has no third-person rule for digits (V1 itself is unchanged)");
  // CONTRACT CHANGE (owner decision M7-P5A.2.3): a third party's age — digits too — never becomes the authenticated user's age.
  // Previously pinned as `true` ("digit behaviour untouched"); V2 now skips a third-person sentence entirely instead of using V1's reading.
  assert.equal(statesMinorAge("Con tôi 15 tuổi"), false, "third-person digits are no longer the user's age in V2");
  assert.equal(statesMinorAge("Con tôi mười lăm tuổi"), false, "written third person never becomes the user's age");
});

// ── sources ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("VA-6 a written age is USER_REPORTED only: CURRENT_TURN / HISTORY, never PROFILE; it cannot lift or fake a profile age", () => {
  assert.deepEqual(verdictOf("Em mười lăm tuổi").minorBy, ["CURRENT_TURN"]);
  assert.deepEqual(verdictOf("Hôm nay tập gì?", ["Tôi mười sáu tuổi"]).minorBy, ["HISTORY"]);
  assert.deepEqual(verdictOf("Hôm nay tập gì?", ["Em mới mười ba."]).minorBy, ["HISTORY"]);
  const both = verdictOf("Em mười lăm tuổi", ["Tôi mười sáu tuổi"], { status: "OK", age: 16 });
  assert.deepEqual(both.minorBy, ["PROFILE", "CURRENT_TURN", "HISTORY"]);
  const adultProfile = verdictOf("Tôi mười sáu tuổi", [], ADULT);
  assert.equal(adultProfile.status, "MINOR"); assert.equal(adultProfile.conflict, true); assert.deepEqual(adultProfile.minorBy, ["CURRENT_TURN"]);
  const minorProfile = verdictOf("Tôi hai mươi lăm tuổi", [], { status: "OK", age: 16 });
  assert.equal(minorProfile.status, "MINOR"); assert.deepEqual(minorProfile.minorBy, ["PROFILE"]);
});

test("VA-7 a later adult self-report (digits or words) does not erase a written minor restriction", () => {
  for (const later of ["Tôi 25 tuổi", "Tôi hai mươi lăm tuổi", "À nhầm, tôi ba mươi tuổi rồi"]) {
    const v = verdictOf(later, ["Tôi mười sáu tuổi"]);
    assert.equal(v.status, "MINOR", later); assert.deepEqual(v.minorBy, ["HISTORY"]);
  }
  assert.equal(resolveAgeVerdict(UNKNOWN, "Tôi 25 tuổi", ["Em mới mười ba."]).status, "MINOR");
  assert.equal(resolveAgeVerdict(UNKNOWN, "Tôi 25 tuổi", [], true).status, "MINOR", "session flag");
});

test("VA-8 a written minor age in a multi-sentence text is found even when an adult digit age comes first (V1 alone keeps only the first)", () => {
  assert.equal(extractFactsFromText("Tôi 25 tuổi. Em mười sáu tuổi.").ageYears?.value, 25, "V1 alone");
  assert.equal(statesMinorAge("Tôi 25 tuổi. Em mười sáu tuổi."), true);
  assert.equal(statesMinorAge("Bạn tôi 40 tuổi.\nEm mười lăm tuổi, hôm nay tập gì?"), true);
  assert.equal(statesMinorAge("Con tôi mười lăm tuổi. Tôi hai mươi lăm tuổi."), false);
});

test("VA-9 more phrasing: separators, greetings, mixed accents, unaccented 'minh' only without any diacritic", () => {
  assert.equal(statesMinorAge("Dạ, em mười lăm tuổi ạ"), true);
  assert.equal(statesMinorAge("Hi coach! Tôi mười sáu tuổi, muốn tập ngực"), true);
  assert.equal(statesMinorAge("Còn em mười lăm tuổi thì sao?"), true, "còn (still) is not 'con' (child)");
  assert.equal(statesMinorAge("Nhưng mà em mười hai tuổi"), true, "mà (but) is not 'má'");
  assert.equal(statesMinorAge("minh muoi lam tuoi, nen tap gi"), true, "no diacritic anywhere → 'minh' = mình");
  assert.equal(statesMinorAge("Minh mười lăm tuổi, nên tập gì"), false, "diacritics present → 'Minh' is a name");
  assert.equal(statesMinorAge("Mình mười lăm tuổi, nên tập gì"), true);
  assert.equal(statesMinorAge("mình mới mười ba, tập gì"), true);
  assert.equal(statesMinorAge("em mới mười ba\nem muốn tập chân"), true);
  assert.equal(statesMinorAge("em mới mười ba rồi"), true);
  assert.equal(statesMinorAge("em mới mười ba nên chưa tập nặng"), true);
  assert.equal(statesMinorAge("em mới mười ba, tập 3 hiệp"), true);
});

// ── bounded / never throws ───────────────────────────────────────────────────────────────────────────────────────────────
test("VA-10 bounded + never throws: 4000-char cap, hostile input, non-strings; linear time", () => {
  const start = Date.now();
  const hostile = [
    "em ".repeat(20000), "mười ".repeat(20000), "em mới ".repeat(5000) + "mười lăm", "hai mươi ".repeat(8000), "\n".repeat(50000), "a".repeat(100000) + " em mười lăm tuổi",
    "em " + "mới ".repeat(3000) + "mười lăm", "\u0000\uD800 em mười lăm tuổi", "İİİ em mười lăm tuổi", "tuổi của em là ".repeat(3000),
  ];
  for (const h of hostile) { assert.doesNotThrow(() => rewriteWrittenAgeSentences(h)); assert.doesNotThrow(() => statesMinorAge(h)); }
  for (const v of [undefined, null, 42, {}, [], Symbol.iterator.toString()]) { assert.doesNotThrow(() => rewriteWrittenAgeSentences(v as never)); }
  assert.deepEqual(rewriteWrittenAgeSentences(undefined as never), []);
  assert.equal(rewriteWrittenAgeSentences("a".repeat(100000) + " em mười lăm tuổi").length, 0, "beyond the 4000-char scan cap");
  assert.equal(rewriteWrittenAgeSentences("em mười lăm tuổi " + "x ".repeat(5000)).length, 1);
  assert.ok(rewriteWrittenAgeSentences("em mười lăm tuổi. ".repeat(500)).length <= 8, "at most 8 phrases");
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start}ms`);
});

// ── REAL supervisor: session persistence ────────────────────────────────────────────────────────────────────────────────
const SESSION_STATEMENT = (s: ReturnType<typeof system>) => s.store;
async function storedMinor(s: ReturnType<typeof system>, now: number): Promise<boolean> {
  const r = await readSession(SESSION_STATEMENT(s), USER_A, SID);
  return r.status === "ok" && hasStatedMinorAge(reusableContext(r.raw, USER_A, SID, now).all);
}

test("VA-S1 (BACKEND INTEGRATION) turn 1 'Em mười lăm tuổi, hôm nay tập gì?' persists the written minor statement; later turns stay restricted", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  s.prov.training.script(say("Khởi động kỹ rồi tập nhẹ nhàng nhé."));
  // Gate 1 classifies "hôm nay tập gì?" (no 'của tôi'/plan words) as GENERAL_KNOWLEDGE → general-only answer (V1 minor note), not a block
  const r1 = await s.ask(USER_A, "Em mười lăm tuổi, hôm nay tập gì?");
  assert.equal(s.traces[0].ageGate?.status, "MINOR"); assert.equal(s.traces[0].ageGate?.decision, "GENERAL_ONLY");
  assert.equal(r1.status, "ANSWERED"); assert.match(r1.answer, /Vì bạn dưới 18 tuổi, hãy tập có huấn luyện viên/);
  assert.equal(await storedMinor(s, s.clock()), true, "persisted as the user's own USER_REPORTED statement");
  const modelCallsAfterT1 = s.modelRequests();
  const r2 = await s.ask(USER_A, "Lịch tập hôm nay của tôi là gì?");
  assert.equal(r2.status, "MINOR_PROTECTED");
  assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"], "from the session, not the profile");
  const r3 = await s.ask(USER_A, "Tôi 30 tuổi, mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(r3.status, "MINOR_PROTECTED", "a later adult claim does not lift it");
  const r4 = await s.ask(USER_A, "Tôi ba mươi tuổi rồi, lịch tập hôm nay của tôi là gì?");
  assert.equal(r4.status, "MINOR_PROTECTED");
  assert.equal(s.modelRequests(), modelCallsAfterT1, "the blocked turns made no model call");
  assert.deepEqual(s.w.calls, [], "no personal tool was called");
});

test("VA-S2 (BACKEND INTEGRATION) a written age stated in a turn that V1 input safety BLOCKS is persisted BEFORE the block; the next turn is restricted", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  const r1 = await s.ask(USER_A, "Em mười lăm tuổi, giảm 10kg trong 1 tuần được không?");
  assert.equal(r1.status, "SAFETY_BLOCKED");
  assert.equal(s.traces.length, 1); assert.equal(s.traces[0].ageGate, null, "stopped before Gate 1");
  assert.equal(await storedMinor(s, s.clock()), true, "written age persisted before the safety stop");
  const r2 = await s.ask(USER_A, "Hôm nay tôi tập gì?");
  assert.equal(r2.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"]);
  assert.equal(s.modelRequests(), 0);
});

test("VA-S3 (BACKEND INTEGRATION) no restriction is persisted for a third person, an experience statement or an adult written age", async () => {
  for (const q of ["Con tôi mười lăm tuổi, nó nên tập gì?", "Tôi tập mười lăm năm rồi, hôm nay tập gì?", "Tôi hai mươi lăm tuổi, hôm nay tập gì?", "người mười sáu tuổi có được tập gym không?", "Em mới mười lăm phút thôi, hôm nay tập gì?"]) {
    const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
    await s.ask(USER_A, q);
    assert.equal(await storedMinor(s, s.clock()), false, q);
    assert.ok(!s.traces.some((t) => t.ageGate?.status === "MINOR"), q);
  }
});

test("VA-S4 (BACKEND INTEGRATION) isolation: the restriction is scoped to the authenticated user + session, never another session", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 } });
  await s.ask(USER_A, "Tôi mười sáu tuổi, hôm nay tập gì?");
  const other = await s.ask(USER_A, "Hôm nay tôi tập gì?", { sessionId: "another-session-9" });
  assert.notEqual(other.status, "MINOR_PROTECTED", "a different session of the same user does not inherit a USER_REPORTED statement");
  assert.equal(s.traces.at(-1)!.ageGate?.status, "ADULT");
});

test("VA-S5 (BACKEND INTEGRATION) without a session store a written minor age still gates the CURRENT turn (and history passed by the client)", async () => {
  const s = system({ reader: { status: "PROFILE_OK", age: 30 }, withStore: false });
  assert.equal((await s.ask(USER_A, "Em mười lăm tuổi, lịch tập hôm nay của tôi là gì?")).status, "MINOR_PROTECTED");
  assert.deepEqual(s.traces[0].ageGate?.minorBy, ["CURRENT_TURN"]);
  const h = await s.ask(USER_A, "Hôm nay tôi tập gì?", { history: [{ role: "user", text: "Em mới mười ba." }, { role: "assistant", text: "Ok" }] });
  assert.equal(h.status, "MINOR_PROTECTED"); assert.deepEqual(s.traces[1].ageGate?.minorBy, ["HISTORY"]);
  await s.ask(USER_A, "Hôm nay tôi tập gì?");
  assert.equal(s.traces[2].ageGate?.status, "ADULT", "no store and no history: nothing carries over");});
