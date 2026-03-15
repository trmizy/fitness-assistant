import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/conversation.repository';
import { aiWorker } from './workers/ai.worker';
import { logger } from '@gym-coach/shared';
import { getQdrantClient } from './repositories/qdrant';

const PORT = process.env.PORT || 3003;

async function startServer() {
  try {
    logger.info('AI Service starting...');

    // Check Qdrant connection
    try {
      await getQdrantClient().getCollections();
      logger.info('Connected to Qdrant');
    } catch {
      logger.warn('Qdrant not available, search functionality limited');
    }

    app.listen(PORT, () => {
      logger.info(`AI Service running on port ${PORT}`);
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
  await aiWorker.close();
  process.exit(0);
});
