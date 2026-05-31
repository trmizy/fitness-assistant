import test from 'node:test';
import assert from 'node:assert/strict';
import { responseFormatter } from '../llm/response_formatter';
import type { RecommendationResult } from '../llm/types';

const markerPattern = /(coming soon|demo|sample|mock|placeholder|default plan created|default routine created)/i;

function baseRecommendation(): RecommendationResult {
  return {
    objective: 'fat_loss',
    responseIntent: 'workout_plan_request',
    nutrition: {
      targetCalories: 2100,
      proteinGrams: 150,
      carbsGrams: 220,
      fatGrams: 65,
      formula: 'mifflin',
      confidence: 'medium',
    },
    workout: {
      split: 'upper-lower',
      sessionsPerWeek: 4,
      focus: ['strength'],
      avoidedPatterns: [],
      assumptions: [],
    },
    meal: {
      template: 'balanced',
      dailyMeals: 3,
      assumptions: [],
    },
    assumptions: [],
    missingFields: [],
  };
}

test('formatter output does not include placeholder markers for workout fallback', () => {
  const rec = baseRecommendation();
  delete rec.workoutPlan;

  const output = responseFormatter.format(rec, 'en');
  assert.doesNotMatch(output, markerPattern);
});

test('formatter output does not include placeholder markers for meal fallback', () => {
  const rec = baseRecommendation();
  rec.responseIntent = 'meal_plan_request';
  delete rec.mealPlan;

  const output = responseFormatter.format(rec, 'en');
  assert.doesNotMatch(output, markerPattern);
});

test('formatter keeps Vietnamese response when language is locked to vi', () => {
  const rec = baseRecommendation();
  const output = responseFormatter.format(rec, 'vi');

  assert.match(output, /Lich Tap|Dinh Duong|Hanh Dong|Muc tieu|Mục tiêu|Lịch Tập/i);
});
