import { partnerRepository } from '../repositories/partner.repository';

/** Mã lỗi riêng của chốt "tiền mới" — để người gọi bản không ném (acceptsNewMoney) phân biệt được
 * "đối tác bị khoá" với mọi lỗi khác (mất kết nối DB...), thứ không bao giờ được hiểu là "không đủ điều kiện". */
export const PARTNER_NOT_ACCEPTING_NEW_MONEY = 'PARTNER_NOT_ACCEPTING_NEW_MONEY';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function newMoneyRefusal(message: string) {
  return Object.assign(err(message, 409), { code: PARTNER_NOT_ACCEPTING_NEW_MONEY });
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
      throw newMoneyRefusal('Đối tác quản lý phòng tập này đang bị tạm khoá — không thể mua/thanh toán gói mới');
    }
    if (account.partner.status === 'TERMINATED') {
      throw newMoneyRefusal('Đối tác quản lý phòng tập này đã chấm dứt hợp tác');
    }
  },

  /**
   * Bản không ném của assertAcceptsNewMoney — CÙNG định nghĩa (gọi thẳng nó, không viết lại), dùng
   * cho chỗ cần trả lời có/không thay vì chặn một request (bộ chọn phòng tập, tra tỷ lệ hợp đồng PT).
   * Chỉ nuốt đúng lỗi từ chối của chốt (mang mã PARTNER_NOT_ACCEPTING_NEW_MONEY); mọi lỗi khác — mất
   * kết nối DB, lỗi lập trình — được ném tiếp, vì "không kiểm được" tuyệt đối không phải "không đủ điều kiện".
   */
  async acceptsNewMoney(ownerId: string): Promise<boolean> {
    try {
      await partnerGuard.assertAcceptsNewMoney(ownerId);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === PARTNER_NOT_ACCEPTING_NEW_MONEY) return false;
      throw e;
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
