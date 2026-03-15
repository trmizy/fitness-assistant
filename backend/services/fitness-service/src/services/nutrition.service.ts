import { nutritionRepository } from '../repositories/nutrition.repository';
import type { CreateNutritionDto } from '../models/fitness.models';

export const nutritionService = {
  async listLogs(
    userId: string,
    filters: { startDate?: string; endDate?: string; mealType?: string },
  ) {
    const where: any = { userId };
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    if (filters.mealType) where.mealType = filters.mealType;
    return nutritionRepository.findMany(where);
  },

  async createLog(userId: string, data: CreateNutritionDto) {
    return nutritionRepository.create(userId, data);
  },

  async deleteLog(id: string, userId: string) {
    const log = await nutritionRepository.findOne(id, userId);
    if (!log) throw { status: 404, message: 'Nutrition log not found' };
    await nutritionRepository.delete(id);
    return { message: 'Nutrition log deleted' };
  },
};
