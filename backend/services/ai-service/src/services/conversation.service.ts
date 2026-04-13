import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import { llmService } from './llm.service';
import { aiQueue } from '../workers/ai.worker';
import type { GenerateWorkoutRequest, GeneratePlanRequest } from '../schemas/ai.schemas';
import { ApiError } from '../errors/api-error';

// ── Quick-workout exercise schema (simpler than full plan) ────────────────────
const QuickExerciseSchema = z.object({
  name: z.string().min(1).max(200),
  sets: z.number().int().min(1).max(10),
  reps: z.union([z.number().int().min(1), z.string().min(1)]).transform(String),
  duration: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
});
type QuickExercise = z.infer<typeof QuickExerciseSchema>;

function parseExercisesFromLlm(rawAnswer: string): QuickExercise[] {
  // Try extracting a JSON array from the response
  const arrayMatch = rawAnswer.match(/\[[\s\S]*?\]/);
  if (!arrayMatch) {
    logger.warn({ answerSnippet: rawAnswer.slice(0, 200) }, 'generateWorkout: no JSON array found in LLM answer');
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => QuickExerciseSchema.safeParse(item))
      .filter((r): r is z.SafeParseSuccess<QuickExercise> => r.success)
      .map((r) => r.data);
  } catch (err) {
    logger.warn({ err }, 'generateWorkout: failed to parse exercises JSON');
    return [];
  }
}

export const conversationService = {
  async getConversations(userId: string, limit = 10) {
    const conversations = await conversationRepository.findMany({ userId }, limit);
    return { conversations };
  },

  async submitFeedback(conversationId: string, feedback: number) {
    // Validation is handled upstream by Zod; this layer only does DB work.
    await conversationRepository.updateFeedback(conversationId, feedback);
    return { success: true, message: 'Feedback recorded' };
  },

  async getFeedbackStats() {
    const [total, thumbsUp, thumbsDown] = await Promise.all([
      conversationRepository.count(),
      conversationRepository.count({ feedback: 1 }),
      conversationRepository.count({ feedback: -1 }),
    ]);
    return {
      totalConversations: total,
      thumbsUp,
      thumbsDown,
      satisfactionRate: total > 0 ? Number(((thumbsUp / total) * 100).toFixed(1)) : 0,
    };
  },

  async generateWorkout(params: GenerateWorkoutRequest) {
    const { goal, duration, equipment, bodyParts } = params;
    const prompt = `Generate a single workout session with these requirements:
- Goal: ${goal}
- Session duration: ${duration} minutes
- Available equipment: ${equipment.length ? equipment.join(', ') : 'bodyweight only'}
- Target body parts: ${bodyParts.length ? bodyParts.join(', ') : 'full body'}

Return ONLY a JSON array of exercises. No markdown, no explanation.
[
  { "name": "Exercise Name", "sets": 3, "reps": "10", "duration": null, "weight": null }
]`.trim();

    const llmResponse = await llmService.callLLM(prompt);
    const exercises = parseExercisesFromLlm(llmResponse.answer);

    return {
      name: `${goal} Workout`,
      description: `AI-generated workout for ${goal}`,
      duration,
      exercises,
    };
  },

  async queuePlanGeneration(params: GeneratePlanRequest & { userId: string }) {
    const { userId, goal, durationWeeks, daysPerWeek } = params;

    // Create the plan record immediately so the user can poll its status.
    const plan = await conversationRepository.createWorkoutPlan({
      userId,
      name: `${goal} Plan`,
      description: `${durationWeeks}-week ${goal} program, ${daysPerWeek} days/week`,
      goal,
      duration: durationWeeks,
      daysPerWeek,
    });

    const job = await aiQueue.add('generate-plan', {
      planId: plan.id,
      userId,
      goal,
      durationWeeks,
      daysPerWeek,
    });

    // Link the job ID so the plan record is discoverable by jobId.
    await conversationRepository.updatePlanJob(plan.id, job.id!);

    logger.info({ planId: plan.id, jobId: job.id, userId }, 'Plan generation queued');
    return { planId: plan.id, jobId: job.id!, status: PlanStatus.QUEUED };
  },

  async queuePlanAdjustment(params: {
    originalPlanId: string;
    userId: string;
    adjustments: string;
    daysPerWeek?: number;
  }) {
    const original = await conversationRepository.findPlanById(params.originalPlanId);
    if (!original) {
      throw new ApiError('PLAN_NOT_FOUND', `Plan ${params.originalPlanId} not found`, 404);
    }
    if (original.userId !== params.userId) {
      throw new ApiError('FORBIDDEN', 'You do not have access to this plan', 403);
    }
    if (original.status !== PlanStatus.COMPLETED) {
      throw new ApiError(
        'PLAN_NOT_COMPLETED',
        'Only COMPLETED plans can be adjusted. Wait for the current plan to finish generating.',
        409,
      );
    }

    const newVersion = original.version + 1;
    const daysPerWeek = params.daysPerWeek ?? original.daysPerWeek;

    const newPlan = await conversationRepository.createAdjustedPlan({
      userId: params.userId,
      originalPlanId: params.originalPlanId,
      goal: original.goal,
      duration: original.duration,
      daysPerWeek,
      adjustments: params.adjustments,
      version: newVersion,
    });

    const job = await aiQueue.add('generate-plan', {
      planId: newPlan.id,
      userId: params.userId,
      goal: original.goal,
      durationWeeks: original.duration,
      daysPerWeek,
      adjustmentContext: params.adjustments,
    });

    await conversationRepository.updatePlanJob(newPlan.id, job.id!);

    logger.info(
      { newPlanId: newPlan.id, originalPlanId: params.originalPlanId, version: newVersion },
      'Plan adjustment queued',
    );
    return { planId: newPlan.id, jobId: job.id!, version: newVersion, status: PlanStatus.QUEUED };
  },
};
