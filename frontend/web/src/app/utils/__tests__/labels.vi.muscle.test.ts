/** ND-03: raw muscle codes / body regions / equipment never reach the screen. Run: npx tsx --test src/app/utils/__tests__/labels.vi.muscle.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyRegionLabel, equipmentLabel, muscleCodeLabel } from "../labels.vi";

test("muscleCodeLabel maps taxonomy codes to Vietnamese", () => {
  assert.equal(muscleCodeLabel("spinal_erectors"), "Cơ dựng sống");
  assert.equal(muscleCodeLabel("front_delts"), "Vai trước");
  assert.equal(muscleCodeLabel("transverse_abs"), "Cơ bụng ngang");
});

test("muscleCodeLabel never leaks snake_case for an unknown code", () => {
  assert.equal(muscleCodeLabel("some_new_muscle"), "some new muscle");
  assert.equal(muscleCodeLabel(null), "");
});

test("bodyRegionLabel handles both LOWER_BODY and lower_body", () => {
  assert.equal(bodyRegionLabel("LOWER_BODY"), "Thân dưới");
  assert.equal(bodyRegionLabel("full_body"), "Toàn thân");
  assert.equal(bodyRegionLabel("upper_body"), "Thân trên");
  assert.equal(bodyRegionLabel(undefined), "");
});

test("equipmentLabel maps BODYWEIGHT and falls back readable", () => {
  assert.equal(equipmentLabel("BODYWEIGHT"), "Tự trọng");
  assert.equal(equipmentLabel("SMITH_MACHINE"), "smith machine");
});
