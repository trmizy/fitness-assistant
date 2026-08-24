/**
 * Regression tests for the root-cause bug in the "real-time body profile"
 * refactor: a new InBody measurement had no way to be told apart from the
 * user's original starting weight, so there was no way to compute
 * "progress since I started" — see docs/body-state-and-adaptive-planning.md.
 *
 * Run with: npx tsx --test src/__tests__/profile-starting-weight.util.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeStartingWeightPatch } from "../repositories/profile-starting-weight.util";

// Spec §42 — the core bug scenario: baseline=80, target=72, current=80 at
// onboarding; a new InBody weight of 78 arrives. baseline/target must not
// move; only current changes (current-weight write is not this function's
// concern — it always happens; this function only decides startingWeight).
test("first-ever weight write (no existing startingWeight) captures it as the starting weight", () => {
  const patch = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: 80,
    source: "ONBOARDING",
  });
  assert.deepEqual(patch, { startingWeight: 80, startingWeightSource: "ONBOARDING" });
});

// Spec §43 — second InBody: baseline=80 already set from week 0; week 1
// arrives at 78, then week 2 at 77. Neither write should touch baseline.
test("a subsequent InBody weight write, once startingWeight already exists, leaves it untouched", () => {
  const week1 = computeStartingWeightPatch({
    existingStartingWeight: 80,
    incomingCurrentWeight: 78,
    source: "INBODY",
  });
  assert.equal(week1, null);

  const week2 = computeStartingWeightPatch({
    existingStartingWeight: 80, // still 80 — week1's write never changed it
    incomingCurrentWeight: 77,
    source: "INBODY",
  });
  assert.equal(week2, null);
});

test("existingStartingWeight of 0 still counts as 'already set' (falsy-but-valid weight)", () => {
  // Guards against a `!existing.startingWeight` style bug that would treat
  // a (nonsensical but technically stored) 0 as "unset" and re-trigger.
  const patch = computeStartingWeightPatch({
    existingStartingWeight: 0,
    incomingCurrentWeight: 78,
    source: "INBODY",
  });
  assert.equal(patch, null);
});

test("a write with no currentWeight in the payload never sets startingWeight, even if unset", () => {
  // e.g. a referral-code-only or PT-acceptance-toggle profile write.
  const patch = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: undefined,
    source: "ONBOARDING",
  });
  assert.equal(patch, null);
});

test("a non-numeric currentWeight (defensive — should never happen past validation) is ignored", () => {
  const patch = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: "80" as unknown,
    source: "ONBOARDING",
  });
  assert.equal(patch, null);
});

test("NaN/Infinity currentWeight is ignored rather than persisted as a starting weight", () => {
  assert.equal(
    computeStartingWeightPatch({
      existingStartingWeight: null,
      incomingCurrentWeight: NaN,
      source: "ONBOARDING",
    }),
    null,
  );
  assert.equal(
    computeStartingWeightPatch({
      existingStartingWeight: null,
      incomingCurrentWeight: Infinity,
      source: "ONBOARDING",
    }),
    null,
  );
});

// Spec §45 — goal immutability. This function's contract never includes
// targetWeight at all (by construction, not by a runtime check) — the type
// signature has no target-weight field, so there is no code path through
// which a weight write could touch it. This test documents that contract.
test("the function has no way to influence targetWeight — it isn't part of its input or output shape", () => {
  const patch = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: 74, // e.g. user regains weight after a cut
    source: "INBODY",
  });
  assert.deepEqual(Object.keys(patch!), ["startingWeight", "startingWeightSource"]);
});

test("source is recorded as given — ONBOARDING for a direct profile edit, INBODY for a sync", () => {
  const onboarding = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: 65,
    source: "ONBOARDING",
  });
  assert.equal(onboarding?.startingWeightSource, "ONBOARDING");

  const inbody = computeStartingWeightPatch({
    existingStartingWeight: null,
    incomingCurrentWeight: 65,
    source: "INBODY",
  });
  assert.equal(inbody?.startingWeightSource, "INBODY");
});
