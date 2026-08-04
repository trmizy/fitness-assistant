/**
 * Regression test for competesInSport (docs/USER_LEVEL_PERSONALIZATION_PLAN.md
 * §0) — distinguishes a competing/professional athlete from an ADVANCED
 * recreational lifter without adding a 5th experienceLevel enum value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../models/profile.models";

test("profileSchema: accepts competesInSport as an optional boolean", () => {
  const result = profileSchema.safeParse({ competesInSport: true });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.competesInSport, true);
});

test("profileSchema: competesInSport is optional — omitting it still validates", () => {
  const result = profileSchema.safeParse({ age: 25 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.competesInSport, undefined);
});

test("profileSchema: rejects a non-boolean competesInSport", () => {
  const result = profileSchema.safeParse({ competesInSport: "yes" });
  assert.equal(result.success, false);
});
