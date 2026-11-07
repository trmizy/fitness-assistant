/**
 * Injectable clock of the V2.1 process (deadlines, SLA, held-money review, appeal window, lease). Production reads the system time; a test pins or advances it, so no test sleeps for 48 hours.
 * Only these modules read it - the rest of the system keeps Date.now().
 */
let override: (() => Date) | null = null;
export const now = (): Date => (override ? override() : new Date());
/** TEST SEAM: pin the clock (pass nothing to restore the system clock). */
export function setClockForTests(fn?: () => Date): void {
  override = fn ?? null;
}
export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;
