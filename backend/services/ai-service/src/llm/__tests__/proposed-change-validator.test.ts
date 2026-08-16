/**
 * Regression tests for the proposedChanges semantic validator — the gap
 * flagged in docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md: the existing
 * allowedChanges filter (cycle-assessment.service.ts) only checks a
 * proposed change's TYPE is authorized by the Decision Engine's
 * recommendedActionScope, not that its actual numeric value is a plausible
 * single-cycle adjustment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateProposedChanges, type ProposedChange } from "../proposed-change-validator";

function change(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    type: "LOAD",
    target: "Bench Press",
    currentValue: "60kg",
    proposedValue: "62.5kg",
    reason: "steady progression",
    ...overrides,
  };
}

test("a normal, modest LOAD increase passes through unchanged", () => {
  const { valid, dropped } = validateProposedChanges([change()]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

test("SECURITY: an implausible >60% LOAD jump is dropped, not passed through", () => {
  const bad = change({ currentValue: "60kg", proposedValue: "120kg" }); // +100%
  const { valid, dropped } = validateProposedChanges([bad]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /implausible LOAD jump/);
});

test("exactly at the 60% boundary still passes", () => {
  const boundary = change({ currentValue: "100kg", proposedValue: "160kg" }); // +60%
  const { valid, dropped } = validateProposedChanges([boundary]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

test("a VOLUME change proposing to double weekly sets is dropped", () => {
  const bad = change({ type: "VOLUME", target: "chest", currentValue: "10 sets/week", proposedValue: "22 sets/week" });
  const { valid, dropped } = validateProposedChanges([bad]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
});

test("EXERCISE swaps are exempt from the magnitude check (target is a name, not a number)", () => {
  const swap = change({ type: "EXERCISE", target: "Bench Press", currentValue: "Barbell Bench Press", proposedValue: "Dumbbell Bench Press" });
  const { valid, dropped } = validateProposedChanges([swap]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

test("non-numeric currentValue/proposedValue text is let through (not checkable, not evidence of a problem)", () => {
  const textual = change({ type: "REPS", currentValue: "moderate", proposedValue: "slightly higher" });
  const { valid, dropped } = validateProposedChanges([textual]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

test("an empty target is dropped", () => {
  const bad = change({ target: "   " });
  const { valid, dropped } = validateProposedChanges([bad]);
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /empty or implausibly long target/);
});

test("a zero-baseline currentValue is let through (can't compute a relative change against zero)", () => {
  const zeroBaseline = change({ type: "FREQUENCY", currentValue: "0 sessions/week", proposedValue: "2 sessions/week" });
  const { valid, dropped } = validateProposedChanges([zeroBaseline]);
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

// ── Phase 8: BEGINNER users get a stricter magnitude cap ────────────────────
// (docs/USER_LEVEL_PERSONALIZATION_PLAN.md §A) — this is the concrete,
// code-enforced backstop for "beginners must never receive a high
// volume/intensity jump", independent of the LLM's own reasoning.

test("SECURITY: a 30% LOAD jump passes for a non-beginner but is dropped for isBeginner", () => {
  const change30pct = change({ currentValue: "40kg", proposedValue: "52kg" }); // +30%
  const nonBeginner = validateProposedChanges([change30pct]);
  const beginner = validateProposedChanges([change30pct], { isBeginner: true });
  assert.equal(nonBeginner.valid.length, 1, "30% is well within the generic 60% cap");
  assert.equal(beginner.valid.length, 0, "30% should exceed the stricter 20% beginner cap");
  assert.match(beginner.dropped[0].reason, /implausible LOAD jump/);
});

test("a modest 10% LOAD jump still passes for a beginner", () => {
  const change10pct = change({ currentValue: "40kg", proposedValue: "44kg" }); // +10%
  const { valid, dropped } = validateProposedChanges([change10pct], { isBeginner: true });
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});

test("EXERCISE swaps are still exempt from the magnitude check for beginners too", () => {
  const swap = change({ type: "EXERCISE", target: "Bench Press", currentValue: "Barbell Bench Press", proposedValue: "Dumbbell Bench Press" });
  const { valid, dropped } = validateProposedChanges([swap], { isBeginner: true });
  assert.equal(valid.length, 1);
  assert.equal(dropped.length, 0);
});
