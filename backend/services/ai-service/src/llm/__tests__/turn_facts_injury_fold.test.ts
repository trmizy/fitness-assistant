import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTurnFacts } from "../turn_facts";

// Found by the Nova Pro recheck (REAL HTTP/API, 2026-11-12): "đầu gối" (knee — body part) and "đau gối" (knee PAIN) both fold
// to "dau goi", so a plain technique question was turned into an ASSERTED injury and the model answered
// "Với tình trạng đau gối…" to users with no injury (recheck B1-17, B2-21, B3-19). Same collision class as tạ đơn / tạ đòn.
// Expected values are written from the Vietnamese meaning.
const inj = (q: string) => extractTurnFacts(q, {}).injuries;

test("body part 'đầu gối' / 'đầu' is never an injury", () => {
  for (const q of [
    "Squat thế nào cho đúng kỹ thuật, đầu gối có được vượt qua mũi chân không?",
    "Squat xuống sâu đến đâu thì an toàn cho đầu gối?",
    "Khi tập lunge, đầu gối có được vượt qua mũi chân không?",
    "Đầu gối tôi hay kêu lục cục khi lên xuống cầu thang", // noise, no pain stated
  ]) assert.equal(inj(q), undefined, q);
});

test("stated pain is still an injury (accented input)", () => {
  const f = inj("Tôi bị đau gối khi squat");
  assert.equal(f?.status, "ASSERTED");
  assert.deepEqual(f?.value, ["dau goi"]); // existing folded value format (turn_facts_review_fixes.test.ts relies on it)
  assert.ok(inj("Em đau lưng dưới mỗi khi deadlift")?.value.length);
});

test("unaccented input: 'bi dau goi' is pain; a bare 'dau goi' is ambiguous and not asserted", () => {
  assert.equal(inj("toi bi dau goi khi squat")?.status, "ASSERTED");
  assert.equal(inj("dau goi co duoc vuot mui chan khong"), undefined);
});

test("negated pain stays out", () => {
  assert.equal(inj("Tôi không đau lưng, chỉ muốn tập nặng hơn"), undefined);
});
