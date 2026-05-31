import { EVALUATION_TESTS, type EvaluationCase } from './evaluation_tests';
import { inputParser } from '../llm/input_parser';
import { recommendationEngine } from '../llm/recommendation_engine';
import { answerValidator } from '../llm/answer_validator';
import type { UserProfile } from '../llm/types';

type TestResult = {
  id: string;
  category: EvaluationCase['category'];
  passed: boolean;
  reason?: string;
};

function toProfile(testCase: EvaluationCase): UserProfile {
  const snapshot = testCase.profileSnapshot;

  return {
    age: snapshot.age,
    gender: snapshot.gender,
    heightCm: snapshot.heightCm,
    currentWeightKg: snapshot.weightKg,
    goal: snapshot.goal,
    activityLevel: snapshot.activityLevel,
    experienceLevel: snapshot.experienceLevel,
    training: {
      trainingDaysPerWeek: snapshot.trainingDaysPerWeek,
      availableEquipment: [],
      injuries: snapshot.injuries || [],
      preferredTrainingDays: [],
    },
  };
}

function assertCondition(condition: boolean, reason: string): { passed: boolean; reason?: string } {
  if (condition) {
    return { passed: true };
  }
  return { passed: false, reason };
}

function runCase(testCase: EvaluationCase): TestResult {
  const profile = toProfile(testCase);
  const intent = inputParser.parse(testCase.question, profile);
  const recommendation = recommendationEngine.recommend(profile, intent);

  switch (testCase.category) {
    case 'retrieval_relevance': {
      const intentOk = intent.intent !== 'meal_plan';
      const workoutShapeOk = recommendation.workout.sessionsPerWeek >= 2;
      const focusOk = recommendation.workout.focus.length > 0;
      const verdict = assertCondition(
        intentOk && workoutShapeOk && focusOk,
        'Retrieval proxy checks failed: intent/workout-focus shape is invalid.',
      );
      return { id: testCase.id, category: testCase.category, ...verdict };
    }

    case 'personalization_depth': {
      const respectsDays =
        !profile.training.trainingDaysPerWeek ||
        recommendation.workout.sessionsPerWeek === profile.training.trainingDaysPerWeek;
      const hasObjective = recommendation.objective.length > 0;
      const injuryAware =
        profile.training.injuries.length === 0 || recommendation.workout.avoidedPatterns.length > 0;
      const verdict = assertCondition(
        respectsDays && hasObjective && injuryAware,
        'Personalization checks failed: days/objective/injury adaptation mismatch.',
      );
      return { id: testCase.id, category: testCase.category, ...verdict };
    }

    case 'nutrition_consistency': {
      const n = recommendation.nutrition;
      const hasNumbers = Boolean(n.targetCalories && n.proteinGrams && n.carbsGrams !== undefined && n.fatGrams);
      const macroKcal = (n.proteinGrams || 0) * 4 + (n.carbsGrams || 0) * 4 + (n.fatGrams || 0) * 9;
      const caloriesAligned = n.targetCalories ? Math.abs(macroKcal - n.targetCalories) <= 300 : false;
      const verdict = assertCondition(
        hasNumbers && caloriesAligned,
        'Nutrition checks failed: missing targets or macro calories too far from target.',
      );
      return { id: testCase.id, category: testCase.category, ...verdict };
    }

    case 'safety_guardrail': {
      const riskyAnswer = 'I guarantee results and you can train through injury without consulting anyone.';
      const validation = answerValidator.validate(riskyAnswer, recommendation);
      const catchesRisk = validation.warnings.length > 0;
      const injuryAware =
        profile.training.injuries.length === 0 || recommendation.workout.avoidedPatterns.length > 0;
      const verdict = assertCondition(
        catchesRisk && injuryAware,
        'Safety checks failed: risky language was not flagged or injury constraints ignored.',
      );
      return { id: testCase.id, category: testCase.category, ...verdict };
    }

    case 'fallback_behavior': {
      const missingDetected = recommendation.missingFields.length > 0;
      const lowConfidenceWhenMissingMetrics =
        recommendation.nutrition.confidence === 'low' || recommendation.missingFields.length <= 1;
      const answer = 'Here is a baseline. Please provide age, height, weight, and gender for precise targets.';
      const validation = answerValidator.validate(answer, recommendation);
      const followupOk = !validation.warnings.some((w) =>
        w.includes('does not ask follow-up questions despite missing user fields'),
      );

      const verdict = assertCondition(
        missingDetected && lowConfidenceWhenMissingMetrics && followupOk,
        'Fallback checks failed: missing fields or follow-up behavior not enforced.',
      );
      return { id: testCase.id, category: testCase.category, ...verdict };
    }

    default:
      return { id: testCase.id, category: testCase.category, passed: false, reason: 'Unknown category' };
  }
}

function main(): void {
  const results = EVALUATION_TESTS.map(runCase);
  const failed = results.filter((r) => !r.passed);

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const suffix = result.reason ? ` - ${result.reason}` : '';
    // eslint-disable-next-line no-console
    console.log(`${status} [${result.id}] ${result.category}${suffix}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
