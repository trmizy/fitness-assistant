import type {
  GymPartnerStatus,
  PartnerAccountRole,
  PartnerAccountStatus,
  PartnerVerificationStatus,
} from '../generated/prisma';

/**
 * Cổng vận hành của chủ gym — GYM_PARTNER_SECURITY_MODEL.md §1.
 *
 * ĐÂY LÀ CHỖ DUY NHẤT trả lời "người này có được dùng chức năng vận hành Gym Owner không". Nó là
 * danh sách CHO PHÉP (allow-list), không phải danh sách chặn: truy cập vận hành thường chỉ được
 * cấp khi TẤT CẢ điều kiện sau cùng đúng —
 *
 *     partner.status === ACTIVE
 *     AND partner.verificationStatus === VERIFIED
 *     AND partnerAccount.status === ACTIVE
 *     AND partnerAccount.onboardingCompletedAt != null
 *
 * Mọi trạng thái khác — kể cả trạng thái sẽ được thêm vào enum sau này — mặc định là TỪ CHỐI.
 * `switch` bên dưới vét cạn `GymPartnerStatus` kèm `assertNever`: thêm một giá trị enum mới sẽ làm
 * file này không biên dịch được cho tới khi có người quyết định giá trị đó được phép làm gì.
 *
 * SUSPENDED / TERMINATED mã hoá đúng hệ quả hiện hành (GYM_PARTNER_SUSPENSION_CONSEQUENCES.md),
 * không đổi nghiệp vụ: tạm khoá chỉ khoá đăng nhập của OWNER, MANAGER vẫn làm việc; chấm dứt thì
 * mọi tài khoản đã bị thu hồi.
 */

export type OperationalDenyCode =
  | 'NO_PARTNER_ACCOUNT'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'PARTNER_APPLICATION_PENDING'
  | 'PARTNER_NOT_VERIFIED'
  | 'PARTNER_SUSPENDED'
  | 'PARTNER_TERMINATED'
  | 'PARTNER_STATE_UNKNOWN';

export type OperationalDecision =
  | { allowed: true }
  | { allowed: false; status: 403; code: OperationalDenyCode; message: string }
  /** Đã duyệt xong, chỉ còn bước payout của trình thiết lập — không phải ứng viên. */
  | { allowed: false; status: 409; code: 'ONBOARDING_INCOMPLETE'; message: string };

export interface AccessSubject {
  /** Đã CHỨNG MINH được sở hữu từ trước mô hình đối tác (có Gym/GymBrand mang ownerId này). */
  isLegacy: boolean;
  accountStatus: PartnerAccountStatus | null;
  role: PartnerAccountRole;
  partnerStatus: GymPartnerStatus | null;
  verificationStatus: PartnerVerificationStatus | null;
  onboardingCompletedAt: Date | null;
}

const ALLOW: OperationalDecision = { allowed: true };

function deny(code: OperationalDenyCode, message: string): OperationalDecision {
  return { allowed: false, status: 403, code, message };
}

function assertNever(value: never): never {
  throw new Error(`GymPartnerStatus chưa được phân loại trong evaluateOperationalAccess: ${String(value)}`);
}

export function evaluateOperationalAccess(subject: AccessSubject): OperationalDecision {
  if (subject.isLegacy) return ALLOW;

  if (!subject.accountStatus || !subject.partnerStatus) {
    return deny(
      'NO_PARTNER_ACCOUNT',
      'Tài khoản này chưa có hồ sơ đối tác nào — hãy hoàn tất đăng ký đối tác trước',
    );
  }
  if (subject.accountStatus !== 'ACTIVE') {
    return deny('ACCOUNT_NOT_ACTIVE', 'Tài khoản đối tác chưa kích hoạt hoặc đã bị thu hồi');
  }

  switch (subject.partnerStatus) {
    case 'ACTIVE':
      break;
    case 'SUSPENDED':
      // Chỉ OWNER bị khoá; MANAGER giữ phạm vi vận hành như trước (hội viên, check-in).
      if (subject.role === 'OWNER') {
        return deny('PARTNER_SUSPENDED', 'Đối tác đang bị tạm khoá');
      }
      break;
    case 'TERMINATED':
      return deny('PARTNER_TERMINATED', 'Đối tác đã chấm dứt hợp tác');
    case 'PROSPECT':
    case 'INVITED':
      return deny('PARTNER_APPLICATION_PENDING', 'Hồ sơ đối tác chưa được Gymini duyệt');
    default:
      return assertNever(subject.partnerStatus);
  }

  // Đọc dương tính: chỉ VERIFIED mới qua, mọi giá trị khác (kể cả giá trị tương lai) là từ chối.
  if (subject.verificationStatus !== 'VERIFIED') {
    return deny('PARTNER_NOT_VERIFIED', 'Hồ sơ đối tác chưa được xác minh');
  }

  if (!subject.onboardingCompletedAt) {
    return {
      allowed: false,
      status: 409,
      code: 'ONBOARDING_INCOMPLETE',
      message: 'Cần hoàn tất trình thiết lập lần đầu trước khi dùng chức năng này',
    };
  }

  return ALLOW;
}
