import { prisma } from './prisma';
import type { BranchReviewCategory } from '../generated/prisma';

export const gymBranchReviewRepository = {
  listOpen(gymId: string) {
    return prisma.gymBranchReviewIssue.findMany({ where: { gymId, resolvedAt: null }, orderBy: { createdAt: 'asc' } });
  },

  listAll(gymId: string) {
    return prisma.gymBranchReviewIssue.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' } });
  },

  createMany(gymId: string, adminId: string, issues: { category: BranchReviewCategory; message: string }[]) {
    return prisma.gymBranchReviewIssue.createMany({
      data: issues.map((i) => ({ gymId, category: i.category, message: i.message, createdBy: adminId })),
    });
  },

  /** Gọi khi chủ gym gửi lại hồ sơ thành công — đóng hết vấn đề còn mở của gym đó trong một
   * lượt, không đóng lẻ từng mục. */
  resolveAllOpen(gymId: string) {
    return prisma.gymBranchReviewIssue.updateMany({ where: { gymId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  },
};
