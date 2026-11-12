import { test } from "node:test";
import assert from "node:assert/strict";
import { findExerciseViolations } from "../exercise_constraint_guard";

// Found by the Nova Pro recheck (REAL HTTP/API, 2026-11-12, case B4-09 "Em chỉ có dây kháng lực ở nhà…"): the correct answer
// recommended "Resistance Band Chest Press"; the generic family "Chest Press" (catalog variants: machine only) made the guard
// append "chưa nên chọn Chest Press (cần dụng cụ bạn chưa có)" — a false warning on the very exercise the user CAN do.
// The equipment word in front of a generic name names the variant; that equipment is what must be checked.
const bandsAtHome: any = { conflicts: [], equipment: { value: ["resistance_band", "bodyweight"], source: "message", status: "ASSERTED" } };
const nothing: any = { conflicts: [], equipment: { value: ["bodyweight"], source: "message", status: "ASSERTED" } };
const dumbbells: any = { conflicts: [], equipment: { value: ["dumbbell", "bodyweight"], source: "message", status: "ASSERTED" } };
const names = (a: string, f: any) => findExerciseViolations(a, f).map((v) => v.name);

test("equipment-qualified generic name: the user's own equipment clears it", () => {
  assert.deepEqual(names("1. **Resistance Band Chest Press**: 3 set × 12", bandsAtHome), []);
  assert.deepEqual(names("- Dumbbell Chest Press 3×10", dumbbells), []);
});

test("equipment-qualified generic name: equipment the user lacks is still a violation", () => {
  assert.ok(names("1. **Resistance Band Chest Press**: 3 set × 12", nothing).length > 0, "no band → flagged");
  assert.ok(names("- Cable Chest Press 3×10", bandsAtHome).length > 0, "cable not available → flagged");
});

test("idempotent: the guard's own note is never re-flagged on a second pass", async () => {
  const { enforceExerciseConstraints } = await import("../exercise_constraint_guard");
  const beginner: any = { conflicts: [], experience: { value: "never", source: "message", status: "ASSERTED" } };
  const once = enforceExerciseConstraints("- Plank 3×20 giây\n- Nordic Ham Curl 3×5\n- Glute Bridge 3×12", beginner);
  assert.ok(once.violations.length === 1);
  const twice = enforceExerciseConstraints(once.answer, beginner);
  assert.equal(twice.answer, once.answer);
  assert.equal(twice.violations.length, 0);
});

test("unqualified generic name keeps the old all-variants rule", () => {
  assert.ok(names("- Chest Press 3×10", bandsAtHome).length > 0, "plain 'Chest Press' (machine family) still flagged");
});
