import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import axios from 'axios';
import { llmService } from '../services/llm.service';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import { parsePlanContent, buildPlanPrompt, type AllowedExerciseItem, type DayExerciseCatalog } from '../schemas/plan.schemas';
import { LlmError } from '../errors/api-error';
import { safeParseJsonCandidate } from '../utils/json';
import { analyzeBodyComposition, formatBodyCompAnalysis } from '../llm/body_composition_rules';
import { retriever } from '../llm/retriever';
import {
  attachEvidenceToPlanContent,
  buildPlanEvidenceBundle,
  formatEvidenceForPlanPrompt,
  type PlanEvidenceBundle,
} from '../llm/plan_evidence';
import type { UserProfile } from '../llm/types';
import type { WorkerUserContext } from './worker-user-context';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const aiQueue = new Queue('ai-tasks', { connection: redisConnection });

type AllowedExercise = AllowedExerciseItem;

// Increased limit so we have enough exercises to build per-day catalogs
const PLAN_EXERCISE_FETCH_LIMIT = 300;
const PLAN_EXERCISE_PROMPT_LIMIT = 80; // fallback flat-list limit

function buildEvidenceProfile(ctx: WorkerUserContext | null, fallbackGoal: string): UserProfile {
  const profile = ctx?.profile ?? {};
  const latestInBody = ctx?.latestInBody ?? null;

  return {
    userId: undefined,
    age: typeof profile.age === 'number' ? profile.age : undefined,
    gender: profile.gender === 'FEMALE' || profile.gender === 'OTHER' ? profile.gender : 'MALE',
    heightCm: typeof profile.heightCm === 'number' ? profile.heightCm : undefined,
    currentWeightKg: latestInBody?.weightKg ?? profile.currentWeight,
    targetWeightKg: profile.targetWeight,
    goal: (profile.goal ?? fallbackGoal) as any,
    activityLevel: profile.activityLevel as any,
    experienceLevel: (profile.experienceLevel ?? 'BEGINNER') as any,
    training: {
      availableEquipment: [],
      injuries: Array.isArray(profile.injuries) ? profile.injuries : [],
      preferredTrainingDays: [],
      trainingDaysPerWeek: undefined,
    },
    inBody: latestInBody ? {
      weightKg: latestInBody.weightKg,
      bodyFatPct: latestInBody.bodyFatPct,
      bodyFatKg: latestInBody.bodyFatKg,
      skeletalMuscleKg: latestInBody.muscleMassKg,
      bmi: latestInBody.bmi,
      bmr: latestInBody.bmr,
      measuredAt: latestInBody.measuredAt,
      segmentalMuscle: latestInBody.segmentalMuscle,
    } : undefined,
  };
}

// ── Muscle group matching ────────────────────────────────────────────────────

/** Returns true if the exercise matches the given focus group */
function exerciseMatchesMuscleGroup(ex: AllowedExercise, group: string): boolean {
  const muscles = (ex.muscleGroupsActivated || []).map((m) => m.toLowerCase());
  const bp = (ex.bodyPart || '').toUpperCase();
  const name = (ex.exerciseName || '').toLowerCase();

  switch (group) {
    case 'CHEST':
      return muscles.some((m) => /chest|pectoral/.test(m)) ||
             (bp === 'UPPER_BODY' && /bench|fly|flye|push.up|chest/.test(name));
    case 'BACK':
      return (bp === 'UPPER_BODY' || muscles.some((m) => /back|lat|trap|rhomboid|erector/.test(m))) &&
             muscles.some((m) => /back|lat|trap|rhomboid|erector/.test(m));
    case 'SHOULDERS':
      return muscles.some((m) => /shoulder|deltoid|delt/.test(m)) ||
             /overhead|press.*shoulder|shoulder.*press|lateral raise|front raise/.test(name);
    case 'TRICEPS':
      return muscles.some((m) => /tricep/.test(m)) ||
             /tricep|skull.*crusher|dip|extension/.test(name);
    case 'BICEPS':
      return muscles.some((m) => /bicep/.test(m)) ||
             /bicep|curl/.test(name);
    case 'LEGS':
      return bp === 'LOWER_BODY' &&
             muscles.some((m) => /quad|hamstring|calf|calves|tibial|leg/.test(m));
    case 'GLUTES':
      return (bp === 'LOWER_BODY') &&
             (muscles.some((m) => /glute|hip|abductor/.test(m)) ||
              /squat|lunge|deadlift|hip.thrust|glute|step.up/.test(name));
    case 'CORE':
      return bp === 'CORE' ||
             muscles.some((m) => /abdomin|oblique|core|rectus/.test(m)) ||
             /crunch|plank|ab |sit.up/.test(name);
    case 'LOWER_BODY':
      return bp === 'LOWER_BODY';
    case 'UPPER_BODY':
      return bp === 'UPPER_BODY';
    case 'FULL_BODY':
      return true;
    default:
      return false;
  }
}

/** Parse a day goal string into a list of focus muscle group keys */
function parseDayFocusMuscleGroups(dayGoal: string): string[] {
  const s = dayGoal.toLowerCase();

  // Full body / conditioning patterns first
  if (/full.body|toan.*than|toàn.*thân|conditioning.*all|general.*strength/.test(s)) {
    return ['FULL_BODY'];
  }
  // Push day
  if (/^push/.test(s)) return ['CHEST', 'SHOULDERS', 'TRICEPS'];
  // Pull day
  if (/^pull/.test(s)) return ['BACK', 'BICEPS'];
  // Strict lower body
  if (/lower.*body$|than.*duoi$|leg.*only/.test(s)) return ['LEGS', 'GLUTES'];
  // Strict upper body (no specific muscle listed)
  if (/upper.*body$|than.*tren$/.test(s) &&
      !/(nguc|lung|vai|tay)/.test(s)) {
    return ['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS'];
  }

  const groups: string[] = [];
  if (/nguc|ngực|chest|pec|bench/.test(s)) groups.push('CHEST');
  if (/vai|shoulder|delt|overhead/.test(s)) groups.push('SHOULDERS');
  if (/tay sau|tricep/.test(s)) groups.push('TRICEPS');
  // BACK can coexist with CHEST (e.g. "Nguc + Lung" full-body upper day)
  if (/lung|lưng|back|lat|row|pull/.test(s) && !/pull.up|pullover/.test(s)) groups.push('BACK');
  if (/tay tr[ưu]oc|truoc|bicep|curl/.test(s)) groups.push('BICEPS');
  if (/ch[aâ]n|leg|quad|hamstring|squat|deadlift|lunge|bap chan/.test(s)) groups.push('LEGS');
  if (/m[oô]ng|glute|hip/.test(s)) groups.push('GLUTES');
  if (/core|b[uụ]ng|ab|plank/.test(s)) groups.push('CORE');

  // Conditioning-only day → lower body as default
  if (groups.length === 0 && /condition|dieu.*hoa/.test(s)) return ['LEGS', 'CORE'];

  return groups.length > 0 ? groups : ['FULL_BODY'];
}

const HOME_EQUIPMENT = new Set(['BODYWEIGHT', 'DUMBBELLS', 'RESISTANCE_BAND', 'KETTLEBELL', 'MEDICINE_BALL', 'FOAM_ROLLER']);
const MACHINE_ONLY_EQUIPMENT = new Set(['MACHINE', 'CABLE']);
const MIXED_GYM_EQUIPMENT = new Set(['MACHINE', 'CABLE', 'BARBELL', 'DUMBBELLS', 'BODYWEIGHT', 'KETTLEBELL']);

/** Filter and rank exercises for a specific day's muscle focus */
function filterExercisesForDay(
  allExercises: AllowedExercise[],
  focusMuscleGroups: string[],
  goal: string,
  trainingLocation: string,
  limit = 18,
  equipmentPreference = 'MIXED_GYM',
): AllowedExercise[] {
  const isMuscleGain = /muscle|tang.*co|hypertrophy|gain/i.test(goal);
  const isHome = trainingLocation === 'HOME';
  const isMachineOnly = equipmentPreference === 'MACHINE_ONLY';
  const isFullBody = focusMuscleGroups.includes('FULL_BODY') || focusMuscleGroups.length === 0;

  const candidates = allExercises.filter((ex) => {
    const equip = ex.typeOfEquipment || '';
    // Equipment filter based on preference/location
    if (isHome && !HOME_EQUIPMENT.has(equip)) return false;
    if (isMachineOnly && !MACHINE_ONLY_EQUIPMENT.has(equip)) return false;
    if (!isHome && !isMachineOnly && !MIXED_GYM_EQUIPMENT.has(equip)) return false;
    // For muscle gain, skip pure cardio as main exercises
    if (isMuscleGain && ex.typeOfActivity === 'CARDIO') return false;
    // Muscle group match
    if (isFullBody) return true;
    return focusMuscleGroups.some((g) => exerciseMatchesMuscleGroup(ex, g));
  });

  // Score: prefer exercises that match more focus groups and fit goal
  const scored = candidates.map((ex) => {
    let score = 0;
    for (const g of focusMuscleGroups) {
      if (exerciseMatchesMuscleGroup(ex, g)) score += 3;
    }
    if (isMuscleGain && ex.typeOfActivity === 'STRENGTH') score += 2;
    if (isMachineOnly && MACHINE_ONLY_EQUIPMENT.has(ex.typeOfEquipment || '')) score += 2;
    if (!isMachineOnly && ex.typeOfEquipment === 'BARBELL' && isMuscleGain) score += 1;
    return { ex, score };
  }).sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const result: AllowedExercise[] = [];
  for (const { ex } of scored) {
    if (!seen.has(ex.id)) {
      seen.add(ex.id);
      result.push(ex);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/** Build per-day exercise catalogs from a flat allowedExercises list */
function buildPerDayCatalogs(
  goal: string,
  daysPerWeek: number,
  allExercises: AllowedExercise[],
  trainingLocation: string,
  equipmentPreference = 'MIXED_GYM',
): DayExerciseCatalog[] {
  const catalogs: DayExerciseCatalog[] = [];

  for (let dayIndex = 0; dayIndex < daysPerWeek; dayIndex++) {
    const dayGoal = splitGoalForDay(goal, dayIndex, daysPerWeek);
    const focusMuscleGroups = parseDayFocusMuscleGroups(dayGoal);
    const exercises = filterExercisesForDay(allExercises, focusMuscleGroups, goal, trainingLocation, 18, equipmentPreference);

    catalogs.push({ dayIndex, dayGoal, focusMuscleGroups, exercises });
  }

  return catalogs;
}

/** Validate that a plan exercise matches its day's focus muscle groups.
 *  Returns an error string if mismatch, null if OK.
 */
function validateExerciseMuscleMatch(
  ex: AllowedExercise,
  focusMuscleGroups: string[],
): string | null {
  if (focusMuscleGroups.includes('FULL_BODY')) return null;
  const matches = focusMuscleGroups.some((g) => exerciseMatchesMuscleGroup(ex, g));
  if (!matches) {
    return `Exercise "${ex.exerciseName}" (${ex.bodyPart ?? 'UNKNOWN'}) does not match focus [${focusMuscleGroups.join(', ')}]`;
  }
  return null;
}

function splitGoalForDay(planGoal: string, dayIndex: number, daysPerWeek: number): string {
  const normalizedGoal = String(planGoal || '').toLowerCase();
  const muscleGain = /tang co|tăng cơ|muscle|hypertrophy|mass/.test(normalizedGoal);

  const hypertrophySplits =
    daysPerWeek >= 6
      ? ['Nguc + Tay sau', 'Lung + Tay truoc', 'Chan + Mong', 'Nguc + Vai', 'Lung + Tay truoc B', 'Chan + Mong + Core']
      : daysPerWeek >= 5
        ? ['Nguc + Vai + Tay sau', 'Lung + Tay truoc', 'Chan + Mong', 'Vai + Tay truoc + Tay sau', 'Chan + Mong + Core']
        : daysPerWeek >= 4
          ? ['Nguc + Vai + Tay sau', 'Lung + Tay truoc', 'Chan + Mong', 'Vai + Tay truoc + Tay sau']
          : ['Nguc + Lung', 'Chan + Mong', 'Vai + Tay truoc + Tay sau'];

  const generalSplits =
    daysPerWeek >= 5
      ? ['Nguc + Lung + Core', 'Chan + Mong', 'Vai + Tay truoc + Tay sau', 'Chan + Mong + Cardio', 'Nguc + Lung nhe']
      : daysPerWeek >= 4
        ? ['Nguc + Lung + Core', 'Chan + Mong', 'Vai + Tay truoc + Tay sau', 'Chan + Mong + Core nhe']
        : ['Nguc + Lung + Core', 'Chan + Mong', 'Vai + Tay truoc + Tay sau'];

  const splits = muscleGain ? hypertrophySplits : generalSplits;
  return splits[dayIndex % splits.length];
}

function isGenericDayGoal(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  return /^(training focus|workout day|general training|general fitness)$/i.test(value.trim());
}

function buildExercisePrescription(
  selected: AllowedExercise,
  order: number,
  note: string,
): Record<string, unknown> {
  return {
    exerciseId: selected.id,
    order,
    name: selected.exerciseName,
    sets: order === 1 ? 4 : 3,
    reps: order === 1 ? '6-10' : '8-12',
    restSeconds: order === 1 ? 120 : 75,
    note,
  };
}

// (safeParseJsonCandidate imported from utils)

function tokenize(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function joinNames(values: unknown[]): string {
  return values.map((value) => String(value)).filter(Boolean).join(' ');
}

function getEmptyDayIndexes(content: any): number[] {
  if (!content || !Array.isArray(content.weeklySchedule)) return [];
  const indexes: number[] = [];
  content.weeklySchedule.forEach((day: any, index: number) => {
    if (!Array.isArray(day?.exercises) || day.exercises.length === 0) {
      indexes.push(index);
    }
  });
  return indexes;
}

function repairScheduleLengthAndEmptyDays(
  content: any,
  goal: string,
  daysPerWeek: number,
  exercisesPerDay: number,
  allowedExercises: AllowedExercise[],
  planId: string,
  jobId: string | undefined,
): { repaired: boolean; content: any; warnings: Array<Record<string, unknown>> } {
  if (!content || typeof content !== 'object' || !Array.isArray(content.weeklySchedule)) {
    return { repaired: false, content, warnings: [] };
  }

  const warnings: Array<Record<string, unknown>> = [];
  const schedule = content.weeklySchedule;

  if (schedule.length > daysPerWeek) {
    content.weeklySchedule = schedule.slice(0, daysPerWeek);
    warnings.push({ type: 'deterministic_repair', planId, jobId, reason: 'trimmed_extra_days' });
  }

  while (content.weeklySchedule.length < daysPerWeek) {
    const dayIndex = content.weeklySchedule.length;
    const selected = allowedExercises[dayIndex % allowedExercises.length];
    if (!selected) break;

    content.weeklySchedule.push({
      day: `Day ${dayIndex + 1}`,
      goal: splitGoalForDay(goal, dayIndex, daysPerWeek),
      exercises: Array.from({ length: exercisesPerDay }, (_, exerciseIndex) => {
        const next = allowedExercises[(dayIndex * exercisesPerDay + exerciseIndex) % allowedExercises.length] ?? selected;
        return buildExercisePrescription(next, exerciseIndex + 1, 'Auto-repaired from allowed exercise catalog after short LLM schedule output');
      }),
    });
    warnings.push({
      type: 'deterministic_repair',
      planId,
      jobId,
      dayIndex,
      reason: 'filled_missing_day',
      selectedExerciseId: selected.id,
      selectedExerciseName: selected.exerciseName,
    });
  }

  for (let dayIndex = 0; dayIndex < content.weeklySchedule.length; dayIndex += 1) {
    const day = content.weeklySchedule[dayIndex];
    if (Array.isArray(day?.exercises) && day.exercises.length > 0) continue;

    const selected = chooseRepairExercise(day, goal, allowedExercises) ?? allowedExercises[dayIndex % allowedExercises.length];
    if (!selected) continue;

    day.exercises = [{
      exerciseId: selected.id,
      order: 1,
      name: selected.exerciseName,
      sets: 3,
      reps: '8-12',
      restSeconds: 90,
      note: 'Auto-repaired from allowed exercise catalog after empty-day output',
    }];
    warnings.push({
      type: 'deterministic_repair',
      planId,
      jobId,
      dayIndex,
      reason: 'filled_empty_day',
      selectedExerciseId: selected.id,
      selectedExerciseName: selected.exerciseName,
    });
  }

  return { repaired: warnings.length > 0, content, warnings };
}

function repairExerciseCountAndDayGoals(
  content: any,
  goal: string,
  daysPerWeek: number,
  exercisesPerDay: number,
  allowedExercises: AllowedExercise[],
  planId: string,
  jobId: string | undefined,
): { repaired: boolean; content: any; warnings: Array<Record<string, unknown>> } {
  if (!content || typeof content !== 'object' || !Array.isArray(content.weeklySchedule)) {
    return { repaired: false, content, warnings: [] };
  }

  const warnings: Array<Record<string, unknown>> = [];

  content.exercisesPerDay = exercisesPerDay;

  for (let dayIndex = 0; dayIndex < content.weeklySchedule.length; dayIndex += 1) {
    const day = content.weeklySchedule[dayIndex];
    if (!day || typeof day !== 'object') continue;

    if (isGenericDayGoal(day.goal ?? day.focus)) {
      day.goal = splitGoalForDay(goal, dayIndex, daysPerWeek);
      warnings.push({ type: 'deterministic_repair', planId, jobId, dayIndex, reason: 'renamed_generic_day_goal', dayGoal: day.goal });
    }

    if (!Array.isArray(day.exercises)) {
      day.exercises = [];
    }

    if (day.exercises.length > exercisesPerDay) {
      day.exercises = day.exercises.slice(0, exercisesPerDay);
      warnings.push({ type: 'deterministic_repair', planId, jobId, dayIndex, reason: 'trimmed_extra_exercises', exercisesPerDay });
    }

    const usedIds = new Set(
      day.exercises
        .map((exercise: any) => String(exercise?.exerciseId || '').trim())
        .filter(Boolean),
    );

    while (day.exercises.length < exercisesPerDay) {
      const preferred = chooseRepairExercise(day, goal, allowedExercises);
      const fallbackIndex = (dayIndex * exercisesPerDay + day.exercises.length) % allowedExercises.length;
      const selected =
        (preferred && !usedIds.has(preferred.id) ? preferred : null) ??
        allowedExercises.find((exercise) => !usedIds.has(exercise.id)) ??
        allowedExercises[fallbackIndex];

      if (!selected) break;

      usedIds.add(selected.id);
      day.exercises.push(buildExercisePrescription(
        selected,
        day.exercises.length + 1,
        'Auto-repaired from allowed exercise catalog to match requested exercises per day',
      ));
      warnings.push({
        type: 'deterministic_repair',
        planId,
        jobId,
        dayIndex,
        reason: 'filled_missing_exercise',
        selectedExerciseId: selected.id,
        selectedExerciseName: selected.exerciseName,
      });
    }
  }

  return { repaired: warnings.length > 0, content, warnings };
}

function scoreAllowedExerciseForDay(day: any, planGoal: string, exercise: AllowedExercise): number {
  const dayText = tokenize([planGoal, day?.goal, day?.focus, day?.notes, day?.cardio].filter(Boolean).join(' '));
  const exerciseText = tokenize([
    exercise.exerciseName,
    exercise.bodyPart,
    exercise.typeOfActivity,
    exercise.typeOfEquipment,
    joinNames(exercise.muscleGroupsActivated ?? []),
  ]);

  let score = 0;
  const cardioSignals = ['cardio', 'fat', 'loss', 'weight', 'endurance', 'metcon'];
  const strengthSignals = ['strength', 'muscle', 'gain', 'mass', 'hypertrophy', 'push', 'pull', 'leg'];

  for (const token of dayText) {
    if (exerciseText.includes(token)) score += 2;
  }

  if (exercise.typeOfActivity === 'CARDIO' && dayText.some((token) => cardioSignals.includes(token))) score += 4;
  if (exercise.typeOfActivity === 'STRENGTH' && dayText.some((token) => strengthSignals.includes(token))) score += 2;
  if (exercise.bodyPart === 'FULL_BODY') score += 1;

  if (Array.isArray(exercise.muscleGroupsActivated)) {
    const muscleTokens = exercise.muscleGroupsActivated.flatMap((group) => tokenize(group));
    for (const token of dayText) {
      if (muscleTokens.includes(token)) score += 3;
    }
  }

  if (day?.cardio && exercise.typeOfActivity === 'CARDIO') score += 4;

  return score;
}

function chooseRepairExercise(day: any, planGoal: string, allowedExercises: AllowedExercise[]): AllowedExercise | null {
  let best: AllowedExercise | null = null;
  let bestScore = 0;

  for (const exercise of allowedExercises) {
    const score = scoreAllowedExerciseForDay(day, planGoal, exercise);
    if (score > bestScore) {
      best = exercise;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function appendPlanWarnings(content: any, warnings: Array<Record<string, unknown>>) {
  content._metadata = content._metadata || {};
  content._metadata.aiWarnings = Array.isArray(content._metadata.aiWarnings)
    ? content._metadata.aiWarnings.concat(warnings)
    : warnings;
}

function buildEmptyDayRepairPrompt(
  goal: string,
  daysPerWeek: number,
  allowedExercises: AllowedExercise[],
  emptyDayIndexes: number[],
  rawJson: string,
): string {
  return [
    'The previous plan JSON has empty days.',
    `Day indexes with no exercises: ${emptyDayIndexes.map((index) => index + 1).join(', ')}`,
    `Return the FULL JSON again with exactly ${daysPerWeek} scheduled days and at least one valid exerciseId for every day.`,
    'Do not add rest days inside weeklySchedule. Use recoveryNotes for rest guidance instead.',
    `Goal: ${goal}`,
    'Allowed exercises (id -> name):',
    allowedExercises.map((exercise) => `${exercise.id} -> ${exercise.exerciseName}`).join('\n'),
    `Original JSON:\n${rawJson}`,
  ].join('\n');
}

// ── Job data schema ───────────────────────────────────────────────────────────
const PlanJobDataSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  exercisesPerDay: z.number().int().min(1).max(8).default(4),
  trainingLocation: z.enum(['HOME', 'GYM']).default('GYM').optional(),
  equipmentPreference: z.enum(['MACHINE_ONLY', 'MIXED_GYM']).default('MIXED_GYM').optional(),
  /** Present when this job was queued via the adjust endpoint. */
  adjustmentContext: z.string().max(1000).optional(),
});
type PlanJobData = z.infer<typeof PlanJobDataSchema>;

export const aiWorker = new Worker(
  'ai-tasks',
  async (job) => {
    if (job.name === 'generate-nutrition-plan') {
      const { processNutritionPlanJob } = await import('../services/nutrition.processor');
      return processNutritionPlanJob(job);
    }

    // ── 1. Validate job data ───────────────────────────────────────────────
    const dataResult = PlanJobDataSchema.safeParse(job.data);
    if (!dataResult.success) {
      const reason = `Invalid job data: ${dataResult.error.errors.map((e) => e.message).join('; ')}`;
      logger.error({ jobId: job.id, data: job.data }, reason);
      // Do NOT update DB — we don't have a planId to update.
      throw new Error(reason);
    }
    const { planId, userId, goal, durationWeeks, daysPerWeek, exercisesPerDay, adjustmentContext, trainingLocation = 'GYM', equipmentPreference = 'MIXED_GYM' } =
      dataResult.data as PlanJobData;

    logger.info({ jobId: job.id, planId, userId }, 'Plan generation job started');

    // ── 2. Mark plan as PROCESSING ─────────────────────────────────────────
    await conversationRepository.updatePlanStatus(planId, PlanStatus.PROCESSING);

    // ── 3. Fetch allowed exercises from fitness-service (internal API) ─────
    const fitnessServiceUrl = process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    let allowedExercises: AllowedExercise[] = [];
    try {
      const resp = await axios.get(`${fitnessServiceUrl}/internal/exercises/for-ai-plans`, {
        params: { goal, trainingLocation, equipmentPreference, limit: PLAN_EXERCISE_FETCH_LIMIT },
        timeout: 10000,
        headers: {
          'x-internal-token': internalSecret,
          'x-user-id': userId,
        },
      });
      if (resp?.data?.success && Array.isArray(resp.data.data?.exercises)) {
        allowedExercises = resp.data.data.exercises.map((e: any) => ({
          id: e.id,
          exerciseName: e.exerciseName,
          bodyPart: e.bodyPart,
          typeOfActivity: e.typeOfActivity,
          typeOfEquipment: e.typeOfEquipment,
          muscleGroupsActivated: e.muscleGroupsActivated,
        }));
      }
    } catch (err) {
      logger.error({ err, planId, userId }, 'Failed to fetch allowed exercises from fitness-service');
      await conversationRepository.updatePlanFailed(planId, 'Failed to load exercise catalog from fitness-service');
      return;
    }

    if (!allowedExercises || allowedExercises.length === 0) {
      const reason = 'No allowed exercises available for the requested goal/filters';
      logger.error({ planId, userId, goal }, reason);
      await conversationRepository.updatePlanFailed(planId, reason);
      return;
    }

    // ── 3b. Fetch personal user context (InBody, workout history, nutrition) ─
    // Non-critical: failures are swallowed; plan will still be generated
    let userContextText = '';
    let workerContext: WorkerUserContext | null = null;
    try {
      const { fetchWorkerUserContext, formatWorkerContextForPrompt } = await import('./worker-user-context');
      const ctx = await fetchWorkerUserContext(userId);
      workerContext = ctx;
      userContextText = formatWorkerContextForPrompt(ctx);
      if (userContextText) {
        logger.info({ planId, hasInBody: !!ctx.latestInBody, workoutDays: ctx.recentWorkouts.length }, 'Fetched personal user context for plan generation');
      }
    } catch (err) {
      logger.warn({ err, planId }, 'Could not fetch personal user context — plan will use goal/params only');
    }

    // ── 4. Build per-day exercise catalogs and prompt ──────────────────────
    const perDayCatalogs = buildPerDayCatalogs(goal, daysPerWeek, allowedExercises, trainingLocation, equipmentPreference);
    logger.info(
      { planId, daysPerWeek, catalogs: perDayCatalogs.map(c => ({ day: c.dayGoal, groups: c.focusMuscleGroups, count: c.exercises.length })) },
      'Per-day exercise catalogs built',
    );

    // Flat list used for repair/validation helpers
    const promptExercises = allowedExercises.slice(0, PLAN_EXERCISE_PROMPT_LIMIT);
    // Append personal context to adjustmentContext so prompt builder can include it
    const enrichedAdjustmentContext = [
      adjustmentContext,
      userContextText ? `[Thông tin cá nhân hóa]\n${userContextText}` : '',
    ].filter(Boolean).join('\n\n') || undefined;
    const evidenceProfile = buildEvidenceProfile(workerContext, goal);
    const bodyCompAnalysis = analyzeBodyComposition(evidenceProfile);
    const bodyCompText = formatBodyCompAnalysis(bodyCompAnalysis);
    const evidenceDocs = await retriever.retrieveEvidence(bodyCompAnalysis.evidenceQueries).catch((err) => {
      logger.warn({ err, planId }, 'Plan evidence retrieval failed; continuing without evidence docs');
      return [];
    });
    const evidenceBundle: PlanEvidenceBundle = buildPlanEvidenceBundle(bodyCompAnalysis, evidenceDocs);
    const evidenceText = formatEvidenceForPlanPrompt(evidenceDocs);

    if (process.env.DEBUG_AI_PLAN === 'true') {
      logger.info({
        planId,
        goal,
        daysPerWeek,
        exercisesPerDay,
        hasUserContext: Boolean(userContextText),
        bodyCompAdjustments: evidenceBundle.adjustment_reason.map((item) => item.metric),
        evidenceUsed: evidenceBundle.evidence_used.map((item) => ({
          title: item.title,
          source_type: item.source_type,
          source_url: item.source_url,
        })),
        safetyNotesCount: evidenceBundle.safety_notes.length,
      }, 'AI plan prompt context summary');
    }

    const prompt = buildPlanPrompt(
      goal,
      durationWeeks,
      daysPerWeek,
      exercisesPerDay,
      enrichedAdjustmentContext,
      promptExercises,
      trainingLocation,
      perDayCatalogs,
      equipmentPreference,
      {
        bodyCompText: bodyCompText || undefined,
        evidenceText,
      },
    );

    const completePlan = async (content: any, logMessage: string, extraLog: Record<string, unknown> = {}) => {
      attachEvidenceToPlanContent(content, evidenceBundle);
      await conversationRepository.updatePlanCompletion(planId, content);
      logger.info({ jobId: job.id, planId, userId, ...extraLog }, logMessage);
    };

    let rawAnswer: string;
    try {
      const llmResponse = await llmService.callLLM(prompt, { responseFormat: 'json', timeoutMs: 300000, numPredict: 4096 });
      rawAnswer = llmResponse.answer;
    } catch (err) {
      const reason =
        err instanceof LlmError
          ? `LLM unavailable: ${err.message}`
          : `Unexpected LLM error: ${String(err)}`;
      logger.error({ err, jobId: job.id, planId }, 'Plan generation: LLM call failed');
      await conversationRepository.updatePlanFailed(planId, reason);
      throw err; // Let BullMQ mark the job as failed and apply retry policy.
    }

    // ── 4. Parse and validate LLM output ──────────────────────────────────
    let parseResult = parsePlanContent(rawAnswer);
    let looseCandidate = safeParseJsonCandidate(rawAnswer);

    // If no JSON found at all, ask the LLM one quick format-only retry.
    if (!parseResult.ok && !looseCandidate) {
      try {
        const minimalRepairPrompt = [
          'Your previous response was invalid because it was not a JSON object.',
          `Return ONLY one valid JSON object that matches the requested plan schema. Do NOT add any explanation, markdown, or code fences.`,
          `Goal: ${goal}`,
          `DurationWeeks: ${durationWeeks}`,
          `DaysPerWeek: ${daysPerWeek}`,
          'Allowed exercises (id -> name):',
          ...promptExercises.map((e) => `${e.id} -> ${e.exerciseName}`),
        ].join('\n');

        const retryResp = await llmService.callLLM(minimalRepairPrompt, { responseFormat: 'json', timeoutMs: 120000, numPredict: 4096 });
        const retryRaw = retryResp.answer;
        rawAnswer = retryRaw;
        looseCandidate = safeParseJsonCandidate(retryRaw);
        parseResult = parsePlanContent(retryRaw);
      } catch (err) {
        logger.warn({ err, jobId: job.id, planId }, 'Plan generation: format-only retry failed');
      }
    }

    // Validate exerciseIds are in allowedExercises. Retry once if not.
    const allowedIds = new Set(allowedExercises.map((e) => e.id));

    async function idsValid(content: any): Promise<{ ok: boolean; missing: string[] }> {
      const missing: string[] = [];
      if (!content || !Array.isArray(content.weeklySchedule)) return { ok: false, missing: ['invalid_structure'] };
      for (const day of content.weeklySchedule) {
        if (!Array.isArray(day.exercises)) return { ok: false, missing: ['invalid_structure'] };
        for (const ex of day.exercises) {
          if (!ex.exerciseId || typeof ex.exerciseId !== 'string' || !allowedIds.has(ex.exerciseId)) {
            missing.push(String(ex.exerciseId || ex.name || 'unknown'));
          }
        }
      }
      return { ok: missing.length === 0, missing };
    }

    if (!parseResult.ok) {
      const emptyDayIndexes = getEmptyDayIndexes(looseCandidate);
      if (emptyDayIndexes.length > 0) {
        try {
          const repairPrompt = buildEmptyDayRepairPrompt(goal, daysPerWeek, promptExercises, emptyDayIndexes, rawAnswer);
          const retryResp = await llmService.callLLM(repairPrompt, { responseFormat: 'json', timeoutMs: 120000, numPredict: 4096 });
          const retryRaw = retryResp.answer;
          rawAnswer = retryRaw;
          looseCandidate = safeParseJsonCandidate(retryRaw);
          parseResult = parsePlanContent(retryRaw);
        } catch (err) {
          logger.warn({ err, jobId: job.id, planId, emptyDayIndexes }, 'Plan generation: empty-day repair prompt failed');
        }
      }
    }

    if (!parseResult.ok && looseCandidate) {
      const repaired = repairScheduleLengthAndEmptyDays(
        looseCandidate,
        goal,
        daysPerWeek,
        exercisesPerDay,
        promptExercises,
        planId,
        job.id,
      );

      if (repaired.repaired) {
        appendPlanWarnings(repaired.content, repaired.warnings);
        parseResult = parsePlanContent(JSON.stringify(repaired.content));
        if (parseResult.ok) {
          logger.warn({ jobId: job.id, planId, repairs: repaired.warnings }, 'Plan generation repaired short/empty schedule output');
        }
      }
    }

    if (!parseResult.ok) {
      // If the failure was that no JSON object was returned even after retry,
      // surface a friendly message but keep the technical reason in logs.
      const tech = parseResult.reason || '';
      if (tech.includes('LLM did not return any JSON')) {
        const reason = 'AI chưa trả về đúng định dạng kế hoạch. Vui lòng thử lại hoặc giảm số buổi/tuần.';
        logger.error(
          { jobId: job.id, planId, technicalReason: 'LLM did not return any JSON object after retry', rawSnippet: String(rawAnswer).slice(0, 500) },
          'Plan generation: structured output validation failed',
        );
        await conversationRepository.updatePlanFailed(planId, reason);
        return;
      }

      const reason = 'AI không tạo đủ bài tập cho một số ngày. Vui lòng thử lại hoặc giảm số buổi/tuần.';
      logger.error(
        { jobId: job.id, planId, technicalReason: parseResult.reason, rawSnippet: String(rawAnswer).slice(0, 500) },
        'Plan generation: structured output validation failed',
      );
      await conversationRepository.updatePlanFailed(planId, reason);
      return;
    }

    const countRepair = repairExerciseCountAndDayGoals(
      parseResult.content,
      goal,
      daysPerWeek,
      exercisesPerDay,
      promptExercises,
      planId,
      job.id,
    );
    if (countRepair.repaired) {
      appendPlanWarnings(countRepair.content, countRepair.warnings);
      const repairedValidation = parsePlanContent(JSON.stringify(countRepair.content));
      if (repairedValidation.ok) {
        parseResult = repairedValidation;
        logger.warn({ jobId: job.id, planId, repairs: countRepair.warnings }, 'Plan generation repaired day goals/exercise counts');
      }
    }

    // ── 4b. Repair muscle-group mismatches (exercise in wrong day) ───────────
    const mismatchWarnings: Array<Record<string, unknown>> = [];
    const catalogById = new Map(perDayCatalogs.map((c) => [c.dayIndex, c]));
    const planContentForRepair = parseResult.content as any;

    if (Array.isArray(planContentForRepair?.weeklySchedule)) {
      for (let dayIndex = 0; dayIndex < planContentForRepair.weeklySchedule.length; dayIndex++) {
        const day = planContentForRepair.weeklySchedule[dayIndex];
        const catalog = catalogById.get(dayIndex);
        if (!catalog || catalog.focusMuscleGroups.includes('FULL_BODY')) continue;

        const allowedById = new Map(allowedExercises.map((ex) => [ex.id, ex]));

        if (!Array.isArray(day?.exercises)) continue;

        for (let exIdx = 0; exIdx < day.exercises.length; exIdx++) {
          const ex = day.exercises[exIdx];
          if (!ex?.exerciseId) continue;

          const exInfo = allowedById.get(String(ex.exerciseId));
          if (!exInfo) continue; // Will be caught by idsValid

          const mismatch = validateExerciseMuscleMatch(exInfo, catalog.focusMuscleGroups);
          if (!mismatch) continue;

          // Try to find a valid replacement from this day's catalog
          const usedIds = new Set(day.exercises.map((e: any) => String(e?.exerciseId || '')));
          const replacement = catalog.exercises.find((cEx) =>
            !usedIds.has(cEx.id) || cEx.id === ex.exerciseId,
          ) ?? catalog.exercises[exIdx % catalog.exercises.length];

          if (!replacement) continue;

          mismatchWarnings.push({
            type: 'muscle_mismatch_repair',
            planId,
            jobId: job.id,
            dayIndex,
            dayGoal: catalog.dayGoal,
            focusMuscleGroups: catalog.focusMuscleGroups,
            replaced: `${exInfo.exerciseName} (${exInfo.bodyPart})`,
            with: `${replacement.exerciseName} (${replacement.bodyPart})`,
            reason: mismatch,
          });

          day.exercises[exIdx] = buildExercisePrescription(
            replacement,
            exIdx + 1,
            'Auto-repaired: exercise did not match day muscle group',
          );
        }
      }
    }

    if (mismatchWarnings.length > 0) {
      appendPlanWarnings(planContentForRepair, mismatchWarnings);
      const repairedAfterMuscle = parsePlanContent(JSON.stringify(planContentForRepair));
      if (repairedAfterMuscle.ok) {
        parseResult = repairedAfterMuscle;
        logger.warn({ planId, jobId: job.id, repairs: mismatchWarnings }, 'Plan repaired: muscle-group mismatches corrected');
      }
    }

    // Check IDs
    let idCheck = await idsValid(parseResult.content as any);
    if (!idCheck.ok) {
      try {
        const mapped = await tryMapNamesToIds(parseResult.content);
        if (mapped) return;
      } catch (e) {
        logger.warn({ err: e, planId }, 'Name->ID mapping helper failed before LLM correction retry');
      }

      idCheck = await idsValid(parseResult.content as any);
    }

    if (!idCheck.ok) {
      const invalidContent = parseResult.content as any;
      const replacementWarnings: Array<Record<string, unknown>> = [];
      if (Array.isArray(invalidContent.weeklySchedule)) {
        for (let dayIndex = 0; dayIndex < invalidContent.weeklySchedule.length; dayIndex += 1) {
          const day = invalidContent.weeklySchedule[dayIndex];
          if (!Array.isArray(day?.exercises)) continue;

          const usedIds = new Set(
            day.exercises
              .map((exercise: any) => String(exercise?.exerciseId || '').trim())
              .filter((id: string) => allowedIds.has(id)),
          );

          for (let exerciseIndex = 0; exerciseIndex < day.exercises.length; exerciseIndex += 1) {
            const exercise = day.exercises[exerciseIndex];
            if (exercise?.exerciseId && allowedIds.has(String(exercise.exerciseId))) continue;

            const preferred = chooseRepairExercise(day, goal, allowedExercises);
            const fallback = allowedExercises.find((candidate) => !usedIds.has(candidate.id)) ?? allowedExercises[(dayIndex + exerciseIndex) % allowedExercises.length];
            const selected = preferred && !usedIds.has(preferred.id) ? preferred : fallback;
            if (!selected) continue;

            usedIds.add(selected.id);
            day.exercises[exerciseIndex] = buildExercisePrescription(
              selected,
              exerciseIndex + 1,
              'Auto-repaired from allowed exercise catalog after invalid exerciseId output',
            );
            replacementWarnings.push({
              type: 'deterministic_repair',
              planId,
              jobId: job.id,
              dayIndex,
              exerciseIndex,
              reason: 'replaced_invalid_exercise_id',
              selectedExerciseId: selected.id,
              selectedExerciseName: selected.exerciseName,
            });
          }
        }
      }

      if (replacementWarnings.length > 0) {
        appendPlanWarnings(invalidContent, replacementWarnings);
        const repairedValidation = parsePlanContent(JSON.stringify(invalidContent));
        const repairedIdCheck = await idsValid(invalidContent);
        if (repairedValidation.ok && repairedIdCheck.ok) {
          parseResult = repairedValidation;
          idCheck = repairedIdCheck;
          logger.warn({ jobId: job.id, planId, repairs: replacementWarnings }, 'Plan generation repaired invalid exercise ids');
        }
      }
    }

    if (!idCheck.ok) {

      // Retry once with a corrective prompt instructing to use only allowed exerciseIds
      const correctionPrompt = `The previous output used exerciseIds not present in the allowed list. Allowed exercises (id -> name):\n${promptExercises
        .map((e) => `${e.id} -> ${e.exerciseName}`)
        .join('\n')}\n\nPlease re-output the plan JSON only using exerciseId fields that are exactly one of the allowed ids. Keep the same JSON structure as previously requested and make sure each exercise object includes ${"exerciseId, name, sets, reps, restSeconds"}. Return ONLY the JSON.`;

      try {
        const retryResp = await llmService.callLLM(correctionPrompt + '\n' + rawAnswer, { responseFormat: 'json', timeoutMs: 120000, numPredict: 4096 });
        const retryRaw = retryResp.answer;
        parseResult = parsePlanContent(retryRaw);
        if (!parseResult.ok) {
          const reason = `Plan content invalid after retry: ${parseResult.reason}`;
          logger.error({ jobId: job.id, planId, reason }, 'Plan generation: retry parse failed');
          await conversationRepository.updatePlanFailed(planId, reason);
          return;
        }
        const retryCountRepair = repairExerciseCountAndDayGoals(
          parseResult.content,
          goal,
          daysPerWeek,
          exercisesPerDay,
          promptExercises,
          planId,
          job.id,
        );
        if (retryCountRepair.repaired) {
          appendPlanWarnings(retryCountRepair.content, retryCountRepair.warnings);
          const retryRepairValidation = parsePlanContent(JSON.stringify(retryCountRepair.content));
          if (retryRepairValidation.ok) {
            parseResult = retryRepairValidation;
          }
        }
        idCheck = await idsValid(parseResult.content as any);
        if (!idCheck.ok) {
          try {
            const mapped = await tryMapNamesToIds(parseResult.content);
            if (mapped) return;
          } catch (e) {
            logger.warn({ err: e, planId }, 'Name->ID mapping helper failed');
          }

          const incomplete = parseResult.content as any;
          const repairedDays: Array<{ dayIndex: number; selectedExerciseId: string; selectedExerciseName: string }> = [];

          if (Array.isArray(incomplete.weeklySchedule)) {
            for (let dayIndex = 0; dayIndex < incomplete.weeklySchedule.length; dayIndex += 1) {
              const day = incomplete.weeklySchedule[dayIndex];
              if (Array.isArray(day.exercises) && day.exercises.length > 0) continue;

              const selected = chooseRepairExercise(day, goal, allowedExercises);
              if (!selected) {
                continue;
              }

              day.exercises = [{
                exerciseId: selected.id,
                order: 1,
                name: selected.exerciseName,
                sets: 3,
                reps: '8-12',
                restSeconds: 60,
                note: 'Auto-repaired from allowed exercise catalog after empty-day output',
              }];
              repairedDays.push({
                dayIndex,
                selectedExerciseId: selected.id,
                selectedExerciseName: selected.exerciseName,
              });
            }
          }

          const repairedValidation = parsePlanContent(JSON.stringify(incomplete));
          const repairedIdCheck = await idsValid(incomplete);
          if (repairedDays.length > 0 && repairedValidation.ok && repairedIdCheck.ok) {
            appendPlanWarnings(incomplete, repairedDays.map((item) => ({
              type: 'deterministic_repair',
              planId,
              jobId: job.id,
              dayIndex: item.dayIndex,
              reason: 'deterministic_empty_day_repair',
              selectedExerciseId: item.selectedExerciseId,
              selectedExerciseName: item.selectedExerciseName,
            })));
            await completePlan(incomplete, 'Plan generation completed after deterministic empty-day repair', { repairedDays });
            return;
          }

          await conversationRepository.updatePlanFailed(planId, 'AI không tạo đủ bài tập cho một số ngày. Vui lòng thử lại hoặc giảm số buổi/tuần.');
          logger.warn({ jobId: job.id, planId, missing: idCheck.missing, repairedDays }, 'Plan generation failed after repair attempts');
          return;
        }
      } catch (err) {
        const reason = `LLM retry failed: ${String(err)}`;
        logger.error({ err, jobId: job.id, planId }, 'Plan generation: LLM retry failed');
        await conversationRepository.updatePlanFailed(planId, reason);
        return;
      }
    }

    // Fallback: if IDs are missing but the LLM returned exercise names, first
    // try to map names -> IDs using the in-memory `allowedExercises` list
    // returned earlier (best match). If that fails, fall back to the
    // fitness-service public search endpoint.
    async function tryMapNamesToIds(content: any): Promise<boolean> {
      const nameToFind: string[] = [];
      for (const day of content.weeklySchedule) {
        for (const ex of day.exercises) {
          if ((!ex.exerciseId || !allowedIds.has(String(ex.exerciseId))) && ex.name) {
            nameToFind.push(String(ex.name));
          }
        }
      }

      if (nameToFind.length === 0) return false;

      // helper normalizer
      const normalize = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

      // Collect warnings generated during mapping attempts.
      const mappingWarnings: Array<any> = [];

      // 1) try matching against allowedExercises we fetched earlier
      for (const nm of nameToFind) {
        const qn = normalize(nm);
        let best: any = null;
        for (const cand of allowedExercises) {
          const cn = normalize(cand.exerciseName || '');
          // Only accept confident substring matches. Do NOT pick an arbitrary
          // candidate when no clear match exists.
          if (cn.includes(qn) || qn.includes(cn)) {
            best = cand;
            break;
          }
        }
        if (best) {
          mappingWarnings.push({ type: 'name_mapping', planId, jobId: job.id, exerciseName: nm, mappedTo: best.id, mappedName: best.exerciseName, source: 'allowedList' });
          for (const day of content.weeklySchedule) {
            for (const ex of day.exercises) {
              if ((!ex.exerciseId || ex.exerciseId === '' || !allowedIds.has(String(ex.exerciseId))) && ex.name && normalize(String(ex.name)).includes(qn)) {
                ex.exerciseId = best.id;
                ex.name = best.exerciseName || ex.name;
              }
            }
          }
        } else {
          // Log that we couldn't confidently map this name against allowed list.
          logger.warn({ planId, jobId: job.id, exerciseName: nm }, 'Name not confidently matched in allowedExercises (skipping allowed-list mapping)');
        }
      }

      // Re-run id validation — if successful, persist and finish.
      let newCheck = await idsValid(content);
      if (newCheck.ok) {
        await completePlan(content, 'Plan generation completed after allowedExercises name->id mapping');
        return true;
      }

      // 2) fallback to querying fitness-service public search if allowed list didn't help
      const searchUrl = process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
      for (const nm of nameToFind) {
        try {
          const resp = await axios.get(`${searchUrl}/exercises`, { params: { search: nm, limit: 5 }, timeout: 5000 });
          const candidates = Array.isArray(resp.data) ? resp.data : resp.data?.data ?? [];
          if (candidates && candidates.length > 0) {
            // Try to select the best candidate by fuzzy-ish normalization match.
            const qn = normalize(nm);
            let best: any = null;
            for (const c of candidates) {
              const cn = normalize(c.exerciseName || c.name || '');
              if (cn.includes(qn) || qn.includes(cn)) {
                best = c;
                break;
              }
            }
            if (best) {
              mappingWarnings.push({ type: 'name_mapping', planId, jobId: job.id, exerciseName: nm, mappedTo: best.id, mappedName: best.exerciseName || best.name, source: 'publicSearch' });
              for (const day of content.weeklySchedule) {
                for (const ex of day.exercises) {
                  if ((!ex.exerciseId || ex.exerciseId === '' || !allowedIds.has(String(ex.exerciseId))) && ex.name && normalize(String(ex.name)).includes(normalize(nm))) {
                    ex.exerciseId = best.id;
                    ex.name = best.exerciseName || ex.name;
                  }
                }
              }
            } else {
              logger.warn({ planId, jobId: job.id, exerciseName: nm }, 'Name not confidently matched in public search results (skipping)');
            }
          }
        } catch (e) {
          // ignore individual lookup errors — continue best-effort
          logger.warn({ err: e, name: nm, planId }, 'Name->ID mapping lookup failed (continuing)');
        }
      }

      // Re-run id validation
      const finalCheck = await idsValid(content);
      if (finalCheck.ok) {
        // Persist mapping warnings into the plan JSON so downstream consumers
        // and operators can debug which names were auto-mapped.
        content._metadata = content._metadata || {};
        content._metadata.aiWarnings = (content._metadata.aiWarnings || []).concat(mappingWarnings);
        if (mappingWarnings.length > 0) logger.warn({ planId, jobId: job.id, mappings: mappingWarnings }, 'Persisting plan with mapping warnings');
        await completePlan(content, 'Plan generation completed after name->id mapping fallback');
        return true;
      }
      return false;
    }

    // If initial id check failed, attempt mapping fallback before giving up.
    if (!idCheck.ok) {
      try {
        const mapped = await tryMapNamesToIds(parseResult.content);
        if (mapped) return; // done
      } catch (e) {
        logger.warn({ err: e, planId }, 'Name->ID mapping fallback encountered an error');
      }
    }

    // Normalize exercise names using canonical names from fitness-service
    const canonicalById = new Map(allowedExercises.map((e) => [e.id, e.exerciseName]));
    const content = parseResult.content as any;
    for (const day of content.weeklySchedule) {
      for (const ex of day.exercises) {
        const canonical = canonicalById.get(ex.exerciseId);
        if (canonical) ex.name = canonical;
      }
    }

    // Embed trainingLocation and equipmentPreference in plan metadata for frontend display
    content._metadata = content._metadata || {};
    content._metadata.trainingLocation = trainingLocation;
    content._metadata.equipmentPreference = equipmentPreference;

    // ── 5. Persist structured plan ─────────────────────────────────────────
    await completePlan(content, 'Plan generation completed successfully');
  },
  {
    connection: redisConnection,
    // Retry up to 2 times on transient LLM failures (network, timeout).
    // Validation failures are NOT re-thrown, so they won't consume retries.
  },
);

aiWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'AI worker job failed after all retries');
});
