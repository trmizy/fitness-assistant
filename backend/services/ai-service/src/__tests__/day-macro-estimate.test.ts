/**
 * "Tính macro cả ngày" (day-macro-estimate.ts): unit → gram estimates, deterministic fallback extraction, the chat trigger
 * (must never take over the existing target / what-if questions) and the formatted answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGrams, fallbackExtract, mealWord, mealsNamedIn, isRequestPhrase, isDayMacroRequest, itemMacros, formatDayEstimate, type DayEstimate } from "../services/day-macro-estimate";

test("household units become grams; non-gram units are labelled as estimates", () => {
  assert.deepEqual(resolveGrams("ức gà", 150, "g"), { grams: 150, source: "user", note: null });
  assert.equal(resolveGrams("cơm trắng", 2, "chén").grams, 300);
  assert.equal(resolveGrams("cơm trắng", 2, "chén").source, "unit_estimate");
  assert.match(resolveGrams("cơm trắng", 2, "chén").note!, /ước tính/);
  assert.equal(resolveGrams("phở bò", 1, "tô").grams, 500);
  assert.equal(resolveGrams("trứng gà luộc", 2, "quả").grams, 100);
  assert.equal(resolveGrams("chuối", 1, "quả").grams, 120);
  assert.equal(resolveGrams("bánh mì", 1, "ổ").grams, 100);
  assert.equal(resolveGrams("thịt bò", 2, "lạng").grams, 200);
  const none = resolveGrams("phở bò", null, null);
  assert.equal(none.grams, 500);
  assert.equal(none.source, "default_portion");
  assert.match(resolveGrams("món lạ", null, null).note!, /chưa rõ lượng/);
});

test("fallback extraction splits a day description into items with quantities and meals", () => {
  const items = fallbackExtract("sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà, tối 1 quả chuối");
  assert.deepEqual(items.map((i) => [i.food, i.quantity, i.unit, i.meal]), [
    ["phở bò", 1, "tô", "breakfast"], ["cơm", 2, "chén", "lunch"], ["ức gà", 150, "g", "lunch"], ["chuối", 1, "quả", "dinner"],
  ]);
});

test("the chat trigger needs an explicit compute ask AND eaten foods — target and what-if questions are left alone", () => {
  for (const q of ["Hôm nay tôi ăn 1 tô phở bò và 2 chén cơm, tính macro giúp", "Tính calo giúp mình: sáng 2 quả trứng, trưa 1 đĩa cơm tấm", "Hôm nay mình ăn 1 ổ bánh mì, 1 ly sữa thì được bao nhiêu calo?"])
    assert.equal(isDayMacroRequest(q), true, q);
  for (const q of ["Một ngày tôi cần bao nhiêu calo?", "Tôi nên ăn bao nhiêu protein mỗi ngày?", "Nếu tôi muốn ăn 2000 kcal với 160g protein thì carb và fat bao nhiêu gram?", "Tạo thực đơn cho tôi", "Con số 2370 kcal của tôi được tính như thế nào?"])
    assert.equal(isDayMacroRequest(q), false, q);
});

test("macros scale from the food's per-100 g values; the answer shows totals, the goal gap and that nothing was saved", () => {
  const rice = { calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 };
  assert.deepEqual(itemMacros(rice, 300), { calories: 390, protein: 8.1, carbs: 84.6, fat: 0.9 });
  const e: DayEstimate = {
    items: [{ mention: "cơm", mealType: "lunch", food: { id: "r", name: "Rice, white…", displayName: "Cơm trắng", per100g: rice }, grams: 300, gramsSource: "unit_estimate", unitNote: "1 chén/bát ≈ 150 g (ước tính)", match: "curated", ...itemMacros(rice, 300) },
      { mention: "bánh xèo", mealType: null, food: null, grams: null, gramsSource: null, unitNote: null, match: "none", calories: 0, protein: 0, carbs: 0, fat: 0 }],
    totals: { calories: 390, protein: 8.1, carbs: 84.6, fat: 0.9 }, goal: { calories: 2370, protein: 145, carbs: 299, fat: 66, source: "ACTIVE_GOAL" }, unmatched: ["bánh xèo"], notes: [],
  };
  const a = formatDayEstimate(e);
  assert.match(a, /\| Trưa \| Cơm trắng \| 300 g\* \| 390 \|/);
  assert.match(a, /còn thiếu 1980 kcal/);
  assert.match(a, /Món chưa tìm thấy: bánh xèo/);
  assert.match(a, /chưa lưu/);
});

test("'và' / 'với' split items (JS \b is ASCII-only, so they are matched by whitespace)", () => {
  assert.deepEqual(fallbackExtract("tối 1 quả chuối và 1 hộp sữa chua").map((i) => [i.food, i.quantity, i.unit]), [["chuối", 1, "quả"], ["sữa chua", 1, "hộp"]]);
  assert.deepEqual(fallbackExtract("200g cá hồi với 1 chén cơm gạo lứt").map((i) => i.food), ["cá hồi", "cơm gạo lứt"]);
});

test("'tôi' (I) is not 'tối' (evening): meals are matched with diacritics (live check 2026-11-08)", () => {
  assert.deepEqual(fallbackExtract("Hôm nay tôi ăn 1 tô phở bò, trưa 2 chén cơm và 150g ức gà").map((i) => [i.food, i.meal]), [
    ["phở bò", null], ["cơm", "lunch"], ["ức gà", "lunch"],
  ]);
  assert.equal(mealWord("tôi ăn 2 quả trứng"), null);
  assert.equal(mealWord("bữa tối mình ăn cá"), "dinner");
  assert.equal(mealWord("Tối nay: 1 quả chuối"), "dinner");
  assert.equal(mealWord("chiều ăn 1 hộp sữa chua"), "snack");
  assert.deepEqual([...mealsNamedIn("Hôm nay tôi ăn 1 tô phở bò, trưa 2 chén cơm")], ["lunch"]);
});

test("the ask itself is not a food item", () => {
  for (const t of ["tính macro giúp", "tính giúp mình", "bao nhiêu calo", "cho tôi biết"]) assert.equal(isRequestPhrase(t), true, t);
  for (const t of ["phở bò", "cơm tấm", "chả giò", "chuối", "giò lụa", "trứng"]) assert.equal(isRequestPhrase(t), false, t);
  assert.deepEqual(fallbackExtract("trưa 2 chén cơm và 150g ức gà, tính macro giúp").map((i) => i.food), ["cơm", "ức gà"]);
});
