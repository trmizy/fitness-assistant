import dotenv from 'dotenv';
dotenv.config();

import { logger } from '@gym-coach/shared';
import { createKnowledgePipelineWorker } from '../knowledge-pipeline/worker';
import { closeKnowledgePipelineQueue } from '../knowledge-pipeline/queue';
import { prisma } from '../repositories/conversation.repository';

const worker = createKnowledgePipelineWorker();

logger.info('Knowledge pipeline worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Knowledge pipeline worker shutting down');
  await worker.close();
  await closeKnowledgePipelineQueue();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
