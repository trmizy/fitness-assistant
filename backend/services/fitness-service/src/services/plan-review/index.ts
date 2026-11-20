import { prisma } from "../../repositories/prisma";
import { fetchActiveClientIdsStrict } from "../../clients/user.client";
import { deliverPlanReviewNotification } from "../../clients/notification.client";
import { createPlanReviewService, type PlanReviewDeps } from "./plan-review.service";
import { prismaPlanReviewRepository } from "./plan-review.prisma-repository";

/**
 * Mutable indirection point for tests (same convention as coachDeps): ESM namespace bindings are read-only, a plain object isn't.
 * `fetchActiveClientIds` is the STRICT roster read (throws on any failure) — never the swallow-to-false variant, so an
 * outage reads as "unavailable" (503), not as "contract ended" (which would wrongly revoke open requests).
 */
export const planReviewDeps: PlanReviewDeps = {
  repo: prismaPlanReviewRepository,
  async loadCurrentProgram(clientUserId) {
    // Same selection rule as workoutService.getCurrentProgram, but only the prescription columns the snapshot needs.
    return prisma.workoutProgram.findFirst({
      where: { userId: clientUserId, status: "ACTIVE", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        goal: true,
        durationWeeks: true,
        daysPerWeek: true,
        version: true,
        sourcePlanId: true,
        aiPlanVersion: true,
        days: {
          orderBy: { dayNumber: "asc" },
          select: {
            dayNumber: true,
            title: true,
            exercises: {
              orderBy: { order: "asc" },
              select: {
                exerciseId: true,
                order: true,
                sets: true,
                reps: true,
                weight: true,
                duration: true,
                restSeconds: true,
                notes: true,
                exercise: { select: { exerciseName: true } },
                setPrescriptions: {
                  orderBy: { setNumber: "asc" },
                  select: {
                    setNumber: true,
                    targetReps: true,
                    targetWeight: true,
                    targetRpe: true,
                    targetRir: true,
                    targetSetType: true,
                    isAmrap: true,
                    restSeconds: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  },
  fetchActiveClientIds: (ptUserId) => fetchActiveClientIdsStrict(ptUserId),
  // Persistent + real-time notification through user-service's /internal/notifications (PLAN_REVIEW_REQUESTED / PLAN_REVIEW_DECIDED).
  // Strict (throws on failure => the outbox event stays pending and is retried) and idempotent on the event's dedupeKey.
  notify: (n) => deliverPlanReviewNotification(n),
  now: () => new Date(),
};

// The service reads `planReviewDeps` lazily on each call, so tests may replace its members after import.
export const planReviewService = createPlanReviewService({
  get repo() {
    return planReviewDeps.repo;
  },
  loadCurrentProgram: (id) => planReviewDeps.loadCurrentProgram(id),
  fetchActiveClientIds: (id) => planReviewDeps.fetchActiveClientIds(id),
  get notify() {
    return planReviewDeps.notify;
  },
  now: () => planReviewDeps.now(),
});
