import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { prisma } from "./repositories/profile.repository";
import { logger } from "@gym-coach/shared";
import { startSessionAutoConfirmJob } from "./services/session-autoconfirm.service";
import { startRescheduleExpiryJob } from "./services/reschedule-expiry.service";
import { startSessionSettlementSweepJob } from "./services/session-settlement-sweep.service";
import { startContractExpirySweepJob } from "./services/contract-expiry-sweep.service";
import { startRoomCloseResolutionJob } from "./services/room-close-resolution.service";

const PORT = process.env.PORT || 3004;

app.listen(PORT, () => {
  logger.info(`👤 User Service running on port ${PORT}`);
  // Settles sessions the client never responded to, so a PT is not left uncredited
  // forever by silence (see session-autoconfirm.service.ts).
  startSessionAutoConfirmJob();
  startRescheduleExpiryJob();
  // Retries no-show compensation / session release / contract termination that failed on
  // their first attempt (money-flow plan 1.6) — see session-settlement-sweep.service.ts.
  startSessionSettlementSweepJob();
  // Settles contracts that drifted past their endDate while still ACTIVE, so the money still
  // sitting in pending for never-booked sessions does not stay stuck forever (P0 cluster A3)
  // — see contract-expiry-sweep.service.ts.
  startContractExpirySweepJob();
  // Open-room online sessions: resolves who showed up once the room's own window has closed,
  // so an ONLINE session's outcome no longer depends on either side clicking a manual
  // complete/no-show button — see room-close-resolution.service.ts.
  startRoomCloseResolutionJob();
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});
