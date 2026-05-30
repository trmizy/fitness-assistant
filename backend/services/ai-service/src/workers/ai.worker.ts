import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import axios from 'axios';
import { llmService } from '../services/llm.service';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import { parsePlanContent, buildPlanPrompt } from '../schemas/plan.schemas';
import { LlmError } from '../errors/api-error';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const aiQueue = new Queue('ai-tasks', { connection: redisConnection });

type AllowedExercise = {
  id: string;
  exerciseName: string;
  bodyPart?: string;
  typeOfActivity?: string;
  typeOfEquipment?: string;
  muscleGroupsActivated?: string[];
};

const PLAN_EXERCISE_PROMPT_LIMIT = 80;

function splitGoalForDay(planGoal: string, dayIndex: number, daysPerWeek: number): string {
  const normalizedGoal = String(planGoal || '').toLowerCase();
  const muscleGain = /tang co|tăng cơ|muscle|hypertrophy|mass/.test(normalizedGoal);

  const hypertrophySplits =
    daysPerWeek >= 6
      ? ['Nguc + Vai + Tay sau', 'Lung + Tay truoc', 'Chan + Mong', 'Nguc + Vai', 'Lung + Core', 'Chan + Bap chan']
      : daysPerWeek >= 5
        ? ['Push - Nguc + Vai + Tay sau', 'Pull - Lung + Tay truoc', 'Legs - Chan + Mong', 'Upper Body', 'Lower Body']
        : daysPerWeek >= 4
          ? ['Upper Push - Nguc + Vai + Tay sau', 'Lower - Chan + Mong', 'Upper Pull - Lung + Tay truoc', 'Full Body Hypertrophy']
          : ['Full Body Strength', 'Upper Body', 'Lower Body'];

  const generalSplits =
    daysPerWeek >= 5
      ? ['Full Body Strength', 'Lower Body + Conditioning', 'Upper Body + Core', 'Full Body Volume', 'Mobility + Zone 2']
      : daysPerWeek >= 4
        ? ['Full Body Strength', 'Lower Body + Conditioning', 'Upper Body + Core', 'Full Body Volume']
        : ['Full Body Strength', 'Upper Body + Core', 'Lower Body + Conditioning'];

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

function safeParseJsonCandidate(raw: string): unknown | null {
  // Strip common code fences and labels
  const cleaned = String(raw || '')
    .replace(/```\s*json\s*/i, '')
    .replace(/```/g, '')
    .replace(/^\s*JSON\s*[:\-]\s*/i, '')
    .trim();

  // Find first balanced JSON object (handles braces within strings)
  function extractBalanced(s: string): string | null {
    const start = s.indexOf('{');
    if (start === -1) return null;
    let inString = false;
    let escape = false;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  }

  // Try full-parse first
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const candidate = extractBalanced(cleaned);
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = candidate.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

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
  /** Present when this job was queued via the adjust endpoint. */
  adjustmentContext: z.string().max(1000).optional(),
});
type PlanJobData = z.infer<typeof PlanJobDataSchema>;

export const aiWorker = new Worker(
  'ai-tasks',
  async (job) => {
    // ── 1. Validate job data ───────────────────────────────────────────────
    const dataResult = PlanJobDataSchema.safeParse(job.data);
    if (!dataResult.success) {
      const reason = `Invalid job data: ${dataResult.error.errors.map((e) => e.message).join('; ')}`;
      logger.error({ jobId: job.id, data: job.data }, reason);
      // Do NOT update DB — we don't have a planId to update.
      throw new Error(reason);
    }
    const { planId, userId, goal, durationWeeks, daysPerWeek, exercisesPerDay, adjustmentContext } =
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
        params: { goal, limit: PLAN_EXERCISE_PROMPT_LIMIT },
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

    // ── 4. Build prompt (include allowed exercises) and call LLM ───────────
    const promptExercises = allowedExercises.slice(0, PLAN_EXERCISE_PROMPT_LIMIT);
    const prompt = buildPlanPrompt(goal, durationWeeks, daysPerWeek, exercisesPerDay, adjustmentContext, promptExercises);

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
            await conversationRepository.updatePlanCompletion(planId, incomplete);
            logger.info({ jobId: job.id, planId, repairedDays }, 'Plan generation completed after deterministic empty-day repair');
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
        await conversationRepository.updatePlanCompletion(planId, content);
        logger.info({ jobId: job.id, planId, userId }, 'Plan generation completed after allowedExercises name->id mapping');
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
        await conversationRepository.updatePlanCompletion(planId, content);
        logger.info({ jobId: job.id, planId, userId }, 'Plan generation completed after name->id mapping fallback');
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

    // ── 5. Persist structured plan ─────────────────────────────────────────
    await conversationRepository.updatePlanCompletion(planId, content);
    logger.info({ jobId: job.id, planId, userId }, 'Plan generation completed successfully');
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
