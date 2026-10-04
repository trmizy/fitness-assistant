/**
 * 14B.1 (PG-A2) — post-session feedback / skip reason bodies, kept identical to what web sends.
 *
 * Chạy: npx tsx --test src/features/__tests__/sessionFeedback.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FEEDBACK_SCALES,
  completionPayload,
  hasSubmittedFeedback,
  initialCompletionForm,
  skipPayload,
  stepScale,
} from "../workout/sessionFeedback";
import type { SessionFeedbackRecord } from "../../services/api";

const rpe = FEEDBACK_SCALES.find((s) => s.key === "sessionRpe")!;
const pain = FEEDBACK_SCALES.find((s) => s.key === "painScore")!;

describe("completionPayload", () => {
  it("web's defaults: scales always sent, optional fields left out", () => {
    assert.deepEqual(completionPayload(initialCompletionForm()), {
      readinessScore: 6,
      sessionRpe: 6,
      painScore: 0,
      fatigueAfterSession: 5,
      painLocation: undefined,
      sessionRating: undefined,
      difficulty: undefined,
      enjoyment: undefined,
      wouldRepeatSession: undefined,
      perceivedProgress: undefined,
      notes: undefined,
      exerciseFeedback: undefined,
    });
  });

  it("pain location only travels with a pain score; notes are trimmed; cleared tags are dropped", () => {
    const form = {
      ...initialCompletionForm(),
      painLocation: "  vai trái ",
      notes: "  ổn  ",
      sessionRating: 4,
      exerciseTags: { ex1: "pain" as const, ex2: undefined },
    };
    assert.equal(completionPayload(form).painLocation, undefined);
    const withPain = completionPayload({ ...form, painScore: 3 });
    assert.equal(withPain.painLocation, "vai trái");
    assert.equal(withPain.notes, "ổn");
    assert.equal(withPain.sessionRating, 4);
    assert.deepEqual(withPain.exerciseFeedback, [{ exerciseId: "ex1", issueType: "pain" }]);
  });
});

describe("initialCompletionForm from a saved row (the Xem/sửa path)", () => {
  it("pre-fills saved values and per-exercise tags", () => {
    const saved = {
      readinessScore: 8,
      sessionRpe: 7.5,
      painScore: 2,
      fatigueAfterSession: null,
      painLocation: "gối",
      sessionRating: 5,
      difficulty: "too_hard",
      enjoyment: null,
      wouldRepeatSession: "yes",
      perceivedProgress: null,
      notes: null,
      exerciseFeedback: [
        { exerciseId: "a", rating: null, issueType: "liked", note: null },
        { exerciseId: "b", rating: 3, issueType: null, note: null },
      ],
    } as unknown as SessionFeedbackRecord;
    const form = initialCompletionForm(saved);
    assert.equal(form.sessionRpe, 7.5);
    assert.equal(form.fatigueAfterSession, 5);
    assert.equal(form.difficulty, "too_hard");
    assert.equal(form.enjoyment, undefined);
    assert.equal(form.notes, "");
    assert.deepEqual(form.exerciseTags, { a: "liked" });
  });
});

describe("stepScale", () => {
  it("moves by the scale's step and stays inside its range", () => {
    assert.equal(stepScale(rpe, 6, 1), 6.5);
    assert.equal(stepScale(rpe, 10, 1), 10);
    assert.equal(stepScale(rpe, 1, -1), 1);
    assert.equal(stepScale(pain, 0, -1), 0);
    assert.equal(stepScale(pain, 0, 1), 1);
  });
});

describe("skipPayload / hasSubmittedFeedback", () => {
  it("reason required by type; empty extras left out", () => {
    assert.deepEqual(skipPayload({ skipReason: "fatigue", notes: " ", shouldAdjustPlan: false, makeupDay: null }), {
      skipReason: "fatigue",
      notes: undefined,
      shouldAdjustPlan: false,
      userAvailableMakeupDay: undefined,
    });
    assert.equal(
      skipPayload({ skipReason: "other", notes: "x", shouldAdjustPlan: true, makeupDay: "2026-10-05" }).userAvailableMakeupDay,
      "2026-10-05",
    );
  });

  it("a dismissed-prompt marker is not feedback", () => {
    const row = {} as SessionFeedbackRecord;
    assert.equal(hasSubmittedFeedback({ feedback: row, feedbackMissing: false }), true);
    assert.equal(hasSubmittedFeedback({ feedback: row, feedbackMissing: true }), false);
    assert.equal(hasSubmittedFeedback({ feedback: null, feedbackMissing: false }), false);
    assert.equal(hasSubmittedFeedback(undefined), false);
  });
});
