import { gymRepository } from '../repositories/gym.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export const gymService = {
  async listApproved() {
    return gymRepository.findApproved();
  },

  async getApprovedById(id: string) {
    const gym = await gymRepository.findApprovedById(id);
    if (!gym) throw err('Gym not found', 404);
    return gym;
  },

  async createGym(ownerId: string, data: { name: string; description?: string; address: string; city?: string; phone?: string; email?: string }) {
    return gymRepository.create({
      ownerId,
      name: data.name,
      description: data.description,
      address: data.address,
      city: data.city,
      phone: data.phone,
      email: data.email,
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
