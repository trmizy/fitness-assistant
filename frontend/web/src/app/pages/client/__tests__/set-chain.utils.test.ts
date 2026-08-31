import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSetChainSegments,
  isSetChainValid,
  newSetChainSegment,
} from "../set-chain.utils";

test("drop-set defaults to an 80% load rounded to the nearest 0.5kg", () => {
  assert.deepEqual(newSetChainSegment("DROP_SET", { weightKg: "83", reps: "10" }), {
    reps: "10",
    weightKg: "66.5",
    restBeforeSeconds: "0",
  });
});

test("rest-pause defaults to three reps and a 20-second pause", () => {
  assert.deepEqual(newSetChainSegment("REST_PAUSE", { weightKg: "80", reps: "8" }), {
    reps: "3",
    weightKg: "80",
    restBeforeSeconds: "20",
  });
});

test("buildSetChainSegments emits contiguous ordered actuals", () => {
  assert.deepEqual(
    buildSetChainSegments({
      setTechnique: "DROP_SET",
      weightKg: "100",
      reps: "6",
      segments: [
        { reps: "8", weightKg: "80", restBeforeSeconds: "0" },
        { reps: "10", weightKg: "60", restBeforeSeconds: "5" },
      ],
    }),
    [
      { segmentNumber: 1, technique: "DROP_SET", reps: 8, weight: 80, restBeforeSeconds: 0 },
      { segmentNumber: 2, technique: "DROP_SET", reps: 10, weight: 60, restBeforeSeconds: 5 },
    ],
  );
});

test("straight sets need no segments while malformed chains are rejected", () => {
  assert.equal(isSetChainValid({ setTechnique: "STRAIGHT", weightKg: "", reps: "", segments: [] }), true);
  assert.equal(isSetChainValid({ setTechnique: "REST_PAUSE", weightKg: "80", reps: "8", segments: [] }), false);
  assert.equal(
    isSetChainValid({
      setTechnique: "REST_PAUSE",
      weightKg: "80",
      reps: "8",
      segments: [{ reps: "0", weightKg: "80", restBeforeSeconds: "700" }],
    }),
    false,
  );
});
