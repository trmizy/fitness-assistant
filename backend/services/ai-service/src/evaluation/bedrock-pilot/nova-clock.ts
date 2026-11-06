import { PilotError } from "./config";

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
