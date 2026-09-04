/**
 * Calls fitness-service to check whether a user actually finished a training
 * cycle built on a given plan — the gate for leaving a marketplace review.
 * Mirrors worker-user-context.ts's internalHeaders(userId) pattern.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://fitness-service:3002"
    : "http://localhost:3002");

function internalHeaders(userId: string) {
  return {
    "x-internal-token": process.env.INTERNAL_SERVICE_SECRET || "",
    "x-user-id": userId,
  };
}

export async function hasCompletedCycleForPlan(
  userId: string,
  sourcePlanId: string,
): Promise<boolean> {
  try {
    const res = await axios.get(
      `${FITNESS_SERVICE_URL}/internal/training-cycles/completed`,
      {
        headers: internalHeaders(userId),
        params: { sourcePlanId },
        timeout: 5000,
      },
    );
    return !!res.data?.data?.completed;
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId, sourcePlanId },
      "[marketplace] cycle-completion check failed",
    );
    return false;
  }
}

/**
 * Batch-checks whether each listing's exercises actually resolve against fitness-service's
 * real exercise catalog — used by marketplace.service.ts's browse() to filter out listings
 * whose content can't be applied (often leftover E2E-fixture data — "Fixture Exercise 1"
 * etc. — found live while testing the marketplace flow). One network call per browse()
 * request regardless of pool size, not one per listing.
 *
 * Fails OPEN (returns every listingId as mappable) on any network/service error — this is
 * a UX-quality filter, not a security boundary, and hiding the whole marketplace because
 * fitness-service hiccuped would be a worse outcome than occasionally letting an unmappable
 * listing back through (which importAiPlanToSchedule still rejects safely at apply-time).
 */
export async function validateMarketplaceSchedulesMappable(
  schedules: Array<{ listingId: string; weeklySchedule: unknown }>,
): Promise<Set<string>> {
  if (schedules.length === 0) return new Set();
  try {
    const res = await axios.post(
      `${FITNESS_SERVICE_URL}/internal/exercises/validate-marketplace-schedules`,
      { schedules },
      {
        headers: {
          "x-internal-token": process.env.INTERNAL_SERVICE_SECRET || "",
          "x-user-id": "system-marketplace-browse",
        },
        timeout: 10000,
      },
    );
    const results = res.data?.data?.results as
      | Array<{ listingId: string; mappable: boolean }>
      | undefined;
    if (!Array.isArray(results)) return new Set(schedules.map((s) => s.listingId));
    return new Set(results.filter((r) => r.mappable).map((r) => r.listingId));
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, count: schedules.length },
      "[marketplace] exercise-mappability check failed — failing open (not filtering)",
    );
    return new Set(schedules.map((s) => s.listingId));
  }
}

export interface CommittedProgramResult {
  createdProgramId: string;
  createdScheduleCount: number;
}

/** Called when a Personalized PT Service order is ACCEPTED — commits the
 * PT's delivered draft (already in createManualProgramSchema shape) into
 * the BUYER's real WorkoutProgram + WorkoutSchedule, via the same
 * workoutService.createManualProgram path coach.service.ts's
 * createAndAssignPlan already uses for Contract-based PT coaching. Throws
 * on failure — unlike the read-only checks above, a failed commit here must
 * surface as a real error to the caller (an order can't silently sit
 * ACCEPTED with nothing actually assigned). */
export async function commitPersonalizedPlan(
  buyerUserId: string,
  draftContent: unknown,
): Promise<CommittedProgramResult> {
  const res = await axios.post(
    `${FITNESS_SERVICE_URL}/internal/workouts/manual-program`,
    draftContent,
    { headers: internalHeaders(buyerUserId), timeout: 15000 },
  );
  const data = res.data?.data;
  return { createdProgramId: data.createdProgramId, createdScheduleCount: data.createdScheduleCount };
}
