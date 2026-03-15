import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { logger } from '@gym-coach/shared';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
  logger.info(
    `Auth Service: ${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}`,
  );
  logger.info(
    `Fitness Service: ${process.env.FITNESS_SERVICE_URL || 'http://localhost:3002'}`,
  );
  logger.info(
    `AI Service: ${process.env.AI_SERVICE_URL || 'http://localhost:3003'}`,
  );
});
