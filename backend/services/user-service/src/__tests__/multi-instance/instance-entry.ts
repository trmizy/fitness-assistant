/**
 * TEST HARNESS (audit D57-1) - one user-service INSTANCE as its own OS process.
 *
 * It boots the REAL Express app (src/app.ts, unchanged) on PORT and does NOT start the setInterval jobs (server.ts does
 * that); instead a tiny control port lets the orchestrating test run a sweep function ON DEMAND, at an agreed wall-clock
 * instant, so that "the same sweep on two instances at the same time" is deterministic rather than a matter of timers.
 * The sweep functions themselves are the real, unmodified product functions with their real in-process `running` flags.
 *
 *   POST /ctl/job?name=<job>&at=<epoch ms>   -> waits until `at`, runs the job, answers { pid, startedAt, endedAt, result }
 *   GET  /ctl/ping                           -> { pid }
 *
 * Nothing here changes product behaviour; it only adds a way to call the same exported functions server.ts's timers call.
 * Module state (lock queue, holder semaphore, `running` flags, PrismaClient pool) is per process, exactly as in production.
 */
import http from "node:http";

const PORT = Number(process.env.PORT);
const CTL_PORT = Number(process.env.CTL_PORT);

async function runJob(name: string): Promise<unknown> {
  switch (name) {
    case "settlement":
      return (await import("../../services/session-settlement-sweep.service")).runSettlementSweep();
    case "expiry":
      return (await import("../../services/contract-expiry-sweep.service")).runContractExpirySweep();
    case "paymentDeadline":
      return (await import("../../services/contract-expiry-sweep.service")).runContractPaymentDeadlineSweep();
    case "holdback":
      return (await import("../../services/contract-expiry-sweep.service")).runContractHoldbackSweep();
    case "autoConfirm":
      return (await import("../../services/session-autoconfirm.service")).runAutoConfirm();
    case "reschedule":
      return (await import("../../services/reschedule-expiry.service")).runRescheduleExpiry();
    case "roomClose":
      return (await import("../../services/room-close-resolution.service")).runRoomCloseResolution();
    default:
      throw new Error(`unknown job ${name}`);
  }
}

async function main() {
  const { default: app } = await import("../../app");
  await new Promise<void>((resolve) => app.listen(PORT, "127.0.0.1", () => resolve()));
  http
    .createServer(async (req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      res.setHeader("content-type", "application/json");
      if (u.pathname === "/ctl/ping") return void res.end(JSON.stringify({ pid: process.pid }));
      if (u.pathname === "/ctl/job") {
        const at = Number(u.searchParams.get("at") ?? 0);
        const wait = at - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const startedAt = Date.now();
        try {
          const result = await runJob(String(u.searchParams.get("name")));
          return void res.end(JSON.stringify({ pid: process.pid, startedAt, endedAt: Date.now(), result }));
        } catch (e) {
          res.statusCode = 500;
          return void res.end(JSON.stringify({ pid: process.pid, error: String((e as Error).message) }));
        }
      }
      res.statusCode = 404;
      res.end("{}");
    })
    .listen(CTL_PORT, "127.0.0.1");
}

main().catch((e) => {
  console.error("instance-entry failed", e);
  process.exit(1);
});
