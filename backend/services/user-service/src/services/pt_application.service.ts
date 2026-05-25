import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { ptApplicationRepository } from '../repositories/pt_application.repository';
import { profileRepository } from '../repositories/profile.repository';
import { PTApplicationStatus } from '../generated/prisma';
import { ptApplicationsTotal } from '@gym-coach/shared';

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://chat-service:3005';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

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
      'yearsOfExperience', 'serviceMode',
    ];

    for (const field of requiredFields) {
      if (!(app as any)[field]) {
        throw new Error(`Missing required field for submission: ${field}`);
      }
    }

    if (app.mainSpecialties.length === 0) {
      throw new Error('At least one specialty is required');
    }

    // Pricing validation — mode-based
    const mode = app.serviceMode;
    if (mode === 'ONLINE') {
      const p = (app.onlinePricePerSession ?? app.desiredSessionPrice) ?? 0;
      if (p <= 0) throw new Error('Cần nhập giá per-session ONLINE > 0');
    } else if (mode === 'OFFLINE') {
      const p = (app.offlinePricePerSession ?? app.desiredSessionPrice) ?? 0;
      if (p <= 0) throw new Error('Cần nhập giá per-session OFFLINE > 0');
    } else if (mode === 'HYBRID') {
      if (!((app.onlinePricePerSession ?? 0) > 0)) throw new Error('Cần nhập giá per-session ONLINE > 0');
      if (!((app.offlinePricePerSession ?? 0) > 0)) throw new Error('Cần nhập giá per-session OFFLINE > 0');
    } else {
      const hasAny = (app.desiredSessionPrice ?? 0) > 0
        || (app.onlinePricePerSession ?? 0) > 0
        || (app.offlinePricePerSession ?? 0) > 0;
      if (!hasAny) throw new Error('Cần nhập ít nhất một mức giá per-session > 0');
    }

    // Package price: nếu nhập thì > 0
    const pkgFields: [string, number | null][] = [
      ['onlinePackagePrice', app.onlinePackagePrice],
      ['offlinePackagePrice', app.offlinePackagePrice],
      ['packagePrice', app.packagePrice],
    ];
    for (const [field, val] of pkgFields) {
      if (val != null && val <= 0) throw new Error(`${field} phải > 0`);
    }
    const hasAnyPkg = (app.onlinePackagePrice ?? 0) > 0
      || (app.offlinePackagePrice ?? 0) > 0
      || (app.packagePrice ?? 0) > 0;
    if (hasAnyPkg && (!app.sessionsPerPackage || app.sessionsPerPackage <= 0)) {
      throw new Error('sessionsPerPackage phải > 0 khi có package price');
    }

    const updated = await ptApplicationRepository.updateStatus(app.id, PTApplicationStatus.SUBMITTED, {
      submittedAt: new Date(),
    });

    // Notify admin real-time (fire-and-forget, not persisted to DB)
    // TODO: persist to DB when user-service can query admin user IDs (role is auth-service only)
    axios.post(`${CHAT_SERVICE_URL}/internal/push-notification`, {
      adminBroadcast: true,
      notification: {
        id: `pt-app-${updated.id}`,
        text: 'Có hồ sơ PT mới cần xét duyệt',
        eventType: 'PT_APPLICATION_SUBMITTED',
        entityType: 'PT_APPLICATION',
        entityId: updated.id,
        link: '/admin/pt-applications',
        unread: true,
        createdAt: new Date().toISOString(),
      },
    }, {
      timeout: 3000,
      headers: { 'x-internal-secret': INTERNAL_API_SECRET },
    }).catch((err: any) => logger.warn({ err }, 'Failed to push admin realtime notification'));

    ptApplicationsTotal.inc({ status: 'SUBMITTED' });
    return updated;
  },

  async adminReviewAction(id: string, action: string, payload: any) {
    const app = await ptApplicationRepository.findById(id);
    if (!app) throw new Error('Application not found');

    // Normalize action names (frontend may send short forms)
    const actionAliases: Record<string, string> = {
      APPROVE: 'APPROVED',
      REJECT: 'REJECTED',
      REQUEST_INFO: 'NEEDS_MORE_INFO',
    };
    const normalizedAction = actionAliases[action] || action;

    const statusMap: Record<string, PTApplicationStatus> = {
      UNDER_REVIEW: PTApplicationStatus.UNDER_REVIEW,
      NEEDS_MORE_INFO: PTApplicationStatus.NEEDS_MORE_INFO,
      APPROVED: PTApplicationStatus.APPROVED,
      REJECTED: PTApplicationStatus.REJECTED,
    };

    const status = statusMap[normalizedAction];
    if (!status) throw new Error(`Invalid action: ${action}`);

    const extra: any = { reviewedAt: new Date() };

    if (normalizedAction === 'REJECTED') {
      if (!payload.rejectionReason) throw new Error('Rejection reason is required');
      extra.rejectionReason = payload.rejectionReason;
    }

    if (normalizedAction === 'NEEDS_MORE_INFO') {
      if (!payload.adminNote) throw new Error('Admin feedback is required for NEEDS_MORE_INFO');
      extra.adminNote = payload.adminNote;
    }

    if (normalizedAction === 'APPROVED') {
      extra.approvedAt = new Date();

      // Perform role sync and profile update
      await syncRoleToPT(app.userProfile.userId);
      await profileRepository.setIsPT(app.userProfile.userId, true);
    }

    ptApplicationsTotal.inc({ status: normalizedAction });
    return ptApplicationRepository.updateStatus(id, status, extra);
  },

  async listApplications(filters: any) {
    return ptApplicationRepository.findAll(filters);
  },

  async getById(id: string) {
    return ptApplicationRepository.findById(id);
  }
};
