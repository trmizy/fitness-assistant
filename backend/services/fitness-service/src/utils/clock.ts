/**
 * Injectable clock for training-cycle domain logic. Business rules that
 * depend on "now" (data-sufficiency gates, adherence windows, InBody
 * snapshot resolution) previously called `new Date()` directly, scattered
 * across the service — impossible to control in a test without actually
 * waiting real time, and each call site was a place a future edit could
 * silently reintroduce a fresh `new Date()` that drifts from the others
 * within the same request.
 *
 * Default export (`systemClock`) is the real wall clock; tests pass a fixed
 * clock instead. Kept deliberately tiny — this is not a full date/time
 * library, just the one seam the domain logic actually needs.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A fixed instant — every `now()` call returns the same Date, so a single
 * test can assert against one known "now" without racing the real clock. */
export function fixedClock(at: Date): Clock {
  return { now: () => at };
}
