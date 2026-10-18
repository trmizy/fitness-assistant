import { logger } from "@gym-coach/shared";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

export type UserServiceJobName =
  | "session-auto-confirm"
  | "reschedule-expiry"
  | "session-settlement"
  | "pt-listing-sweep";

export interface UserServiceJobEvent {
  job?: UserServiceJobName | string;
}

/** What the Lambda runtime tells a handler about its remaining time (the part this file uses). */
export interface LambdaContextLike {
  getRemainingTimeInMillis?: () => number;
}

export interface JobRunOptions {
  /** Epoch ms after which a batch job must not START another row (bounded drain: it finishes the row in flight and returns). */
  deadlineAt?: number;
}

/** Time kept back for the row in flight (a payment-service call is bounded at 20 s) and the response. */
export const LAMBDA_DEADLINE_MARGIN_MS = 30_000;

export async function runUserServiceJob(event: UserServiceJobEvent, opts: JobRunOptions = {}) {
  switch (event.job) {
    case "session-auto-confirm": {
      const { runAutoConfirm } = await import("./services/session-autoconfirm.service");
      return runAutoConfirm();
    }
    case "reschedule-expiry": {
      const { runRescheduleExpiry } = await import("./services/reschedule-expiry.service");
      return runRescheduleExpiry();
    }
    case "session-settlement": {
      const { runSettlementSweep } = await import("./services/session-settlement-sweep.service");
      return runSettlementSweep({ deadlineAt: opts.deadlineAt });
    }
    case "pt-listing-sweep": {
      const { runPtListingSweep } = await import("./services/pt-listing-sweep.service");
      return runPtListingSweep();
    }
    default:
      throw Object.assign(new Error(`Unknown user-service job: ${event.job ?? ""}`), {
        statusCode: 400,
      });
  }
}

export async function handler(event: UserServiceJobEvent = {}, context?: LambdaContextLike) {
  try {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    // Graceful end of a batch job: stop starting rows LAMBDA_DEADLINE_MARGIN_MS before the platform would cut the invocation,
    // so a payment-service call in flight is never cut off by the timeout (whatever is left is retried by the next run).
    const remaining = typeof context?.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : undefined;
    const deadlineAt = remaining === undefined ? undefined : Date.now() + Math.max(0, remaining - LAMBDA_DEADLINE_MARGIN_MS);
    const result = await runUserServiceJob(event, { deadlineAt });
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "ok",
        service: "user-service",
        job: event.job,
        result,
      }),
    };
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    logger.error(
      {
        job: event.job,
        statusCode,
        message: error?.message,
      },
      "User Service jobs Lambda failed",
    );
    return {
      statusCode,
      body: JSON.stringify({
        status: "error",
        service: "user-service",
        job: event.job,
        error: statusCode === 400 ? error.message : "Internal server error",
      }),
    };
  }
}
