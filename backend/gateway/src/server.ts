import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./app";
import { logger } from "@gym-coach/shared";
import { initializeSocketServer } from "./socket";

const PORT = process.env.PORT || 3000;
const server = createServer(app);

initializeSocketServer(server);

server.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
  logger.info(
    `Auth Service: ${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}`,
  );
  logger.info(
    `Fitness Service: ${process.env.FITNESS_SERVICE_URL || "http://localhost:3002"}`,
  );
  logger.info(
    `AI Service: ${process.env.AI_SERVICE_URL || "http://localhost:3003"}`,
  );
});
