import type {
  GymPartnerStatus,
  PartnerVerificationStatus,
  PartnerAccountStatus,
} from '../generated/prisma';

/**
 * Trạng thái hồ sơ đối tác tự đăng ký — GYM_PARTNER_STATE_MACHINE.md. Toàn bộ hàm ở đây là THUẦN
 * (không DB, không I/O) để test được trọn vẹn: chúng ánh xạ hai trục có sẵn (`GymPartnerStatus`,
 * `PartnerVerificationStatus`) sang tên nghiệp vụ mà frontend dùng để điều hướng. Không thêm enum
 * vòng đời mới.
 */

/** Tên nghiệp vụ trả cho frontend (`GET /owner/application/status`). */
export type AccessState =
  | 'LEGACY' //                   chủ gym có từ trước, chứng minh được sở hữu
  | 'SETUP_INCOMPLETE' //         đã có User GYM_OWNER nhưng chưa bootstrap hồ sơ đối tác
  | 'ONBOARDING' //               đang điền hồ sơ (chưa nộp)
  | 'UNDER_REVIEW' //             đã nộp, chờ admin
  | 'CHANGES_REQUESTED' //        admin yêu cầu sửa
  | 'REJECTED' //                 admin từ chối (cuối với ứng viên)
  | 'APPROVED_PAYOUT_PENDING' //  đã duyệt, còn bước payout của trình thiết lập
  | 'ACTIVE' //                   vận hành
  | 'SUSPENDED'
  | 'TERMINATED'
  | 'RESTRICTED'; //              mọi tổ hợp không nhận diện được → không có quyền vận hành

export interface StateInput {
  isLegacy: boolean;
  hasAccount: boolean;
  accountStatus: PartnerAccountStatus | null;
  partnerStatus: GymPartnerStatus | null;
  verificationStatus: PartnerVerificationStatus | null;
  onboardingCompletedAt: Date | null;
}

export function deriveAccessState(s: StateInput): AccessState {
  if (s.isLegacy) return 'LEGACY';
  if (!s.hasAccount || !s.partnerStatus) return 'SETUP_INCOMPLETE';
  if (s.accountStatus !== 'ACTIVE') return 'RESTRICTED';

  switch (s.partnerStatus) {
    case 'ACTIVE':
      if (s.verificationStatus !== 'VERIFIED') return 'RESTRICTED';
      return s.onboardingCompletedAt ? 'ACTIVE' : 'APPROVED_PAYOUT_PENDING';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'TERMINATED':
      return 'TERMINATED';
    case 'PROSPECT':
      switch (s.verificationStatus) {
        case 'NOT_VERIFIED':
          return 'ONBOARDING';
        case 'IN_REVIEW':
          return 'UNDER_REVIEW';
        case 'NEEDS_INFO':
          return 'CHANGES_REQUESTED';
        case 'REJECTED':
          return 'REJECTED';
        default:
          // VERIFIED nhưng vẫn PROSPECT không phải trạng thái hợp lệ của luồng tự đăng ký.
          return 'RESTRICTED';
      }
    case 'INVITED':
    default:
      return 'RESTRICTED';
  }
}

/** Ứng viên chỉ sửa được khi đang điền hồ sơ hoặc khi admin yêu cầu sửa. */
export function isEditableState(state: AccessState): boolean {
  return state === 'ONBOARDING' || state === 'CHANGES_REQUESTED';
}

// ── Điều kiện nộp hồ sơ ───────────────────────────────────────────────────────────────────────

/** Giấy tờ bắt buộc — chính sách sẵn có của `partner-diligence.service.ts`, dùng lại nguyên. */
export const REQUIRED_APPLICATION_DOCS = ['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF'] as const;

/**
 * Số ảnh tối thiểu của chi nhánh đầu. Code hiện tại KHÔNG có ngưỡng nào (GymPhoto chỉ có trần 20)
 * nên đây là quyết định mới, đã ghi ở GYM_PARTNER_SELF_ONBOARDING_SPEC.md §6 (D12): giá trị yếu
 * nhất mà vẫn đúng yêu cầu "phải có ảnh thật của cơ sở". Đổi ngưỡng = đổi hằng số này.
 */
export const APPLICATION_MIN_PHOTOS = Number(process.env.PARTNER_APPLICATION_MIN_PHOTOS || 1);

export interface ApproveInput {
  partnerStatus: GymPartnerStatus;
  verificationStatus: PartnerVerificationStatus;
  /** Số vấn đề đang OPEN hoặc RESUBMITTED (ứng viên đã đánh dấu nhưng admin chưa đóng). */
  unresolvedIssueCount: number;
  docStatuses: Partial<Record<(typeof REQUIRED_APPLICATION_DOCS)[number], { status: string | null; hasFile: boolean }>>;
  draftBranchCount: number;
  /** Số chi nhánh đã không còn là DRAFT của ứng viên — hồ sơ tự đăng ký không được có. */
  nonDraftBranchCount: number;
}

export interface Blocker {
  code:
    | 'NOT_UNDER_REVIEW'
    | 'ISSUES_UNRESOLVED'
    | 'DOCUMENT_NOT_VERIFIED'
    | 'BRANCH_COUNT'
    | 'UNEXPECTED_BRANCH';
  message: string;
}

/**
 * Điều kiện để APPROVE — dùng CHUNG cho màn admin (nút Approve bị vô hiệu kèm lý do) và cho chính
 * `approveApplication` (đọc lại trong transaction). Một chỗ duy nhất nên nút và hành động không thể
 * lệch nhau. Không có điều kiện nào ở đây tự đặt VERIFIED cho giấy tờ: giấy tờ phải đã được admin
 * chấp nhận từng cái, có dấu vết.
 */
export function computeApproveBlockers(input: ApproveInput): Blocker[] {
  const blockers: Blocker[] = [];
  if (input.partnerStatus !== 'PROSPECT' || input.verificationStatus !== 'IN_REVIEW') {
    blockers.push({ code: 'NOT_UNDER_REVIEW', message: 'Hồ sơ không ở trạng thái đang xét duyệt' });
  }
  if (input.unresolvedIssueCount > 0) {
    blockers.push({
      code: 'ISSUES_UNRESOLVED',
      message: `Còn ${input.unresolvedIssueCount} vấn đề chưa được đóng`,
    });
  }
  for (const docType of REQUIRED_APPLICATION_DOCS) {
    const d = input.docStatuses[docType];
    if (!d || !d.hasFile || d.status !== 'VERIFIED') {
      blockers.push({ code: 'DOCUMENT_NOT_VERIFIED', message: `Giấy tờ ${docType} chưa được chấp nhận` });
    }
  }
  if (input.draftBranchCount !== 1) {
    blockers.push({
      code: 'BRANCH_COUNT',
      message:
        input.draftBranchCount === 0
          ? 'Hồ sơ chưa có chi nhánh đầu tiên'
          : 'Hồ sơ có nhiều hơn một chi nhánh nháp',
    });
  }
  if (input.nonDraftBranchCount > 0) {
    blockers.push({ code: 'UNEXPECTED_BRANCH', message: 'Ứng viên đã có chi nhánh ngoài hồ sơ ứng tuyển' });
  }
  return blockers;
}

export type ApplicationSection =
  | 'REPRESENTATIVE'
  | 'BRAND'
  | 'SCALE'
  | 'BRANCH'
  | 'LOCATION'
  | 'PHOTOS'
  | 'LEGAL'
  | 'TERMS';

export interface CompletenessInput {
  representative: { name?: string | null; phone?: string | null; role?: string | null };
  brandName?: string | null;
  businessScale?: string | null;
  branch: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    provinceCode?: number | null;
    wardCode?: number | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  photoCount: number;
  legalName?: string | null;
  /** Email liên hệ ban đầu — `legalName` bằng đúng nó nghĩa là ứng viên chưa nhập tên pháp lý. */
  contactEmail?: string | null;
  docStatuses: Partial<Record<(typeof REQUIRED_APPLICATION_DOCS)[number], string | null>>;
  termsAcceptedAt?: Date | null;
}

export interface MissingItem {
  section: ApplicationSection;
  message: string;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Liệt kê TẤT CẢ thứ còn thiếu trong một lượt (không dừng ở lỗi đầu tiên) để giao diện hiện
 * "Bạn còn N nội dung" kèm [Đi tới] cho từng mục. Không suy diễn quy tắc mới: tên/điện thoại/địa chỉ/
 * tỉnh/phường lấy đúng từ `gymCreateSchema` mà `gymDraftService.submitForReview` đang dùng; giấy tờ
 * bắt buộc lấy từ `REQUIRED_DOC_TYPES` của partner-diligence.
 */
export function computeMissing(input: CompletenessInput): MissingItem[] {
  const missing: MissingItem[] = [];
  const add = (section: ApplicationSection, message: string) => missing.push({ section, message });

  if (blank(input.representative.name)) add('REPRESENTATIVE', 'Chưa nhập họ tên người đại diện');
  if (blank(input.representative.phone)) add('REPRESENTATIVE', 'Chưa nhập số điện thoại người đại diện');
  if (blank(input.representative.role)) add('REPRESENTATIVE', 'Chưa chọn vai trò của người đại diện');

  if (blank(input.brandName)) add('BRAND', 'Chưa đặt tên thương hiệu');
  if (blank(input.businessScale)) add('SCALE', 'Chưa chọn quy mô (một hay nhiều chi nhánh)');

  const b = input.branch;
  if (!b) {
    add('BRANCH', 'Chưa tạo chi nhánh đầu tiên');
  } else {
    if (blank(b.name) || b.name === 'Chi nhánh mới') add('BRANCH', 'Chưa đặt tên chi nhánh');
    if (blank(b.phone)) add('BRANCH', 'Chưa nhập số điện thoại chi nhánh');
    if (blank(b.address)) add('LOCATION', 'Chưa nhập địa chỉ');
    if (!b.provinceCode) add('LOCATION', 'Chưa chọn tỉnh / thành phố');
    if (!b.wardCode) add('LOCATION', 'Chưa chọn phường / xã');
    if (b.latitude === null || b.latitude === undefined || b.longitude === null || b.longitude === undefined) {
      add('LOCATION', 'Chưa xác nhận vị trí trên bản đồ');
    }
  }

  if (input.photoCount < APPLICATION_MIN_PHOTOS) {
    add('PHOTOS', `Cần tối thiểu ${APPLICATION_MIN_PHOTOS} ảnh thật của cơ sở`);
  }

  if (blank(input.legalName) || (input.contactEmail && input.legalName === input.contactEmail)) {
    add('LEGAL', 'Chưa nhập tên pháp lý của doanh nghiệp');
  }
  for (const docType of REQUIRED_APPLICATION_DOCS) {
    const status = input.docStatuses[docType];
    // PENDING = chưa có tệp; các trạng thái còn lại đều nghĩa là đã có tệp trong hồ sơ.
    if (!status || status === 'PENDING') add('LEGAL', `Còn thiếu giấy tờ bắt buộc: ${docType}`);
  }

  if (!input.termsAcceptedAt) add('TERMS', 'Chưa chấp nhận điều khoản đối tác');

  return missing;
}
