/**
 * End-to-end AI workout-plan evidence test.
 *
 * This exercises the same plan prompt + body-composition rule engine +
 * fitness_evidence retriever + LLM JSON parser used by the real worker path.
 */
import { analyzeBodyComposition, formatBodyCompAnalysis } from '../../llm/body_composition_rules';
import { retriever } from '../../llm/retriever';
import {
  attachEvidenceToPlanContent,
  buildPlanEvidenceBundle,
  formatEvidenceForPlanPrompt,
  formatMockProfileForPlanPrompt,
} from '../../llm/plan_evidence';
import { llmService } from '../../services/llm.service';
import { buildPlanPrompt, parsePlanContent, type AllowedExerciseItem, type DayExerciseCatalog } from '../../schemas/plan.schemas';
import type { UserProfile } from '../../llm/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const recentWorkoutLogs = [
  { exercise: 'Bench Press', sets: 3, reps: 10, weightKg: 40, rpe: 7 },
  { exercise: 'Lat Pulldown', sets: 3, reps: 12, weightKg: 35, rpe: 7 },
];

const mockProfile: UserProfile = {
  age: 21,
  heightCm: 173,
  currentWeightKg: 85,
  goal: 'WEIGHT_LOSS',
  activityLevel: 'LIGHTLY_ACTIVE',
  experienceLevel: 'BEGINNER',
  gender: 'MALE',
  training: {
    injuries: [],
    availableEquipment: ['GYM'],
    preferredTrainingDays: [],
  },
  inBody: {
    weightKg: 85,
    bodyFatPct: 27.3,
    skeletalMuscleKg: 35,
    bmi: 28.4,
    measuredAt: new Date().toISOString(),
  },
};

const allowedExercises: AllowedExerciseItem[] = [
  { id: 'ex-bench-press', exerciseName: 'Bench Press', bodyPart: 'UPPER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'BARBELL', muscleGroupsActivated: ['CHEST', 'TRICEPS', 'SHOULDERS'] },
  { id: 'ex-chest-press', exerciseName: 'Machine Chest Press', bodyPart: 'UPPER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'MACHINE', muscleGroupsActivated: ['CHEST', 'TRICEPS'] },
  { id: 'ex-lat-pulldown', exerciseName: 'Lat Pulldown', bodyPart: 'UPPER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'MACHINE', muscleGroupsActivated: ['BACK', 'BICEPS'] },
  { id: 'ex-seated-row', exerciseName: 'Seated Cable Row', bodyPart: 'UPPER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'CABLE', muscleGroupsActivated: ['BACK', 'BICEPS'] },
  { id: 'ex-leg-press', exerciseName: 'Leg Press', bodyPart: 'LOWER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'MACHINE', muscleGroupsActivated: ['QUADS', 'GLUTES'] },
  { id: 'ex-rdl', exerciseName: 'Romanian Deadlift', bodyPart: 'LOWER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'BARBELL', muscleGroupsActivated: ['HAMSTRINGS', 'GLUTES'] },
  { id: 'ex-shoulder-press', exerciseName: 'Machine Shoulder Press', bodyPart: 'UPPER_BODY', typeOfActivity: 'STRENGTH', typeOfEquipment: 'MACHINE', muscleGroupsActivated: ['SHOULDERS', 'TRICEPS'] },
  { id: 'ex-cable-crunch', exerciseName: 'Cable Crunch', bodyPart: 'CORE', typeOfActivity: 'STRENGTH', typeOfEquipment: 'CABLE', muscleGroupsActivated: ['ABS', 'CORE'] },
];

const perDayCatalogs: DayExerciseCatalog[] = [
  { dayIndex: 0, dayGoal: 'Ngực + Vai + Tay sau', focusMuscleGroups: ['CHEST', 'SHOULDERS', 'TRICEPS'], exercises: allowedExercises.slice(0, 2).concat(allowedExercises[6]) },
  { dayIndex: 1, dayGoal: 'Lưng + Tay trước', focusMuscleGroups: ['BACK', 'BICEPS'], exercises: allowedExercises.slice(2, 4) },
  { dayIndex: 2, dayGoal: 'Chân + Mông', focusMuscleGroups: ['LEGS', 'GLUTES'], exercises: allowedExercises.slice(4, 6) },
  { dayIndex: 3, dayGoal: 'Full body + Core', focusMuscleGroups: ['FULL_BODY'], exercises: allowedExercises },
];

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  AI Plan Evidence E2E Test');
  console.log('═══════════════════════════════════════════════════');

  const analysis = analyzeBodyComposition(mockProfile);
  const bodyCompText = formatBodyCompAnalysis(analysis);
  assert(analysis.adjustments.length > 0, 'Expected adjustment_reason from body composition rules');

  const evidenceDocs = await retriever.retrieveEvidence(analysis.evidenceQueries);
  assert(evidenceDocs.length > 0, 'Expected retrieved evidence from fitness_evidence');

  const evidenceBundle = buildPlanEvidenceBundle(analysis, evidenceDocs);
  assert(evidenceBundle.evidence_used.length > 0, 'Expected evidence_used from retriever metadata');
  assert(evidenceBundle.evidence_used.every((item) => item.source_url.startsWith('http')), 'Expected real source_url values');
  assert(evidenceBundle.adjustment_reason.some((item) => /bodyFatPct|BMI|waist|muscle/i.test(item.metric)), 'Expected adjustment_reason metric to reference body metrics');

  const profileText = [
    '[Mock user profile]',
    formatMockProfileForPlanPrompt(mockProfile, recentWorkoutLogs),
    'waistCm=90',
  ].join('\n');

  const prompt = buildPlanPrompt(
    'FAT_LOSS',
    8,
    4,
    2,
    profileText,
    allowedExercises,
    'GYM',
    perDayCatalogs,
    'MIXED_GYM',
    {
      bodyCompText,
      evidenceText: formatEvidenceForPlanPrompt(evidenceDocs),
    },
  );

  const requiredPromptParts = [
    'Mock user profile',
    'bodyFatPct',
    'recentWorkoutLogs',
    'BODY COMPOSITION ANALYSIS',
    'RETRIEVED FITNESS EVIDENCE',
    'Do not diagnose disease',
    'Do not invent titles, source_url values',
    'valid JSON only',
  ];
  for (const part of requiredPromptParts) {
    assert(prompt.includes(part), `Prompt missing required section: ${part}`);
  }

  const response = await llmService.callLLM(prompt, {
    responseFormat: 'json',
    timeoutMs: 300000,
    numPredict: 4096,
  });

  const parsed = parsePlanContent(response.answer);
  assert(parsed.ok, parsed.ok ? 'unreachable' : `Plan JSON invalid: ${parsed.reason}`);

  const content = attachEvidenceToPlanContent(parsed.content as any, evidenceBundle);
  const output = {
    plan: {
      workout: content,
      nutrition: content.nutritionSummary,
    },
    nutrition_suggestion: content.nutritionSummary,
    adjustment_reason: content.adjustment_reason,
    evidence_used: content.evidence_used,
    safety_notes: content.safety_notes,
  };

  assert(output.plan.workout, 'Expected plan.workout');
  assert(output.plan.nutrition || output.nutrition_suggestion, 'Expected plan.nutrition or nutrition_suggestion');
  assert(output.adjustment_reason.length > 0, 'Expected adjustment_reason');
  assert(output.evidence_used.length > 0, 'Expected evidence_used');
  assert(Array.isArray(output.safety_notes), 'Expected safety_notes array');
  assert(output.evidence_used.every((item: any) => item.source_url?.startsWith('http')), 'Expected real source_url in evidence_used');

  const retrievedUrls = new Set(evidenceBundle.evidence_used.map((item) => item.source_url));
  assert(output.evidence_used.every((item: any) => retrievedUrls.has(item.source_url)), 'evidence_used contains a non-retrieved source_url');

  console.log('\n✅ AI plan evidence E2E passed.');
  console.log('\nExample output JSON:');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('\n❌ AI plan evidence E2E failed.');
  console.error(err);
  process.exit(1);
});
