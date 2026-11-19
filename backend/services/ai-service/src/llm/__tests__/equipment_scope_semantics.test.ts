/**
 * V1 stabilization (2026-11-12), Priority 3 — equipment statement semantics.
 *
 * Confirmed defect: "Tôi có tạ đơn" was applied as "Tôi CHỈ có tạ đơn" — the stated kit replaced the profile's list and the
 * exercise guard then flagged every barbell/cable/machine exercise as impossible. Required distinctions:
 *   owned (confirmed)        "Tôi có tạ đơn"                       — other equipment is UNKNOWN, not absent
 *   exhaustive ("chỉ có")    "Tôi chỉ có tạ đơn"                   — the list is the whole kit
 *   negated items            "Tôi có tạ đơn nhưng không có máy"     — positive AND negative info kept
 *   unknown                  nothing stated                         — no restriction
 * Missing information is never turned into a negation. Oracle: hand-labelled expectations, not the production extractor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractTurnFacts, applyTurnFacts, formatTurnFactsForPrompt } from "../turn_facts";
import { assessExercise } from "../exercise_constraint_guard";
import type { CatalogExercise } from "../exercise_name_normalizer";

const eq = (text: string) => extractTurnFacts(text, {}).equipment;
const row = (nameEn: string, equipment: string[]): CatalogExercise => ({ catalogId: `T-${nameEn}`, nameEn, equipment, difficulty: "intermediate" } as unknown as CatalogExercise);
const barbellRow = row("Barbell Back Squat", ["barbell"]);
const machineRow = row("Leg Press", ["machine"]);
const cableRow = row("Seated Cable Row", ["cable"]);
const dumbbellRow = row("Goblet Squat", ["dumbbell", "kettlebell"]);
const profile = (availableEquipment: string[]) => ({ age: 30, training: { availableEquipment, injuries: [], preferredTrainingDays: [] } }) as any;

test("'Tôi có tạ đơn' = owned dumbbell, scope INCLUSIVE — a barbell exercise is NOT flagged (barbell is unknown, not absent)", () => {
  const f = extractTurnFacts("Tôi có tạ đơn, nên tập chân thế nào?", {});
  assert.equal(f.equipment?.scope, "INCLUSIVE");
  assert.ok(f.equipment?.value.includes("dumbbell"));
  assert.equal(assessExercise(barbellRow, f).status, "ok");
  assert.equal(assessExercise(dumbbellRow, f).status, "ok");
});

test("'Tôi chỉ có tạ đơn' = exhaustive — barbell, machine and cable exercises are flagged", () => {
  const f = extractTurnFacts("Tôi chỉ có tạ đơn, nên tập chân thế nào?", {});
  assert.equal(f.equipment?.scope, "EXHAUSTIVE");
  assert.equal(assessExercise(barbellRow, f).status, "violation");
  assert.equal(assessExercise(machineRow, f).status, "violation");
  assert.equal(assessExercise(dumbbellRow, f).status, "ok");
});

test("'Tôi có tạ đơn nhưng không có máy' keeps BOTH the positive and the negative item", () => {
  const e = eq("Tôi có tạ đơn nhưng không có máy.");
  assert.equal(e?.scope, "INCLUSIVE");
  assert.ok(e?.value.includes("dumbbell"));
  assert.ok(e?.excluded?.includes("machine"), JSON.stringify(e));
  const f = extractTurnFacts("Tôi có tạ đơn nhưng không có máy.", {});
  assert.equal(assessExercise(machineRow, f).status, "violation", "an exercise that needs the denied machine is flagged");
  assert.equal(assessExercise(barbellRow, f).status, "ok", "barbell was never mentioned — unknown, not absent");
  assert.equal(assessExercise(dumbbellRow, f).status, "ok");
});

test("'Tôi không có tạ đòn' denies ONE item only — not 'bodyweight only'", () => {
  const f = extractTurnFacts("Tôi không có tạ đòn thì tập ngực bằng gì?", {});
  assert.equal(f.equipment?.scope, "INCLUSIVE");
  assert.deepEqual(f.equipment?.excluded, ["barbell"]);
  assert.equal(assessExercise(barbellRow, f).status, "violation");
  assert.equal(assessExercise(cableRow, f).status, "ok", "cable was never mentioned");
});

test("'ở nhà không có dụng cụ' is still exhaustive (bodyweight only)", () => {
  const f = extractTurnFacts("Tôi tập ở nhà không có dụng cụ.", {});
  assert.equal(f.equipment?.scope, "EXHAUSTIVE");
  assert.equal(assessExercise(dumbbellRow, f).status, "violation");
});

test("nothing stated ⇒ no equipment fact, no restriction", () => {
  const f = extractTurnFacts("Squat bao nhiêu hiệp là đủ?", {});
  assert.equal(f.equipment, undefined);
  assert.equal(assessExercise(barbellRow, f).status, "ok");
});

test("applyTurnFacts: an INCLUSIVE statement never shrinks the saved kit; it adds to it and removes only denied items", () => {
  const saved = profile(["barbell", "cable", "bodyweight"]);
  const p1 = applyTurnFacts(saved, extractTurnFacts("Tôi có tạ đơn.", { profile: saved }));
  assert.deepEqual([...p1.training.availableEquipment].sort(), ["barbell", "bodyweight", "cable", "dumbbell"]);
  const p2 = applyTurnFacts(saved, extractTurnFacts("Tôi có tạ đơn nhưng không có cáp.", { profile: saved }));
  assert.ok(!p2.training.availableEquipment.includes("cable"));
  assert.ok(p2.training.availableEquipment.includes("barbell"));
  // no saved kit: an inclusive statement does not invent a complete list (empty = unknown stays unknown)
  const p3 = applyTurnFacts(profile([]), extractTurnFacts("Tôi có tạ đơn.", { profile: profile([]) }));
  assert.deepEqual(p3.training.availableEquipment, []);
  // exhaustive still replaces
  const p4 = applyTurnFacts(saved, extractTurnFacts("Tôi chỉ có tạ đơn.", { profile: saved }));
  assert.deepEqual([...p4.training.availableEquipment].sort(), ["bodyweight", "dumbbell"]);
});

test("prompt wording: owned ≠ only, denied items are stated as denied", () => {
  const owned = formatTurnFactsForPrompt(extractTurnFacts("Tôi có tạ đơn nhưng không có máy.", {}));
  assert.doesNotMatch(owned, /TUYỆT ĐỐI không đề xuất bài cần dụng cụ khác/);
  assert.match(owned, /không có: .*máy/i);
  const only = formatTurnFactsForPrompt(extractTurnFacts("Tôi chỉ có tạ đơn.", {}));
  assert.match(only, /TUYỆT ĐỐI không đề xuất bài cần dụng cụ khác/);
});
