import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { llmService } from '../services/llm.service';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import { parsePlanContent, buildPlanPrompt } from '../schemas/plan.schemas';
import { LlmError } from '../errors/api-error';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const aiQueue = new Queue('ai-tasks', { connection: redisConnection });

// ── Job data schema ───────────────────────────────────────────────────────────
const PlanJobDataSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
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
    const { planId, userId, goal, durationWeeks, daysPerWeek, adjustmentContext } =
      dataResult.data as PlanJobData;

    logger.info({ jobId: job.id, planId, userId }, 'Plan generation job started');

    // ── 2. Mark plan as PROCESSING ─────────────────────────────────────────
    await conversationRepository.updatePlanStatus(planId, PlanStatus.PROCESSING);

    // ── 3. Build prompt and call LLM ───────────────────────────────────────
    const prompt = buildPlanPrompt(goal, durationWeeks, daysPerWeek, adjustmentContext);

    let rawAnswer: string;
    try {
      const llmResponse = await llmService.callLLM(prompt);
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
    const parseResult = parsePlanContent(rawAnswer);

    if (!parseResult.ok) {
      const reason = `Plan content invalid: ${parseResult.reason}`;
      logger.error(
        { jobId: job.id, planId, reason, rawSnippet: rawAnswer.slice(0, 500) },
        'Plan generation: structured output validation failed',
      );
      await conversationRepository.updatePlanFailed(planId, reason);
      // Do not re-throw — retrying the same prompt is unlikely to help.
      return;
    }

    // ── 5. Persist structured plan ─────────────────────────────────────────
    await conversationRepository.updatePlanCompletion(planId, parseResult.content);
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
