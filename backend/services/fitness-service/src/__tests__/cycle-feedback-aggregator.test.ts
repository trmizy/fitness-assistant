import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCycleFeedback,
  type FeedbackScheduleInput,
  type SessionFeedbackRowInput,
} from "../services/cycle-feedback-aggregator";

const CYCLE_ID = "cycle-1";

function schedule(id: string, status: string): FeedbackScheduleInput {
  return { id, status };
}

function feedback(overrides: Partial<SessionFeedbackRowInput> & { workoutScheduleId: string }): SessionFeedbackRowInput {
  return {
    feedbackMissing: false,
    sessionRating: null,
    difficulty: null,
    enjoyment: null,
    fatigueAfterSession: null,
    painScore: null,
    wouldRepeatSession: null,
    skipReason: null,
    exerciseFeedback: [],
    ...overrides,
  };
}

test("mostly positive feedback -> sentiment positive, no safety flags", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED"), schedule("s3", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", sessionRating: 5, difficulty: "just_right", painScore: 1 }),
    feedback({ workoutScheduleId: "s2", sessionRating: 4, difficulty: "just_right", painScore: 0 }),
    feedback({ workoutScheduleId: "s3", sessionRating: 5, difficulty: "just_right", painScore: 2 }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.feedbackSentimentByRules, "positive");
  assert.equal(result.positiveFeedbackCount, 3);
  assert.equal(result.negativeFeedbackCount, 0);
  assert.deepEqual(result.safetyFlags, []);
});

test("mostly negative feedback (low rating + high pain) -> sentiment negative + safety flag", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED"), schedule("s3", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", sessionRating: 1, painScore: 8 }),
    feedback({ workoutScheduleId: "s2", sessionRating: 2, painScore: 7 }),
    feedback({ workoutScheduleId: "s3", wouldRepeatSession: "no" }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.feedbackSentimentByRules, "negative");
  assert.equal(result.negativeFeedbackCount, 3);
  assert.ok(result.safetyFlags.includes("HIGH_PAIN_REPORTED"));
});

test("mixed feedback (some positive, some negative) -> sentiment mixed", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", sessionRating: 5, difficulty: "just_right", painScore: 1 }),
    feedback({ workoutScheduleId: "s2", sessionRating: 1, painScore: 8 }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.feedbackSentimentByRules, "mixed");
  assert.equal(result.positiveFeedbackCount, 1);
  assert.equal(result.negativeFeedbackCount, 1);
});

test("insufficient feedback (fewer than 2 submissions) -> insufficient_feedback, never a strong verdict", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED"), schedule("s3", "COMPLETED")];
  const rows = [feedback({ workoutScheduleId: "s1", sessionRating: 5, difficulty: "just_right", painScore: 0 })];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.feedbackSentimentByRules, "insufficient_feedback");
  assert.ok(result.dataQualityScore < 0.5, "low data quality with only 1/3 sessions reporting");
});

test("no feedback at all -> insufficient_feedback, zero counts, no crash", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "SKIPPED")];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, []);
  assert.equal(result.feedbackSentimentByRules, "insufficient_feedback");
  assert.equal(result.feedbackSubmittedCount, 0);
  assert.equal(result.feedbackMissingCount, 2);
  assert.equal(result.feedbackCompletionRate, 0);
  assert.equal(result.dataQualityScore, 0);
});

test("equipment mismatch flag fires when >=2 exercise feedback rows report equipment_unavailable", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED")];
  const rows = [
    feedback({
      workoutScheduleId: "s1",
      sessionRating: 3,
      exerciseFeedback: [{ exerciseId: "ex1", rating: null, issueType: "equipment_unavailable" }],
    }),
    feedback({
      workoutScheduleId: "s2",
      sessionRating: 3,
      exerciseFeedback: [{ exerciseId: "ex2", rating: null, issueType: "equipment_unavailable" }],
    }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.ok(result.equipmentMismatchFlags.includes("REPEATED_EQUIPMENT_UNAVAILABLE"));
});

test("too easy issue: sessionsMarkedTooEasy counted, distinct from too hard", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", difficulty: "too_easy" }),
    feedback({ workoutScheduleId: "s2", difficulty: "too_hard" }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.sessionsMarkedTooEasy, 1);
  assert.equal(result.sessionsMarkedTooHard, 1);
});

test("too hard issue: high sessionsMarkedTooHard count surfaces even without other rating signals", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED"), schedule("s3", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", difficulty: "too_hard" }),
    feedback({ workoutScheduleId: "s2", difficulty: "too_hard" }),
    feedback({ workoutScheduleId: "s3", difficulty: "too_hard" }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.sessionsMarkedTooHard, 3);
});

test("skipped/cancelled sessions: counted separately, motivation flag fires on repeated motivation skips", () => {
  const schedules = [
    schedule("s1", "SKIPPED"),
    schedule("s2", "SKIPPED"),
    schedule("s3", "CANCELLED"),
    schedule("s4", "COMPLETED"),
  ];
  const rows = [
    feedback({ workoutScheduleId: "s1", skipReason: "motivation" }),
    feedback({ workoutScheduleId: "s2", skipReason: "motivation" }),
    feedback({ workoutScheduleId: "s3", skipReason: "illness" }),
    feedback({ workoutScheduleId: "s4", sessionRating: 4, difficulty: "just_right", painScore: 1 }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.skippedSessions, 2);
  assert.equal(result.cancelledSessions, 1);
  assert.equal(result.completedSessions, 1);
  assert.ok(result.motivationOrBoredomFlags.includes("REPEATED_MOTIVATION_SKIPS"));
});

test("partial sessions counted distinctly from completed", () => {
  const schedules = [schedule("s1", "PARTIALLY_COMPLETED"), schedule("s2", "COMPLETED")];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, []);
  assert.equal(result.partialSessions, 1);
  assert.equal(result.completedSessions, 1);
  assert.equal(result.totalSessions, 2);
});

test("boredom issue flag fires on repeated 'boring' exercise issue reports", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED")];
  const rows = [
    feedback({
      workoutScheduleId: "s1",
      sessionRating: 4,
      exerciseFeedback: [{ exerciseId: "ex1", rating: null, issueType: "boring" }],
    }),
    feedback({
      workoutScheduleId: "s2",
      sessionRating: 4,
      exerciseFeedback: [{ exerciseId: "ex1", rating: null, issueType: "boring" }],
    }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.ok(result.motivationOrBoredomFlags.includes("REPEATED_BOREDOM_REPORTS"));
  assert.ok(result.mostCommonIssues.some((i) => i.issueType === "boring" && i.count === 2));
});

test("liked/disliked exercise lists populated from per-exercise ratings and issueType", () => {
  const schedules = [schedule("s1", "COMPLETED")];
  const rows = [
    feedback({
      workoutScheduleId: "s1",
      sessionRating: 4,
      exerciseFeedback: [
        { exerciseId: "liked-ex", rating: 5, issueType: null },
        { exerciseId: "disliked-ex", rating: 1, issueType: "too_heavy" },
      ],
    }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.ok(result.mostLikedExercises.includes("liked-ex"));
  assert.ok(result.mostDislikedExercises.includes("disliked-ex"));
});

test("exercise-specific pain report populates exercisesWithPainReports and safety flag", () => {
  const schedules = [schedule("s1", "COMPLETED")];
  const rows = [
    feedback({
      workoutScheduleId: "s1",
      sessionRating: 3,
      painScore: 2, // overall session pain low, but one exercise specifically hurt
      exerciseFeedback: [{ exerciseId: "painful-ex", rating: null, issueType: "pain" }],
    }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.deepEqual(result.exercisesWithPainReports, ["painful-ex"]);
  assert.ok(result.safetyFlags.includes("EXERCISE_SPECIFIC_PAIN_REPORTS"));
});

test("dismissed feedback (feedbackMissing=true) is excluded from real submission counts", () => {
  const schedules = [schedule("s1", "COMPLETED"), schedule("s2", "COMPLETED")];
  const rows = [
    feedback({ workoutScheduleId: "s1", feedbackMissing: true }),
    feedback({ workoutScheduleId: "s2", sessionRating: 4, difficulty: "just_right", painScore: 1 }),
  ];
  const result = aggregateCycleFeedback(CYCLE_ID, schedules, rows);
  assert.equal(result.feedbackSubmittedCount, 1);
  assert.equal(result.feedbackMissingCount, 1);
});
