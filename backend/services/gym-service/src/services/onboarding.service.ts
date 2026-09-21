import { partnerAuditService } from './partner-audit.service';
import { authClient } from '../clients/auth.client';
import type { Request } from 'express';
import { partnerRepository } from '../repositories/partner.repository';
import { brandService } from './brand.service';
import { partnerService } from './partner.service';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const CURRENT_TERMS_VERSION = process.env.PARTNER_TERMS_VERSION || '2026-01';

/**
 * Phase 3 mục 3.1 — trình thiết lập lần đầu, 5 bước, không bỏ qua được.
 *
 * Bước 1 (đặt mật khẩu) đã xảy ra ở partnerInvitationService.acceptInvitation trước khi
 * đối tượng GymPartnerAccount này tồn tại — không có gì để làm lại ở đây. MANAGER chỉ cần
 * bước 2; OWNER cần đủ cả 2-3-4-5 (mục 3.2: "Quản lý mới chỉ làm bước 1 và 2").
 */
export const onboardingService = {
  async getProgress(accountId: string) {
    const account = await partnerRepository.findAccountById(accountId);
    if (!account) throw err('Không tìm thấy tài khoản', 404);
    const partner = account.partner;
    const isOwner = account.role === 'OWNER';

    const steps = {
      password: true, // luôn true tới đây được — accept-invitation đã bắt đặt mật khẩu
      contact: !!account.contactPhone,
      brand: isOwner ? !!partner.brandId : null,
      payout: isOwner ? !!partner.payoutBankAccountNumber : null,
      terms: isOwner ? !!partner.termsAcceptedAt : null,
    };

    const required = isOwner
      ? [steps.contact, steps.brand, steps.payout, steps.terms]
      : [steps.contact];
    // Đã hoàn tất (dù tự làm hay được backfill cho tài khoản có từ trước Phase 3) thì tính
    // là xong VĨNH VIỄN — không đánh giá lại từng ô riêng lẻ nữa. Một chủ gym cũ có
    // onboardingCompletedAt nhưng contactPhone/payout còn trống (dữ liệu chưa từng tồn tại
    // với họ) không được phép tính lại thành "chưa xong" mỗi lần gọi hàm này.
    const completed = !!account.onboardingCompletedAt || required.every(Boolean);

    // Bước đang dở — "đóng app giữa chừng, mở lại → tiếp đúng bước đang dở" (mục nghiệm thu).
    let currentStep = 1;
    if (!steps.contact) currentStep = 2;
    else if (isOwner && !steps.brand) currentStep = 3;
    else if (isOwner && !steps.payout) currentStep = 4;
    else if (isOwner && !steps.terms) currentStep = 5;
    else currentStep = completed ? 5 : 2;

    // contactPhone: trang hồ sơ cá nhân của chủ gym/quản lý đọc số hiện tại từ đây (không có endpoint đọc riêng).
    return {
      role: account.role,
      steps,
      completed,
      currentStep,
      partnerId: partner.id,
      hasPartnerAccount: true,
      contactPhone: account.contactPhone ?? null,
      // Tài khoản nhận tiền chỉ trả cho CHỦ SỞ HỮU (quản lý chi nhánh không thấy).
      payout: isOwner
        ? {
            bankName: partner.payoutBankName ?? null,
            accountNumber: partner.payoutBankAccountNumber ?? null,
            accountHolder: partner.payoutBankAccountHolder ?? null,
          }
        : null,
    };
  },

  async maybeCompleteOnboarding(accountId: string) {
    const progress = await this.getProgress(accountId);
    if (progress.completed) {
      await partnerRepository.updateAccount(accountId, { onboardingCompletedAt: new Date() });
    }
    return progress;
  },

  /** Bước 2 — cả OWNER lẫn MANAGER. Tên (firstName/lastName) là của auth-service, gọi qua
   * đúng token của người đang đăng nhập nên KHÔNG cần proxy — frontend gọi PATCH /auth/me
   * song song; ở đây chỉ giữ số điện thoại, thứ duy nhất gym-service thật sự sở hữu. */
  async submitContact(accountId: string, phone: string) {
    if (!phone?.trim()) throw err('Số điện thoại là bắt buộc', 400);
    await partnerRepository.updateAccount(accountId, { contactPhone: phone.trim() });
    return this.maybeCompleteOnboarding(accountId);
  },

  /** Bước 3 — chỉ OWNER. Tên thương hiệu vào `pendingName` như mọi lần đổi tên khác (xem
   * brandService.createBrand) — trang công khai chỉ hiện `approvedName` sau khi admin duyệt
   * cùng lúc duyệt chi nhánh đầu tiên của đối tác (gymService.setStatus's doc comment, hành
   * vi CÓ SẴN, không cần sửa gì thêm cho việc này). */
  async submitBrand(accountId: string, ownerId: string, partnerId: string, data: { name: string; description?: string; logoUrl?: string }) {
    if (!data.name?.trim()) throw err('Tên thương hiệu là bắt buộc', 400);

    // Idempotent theo đúng tinh thần "đóng app giữa chừng, mở lại → tiếp đúng bước đang
    // dở": nếu bước này đã xong (mất kết nối sau khi tạo brand nhưng trước khi client
    // nhận phản hồi), gọi lại không được ném lỗi "đã có thương hiệu" — chỉ cần xác nhận
    // lại tiến độ.
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner?.brandId) {
      const brand = await brandService.createBrand(ownerId, { name: data.name, description: data.description });
      await partnerService.attachBrand(partnerId, brand.id);
    }
    return this.maybeCompleteOnboarding(accountId);
  },

  /** Bước 4 — chỉ OWNER. */
  async submitPayout(
    accountId: string,
    partnerId: string,
    data: { bankName: string; accountNumber: string; accountHolder: string },
    actor?: { userId: string; email?: string; req?: Request },
  ) {
    if (!data.bankName?.trim() || !data.accountNumber?.trim() || !data.accountHolder?.trim()) {
      throw err('Cần đủ tên ngân hàng, số tài khoản và tên chủ tài khoản', 400);
    }
    const accountNumber = data.accountNumber.trim();
    const before = await partnerRepository.findPartnerById(partnerId);
    await partnerRepository.updatePartner(partnerId, {
      payoutBankName: data.bankName.trim(),
      payoutBankAccountNumber: accountNumber,
      payoutBankAccountHolder: data.accountHolder.trim(),
    });
    // Đổi tài khoản nhận tiền SAU khi đã có (không phải lần nhập đầu ở trình thiết lập) là thao tác nhạy
    // cảm: ghi nhật ký (chỉ 4 số cuối) và email báo chủ sở hữu, để ai chiếm phiên đổi số cũng bị phát hiện.
    const changed = !!before?.payoutBankAccountNumber && before.payoutBankAccountNumber !== accountNumber;
    if (changed && actor) {
      await partnerAuditService.record({
        partnerId,
        actorUserId: actor.userId,
        action: 'PARTNER_UPDATED',
        req: actor.req,
        metadata: { field: 'payoutBank', bankName: data.bankName.trim(), last4: accountNumber.slice(-4), previousLast4: before!.payoutBankAccountNumber!.slice(-4) },
      });
      if (actor.email) {
        await authClient
          .sendEmail({
            to: actor.email,
            subject: 'Gymini — Tài khoản nhận tiền của bạn vừa được thay đổi',
            text:
              `Tài khoản nhận tiền của đối tác vừa được đổi sang ${data.bankName.trim()} — số tài khoản kết thúc bằng ${accountNumber.slice(-4)}. ` +
              'Nếu không phải bạn thực hiện, hãy đổi mật khẩu ngay và liên hệ Gymini.',
          })
          .catch(() => false);
      }
    }
    return this.maybeCompleteOnboarding(accountId);
  },

  /** Bước 5 — chỉ OWNER. Lưu đúng phiên bản điều khoản đã ký, không chỉ một cờ boolean —
   * điều khoản đổi sau này thì vẫn biết chính xác đối tác này từng đồng ý bản nào. */
  async submitTerms(accountId: string, partnerId: string, version?: string) {
    await partnerRepository.updatePartner(partnerId, {
      termsAcceptedVersion: version?.trim() || CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
    });
    return this.maybeCompleteOnboarding(accountId);
  },

  currentTermsVersion() {
    return CURRENT_TERMS_VERSION;
  },
};
