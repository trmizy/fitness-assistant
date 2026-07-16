import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBodyComposition } from "../llm/body_composition_rules";
import type { UserProfile } from "../llm/types";

function profileWithSegmental(
  segmentalMuscle: {
    leftArm?: number;
    rightArm?: number;
    leftLeg?: number;
    rightLeg?: number;
  },
): UserProfile {
  return {
    gender: "MALE",
    currentWeightKg: 75,
    heightCm: 175,
    goal: "MUSCLE_GAIN",
    experienceLevel: "INTERMEDIATE",
    training: {
      availableEquipment: [],
      injuries: [],
      preferredTrainingDays: [],
    },
    inBody: {
      bodyFatPct: 15,
      skeletalMuscleKg: 34,
      segmentalMuscle,
    },
  };
}

test("balanced left/right muscle mass produces no asymmetry adjustment", () => {
  const analysis = analyzeBodyComposition(
    profileWithSegmental({
      leftArm: 3.0,
      rightArm: 3.05,
      leftLeg: 9.0,
      rightLeg: 9.1,
    }),
  );
  const asymmetryAdjustments = analysis.adjustments.filter((a) =>
    a.metric.startsWith("segmentalMuscle"),
  );
  assert.equal(asymmetryAdjustments.length, 0);
});

test("mild arm asymmetry (~7%) produces a non-significant unilateral adjustment", () => {
  const analysis = analyzeBodyComposition(
    profileWithSegmental({
      leftArm: 2.8,
      rightArm: 3.0,
      leftLeg: 9.0,
      rightLeg: 9.05,
    }),
  );
  const armAdjustment = analysis.adjustments.find(
    (a) => a.metric === "segmentalMuscle_arms",
  );
  assert.ok(armAdjustment, "expected an arm asymmetry adjustment");
  assert.match(armAdjustment!.plan_adjustment, /unilateral/i);
  assert.doesNotMatch(armAdjustment!.interpretation, /đáng kể/);
});

test("significant leg asymmetry (>=10%) recommends training the weaker side first", () => {
  const analysis = analyzeBodyComposition(
    profileWithSegmental({
      leftArm: 3.0,
      rightArm: 3.0,
      leftLeg: 8.0,
      rightLeg: 9.2,
    }),
  );
  const legAdjustment = analysis.adjustments.find(
    (a) => a.metric === "segmentalMuscle_legs",
  );
  assert.ok(legAdjustment, "expected a leg asymmetry adjustment");
  assert.match(legAdjustment!.interpretation, /đáng kể/);
  assert.match(legAdjustment!.plan_adjustment, /TRƯỚC/);
  assert.match(
    String(legAdjustment!.observed_value),
    /trái 8kg vs Chân phải 9\.2kg/,
  );
});

test("same-side dominance across arm and leg triggers a combined adjustment", () => {
  const analysis = analyzeBodyComposition(
    profileWithSegmental({
      leftArm: 2.7,
      rightArm: 3.0,
      leftLeg: 8.0,
      rightLeg: 9.0,
    }),
  );
  const sameSide = analysis.adjustments.find(
    (a) => a.metric === "segmentalMuscle_sameSideDominance",
  );
  assert.ok(sameSide, "expected a same-side dominance adjustment");
  assert.match(sameSide!.interpretation, /trái/);
});

test("missing segmental data does not throw and adds no asymmetry adjustments", () => {
  const profile = profileWithSegmental({});
  const analysis = analyzeBodyComposition(profile);
  const asymmetryAdjustments = analysis.adjustments.filter((a) =>
    a.metric.startsWith("segmentalMuscle"),
  );
  assert.equal(asymmetryAdjustments.length, 0);
});
