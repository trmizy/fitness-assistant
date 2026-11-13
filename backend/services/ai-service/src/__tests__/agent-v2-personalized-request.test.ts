/**
 * V2 M7-P5A.2.2 — personalised HIGH_RISK request detector (Gate 1, AGE_UNKNOWN fail-closed). Pure unit test: TEST FIXTURE
 * sentences (invented), no supervisor, no model, no network, DB or Redis. `hr` records what V1's classifyMinorRequest says about
 * each sentence — only HIGH_RISK ones ever reach the detector in production.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isPersonalizedHighRiskRequest } from "../agent-v2/personalized-request";
import { classifyMinorRequest } from "../llm/minor_safety_policy";

interface Case { q: string; personal: boolean; hr: boolean; tag?: "unaccented" | "no-pronoun" | "pronoun" }

const CASES: Case[] = [
  // ── the three target sentences (personalised, no "của tôi") ──
  { q: "Uống mấy muỗng whey mỗi ngày?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Giảm 5 kg trong 2 tuần thế nào?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Tăng protein lên bao nhiêu để giảm mỡ nhanh?", personal: true, hr: false, tag: "no-pronoun" }, // not HIGH_RISK in V1 → never reaches Gate 1's block
  // ── personalised: dose / quantity / target / plan / intensity ──
  { q: "Mình nên uống creatine bao nhiêu gam mỗi ngày?", personal: true, hr: true, tag: "pronoun" },
  { q: "Tôi nên uống bao nhiêu creatine mỗi ngày?", personal: true, hr: true, tag: "pronoun" },
  { q: "Uong may vien bcaa truoc khi tap?", personal: true, hr: true, tag: "unaccented" },
  { q: "Giam 3kg trong 10 ngay co duoc khong?", personal: true, hr: true, tag: "unaccented" },
  { q: "Lên kế hoạch cắt calo xuống 1200 kcal giúp mình", personal: true, hr: true },
  { q: "Cho mình thực đơn nhịn ăn 7 ngày để giảm cân", personal: true, hr: true },
  { q: "Tập HIIT 7 ngày một tuần được không?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Tập tối đa sức mỗi ngày được không?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Muốn giảm mỡ nhanh thì cắt bao nhiêu calo mỗi ngày?", personal: true, hr: false, tag: "no-pronoun" },
  { q: "Làm sao để xuống 60 kg trước Tết?", personal: true, hr: false, tag: "no-pronoun" },
  { q: "Nen an bao nhieu calo de giam can nhanh?", personal: true, hr: false, tag: "unaccented" },
  { q: "Liều creatine cho người mới tập là mấy gam?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Tập squat tạ tối đa mấy lần một tuần?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Lập cho em lịch tập max sức 2 buổi mỗi ngày", personal: true, hr: true },
  { q: "Mỗi sáng nên uống 2 viên thuốc giảm cân nào?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Tang 4 kg co trong 1 thang bang cach nao?", personal: true, hr: false, tag: "unaccented" },
  { q: "Pre workout nên dùng bao nhiêu scoop?", personal: true, hr: true, tag: "no-pronoun" },
  { q: "Cách giảm cân nhanh nhất cho dân văn phòng?", personal: true, hr: false, tag: "no-pronoun" },
  { q: "Nhịn ăn 16 tiếng mỗi ngày để giảm mỡ được không?", personal: true, hr: true, tag: "no-pronoun" },
  // ── general / educational / impersonal (must stay answerable) ──
  { q: "Whey protein là gì?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Creatine hoạt động như thế nào?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Creatine có an toàn không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Tập nặng có làm tăng nguy cơ đột quỵ không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Tại sao không nên nhịn ăn để giảm cân?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Người ta thường giảm bao nhiêu kg mỗi tháng là an toàn?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Vận động viên thường dùng bao nhiêu creatine?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "BCAA khác gì so với whey?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "HIIT là gì và có lợi ích gì?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Cơ chế đốt mỡ của cardio cường độ cao là gì?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Thuốc giảm cân có tác dụng phụ gì?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Whey có gây mụn không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Nhịn ăn gián đoạn có thật sự hiệu quả không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Phụ nữ mang thai có dùng được creatine không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Khuyến cáo của WHO về thực phẩm chức năng cho người lớn là gì?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Tin đồn whey làm hại thận có đúng không?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Việc cắt calo quá mức ảnh hưởng gì đến cơ thể?", personal: false, hr: true, tag: "no-pronoun" },
  { q: "Giam can nhanh co hai khong?", personal: false, hr: false, tag: "unaccented" },
  { q: "Creatine monohydrate la gi?", personal: false, hr: true, tag: "unaccented" },
  { q: "Tai sao tap nang lai de bi chan thuong?", personal: false, hr: true, tag: "unaccented" },
  { q: "Steroid ảnh hưởng thế nào đến hormone?", personal: false, hr: true, tag: "no-pronoun" },
  // ── a first-person pronoun must NOT by itself flip the result ──
  { q: "Tôi thấy whey là gì nhỉ?", personal: false, hr: true, tag: "pronoun" },
  { q: "Mình nghe nói creatine hoạt động thế nào?", personal: false, hr: true, tag: "pronoun" },
  { q: "Em muốn biết creatine có an toàn không?", personal: false, hr: true, tag: "pronoun" },
  { q: "Tôi nghe người ta bảo nhịn ăn có hại, đúng không?", personal: false, hr: true, tag: "pronoun" },
  { q: "Tui tò mò vận động viên dùng bao nhiêu whey?", personal: false, hr: true, tag: "pronoun" },
  { q: "Em hay uống whey sau khi tập.", personal: false, hr: true, tag: "pronoun" },
  { q: "Mình đang tập HIIT, thấy vui lắm.", personal: false, hr: true, tag: "pronoun" },
];

test("PR-1 corpus: size and coverage requirements", () => {
  assert.ok(CASES.length >= 40, `${CASES.length} sentences`);
  assert.ok(CASES.filter((c) => c.personal).length >= 15);
  assert.ok(CASES.filter((c) => !c.personal).length >= 15);
  assert.ok(CASES.filter((c) => c.tag === "unaccented").length >= 5);
  assert.ok(CASES.filter((c) => c.tag === "no-pronoun").length >= 5);
  assert.ok(CASES.filter((c) => c.tag === "pronoun").length >= 5);
  assert.equal(new Set(CASES.map((c) => c.q)).size, CASES.length, "no duplicate sentences");
});

test("PR-2 every sentence is classified as expected", () => {
  const wrong = CASES.filter((c) => isPersonalizedHighRiskRequest(c.q) !== c.personal).map((c) => `${c.personal ? "expected TRUE" : "expected FALSE"}: ${c.q}`);
  assert.deepEqual(wrong, []);
});

test("PR-3 the three target sentences are personalised", () => {
  for (const q of ["Uống mấy muỗng whey mỗi ngày?", "Giảm 5 kg trong 2 tuần thế nào?", "Tăng protein lên bao nhiêu để giảm mỡ nhanh?"]) {
    assert.equal(isPersonalizedHighRiskRequest(q), true, q);
  }
});

test("PR-4 HIGH_RISK status per V1 classifier is as documented (only HIGH_RISK sentences reach Gate 1's block)", () => {
  const wrong = CASES.filter((c) => (classifyMinorRequest(c.q) === "HIGH_RISK") !== c.hr).map((c) => `${classifyMinorRequest(c.q)}: ${c.q}`);
  assert.deepEqual(wrong, []);
  // the personalised sentences V1 does not rate HIGH_RISK: harmless to Gate 1 (it never calls the detector for them) — a V1 dependency
  const unreachable = CASES.filter((c) => c.personal && !c.hr).map((c) => c.q);
  assert.ok(unreachable.length >= 1);
  // every personalised sentence that IS HIGH_RISK is therefore one Gate 1 will block for an unknown-age user
  const reachable = CASES.filter((c) => c.personal && c.hr);
  assert.ok(reachable.length >= 15, `${reachable.length}`);
  for (const c of reachable) assert.equal(classifyMinorRequest(c.q), "HIGH_RISK", c.q);
});

test("PR-5 a pronoun alone does not decide: same sentence with and without the pronoun agrees", () => {
  const pairs: Array<[string, string]> = [
    ["Whey protein là gì?", "Tôi muốn hỏi whey protein là gì?"],
    ["Creatine có an toàn không?", "Mình thắc mắc creatine có an toàn không?"],
    ["Uống mấy muỗng whey mỗi ngày?", "Tôi uống mấy muỗng whey mỗi ngày?"],
    ["Giảm 5 kg trong 2 tuần thế nào?", "Em giảm 5 kg trong 2 tuần thế nào?"],
  ];
  for (const [bare, withPronoun] of pairs) assert.equal(isPersonalizedHighRiskRequest(withPronoun), isPersonalizedHighRiskRequest(bare), withPronoun);
  // a pronoun with no other signal is not personalised
  for (const q of ["Tôi", "Mình thích whey", "Em đang tập", "Tui uống creatine rồi"]) assert.equal(isPersonalizedHighRiskRequest(q), false, q);
});

test("PR-6 accented, unaccented and mixed spellings agree", () => {
  const triples: Array<[string, string, string]> = [
    ["Uống mấy muỗng whey mỗi ngày?", "Uong may muong whey moi ngay?", "Uống may muong whey mỗi ngay?"],
    ["Giảm 5 kg trong 2 tuần thế nào?", "Giam 5 kg trong 2 tuan the nao?", "Giảm 5 kg trong 2 tuan thế nào?"],
    ["Creatine có an toàn không?", "Creatine co an toan khong?", "Creatine có an toan không?"],
    ["Whey protein là gì?", "Whey protein la gi?", "Whey protein là gi?"],
  ];
  for (const t of triples) { const r = t.map((q) => isPersonalizedHighRiskRequest(q)); assert.equal(new Set(r).size, 1, t.join(" | ")); }
});

test("PR-7 known ambiguity: a feasibility question about a stated target + timeframe is personalised (fail-closed)", () => {
  assert.equal(isPersonalizedHighRiskRequest("Giảm 5 kg trong 2 tuần được không?"), true);
  // …but an educational question that names no quantity of the user's own is not
  assert.equal(isPersonalizedHighRiskRequest("Giảm cân quá nhanh có nguy hiểm không?"), false);
});

test("PR-8 robust on any input: empty, whitespace, punctuation, non-string, very long, never throws", () => {
  for (const v of ["", "   ", "?!.", "\n\t", "🙂🙂", "a".repeat(100_000), "mỗi ngày ".repeat(5_000)]) {
    assert.doesNotThrow(() => isPersonalizedHighRiskRequest(v));
    assert.equal(typeof isPersonalizedHighRiskRequest(v), "boolean");
  }
  for (const v of [undefined, null, 42, {}, [], Symbol.iterator] as unknown[]) {
    assert.doesNotThrow(() => isPersonalizedHighRiskRequest(v as string));
    assert.equal(isPersonalizedHighRiskRequest(v as string), false);
  }
  assert.equal(isPersonalizedHighRiskRequest(""), false);
});

test("PR-9 pure and bounded: same answer on repeat, adversarial long input is fast", () => {
  const q = "Uống mấy muỗng whey mỗi ngày?";
  assert.equal(isPersonalizedHighRiskRequest(q), isPersonalizedHighRiskRequest(q));
  const t0 = Date.now();
  isPersonalizedHighRiskRequest("giảm ".repeat(20_000) + "trong ".repeat(20_000));
  isPersonalizedHighRiskRequest("bao nhiêu ".repeat(20_000));
  assert.ok(Date.now() - t0 < 2_000, `${Date.now() - t0} ms`);
});

// ── M7-P5A.2.2 second signal: aggressive body-change request (for sentences V1 does not rate HIGH_RISK) ──────────────────
import { isAggressiveBodyChangeRequest } from "../agent-v2/personalized-request";
import { classifyMinorRequest as classifyForAgg } from "../llm/minor_safety_policy";
test("PR-10 isAggressiveBodyChangeRequest: aggressive body-change asks → true (incl. one V1 rates GENERAL_KNOWLEDGE); plans, doses, education → false", () => {
  const yes = ["Tăng protein lên bao nhiêu để giảm mỡ nhanh?", "Làm sao để xuống 60 kg trước Tết?", "Cách giảm cân nhanh nhất cho dân văn phòng?", "Giảm 5 kg trong 2 tuần thế nào?", "Tang 4 kg co trong 1 thang bang cach nao?", "Muon giam mo gap thi lam sao?"];
  const no = [
    "Giảm cân nhanh có hại không?", "Tại sao không nên giảm mỡ quá nhanh?", "Người ta thường giảm bao nhiêu kg mỗi tháng là an toàn?",
    "Lập lịch tập 3 buổi một tuần giúp mình", "Whey protein là gì?", "Mỗi ngày nên uống bao nhiêu nước?", "Thực đơn cân bằng cho bữa sáng gồm những gì?",
    "Hôm nay tôi nên tập gì?", "Uống mấy muỗng whey mỗi ngày?", "", "   ",
  ];
  for (const q of yes) assert.equal(isAggressiveBodyChangeRequest(q), true, q);
  for (const q of no) assert.equal(isAggressiveBodyChangeRequest(q), false, q);
  assert.equal(classifyForAgg("Tăng protein lên bao nhiêu để giảm mỡ nhanh?"), "GENERAL_KNOWLEDGE", "the reason a second signal exists: V1 does not rate it HIGH_RISK");
  for (const bad of [null, undefined, 42, {}, "x".repeat(100_000)]) assert.doesNotThrow(() => isAggressiveBodyChangeRequest(bad as never));
});
