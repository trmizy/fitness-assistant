import { Prisma, ComplaintStatus } from '../generated/prisma';
import { prisma } from './prisma';

/**
 * GYM_MANAGEMENT master spec, Phase 5 — one shared table for every complaint source (see
 * schema.prisma's doc comment on GymComplaint). No business logic here — that lives in
 * complaint.service.ts.
 */
export const complaintRepository = {
  create(data: Prisma.GymComplaintUncheckedCreateInput) {
    return prisma.gymComplaint.create({ data });
  },

  findById(id: string) {
    return prisma.gymComplaint.findUnique({ where: { id } });
  },

  /** Admin-wide queue, optionally filtered by status. */
  listAll(status?: ComplaintStatus) {
    return prisma.gymComplaint.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  },

  /** The COMPLAINTS tab on a partner's detail page. */
  listForPartner(partnerId: string) {
    return prisma.gymComplaint.findMany({ where: { partnerId }, orderBy: { createdAt: 'desc' } });
  },

  listForGym(gymId: string) {
    return prisma.gymComplaint.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' } });
  },

  /** The reporting client's own "theo dõi trạng thái" list. */
  listForReporter(reporterUserId: string) {
    return prisma.gymComplaint.findMany({ where: { reporterUserId }, orderBy: { createdAt: 'desc' } });
  },

  update(id: string, data: Prisma.GymComplaintUpdateInput) {
    return prisma.gymComplaint.update({ where: { id }, data });
  },

  /**
   * Defense-in-depth for the private photo-serving route: an ADMIN may view a photo token
   * only once it's actually attached to a submitted complaint (not while it's still an
   * orphaned upload nobody has attached to anything yet).
   */
  async existsWithPhotoToken(token: string): Promise<boolean> {
    const count = await prisma.gymComplaint.count({ where: { photoTokens: { has: token } } });
    return count > 0;
  },
};
