import type { Server } from "node:http";
import { logger } from "@gym-coach/shared";

/**
 * Graceful shutdown (Phase 0 / D58 unit 4, audit O1).
 *
 * `SIGTERM` used to be `prisma.$disconnect(); process.exit(0)`: every rolling deployment was a hard kill in the middle of
 * whatever money step was in flight (the D57 crash windows G1/G2/R1-R4). Now a termination signal
 *   1. stops the periodic jobs (no new tick starts),
 *   2. stops accepting connections and lets the requests already being served finish (idle keep-alive connections are closed,
 *      busy ones get `Connection: close` on their response),
 *   3. waits for the sweeps / jobs that are running right now,
 *   4. - all bounded by SHUTDOWN_GRACE_MS (default 30 s: payment-service calls are bounded at 10-20 s) - and only then closes
 *      the database pool and exits (code 0; code 1 when the deadline cut something off).
 * Everything a stopped process leaves behind is a durable intent row that the next instance's sweep repeats with the same key
 * (see contract-payout.service.ts) - the shutdown narrows the window, it is not what makes recovery correct.
 *
 * Infrastructure still has to give the container `terminationGracePeriodSeconds` >= SHUTDOWN_GRACE_MS + a few seconds.
 */

const inflightJobs = new Set<Promise<unknown>>();
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Register a running job / sweep so a shutdown waits for it. Returns the same promise. */
export function trackJob<T>(job: Promise<T>): Promise<T> {
  inflightJobs.add(job);
  const done = () => {
    inflightJobs.delete(job);
  };
  job.then(done, done);
  return job;
}

export function inflightJobCount(): number {
  return inflightJobs.size;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits until every tracked job has finished, or `ms` elapsed. Returns true when none is left. */
export async function waitForJobs(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (inflightJobs.size > 0 && Date.now() < until) {
    await Promise.race([Promise.allSettled([...inflightJobs]), sleep(Math.min(250, Math.max(0, until - Date.now())))]);
  }
  return inflightJobs.size === 0;
}

export interface ShutdownOptions {
  /** The HTTP server (omit for a process that only runs jobs). */
  server?: Server;
  /** Clears the interval timers of the periodic jobs. */
  stopJobs: () => void;
  /** Closes the database pool. */
  disconnect: () => Promise<unknown>;
  graceMs?: number;
  /** Test seam. */
  exit?: (code: number) => void;
}

export interface ShutdownResult {
  drained: boolean;
  pendingJobs: number;
}

/** The shutdown sequence itself (separate from signal wiring so it can be tested). */
export async function gracefulShutdown(signal: string, opts: ShutdownOptions): Promise<ShutdownResult> {
  shuttingDown = true;
  const graceMs = opts.graceMs ?? Math.max(0, Number(process.env.SHUTDOWN_GRACE_MS ?? 30_000));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  logger.info(`${signal} received - shutting down gracefully (grace ${Math.round(graceMs / 1000)} s)`);

  opts.stopJobs();

  let serverClosed: Promise<void> = Promise.resolve();
  let idleTimer: NodeJS.Timeout | undefined;
  if (opts.server) {
    const server = opts.server;
    serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
    // Idle keep-alive connections would keep close() waiting for ever; busy ones are closed after their response.
    server.closeIdleConnections?.();
    idleTimer = setInterval(() => server.closeIdleConnections?.(), 250);
  }

  const startedAt = Date.now();
  let timedOut = false;
  const timeout = sleep(graceMs).then(() => {
    timedOut = true;
  });
  await Promise.race([Promise.all([serverClosed, waitForJobs(graceMs)]), timeout]);
  if (idleTimer) clearInterval(idleTimer);

  const pendingJobs = inflightJobs.size;
  if (timedOut || pendingJobs > 0) {
    logger.error(
      `Shutdown deadline reached after ${Date.now() - startedAt} ms with ${pendingJobs} job(s) still running - forcing the connections closed; ` +
        "whatever they left unfinished is a durable intent that the next instance repeats",
    );
    opts.server?.closeAllConnections?.();
  }

  try {
    await opts.disconnect();
  } catch (e) {
    logger.error(`prisma disconnect failed: ${(e as Error).message}`);
  }
  const drained = !timedOut && pendingJobs === 0;
  exit(drained ? 0 : 1);
  return { drained, pendingJobs };
}

/** Wires SIGTERM / SIGINT to {@link gracefulShutdown}; runs it at most once. */
export function installGracefulShutdown(opts: ShutdownOptions): void {
  let started = false;
  const handler = (signal: string) => {
    if (started) return;
    started = true;
    void gracefulShutdown(signal, opts);
  };
  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
  // Requests that arrive on an already-open connection while shutting down are answered, then the connection is closed.
  opts.server?.on("request", (_req, res) => {
    if (shuttingDown) res.setHeader("Connection", "close");
  });
}
