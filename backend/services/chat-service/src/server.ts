import "dotenv/config";
import http from "http";
import app from "./app";
import { initSocket, getIo } from "./socket";
import { prisma } from "./repositories/chat.repository";
import { logger } from "@gym-coach/shared";

const PORT = Number(process.env.CHAT_SERVICE_PORT) || 3005;

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Chat service running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  getIo()?.close();
  await prisma.$disconnect();
  httpServer.close(() => {
    logger.info("Chat service HTTP server closed");
    process.exit(0);
  });
  // Force-exit if something (e.g. a stuck socket connection) never lets close() finish.
  setTimeout(() => {
    logger.warn("Forceful shutdown after 10s drain timeout");
    process.exit(1);
  }, 10000).unref();
});

export default httpServer;
