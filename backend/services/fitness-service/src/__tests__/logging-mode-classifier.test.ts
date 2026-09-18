import test from "node:test";
import assert from "node:assert/strict";
import {
  LOADED_CARRY_EXERCISE_NAMES,
  loadedCarryLoggingModeWhere,
} from "../utils/logging-mode-classifier";

test("loaded-carry logging-mode seed is an explicit carry allowlist, not every loaded hold", () => {
  const where = loadedCarryLoggingModeWhere();

  assert.deepEqual(where.exerciseName.in, [...LOADED_CARRY_EXERCISE_NAMES]);
  assert.equal(where.movementPattern, "CARRY");
  assert.equal(where.loggingMode.not, "TIME_LOAD");
  assert.equal("type" in where, false);
  assert.equal("typeOfEquipment" in where, false);
});
