/**
 * Regression test for Part 9 (safety triage): a medical condition
 * (kidney/liver/heart disease, diabetes) combined with a nutrition
 * question must never receive a personalized numeric recommendation as if
 * the person were a healthy adult — it must route to a support-and-refer
 * response instead. Covers the spec's own E2E example: "Tôi bị bệnh thận,
 * có nên ăn 180g protein không?"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { safetyGuard } from "../safety_guard";

test("BUG REPORT E2E #6: kidney disease + high protein question triggers medical nutrition triage, not personalized advice", () => {
  const result = safetyGuard.check("Tôi bị bệnh thận, có nên ăn 180g protein không?");
  assert.equal(result.type, "medical_nutrition_condition");
});

test("liver disease + diet question triggers triage", () => {
  const result = safetyGuard.check("Tôi bị suy gan, chế độ ăn nên như thế nào?");
  assert.equal(result.type, "medical_nutrition_condition");
});

test("heart disease + calorie question triggers triage", () => {
  const result = safetyGuard.check("Tôi có bệnh tim, nên ăn bao nhiêu calo mỗi ngày?");
  assert.equal(result.type, "medical_nutrition_condition");
});

test("diabetes + macro question triggers triage", () => {
  const result = safetyGuard.check("Tôi bị tiểu đường, ăn bao nhiêu carb thì hợp lý?");
  assert.equal(result.type, "medical_nutrition_condition");
});

test("mentioning a condition WITHOUT a nutrition question does not trigger triage (stays in normal flow)", () => {
  const result = safetyGuard.check("Tôi bị bệnh thận, có tập gym được không?");
  assert.notEqual(result.type, "medical_nutrition_condition");
});

test("an ordinary protein question with no medical condition is unaffected", () => {
  const result = safetyGuard.check("Tôi nên ăn bao nhiêu protein mỗi ngày?");
  assert.equal(result.type, "safe");
});

test("does not collide with the medical-emergency gate (heart ATTACK symptom stays medical_emergency)", () => {
  const result = safetyGuard.check("Tôi bị đau tim và khó thở đột ngột");
  assert.equal(result.type, "medical_emergency");
});

test("messageVi is non-empty and does not contain a specific personalized gram number", () => {
  const result = safetyGuard.check("Tôi bị bệnh thận, có nên ăn 180g protein không?");
  if (result.type === "medical_nutrition_condition") {
    assert.ok(result.messageVi.length > 0);
    assert.doesNotMatch(result.messageVi, /180\s*g/);
  } else {
    assert.fail("expected medical_nutrition_condition");
  }
});
