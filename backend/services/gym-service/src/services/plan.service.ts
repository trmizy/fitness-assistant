import { gymService } from './gym.service';
import { planRepository } from '../repositories/plan.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export const planService = {
  async listActiveByGym(gymId: string) {
    return planRepository.findActiveByGym(gymId);
  },

  async createPlan(gymId: string, ownerId: string, data: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number }) {
    await gymService.getOwnedGym(gymId, ownerId);
    return planRepository.create({
      gym: { connect: { id: gymId } },
      name: data.name,
      description: data.description,
      price: data.price,
      durationDays: data.durationDays,
      visitLimit: data.visitLimit,
    });
  },

  async listOwnedPlans(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return planRepository.findAllByGym(gymId);
  },

  async updatePlan(gymId: string, planId: string, ownerId: string, data: Partial<{ name: string; description: string; price: number; durationDays: number; visitLimit: number; status: 'ACTIVE' | 'INACTIVE' }>) {
    await gymService.getOwnedGym(gymId, ownerId);
    const plan = await planRepository.findById(planId);
    if (!plan || plan.gymId !== gymId) throw err('Plan not found', 404);
    return planRepository.update(planId, data);
  },
};
