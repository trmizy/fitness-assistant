import { gymService } from './gym.service';
import { planRepository } from '../repositories/plan.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function assertSaleWindowValid(saleStartAt?: Date | null, saleEndAt?: Date | null) {
  if (saleStartAt && saleEndAt && saleStartAt > saleEndAt) {
    throw err('saleStartAt must be before saleEndAt', 400);
  }
}

/** Single source of truth for "can this plan be bought right now" — the public listing
 * filters on the same rule at the DB level (plan.repository.ts); this is for the one-record
 * check at purchase time, where a plan the client already has open in a tab must be
 * re-validated rather than trusted. */
export function isPlanOnSale(plan: { saleStartAt: Date | null; saleEndAt: Date | null }, now = new Date()): boolean {
  if (plan.saleStartAt && now < plan.saleStartAt) return false;
  if (plan.saleEndAt && now > plan.saleEndAt) return false;
  return true;
}

export const planService = {
  async listActiveByGym(gymId: string) {
    return planRepository.findActiveByGym(gymId);
  },

  async createPlan(
    gymId: string,
    ownerId: string,
    data: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number; saleStartAt?: string; saleEndAt?: string },
  ) {
    await gymService.getOwnedGym(gymId, ownerId);
    const saleStartAt = data.saleStartAt ? new Date(data.saleStartAt) : null;
    const saleEndAt = data.saleEndAt ? new Date(data.saleEndAt) : null;
    assertSaleWindowValid(saleStartAt, saleEndAt);
    return planRepository.create({
      gym: { connect: { id: gymId } },
      name: data.name,
      description: data.description,
      price: data.price,
      durationDays: data.durationDays,
      visitLimit: data.visitLimit,
      saleStartAt,
      saleEndAt,
    });
  },

  async listOwnedPlans(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return planRepository.findAllByGym(gymId);
  },

  async updatePlan(
    gymId: string,
    planId: string,
    ownerId: string,
    data: Partial<{ name: string; description: string; price: number; durationDays: number; visitLimit: number; status: 'ACTIVE' | 'INACTIVE'; saleStartAt: string | null; saleEndAt: string | null }>,
  ) {
    await gymService.getOwnedGym(gymId, ownerId);
    const plan = await planRepository.findById(planId);
    if (!plan || plan.gymId !== gymId) throw err('Plan not found', 404);

    const saleStartAt = data.saleStartAt !== undefined ? (data.saleStartAt ? new Date(data.saleStartAt) : null) : plan.saleStartAt;
    const saleEndAt = data.saleEndAt !== undefined ? (data.saleEndAt ? new Date(data.saleEndAt) : null) : plan.saleEndAt;
    assertSaleWindowValid(saleStartAt, saleEndAt);

    return planRepository.update(planId, {
      ...data,
      saleStartAt,
      saleEndAt,
    });
  },
};
