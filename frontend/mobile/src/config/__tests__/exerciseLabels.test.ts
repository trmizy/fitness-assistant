/**
 * Exercise catalog labels. The lowercase case is a real regression: the muscle taxonomy sends
 * `anatomyRegion` in lowercase, and an exact-key lookup showed raw "full_body" as a section header.
 *
 * Runs with: npx tsx --test src/config/__tests__/exerciseLabels.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bodyPartLabel,
  difficultyLabel,
  equipmentLabel,
  loggingModeLabel,
} from "../exerciseLabels";

describe("bodyPartLabel", () => {
  it("maps the catalog's uppercase enum and the taxonomy's lowercase one alike", () => {
    assert.equal(bodyPartLabel("FULL_BODY"), "Toàn thân");
    assert.equal(bodyPartLabel("full_body"), "Toàn thân");
    assert.equal(bodyPartLabel("lower_body"), "Thân dưới");
    assert.equal(bodyPartLabel("core"), "Bụng/Core");
  });

  it("shows an unmapped value as-is rather than hiding it, and a dash for nothing", () => {
    assert.equal(bodyPartLabel("NECK"), "NECK");
    assert.equal(bodyPartLabel(null), "—");
    assert.equal(bodyPartLabel(""), "—");
  });
});

describe("other catalog labels", () => {
  it("difficulty is case-insensitive and empty when missing", () => {
    assert.equal(difficultyLabel("Expert"), "Nâng cao");
    assert.equal(difficultyLabel("beginner"), "Mới bắt đầu");
    assert.equal(difficultyLabel(undefined), "");
  });

  it("logging mode maps known values and falls back to the raw one", () => {
    assert.equal(loggingModeLabel("REPS_LOAD"), "Số lần x Tạ");
    assert.equal(loggingModeLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  });

  it("equipment enums read as lowercase words", () => {
    assert.equal(equipmentLabel("BARBELL_PLATE"), "barbell plate");
    assert.equal(equipmentLabel(null), "—");
  });
});
