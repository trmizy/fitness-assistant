/**
 * Regression for the 2026-10-23 live bug: extractExerciseRevisionKeyword
 * had no validation at all — ANY leftover free text after stripping known
 * stop-words was accepted as a literal "exercise name to exclude", so an
 * unrelated instruction like "hãy cập nhật cho toàn bộ lịch tập" survived
 * as the keyword "cap nhat cho toan lich tap" and the caller confidently
 * (and wrongly) told the user it would avoid that nonsensical "exercise".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractExerciseRevisionKeyword } from "../services/fitness-agent.service";

test("rejects the exact live-incident phrase as not a plausible exercise name", () => {
  assert.equal(extractExerciseRevisionKeyword("hãy cập nhật cho toàn bộ lịch tập"), null);
});

test("rejects other unrelated instructions referring to the schedule/plan itself", () => {
  assert.equal(extractExerciseRevisionKeyword("sửa lại toàn bộ lịch tập giúp tôi"), null);
  assert.equal(extractExerciseRevisionKeyword("tạo lại kế hoạch tập"), null);
});

// Known, accepted residual gap — not claimed as fixed: this function is a
// fixed stop-word list, not real intent understanding, so a free-form
// instruction that doesn't contain any of the known stop words/meta-terms
// above can still slip through short enough to pass the word-count cap.
// Expanding the list indefinitely chases individual phrasings rather than
// the actual gap (no real "I don't understand" signal) — out of scope for
// this fix; left here only as an honest, documented limitation.
test("known gap: a short unrelated phrase using no recognized stop word is not rejected", () => {
  assert.equal(extractExerciseRevisionKeyword("làm lại từ đầu đi"), "tu dau");
});

test("still extracts real, short exercise-name exclusions correctly", () => {
  assert.equal(extractExerciseRevisionKeyword("Đổi squat"), "squat");
  assert.equal(extractExerciseRevisionKeyword("Tôi không có máy cable"), "cable");
  assert.equal(extractExerciseRevisionKeyword("Tôi không muốn deadlift"), "deadlift");
});

test("still extracts a short multi-word real exercise name", () => {
  assert.equal(extractExerciseRevisionKeyword("thay the bang Single Arm Cable Row"), "single arm cable row");
});
