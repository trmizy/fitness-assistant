import { logger } from '@gym-coach/shared';
import { exerciseRepository } from '../repositories/exercise.repository';

export const exerciseService = {
  async listExercises(filters: {
    bodyPart?: string;
    typeOfActivity?: string;
    typeOfEquipment?: string;
    search?: string;
  }) {
    const where: any = {};
    if (filters.bodyPart) where.bodyPart = filters.bodyPart;
    if (filters.typeOfActivity) where.typeOfActivity = filters.typeOfActivity;
    if (filters.typeOfEquipment) where.typeOfEquipment = filters.typeOfEquipment;
    if (filters.search) {
      where.OR = [
        { exerciseName: { contains: filters.search, mode: 'insensitive' } },
        { instructions: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const result = await exerciseRepository.findMany(where);
    if (result.fromCache) logger.info('Cache hit for exercises');
    return result.data;
  },

  async getExercise(id: string) {
    const exercise = await exerciseRepository.findById(id);
    if (!exercise) throw { status: 404, message: 'Exercise not found' };
    return exercise;
  },
};
