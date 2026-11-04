import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/prisma';
import { logger } from '@gym-coach/shared';
import { startMembershipPayoutSweep } from './services/membershipPayout.sweep';
import { startReferralSettlementSweepJob } from './services/referral-settlement-sweep.service';
import { assertFrontendUrlForProduction } from './config/frontend-url';
import { assertPartnerS3ProductionSafe } from './services/partner-s3.guard';
import { startCompatWriterHeartbeat, stopCompatWriterHeartbeat } from './services/compat-writer-heartbeat.service';
import { startGymListingSweepJob } from './services/gym-listing-sweep.service';

import { gateVerdict, flagVerdict } from './services/complaint-case/flags';
const PORT = process.env.PORT || 3006;
let stopGymListingSweep: (() => void) | null = null;

async function startServer() {
  try {
    assertPartnerS3ProductionSafe();
    // Invite / reset links are built from FRONTEND_URL - production refuses to start without a public one (config/frontend-url.ts).
    assertFrontendUrlForProduction();
    app.listen(PORT, () => {
      logger.info(`Gym Service running on port ${PORT}`);
      const gate = gateVerdict();
      logger.info(`[dispute-runtime-gate] gym-service mode=${gate.mode} open=${gate.open} db=${gate.database || '?'}${gate.refusedBecause ? ` refused=${gate.refusedBecause}` : ''} GYM_COMPLAINT_CASE_ENABLED=${process.env.GYM_COMPLAINT_CASE_ENABLED === 'true' ? (flagVerdict().refusedBecause ?? 'ON') : 'off'}`);
      startMembershipPayoutSweep();
      // P0 cluster E4 — retries a referral commission settlement that failed on its first
      // attempt after activation. See referral-settlement-sweep.service.ts.
      startReferralSettlementSweepJob();
      // Listing Management B1 — proves this instance writes with the compat-writer protocol (startup + every 10 min).
      startCompatWriterHeartbeat();
      // Listing Management B2 - dead upload intents, orphaned STAGED photos (7 days), RETIRED photos (90 days).
      stopGymListingSweep = startGymListingSweepJob();
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopCompatWriterHeartbeat();
  stopGymListingSweep?.();
  await prisma.$disconnect();
  process.exit(0);
});
