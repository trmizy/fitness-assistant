import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/prisma';
import { logger } from '@gym-coach/shared';
import { startReconciliationJob } from './services/reconciliation.service';

import { paymentGateVerdict, lateOpenSettlementVerdict } from './services/late-open-settlement-flag';

const PORT = process.env.PORT || 3007;

async function startServer() {
  try {
    app.listen(PORT, () => {
      logger.info(`Payment Service running on port ${PORT}`);
      const gate = paymentGateVerdict();
      logger.info(`[dispute-runtime-gate] payment-service mode=${gate.mode} open=${gate.open} db=${gate.database || '?'}${gate.refusedBecause ? ` refused=${gate.refusedBecause}` : ''} lateOpenSettlement=${lateOpenSettlementVerdict().effective}`);
      startReconciliationJob();
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
