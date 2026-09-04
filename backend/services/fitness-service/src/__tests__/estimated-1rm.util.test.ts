import test from "node:test";
import assert from "node:assert/strict";
import { estimate1RM } from "../utils/estimated-1rm.util";

test("estimate1RM: 1 rep returns the weight itself (Epley formula degenerate case)", () => {
  assert.equal(estimate1RM(100, 1), 100 * (1 + 1 / 30));
});

test("estimate1RM: 0 reps returns the weight unchanged (guards against reps<=0)", () => {
  assert.equal(estimate1RM(80, 0), 80);
});

test("estimate1RM: negative reps returns the weight unchanged (defensive)", () => {
  assert.equal(estimate1RM(80, -5), 80);
});

test("estimate1RM: matches the documented Epley formula weight*(1+reps/30)", () => {
  const weight = 60;
  const reps = 10;
  assert.equal(estimate1RM(weight, reps), weight * (1 + reps / 30));
  assert.equal(Math.round(estimate1RM(weight, reps) * 10) / 10, 80);
});
