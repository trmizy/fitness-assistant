import { partnerRepository } from '../repositories/partner.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/**
 * Phase 5 mục 5.1 — điểm chốt chặn dùng chung cho mọi nơi "tiền mới đi vào" của một đối
 * tác: mua gói lần đầu, thanh toán lại đơn PENDING_PAYMENT, đề xuất cộng tác PT mới, yêu
 * cầu rút tiền. KHÔNG dùng cho check-in hay hợp đồng/hội viên đang chạy — những thứ đó
 * "chạy tới hết hạn bình thường" theo đúng bảng hệ quả, cố tình không gọi hàm này.
 *
 * Không có tài khoản đối tác (chủ gym có từ trước mô hình đối tác) → bỏ qua, hành vi y
 * nguyên trước Phase 2.
 */
export const partnerGuard = {
  async assertAcceptsNewMoney(ownerId: string) {
    const account = await partnerRepository.findAccountByUserId(ownerId);
    if (!account) return; // legacy — không có hồ sơ đối tác nào để khoá

    if (account.partner.status === 'SUSPENDED') {
      throw err('Đối tác quản lý phòng tập này đang bị tạm khoá — không thể mua/thanh toán gói mới', 409);
    }
    if (account.partner.status === 'TERMINATED') {
      throw err('Đối tác quản lý phòng tập này đã chấm dứt hợp tác', 409);
    }
  },

  /** Rút tiền bị đóng băng khi tạm khoá — xem doc comment 5.1: "đây là điểm quan trọng nhất". */
  async assertWithdrawalsAllowed(ownerId: string) {
    const account = await partnerRepository.findAccountByUserId(ownerId);
    if (!account) return;
    if (account.partner.status === 'SUSPENDED') {
      throw err('Tài khoản đối tác đang bị tạm khoá — yêu cầu rút tiền đang bị đóng băng', 409);
    }
    if (account.partner.status === 'TERMINATED') {
      throw err('Đối tác đã chấm dứt hợp tác', 409);
    }
  },

  /** userId của mọi OWNER thuộc đối tác đang bị tạm khoá/đã chấm dứt — lọc khỏi trang tìm
   * kiếm công khai. */
  async hiddenFromPublicOwnerUserIds(): Promise<string[]> {
    const rows = await partnerRepository.listAccountsWithHiddenPartner();
    return rows.map((r) => r.userId);
  },
};
