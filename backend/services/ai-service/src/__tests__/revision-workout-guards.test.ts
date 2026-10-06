/**
 * Phase 3 Batch 4 — honest permanent-swap guard, pure unit tests (injected keyword extractor, no DB).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tryExplainUnsupportedPermanentSwap } from "../services/revision/workout-guards";

const extractor = (text: string) => (/bulgarian split squat|squat|deadlift/.test(text.toLowerCase()) ? "exercise" : null);

test("T19: an exercise-swap phrase with NO pending workout draft gets the honest limitation answer, never a hallucinated claim", () => {
  const result = tryExplainUnsupportedPermanentSwap("Đổi Bulgarian Split Squat luôn.", false, extractor);
  assert.ok(result);
  assert.match(result!.answer, /chưa thể thay đổi vĩnh viễn/);
  assert.equal(result!.blocks.length, 0, "never a WORKOUT_PLAN_PREVIEW or any action block — nothing was actually changed");
});

test("the SAME phrase with a pending draft is NOT intercepted here — tryReviseWorkoutPlanDraft (the existing mechanism) owns it instead", () => {
  const result = tryExplainUnsupportedPermanentSwap("Đổi Bulgarian Split Squat luôn.", true, extractor);
  assert.equal(result, null);
});

test("an unrelated message (no exercise-revision keyword) with no pending draft is never falsely intercepted", () => {
  const result = tryExplainUnsupportedPermanentSwap("Hôm nay tôi nên ăn gì?", false, extractor);
  assert.equal(result, null);
});

test("a PT/PROGRAM ordinal-list reference ('người thứ hai') is never mistaken for a named-exercise permanent swap, even with no pending workout draft", () => {
  // extractExerciseRevisionKeyword's own carrier-word stripping would otherwise return a truthy
  // leftover keyword for this phrase too — the ordinal-reference check disambiguates it away from
  // this guard so the PT/PROGRAM revision module gets first refusal instead.
  const looseExtractor = () => "nguoi thu hai con ai khac"; // simulates the real extractor's loose behavior
  const result = tryExplainUnsupportedPermanentSwap("Không thích người thứ hai, còn ai khác?", false, looseExtractor);
  assert.equal(result, null);
});

// Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 1): with the REAL
// extractExerciseRevisionKeyword (not a scoped stub), a plain workout-CREATION request with no
// exclusion/swap cue at all was wrongly intercepted by this guard, because the real extractor's
// carrier-word stripping returns a non-null residue for nearly any sufficiently long message when
// called with no pending draft to ground it (its own original, sole call site always had one). Fixed
// by requiring an explicit swap/exclusion cue (đổi/thay/không muốn/tránh/...) literally in the text.
test("Batch 5 regression: a workout-CREATION request with no exclusion/swap cue is never intercepted, even when the (realistically loose) extractor returns a non-null residue", () => {
  const realisticLooseExtractor = () => "tao cho lich giam mo 4 buoi tap o"; // the real extractor's actual output for this input
  const result = tryExplainUnsupportedPermanentSwap("Tạo cho tôi lịch giảm mỡ 4 buổi, tôi tập ở nhà.", false, realisticLooseExtractor);
  assert.equal(result, null, "no đổi/thay/không muốn/... cue is present — must never fire");
});
