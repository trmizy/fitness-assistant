/**
 * Regression test for Settings Center → Units
 * (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md §9). `unitSystem`/
 * `energyUnit` are display-only preferences layered onto the existing
 * `PUT /profile/me` upsert contract — canonical storage (heightCm,
 * currentWeight, calories, ...) never changes shape or unit anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../models/profile.models";

test("profileSchema: accepts unitSystem 'metric' and 'imperial'", () => {
  for (const value of ["metric", "imperial"] as const) {
    const result = profileSchema.safeParse({ unitSystem: value });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.unitSystem, value);
  }
});

test("profileSchema: accepts energyUnit 'kcal' and 'kj'", () => {
  for (const value of ["kcal", "kj"] as const) {
    const result = profileSchema.safeParse({ energyUnit: value });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.energyUnit, value);
  }
});

test("profileSchema: unitSystem/energyUnit are optional — omitting them still validates", () => {
  const result = profileSchema.safeParse({ age: 25 });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.unitSystem, undefined);
    assert.equal(result.data.energyUnit, undefined);
  }
});

test("profileSchema: rejects an unrecognized unitSystem value", () => {
  const result = profileSchema.safeParse({ unitSystem: "yards" });
  assert.equal(result.success, false);
});

test("profileSchema: rejects an unrecognized energyUnit value", () => {
  const result = profileSchema.safeParse({ energyUnit: "calories" });
  assert.equal(result.success, false);
});
