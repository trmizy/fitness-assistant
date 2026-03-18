import { profileRepository } from '../repositories/profile.repository';
import type { ProfileDto } from '../models/profile.models';

/**
 * TODO (Phase 2): Replace with real checks — e.g. certificate uploaded,
 * admin approval, ptApplicationStatus === 'APPROVED', etc.
 */
async function canBecomePT(_userId: string): Promise<boolean> {
  return true;
}

export const profileService = {
  async getProfile(userId: string) {
    const profile = await profileRepository.findByUserId(userId);
    return { profile: profile ?? null };
  },

  async upsertProfile(userId: string, data: ProfileDto) {
    const profile = await profileRepository.upsert(userId, data);
    return { profile };
  },

  async becomePT(userId: string) {
    const allowed = await canBecomePT(userId);
    if (!allowed) {
      throw new Error('PT application not allowed at this time');
    }
    const profile = await profileRepository.setIsPT(userId, true);
    return { profile };
  },

  async deleteProfile(userId: string) {
    await profileRepository.deleteByUserId(userId);
    return { message: 'Profile deleted successfully' };
  },
};
