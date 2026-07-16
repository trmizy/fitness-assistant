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

// Fail-closed in production only (mirrors gateway's validateInternalSecret):
// every access/refresh token in the system is signed with these secrets, so a
// default or short value would let anyone forge a valid session.
if (process.env.NODE_ENV === "production") {
  const JWT_SECRET_DEFAULT = "dev_jwt_secret_change_in_production";
  const JWT_REFRESH_SECRET_DEFAULT = "refresh-secret-key-change-in-production";
  const problems: string[] = [];

  const accessSecret = process.env.JWT_SECRET;
  if (!accessSecret || accessSecret === JWT_SECRET_DEFAULT || accessSecret.length < 32) {
    problems.push("JWT_SECRET");
  }
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (
    !refreshSecret ||
    refreshSecret === JWT_REFRESH_SECRET_DEFAULT ||
    refreshSecret.length < 32
  ) {
    problems.push("JWT_REFRESH_SECRET");
  }

  if (problems.length > 0) {
    logger.error(
      `${problems.join(", ")} must be set in production, must not be the default value, and must be at least 32 characters long — refusing to start.`,
    );
    process.exit(1);
  }
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
