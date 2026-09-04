import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./app";
import { logger } from "@gym-coach/shared";
import { initializeSocketServer } from "./socket";
import { chatSocketProxy } from "./routes/proxy.routes";

const PORT = process.env.PORT || 3000;
const server = createServer(app);

const io = initializeSocketServer(server);

// Chat's Socket.IO is proxied at "/chat-socket.io" (see proxy.routes.ts). Express
// middleware only ever sees ordinary HTTP requests, so the WebSocket handshake — an
// HTTP "upgrade" on the raw server — has to be forwarded here explicitly; without
// this the client silently degrades to HTTP long-polling. The path check keeps this
// off the gateway's OWN Socket.IO server, which handles "/socket.io" upgrades.
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/chat-socket.io")) {
    // http-proxy-middleware types `upgrade` against Express's Request, but the raw
    // "upgrade" event hands us a plain IncomingMessage — the proxy only reads url/
    // headers off it, so the cast is safe.
    chatSocketProxy.upgrade?.(req as never, socket as never, head);
  }
});

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

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  io.close();
  // Stop accepting new connections and let in-flight proxied requests
  // (including long-lived SSE streams) finish before exiting.
  server.close(() => {
    logger.info("Gateway HTTP server closed");
    process.exit(0);
  });
  // Force-exit if something (e.g. a stuck SSE stream) never lets close() finish.
  setTimeout(() => {
    logger.warn("Forceful shutdown after 10s drain timeout");
    process.exit(1);
  }, 10000).unref();
});
