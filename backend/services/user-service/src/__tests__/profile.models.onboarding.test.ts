/**
 * Regression tests for the onboarding-wizard profile fields (Phase 9):
 * preferredSplit (advisory free text) and hasCompletedOnboarding (the flag
 * OnboardingWizardPage/RequireOnboarding use to decide whether a client
 * gets redirected to the wizard).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../models/profile.models";

test("profileSchema: accepts preferredSplit as an optional string", () => {
  const result = profileSchema.safeParse({ preferredSplit: "Push/Pull/Legs" });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.preferredSplit, "Push/Pull/Legs");
});

test("profileSchema: preferredSplit is optional — omitting it still validates", () => {
  const result = profileSchema.safeParse({ age: 25 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.preferredSplit, undefined);
});

test("profileSchema: rejects a preferredSplit longer than 100 chars", () => {
  const result = profileSchema.safeParse({ preferredSplit: "x".repeat(101) });
  assert.equal(result.success, false);
});

// Hardening pass finding: preferredSplit's DB column is nullable and the
// profile repository does a partial Prisma update (an omitted key leaves
// the column untouched) — so an explicit `null` is the ONLY way a client
// can clear a previously-set split back to "no preference" (the wizard's
// own "Chưa xác định" option). Before this test, preferredSplit was
// .optional() only (no .nullable()), so a `null` payload 400'd — found via
// the onboarding Playwright spec's snapshot-restore step being permanently
// unable to restore a null preferredSplit once the wizard set a real value.
test("profileSchema: accepts an explicit null for preferredSplit (clears a previously-set value)", () => {
  const result = profileSchema.safeParse({ preferredSplit: null });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.preferredSplit, null);
});

test("profileSchema: accepts hasCompletedOnboarding as an optional boolean", () => {
  const result = profileSchema.safeParse({ hasCompletedOnboarding: true });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.hasCompletedOnboarding, true);
});

test("profileSchema: rejects a non-boolean hasCompletedOnboarding", () => {
  const result = profileSchema.safeParse({ hasCompletedOnboarding: "yes" });
  assert.equal(result.success, false);
});
