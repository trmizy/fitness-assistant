import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendationEngine } from "../recommendation_engine";
import { responseFormatter } from "../response_formatter";
import { inputParser } from "../input_parser";
import { promptBuilder } from "../prompt_builder";

// Nova Pro recheck (2026-11-12): the deterministic routine printed "Giới tính: FEMALE" (B1-50) and an English answer said
// "Given your INTERMEDIATE experience level and MUSCLE_GAIN goal" (B3-06) — the model copied raw enums from the prompt's
// profile block. Users must see words, never internal enum values.
const RAW_ENUM = /\b(FEMALE|MALE|BEGINNER|INTERMEDIATE|ADVANCED|WEIGHT_LOSS|MUSCLE_GAIN|MAINTENANCE|SEDENTARY|LIGHTLY_ACTIVE|MODERATELY_ACTIVE|VERY_ACTIVE)\b/;
const profile: any = { age: 26, gender: "FEMALE", heightCm: 158, currentWeightKg: 52, goal: "MUSCLE_GAIN", activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "INTERMEDIATE", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } };

test("deterministic routine shows Vietnamese labels, not enums", () => {
  const intent = inputParser.parse("Lên giúp em một buổi tập chân", profile);
  const answer = responseFormatter.format(recommendationEngine.recommend(profile, intent, "vi"), "vi");
  assert.doesNotMatch(answer, RAW_ENUM);
  assert.match(answer, /Giới tính: Nữ/);
});

test("prompt profile block uses readable labels (vi and en)", () => {
  for (const lang of ["vi", "en"] as const) {
    const parsed: any = { ...inputParser.parse("Is it okay to train the same muscle group two days in a row?", profile), routeIntent: "general_fitness_knowledge" };
    const p = promptBuilder.build("Is it okay?", parsed, { profile, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], memories: [] } as any, { documents: [], isEmpty: true } as any, recommendationEngine.recommend(profile, parsed, lang), lang, []);
    const block = p.slice(p.indexOf("- Age:"), p.indexOf("- Age:") + 300);
    assert.doesNotMatch(block, RAW_ENUM, `${lang}: ${block}`);
  }
});
