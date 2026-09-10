import { prisma } from './prisma';
import type { PartnerDocumentType, PartnerDocumentStatus, PartnerContactChannel } from '../generated/prisma';

export const diligenceRepository = {
  listDocuments(partnerId: string) {
    return prisma.gymPartnerDocument.findMany({ where: { partnerId }, orderBy: { docType: 'asc' } });
  },

  findDocument(partnerId: string, docType: PartnerDocumentType) {
    return prisma.gymPartnerDocument.findUnique({ where: { partnerId_docType: { partnerId, docType } } });
  },

  /** Ghi hoặc thay tệp cho một mục giấy tờ — upsert vì mỗi (partnerId, docType) chỉ có
   * đúng một dòng, tải lên lần sau thay thế lần trước chứ không cộng dồn. */
  upsertDocument(
    partnerId: string,
    docType: PartnerDocumentType,
    data: { fileUrl?: string | null; required?: boolean; status?: PartnerDocumentStatus },
  ) {
    return prisma.gymPartnerDocument.upsert({
      where: { partnerId_docType: { partnerId, docType } },
      create: { partnerId, docType, ...data },
      update: data,
    });
  },

  verifyDocument(
    partnerId: string,
    docType: PartnerDocumentType,
    data: { status: PartnerDocumentStatus; verifiedBy: string; expiresAt?: Date | null },
  ) {
    return prisma.gymPartnerDocument.update({
      where: { partnerId_docType: { partnerId, docType } },
      data: { ...data, verifiedAt: new Date() },
    });
  },

  /** Giấy tờ có hạn (giấy phép, PCCC) sắp hết hạn trong N ngày tới — hàng đợi việc cần làm. */
  findExpiringSoon(withinDays: number) {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    return prisma.gymPartnerDocument.findMany({
      where: { expiresAt: { not: null, lte: cutoff, gte: new Date() } },
      include: { partner: { select: { id: true, legalName: true } } },
    });
  },

  listContactLogs(partnerId: string) {
    return prisma.gymPartnerContactLog.findMany({ where: { partnerId }, orderBy: { occurredAt: 'desc' } });
  },

  addContactLog(data: {
    partnerId: string;
    channel: PartnerContactChannel;
    note: string;
    occurredAt?: Date;
    createdBy: string;
  }) {
    return prisma.gymPartnerContactLog.create({ data });
  },

  // ── PartnerInternalNote (GYM_MANAGEMENT master spec §65 — owner-invisible) ──────────────
  listInternalNotes(partnerId: string) {
    return prisma.partnerInternalNote.findMany({ where: { partnerId }, orderBy: { createdAt: 'desc' } });
  },

  addInternalNote(data: { partnerId: string; authorAdminId: string; text: string }) {
    return prisma.partnerInternalNote.create({ data });
  },
};
