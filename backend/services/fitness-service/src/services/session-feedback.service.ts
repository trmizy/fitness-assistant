import { prisma } from "../repositories/prisma";
import { assertScheduleDateEditable } from "../utils/schedule-lock.util";
import { invalidateCycleProgressCache } from "./training-cycle.service";
import type {
  CompletionFeedbackInput,
  SkipCancelFeedbackInput,
  ExerciseFeedbackItem,
} from "../models/session-feedback.models";

const COMPLETION_STATUSES = new Set(["COMPLETED", "PARTIALLY_COMPLETED"]);
const SKIP_CANCEL_STATUSES = new Set(["SKIPPED", "CANCELLED"]);

/** Phase 2 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — session feedback
 * addressable directly by workoutScheduleId, distinct from the existing
 * cycle-nested `trainingCycleService.submitSessionFeedback` (kept as-is,
 * unchanged, for backward compatibility with its existing callers/tests).
 * Both write the same `CycleSessionFeedback` table — there is exactly one
 * feedback row per WorkoutSchedule regardless of which endpoint wrote it.
 */
export const sessionFeedbackService = {
  async getFeedback(workoutScheduleId: string, userId: string) {
    const schedule = await prisma.workoutSchedule.findFirst({
      where: { id: workoutScheduleId, userId },
    });
    if (!schedule) throw { status: 404, message: "Workout session not found" };

    const feedback = await prisma.cycleSessionFeedback.findUnique({
      where: { workoutScheduleId },
      include: { exerciseFeedback: true },
    });

    return {
      feedback,
      feedbackMissing: !feedback || feedback.feedbackMissing,
      sessionStatus: schedule.status,
    };
  },

  /** Upserts feedback for a session, picking completion-form vs.
   * skip/cancel-form fields based on the session's REAL status (never
   * trusting which shape the client claims to submit) — a client can only
   * submit skip/cancel-shaped fields if the schedule is actually
   * SKIPPED/CANCELLED, and completion-shaped fields otherwise. */
  async upsertFeedback(
    workoutScheduleId: string,
    userId: string,
    input: CompletionFeedbackInput | SkipCancelFeedbackInput,
  ) {
    const schedule = await prisma.workoutSchedule.findFirst({
      where: { id: workoutScheduleId, userId },
    });
    if (!schedule) throw { status: 404, message: "Workout session not found" };
    assertScheduleDateEditable(schedule.date);

    const isSkipCancel = SKIP_CANCEL_STATUSES.has(schedule.status);
    const isCompletion = COMPLETION_STATUSES.has(schedule.status);
    if (!isSkipCancel && !isCompletion) {
      throw {
        status: 409,
        message:
          "Chỉ có thể ghi phản hồi cho buổi tập đã hoàn thành (một phần), bị bỏ qua, hoặc đã huỷ.",
      };
    }

    let data: Record<string, unknown>;
    let exerciseFeedback: ExerciseFeedbackItem[] | undefined;

    if (isSkipCancel) {
      const skipInput = input as SkipCancelFeedbackInput;
      if (!skipInput.skipReason) {
        throw { status: 400, message: "skipReason is required for a skipped/cancelled session" };
      }
      data = {
        skipReason: skipInput.skipReason,
        notes: skipInput.notes,
        shouldAdjustPlan: skipInput.shouldAdjustPlan,
        userAvailableMakeupDay: skipInput.userAvailableMakeupDay
          ? new Date(skipInput.userAvailableMakeupDay)
          : undefined,
        feedbackMissing: false,
      };
    } else {
      const completionInput = input as CompletionFeedbackInput;
      exerciseFeedback = completionInput.exerciseFeedback;
      data = {
        readinessScore: completionInput.readinessScore,
        sessionRpe: completionInput.sessionRpe,
        painScore: completionInput.painScore,
        notes: completionInput.notes,
        sessionRating: completionInput.sessionRating,
        difficulty: completionInput.difficulty,
        enjoyment: completionInput.enjoyment,
        fatigueAfterSession: completionInput.fatigueAfterSession,
        painLocation: completionInput.painLocation,
        wouldRepeatSession: completionInput.wouldRepeatSession,
        perceivedProgress: completionInput.perceivedProgress,
        feedbackMissing: false,
      };
    }
    // Strip undefined keys so a partial submission doesn't clobber
    // previously-saved fields with `undefined` -> Prisma would otherwise
    // interpret an explicit `undefined` in `update` as "leave unchanged"
    // for `update` but as "not provided" (fine) for `create` — safe either
    // way, but strip for clarity and smaller payloads.
    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

    const feedback = await prisma.$transaction(async (tx) => {
      const row = await tx.cycleSessionFeedback.upsert({
        where: { workoutScheduleId },
        create: {
          workoutScheduleId,
          cycleId: schedule.trainingCycleId ?? undefined,
          ...cleanData,
        },
        update: cleanData,
      });

      if (exerciseFeedback && exerciseFeedback.length > 0) {
        // Replace-all semantics for the child rows — simplest correct
        // behavior for "the user resubmitted their per-exercise notes."
        await tx.exerciseSessionFeedback.deleteMany({ where: { sessionFeedbackId: row.id } });
        await tx.exerciseSessionFeedback.createMany({
          data: exerciseFeedback.map((ex) => ({
            sessionFeedbackId: row.id,
            exerciseId: ex.exerciseId,
            rating: ex.rating,
            issueType: ex.issueType,
            note: ex.note,
          })),
        });
      }

      return tx.cycleSessionFeedback.findUniqueOrThrow({
        where: { id: row.id },
        include: { exerciseFeedback: true },
      });
    });

    if (schedule.trainingCycleId) {
      await invalidateCycleProgressCache(schedule.trainingCycleId);
    }
    return feedback;
  },

  /** Explicit "user was prompted and chose to skip filling this in" —
   * distinct from a row never existing (never prompted). See
   * CycleSessionFeedback.feedbackMissing doc comment in schema.prisma. */
  async dismissFeedback(workoutScheduleId: string, userId: string) {
    const schedule = await prisma.workoutSchedule.findFirst({
      where: { id: workoutScheduleId, userId },
    });
    if (!schedule) throw { status: 404, message: "Workout session not found" };

    return prisma.cycleSessionFeedback.upsert({
      where: { workoutScheduleId },
      create: {
        workoutScheduleId,
        cycleId: schedule.trainingCycleId ?? undefined,
        feedbackMissing: true,
      },
      update: { feedbackMissing: true },
    });
  },
};
