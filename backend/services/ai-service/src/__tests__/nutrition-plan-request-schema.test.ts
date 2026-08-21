import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GenerateNutritionPlanRequestSchema } from "../schemas/nutrition-plan.schemas";

describe("GenerateNutritionPlanRequestSchema", () => {
  it("coerces number input strings from HTML forms", () => {
    const result = GenerateNutritionPlanRequestSchema.parse({
      goal: "Tang co",
      durationWeeks: "1",
      mealsPerDay: "3",
      dailyCaloriesTarget: "2600",
      weightKg: "76",
      heightCm: "175",
      age: "28",
      gender: "MALE",
      bodyFatPct: "17",
      trainingDaysPerWeek: "5",
      trainingDurationMin: "75",
      proteinTargetG: "150",
      carbTargetG: "260",
      fatTargetG: "75",
    });

    assert.equal(result.dailyCaloriesTarget, 2600);
    assert.equal(result.bodyFatPct, 17);
    assert.equal(result.trainingDaysPerWeek, 5);
    assert.equal(typeof result.bodyFatPct, "number");
  });

  it("rejects out-of-range coerced bodyFatPct", () => {
    const result = GenerateNutritionPlanRequestSchema.safeParse({
      goal: "Tang co",
      durationWeeks: "1",
      mealsPerDay: "3",
      bodyFatPct: "90",
    });

    assert.equal(result.success, false);
  });

  it("treats empty optional number fields as omitted", () => {
    const result = GenerateNutritionPlanRequestSchema.parse({
      goal: "Tang co",
      durationWeeks: "1",
      mealsPerDay: "3",
      dailyCaloriesTarget: "",
      bodyFatPct: "",
    });

    assert.equal(result.dailyCaloriesTarget, undefined);
    assert.equal(result.bodyFatPct, undefined);
  });
});
