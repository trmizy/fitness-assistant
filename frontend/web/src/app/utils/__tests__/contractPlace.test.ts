import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contractPlaceLabel } from "../contractPlace";

describe("contractPlaceLabel", () => {
  it("joins branch name and address", () => {
    assert.equal(contractPlaceLabel({ id: "g", name: "Mekong Fitness An Khánh", address: "58 Mai Chí Thọ" }), "Mekong Fitness An Khánh — 58 Mai Chí Thọ");
  });
  it("name only when there is no address; null when unknown", () => {
    assert.equal(contractPlaceLabel({ id: "g", name: "Mekong", address: null }), "Mekong");
    assert.equal(contractPlaceLabel(null), null);
    assert.equal(contractPlaceLabel({ id: "g", name: "  " }), null);
  });
});
