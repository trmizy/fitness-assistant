import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './repositories/auth.repository';
import { logger } from '@gym-coach/shared';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`🔐 Auth Service running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});
