import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { prisma } from "./repositories/auth.repository";
import { logger } from "@gym-coach/shared";

// Fail-closed: /auth/internal/* endpoints rely on x-service-secret. Refuse to start
// without one rather than running with an unprotected internal surface.
if (!process.env.INTERNAL_SERVICE_SECRET) {
  logger.error(
    "INTERNAL_SERVICE_SECRET is not set — refusing to start. /auth/internal/* endpoints would be effectively unprotected.",
  );
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`🔐 Auth Service running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});
