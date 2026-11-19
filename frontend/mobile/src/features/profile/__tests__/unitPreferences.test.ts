/**
 * Account-scoped display units (UserProfile.unitSystem / energyUnit — the same fields web's Settings writes).
 * Pure helpers; runs with `tsx --test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { energyLabel, heightLabel, unitPreferencesFromProfile, weightLabel } from "../unitPreferences";
import { caloriesLabel } from "../../library/foodLibrary";

describe("unitPreferencesFromProfile", () => {
  it("reads what web saved", () => {
    assert.deepEqual(unitPreferencesFromProfile({ unitSystem: "imperial", energyUnit: "kj" }), { unitSystem: "imperial", energyUnit: "kj" });
  });
  it("falls back to metric / kcal for no profile, missing or unknown values", () => {
    const fallback = { unitSystem: "metric", energyUnit: "kcal" };
    assert.deepEqual(unitPreferencesFromProfile(null), fallback);
    assert.deepEqual(unitPreferencesFromProfile(undefined), fallback);
    assert.deepEqual(unitPreferencesFromProfile({}), fallback);
    assert.deepEqual(unitPreferencesFromProfile({ unitSystem: "stone", energyUnit: "btu" }), fallback);
  });
});

describe("labels", () => {
  it("energy: kcal rounds, kJ converts with web's factor (4.184)", () => {
    assert.equal(energyLabel(100.4, "kcal"), "100 kcal");
    assert.equal(energyLabel(100, "kj"), "418 kJ");
    assert.equal(caloriesLabel(100), "100 kcal");
    assert.equal(caloriesLabel(100, "kj"), "418 kJ");
  });
  it("weight and height follow the unit system", () => {
    assert.equal(weightLabel(70, "metric"), "70 kg");
    assert.equal(weightLabel(70, "imperial"), "154.3 lb");
    assert.equal(heightLabel(175, "metric"), "175 cm");
    assert.equal(heightLabel(175, "imperial"), `5'9"`);
  });
});
