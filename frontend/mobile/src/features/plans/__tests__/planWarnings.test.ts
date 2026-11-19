import test from "node:test";
import assert from "node:assert/strict";
import { formatPlanWarning, formatPlanWarnings } from "../planWarnings";

// The exact object a real plan carried when the user saw raw JSON in the "Cảnh báo từ AI" box (2026-11-10 screenshot).
const REAL = { type: "coach_plan_validation", errors: [], warnings: [{ code: "beginner_volume_high", message: "Beginner daily volume is high and should be monitored.", severity: "warning" }] };

test("the real coach_plan_validation object becomes one Vietnamese sentence, never JSON or English", () => {
  const out = formatPlanWarnings([REAL]);
  assert.equal(out.length, 1);
  assert.match(out[0], /người mới/);
  assert.doesNotMatch(out[0], /[{}"]|coach_plan_validation|beginner_volume|Beginner/);
});

test("the same object stored as a JSON string (older plans) is translated too", () => {
  assert.deepEqual(formatPlanWarnings([JSON.stringify(REAL)]), formatPlanWarnings([REAL]));
});

test("a validation record with no errors and no warnings shows nothing", () => {
  assert.deepEqual(formatPlanWarnings([{ type: "coach_plan_validation", errors: [], warnings: [] }]), []);
});

test("internal repair / mapping records are hidden", () => {
  const internal = [{ type: "deterministic_repair", reason: "x" }, { type: "name_mapping", from: "a", to: "b" }, { type: "muscle_mismatch_repair" }, { type: "day_candidate_repair", repairs: [] }, { type: "coach_plan_validation_fallback", errorCodes: ["a"] }];
  assert.deepEqual(formatPlanWarnings(internal), []);
});

test("unknown object types and unknown codes never leak raw JSON", () => {
  assert.deepEqual(formatPlanWarnings([{ type: "something_new", a: 1 }]), []);
  const out = formatPlanWarning({ type: "coach_plan_validation", errors: [{ code: "brand_new_code", message: "English only" }], warnings: [] });
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0], /brand_new_code|English only|[{}]/);
});

test("plain string warnings still pass through; duplicates collapse; non-arrays are safe", () => {
  assert.deepEqual(formatPlanWarnings(["Hãy nghỉ ngơi đủ.", "Hãy nghỉ ngơi đủ."]), ["Hãy nghỉ ngơi đủ."]);
  assert.deepEqual(formatPlanWarnings(undefined), []);
  assert.deepEqual(formatPlanWarnings("x" as unknown), []);
});

test("errors and warnings both translate, in order, with distinct sentences", () => {
  const out = formatPlanWarnings([{ type: "coach_plan_validation", errors: [{ code: "injury_warning_missing" }], warnings: [{ code: "beginner_volume_high" }, { code: "protein_outside_expected_range" }] }]);
  assert.equal(out.length, 3);
  assert.equal(new Set(out).size, 3);
});
