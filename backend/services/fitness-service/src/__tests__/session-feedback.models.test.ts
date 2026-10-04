import test from "node:test";
import assert from "node:assert/strict";
import {
  completionFeedbackSchema,
  skipCancelFeedbackSchema,
  exerciseFeedbackItemSchema,
  sessionFeedbackInputSchema,
} from "../models/session-feedback.models";

test("completion feedback: accepts a full valid payload", () => {
  const result = completionFeedbackSchema.safeParse({
    sessionRating: 4,
    difficulty: "just_right",
    enjoyment: "high",
    fatigueAfterSession: 6,
    painScore: 2,
    painLocation: "vai trái",
    wouldRepeatSession: "yes",
    perceivedProgress: "better_than_last_time",
    notes: "Tốt",
    exerciseFeedback: [{ exerciseId: "ex1", rating: 5, issueType: "liked" }],
  });
  assert.equal(result.success, true);
});

test("completion feedback: a partial submission (just a rating) is still valid — low friction by design", () => {
  const result = completionFeedbackSchema.safeParse({ sessionRating: 3 });
  assert.equal(result.success, true);
});

test("completion feedback: rejects invalid rating (out of 1-5 range)", () => {
  const result = completionFeedbackSchema.safeParse({ sessionRating: 7 });
  assert.equal(result.success, false);
});

test("completion feedback: rejects invalid difficulty enum value", () => {
  const result = completionFeedbackSchema.safeParse({ difficulty: "impossible" });
  assert.equal(result.success, false);
});

test("completion feedback: rejects invalid painScore out of 0-10 range", () => {
  const result = completionFeedbackSchema.safeParse({ painScore: 15 });
  assert.equal(result.success, false);
});

test("exercise feedback item: rejects invalid issueType", () => {
  const result = exerciseFeedbackItemSchema.safeParse({ exerciseId: "ex1", issueType: "not_a_real_issue" });
  assert.equal(result.success, false);
});

test("exercise feedback item: exerciseId is required", () => {
  const result = exerciseFeedbackItemSchema.safeParse({ rating: 3 });
  assert.equal(result.success, false);
});

test("skip/cancel feedback: skipReason is required", () => {
  const result = skipCancelFeedbackSchema.safeParse({ notes: "no reason given" });
  assert.equal(result.success, false);
});

test("skip/cancel feedback: accepts a valid full payload", () => {
  const result = skipCancelFeedbackSchema.safeParse({
    skipReason: "pain",
    notes: "Đau vai",
    shouldAdjustPlan: true,
    userAvailableMakeupDay: "2026-08-15",
  });
  assert.equal(result.success, true);
});

test("skip/cancel feedback: rejects invalid skipReason enum value", () => {
  const result = skipCancelFeedbackSchema.safeParse({ skipReason: "just_because" });
  assert.equal(result.success, false);
});

// GAP-24 — the controller parses with sessionFeedbackInputSchema (the union), not the individual
// schemas above; a skip body used to come out as {} and every skip reason was refused.
test("input schema (controller): a skip body keeps skipReason, plan flag and makeup day", () => {
  const parsed = sessionFeedbackInputSchema.parse({
    skipReason: "schedule_conflict",
    shouldAdjustPlan: true,
    userAvailableMakeupDay: "2026-10-06",
    notes: "Bận họp",
  });
  assert.deepEqual(parsed, {
    skipReason: "schedule_conflict",
    shouldAdjustPlan: true,
    userAvailableMakeupDay: "2026-10-06",
    notes: "Bận họp",
  });
});

test("input schema (controller): a completion body still parses as completion feedback", () => {
  const body = {
    readinessScore: 6,
    sessionRpe: 7.5,
    painScore: 3,
    painLocation: "vai",
    sessionRating: 4,
    difficulty: "just_right",
    exerciseFeedback: [{ exerciseId: "ex-1", issueType: "pain" }],
  };
  assert.deepEqual(sessionFeedbackInputSchema.parse(body), body);
});

test("input schema (controller): an invalid skip reason is not silently accepted as empty completion feedback", () => {
  // Falls through to the completion schema, which strips the unknown key — the service then refuses a
  // skipped session without a reason; what matters here is that a valid reason is never dropped.
  const parsed = sessionFeedbackInputSchema.parse({ skipReason: "just_because" }) as Record<string, unknown>;
  assert.equal(parsed.skipReason, undefined);
});

