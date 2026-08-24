/**
 * Locks down Gate 3's duplicate-detection rules — most importantly, the
 * task's own explicit list of pairs that must NEVER be auto-merged, plus
 * the deterministic auto-link cases that ARE allowed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectDuplicate, normalizeExerciseName, type ExerciseMatchCandidate } from "../exercise-duplicate-detector";

function food(overrides: Partial<ExerciseMatchCandidate> & Pick<ExerciseMatchCandidate, "id" | "name">): ExerciseMatchCandidate {
  return {
    source: "test",
    equipment: [],
    primaryMuscles: [],
    ...overrides,
  };
}

test("normalizeExerciseName: strips diacritics, punctuation, stopwords, case", () => {
  assert.equal(normalizeExerciseName("Đẩy Ngực Phẳng Với Tạ Đòn"), "day nguc phang voi ta don");
  assert.equal(normalizeExerciseName("Bench Press (with a Barbell)"), "bench press barbell");
});

// ── The task's explicit "never auto-merge" list ──────────────────────────

test("Bench Press vs Dumbbell Bench Press -> POSSIBLE_VARIANT, never auto-merged", () => {
  const a = food({ id: "a", name: "Bench Press", equipment: ["barbell", "bench"], primaryMuscles: ["chest"] });
  const b = food({ id: "b", name: "Dumbbell Bench Press", equipment: ["dumbbell", "bench"], primaryMuscles: ["chest"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
  assert.ok(result.conflictingFields.length > 0);
  assert.doesNotMatch(result.proposedAction.toLowerCase(), /^auto-link/);
});

test("Flat Bench vs Incline Bench -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Flat Bench Press", equipment: ["barbell"], primaryMuscles: ["chest"] });
  const b = food({ id: "b", name: "Incline Bench Press", equipment: ["barbell"], primaryMuscles: ["chest"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

test("Back Squat vs Front Squat -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Back Squat", equipment: ["barbell"], primaryMuscles: ["quads"] });
  const b = food({ id: "b", name: "Front Squat", equipment: ["barbell"], primaryMuscles: ["quads"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

test("Conventional Deadlift vs Romanian Deadlift -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Conventional Deadlift", equipment: ["barbell"], primaryMuscles: ["hamstrings"] });
  const b = food({ id: "b", name: "Romanian Deadlift", equipment: ["barbell"], primaryMuscles: ["hamstrings"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

test("Cable Row vs Barbell Row -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Cable Row", equipment: ["cable"], primaryMuscles: ["back"] });
  const b = food({ id: "b", name: "Barbell Row", equipment: ["barbell"], primaryMuscles: ["back"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

test("Left unilateral vs Right unilateral variation -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Left Leg Bulgarian Split Squat", equipment: ["dumbbell"], primaryMuscles: ["quads"] });
  const b = food({ id: "b", name: "Right Leg Bulgarian Split Squat", equipment: ["dumbbell"], primaryMuscles: ["quads"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

test("Machine vs free-weight variation -> POSSIBLE_VARIANT", () => {
  const a = food({ id: "a", name: "Machine Chest Press", equipment: ["machine"], primaryMuscles: ["chest"] });
  const b = food({ id: "b", name: "Barbell Chest Press", equipment: ["barbell"], primaryMuscles: ["chest"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
});

// ── Deterministic auto-link cases (the only cases allowed to auto-link) ──

test("same source + same externalId -> EXACT_SAME_SOURCE, auto-link", () => {
  const a = food({ id: "a", name: "Bench Press", source: "wger", externalId: "192" });
  const b = food({ id: "b", name: "Bench Press (updated)", source: "wger", externalId: "192" });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "EXACT_SAME_SOURCE");
  assert.equal(result.confidence, 1);
});

test("same canonicalSlug -> EXACT_SAME_SOURCE", () => {
  const a = food({ id: "a", name: "Flat Barbell Bench Press", canonicalSlug: "flat-barbell-bench-press" });
  const b = food({ id: "b", name: "Bench Press Flat Barbell", canonicalSlug: "flat-barbell-bench-press" });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "EXACT_SAME_SOURCE");
});

test("identical normalized name + matching equipment + matching movementPattern, different source -> EXACT_CROSS_SOURCE", () => {
  const a = food({
    id: "a",
    name: "Barbell Bench Press",
    source: "free_exercise_db",
    equipment: ["barbell", "bench"],
    primaryMuscles: ["chest"],
    movementPattern: "horizontal_push",
  });
  const b = food({
    id: "b",
    name: "Barbell Bench Press",
    source: "curated_vi",
    equipment: ["barbell", "bench"],
    primaryMuscles: ["chest"],
    movementPattern: "horizontal_push",
  });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "EXACT_CROSS_SOURCE");
  assert.match(result.proposedAction.toLowerCase(), /auto-link/);
});

test("identical name, matching primaryMuscles + equipment, no movementPattern data -> EXACT_CROSS_SOURCE via key 4", () => {
  const a = food({ id: "a", name: "Push-Up", equipment: ["bodyweight"], primaryMuscles: ["chest", "triceps"] });
  const b = food({ id: "b", name: "Push-Up", equipment: ["bodyweight"], primaryMuscles: ["chest", "triceps"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "EXACT_CROSS_SOURCE");
});

// ── Review-queue cases — never auto-merged ────────────────────────────────

test("strong name overlap + matching muscles but not deterministic -> LIKELY_DUPLICATE (review queue)", () => {
  const a = food({ id: "a", name: "Seated Cable Row", equipment: ["cable"], primaryMuscles: ["back"] });
  const b = food({ id: "b", name: "Cable Row", equipment: ["cable"], primaryMuscles: ["back", "biceps"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "LIKELY_DUPLICATE");
  assert.match(result.proposedAction.toLowerCase(), /review/);
});

test("identical name but equipment disagrees on a hard variant dimension -> POSSIBLE_VARIANT (still never auto-merged)", () => {
  // Same name, but the equipment field itself carries a real
  // variant-distinguishing signal (machine vs bodyweight) even though
  // neither name mentions it — the safety outcome (do not auto-merge) is
  // identical to MANUAL_REVIEW; POSSIBLE_VARIANT is the more specific,
  // still-correct classification here since a genuine distinguishing
  // dimension was detected, not just an unexplained disagreement.
  const a = food({ id: "a", name: "Leg Press", equipment: ["machine"], primaryMuscles: ["quads"] });
  const b = food({ id: "b", name: "Leg Press", equipment: ["bodyweight"], primaryMuscles: ["quads"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "POSSIBLE_VARIANT");
  assert.doesNotMatch(result.proposedAction.toLowerCase(), /^auto-link/);
});

test("identical name, equipment disagrees with NO hard-variant signal either side -> MANUAL_REVIEW", () => {
  // Equipment fields disagree (one populated, one empty/unknown) but
  // neither carries a recognized variant-distinguishing keyword — this is
  // genuine ambiguity (could be a data-entry gap, not necessarily a real
  // variant), correctly routed to a human rather than auto-classified
  // either way.
  const a = food({ id: "a", name: "Face Pull", equipment: ["cable"], primaryMuscles: ["rear_delts"] });
  const b = food({ id: "b", name: "Face Pull", equipment: [], primaryMuscles: ["rear_delts"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "MANUAL_REVIEW");
});

test("completely unrelated exercises -> DISTINCT", () => {
  const a = food({ id: "a", name: "Bicep Curl", equipment: ["dumbbell"], primaryMuscles: ["biceps"] });
  const b = food({ id: "b", name: "Treadmill Run", equipment: ["bodyweight"], primaryMuscles: ["quads"] });
  const result = detectDuplicate(a, b);
  assert.equal(result.decision, "DISTINCT");
});

test("every result includes matchedFields, conflictingFields, proposedAction, and affectedForeignKeys", () => {
  const a = food({ id: "id-a", name: "Squat", equipment: ["barbell"] });
  const b = food({ id: "id-b", name: "Squat", equipment: ["barbell"] });
  const result = detectDuplicate(a, b);
  assert.ok(Array.isArray(result.matchedFields));
  assert.ok(Array.isArray(result.conflictingFields));
  assert.ok(typeof result.proposedAction === "string" && result.proposedAction.length > 0);
  assert.deepEqual(result.affectedForeignKeys, ["id-a", "id-b"]);
});
