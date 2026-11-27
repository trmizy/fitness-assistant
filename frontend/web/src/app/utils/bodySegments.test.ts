import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { FRONT_MUSCLES, BACK_MUSCLES } = createRequire(import.meta.url)("body-muscles") as { FRONT_MUSCLES: Array<{ id: string }>; BACK_MUSCLES: Array<{ id: string }> };
import { segmentValues, availableMetrics, limbBalance, regionSegment, regionAnatomyCode, ANATOMY_CODES } from "./bodySegments";

const sheet = { rightArmMuscle: 3.2, leftArmMuscle: 3.0, trunkMuscle: 25.4, rightLegMuscle: 9.1, leftLegMuscle: 9.0, rightArmFat: null, trunkFat: 0 };

test("segmentValues reads real fields, null when missing or non-positive, delta vs previous sheet", () => {
  const v = segmentValues(sheet, "lean", { rightArmMuscle: 3.0, trunkMuscle: null });
  assert.deepEqual(v.map((x) => x.kg), [3.2, 3.0, 25.4, 9.1, 9.0]);
  assert.equal(v[0].deltaKg, 0.2);
  assert.equal(v[2].deltaKg, null); // previous trunk missing -> no fake comparison
  assert.deepEqual(segmentValues(sheet, "fat").map((x) => x.kg), [null, null, null, null, null]);
});

test("availableMetrics offers only metrics with at least one value", () => {
  assert.deepEqual(availableMetrics(sheet), ["lean"]);
  assert.deepEqual(availableMetrics({ weight: 70 }), []);
  assert.deepEqual(availableMetrics(null), []);
});

test("limbBalance follows the 5 % / 10 % product rule and names the weaker side", () => {
  assert.equal(limbBalance(3.2, 3.0)?.tone, "mild"); // 6.3 %
  assert.equal(limbBalance(3.2, 3.0)?.weaker, "trái");
  assert.equal(limbBalance(9.1, 9.0)?.tone, "normal");
  assert.equal(limbBalance(10, 8.5)?.tone, "clear");
  assert.equal(limbBalance(null, 3), null);
});

test("every figure region maps to a segment except head/face/neck/nape, and sides are anatomical", () => {
  const unmapped = [...FRONT_MUSCLES, ...BACK_MUSCLES].filter((m) => regionSegment(m.id) == null).map((m) => m.id).sort();
  assert.deepEqual(unmapped, ["face", "head", "head-back", "nape", "neck-left", "neck-right"]);
  assert.equal(regionSegment("biceps-left"), "leftArm");
  assert.equal(regionSegment("triceps-long-right"), "rightArm");
  assert.equal(regionSegment("gluteus-maximus-left"), "leftLeg");
  assert.equal(regionSegment("spine"), "trunk");
});

test("anatomy layer: each code resolves and no region is claimed by two codes", () => {
  const seen = new Map<string, string>();
  for (const m of [...FRONT_MUSCLES, ...BACK_MUSCLES]) { const c = regionAnatomyCode(m.id); if (c) seen.set(m.id, c); }
  for (const code of ANATOMY_CODES) assert.ok([...seen.values()].includes(code), `${code} has no region on the figure`);
  assert.equal(regionAnatomyCode("head"), null);
});
