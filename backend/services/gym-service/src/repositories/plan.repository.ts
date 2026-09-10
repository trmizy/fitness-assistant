import { prisma } from './prisma';
import { Prisma } from '../generated/prisma';

export const planRepository = {
  async create(data: Prisma.GymMembershipPlanCreateInput) {
    return prisma.gymMembershipPlan.create({ data });
  },

  async findById(id: string) {
    return prisma.gymMembershipPlan.findUnique({ where: { id } });
  },

  async update(id: string, data: Prisma.GymMembershipPlanUpdateInput) {
    return prisma.gymMembershipPlan.update({ where: { id }, data });
  },

  /** Public listing: active AND currently inside its sale window (or has none). A plan whose
   * campaign already ended must disappear here without touching memberships already sold.
   * Brand-scoped — every branch under the brand shows the same list. */
  async findActiveByBrand(brandId: string) {
    const now = new Date();
    return prisma.gymMembershipPlan.findMany({
      where: {
        brandId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }] },
          { OR: [{ saleEndAt: null }, { saleEndAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async findAllByBrand(brandId: string) {
    return prisma.gymMembershipPlan.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } });
  },

  /**
   * Trang tìm phòng gym công khai — lọc "theo mức giá" cần biết "giá thấp nhất" của mỗi
   * thương hiệu (một chi nhánh không có giá riêng, gói là brand-wide — xem
   * GymMembershipPlan's doc comment). Một câu groupBy cho MỌI brandId cùng lúc thay vì gọi
   * lặp `findActiveByBrand` cho từng gym trong danh sách — tránh N+1 trên trang có nhiều
   * chi nhánh. Cùng điều kiện "đang mở bán" với `findActiveByBrand` (status ACTIVE + trong
   * cửa sổ saleStartAt/saleEndAt) để "giá từ X" khớp với giá khách thực sự mua được.
   */
  async findCheapestActiveByBrands(brandIds: string[]): Promise<Map<string, string>> {
    if (brandIds.length === 0) return new Map();
    const now = new Date();
    const rows = await prisma.gymMembershipPlan.groupBy({
      by: ['brandId'],
      where: {
        brandId: { in: brandIds },
        status: 'ACTIVE',
        AND: [
          { OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }] },
          { OR: [{ saleEndAt: null }, { saleEndAt: { gte: now } }] },
        ],
      },
      _min: { price: true },
    });
    return new Map(rows.map((r) => [r.brandId, r._min.price!.toString()]));
  },
};
