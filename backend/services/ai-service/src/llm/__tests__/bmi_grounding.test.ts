/**
 * V1 RC1 (2026-11-12) — B4-30 (REAL HTTP/API, rc-verify-v1b, persona 45 y, 170 cm, 70 kg → BMI 24.2): the answer said "chỉ số
 * BMI khoảng 20.8 (trong khoảng bình thường)". Trace: the prompt had age/gender/height but NO weight (coach_context skipped),
 * so the model invented a weight. Fix: one deterministic BMI (same formula body_composition_rules already used) shown in the
 * profile block when it can be computed; the model is told not to compute it; a post-LLM check corrects a wrong BMI figure,
 * removes a BMI figure that has no data behind it, and never applies ADULT categories to a minor.
 * Oracle: hand-computed BMI values; no case-specific hardcoding.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeBmi } from "../body_composition_rules";
import { groundBmiClaims } from "../bmi_claim_guard";
import { promptBuilder } from "../prompt_builder";
import { inputParser } from "../input_parser";
import { recommendationEngine } from "../recommendation_engine";

test("computeBmi: kg / m² rounded to 1 decimal; missing or implausible inputs → null; minors flagged", () => {
  assert.deepEqual(computeBmi({ heightCm: 170, weightKg: 70, age: 45 }), { value: 24.2, minor: false });
  assert.deepEqual(computeBmi({ heightCm: 158, weightKg: 52, age: 26 }), { value: 20.8, minor: false });
  assert.equal(computeBmi({ heightCm: 170, weightKg: undefined, age: 45 }), null);
  assert.equal(computeBmi({ heightCm: undefined, weightKg: 70, age: 45 }), null);
  assert.equal(computeBmi({ heightCm: 1.7, weightKg: 70, age: 45 }), null, "metres instead of cm is rejected, not guessed");
  assert.equal(computeBmi({ heightCm: 170, weightKg: 0, age: 45 }), null);
  assert.deepEqual(computeBmi({ heightCm: 160, weightKg: 55, age: 16 }), { value: 21.5, minor: true });
});

const B430 = "Dựa trên hồ sơ của bạn, bạn 45 tuổi, nam, chỉ số BMI khoảng 20.8 (trong khoảng bình thường), và mục tiêu là duy trì. Hãy tối ưu tập luyện trước.";

test("B4-30: a wrong BMI figure is replaced by the computed one and its adult category text is dropped", () => {
  const r = groundBmiClaims(B430, { bmi: { value: 24.2, minor: false }, lang: "vi" });
  assert.match(r.answer, /BMI khoảng 24\.2/);
  assert.doesNotMatch(r.answer, /20\.8/);
  assert.doesNotMatch(r.answer, /trong khoảng bình thường/);
  assert.match(r.answer, /mục tiêu là duy trì/, "the rest of the sentence stays");
  assert.equal(r.corrected, 1);
});

test("a correct BMI (within rounding) is left untouched", () => {
  const a = "Chỉ số BMI của bạn là 24,2, nằm ở mức cận trên.";
  assert.equal(groundBmiClaims(a, { bmi: { value: 24.2, minor: false }, lang: "vi" }).answer, a);
});

test("no data behind it → the sentence stating a BMI figure is removed", () => {
  const r = groundBmiClaims("BMI của bạn khoảng 22.5. Hãy tập đều đặn.", { bmi: null, lang: "vi" });
  assert.doesNotMatch(r.answer, /22\.5/);
  assert.match(r.answer, /Hãy tập đều đặn/);
  assert.equal(r.removed, 1);
});

test("a minor: adult BMI categories are never applied — figure kept, category dropped, BMI-for-age note added once", () => {
  const r = groundBmiClaims("BMI của em là 21.5, thuộc mức bình thường.", { bmi: { value: 21.5, minor: true }, lang: "vi" });
  assert.doesNotMatch(r.answer, /bình thường/);
  assert.match(r.answer, /theo tuổi và giới/);
  assert.equal((r.answer.match(/theo tuổi và giới/g) ?? []).length, 1);
});

test("English answers are handled the same way", () => {
  const r = groundBmiClaims("Your BMI of 20.8 is in the normal range, so focus on strength.", { bmi: { value: 24.2, minor: false }, lang: "en" });
  assert.match(r.answer, /BMI of 24\.2/);
  assert.doesNotMatch(r.answer, /normal range/);
});

test("profile weight vs weight stated this turn: the BMI follows the RESOLVED weight (the one the orchestrator puts on the profile)", async () => {
  const { resolveWeightForCalculation } = await import("../nutrition_engine");
  const resolved = resolveWeightForCalculation({ messageStatedWeightKg: 80, ignoreSavedData: false, profileWeightKg: 70 } as any);
  assert.equal(resolved.weightKg, 80, "the weight the user states now wins for this answer");
  const bmi = computeBmi({ heightCm: 170, weightKg: resolved.weightKg, age: 30 });
  assert.equal(bmi?.value, 27.7);
  const r = groundBmiClaims("Với 70kg hiện tại, BMI của bạn là 24.2.", { bmi, lang: "vi" });
  assert.match(r.answer, /BMI của bạn là 27\.7/, "a BMI computed from the stale profile weight is corrected");
});

test("a BMI given as an EXAMPLE (not the user's) is not touched", () => {
  const a = "Ví dụ, một người cao 1m70 nặng 70kg có BMI 24.2.";
  assert.equal(groundBmiClaims(a, { bmi: { value: 20.3, minor: false }, lang: "vi" }).answer, a);
});

test("BMI mentioned without a personal figure is not touched", () => {
  const a = "BMI không phân biệt cơ và mỡ, nên người nhiều cơ có thể có BMI cao.";
  assert.equal(groundBmiClaims(a, { bmi: null, lang: "vi" }).answer, a);
});

test("the prompt carries the precomputed BMI and tells the model not to compute one", () => {
  const profile: any = { age: 45, gender: "MALE", heightCm: 170, currentWeightKg: 70, goal: "MAINTENANCE", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } };
  const q = "Có nên uống thực phẩm chức năng tăng testosterone không?";
  const parsed = { ...inputParser.parse(q, profile), routeIntent: "general_fitness_knowledge" } as any;
  const prompt = promptBuilder.build(q, parsed, { profile, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], memories: [] } as any, { documents: [], isEmpty: true } as any, recommendationEngine.recommend(profile, parsed, "vi"), "vi", [], undefined);
  assert.match(prompt, /BMI \(tính sẵn[^)]*\): 24\.2/);
  assert.match(prompt, /không tự tính BMI/i);
  const noWeight = promptBuilder.build(q, parsed, { profile: { ...profile, currentWeightKg: undefined }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], memories: [] } as any, { documents: [], isEmpty: true } as any, recommendationEngine.recommend(profile, parsed, "vi"), "vi", [], undefined);
  assert.doesNotMatch(noWeight, /BMI \(tính sẵn/);
});
