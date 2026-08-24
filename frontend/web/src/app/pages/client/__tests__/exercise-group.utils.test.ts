import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextExerciseRestSeconds } from "../exercise-group.utils";

describe("computeNextExerciseRestSeconds", () => {
  it("ungrouped exercise always uses the default rest, regardless of what's next", () => {
    const current = { groupId: null };
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(current, undefined), 90);
    assert.equal(computeNextExerciseRestSeconds(current, undefined, 60), 60);
  });

  it("grouped exercise advancing to a FELLOW group member uses restBetweenExercisesSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: "g1" };
    assert.equal(computeNextExerciseRestSeconds(current, next), 15);
  });

  it("grouped exercise that was the LAST member (next is ungrouped) uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: null };
    assert.equal(computeNextExerciseRestSeconds(current, next), 120);
  });

  it("grouped exercise that was the last member of its group, next exercise belongs to a DIFFERENT group, still uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    const next = { groupId: "g2" };
    assert.equal(computeNextExerciseRestSeconds(current, next), 120);
  });

  it("grouped exercise with no next exercise at all (last of the whole day) uses restAfterRoundSeconds", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: 15, restAfterRoundSeconds: 120 };
    assert.equal(computeNextExerciseRestSeconds(current, undefined), 120);
  });

  it("falls back to the default when the group's own rest fields are unset (null)", () => {
    const current = { groupId: "g1", restBetweenExercisesSeconds: null, restAfterRoundSeconds: null };
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(current, { groupId: null }), 90);
  });

  it("current exercise null/undefined is treated as ungrouped (safe default)", () => {
    assert.equal(computeNextExerciseRestSeconds(null, { groupId: "g1" }), 90);
    assert.equal(computeNextExerciseRestSeconds(undefined, undefined), 90);
  });
});
