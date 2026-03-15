import { Queue, Worker } from 'bullmq';
import { logger } from '@gym-coach/shared';
import { llmService } from '../services/llm.service';
import { conversationRepository } from '../repositories/conversation.repository';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const aiQueue = new Queue('ai-tasks', { connection: redisConnection });

export const aiWorker = new Worker(
  'ai-tasks',
  async (job) => {
    logger.info(`Processing AI job ${job.id}`);
    const { userId, goal, durationWeeks, daysPerWeek } = job.data;

    const prompt = `
Generate a comprehensive ${durationWeeks}-week workout plan for:
- Goal: ${goal}
- Days per week: ${daysPerWeek}

Return a detailed weekly schedule as JSON.
`.trim();

    const llmResponse = await llmService.callLLM(prompt);

    await conversationRepository.createWorkoutPlan({
      userId,
      name: `${goal} Plan`,
      description: `${durationWeeks}-week ${goal} program`,
      goal,
      duration: durationWeeks,
      daysPerWeek,
      plan: { content: llmResponse.answer },
    });

    logger.info(`Workout plan generation completed for job ${job.id}`);
  },
  { connection: redisConnection },
);

aiWorker.on('failed', (job, err) => {
  logger.error(`AI job ${job?.id} failed:`, err);
});
