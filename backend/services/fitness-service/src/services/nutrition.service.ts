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
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setUTCHours(23, 59, 59, 999);
        where.date.lte = end;
      }
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

  // PATCH /nutrition/:id — owner-only partial update of a snapshot row.
  // NutritionLog stores macros directly (not auto-computed from Food), so we accept
  // edits on the snapshot fields consistent with create. We do NOT recompute macros.
  async updateLog(id: string, userId: string, data: any) {
    const existing = await nutritionRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: 'Nutrition log not found' };
    return nutritionRepository.update(id, data);
  },

  async getGoal(userId: string) {
    const goal = await nutritionRepository.findGoalByUserId(userId);
    return goal ?? DEFAULT_NUTRITION_GOAL;
  },

  async upsertGoal(userId: string, data: UpsertNutritionGoalDto) {
    return nutritionRepository.upsertGoal(userId, data);
  },
};
