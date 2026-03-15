import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/prisma';
import { redisClient } from './repositories/redis';
import { workoutWorker } from './workers/workout.worker';
import { logger } from '@gym-coach/shared';

const PORT = process.env.PORT || 3002;

async function startServer() {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis');

    app.listen(PORT, () => {
      logger.info(`Fitness Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  await redisClient.quit();
  await workoutWorker.close();
  process.exit(0);
});
