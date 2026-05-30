import axios from 'axios';
import { Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import { logger, aiPlanGenerationsTotal } from '@gym-coach/shared';
import { aiQueue } from '../workers/ai.worker';
import { conversationService } from '../services/conversation.service';
import { conversationRepository, prisma, PlanStatus } from '../repositories/conversation.repository';
import { llmService } from '../services/llm.service';
import { LlmError, ApiError, formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { GeneratePlanRequest, ExplainPlanRequest, AdjustPlanRequest, SavePlanToWorkoutLogRequest } from '../schemas/plan.schemas';
import type { PlanContent } from '../schemas/plan.schemas';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3004';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

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
    const { goal, durationWeeks, daysPerWeek, contractId } = req.body as GeneratePlanRequest & { contractId?: string };

    try {
      let ptUserId: string | null = null;
      let clientName: string | null = null;

      // Verify contractId via user-service (fail-closed: contractId sent but invalid → 400)
      if (contractId) {
        const verifyRes = await axios.get(
          `${USER_SERVICE_URL}/internal/contracts/active-pt`,
          {
            params: { clientId: userId, contractId },
            headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
            timeout: 3000,
          },
        );
        ptUserId = verifyRes.data?.ptUserId ?? null;
        if (!ptUserId) {
          res.status(400).json({ error: 'contractId không hợp lệ hoặc không còn ACTIVE' });
          return;
        }
      }

      // Fetch clientName from auth-service (fail-safe — empty name is fine)
      try {
        const authRes = await axios.get(
          `${AUTH_SERVICE_URL}/auth/internal/users/${userId}`,
          { headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET }, timeout: 3000 },
        );
        const u = authRes.data?.user ?? authRes.data;
        clientName = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || null;
      } catch {
        // fail-safe: clientName stays null
      }

      const result = await conversationService.queuePlanGeneration({
        userId,
        goal,
        durationWeeks,
        daysPerWeek,
        ptUserId,
        clientName,
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
   * Returns the user's most recent COMPLETED plans (up to 10), including plans pending PT review.
   * Each plan has a computed `displayStatus` and `approvedBy` field for the client UI.
   */
  async getCurrentPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;

    try {
      const rawPlans = await prisma.workoutPlan.findMany({
        where: { userId, status: PlanStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const plans = rawPlans.map((p) => ({
        ...p,
        displayStatus:
          !p.ptUserId ? 'active' :
          p.ptReviewStatus === 'PENDING_PT_REVIEW' ? 'pending_review' :
          p.ptReviewStatus === 'PT_APPROVED' ? 'active' :
          p.ptReviewStatus === 'PT_REJECTED' ? 'rejected' : 'active',
        approvedBy:
          !p.ptUserId ? 'AI Engine' :
          p.ptReviewStatus === 'PENDING_PT_REVIEW' ? null :
          p.ptReviewStatus === 'PT_APPROVED' ? (p.ptName ?? 'PT') :
          p.ptReviewStatus === 'PT_REJECTED' ? (p.ptName ?? 'PT') : 'AI Engine',
      }));

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
   * GET /plans/pt/pending-review
   * Returns all COMPLETED plans assigned to this PT that are pending review.
   * Requires role=PT.
   */
  async getPTPendingReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId: ptUserId } = req.context;

    try {
      const plans = await prisma.workoutPlan.findMany({
        where: {
          ptUserId,
          status: PlanStatus.COMPLETED,
          ptReviewStatus: 'PENDING_PT_REVIEW',
        },
        orderBy: { updatedAt: 'desc' },
      });
      res.json(formatSuccessResponse({ plans }));
    } catch (err) {
      logger.error({ err, ptUserId }, 'Error fetching PT pending reviews');
      next(err);
    }
  },

  /**
   * POST /plans/:planId/pt-review
   * PT approves or rejects a plan. Action: 'APPROVE' | 'REJECT'. Note: max 1000 chars.
   * Requires role=PT and ownership of the plan.
   */
  async submitPTReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId: ptUserId } = req.context;
    const { planId } = req.params;
    const { action, note } = req.body;

    try {
      if (!['APPROVE', 'REJECT'].includes(action)) {
        res.status(400).json({ error: 'action phải là APPROVE hoặc REJECT' });
        return;
      }

      const trimmedNote = note ? String(note).trim() : null;
      if (trimmedNote && trimmedNote.length > 1000) {
        res.status(400).json({ error: 'note tối đa 1000 ký tự' });
        return;
      }

      const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });

      if (!plan || plan.ptUserId !== ptUserId) {
        res.status(403).json({ error: 'Không có quyền review plan này' });
        return;
      }
      if (plan.status !== PlanStatus.COMPLETED) {
        res.status(409).json({ error: 'Plan chưa hoàn thành generate' });
        return;
      }
      if (plan.ptReviewStatus !== 'PENDING_PT_REVIEW') {
        res.status(409).json({ error: 'Plan này đã được review rồi' });
        return;
      }

      // Fetch PT name from auth-service (fail-safe)
      let ptName: string | null = null;
      try {
        const authRes = await axios.get(
          `${AUTH_SERVICE_URL}/auth/internal/users/${ptUserId}`,
          { headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET }, timeout: 3000 },
        );
        const u = authRes.data?.user ?? authRes.data;
        ptName = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || null;
      } catch {
        // fail-safe: ptName stays null
      }

      const newStatus = action === 'APPROVE' ? 'PT_APPROVED' : 'PT_REJECTED';
      const updated = await prisma.workoutPlan.update({
        where: { id: planId },
        data: {
          ptReviewStatus: newStatus as any,
          ptNote: trimmedNote || null,
          ptName,
          ptReviewedAt: new Date(),
        },
      });
      res.json(formatSuccessResponse({ plan: updated }));
    } catch (err) {
      logger.error({ err, planId, ptUserId }, 'Error submitting PT review');
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

  /**
   * POST /plans/:planId/save-to-workout-log
   * Save a completed AI plan into the authenticated user's workout schedule.
   */
  async savePlanToWorkoutLog(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;
    const { startDate, repeatWeeks } = req.body as SavePlanToWorkoutLogRequest;

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
          formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} — only COMPLETED plans can be saved`),
        );
        return;
      }

      const planContent = plan.plan as unknown as PlanContent;
      if (!Array.isArray(planContent.weeklySchedule) || planContent.weeklySchedule.length === 0) {
        res.status(422).json(
          formatErrorResponse('VALIDATION_ERROR', 'Plan weeklySchedule is empty or invalid'),
        );
        return;
      }

      const fitnessServiceUrl = process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

      const response = await axios.post(
        `${fitnessServiceUrl}/workouts/from-ai-plan`,
        {
          sourcePlanId: plan.id,
          sourcePlanVersion: plan.version,
          sourcePlanName: plan.name,
          goal: plan.goal,
          durationWeeks: plan.duration,
          daysPerWeek: plan.daysPerWeek,
          startDate,
          repeatWeeks: repeatWeeks ?? plan.duration,
          weeklySchedule: planContent.weeklySchedule,
        },
        {
          timeout: 20000,
          headers: {
            'x-user-id': userId,
            'x-user-email': req.headers['x-user-email'] as string | undefined,
            'x-user-role': req.headers['x-user-role'] as string | undefined,
            ...(internalSecret ? { 'x-internal-token': internalSecret } : {}),
          },
        },
      );

      const fitnessPayload = response.data?.success ? response.data.data ?? response.data : response.data;

      res.status(response.status >= 400 ? response.status : response.data?.alreadyExists ? 200 : 201).json(
        formatSuccessResponse({
          sourcePlanId: plan.id,
          createdProgramId: fitnessPayload.createdProgramId,
          createdScheduleCount: fitnessPayload.createdScheduleCount ?? 0,
          skippedDuplicateCount: fitnessPayload.skippedDuplicateCount ?? 0,
          alreadyExists: Boolean(fitnessPayload.alreadyExists),
          message: fitnessPayload.message || 'Đã lưu kế hoạch AI vào lịch tập',
        }),
      );
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status || 500;
        const data = err.response?.data as any;
        res.status(status).json(
          data?.success === false && data?.error
            ? data
            : formatErrorResponse('INTERNAL_ERROR', data?.error || data?.message || 'Failed to save AI plan'),
        );
        return;
      }

      if (err instanceof ApiError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }

      logger.error({ err, planId, userId }, 'Error saving plan to workout log');
      next(err);
    }
  },
};
