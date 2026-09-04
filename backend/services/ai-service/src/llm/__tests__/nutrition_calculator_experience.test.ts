/**
 * Experience-based surplus/deficit and protein — real gap flagged in
 * docs/research/nutrition-ai-product-and-expert-review.md #5: the
 * calculator used a single flat surplus/deficit % and protein g/kg
 * regardless of `experienceLevel`, contradicting the bodybuilding
 * off-season/cutting literature that specifically warns advanced lifters
 * to use smaller, more conservative rates than beginners.
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/llm/__tests__/nutrition_calculator_experience.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nutritionCalculator } from "../nutrition_calculator";
import type { InputIntent, UserProfile } from "../types";

function baseProfile(
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return {
    age: 25,
    gender: "MALE",
    heightCm: 175,
    currentWeightKg: 76,
    activityLevel: "MODERATELY_ACTIVE",
    training: {
      availableEquipment: [],
      injuries: [],
      preferredTrainingDays: [],
    },
    ...overrides,
  };
}

function baseIntent(): InputIntent {
  return {
    normalizedQuestion: "test",
    intent: "meal_plan",
    needsPersonalization: true,
    missingFields: [],
  };
}

function macroKcal(n: { proteinGrams?: number; carbsGrams?: number; fatGrams?: number }): number {
  return (n.proteinGrams ?? 0) * 4 + (n.carbsGrams ?? 0) * 4 + (n.fatGrams ?? 0) * 9;
}

describe("nutritionCalculator — experience-based surplus/deficit (muscle_gain)", () => {
  it("76kg beginner muscle-gain gets a HIGHER surplus than 76kg advanced (same stats otherwise)", () => {
    const beginner = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "BEGINNER" }),
      baseIntent(),
    );
    const advanced = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "ADVANCED" }),
      baseIntent(),
    );
    assert.equal(beginner.confidence, "high");
    assert.equal(advanced.confidence, "high");
    assert.ok(
      (beginner.deficitOrSurplusKcal ?? 0) > (advanced.deficitOrSurplusKcal ?? 0),
      `Expected beginner surplus (${beginner.deficitOrSurplusKcal}) > advanced surplus (${advanced.deficitOrSurplusKcal})`,
    );
  });

  it("76kg advanced muscle-gain surplus stays conservative (within cited 3-8% of maintenance, not the old flat 10%)", () => {
    const advanced = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "ADVANCED" }),
      baseIntent(),
    );
    const ratio = (advanced.deficitOrSurplusKcal ?? 0) / (advanced.maintenanceCalories ?? 1);
    assert.ok(
      ratio > 0.02 && ratio <= 0.08,
      `Expected advanced surplus ratio within (0.02, 0.08], got ${ratio}`,
    );
  });

  it("76kg beginner muscle-gain surplus is within the cited 10-15% band", () => {
    const beginner = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "BEGINNER" }),
      baseIntent(),
    );
    const ratio = (beginner.deficitOrSurplusKcal ?? 0) / (beginner.maintenanceCalories ?? 1);
    assert.ok(ratio >= 0.1 && ratio <= 0.15, `Expected beginner surplus ratio within [0.10, 0.15], got ${ratio}`);
  });

  it("no experienceLevel on profile falls back to the prior flat +10% behavior (no behavior change for existing callers)", () => {
    const unknown = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN" }),
      baseIntent(),
    );
    const ratio = (unknown.deficitOrSurplusKcal ?? 0) / (unknown.maintenanceCalories ?? 1);
    assert.ok(Math.abs(ratio - 0.1) < 0.005, `Expected ~10% surplus with no experienceLevel, got ${ratio}`);
  });
});

describe("nutritionCalculator — experience-based deficit (weight_loss / fat_loss)", () => {
  it("advanced weight-loss deficit is shallower (less aggressive) than beginner's — 'không bị deficit quá sâu'", () => {
    const beginner = nutritionCalculator.calculate(
      baseProfile({ goal: "WEIGHT_LOSS", experienceLevel: "BEGINNER" }),
      baseIntent(),
    );
    const advanced = nutritionCalculator.calculate(
      baseProfile({ goal: "WEIGHT_LOSS", experienceLevel: "ADVANCED" }),
      baseIntent(),
    );
    // deficitOrSurplusKcal is negative for fat_loss — a shallower deficit
    // means a smaller magnitude (closer to 0), i.e. targetCalories closer
    // to maintenance.
    assert.ok(
      (advanced.targetCalories ?? 0) > (beginner.targetCalories ?? 0),
      `Expected advanced's target calories (${advanced.targetCalories}) to be higher/closer-to-maintenance than beginner's (${beginner.targetCalories})`,
    );
    const advancedRatio = Math.abs(advanced.deficitOrSurplusKcal ?? 0) / (advanced.maintenanceCalories ?? 1);
    assert.ok(
      advancedRatio >= 0.05 && advancedRatio <= 0.15,
      `Expected advanced deficit ratio within cited [0.05, 0.15], got ${advancedRatio}`,
    );
  });
});

describe("nutritionCalculator — protein by experience level", () => {
  it("advanced muscle-gain protein target is higher than beginner's (2.1 vs 1.7 g/kg)", () => {
    const beginner = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "BEGINNER" }),
      baseIntent(),
    );
    const advanced = nutritionCalculator.calculate(
      baseProfile({ goal: "MUSCLE_GAIN", experienceLevel: "ADVANCED" }),
      baseIntent(),
    );
    assert.equal(beginner.proteinGrams, Math.round(76 * 1.7));
    assert.equal(advanced.proteinGrams, Math.round(76 * 2.1));
  });

  it("maintenance goal protein is unaffected by experienceLevel (only muscle_gain/fat_loss are refined)", () => {
    const beginner = nutritionCalculator.calculate(
      baseProfile({ goal: "MAINTENANCE", experienceLevel: "BEGINNER" }),
      baseIntent(),
    );
    const advanced = nutritionCalculator.calculate(
      baseProfile({ goal: "MAINTENANCE", experienceLevel: "ADVANCED" }),
      baseIntent(),
    );
    assert.equal(beginner.proteinGrams, advanced.proteinGrams);
    assert.equal(beginner.proteinGrams, Math.round(76 * 1.6));
  });
});

describe("nutritionCalculator — athlete (advanced, very active) carb adequacy", () => {
  it("a 76kg advanced athlete training hard (VERY_ACTIVE) doing muscle-gain does not end up with critically low carbs", () => {
    const athlete = nutritionCalculator.calculate(
      baseProfile({
        goal: "MUSCLE_GAIN",
        experienceLevel: "ADVANCED",
        activityLevel: "VERY_ACTIVE",
      }),
      baseIntent(),
    );
    assert.ok(
      (athlete.carbsGrams ?? 0) > 150,
      `Expected carbsGrams > 150g for a high-activity muscle-gain athlete, got ${athlete.carbsGrams}`,
    );
  });
});

describe("nutritionCalculator — macro/kcal consistency across all experience levels", () => {
  const levels: Array<UserProfile["experienceLevel"]> = [undefined, "BEGINNER", "INTERMEDIATE", "ADVANCED"];
  const goals: Array<UserProfile["goal"]> = ["MUSCLE_GAIN", "WEIGHT_LOSS", "MAINTENANCE"];

  for (const goal of goals) {
    for (const level of levels) {
      it(`goal=${goal} experienceLevel=${level ?? "none"}: protein*4 + carb*4 + fat*9 stays within a few kcal of targetCalories`, () => {
        const result = nutritionCalculator.calculate(
          baseProfile({ goal, experienceLevel: level }),
          baseIntent(),
        );
        assert.equal(result.confidence, "high");
        const kcalFromMacro = macroKcal(result);
        const diff = Math.abs(kcalFromMacro - (result.targetCalories ?? 0));
        assert.ok(
          diff <= 9, // rounding on 3 independently-rounded gram values can add up to a few kcal
          `goal=${goal} level=${level}: macro-derived kcal (${kcalFromMacro}) should be within 9 kcal of target (${result.targetCalories})`,
        );
      });
    }
  }
});
