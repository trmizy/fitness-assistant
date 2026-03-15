import { Worker } from 'bullmq';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { workoutRepository } from '../repositories/workout.repository';

export const workoutWorker = new Worker(
  'workout-generation',
  async (job) => {
    logger.info(`Processing workout generation job ${job.id}`);
    const { userId, goal, duration, equipment, bodyParts } = job.data;

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:3003';
    const response = await axios.post(`${aiServiceUrl}/ai/generate-workout`, {
      goal,
      duration,
      equipment,
      bodyParts,
    });

    const generatedWorkout = response.data;

    await workoutRepository.create(userId, {
      name: generatedWorkout.name || 'AI Generated Workout',
      description: generatedWorkout.description,
      duration: generatedWorkout.duration,
      exercises: generatedWorkout.exercises,
    });

    logger.info(`Workout generation completed for job ${job.id}`);
  },
  {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  },
);

workoutWorker.on('failed', (job, err) => {
  logger.error(`Workout generation job ${job?.id} failed:`, err);
});
