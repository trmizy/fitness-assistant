import { prisma } from './prisma';
import type { BranchDocumentType, PartnerDocumentStatus } from '../generated/prisma';

/** Same one-row-per-type upsert shape as diligence.repository.ts's partner-document methods
 * — mirrored deliberately, see GymBranchDocument's own schema doc comment for why this is a
 * distinct table rather than reusing GymPartnerDocument. */
export const gymBranchDocumentRepository = {
  listByGym(gymId: string) {
    return prisma.gymBranchDocument.findMany({ where: { gymId }, orderBy: { docType: 'asc' } });
  },

  findByGymAndType(gymId: string, docType: BranchDocumentType) {
    return prisma.gymBranchDocument.findUnique({ where: { gymId_docType: { gymId, docType } } });
  },

  upsert(
    gymId: string,
    docType: BranchDocumentType,
    data: { fileToken?: string | null; required?: boolean; status?: PartnerDocumentStatus },
  ) {
    return prisma.gymBranchDocument.upsert({
      where: { gymId_docType: { gymId, docType } },
      create: { gymId, docType, ...data },
      update: data,
    });
  },

  /** Defense-in-depth for the admin branch of the private serve route — same shape as
   * complaintRepository.existsWithPhotoToken. */
  existsWithFileToken(token: string) {
    return prisma.gymBranchDocument.findFirst({ where: { fileToken: token } }).then((d) => !!d);
  },
};
