/** Runs with: npx tsx --test src/features/__tests__/contractPlace.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { contractPlaceLabel } from "../pt/contractPlace";

describe("contractPlaceLabel", () => {
  it("joins branch name and address", () => {
    assert.equal(contractPlaceLabel({ id: "g", name: "Mekong Fitness An Khánh", address: "58 Mai Chí Thọ" }), "Mekong Fitness An Khánh — 58 Mai Chí Thọ");
  });
  it("name only without an address; null when unknown", () => {
    assert.equal(contractPlaceLabel({ id: "g", name: "Mekong", address: null }), "Mekong");
    assert.equal(contractPlaceLabel(null), null);
    assert.equal(contractPlaceLabel({ id: "g", name: " " }), null);
  });
});
