import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/prisma';
import { logger } from '@gym-coach/shared';
import { startMembershipPayoutSweep } from './services/membershipPayout.sweep';

const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    app.listen(PORT, () => {
      logger.info(`Gym Service running on port ${PORT}`);
      startMembershipPayoutSweep();
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
  process.exit(0);
});
