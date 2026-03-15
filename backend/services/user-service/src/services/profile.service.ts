import { profileRepository } from '../repositories/profile.repository';
import type { ProfileDto } from '../models/profile.models';

export const profileService = {
  async getProfile(userId: string) {
    const profile = await profileRepository.findByUserId(userId);
    return { profile: profile ?? null };
  },

  async upsertProfile(userId: string, data: ProfileDto) {
    const profile = await profileRepository.upsert(userId, data);
    return { profile };
  },

  async deleteProfile(userId: string) {
    await profileRepository.deleteByUserId(userId);
    return { message: 'Profile deleted successfully' };
  },
};
