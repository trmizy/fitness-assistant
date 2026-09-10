import { prisma } from './prisma';

/** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery — no auth-gated
 * reads here, unlike complaint-photos/branch-documents (see those repositories/controllers
 * for the private counterpart). */
export const gymPhotoRepository = {
  listByGym(gymId: string) {
    return prisma.gymPhoto.findMany({ where: { gymId }, orderBy: { sortOrder: 'asc' } });
  },

  findById(id: string) {
    return prisma.gymPhoto.findUnique({ where: { id } });
  },

  countByGym(gymId: string) {
    return prisma.gymPhoto.count({ where: { gymId } });
  },

  create(data: { gymId: string; fileName: string; sortOrder: number; isCover: boolean }) {
    return prisma.gymPhoto.create({ data });
  },

  delete(id: string) {
    return prisma.gymPhoto.delete({ where: { id } });
  },

  /** Đúng một ảnh có isCover=true tại một thời điểm — bỏ cờ mọi ảnh khác của gym này trước
   * khi đặt cờ ảnh mới, trong cùng một transaction. */
  async setCover(gymId: string, photoId: string) {
    return prisma.$transaction([
      prisma.gymPhoto.updateMany({ where: { gymId }, data: { isCover: false } }),
      prisma.gymPhoto.update({ where: { id: photoId }, data: { isCover: true } }),
    ]);
  },

  updateSortOrder(id: string, sortOrder: number) {
    return prisma.gymPhoto.update({ where: { id }, data: { sortOrder } });
  },
};
