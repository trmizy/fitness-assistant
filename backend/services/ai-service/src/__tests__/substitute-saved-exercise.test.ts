/**
 * Real Bug D follow-up (2026-10-23) — "thay bài child's pose bằng bài
 * barbell row" against an ALREADY-SAVED active WorkoutProgram. Before this
 * feature, the exact same phrase had no recognized intent and fell to
 * general LLM chat, which fabricated a fake weekly table (see
 * workout-guards.ts's doc comment for the original incident). These tests
 * cover only the pure parsing/matching logic — no I/O.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubstituteSavedExerciseRequest, parseDayFilter, findOccurrencesByName,
} from "../services/revision/substitute-saved-exercise";

test("parses the exact live-incident phrase", () => {
  const result = parseSubstituteSavedExerciseRequest("thay bài child's pose bằng bài barbell row");
  assert.deepEqual(result, { oldKeyword: "child's pose", newKeyword: "barbell row" });
});

test("parses đổi ... thành ... with no bài carrier word", () => {
  const result = parseSubstituteSavedExerciseRequest("đổi squat thành deadlift");
  assert.deepEqual(result, { oldKeyword: "squat", newKeyword: "deadlift" });
});

test("parses thay the ... sang ...", () => {
  const result = parseSubstituteSavedExerciseRequest("thay thế lunges sang bulgarian split squat");
  assert.deepEqual(result, { oldKeyword: "lunges", newKeyword: "bulgarian split squat" });
});

test("rejects a bare ordinal old-reference — no safe single-day context here", () => {
  assert.equal(parseSubstituteSavedExerciseRequest("thay bài 1 thành barbell row"), null);
});

test("rejects a plain schedule-lookup question (must never hijack it)", () => {
  assert.equal(parseSubstituteSavedExerciseRequest("ngày mai tôi tập gì"), null);
});

test("rejects an exclusion-only phrase with no replacement target", () => {
  assert.equal(parseSubstituteSavedExerciseRequest("tôi không có máy cable"), null);
});

test("parseDayFilter: single and multiple day references", () => {
  assert.deepEqual(parseDayFilter("chỉ buổi 2"), [2]);
  assert.deepEqual(parseDayFilter("buổi 2 và buổi 3"), [2, 3]);
  assert.equal(parseDayFilter("ngày mai tôi tập gì"), null);
});

function fakeProgram(days: Array<{ dayNumber: number; title?: string; exercises: Array<{ id: string; exerciseId: string; exerciseName: string }> }>) {
  return {
    days: days.map((d) => ({
      dayNumber: d.dayNumber, title: d.title,
      exercises: d.exercises.map((e) => ({ id: e.id, exerciseId: e.exerciseId, exercise: { id: e.exerciseId, exerciseName: e.exerciseName } })),
    })),
  };
}

test("findOccurrencesByName: finds every day an exact-named exercise appears in", () => {
  const program = fakeProgram([
    { dayNumber: 1, title: "Push", exercises: [{ id: "pe1", exerciseId: "ex-childs-pose", exerciseName: "Child's Pose" }] },
    { dayNumber: 2, title: "Pull", exercises: [{ id: "pe2", exerciseId: "ex-row", exerciseName: "Barbell Row" }] },
    { dayNumber: 3, title: "Cooldown", exercises: [{ id: "pe3", exerciseId: "ex-childs-pose", exerciseName: "Child's Pose" }] },
  ]);
  const result = findOccurrencesByName(program, "child's pose");
  assert.equal(result.kind, "found");
  if (result.kind === "found") {
    assert.equal(result.occurrences.length, 2);
    assert.deepEqual(result.occurrences.map((o) => o.dayNumber), [1, 3]);
    assert.equal(result.occurrences[0].programExerciseId, "pe1");
  }
});

test("findOccurrencesByName: none when the exercise isn't in the real schedule", () => {
  const program = fakeProgram([{ dayNumber: 1, exercises: [{ id: "pe1", exerciseId: "ex-squat", exerciseName: "Barbell Squat" }] }]);
  assert.deepEqual(findOccurrencesByName(program, "deadlift"), { kind: "none" });
});

test("findOccurrencesByName: ambiguous when the keyword substring-matches two DIFFERENT real exercises", () => {
  const program = fakeProgram([
    { dayNumber: 1, exercises: [{ id: "pe1", exerciseId: "ex-overhead-press", exerciseName: "Overhead Press" }] },
    { dayNumber: 2, exercises: [{ id: "pe2", exerciseId: "ex-bench-press", exerciseName: "Bench Press" }] },
  ]);
  const result = findOccurrencesByName(program, "press");
  assert.equal(result.kind, "ambiguous");
  if (result.kind === "ambiguous") assert.deepEqual(new Set(result.names), new Set(["Overhead Press", "Bench Press"]));
});

test("findOccurrencesByName: an exact match wins over a looser substring match elsewhere", () => {
  const program = fakeProgram([
    { dayNumber: 1, exercises: [{ id: "pe1", exerciseId: "ex-squat", exerciseName: "Squat" }] },
    { dayNumber: 2, exercises: [{ id: "pe2", exerciseId: "ex-bulgarian", exerciseName: "Bulgarian Split Squat" }] },
  ]);
  const result = findOccurrencesByName(program, "squat");
  assert.equal(result.kind, "found");
  if (result.kind === "found") {
    assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].exerciseName, "Squat");
  }
});

// Regression (2026-11-10, eval B1-06): "bụng đói" strips to "doi" (= "đổi") and "buổi sáng" supplied "sang", so a plain
// nutrition/training question was answered with "Mình không thấy bài "buoi" trong lịch tập".
test("a question about training on an empty stomach in the morning is not a swap request", () => {
  assert.equal(parseSubstituteSavedExerciseRequest("Chạy bộ lúc bụng đói buổi sáng có đốt mỡ nhiều hơn không?"), null);
  assert.equal(parseSubstituteSavedExerciseRequest("chay bo luc bung doi buoi sang co dot mo nhieu hon khong"), null);
});

test("real swaps without accents still parse (the guard keys on the accented đói only)", () => {
  assert.deepEqual(parseSubstituteSavedExerciseRequest("doi squat thanh deadlift"), { oldKeyword: "squat", newKeyword: "deadlift" });
  assert.deepEqual(parseSubstituteSavedExerciseRequest("đổi squat sang leg press"), { oldKeyword: "squat", newKeyword: "leg press" });
});
