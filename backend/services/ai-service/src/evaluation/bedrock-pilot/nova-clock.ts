import fs from "node:fs";
import { PilotError } from "./config";

/**
 * Cross-process rollback tripwire: durable files this run already wrote/received (issued ledger, release, run journal)
 * carry OS modification times. A wall clock earlier than any of them (beyond a small tolerance) means the clock moved
 * backwards since, so a fresh process must not trust it to judge approval/release expiry. Not proof against a hostile
 * operator who also rewrites file times; it fails closed on honest rollback/NTP mistakes.
 */
export const NOVA_CLOCK_ROLLBACK_TOLERANCE_MS = 2000;
export function assertNoObservedClockRollback(files: readonly string[], now = Date.now()): void {
  if (!Number.isFinite(now)) throw new PilotError("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
  for (const file of files) {
    let mtime: number; try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (mtime > now + NOVA_CLOCK_ROLLBACK_TOLERANCE_MS) throw new PilotError("NOVA_CLOCK_ROLLBACK", { observed: "FILE_TIME_AHEAD_OF_CLOCK" });
  }
}

/** Process-local observations only. A new process still requires a trusted system clock. */
export function novaAuthorityClock(projectMonotonicDeadline = false) {
  const start = Date.now(), mono = process.hrtime.bigint(); let last = start, rejected = false;
  return () => {
    const wall = Date.now(), elapsed = Number(process.hrtime.bigint() - mono) / 1e6;
    if (!Number.isFinite(wall) || !Number.isFinite(start) || elapsed < 0) throw new PilotError("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
    if (rejected || wall < last) { rejected = true; throw new PilotError("NOVA_CLOCK_ROLLBACK"); }
    last = wall;
    // The credential admission clock cannot extend a phase by stalling/backdating wall time after admission.
    return projectMonotonicDeadline ? Math.max(wall, start + elapsed) : wall;
  };
}
