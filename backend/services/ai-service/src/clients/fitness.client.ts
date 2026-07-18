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
