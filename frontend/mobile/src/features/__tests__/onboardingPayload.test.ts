/**
 * SH-03's onboarding payload. These rules exist to protect calculations downstream (plan
 * generation, calorie estimation, safety-aware advice), so a "harmless" default here is not.
 *
 * Runs with: npx tsx --test src/features/__tests__/onboardingPayload.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BODY_STEP,
  LEVEL_STEP,
  buildOnboardingPayload,
  canAdvanceOnboardingStep,
  normalizeDecimal,
  type OnboardingAnswers,
} from "../onboarding/onboardingPayload";

function answers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    experienceLevel: "",
    goal: "",
    trainingDays: [],
    sessionDurationMinutes: "60",
    splitMode: "auto",
    preferredSplit: "",
    injuriesText: "",
    competesInSport: false,
    safetyFlags: new Set(),
    safetyStepReached: false,
    activityLevel: "",
    age: "",
    gender: "",
    heightCm: "",
    currentWeight: "",
    targetWeight: "",
    ...overrides,
  };
}

describe("buildOnboardingPayload", () => {
  it("matches what the device test saved to user_profiles", () => {
    const payload = buildOnboardingPayload(
      answers({
        experienceLevel: "BEGINNER",
        goal: "MUSCLE_GAIN",
        trainingDays: [1, 3, 5],
        safetyFlags: new Set(["bone_joint"]),
        safetyStepReached: true,
        activityLevel: "MODERATELY_ACTIVE",
        age: "28",
        gender: "MALE",
        heightCm: "172",
        currentWeight: "71.3",
        targetWeight: normalizeDecimal("68,5"),
      }),
    );
    assert.deepEqual(payload, {
      experienceLevel: "BEGINNER",
      goal: "MUSCLE_GAIN",
      preferredTrainingDays: [1, 3, 5],
      sessionDurationMinutes: 60,
      preferredSplit: null,
      injuries: [],
      competesInSport: false,
      activityLevel: "MODERATELY_ACTIVE",
      safetyScreeningStatus: "FOLLOW_UP_SUGGESTED",
      safetyScreeningFlags: ["bone_joint"],
      age: 28,
      gender: "MALE",
      heightCm: 172,
      currentWeight: 71.3,
      targetWeight: 68.5,
      hasCompletedOnboarding: true,
    });
  });

  it("never defaults activityLevel (a silent default defeated the nutrition safety net once)", () => {
    const payload = buildOnboardingPayload(answers());
    assert.equal(payload.activityLevel, undefined);
  });

  it("records safety screening only when the step was reached", () => {
    const skipped = buildOnboardingPayload(answers());
    assert.equal("safetyScreeningStatus" in skipped, false);
    assert.equal("safetyScreeningFlags" in skipped, false);

    const clear = buildOnboardingPayload(answers({ safetyStepReached: true }));
    assert.equal(clear.safetyScreeningStatus, "CLEARED");
    assert.deepEqual(clear.safetyScreeningFlags, []);
  });

  it("sends preferredSplit as an explicit null unless a real manual choice was made", () => {
    assert.equal(buildOnboardingPayload(answers({ splitMode: "auto", preferredSplit: "Upper/Lower" })).preferredSplit, null);
    assert.equal(buildOnboardingPayload(answers({ splitMode: "manual", preferredSplit: "" })).preferredSplit, null);
    assert.equal(buildOnboardingPayload(answers({ splitMode: "manual", preferredSplit: "Chưa xác định" })).preferredSplit, null);
    assert.equal(
      buildOnboardingPayload(answers({ splitMode: "manual", preferredSplit: "Push/Pull/Legs" })).preferredSplit,
      "Push/Pull/Legs",
    );
  });

  it("splits injuries on commas and drops blanks", () => {
    const payload = buildOnboardingPayload(answers({ injuriesText: " đau vai trái , , đau lưng dưới " }));
    assert.deepEqual(payload.injuries, ["đau vai trái", "đau lưng dưới"]);
  });

  it("omits empty numeric fields instead of sending zero", () => {
    const payload = buildOnboardingPayload(answers({ sessionDurationMinutes: "" }));
    assert.equal(payload.sessionDurationMinutes, undefined);
    assert.equal(payload.age, undefined);
    assert.equal(payload.heightCm, undefined);
    assert.equal(payload.currentWeight, undefined);
    assert.equal(payload.targetWeight, undefined);
    assert.equal(payload.gender, undefined);
  });

  it("never writes equipment through the profile (PUT /equipment/me is the one path)", () => {
    assert.equal("availableEquipment" in buildOnboardingPayload(answers()), false);
  });

  it("always marks onboarding complete, skip included", () => {
    assert.equal(buildOnboardingPayload(answers()).hasCompletedOnboarding, true);
  });
});

describe("canAdvanceOnboardingStep", () => {
  it("the level step needs both experience level and goal", () => {
    assert.equal(canAdvanceOnboardingStep(LEVEL_STEP, { experienceLevel: "", goal: "", activityLevel: "" }), false);
    assert.equal(canAdvanceOnboardingStep(LEVEL_STEP, { experienceLevel: "BEGINNER", goal: "", activityLevel: "" }), false);
    assert.equal(canAdvanceOnboardingStep(LEVEL_STEP, { experienceLevel: "BEGINNER", goal: "MUSCLE_GAIN", activityLevel: "" }), true);
  });

  it("the body step needs an activity level", () => {
    assert.equal(canAdvanceOnboardingStep(BODY_STEP, { experienceLevel: "x", goal: "y", activityLevel: "" }), false);
    assert.equal(canAdvanceOnboardingStep(BODY_STEP, { experienceLevel: "x", goal: "y", activityLevel: "SEDENTARY" }), true);
  });

  it("every other step is optional", () => {
    for (const step of [1, 2, 3, 5]) {
      assert.equal(canAdvanceOnboardingStep(step, { experienceLevel: "", goal: "", activityLevel: "" }), true);
    }
  });
});

describe("normalizeDecimal", () => {
  it("turns a Vietnamese decimal comma into a point", () => {
    assert.equal(normalizeDecimal("68,5"), "68.5");
    assert.equal(normalizeDecimal("68.5"), "68.5");
    assert.equal(normalizeDecimal("70"), "70");
  });
});
