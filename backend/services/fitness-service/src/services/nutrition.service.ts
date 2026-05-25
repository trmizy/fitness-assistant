import { nutritionRepository } from '../repositories/nutrition.repository';
import type { CreateNutritionDto } from '../models/fitness.models';
import type { UpsertNutritionGoalDto } from '../models/fitness.models';

const DEFAULT_NUTRITION_GOAL = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  waterMl: null as number | null,
};

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

  async getGoal(userId: string) {
    const goal = await nutritionRepository.findGoalByUserId(userId);
    return goal ?? DEFAULT_NUTRITION_GOAL;
  },

  async upsertGoal(userId: string, data: UpsertNutritionGoalDto) {
    return nutritionRepository.upsertGoal(userId, data);
  },
};
