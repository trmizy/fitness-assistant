/**
 * Onboarding's unit conversion. The expected values are the ones the wizard showed on the
 * emulator (71.3 kg → 157.2 lb, 68.5 kg → 151 lb).
 *
 * Runs with: npx tsx --test src/utils/__tests__/units.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cmFromFeetInches, feetInchesFromCm, kgFromLb, lbFromKg } from "../units";

describe("weight", () => {
  it("converts kg to lb and back to one decimal", () => {
    assert.equal(lbFromKg(71.3), 157.2);
    assert.equal(lbFromKg(68.5), 151);
    assert.equal(kgFromLb(157.2), 71.3);
    assert.equal(kgFromLb(151), 68.5);
  });
});

describe("height", () => {
  it("converts feet and inches to cm", () => {
    assert.equal(cmFromFeetInches(5, 11), 180.3);
    assert.equal(cmFromFeetInches(6, 0), 182.9);
  });

  it("converts cm to whole feet and inches", () => {
    assert.deepEqual(feetInchesFromCm(172), { feet: 5, inches: 8 });
    assert.deepEqual(feetInchesFromCm(180.3), { feet: 5, inches: 11 });
  });

  it("carries a rounded 12th inch into the next foot instead of showing 5ft 12in", () => {
    // 71.6 inches: 5 ft + 11.6 in, which rounds to 12.
    assert.deepEqual(feetInchesFromCm(71.6 * 2.54), { feet: 6, inches: 0 });
  });
});
