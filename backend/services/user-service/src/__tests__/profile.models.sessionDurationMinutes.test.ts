/**
 * Regression for the 2026-10-23 live bug: OnboardingWizardPage's "Thời
 * lượng mỗi buổi (phút)" input has always sent sessionDurationMinutes on
 * PUT /profile/me, but profileSchema never declared the field — Zod
 * silently strips unknown keys, so no user's chosen session length was
 * EVER persisted; ai-service's workout-plan generator always fell back to
 * its own hardcoded 60-minute default regardless of what was entered
 * here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../models/profile.models";

test("profileSchema: accepts and keeps sessionDurationMinutes (was silently dropped before this fix)", () => {
  const result = profileSchema.safeParse({ sessionDurationMinutes: 120 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.sessionDurationMinutes, 120);
});

test("profileSchema: sessionDurationMinutes is optional — omitting it still validates", () => {
  const result = profileSchema.safeParse({ age: 25 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.sessionDurationMinutes, undefined);
});

test("profileSchema: rejects a sessionDurationMinutes outside the 10-240 domain range", () => {
  assert.equal(profileSchema.safeParse({ sessionDurationMinutes: 5 }).success, false);
  assert.equal(profileSchema.safeParse({ sessionDurationMinutes: 241 }).success, false);
});

test("profileSchema: rejects a non-integer sessionDurationMinutes", () => {
  assert.equal(profileSchema.safeParse({ sessionDurationMinutes: 90.5 }).success, false);
});
