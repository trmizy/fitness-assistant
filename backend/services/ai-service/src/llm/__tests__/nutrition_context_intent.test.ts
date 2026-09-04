/**
 * Root-cause regression test for the AI-nutrition bug report: every one of
 * the 6 reported questions returned the identical "no saved meal plan for
 * today" canned answer instead of ever reaching the LLM/deterministic
 * engine. detectNutritionLookupIntent() is the gate that caused this — its
 * old hasNutritionSignal()-only check matched a bare mention of "protein",
 * "carb", "calo", "ăn", "dinh dưỡng" etc, which is present in nearly every
 * nutrition question. These tests lock down that NONE of the reported
 * questions are misrouted into the lookup path, while genuine "show me
 * today's saved meals" requests still are.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectNutritionLookupIntent } from "../nutrition_context";

// ── The 6 exact reported questions must NOT trigger the lookup shortcut ──

test("BUG REPORT #1: meal-plan CREATE request is not misrouted to lookup", () => {
  const result = detectNutritionLookupIntent(
    "Giúp tôi lên thực đơn ăn uống tăng cơ trong 1 tuần, tôi nặng 76kg.",
  );
  assert.equal(result.enabled, false);
});

test("BUG REPORT #2: explicit 'ignore saved data, estimate maintenance calories' is not misrouted to lookup", () => {
  const result = detectNutritionLookupIntent(
    "Bỏ qua dữ liệu đã lưu. Hãy ước tính calo duy trì và hỏi tôi nếu thiếu dữ liệu.",
  );
  assert.equal(result.enabled, false);
});

test("BUG REPORT #3: macro/calorie ANALYZE request is not misrouted to lookup", () => {
  const result = detectNutritionLookupIntent(
    "Đánh giá 3000 kcal, 150g protein, 200g carb, 65g fat và kiểm tra tổng calo.",
  );
  assert.equal(result.enabled, false);
});

test("BUG REPORT #4: general protein-requirement QA is not misrouted to lookup", () => {
  const result = detectNutritionLookupIntent("Tôi nên ăn bao nhiêu protein mỗi ngày?");
  assert.equal(result.enabled, false);
});

test("BUG REPORT #5: food-safety analysis question is not misrouted to lookup", () => {
  const result = detectNutritionLookupIntent(
    "Thực đơn toàn bột protein, phô mai và cá khô có an toàn không?",
  );
  assert.equal(result.enabled, false);
});

test("BUG REPORT #6a: 'như thực đơn ở trên' follow-up is not misrouted to lookup (must reach LLM with chat history)", () => {
  const history = [
    { question: "Cho tôi thực đơn giảm mỡ", answer: "Đây là thực đơn: ..." },
  ];
  const result = detectNutritionLookupIntent("Như thực đơn ở trên có ổn không?", history);
  assert.equal(result.enabled, false);
});

test("BUG REPORT #6b: 'ăn như vậy' follow-up is not misrouted to lookup", () => {
  const history = [
    { question: "Cho tôi thực đơn giảm mỡ", answer: "Đây là thực đơn: ..." },
  ];
  const result = detectNutritionLookupIntent("Ăn như vậy có phù hợp không?", history);
  assert.equal(result.enabled, false);
});

test("BUG REPORT #6c: 'bạn vừa đề xuất' follow-up is not misrouted to lookup", () => {
  const history = [
    { question: "Cho tôi thực đơn giảm mỡ", answer: "Đây là thực đơn: ..." },
  ];
  const result = detectNutritionLookupIntent("Bạn vừa đề xuất có đủ chất xơ không?", history);
  assert.equal(result.enabled, false);
});

// ── Genuine lookup requests must STILL work — this is not a blanket disable ──

test("genuine lookup: 'hôm nay tôi ăn gì' (asking what was logged/planned today) is still routed to lookup", () => {
  const result = detectNutritionLookupIntent("Hôm nay tôi ăn gì?");
  assert.equal(result.enabled, true);
  assert.equal(result.reason, "explicit_saved_nutrition_lookup");
});

test("genuine lookup: 'thực đơn hôm nay của tôi' is still routed to lookup", () => {
  const result = detectNutritionLookupIntent("Thực đơn hôm nay của tôi có gì?");
  assert.equal(result.enabled, true);
});

test("genuine lookup: explicit 'xem thực đơn đã lưu' is still routed to lookup", () => {
  const result = detectNutritionLookupIntent("Cho tôi xem thực đơn đã lưu của ngày mai");
  assert.equal(result.enabled, true);
  assert.ok(result.targetDate);
});

test("genuine follow-up lookup: short date follow-up inside an active lookup-ish conversation still resolves", () => {
  const history = [
    { question: "Hôm nay tôi ăn gì?", answer: "Mục tiêu đang lưu: 2000 kcal..." },
  ];
  const result = detectNutritionLookupIntent("Còn ngày mai thì sao?", history);
  assert.equal(result.enabled, true);
});

// ── Date resolver sanity ──────────────────────────────────────────────────

test("date resolver: explicit dd/mm date is parsed for a genuine lookup", () => {
  const result = detectNutritionLookupIntent("Cho tôi xem thực đơn ngày 15/8");
  assert.equal(result.enabled, true);
  assert.match(result.targetDate ?? "", /-08-15$/);
});
