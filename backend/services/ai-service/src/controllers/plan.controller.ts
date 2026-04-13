import { Request, Response, NextFunction } from 'express';
import { logger, aiPlanGenerationsTotal } from '@gym-coach/shared';
import { aiQueue } from '../workers/ai.worker';
import { conversationService } from '../services/conversation.service';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import { llmService } from '../services/llm.service';
import { LlmError, ApiError, formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { GeneratePlanRequest, ExplainPlanRequest, AdjustPlanRequest } from '../schemas/plan.schemas';
import type { PlanContent } from '../schemas/plan.schemas';

function buildExplanationPrompt(plan: PlanContent, language: string): string {
  const schedule = plan.weeklySchedule
    .map(
      (day) =>
        `${day.day} (${day.goal}): ` +
        day.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(', '),
    )
    .join('\n');

  if (language === 'vi') {
    return `Bạn là huấn luyện viên cá nhân. Hãy giải thích kế hoạch tập luyện sau bằng tiếng Việt:

Mục tiêu: ${plan.goal}
Thời lượng: ${plan.durationWeeks} tuần, ${plan.daysPerWeek} buổi/tuần

Lịch tập:
${schedule}

Hãy giải thích:
1. Tại sao kế hoạch này được thiết kế cho mục tiêu ${plan.goal}
2. Nguyên tắc chọn bài tập
3. Kết quả kỳ vọng và thời điểm đạt được
4. Lưu ý kỹ thuật quan trọng
5. Cách tiến độ qua từng tuần`;
  }

  return `You are a personal trainer. Explain the following workout plan clearly and motivatingly:

Goal: ${plan.goal}
Duration: ${plan.durationWeeks} weeks, ${plan.daysPerWeek} days/week

Schedule:
${schedule}

Please explain:
1. Why this plan is designed this way for the ${plan.goal} goal
2. Key principles behind the exercise selection
3. Expected results and timeline
4. Important technique notes for the main exercises
5. How to progress across the weeks`;
}

export const planController = {
  async generatePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { goal, durationWeeks, daysPerWeek } = req.body as GeneratePlanRequest;

    try {
      const result = await conversationService.queuePlanGeneration({
        userId,
        goal,
        durationWeeks,
        daysPerWeek,
      });
      aiPlanGenerationsTotal.inc({ status: 'queued' });
      // 202 Accepted: the plan is queued, not yet complete.
      res.status(202).json(formatSuccessResponse(result));
    } catch (err) {
      aiPlanGenerationsTotal.inc({ status: 'failure' });
      logger.error({ err, userId }, 'Error queuing plan generation');
      next(err);
    }
  },

  /**
   * GET /plans/current
   * Returns the user's most recent COMPLETED plans (up to 10).
   */
  async getCurrentPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;

    try {
      const plans = await conversationRepository.findPlansByUser(userId, PlanStatus.COMPLETED, 10);
      res.json(formatSuccessResponse({ plans }));
    } catch (err) {
      logger.error({ err, userId }, 'Error fetching current plans');
      next(err);
    }
  },

  /**
   * GET /plans/:planId
   * Returns a single plan (any status) owned by the authenticated user.
   */
  async getPlanById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;

    try {
      const plan = await conversationRepository.findPlanById(planId);
      if (!plan) {
        res.status(404).json(formatErrorResponse('PLAN_NOT_FOUND', `Plan ${planId} not found`));
        return;
      }
      if (plan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this plan'));
        return;
      }
      res.json(formatSuccessResponse({ plan }));
    } catch (err) {
      logger.error({ err, planId }, 'Error fetching plan by ID');
      next(err);
    }
  },

  /**
   * GET /plans/job/:jobId
   * Poll job status. Returns the associated plan record when available.
   * Use this after POST /plans/workout/generate to know when the plan is ready.
   */
  async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { jobId } = req.params;

    try {
      // Check DB first — the plan record is created before the job is queued.
      const dbPlan = await conversationRepository.findPlanByJobId(jobId);
      if (dbPlan && dbPlan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this job'));
        return;
      }

      // Enrich with live BullMQ state when available.
      const bullJob = await aiQueue.getJob(jobId);
      let bullState: string | null = null;
      if (bullJob) {
        bullState = await bullJob.getState();
      }

      if (!dbPlan && !bullJob) {
        res.status(404).json(formatErrorResponse('NOT_FOUND', `Job ${jobId} not found`));
        return;
      }

      res.json(
        formatSuccessResponse({
          jobId,
          planId: dbPlan?.id ?? null,
          status: dbPlan?.status ?? bullState ?? 'UNKNOWN',
          plan: dbPlan?.status === PlanStatus.COMPLETED ? dbPlan.plan : null,
          failReason: dbPlan?.failReason ?? null,
          createdAt: dbPlan?.createdAt ?? null,
          updatedAt: dbPlan?.updatedAt ?? null,
        }),
      );
    } catch (err) {
      logger.error({ err, jobId }, 'Error fetching job status');
      next(err);
    }
  },

  /**
   * POST /plans/explain
   * Generate a natural-language explanation of a COMPLETED plan.
   */
  async explainPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.body as ExplainPlanRequest;
    // Accept optional language hint from query: ?lang=vi | en
    const lang = (req.query['lang'] as string) === 'en' ? 'en' : 'vi';

    try {
      const plan = await conversationRepository.findPlanById(planId);
      if (!plan) {
        res.status(404).json(formatErrorResponse('PLAN_NOT_FOUND', `Plan ${planId} not found`));
        return;
      }
      if (plan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this plan'));
        return;
      }
      if (plan.status !== PlanStatus.COMPLETED) {
        res.status(409).json(
          formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} — only COMPLETED plans can be explained`),
        );
        return;
      }

      const planContent = plan.plan as unknown as PlanContent;
      const prompt = buildExplanationPrompt(planContent, lang);

      const llmResponse = await llmService.callLLM(prompt);
      res.json(
        formatSuccessResponse({
          planId,
          explanation: llmResponse.answer,
        }),
      );
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(503).json(
          formatErrorResponse('LLM_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again shortly.'),
        );
        return;
      }
      if (err instanceof ApiError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      logger.error({ err, planId }, 'Error explaining plan');
      next(err);
    }
  },

  /**
   * POST /plans/adjust
   * Queue a new version of a plan with the given adjustments.
   * Returns immediately with a new planId and jobId to poll.
   */
  async adjustPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId, adjustments, daysPerWeek } = req.body as AdjustPlanRequest;

    try {
      const result = await conversationService.queuePlanAdjustment({
        originalPlanId: planId,
        userId,
        adjustments,
        daysPerWeek,
      });
      aiPlanGenerationsTotal.inc({ status: 'queued' });
      res.status(202).json(formatSuccessResponse(result));
    } catch (err) {
      aiPlanGenerationsTotal.inc({ status: 'failure' });
      if (err instanceof ApiError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      logger.error({ err, planId, userId }, 'Error adjusting plan');
      next(err);
    }
  },
};
