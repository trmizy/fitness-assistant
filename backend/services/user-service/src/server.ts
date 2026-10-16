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
import { installGracefulShutdown } from "./lifecycle";

const PORT = process.env.PORT || 3004;

// Each start*Job returns the function that stops its timer, so a termination signal can stop the ticks first.
const stopJobs: Array<() => void> = [];

const server = app.listen(PORT, () => {
  logger.info(`👤 User Service running on port ${PORT}`);
  // Settles sessions the client never responded to, so a PT is not left uncredited
  // forever by silence (see session-autoconfirm.service.ts).
  stopJobs.push(startSessionAutoConfirmJob());
  stopJobs.push(startRescheduleExpiryJob());
  // Retries no-show compensation / session release / contract termination that failed on
  // their first attempt (money-flow plan 1.6) — see session-settlement-sweep.service.ts.
  stopJobs.push(startSessionSettlementSweepJob());
  // Settles contracts that drifted past their endDate while still ACTIVE, so the money still
  // sitting in pending for never-booked sessions does not stay stuck forever (P0 cluster A3)
  // — see contract-expiry-sweep.service.ts.
  stopJobs.push(startContractExpirySweepJob());
  // Open-room online sessions: resolves who showed up once the room's own window has closed,
  // so an ONLINE session's outcome no longer depends on either side clicking a manual
  // complete/no-show button — see room-close-resolution.service.ts.
  stopJobs.push(startRoomCloseResolutionJob());
});

// SIGTERM / SIGINT: stop the ticks, stop accepting, let the requests and sweeps that are running FINISH (bounded by
// SHUTDOWN_GRACE_MS), then close Prisma and exit — see lifecycle.ts. It used to disconnect and exit at once, i.e. every
// rolling deployment killed whatever money step was in flight.
installGracefulShutdown({
  server,
  stopJobs: () => stopJobs.forEach((stop) => stop()),
  disconnect: () => prisma.$disconnect(),
});
