/**
 * Screen Wake Lock — progressive enhancement (gap analysis P0 "Rest timer").
 * Extracted out of WorkoutLogPage.tsx's useEffect so the fallback behavior
 * (API absent / permission denied) can be unit-tested with a fake
 * `navigator`-like object, matching this frontend's "no jsdom/RTL, pure
 * logic + node:test" convention (see workout-log-url.utils.ts,
 * RulerSlider.utils.ts).
 *
 * Wake Lock is NEVER a hard dependency for logging a workout: on a browser
 * without support, or when a request is rejected (denied permission, tab
 * not visible, etc.), these functions resolve to null/no-op instead of
 * throwing — the rest timer and workout logging work exactly the same
 * either way.
 */

export interface WakeLockSentinelLike {
  release?: () => Promise<void>;
}

export interface NavigatorWakeLockLike {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
}

/** Requests a screen wake lock if the API is present; returns null (never
 * throws) when the API is missing or the request is rejected. */
export async function requestWakeLockSafe(
  nav: NavigatorWakeLockLike | undefined | null,
): Promise<WakeLockSentinelLike | null> {
  if (!nav || !("wakeLock" in nav) || !nav.wakeLock) return null;
  try {
    return await nav.wakeLock.request("screen");
  } catch {
    // Permission denied / not allowed in this context (e.g. tab not
    // visible) — silently no-op, never blocks the workout.
    return null;
  }
}

/** Releases a previously-acquired wake lock; never throws, and is a no-op
 * for null/undefined or a lock-like object without a release method. */
export async function releaseWakeLockSafe(
  lock: WakeLockSentinelLike | null | undefined,
): Promise<void> {
  if (!lock?.release) return;
  try {
    await lock.release();
  } catch {
    // Already released, or the underlying platform no-ops release — fine
    // either way, this is best-effort cleanup only.
  }
}
