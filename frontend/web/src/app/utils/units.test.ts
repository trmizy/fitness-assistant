/**
 * Gym-onboarding project follow-up §13 — real, runnable coverage for
 * units.ts. This frontend project has no test runner configured (no
 * vitest/jest in package.json) — rather than bolt one on for four pure
 * functions, this uses node:test directly (zero extra dependencies, same
 * tool already used throughout this project's backend tests).
 *
 * Run with (from frontend/web):
 *   npx tsx --test src/app/utils/units.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cmFromFeetInches, feetInchesFromCm, kgFromLb, lbFromKg } from "./units";

test("cmFromFeetInches: 5'11\" -> 180.3cm (real-world reference value)", () => {
  assert.equal(cmFromFeetInches(5, 11), 180.3);
});

test("cmFromFeetInches: 6'0\" -> 182.9cm", () => {
  assert.equal(cmFromFeetInches(6, 0), 182.9);
});

test("feetInchesFromCm: 180cm -> 5'11\" (round trip approx of the above)", () => {
  const { feet, inches } = feetInchesFromCm(180);
  assert.equal(feet, 5);
  assert.equal(inches, 11);
});

test("feetInchesFromCm never returns 12 inches (carries into feet instead)", () => {
  // 182.9cm is exactly 6'0" — a naive round could produce 5'12".
  const { feet, inches } = feetInchesFromCm(182.9);
  assert.equal(feet, 6);
  assert.equal(inches, 0);
});

test("kgFromLb: 154 lb -> ~69.9 kg", () => {
  assert.equal(kgFromLb(154), 69.9);
});

test("lbFromKg: 70 kg -> ~154.3 lb", () => {
  assert.equal(lbFromKg(70), 154.3);
});

test("round trip: feet/inches -> cm -> feet/inches recovers the same value for whole-inch inputs", () => {
  for (const [feet, inches] of [[5, 6], [5, 11], [6, 0], [6, 2]] as const) {
    const cm = cmFromFeetInches(feet, inches);
    const back = feetInchesFromCm(cm);
    assert.equal(back.feet, feet, `feet mismatch for ${feet}'${inches}"`);
    assert.equal(back.inches, inches, `inches mismatch for ${feet}'${inches}"`);
  }
});

test("round trip: kg -> lb -> kg stays within 0.1kg rounding tolerance", () => {
  for (const kg of [50, 65.5, 80, 100.2]) {
    const lb = lbFromKg(kg);
    const back = kgFromLb(lb);
    assert.ok(Math.abs(back - kg) <= 0.1, `expected ${back} to be within 0.1 of ${kg}`);
  }
});
