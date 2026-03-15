import { Queue } from 'bullmq';
import { workoutRepository } from '../repositories/workout.repository';
import type { CreateWorkoutDto } from '../models/fitness.models';

export const workoutQueue = new Queue('workout-generation', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

export const workoutService = {
  async listWorkouts(
    userId: string,
    filters: { startDate?: string; endDate?: string; limit?: string },
  ) {
    const where: any = { userId };
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    return workoutRepository.findMany(where, filters.limit ? parseInt(filters.limit) : 50);
  },

  async getWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: 'Workout not found' };
    return workout;
  },

  async createWorkout(userId: string, data: CreateWorkoutDto) {
    return workoutRepository.create(userId, data);
  },

  async updateWorkout(id: string, userId: string, data: CreateWorkoutDto) {
    const existing = await workoutRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: 'Workout not found' };
    return workoutRepository.update(id, data);
  },

  async deleteWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: 'Workout not found' };
    await workoutRepository.delete(id);
    return { message: 'Workout deleted' };
  },

  async queueWorkoutGeneration(userId: string, params: any) {
    const job = await workoutQueue.add('generate-workout', { userId, ...params });
    return { message: 'Workout generation started', jobId: job.id };
  },
};
