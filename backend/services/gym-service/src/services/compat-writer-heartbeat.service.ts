import os from 'os';
import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { COMPAT_WRITER_VERSION } from '../repositories/compat-writer';

/**
 * Listing Management B1 (plan 12.15 item 3) - `compat_writer_heartbeats`: every running gym-service instance records that
 * it is alive AND speaks the current compat-writer protocol ('v1'), once at startup and then every 10 minutes. The
 * decision report derives `firstWriterAt = min(seen_at) WHERE writer_version = 'v1'` and detects gaps from it.
 *
 * Strictly best-effort: a failed insert is logged and swallowed - it must never crash the service or a request.
 */

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

/** Stable for the life of this process: host + pid + a uuid minted at module load (a restart is a NEW instance). */
export const COMPAT_INSTANCE_ID = `${os.hostname()}:${process.pid}:${randomUUID()}`;

export function heartbeatIntervalMs(): number {
  const raw = Number(process.env.COMPAT_WRITER_HEARTBEAT_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
}

/** Inserts one heartbeat row (seen_at = the database's now()). Resolves true when written, false when swallowed. */
export async function recordCompatWriterHeartbeat(): Promise<boolean> {
  try {
    await prisma.compatWriterHeartbeat.create({
      data: {
        instanceId: COMPAT_INSTANCE_ID,
        gitSha: process.env.GIT_SHA?.trim() || 'unknown',
        writerVersion: COMPAT_WRITER_VERSION,
      },
    });
    return true;
  } catch (e) {
    logger.warn({ message: (e as Error)?.message }, '[CompatWriterHeartbeat] could not record a heartbeat');
    return false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Writes the startup heartbeat now, then one per interval. Returns a stop function (also `stopCompatWriterHeartbeat`). */
export function startCompatWriterHeartbeat(): () => void {
  stopCompatWriterHeartbeat();
  const interval = heartbeatIntervalMs();
  logger.info(`Compat writer heartbeat started (interval: ${Math.round(interval / 1000)} s)`);
  void recordCompatWriterHeartbeat();
  timer = setInterval(() => {
    void recordCompatWriterHeartbeat();
  }, interval);
  timer.unref?.();
  return stopCompatWriterHeartbeat;
}

export function stopCompatWriterHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
