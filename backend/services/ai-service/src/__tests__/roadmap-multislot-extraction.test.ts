/**
 * Found by the user in the real chat UI: "tôi 22 tuổi, cao 1m73, nặng 80kg, tôi là nam giới, mục tiêu của tôi là 70kg"
 * filled only age + height and re-asked current weight, gender and target weight.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractRoadmapSlotsFromMessage } from "../agent-workflow/workflows/roadmap.workflow";

test("one message with age, height, weight, gender and target fills every slot", () => {
  const k = extractRoadmapSlotsFromMessage("tôi 22 tuổi, cao 1m73, nặng 80kg, tôi là nam giới, mục tiêu của tôi là 70kg");
  assert.equal(k.age, 22);
  assert.equal(k.heightCm, 173);
  assert.equal(k.currentWeightKg, 80);
  assert.equal(k.gender, "MALE");
  assert.equal(k.targetWeight, 70);
});

test("phrasing variants", () => {
  const a = extractRoadmapSlotsFromMessage("Mình là nữ, 28 tuổi, cao 160cm, cân nặng 62kg, muốn xuống 55kg");
  assert.deepEqual([a.gender, a.age, a.heightCm, a.currentWeightKg, a.targetWeight], ["FEMALE", 28, 160, 62, 55]);
  const b = extractRoadmapSlotsFromMessage("mục tiêu 70kg, hiện nặng 80kg");
  assert.deepEqual([b.currentWeightKg, b.targetWeight], [80, 70]);
});

test("no over-eager guesses: 'năm' is not a gender, an unlabeled number is not a weight, 1m73 is not a weight", () => {
  const k = extractRoadmapSlotsFromMessage("tôi tập được 3 năm rồi, cao 1m73");
  assert.equal(k.gender, undefined);
  assert.equal(k.currentWeightKg, undefined);
  assert.equal(k.targetWeight, undefined);
  assert.equal(k.heightCm, 173);
});

import { parseTargetWeightKg, parseWeightKg } from "../agent-workflow/slot-values";
test("answering the target slot: 'muốn xuống 72kg' beats the '73' inside '1m73' and the current weight 80kg", () => {
  const r = parseTargetWeightKg("với chiều cao 1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp");
  assert.deepEqual(r, { ok: true, value: 72 });
});
test("plain answers and self-corrections are unchanged; the current-weight slot prefers 'nặng/hiện tại'", () => {
  assert.deepEqual(parseTargetWeightKg("74kg"), { ok: true, value: 74 });
  assert.deepEqual(parseWeightKg("72 kg... à không 70 kg"), { ok: true, value: 70 });
  assert.deepEqual(parseWeightKg("cao 1m73, nặng 80kg, muốn xuống 72kg"), { ok: true, value: 80 });
});
