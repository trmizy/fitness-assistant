import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { prisma } from "./repositories/prisma";
import { redisClient } from "./repositories/redis";
import { workoutWorker } from "./workers/workout.worker";
import { startWorkoutUpcomingReminderJob, startWorkoutUnfinishedReminderJob } from "./services/workout-reminder.service";
import { logger } from "@gym-coach/shared";

const PORT = process.env.PORT || 3002;

async function startServer() {
  try {
    await redisClient.connect();
    logger.info("Connected to Redis");

    app.listen(PORT, () => {
      logger.info(`Fitness Service running on port ${PORT}`);
      // Roadmap P4.1 "Notifications/reminders" — same "server.ts only,
      // never app.ts" convention this codebase's own Lambda-prep audit
      // documented for user-service's background jobs (see
      // docs/features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md): a Lambda
      // deployment of this service would correctly never start these.
      startWorkoutUpcomingReminderJob();
      startWorkoutUnfinishedReminderJob();
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  await redisClient.quit();
  await workoutWorker.close();
  process.exit(0);
});
