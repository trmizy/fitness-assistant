import { gymRepository } from '../repositories/gym.repository';
import { reviewRepository } from '../repositories/review.repository';
import { brandService } from './brand.service';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const gymService = {
  async listApproved() {
    const gyms = await gymRepository.findApproved();
    const ratings = await reviewRepository.aggregateForGyms(gyms.map((g) => g.id));
    return gyms.map((g) => {
      const r = ratings.get(g.id);
      return { ...g, averageRating: round2(r?.averageRating ?? 0), reviewCount: r?.count ?? 0 };
    });
  },

  async getApprovedById(id: string) {
    const gym = await gymRepository.findApprovedById(id);
    if (!gym) throw err('Gym not found', 404);
    const r = await reviewRepository.aggregateForGym(id);
    return { ...gym, averageRating: round2(r.averageRating), reviewCount: r.count };
  },

  async createGym(ownerId: string, data: { name: string; description?: string; address: string; city?: string; phone?: string; email?: string; brandId?: string }) {
    // A branch must join a brand the same owner actually created — otherwise anyone could
    // attach their gym to someone else's chain by guessing a brandId.
    if (data.brandId) await brandService.getOwnedBrand(data.brandId, ownerId);
    return gymRepository.create({
      ownerId,
      name: data.name,
      description: data.description,
      address: data.address,
      city: data.city,
      phone: data.phone,
      email: data.email,
      ...(data.brandId ? { brand: { connect: { id: data.brandId } } } : {}),
    });
  },

  async getOwnedGym(gymId: string, ownerId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    if (gym.ownerId !== ownerId) throw err('Not authorized — you do not own this gym', 403);
    return gym;
  },

  async listOwned(ownerId: string) {
    return gymRepository.findByOwner(ownerId);
  },

  async updateOwnedGym(gymId: string, ownerId: string, data: Partial<{ name: string; description: string; address: string; city: string; phone: string; email: string }>) {
    await this.getOwnedGym(gymId, ownerId);
    return gymRepository.update(gymId, data);
  },

  async setStatus(gymId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    return gymRepository.updateStatus(gymId, status);
  },
};
