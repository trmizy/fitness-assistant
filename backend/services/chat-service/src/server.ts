import 'dotenv/config';
import http from 'http';
import app from './app';
import { initSocket } from './socket';
import { logger } from '@gym-coach/shared';

const PORT = Number(process.env.CHAT_SERVICE_PORT) || 3005;

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Chat service running on port ${PORT}`);
});

export default httpServer;
