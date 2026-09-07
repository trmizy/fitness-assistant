import { brandService } from './brand.service';
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

/**
 * One owner, one brand — a plan is sold by the brand, not any one branch (see
 * GymMembershipPlan's own schema doc comment). Ownership here is always checked through
 * brandService.getOwnedBrand, never a specific gym.
 */
export const planService = {
  async listActiveByBrand(brandId: string) {
    return planRepository.findActiveByBrand(brandId);
  },

  async createPlan(
    brandId: string,
    ownerId: string,
    data: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number; saleStartAt?: string; saleEndAt?: string },
  ) {
    await brandService.getOwnedBrand(brandId, ownerId);
    const saleStartAt = data.saleStartAt ? new Date(data.saleStartAt) : null;
    const saleEndAt = data.saleEndAt ? new Date(data.saleEndAt) : null;
    assertSaleWindowValid(saleStartAt, saleEndAt);
    return planRepository.create({
      brand: { connect: { id: brandId } },
      name: data.name,
      description: data.description,
      price: data.price,
      durationDays: data.durationDays,
      visitLimit: data.visitLimit,
      saleStartAt,
      saleEndAt,
    });
  },

  async listOwnedPlans(brandId: string, ownerId: string) {
    await brandService.getOwnedBrand(brandId, ownerId);
    return planRepository.findAllByBrand(brandId);
  },

  async updatePlan(
    brandId: string,
    planId: string,
    ownerId: string,
    data: Partial<{ name: string; description: string; price: number; durationDays: number; visitLimit: number; status: 'ACTIVE' | 'INACTIVE'; saleStartAt: string | null; saleEndAt: string | null }>,
  ) {
    await brandService.getOwnedBrand(brandId, ownerId);
    const plan = await planRepository.findById(planId);
    if (!plan || plan.brandId !== brandId) throw err('Plan not found', 404);

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
