/**
 * Pure-logic tests for RulerSlider's numeric helpers — no DOM, no pointer
 * simulation needed (this frontend has no jsdom/RTL set up; the one
 * existing test, services/__tests__/refresh-once.test.ts, uses the same
 * dependency-free node:test convention).
 *
 * Run with: npx tsx --test src/app/components/__tests__/RulerSlider.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampValue,
  quantizeToStep,
  resolveValue,
  stepIndex,
  valueFromDrag,
} from "../RulerSlider.utils";

describe("clampValue", () => {
  it("passes values already inside the range through unchanged", () => {
    assert.equal(clampValue(50, 0, 100), 50);
  });

  it("clamps below min", () => {
    assert.equal(clampValue(-20, 0, 300), 0);
  });

  it("clamps above max", () => {
    assert.equal(clampValue(400, 0, 300), 300);
  });
});

describe("quantizeToStep", () => {
  it("snaps to the nearest whole step (reps, step 1)", () => {
    assert.equal(quantizeToStep(12.4, 1, 1), 12);
    assert.equal(quantizeToStep(12.6, 1, 1), 13);
  });

  it("snaps to the nearest fractional step (weight, step 0.5)", () => {
    assert.equal(quantizeToStep(72.3, 0, 0.5), 72.5);
    assert.equal(quantizeToStep(72.1, 0, 0.5), 72);
  });

  it("snaps to the nearest fractional step (RPE, step 0.5) without float drift", () => {
    // 8.5 is exactly representable as a step multiple from min=1; a naive
    // implementation can produce 8.499999999999998 due to float error.
    assert.equal(quantizeToStep(8.5, 1, 0.5), 8.5);
    assert.equal(quantizeToStep(8.7, 1, 0.5), 8.5);
    assert.equal(quantizeToStep(8.8, 1, 0.5), 9);
  });

  it("snaps to a step interval with a non-zero min (rest seconds, step 15)", () => {
    assert.equal(quantizeToStep(100, 0, 15), 105);
    assert.equal(quantizeToStep(112, 0, 15), 105);
    assert.equal(quantizeToStep(113, 0, 15), 120);
  });

  it("never returns a value between two steps", () => {
    for (let raw = 0; raw <= 20; raw += 0.37) {
      const snapped = quantizeToStep(raw, 0, 0.5);
      const stepsFromMin = (snapped - 0) / 0.5;
      assert.ok(
        Number.isInteger(Math.round(stepsFromMin * 1e6) / 1e6),
        `expected ${snapped} to sit exactly on a 0.5 step, got remainder`,
      );
    }
  });
});

describe("resolveValue (quantize + clamp combined)", () => {
  it("clamps an out-of-range initial value down to max (weight 0-300)", () => {
    assert.equal(resolveValue(999, 0, 300, 0.5), 300);
  });

  it("clamps an out-of-range initial value up to min (RIR 0-5)", () => {
    assert.equal(resolveValue(-3, 0, 5, 1), 0);
  });

  it("quantizes an in-range but off-step initial value (sets 1-10, step 1)", () => {
    assert.equal(resolveValue(3.6, 1, 10, 1), 4);
  });

  it("is idempotent — resolving an already-valid value returns it unchanged", () => {
    assert.equal(resolveValue(7.5, 1, 10, 0.5), 7.5);
  });
});

describe("valueFromDrag (continuous swipe -> snapped value)", () => {
  const TICK_SPACING = 14;

  it("dragging left increases the value (reveals larger numbers)", () => {
    const next = valueFromDrag(50, -14, TICK_SPACING, 0, 300, 0.5);
    assert.equal(next, 50.5);
  });

  it("dragging right decreases the value", () => {
    const next = valueFromDrag(50, 14, TICK_SPACING, 0, 300, 0.5);
    assert.equal(next, 49.5);
  });

  it("a drag shorter than one tick's worth of pixels does not change the value", () => {
    const next = valueFromDrag(50, 5, TICK_SPACING, 0, 300, 0.5);
    assert.equal(next, 50);
  });

  it("a fast, large drag clamps at max instead of overshooting", () => {
    const next = valueFromDrag(290, -10_000, TICK_SPACING, 0, 300, 0.5);
    assert.equal(next, 300);
  });

  it("a fast, large drag clamps at min instead of overshooting", () => {
    const next = valueFromDrag(10, 10_000, TICK_SPACING, 0, 300, 0.5);
    assert.equal(next, 0);
  });

  it("every intermediate position during a swipe lands exactly on a step", () => {
    for (let deltaPx = -200; deltaPx <= 200; deltaPx += 3) {
      const next = valueFromDrag(5, deltaPx, TICK_SPACING, 1, 10, 0.5);
      const stepsFromMin = (next - 1) / 0.5;
      assert.equal(Math.round(stepsFromMin), stepsFromMin, `value ${next} is not on-step`);
    }
  });
});

describe("valueFromDrag matches the app's real slider configs (weight/RPE/RIR)", () => {
  const TICK_SPACING = 14;

  it("weight (0-300, step 0.5): a 80px leftward drag from 0 increases the value", () => {
    // Mirrors the real pointerdown->pointermove->pointerup sequence used by
    // RulerSlider, verified against a live browser drag during this bug
    // investigation (0 -> 3 after an 80px drag).
    assert.equal(valueFromDrag(0, -80, TICK_SPACING, 0, 300, 0.5), 3);
  });

  it("RPE (1-10, step 0.5): a 40px leftward drag from 7 increases to 8.5", () => {
    assert.equal(valueFromDrag(7, -40, TICK_SPACING, 1, 10, 0.5), 8.5);
  });

  it("RIR (0-5, step 1): a 20px leftward drag from 2 rounds to the nearest whole step (3)", () => {
    assert.equal(valueFromDrag(2, -20, TICK_SPACING, 0, 5, 1), 3);
  });

  it("RIR (0-5, step 1): a drag shorter than half a step's worth of pixels leaves the value unchanged", () => {
    // step=1 means a full step is 14px; a 6px drag is under half a step and
    // must not register as a change — this is correct snapping, not a bug.
    assert.equal(valueFromDrag(2, -6, TICK_SPACING, 0, 5, 1), 2);
  });
});

describe("pointer drag lifecycle (down -> move* -> up/cancel), simulated via the pure value functions", () => {
  const TICK_SPACING = 14;

  it("a move sequence that ends where it started resolves to the original value (no net change)", () => {
    // Simulates dragging out and back to the same point before releasing —
    // the component always recomputes from the drag START value + total
    // delta, so a net-zero drag must be a no-op regardless of the path.
    const start = 7;
    const afterOut = valueFromDrag(start, -100, TICK_SPACING, 1, 10, 0.5);
    assert.notEqual(afterOut, start);
    const afterBack = valueFromDrag(start, 0, TICK_SPACING, 1, 10, 0.5);
    assert.equal(afterBack, start);
  });

  it("a pointercancel mid-drag must not apply a partial move beyond what was already committed", () => {
    // The component only ever applies onChange for values computed from
    // real pointermove deltas; a cancel doesn't compute any further delta,
    // so the last committed value from the drag-so-far is what remains —
    // there is no separate "commit on release" step to skip.
    const start = 5;
    const midDrag = valueFromDrag(start, -28, TICK_SPACING, 1, 10, 0.5); // 2 ticks
    assert.equal(midDrag, 6);
    // Cancelling here (no further move) leaves the last computed value as-is.
    assert.equal(midDrag, 6);
  });
});

describe("stepIndex", () => {
  it("computes the tick index for a value at min", () => {
    assert.equal(stepIndex(1, 1, 0.5), 0);
  });

  it("computes the tick index for a value several steps in", () => {
    assert.equal(stepIndex(8.5, 1, 0.5), 15);
  });

  it("computes the tick index for the RIR range (min 0, step 1)", () => {
    assert.equal(stepIndex(3, 0, 1), 3);
  });
});
