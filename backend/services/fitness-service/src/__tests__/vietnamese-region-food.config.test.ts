import test from "node:test";
import assert from "node:assert/strict";
import {
  orderByRegionPriority,
  isVietnameseRegion,
  REGION_PROTEIN_PRIORITY,
  REGION_PREP_STYLE_VI,
  VIETNAMESE_REGIONS,
} from "../config/vietnamese-region-food.config";

test("isVietnameseRegion accepts exactly BAC/TRUNG/NAM, rejects anything else", () => {
  assert.equal(isVietnameseRegion("BAC"), true);
  assert.equal(isVietnameseRegion("TRUNG"), true);
  assert.equal(isVietnameseRegion("NAM"), true);
  assert.equal(isVietnameseRegion("bac"), false, "case-sensitive — the stored value is always uppercase");
  assert.equal(isVietnameseRegion("EAST"), false);
  assert.equal(isVietnameseRegion(null), false);
  assert.equal(isVietnameseRegion(undefined), false);
  assert.equal(isVietnameseRegion(""), false);
});

test("orderByRegionPriority with no region returns the input completely unchanged (existing behavior for every profile without this new field)", () => {
  const input = ["a", "b", "c"];
  assert.deepEqual(orderByRegionPriority(input, null), input);
  assert.deepEqual(orderByRegionPriority(input, undefined), input);
});

test("orderByRegionPriority never introduces an item that wasn't already in the candidate list", () => {
  for (const region of VIETNAMESE_REGIONS) {
    const candidates = ["thịt heo nạc", "ức gà", "cá basa"]; // deliberately NOT the full priority list
    const ordered = orderByRegionPriority(candidates, region);
    assert.deepEqual(
      [...ordered].sort(),
      [...candidates].sort(),
      `region ${region} must only reorder, never add/remove items`,
    );
  }
});

test("orderByRegionPriority: NAM puts cá basa first even though it's last in the input order", () => {
  const candidates = ["ức gà", "thịt heo nạc", "cá basa"];
  const ordered = orderByRegionPriority(candidates, "NAM");
  assert.equal(ordered[0], "cá basa");
});

test("orderByRegionPriority: TRUNG puts cá thu first when present", () => {
  const candidates = ["ức gà", "cá thu", "thịt heo nạc"];
  const ordered = orderByRegionPriority(candidates, "TRUNG");
  assert.equal(ordered[0], "cá thu");
});

test("orderByRegionPriority: BAC puts đậu hũ first when present", () => {
  const candidates = ["thịt heo nạc", "ức gà", "đậu hũ"];
  const ordered = orderByRegionPriority(candidates, "BAC");
  assert.equal(ordered[0], "đậu hũ");
});

test("orderByRegionPriority: items not in the region's priority list keep their original relative order, appended after priority matches", () => {
  const candidates = ["mystery-item-1", "cá basa", "mystery-item-2"];
  const ordered = orderByRegionPriority(candidates, "NAM");
  assert.equal(ordered[0], "cá basa");
  assert.deepEqual(ordered.slice(1), ["mystery-item-1", "mystery-item-2"]);
});

test("every region has a non-empty priority list and a prep-style note", () => {
  for (const region of VIETNAMESE_REGIONS) {
    assert.ok(REGION_PROTEIN_PRIORITY[region].length > 0, `${region} must have a priority list`);
    assert.ok(REGION_PREP_STYLE_VI[region].length > 0, `${region} must have a prep-style note`);
  }
});
