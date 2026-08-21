import { brandRepository } from '../repositories/brand.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export const brandService = {
  async createBrand(ownerId: string, data: { name: string; description?: string }) {
    if (!data.name?.trim()) throw err('Brand name is required', 400);
    return brandRepository.create({
      ownerId,
      name: data.name.trim(),
      description: data.description,
    });
  },

  async listOwned(ownerId: string) {
    return brandRepository.findByOwner(ownerId);
  },

  /** Ownership check other services reuse before letting a gym join this brand. */
  async getOwnedBrand(brandId: string, ownerId: string) {
    const brand = await brandRepository.findById(brandId);
    if (!brand) throw err('Brand not found', 404);
    if (brand.ownerId !== ownerId) throw err('Not authorized — you do not own this brand', 403);
    return brand;
  },

  async getOwnedBrandWithBranches(brandId: string, ownerId: string) {
    await this.getOwnedBrand(brandId, ownerId);
    return brandRepository.findByIdWithBranches(brandId);
  },

  async updateBrand(brandId: string, ownerId: string, data: Partial<{ name: string; description: string }>) {
    await this.getOwnedBrand(brandId, ownerId);
    return brandRepository.update(brandId, data);
  },
};
