import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/prisma';
import { logger } from '@gym-coach/shared';
import { startMembershipPayoutSweep } from './services/membershipPayout.sweep';
import { startReferralSettlementSweepJob } from './services/referral-settlement-sweep.service';
import { assertPartnerS3ProductionSafe } from './services/partner-s3.guard';

const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    assertPartnerS3ProductionSafe();
    app.listen(PORT, () => {
      logger.info(`Gym Service running on port ${PORT}`);
      startMembershipPayoutSweep();
      // P0 cluster E4 — retries a referral commission settlement that failed on its first
      // attempt after activation. See referral-settlement-sweep.service.ts.
      startReferralSettlementSweepJob();
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
