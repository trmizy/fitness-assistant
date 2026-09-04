/**
 * Pure numeric helpers for RulerSlider — kept dependency-free and DOM-free so
 * they're directly unit-testable with node:test (this repo's only existing
 * frontend test, refresh-once.test.ts, follows the same convention).
 */

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds `value` to the nearest multiple of `step` above `min`, avoiding
 * float drift (e.g. 0.1 + 0.2) for fractional steps like 0.5. */
export function quantizeToStep(value: number, min: number, step: number): number {
  const steps = Math.round((value - min) / step);
  return Math.round((min + steps * step) * 100) / 100;
}

/** Combines quantize + clamp — the single source of truth for "what is the
 * valid, on-step value closest to this raw number", used both for the
 * initial value and every value produced while dragging. */
export function resolveValue(value: number, min: number, max: number, step: number): number {
  return clampValue(quantizeToStep(value, min, step), min, max);
}

/** Given a drag starting at `startValue` and moving `deltaPx` horizontally
 * (positive = finger moved right), returns the new resolved value. Moving
 * right decreases the pixel delta's effect direction because the ruler's
 * tick strip is dragged like a physical ruler under a fixed center pointer:
 * dragging right reveals smaller values. */
export function valueFromDrag(
  startValue: number,
  deltaPx: number,
  tickSpacingPx: number,
  min: number,
  max: number,
  step: number,
): number {
  const deltaSteps = -deltaPx / tickSpacingPx;
  const raw = startValue + deltaSteps * step;
  return resolveValue(raw, min, max, step);
}

export function stepIndex(value: number, min: number, step: number): number {
  return Math.round((value - min) / step);
}
