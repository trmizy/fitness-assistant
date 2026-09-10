import { partnerRepository } from '../repositories/partner.repository';
import { commissionRateRepository } from '../repositories/commission-rate.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/**
 * Phase 5 mục 5.3 — chiết khấu nền tảng.
 *
 * ⚠️ Sàn tối thiểu 0.10 GIỮ NGUYÊN có chủ đích (đã hỏi và chốt trực tiếp) — không hạ theo
 * "5% chung" trong đặc tả. `PlatformCommissionRate` vẫn lưu đúng 5% làm giá trị cấu hình/ý
 * định đàm phán, nhưng số tiền trích ra thực tế luôn được kẹp lên sàn này, y hệt
 * membership.service.ts's PLATFORM_RATE cũ ("floored at 10%, same as PT contracts").
 */
const FLOOR = 0.1;

function clamp(rate: number): number {
  return Number.isFinite(rate) && rate >= FLOOR && rate <= 1 ? rate : FLOOR;
}

export const commissionRateService = {
  async getEffectiveConfigRate(asOf: Date = new Date()): Promise<number> {
    const row = await commissionRateRepository.findEffectiveAsOf(asOf);
    if (row) return Number(row.rate);
    const raw = Number(process.env.PLATFORM_COMMISSION_RATE ?? '0.10');
    return Number.isFinite(raw) ? raw : 0.1;
  },

  async setRate(rate: number, effectiveFrom: Date, adminId?: string) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw err('Tỷ lệ phải trong khoảng 0 đến 1', 400);
    if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.getTime())) {
      throw err('Ngày hiệu lực không hợp lệ', 400);
    }
    // Đổi mức = THÊM DÒNG MỚI — không bao giờ sửa/xoá dòng cũ (xem doc comment ở schema).
    return commissionRateRepository.create({ rate, effectiveFrom, createdBy: adminId ?? null });
  },

  history() {
    return commissionRateRepository.listAll();
  },

  /**
   * Mức hoa hồng ÁP DỤNG THỰC TẾ cho chi nhánh của `ownerId`, chụp ảnh ngay tại thời điểm
   * gọi (trả về một chuỗi số cụ thể, không phải tham chiếu tới cấu hình) — nơi gọi phải tự
   * mang giá trị này đi mà không đọc lại cấu hình về sau (xem
   * payment-service/internal.routes.ts's checkout: "rate table ... frozen into the
   * transaction's metadata ... not looked up at settlement time").
   *
   * Ưu tiên GymPartner.commissionRateOverride đã đàm phán riêng; không có đối tác (chủ gym
   * từ trước Phase 1) hoặc không có override thì dùng mức chung đang hiệu lực.
   */
  async resolveEffectiveRateForOwner(ownerId: string): Promise<string> {
    const account = await partnerRepository.findAccountByUserId(ownerId);
    const override = account?.partner.commissionRateOverride;
    const rate = override !== null && override !== undefined ? Number(override) : await this.getEffectiveConfigRate();
    return clamp(rate).toFixed(4);
  },
};
