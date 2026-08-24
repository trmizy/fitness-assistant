import { prisma } from "../repositories/prisma";

/** Phase 3 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — CycleFeedbackAggregator.
 * Deterministic, rule-based rollup of every CycleSessionFeedback row in a
 * cycle. NO AI/LLM involvement anywhere in this file — "code tính, AI chỉ
 * diễn giải" applies to feedback the same way it already applies to
 * CycleMetricsEngine. Phase 4's AI analysis reads this output; never
 * recomputes it.
 */

export type SessionSentiment = "positive" | "negative" | "neutral" | "mixed" | "insufficient_feedback";

export interface CycleFeedbackSummaryResult {
  cycleId: string;
  totalSessions: number;
  completedSessions: number;
  partialSessions: number;
  skippedSessions: number;
  cancelledSessions: number;
  feedbackSubmittedCount: number;
  feedbackMissingCount: number;
  feedbackCompletionRate: number;

  averageSessionRating: number | null;
  averageDifficultyScore: number | null; // 0 (too_easy) .. 1 (too_hard)
  averageEnjoymentScore: number | null; // 0 (low) .. 1 (high)
  averageFatigue: number | null;
  averagePain: number | null;

  mostCommonIssues: Array<{ issueType: string; count: number }>;
  mostLikedExercises: string[];
  mostDislikedExercises: string[];
  exercisesWithPainReports: string[];

  sessionsMarkedTooHard: number;
  sessionsMarkedTooEasy: number;
  sessionsUserWouldNotRepeat: number;

  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  neutralFeedbackCount: number;
  mixedFeedbackCount: number;
  feedbackSentimentByRules: SessionSentiment;

  dataQualityScore: number;

  safetyFlags: string[];
  equipmentMismatchFlags: string[];
  adherenceRelatedComplaintFlags: string[];
  motivationOrBoredomFlags: string[];
}

const DIFFICULTY_SCORE: Record<string, number> = { too_easy: 0, just_right: 0.5, too_hard: 1 };
const ENJOYMENT_SCORE: Record<string, number> = { low: 0, medium: 0.5, high: 1 };
const NEGATIVE_ISSUE_TYPES = new Set(["too_heavy", "too_light", "uncomfortable", "pain", "boring", "confusing"]);
const MIN_SUBMISSIONS_FOR_FULL_CONFIDENCE = 3;
const REPEATED_ISSUE_THRESHOLD = 2; // >= this many occurrences of the same flag-worthy issue triggers a flag

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

/** Per-session rule-based classification — the exact rules from
 * docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md Phase 3. */
function classifySessionSentiment(f: {
  sessionRating: number | null;
  painScore: number | null;
  wouldRepeatSession: string | null;
  difficulty: string | null;
}): SessionSentiment {
  const hasAnySignal =
    f.sessionRating != null || f.painScore != null || f.wouldRepeatSession != null || f.difficulty != null;
  if (!hasAnySignal) return "insufficient_feedback";

  const negativeSignal =
    (f.sessionRating != null && f.sessionRating <= 2) ||
    (f.painScore != null && f.painScore >= 7) ||
    f.wouldRepeatSession === "no";
  const positiveSignal =
    f.sessionRating != null &&
    f.sessionRating >= 4 &&
    f.difficulty === "just_right" &&
    (f.painScore == null || f.painScore <= 3);

  if (negativeSignal && positiveSignal) return "mixed";
  if (negativeSignal) return "negative";
  if (positiveSignal) return "positive";
  return "neutral";
}

// Minimal shapes the pure function actually reads — decoupled from the
// full generated Prisma types so this can be unit-tested with hand-built
// fixtures (same pattern as cycle-decision.engine.ts's CycleMetricsResult),
// without a real DB.
export interface FeedbackScheduleInput {
  id: string;
  status: string;
}
export interface ExerciseFeedbackInput {
  exerciseId: string;
  rating: number | null;
  issueType: string | null;
}
export interface SessionFeedbackRowInput {
  workoutScheduleId: string;
  feedbackMissing: boolean;
  sessionRating: number | null;
  difficulty: string | null;
  enjoyment: string | null;
  fatigueAfterSession: number | null;
  painScore: number | null;
  wouldRepeatSession: string | null;
  skipReason: string | null;
  exerciseFeedback: ExerciseFeedbackInput[];
}

/** Pure function — no DB access, no AI. All aggregation/sentiment-
 * classification rules from docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md
 * Phase 3 live here so they're directly unit-testable with fixtures. */
export function aggregateCycleFeedback(
  cycleId: string,
  schedules: FeedbackScheduleInput[],
  feedbackRows: SessionFeedbackRowInput[],
): CycleFeedbackSummaryResult {
  {
    const totalSessions = schedules.length;
    const completedSessions = schedules.filter((s) => s.status === "COMPLETED").length;
    const partialSessions = schedules.filter((s) => s.status === "PARTIALLY_COMPLETED").length;
    const skippedSessions = schedules.filter((s) => s.status === "SKIPPED").length;
    const cancelledSessions = schedules.filter((s) => s.status === "CANCELLED").length;

    const eligibleForFeedbackIds = new Set(
      schedules
        .filter((s) => ["COMPLETED", "PARTIALLY_COMPLETED", "SKIPPED", "CANCELLED"].includes(s.status))
        .map((s) => s.id),
    );
    const realFeedback = feedbackRows.filter((f) => !f.feedbackMissing);
    const feedbackSubmittedCount = realFeedback.filter((f) => eligibleForFeedbackIds.has(f.workoutScheduleId)).length;
    const feedbackMissingCount = Math.max(0, eligibleForFeedbackIds.size - feedbackSubmittedCount);
    const feedbackCompletionRate =
      eligibleForFeedbackIds.size > 0 ? Math.round((feedbackSubmittedCount / eligibleForFeedbackIds.size) * 100) / 100 : 0;

    const ratings = realFeedback.map((f) => f.sessionRating).filter((v): v is number => v != null);
    const difficultyScores = realFeedback
      .map((f) => (f.difficulty ? DIFFICULTY_SCORE[f.difficulty] : undefined))
      .filter((v): v is number => v != null);
    const enjoymentScores = realFeedback
      .map((f) => (f.enjoyment ? ENJOYMENT_SCORE[f.enjoyment] : undefined))
      .filter((v): v is number => v != null);
    const fatigueValues = realFeedback.map((f) => f.fatigueAfterSession).filter((v): v is number => v != null);
    const painValues = realFeedback.map((f) => f.painScore).filter((v): v is number => v != null);

    // Per-exercise issue aggregation
    const issueCounts = new Map<string, number>();
    const likedExerciseCounts = new Map<string, number>();
    const dislikedExerciseCounts = new Map<string, number>();
    const painExerciseIds = new Set<string>();
    for (const f of realFeedback) {
      for (const ex of f.exerciseFeedback) {
        if (ex.issueType) {
          issueCounts.set(ex.issueType, (issueCounts.get(ex.issueType) ?? 0) + 1);
          if (ex.issueType === "liked") {
            likedExerciseCounts.set(ex.exerciseId, (likedExerciseCounts.get(ex.exerciseId) ?? 0) + 1);
          } else if (NEGATIVE_ISSUE_TYPES.has(ex.issueType)) {
            dislikedExerciseCounts.set(ex.exerciseId, (dislikedExerciseCounts.get(ex.exerciseId) ?? 0) + 1);
          }
          if (ex.issueType === "pain") painExerciseIds.add(ex.exerciseId);
        }
        if (ex.rating != null && ex.rating >= 4) {
          likedExerciseCounts.set(ex.exerciseId, (likedExerciseCounts.get(ex.exerciseId) ?? 0) + 1);
        } else if (ex.rating != null && ex.rating <= 2) {
          dislikedExerciseCounts.set(ex.exerciseId, (dislikedExerciseCounts.get(ex.exerciseId) ?? 0) + 1);
        }
      }
    }
    const topN = (counts: Map<string, number>, n = 5) =>
      [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

    const sessionsMarkedTooHard = realFeedback.filter((f) => f.difficulty === "too_hard").length;
    const sessionsMarkedTooEasy = realFeedback.filter((f) => f.difficulty === "too_easy").length;
    const sessionsUserWouldNotRepeat = realFeedback.filter((f) => f.wouldRepeatSession === "no").length;

    // Sentiment
    let positiveFeedbackCount = 0;
    let negativeFeedbackCount = 0;
    let neutralFeedbackCount = 0;
    let mixedFeedbackCount = 0;
    let insufficientCount = 0;
    for (const f of realFeedback) {
      const s = classifySessionSentiment(f);
      if (s === "positive") positiveFeedbackCount++;
      else if (s === "negative") negativeFeedbackCount++;
      else if (s === "neutral") neutralFeedbackCount++;
      else if (s === "mixed") mixedFeedbackCount++;
      else insufficientCount++;
    }

    const classifiedCount = positiveFeedbackCount + negativeFeedbackCount + neutralFeedbackCount + mixedFeedbackCount;
    let feedbackSentimentByRules: SessionSentiment;
    if (feedbackSubmittedCount < 2 || classifiedCount === 0) {
      feedbackSentimentByRules = "insufficient_feedback";
    } else if (negativeFeedbackCount > 0 && positiveFeedbackCount > 0) {
      feedbackSentimentByRules = "mixed";
    } else if (negativeFeedbackCount > positiveFeedbackCount && negativeFeedbackCount >= neutralFeedbackCount) {
      feedbackSentimentByRules = "negative";
    } else if (positiveFeedbackCount > negativeFeedbackCount && positiveFeedbackCount >= neutralFeedbackCount) {
      feedbackSentimentByRules = "positive";
    } else {
      feedbackSentimentByRules = "neutral";
    }

    const sizeConfidence = Math.min(1, feedbackSubmittedCount / MIN_SUBMISSIONS_FOR_FULL_CONFIDENCE);
    const dataQualityScore = Math.round(feedbackCompletionRate * sizeConfidence * 100) / 100;

    // Flags
    const safetyFlags: string[] = [];
    if (painValues.some((p) => p >= 7)) safetyFlags.push("HIGH_PAIN_REPORTED");
    if (painExerciseIds.size > 0) safetyFlags.push("EXERCISE_SPECIFIC_PAIN_REPORTS");

    const equipmentMismatchFlags: string[] = [];
    if ((issueCounts.get("equipment_unavailable") ?? 0) >= REPEATED_ISSUE_THRESHOLD) {
      equipmentMismatchFlags.push("REPEATED_EQUIPMENT_UNAVAILABLE");
    }

    const skipReasonCounts = new Map<string, number>();
    for (const f of feedbackRows) {
      if (f.skipReason) skipReasonCounts.set(f.skipReason, (skipReasonCounts.get(f.skipReason) ?? 0) + 1);
    }
    const adherenceRelatedComplaintFlags: string[] = [];
    if ((skipReasonCounts.get("schedule_conflict") ?? 0) >= REPEATED_ISSUE_THRESHOLD) {
      adherenceRelatedComplaintFlags.push("REPEATED_SCHEDULE_CONFLICT");
    }
    if ((skipReasonCounts.get("too_hard_previous_session") ?? 0) >= REPEATED_ISSUE_THRESHOLD) {
      adherenceRelatedComplaintFlags.push("SKIPPING_DUE_TO_DIFFICULTY");
    }

    const motivationOrBoredomFlags: string[] = [];
    if ((issueCounts.get("boring") ?? 0) >= REPEATED_ISSUE_THRESHOLD) motivationOrBoredomFlags.push("REPEATED_BOREDOM_REPORTS");
    if ((skipReasonCounts.get("motivation") ?? 0) >= REPEATED_ISSUE_THRESHOLD) motivationOrBoredomFlags.push("REPEATED_MOTIVATION_SKIPS");

    return {
      cycleId,
      totalSessions,
      completedSessions,
      partialSessions,
      skippedSessions,
      cancelledSessions,
      feedbackSubmittedCount,
      feedbackMissingCount,
      feedbackCompletionRate,

      averageSessionRating: mean(ratings),
      averageDifficultyScore: mean(difficultyScores),
      averageEnjoymentScore: mean(enjoymentScores),
      averageFatigue: mean(fatigueValues),
      averagePain: mean(painValues),

      mostCommonIssues: [...issueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([issueType, count]) => ({ issueType, count })),
      mostLikedExercises: topN(likedExerciseCounts),
      mostDislikedExercises: topN(dislikedExerciseCounts),
      exercisesWithPainReports: [...painExerciseIds],

      sessionsMarkedTooHard,
      sessionsMarkedTooEasy,
      sessionsUserWouldNotRepeat,

      positiveFeedbackCount,
      negativeFeedbackCount,
      neutralFeedbackCount,
      mixedFeedbackCount,
      feedbackSentimentByRules,

      dataQualityScore,

      safetyFlags,
      equipmentMismatchFlags,
      adherenceRelatedComplaintFlags,
      motivationOrBoredomFlags,
    };
  }
}

export const cycleFeedbackAggregator = {
  /** Thin I/O wrapper: reads WorkoutSchedule + CycleSessionFeedback (+
   * ExerciseSessionFeedback) for a cycle, delegates the actual computation
   * to the pure aggregateCycleFeedback() above. Does not persist —
   * computeAndPersist below does. */
  async compute(cycleId: string): Promise<CycleFeedbackSummaryResult> {
    const [schedules, feedbackRows] = await Promise.all([
      prisma.workoutSchedule.findMany({ where: { trainingCycleId: cycleId }, select: { id: true, status: true } }),
      prisma.cycleSessionFeedback.findMany({
        where: { cycleId },
        include: { exerciseFeedback: true },
      }),
    ]);
    return aggregateCycleFeedback(cycleId, schedules, feedbackRows);
  },

  /** Computes + upserts the CycleFeedbackSummary row (latest-wins). */
  async computeAndPersist(cycleId: string) {
    const result = await this.compute(cycleId);
    return prisma.cycleFeedbackSummary.upsert({
      where: { cycleId },
      create: {
        cycleId,
        totalSessions: result.totalSessions,
        completedSessions: result.completedSessions,
        partialSessions: result.partialSessions,
        skippedSessions: result.skippedSessions,
        cancelledSessions: result.cancelledSessions,
        feedbackSubmittedCount: result.feedbackSubmittedCount,
        feedbackMissingCount: result.feedbackMissingCount,
        feedbackCompletionRate: result.feedbackCompletionRate,
        averageSessionRating: result.averageSessionRating,
        averageDifficultyScore: result.averageDifficultyScore,
        averageEnjoymentScore: result.averageEnjoymentScore,
        averageFatigue: result.averageFatigue,
        averagePain: result.averagePain,
        mostCommonIssues: result.mostCommonIssues,
        mostLikedExercises: result.mostLikedExercises,
        mostDislikedExercises: result.mostDislikedExercises,
        exercisesWithPainReports: result.exercisesWithPainReports,
        sessionsMarkedTooHard: result.sessionsMarkedTooHard,
        sessionsMarkedTooEasy: result.sessionsMarkedTooEasy,
        sessionsUserWouldNotRepeat: result.sessionsUserWouldNotRepeat,
        positiveFeedbackCount: result.positiveFeedbackCount,
        negativeFeedbackCount: result.negativeFeedbackCount,
        neutralFeedbackCount: result.neutralFeedbackCount,
        mixedFeedbackCount: result.mixedFeedbackCount,
        feedbackSentimentByRules: result.feedbackSentimentByRules,
        dataQualityScore: result.dataQualityScore,
        safetyFlags: result.safetyFlags,
        equipmentMismatchFlags: result.equipmentMismatchFlags,
        adherenceRelatedComplaintFlags: result.adherenceRelatedComplaintFlags,
        motivationOrBoredomFlags: result.motivationOrBoredomFlags,
      },
      update: {
        totalSessions: result.totalSessions,
        completedSessions: result.completedSessions,
        partialSessions: result.partialSessions,
        skippedSessions: result.skippedSessions,
        cancelledSessions: result.cancelledSessions,
        feedbackSubmittedCount: result.feedbackSubmittedCount,
        feedbackMissingCount: result.feedbackMissingCount,
        feedbackCompletionRate: result.feedbackCompletionRate,
        averageSessionRating: result.averageSessionRating,
        averageDifficultyScore: result.averageDifficultyScore,
        averageEnjoymentScore: result.averageEnjoymentScore,
        averageFatigue: result.averageFatigue,
        averagePain: result.averagePain,
        mostCommonIssues: result.mostCommonIssues,
        mostLikedExercises: result.mostLikedExercises,
        mostDislikedExercises: result.mostDislikedExercises,
        exercisesWithPainReports: result.exercisesWithPainReports,
        sessionsMarkedTooHard: result.sessionsMarkedTooHard,
        sessionsMarkedTooEasy: result.sessionsMarkedTooEasy,
        sessionsUserWouldNotRepeat: result.sessionsUserWouldNotRepeat,
        positiveFeedbackCount: result.positiveFeedbackCount,
        negativeFeedbackCount: result.negativeFeedbackCount,
        neutralFeedbackCount: result.neutralFeedbackCount,
        mixedFeedbackCount: result.mixedFeedbackCount,
        feedbackSentimentByRules: result.feedbackSentimentByRules,
        dataQualityScore: result.dataQualityScore,
        safetyFlags: result.safetyFlags,
        equipmentMismatchFlags: result.equipmentMismatchFlags,
        adherenceRelatedComplaintFlags: result.adherenceRelatedComplaintFlags,
        motivationOrBoredomFlags: result.motivationOrBoredomFlags,
      },
    });
  },
};
