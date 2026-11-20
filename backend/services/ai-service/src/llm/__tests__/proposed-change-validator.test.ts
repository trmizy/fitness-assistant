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

// ── magnitude parsing: sets x reps and ranges (the first-number-only reading misjudged both) ─────────────────────────

test("VOLUME 'sets x reps': 3x8 -> 3x12 is a +50% jump and is dropped for a beginner (reading only the first number saw 0% and let it through)", () => {
  const { valid, dropped } = validateProposedChanges([change({ type: "VOLUME", currentValue: "3x8", proposedValue: "3x12" })], { isBeginner: true });
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
});

test("VOLUME 'sets x reps' written out: '3 sets x 10 reps' -> '3 sets x 11 reps' (+10%) passes for a beginner", () => {
  const { valid } = validateProposedChanges([change({ type: "VOLUME", currentValue: "3 sets x 10 reps", proposedValue: "3 sets x 11 reps" })], { isBeginner: true });
  assert.equal(valid.length, 1);
});

test("REPS ranges compare by midpoint: '8-10' -> '9-11' (+11%) passes for a beginner; '8-10' -> '12-15' (+50%) is dropped", () => {
  assert.equal(validateProposedChanges([change({ type: "REPS", currentValue: "8-10 reps", proposedValue: "9-11 reps" })], { isBeginner: true }).valid.length, 1);
  assert.equal(validateProposedChanges([change({ type: "REPS", currentValue: "8-10 reps", proposedValue: "12-15 reps" })], { isBeginner: true }).valid.length, 0);
});

test("single numbers and units behave exactly as before ('60kg' -> '62.5kg', '2.5 sessions')", () => {
  assert.equal(validateProposedChanges([change({ currentValue: "60kg", proposedValue: "62.5kg" })]).valid.length, 1);
  assert.equal(validateProposedChanges([change({ type: "FREQUENCY", currentValue: "2.5 sessions/week", proposedValue: "3 sessions/week" })]).valid.length, 1);
});

// ── period labels, units and thousands grouping (real shape: "tuần 4: 38225 kg") ───────────────────────────────────────

import { extractLeadingNumber } from "../proposed-change-validator";

test("'tuần 4: 38225 kg' is 38225 (the week index is not the value) and 38225 -> 45000 is ~17.73%", () => {
  assert.equal(extractLeadingNumber("tuần 4: 38225 kg"), 38225);
  assert.equal(extractLeadingNumber("Week 4: 38225 kg"), 38225);
  const cur = extractLeadingNumber("tuần 4: 38225 kg")!, next = extractLeadingNumber("45000 kg")!;
  const pct = ((next - cur) / cur) * 100;
  assert.ok(Math.abs(pct - 17.73) < 0.01, `expected ~17.73%, got ${pct.toFixed(4)}%`);
});

test("the 17.73% weekly-volume rise passes for a beginner (limit 20%) — the old first-number reading saw 4 -> 45000 and dropped it", () => {
  const { valid, dropped } = validateProposedChanges(
    [change({ type: "VOLUME", target: "Tổng khối lượng tuần", currentValue: "tuần 4: 38225 kg", proposedValue: "45000 kg" })],
    { isBeginner: true },
  );
  assert.equal(dropped.length, 0);
  assert.equal(valid.length, 1);
});

test("a genuinely implausible jump with a period label is still dropped", () => {
  const { valid, dropped } = validateProposedChanges(
    [change({ type: "VOLUME", currentValue: "tuần 4: 38225 kg", proposedValue: "90000 kg" })],
  );
  assert.equal(valid.length, 0);
  assert.equal(dropped.length, 1);
});

test("Vietnamese thousands grouping and decimals are told apart: '38.225 kg' = 38225, '62,5kg' = 62.5, '2.5 sessions' = 2.5, '1.000.000' = 1e6", () => {
  assert.equal(extractLeadingNumber("38.225 kg"), 38225);
  assert.equal(extractLeadingNumber("38,225 kg"), 38225);
  assert.equal(extractLeadingNumber("62,5kg"), 62.5);
  assert.equal(extractLeadingNumber("2.5 sessions/week"), 2.5);
  assert.equal(extractLeadingNumber("1.000.000"), 1_000_000);
  assert.equal(extractLeadingNumber("không có số"), null);
});

test("a number with a unit wins over an earlier bare number ('buổi 2: 60 kg' / 'Bench 3 -> 62.5kg')", () => {
  assert.equal(extractLeadingNumber("buổi 2: 60 kg"), 60);
  assert.equal(extractLeadingNumber("Bench Press 60kg"), 60);
});
