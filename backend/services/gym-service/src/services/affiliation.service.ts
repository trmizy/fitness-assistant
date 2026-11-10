import { affiliationRepository } from '../repositories/affiliation.repository';
import { gymService } from './gym.service';

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

export const affiliationService = {
  async listPublicByGym(gymId: string) {
    return affiliationRepository.findPublicByGym(gymId);
  },

  async invite(gymId: string, ownerId: string, ptId: string, data: { employmentType?: string; commissionRate?: number; visibility?: string }) {
    await gymService.getOwnedGym(gymId, ownerId);
    try {
      return await affiliationRepository.create({
        gym: { connect: { id: gymId } },
        ptId,
        employmentType: (data.employmentType as any) ?? undefined,
        commissionRate: data.commissionRate,
        visibility: (data.visibility as any) ?? undefined,
        invitedBy: ownerId,
      });
    } catch (e: any) {
      // (gymId, ptId) is unique: a second invite is a clear 409, not a raw Prisma 500.
      if (e?.code === 'P2002') throw err('Huấn luyện viên này đã được mời hoặc đã thuộc chi nhánh này', 409, 'AFFILIATION_ALREADY_EXISTS');
      throw e;
    }
  },

  async listPendingForPT(ptId: string) {
    return affiliationRepository.findPendingByPT(ptId);
  },

  async listForPT(ptId: string) {
    return affiliationRepository.findByPT(ptId);
  },

  async respond(affiliationId: string, ptId: string, accept: boolean) {
    const affiliation = await affiliationRepository.findById(affiliationId);
    if (!affiliation) throw err('Invitation not found', 404);
    if (affiliation.ptId !== ptId) throw err('Not authorized', 403);
    if (affiliation.status !== 'PENDING') throw err(`Cannot respond to invitation in ${affiliation.status} status`, 400);

    return affiliationRepository.update(affiliationId, {
      status: accept ? 'ACTIVE' : 'REJECTED',
      joinedAt: accept ? new Date() : undefined,
    });
  },
};
