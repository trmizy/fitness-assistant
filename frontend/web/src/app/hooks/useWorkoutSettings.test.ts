import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRestSeconds, playRestTimerFeedback } from "./useWorkoutSettings";

test("normalizeRestSeconds rounds to 15-second steps and clamps the supported range", () => {
  assert.equal(normalizeRestSeconds(7), 15);
  assert.equal(normalizeRestSeconds(62), 60);
  assert.equal(normalizeRestSeconds(68), 75);
  assert.equal(normalizeRestSeconds(999), 300);
  assert.equal(normalizeRestSeconds("bad"), 90);
});

test("playRestTimerFeedback is safe when browser feedback APIs are unavailable", () => {
  assert.doesNotThrow(() =>
    playRestTimerFeedback({ restTimerSound: true, restTimerVibration: true }),
  );
});
