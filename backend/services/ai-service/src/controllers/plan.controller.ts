import { Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import { logger, aiPlanGenerationsTotal } from '@gym-coach/shared';
import { aiQueue } from '../workers/ai.worker';
import { conversationService } from '../services/conversation.service';
import { conversationRepository, prisma, PlanStatus } from '../repositories/conversation.repository';
import { llmService } from '../services/llm.service';
import { ApiError, formatSuccessResponse, formatErrorResponse } from '../errors/api-error';
import type { GeneratePlanRequest, ExplainPlanRequest, AdjustPlanRequest, SavePlanToWorkoutLogRequest } from '../schemas/plan.schemas';
import type { PlanContent } from '../schemas/plan.schemas';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3004';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

type ExplainSource = 'llm' | 'fallback';

type ExplainPlanResponse = {
  planId: string;
  explanation: string;
  source: ExplainSource;
  warnings: string[];
};

async function ensureLlmAvailable(res: Response): Promise<boolean> {
  const health = await llmService.getHealthStatus();
  if (health.llmAvailable) return true;

  res.status(503).json(formatErrorResponse('LLM_UNAVAILABLE', 'AI model chưa sẵn sàng. Vui lòng bật Ollama hoặc thử lại sau.'));
  return false;
}

function stringifyPlanWarning(warning: unknown): string {
  if (typeof warning === 'string') return warning.trim();
  if (Array.isArray(warning)) return warning.map((item) => stringifyPlanWarning(item)).filter(Boolean).join(', ');
  if (warning && typeof warning === 'object') {
    const record = warning as Record<string, unknown>;
    return Object.entries(record)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' | ');
  }
  return String(warning ?? '').trim();
}

function extractPlanWarnings(planContent: PlanContent): string[] {
  const metadata = (planContent as PlanContent & { _metadata?: unknown })._metadata;
  if (!metadata || typeof metadata !== 'object') return [];
  const warnings = (metadata as Record<string, unknown>).aiWarnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning) => stringifyPlanWarning(warning)).filter(Boolean);
}

function buildFallbackExplanation(plan: PlanContent, language: string): string {
  const schedule = plan.weeklySchedule
    .map((day, index) => {
      const exercises = day.exercises
        .map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`)
        .join(', ');
      return `${index + 1}. ${day.day} (${day.goal}): ${exercises}${day.cardio ? ` | Cardio: ${day.cardio}` : ''}`;
    })
    .join('\n');

  const progression = plan.progressionNotes.length > 0 ? plan.progressionNotes.join(' ') : 'Tăng tải dần theo khả năng hồi phục.';
  const recovery = plan.recoveryNotes.length > 0 ? plan.recoveryNotes.join(' ') : 'Ngủ đủ và ưu tiên phục hồi chủ động.';
  const nutrition = plan.nutritionSummary || 'Chưa có nutrition summary.';

  if (language === 'vi') {
    return [
      `Kế hoạch này hướng tới mục tiêu ${plan.goal} trong ${plan.durationWeeks} tuần, với ${plan.daysPerWeek} buổi mỗi tuần.`,
      '',
      'Lịch tập theo tuần:',
      schedule,
      '',
      `Tiến độ: ${progression}`,
      `Phục hồi: ${recovery}`,
      `Dinh dưỡng: ${nutrition}`,
    ].join('\n');
  }

  return [
    `This plan targets ${plan.goal} over ${plan.durationWeeks} weeks with ${plan.daysPerWeek} training days per week.`,
    '',
    'Weekly schedule:',
    schedule,
    '',
    `Progression: ${progression}`,
    `Recovery: ${recovery}`,
    `Nutrition: ${nutrition}`,
  ].join('\n');
}

async function callExplainLlmWithTimeout(prompt: string, timeoutMs: number) {
  return Promise.race([
    llmService.callLLM(prompt),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error('EXPLAIN_TIMEOUT'));
      }, timeoutMs);
    }),
  ]);
}

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
  async getLlmHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await llmService.getHealthStatus();
      res.status(health.llmAvailable ? 200 : 503).json(formatSuccessResponse(health));
    } catch (err) {
      next(err);
    }
  },

  async generatePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { goal, durationWeeks, daysPerWeek, exercisesPerDay, trainingLocation, equipmentPreference, contractId } = req.body as GeneratePlanRequest & { contractId?: string };

    try {
      if (!(await ensureLlmAvailable(res))) return;

      let ptUserId: string | null = null;
      let clientName: string | null = null;

      // Verify contractId via user-service (fail-closed: contractId sent but invalid â†’ 400)
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
          res.status(400).json({ error: 'contractId khÃ´ng há»£p lá»‡ hoáº·c khÃ´ng cÃ²n ACTIVE' });
          return;
        }
      }

      // Fetch clientName from auth-service (fail-safe â€” empty name is fine)
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
        exercisesPerDay,
        trainingLocation: trainingLocation ?? 'GYM',
        equipmentPreference: equipmentPreference ?? 'MIXED_GYM',
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

  async generateNutritionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    
    try {
      if (!(await ensureLlmAvailable(res))) return;

      const result = await conversationService.queueNutritionPlanGeneration({
        userId,
        ...req.body,
      });
      aiPlanGenerationsTotal.inc({ status: 'queued' });
      // 202 Accepted: the plan is queued, not yet complete.
      res.status(202).json(formatSuccessResponse(result));
    } catch (err) {
      aiPlanGenerationsTotal.inc({ status: 'failure' });
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
    const includeArchived = String(req.query.includeArchived).toLowerCase() === 'true';

    try {
      const rawPlans = includeArchived
        ? await conversationRepository.findPlansByUserIncludingArchived(userId, undefined, 10)
        : await conversationRepository.findPlansByUser(userId, undefined, 10);

      const plans = rawPlans.map((p) => ({
        ...p,
        displayStatus:
          !p.ptUserId ? (p.status === PlanStatus.FAILED ? 'failed' : 'active') :
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
   * GET /plans/nutrition/current
   * Returns the user's most recent nutrition plans (up to 10).
   */
  async getCurrentNutritionPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    
    try {
      const rawPlans = await conversationRepository.findNutritionPlansByUser(userId, undefined, 10);
      res.status(200).json(formatSuccessResponse(rawPlans));
    } catch (err) {
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
      // Check DB first â€” the plan record is created before the job is queued.
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
          formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} â€” only COMPLETED plans can be explained`),
        );
        return;
      }
      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể giải thích'));
        return;
      }

      const planContent = plan.plan as unknown as PlanContent;
      const prompt = buildExplanationPrompt(planContent, lang);
      const warnings = extractPlanWarnings(planContent);

      if (!(await ensureLlmAvailable(res))) return;

      try {
        const llmResponse = await callExplainLlmWithTimeout(prompt, 8000);
        res.json(
          formatSuccessResponse<ExplainPlanResponse>({
            planId,
            explanation: llmResponse.answer,
            source: 'llm',
            warnings,
          }),
        );
        return;
      } catch (err) {
        const explanation = buildFallbackExplanation(planContent, lang);
        const fallbackWarnings = ['Đang dùng giải thích tự động vì AI phản hồi chậm.'].concat(warnings);
        logger.warn({ err, planId, userId }, 'Explain plan fallback used');
        res.json(
          formatSuccessResponse<ExplainPlanResponse>({
            planId,
            explanation,
            source: 'fallback',
            warnings: fallbackWarnings,
          }),
        );
      }
    } catch (err) {
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
        res.status(400).json({ error: 'action pháº£i lÃ  APPROVE hoáº·c REJECT' });
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
    const { planId, adjustments, daysPerWeek, exercisesPerDay } = req.body as AdjustPlanRequest;

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
      if (plan.status === PlanStatus.PROCESSING) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Không thể điều chỉnh kế hoạch đang xử lý'));
        return;
      }
      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể điều chỉnh'));
        return;
      }

      if (!(await ensureLlmAvailable(res))) return;

      const result = await conversationService.queuePlanAdjustment({
        originalPlanId: planId,
        userId,
        adjustments,
        daysPerWeek,
        exercisesPerDay,
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
   * DELETE /plans/:planId
   * Soft-archive a plan without deleting workout history.
   */
  async archivePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      if (plan.status === PlanStatus.PROCESSING) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Không thể xoá kế hoạch đang xử lý'));
        return;
      }
      if ((plan as any).archivedAt) {
        res.json(formatSuccessResponse({ planId, archived: true, archivedAt: (plan as any).archivedAt }));
        return;
      }

      const archivedPlan = await conversationRepository.archivePlan(planId);
      res.json(
        formatSuccessResponse({
          planId,
          archived: true,
          archivedAt: (archivedPlan as any).archivedAt,
        }),
      );
    } catch (err) {
      logger.error({ err, planId, userId }, 'Error archiving plan');
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
    const { startDate, repeatWeeks, selectedWeekdays, replaceExisting } = req.body as SavePlanToWorkoutLogRequest;

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
          formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} â€” only COMPLETED plans can be saved`),
        );
        return;
      }

      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể lưu vào lịch tập'));
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
          selectedWeekdays,
          weeklySchedule: planContent.weeklySchedule,
          replaceExisting: replaceExisting !== false, // default true
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

      res.status(response.status >= 400 ? response.status : fitnessPayload.alreadyExists ? 200 : 201).json(
        formatSuccessResponse({
          sourcePlanId: plan.id,
          createdProgramId: fitnessPayload.createdProgramId,
          createdScheduleCount: fitnessPayload.createdScheduleCount ?? 0,
          cancelledScheduleCount: fitnessPayload.cancelledScheduleCount,
          skippedDuplicateCount: fitnessPayload.skippedDuplicateCount ?? 0,
          alreadyExists: Boolean(fitnessPayload.alreadyExists),
          selectedWeekdays: fitnessPayload.selectedWeekdays,
          schedulePreview: fitnessPayload.schedulePreview,
          message: fitnessPayload.message || 'AI plan imported to workout schedule',
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

  /**
   * POST /plans/nutrition/:planId/explain
   * Generate a natural-language explanation for a completed nutrition plan.
   */
  async explainNutritionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;

    try {
      const plan = await conversationRepository.findNutritionPlanById(planId);
      if (!plan) {
        res.status(404).json(formatErrorResponse('PLAN_NOT_FOUND', `Plan ${planId} not found`));
        return;
      }
      if (plan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this plan'));
        return;
      }
      if (plan.status !== PlanStatus.COMPLETED) {
        res.status(409).json(formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} — only COMPLETED plans can be explained`));
        return;
      }
      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể giải thích'));
        return;
      }

      const planContent = plan.plan as any;
      const schedule = (planContent.weeklySchedule || []).slice(0, 7).map((day: any, idx: number) => {
        const meals = (day.meals || []).map((m: any) =>
          `${m.mealType || m.title}: ${(m.items || []).map((item: any) => `${item.name} ${item.quantity}${item.unit || 'g'}`).join(', ')}`
        ).join(' | ');
        return `Ngày ${day.dayNumber || idx + 1} (${day.totalCalories || 0}kcal): ${meals}`;
      }).join('\n');

      const nutritionPrompt = `Bạn là chuyên gia dinh dưỡng. Hãy giải thích kế hoạch dinh dưỡng sau bằng tiếng Việt:

Mục tiêu: ${plan.goal}
Thời lượng: ${plan.durationWeeks} tuần, ${plan.mealsPerDay} bữa/ngày
Calories mục tiêu: ${planContent.dailyCaloriesTarget || 'N/A'} kcal/ngày
Protein: ${planContent.proteinTargetGrams || 0}g | Carbs: ${planContent.carbTargetGrams || 0}g | Fat: ${planContent.fatTargetGrams || 0}g

Thực đơn 7 ngày:
${schedule}

Hãy giải thích:
1. Vì sao lượng calories và macro này phù hợp với mục tiêu ${plan.goal}
2. Nguyên tắc chọn thực phẩm trong kế hoạch
3. Cách áp dụng thực đơn 7 ngày này
4. Lưu ý dinh dưỡng quan trọng
5. Cách thay thế món nếu không hợp khẩu vị`;

      let explanation = '';
      let source: 'llm' | 'fallback' = 'llm';

      try {
        const health = await llmService.getHealthStatus();
        if (!health.llmAvailable) throw new Error('LLM not available');
        const llmResp = await callExplainLlmWithTimeout(nutritionPrompt, 30000);
        explanation = (llmResp as any).answer || String(llmResp);
      } catch (err) {
        source = 'fallback';
        explanation = [
          `Kế hoạch dinh dưỡng này được thiết kế cho mục tiêu **${plan.goal}** trong ${plan.durationWeeks} tuần.`,
          `Mức calories ${planContent.dailyCaloriesTarget || 2000} kcal/ngày được cân bằng với Protein ${planContent.proteinTargetGrams || 0}g, Carbs ${planContent.carbTargetGrams || 0}g, Fat ${planContent.fatTargetGrams || 0}g.`,
          `Thực đơn 7 ngày luân phiên giúp đảm bảo đa dạng dinh dưỡng và không bị nhàm chán.`,
          `Bạn có thể thay thế các món không hợp khẩu vị bằng các thực phẩm tương đương về calories và macros.`,
          `Uống đủ 2-3 lít nước mỗi ngày và ăn đúng giờ để tối ưu hiệu quả.`,
        ].join('\n\n');
      }

      res.json(formatSuccessResponse({ planId, explanation, source }));
    } catch (err) {
      logger.error({ err, planId, userId }, 'Error explaining nutrition plan');
      next(err);
    }
  },

  /**
   * POST /plans/nutrition/:planId/adjust
   * Queue an adjusted version of a nutrition plan.
   */
  async adjustNutritionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;
    const { adjustments, mealsPerDay } = req.body as { adjustments: string; mealsPerDay?: number };

    if (!adjustments || adjustments.trim().length < 5) {
      res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'adjustments phải có ít nhất 5 ký tự'));
      return;
    }

    try {
      const plan = await conversationRepository.findNutritionPlanById(planId);
      if (!plan) {
        res.status(404).json(formatErrorResponse('PLAN_NOT_FOUND', `Plan ${planId} not found`));
        return;
      }
      if (plan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this plan'));
        return;
      }
      if (plan.status !== PlanStatus.COMPLETED) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Chỉ có thể điều chỉnh kế hoạch đã hoàn thành'));
        return;
      }
      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể điều chỉnh'));
        return;
      }

      if (!(await ensureLlmAvailable(res))) return;

      const result = await conversationService.queueNutritionPlanGeneration({
        userId,
        goal: plan.goal || 'General Health',
        durationWeeks: 1,
        mealsPerDay: mealsPerDay || plan.mealsPerDay || 3,
        notes: `Điều chỉnh từ kế hoạch trước: ${adjustments}`,
      });

      aiPlanGenerationsTotal.inc({ status: 'queued' });
      res.status(202).json(formatSuccessResponse(result));
    } catch (err) {
      logger.error({ err, planId, userId }, 'Error adjusting nutrition plan');
      next(err);
    }
  },

  /**
   * DELETE /plans/nutrition/:planId
   * Soft-archive a nutrition plan.
   */
  async archiveNutritionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;

    try {
      const plan = await conversationRepository.findNutritionPlanById(planId);
      if (!plan) {
        res.status(404).json(formatErrorResponse('PLAN_NOT_FOUND', `Plan ${planId} not found`));
        return;
      }
      if (plan.userId !== userId) {
        res.status(403).json(formatErrorResponse('FORBIDDEN', 'You do not have access to this plan'));
        return;
      }
      if (plan.status === PlanStatus.PROCESSING) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Không thể ẩn kế hoạch đang xử lý'));
        return;
      }
      if ((plan as any).archivedAt) {
        res.json(formatSuccessResponse({ planId, archived: true, archivedAt: (plan as any).archivedAt }));
        return;
      }

      const archived = await conversationRepository.archiveNutritionPlan(planId);
      res.json(formatSuccessResponse({ planId, archived: true, archivedAt: (archived as any).archivedAt }));
    } catch (err) {
      logger.error({ err, planId, userId }, 'Error archiving nutrition plan');
      next(err);
    }
  },

  /**
   * POST /plans/:planId/save-to-nutrition
   * Save a completed AI plan into the authenticated user's nutrition schedule.
   */
  async saveNutritionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { planId } = req.params;
    const { startDate, endDate, repeatEnabled, forceArchive } = req.body;

    try {
      const plan = await conversationRepository.findNutritionPlanById(planId);
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
          formatErrorResponse('PLAN_NOT_COMPLETED', `Plan is ${plan.status} â€” only COMPLETED plans can be saved`),
        );
        return;
      }

      if ((plan as any).archivedAt) {
        res.status(409).json(formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch này đã được ẩn và không thể lưu vào lịch dinh dưỡng'));
        return;
      }

      const planContent = plan.plan as unknown as any;
      if (!Array.isArray(planContent.weeklySchedule) || planContent.weeklySchedule.length === 0) {
        res.status(422).json(
          formatErrorResponse('VALIDATION_ERROR', 'Plan weeklySchedule is empty or invalid'),
        );
        return;
      }
      if (plan.durationWeeks !== 1 || planContent.durationWeeks !== 1 || planContent.weeklySchedule.length !== 7) {
        res.status(400).json(
          formatErrorResponse('VALIDATION_ERROR', 'Kế hoạch dinh dưỡng AI hiện chỉ hỗ trợ tối đa 1 tuần.'),
        );
        return;
      }

      const fitnessServiceUrl = process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
      const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

      const response = await axios.post(
        `${fitnessServiceUrl}/nutrition/from-ai-plan`,
        {
          sourcePlanId: plan.id,
          sourcePlanName: plan.name,
          goal: plan.goal,
          durationWeeks: plan.durationWeeks,
          mealsPerDay: plan.mealsPerDay,
          startDate,
          endDate,
          repeatEnabled: repeatEnabled ?? false,
          forceArchive,
          weeklySchedule: planContent.weeklySchedule,
          dailyCaloriesTarget: planContent.dailyCaloriesTarget,
          proteinTargetGrams: planContent.proteinTargetGrams,
          carbTargetGrams: planContent.carbTargetGrams,
          fatTargetGrams: planContent.fatTargetGrams,
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

      res.status(response.status >= 400 ? response.status : fitnessPayload.alreadyExists ? 200 : 201).json(
        formatSuccessResponse({
          sourcePlanId: plan.id,
          createdNutritionPlanId: fitnessPayload.createdNutritionPlanId ?? fitnessPayload.createdProgramId,
          createdProgramId: fitnessPayload.createdProgramId,
          existingNutritionPlanId: fitnessPayload.existingNutritionPlanId,
          createdDayCount: fitnessPayload.createdDayCount,
          createdMealCount: fitnessPayload.createdMealCount,
          createdItemCount: fitnessPayload.createdItemCount,
          alreadyExists: Boolean(fitnessPayload.alreadyExists),
          message: fitnessPayload.message || 'Đã lưu kế hoạch AI vào lịch dinh dưỡng',
        }),
      );
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status || 500;
        const data = err.response?.data as any;
        res.status(status).json(
          data?.success === false && data?.error
            ? data
            : formatErrorResponse('INTERNAL_ERROR', data?.error || data?.message || 'Failed to save AI nutrition plan'),
        );
        return;
      }
      logger.error({ err, planId, userId }, 'Error saving nutrition plan to fitness-service');
      next(err);
    }
  },
};

