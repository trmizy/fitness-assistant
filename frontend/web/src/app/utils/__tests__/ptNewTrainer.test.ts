import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_TRAINER_DESCRIPTION, NEW_TRAINER_LABEL, isNewTrainerPt } from "../ptNewTrainer";

test("label and description are the approved Vietnamese copy", () => {
  assert.equal(NEW_TRAINER_LABEL, "Mới trên Gymini");
  assert.equal(NEW_TRAINER_DESCRIPTION, "PT mới gia nhập nền tảng trong 30 ngày qua");
});

test("isNewTrainerPt is true only for an explicit true (older API responses without the field show no badge)", () => {
  assert.equal(isNewTrainerPt({ isNewTrainer: true }), true);
  assert.equal(isNewTrainerPt({ isNewTrainer: false }), false);
  assert.equal(isNewTrainerPt({}), false);
  assert.equal(isNewTrainerPt({ isNewTrainer: "true" }), false);
  assert.equal(isNewTrainerPt(null), false);
  assert.equal(isNewTrainerPt(undefined), false);
});
