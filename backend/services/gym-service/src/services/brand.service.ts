import { logger } from '@gym-coach/shared';
import { brandRepository } from '../repositories/brand.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export const brandService = {
  /**
   * Vòng 4 / Phase C1 — a brand-new brand's name is not yet publicly shown anywhere (it has
   * zero approved branches, so it can't appear on the public listing regardless), but it still
   * starts life as "pending" rather than "approved" for consistency: `approvedName` is only
   * ever set by an actual approval (the brand's first branch being approved, or the dedicated
   * rename-approval action), never implicitly at creation time.
   */
  async createBrand(ownerId: string, data: { name: string; description?: string }) {
    if (!data.name?.trim()) throw err('Brand name is required', 400);
    const name = data.name.trim();
    return brandRepository.create({
      ownerId,
      name,
      pendingName: name,
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

  /**
   * Vòng 4 / Phase C1 — a rename never touches `approvedName` directly. It only ever moves
   * `pendingName` (and the freely-editable `name`/`description`), so whatever is already
   * publicly shown keeps showing until an admin explicitly approves the new name via
   * approveRename below.
   */
  async updateBrand(brandId: string, ownerId: string, data: Partial<{ name: string; description: string }>) {
    await this.getOwnedBrand(brandId, ownerId);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) {
      patch.name = data.name;
      patch.pendingName = data.name;
    }
    if (data.description !== undefined) patch.description = data.description;
    return brandRepository.update(brandId, patch);
  },

  /**
   * Vòng 4 / Phase C1 — the dedicated "Duyệt đổi tên thương hiệu" admin action. Distinct from
   * a brand's first-ever approval (which piggybacks on gymService.setStatus approving the
   * brand's first branch — see that function's own doc comment) because a later rename has no
   * accompanying branch approval to ride along with.
   */
  async approveRename(brandId: string, adminId: string) {
    const brand = await brandRepository.findById(brandId);
    if (!brand) throw err('Brand not found', 404);
    if (!brand.pendingName) throw err('Thương hiệu này không có tên nào đang chờ duyệt', 409);
    logger.info(`[Brand] Admin ${adminId} approved rename for ${brandId}: "${brand.approvedName ?? brand.name}" -> "${brand.pendingName}"`);
    return brandRepository.update(brandId, { approvedName: brand.pendingName, pendingName: null });
  },

  /** Vòng 4 / Phase C — admin's brand-moderation list. */
  async listAllForAdmin() {
    return brandRepository.findAllForAdmin();
  },
};
