import axios from 'axios';
import { profileRepository } from '../repositories/profile.repository';
import type { ProfileDto } from '../models/profile.models';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

async function syncRoleToPT(userId: string): Promise<void> {
  await axios.patch(
    `${AUTH_SERVICE_URL}/auth/internal/users/${userId}/role`,
    { role: 'PT' },
    {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 5000,
    },
  );
}

async function syncRole(userId: string, role: 'PT' | 'CUSTOMER'): Promise<void> {
  await axios.patch(
    `${AUTH_SERVICE_URL}/auth/internal/users/${userId}/role`,
    { role },
    {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 5000,
    },
  );
}

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

  async becomePT(userId: string, currentRole: string) {
    if (currentRole === 'PT') {
      throw new Error('User is already a PT');
    }
    if (currentRole !== 'CUSTOMER' && currentRole !== 'ADMIN') {
      throw new Error('Current role is not allowed to become PT');
    }

    const allowed = await canBecomePT(userId);
    if (!allowed) {
      throw new Error('PT application not allowed at this time');
    }

    await syncRoleToPT(userId);
    const profile = await profileRepository.setIsPT(userId, true);
    return { profile };
  },

  async deleteProfile(userId: string) {
    await profileRepository.deleteByUserId(userId);
    return { message: 'Profile deleted successfully' };
  },

  async adminSetPTStatus(userId: string, isPT: boolean) {
    const targetRole: 'PT' | 'CUSTOMER' = isPT ? 'PT' : 'CUSTOMER';
    await syncRole(userId, targetRole);
    const profile = await profileRepository.setIsPTByUserId(userId, isPT);
    return { profile };
  },
};
