import { logger } from "@gym-coach/shared";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

export type UserServiceJobName =
  | "session-auto-confirm"
  | "reschedule-expiry"
  | "session-settlement";

export interface UserServiceJobEvent {
  job?: UserServiceJobName | string;
}

export async function runUserServiceJob(event: UserServiceJobEvent) {
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
      return runSettlementSweep();
    }
    default:
      throw Object.assign(new Error(`Unknown user-service job: ${event.job ?? ""}`), {
        statusCode: 400,
      });
  }
}

export async function handler(event: UserServiceJobEvent = {}) {
  try {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const result = await runUserServiceJob(event);
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
