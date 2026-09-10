import { logger } from "@gym-coach/shared";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

export type GymServiceJobName =
  | "membership-payout-sweep"
  | "referral-settlement-sweep";

export interface GymServiceJobEvent {
  job?: GymServiceJobName | string;
}

export async function runGymServiceJob(event: GymServiceJobEvent) {
  switch (event.job) {
    case "membership-payout-sweep": {
      const { runSweep } = await import("./services/membershipPayout.sweep");
      return runSweep();
    }
    case "referral-settlement-sweep": {
      const { runReferralSettlementSweep } = await import("./services/referral-settlement-sweep.service");
      return runReferralSettlementSweep();
    }
    default:
      throw Object.assign(new Error(`Unknown gym-service job: ${event.job ?? ""}`), {
        statusCode: 400,
      });
  }
}

export async function handler(event: GymServiceJobEvent = {}) {
  try {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const result = await runGymServiceJob(event);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "ok",
        service: "gym-service",
        job: event.job,
        result,
      }),
    };
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    logger.error(
      { job: event.job, statusCode, message: error?.message },
      "Gym Service jobs Lambda failed",
    );
    return {
      statusCode,
      body: JSON.stringify({
        status: "error",
        service: "gym-service",
        job: event.job,
        error: statusCode === 400 ? error.message : "Internal server error",
      }),
    };
  }
}

