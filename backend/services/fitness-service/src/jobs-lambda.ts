import { logger } from "@gym-coach/shared";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

export type FitnessServiceJobName =
  | "workout-upcoming-reminder"
  | "workout-unfinished-reminder"
  // One-off / on-demand (never scheduled): load the curated Vietnamese everyday-food catalog into this database. The
  // jobs Lambda is the only path into Aurora inside the VPC; idempotent, so re-running after a catalog change is safe.
  | "seed-everyday-foods";

export interface FitnessServiceJobEvent {
  job?: FitnessServiceJobName | string;
}

export async function runFitnessServiceJob(event: FitnessServiceJobEvent) {
  switch (event.job) {
    case "workout-upcoming-reminder": {
      const { runUpcomingReminderSweep } = await import("./services/workout-reminder.service");
      return runUpcomingReminderSweep();
    }
    case "workout-unfinished-reminder": {
      const { runUnfinishedReminderSweep } = await import("./services/workout-reminder.service");
      return runUnfinishedReminderSweep();
    }
    case "seed-everyday-foods": {
      const { seedEverydayFoods } = await import("./services/everyday-foods-seed.service");
      const { prisma } = await import("./repositories/prisma");
      const result = await seedEverydayFoods(prisma);
      logger.info(result, "Everyday-food catalog seeded");
      return result;
    }
    default:
      throw Object.assign(new Error(`Unknown fitness-service job: ${event.job ?? ""}`), {
        statusCode: 400,
      });
  }
}

export async function handler(event: FitnessServiceJobEvent = {}) {
  try {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const result = await runFitnessServiceJob(event);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "ok",
        service: "fitness-service",
        job: event.job,
        result,
      }),
    };
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    logger.error(
      { job: event.job, statusCode, message: error?.message },
      "Fitness Service jobs Lambda failed",
    );
    return {
      statusCode,
      body: JSON.stringify({
        status: "error",
        service: "fitness-service",
        job: event.job,
        error: statusCode === 400 ? error.message : "Internal server error",
      }),
    };
  }
}
