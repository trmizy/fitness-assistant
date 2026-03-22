import axios from 'axios';
import { ptApplicationRepository } from '../repositories/pt_application.repository';
import { profileRepository } from '../repositories/profile.repository';
import { PTApplicationStatus } from '../generated/prisma';
// import { logger } from '@gym-coach/shared';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

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

export const ptApplicationService = {
  async getMe(userId: string) {
    return ptApplicationRepository.findByUserId(userId);
  },

  async saveDraft(userId: string, data: any) {
    const profile = await profileRepository.findByUserId(userId);
    if (!profile) throw new Error('User profile not found');
    
    // Check if user is already PT
    if (profile.isPT) throw new Error('User is already a Personal Trainer');

    // Check if there is already a non-DRAFT/NEEDS_MORE_INFO application
    const existing = await ptApplicationRepository.findByUserId(userId);
    if (existing && !['DRAFT', 'NEEDS_MORE_INFO'].includes(existing.status)) {
      throw new Error(`Cannot save draft while application is in ${existing.status} status`);
    }

    return ptApplicationRepository.upsertDraft(profile.id, data);
  },

  async submit(userId: string) {
    const app = await ptApplicationRepository.findByUserId(userId);
    if (!app) throw new Error('No application found to submit');
    if (!['DRAFT', 'NEEDS_MORE_INFO'].includes(app.status)) {
      throw new Error('Application is already submitted or processed');
    }

    // Basic validation before submission
    const requiredFields = [
      'phoneNumber', 'nationalIdNumber', 'currentAddress', 
      'idCardFrontUrl', 'idCardBackUrl', 'portraitPhotoUrl',
      'yearsOfExperience', 'serviceMode', 'desiredSessionPrice'
    ];
    
    for (const field of requiredFields) {
      if (!(app as any)[field]) {
        throw new Error(`Missing required field for submission: ${field}`);
      }
    }

    if (app.mainSpecialties.length === 0) {
      throw new Error('At least one specialty is required');
    }

    return ptApplicationRepository.updateStatus(app.id, PTApplicationStatus.SUBMITTED, {
      submittedAt: new Date(),
    });
  },

  async adminReviewAction(id: string, action: 'UNDER_REVIEW' | 'NEEDS_MORE_INFO' | 'APPROVED' | 'REJECTED', payload: any) {
    const app = await ptApplicationRepository.findById(id);
    if (!app) throw new Error('Application not found');

    const statusMap: Record<string, PTApplicationStatus> = {
      UNDER_REVIEW: PTApplicationStatus.UNDER_REVIEW,
      NEEDS_MORE_INFO: PTApplicationStatus.NEEDS_MORE_INFO,
      APPROVED: PTApplicationStatus.APPROVED,
      REJECTED: PTApplicationStatus.REJECTED,
    };

    const status = statusMap[action];
    const extra: any = { reviewedAt: new Date() };

    if (action === 'REJECTED') {
      if (!payload.rejectionReason) throw new Error('Rejection reason is required');
      extra.rejectionReason = payload.rejectionReason;
    }

    if (action === 'NEEDS_MORE_INFO') {
      if (!payload.adminNote) throw new Error('Admin feedback is required for NEEDS_MORE_INFO');
      extra.adminNote = payload.adminNote;
    }

    if (action === 'APPROVED') {
      extra.approvedAt = new Date();
      
      // Perform role sync and profile update
      await syncRoleToPT(app.userProfile.userId);
      await profileRepository.setIsPT(app.userProfile.userId, true);
    }

    return ptApplicationRepository.updateStatus(id, status, extra);
  },

  async listApplications(filters: any) {
    return ptApplicationRepository.findAll(filters);
  },

  async getById(id: string) {
    return ptApplicationRepository.findById(id);
  }
};
