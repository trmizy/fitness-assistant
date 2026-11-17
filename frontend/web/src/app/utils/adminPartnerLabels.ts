/**
 * FIX2-ADMIN (15/11/2026) - one place for the Vietnamese wording of the raw codes the admin partner screens used to print as they came
 * from the server (N14A-05 / N14G-08 / N14A-04): the partner "Nhật ký" actions, document types, the partner status inside a hint and
 * the approval blockers that embed a document type in their sentence. Unknown codes never reach the screen raw: they fall back to a
 * neutral sentence (actions) or a lower-cased, space-separated reading (inside free text).
 *
 * Pure (no React, no imports of components): runs under `npx tsx --test`.
 */

export const DOC_TYPE_VI: Record<string, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  REPRESENTATIVE_ID: "CCCD người đại diện",
  PREMISES_PROOF: "Giấy tờ mặt bằng",
  TAX_CODE_CERTIFICATE: "Giấy chứng nhận mã số thuế",
  SITE_PHOTOS: "Ảnh thực địa",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
};

/** Partner lifecycle status as a lower-case noun phrase for use inside a sentence. */
export const PARTNER_STATUS_PHRASE_VI: Record<string, string> = {
  PROSPECT: "tiềm năng",
  INVITED: "đã mời, chờ thiết lập",
  ACTIVE: "đang hoạt động",
  SUSPENDED: "đang tạm khoá",
  TERMINATED: "đã chấm dứt hợp tác",
};

/** Every `PartnerAuditAction` of gym-service's schema. */
export const PARTNER_AUDIT_ACTION_VI: Record<string, string> = {
  PARTNER_CREATED: "Tạo hồ sơ đối tác",
  PARTNER_UPDATED: "Cập nhật hồ sơ",
  ACCOUNT_PROVISIONED: "Cấp tài khoản",
  INVITATION_RESENT: "Gửi lại thư mời",
  INVITATION_REVOKED: "Thu hồi thư mời",
  PASSWORD_RESET_SENT: "Phát hành link đặt lại mật khẩu",
  SESSIONS_REVOKED: "Buộc đăng xuất",
  ACCOUNT_REVOKED: "Thu hồi tài khoản",
  OWNERSHIP_TRANSFERRED: "Chuyển quyền sở hữu",
  PARTNER_SUSPENDED: "Tạm khoá đối tác",
  PARTNER_UNSUSPENDED: "Bỏ tạm khoá đối tác",
  PARTNER_TERMINATED: "Chấm dứt hợp tác",
  VIEWED_AS_PARTNER: "Xem dưới góc nhìn đối tác",
  APPLICATION_SUBMITTED: "Gửi hồ sơ đăng ký",
  CHANGES_REQUESTED: "Yêu cầu chỉnh sửa hồ sơ",
  ISSUE_MARKED_UPDATED: "Ứng viên đánh dấu đã sửa",
  APPLICATION_RESUBMITTED: "Gửi lại hồ sơ đăng ký",
  ISSUE_RESOLVED: "Đóng vấn đề của hồ sơ",
  DOCUMENT_UPLOADED: "Tải lên giấy tờ",
  DOCUMENT_REPLACED: "Thay giấy tờ",
  DOCUMENT_ACCEPTED: "Chấp nhận giấy tờ",
  DOCUMENT_UPDATE_REQUESTED: "Yêu cầu cập nhật giấy tờ",
  APPLICATION_APPROVED: "Phê duyệt hồ sơ đăng ký",
  APPLICATION_REJECTED: "Từ chối hồ sơ đăng ký",
  APPLICATION_REOPENED: "Mở lại hồ sơ đăng ký",
  DOCUMENT_VIEWED: "Xem giấy tờ",
  LISTING_SUBMITTED: "Gửi tin giới thiệu chờ duyệt",
  LISTING_APPROVED: "Duyệt tin giới thiệu",
  LISTING_REJECTED: "Từ chối tin giới thiệu",
  LISTING_CHANGES_REQUESTED: "Yêu cầu sửa tin giới thiệu",
  LISTING_ADMIN_EDITED: "Quản trị viên sửa tin giới thiệu",
  AMENITY_PROPOSED: "Đề xuất tiện ích mới",
  AMENITY_PROPOSAL_APPROVED: "Duyệt tiện ích đề xuất",
  AMENITY_PROPOSAL_REJECTED: "Từ chối tiện ích đề xuất",
  AMENITY_PROPOSAL_MERGED: "Gộp tiện ích đề xuất vào tiện ích có sẵn",
  GYM_ADMIN_STATUS_CHANGED: "Đổi trạng thái chi nhánh",
  GYM_ADMIN_RENAME_APPROVED: "Duyệt đổi tên/địa chỉ chi nhánh",
  GYM_ADMIN_UPDATED: "Quản trị viên sửa thông tin chi nhánh",
};

const LIFECYCLE_ACTION_VI: Record<string, string> = {
  SUSPEND: "Tạm khoá chi nhánh",
  LIFT_SUSPENSION: "Bỏ tạm khoá chi nhánh",
  CLOSE_TEMPORARILY: "Tạm đóng cửa chi nhánh",
  REOPEN: "Mở cửa lại chi nhánh",
};

const BRANCH_STATUS_PHRASE_VI: Record<string, string> = {
  PENDING_REVIEW: "đang chờ duyệt",
  APPROVED: "đang hoạt động",
  REJECTED: "đã bị từ chối",
  SUSPENDED: "đang tạm khoá",
  OPEN: "đang mở cửa",
  TEMPORARILY_CLOSED: "tạm đóng cửa",
  PERMANENTLY_CLOSED: "đã đóng cửa vĩnh viễn",
};

/** "BUSINESS_LICENSE" -> "Giấy phép kinh doanh"; an unknown type reads as plain words, never as the code. */
export function docTypeVi(code: string | null | undefined): string {
  if (!code) return "Giấy tờ";
  return DOC_TYPE_VI[code] ?? readableCode(code);
}

/** "SOME_UNKNOWN_CODE" -> "some unknown code" (only used where no better wording exists). */
export function readableCode(code: string): string {
  return code.toLowerCase().replace(/_+/g, " ").trim();
}

/** The sentence for one partner audit row; `metadata` (optional) sharpens the status-change rows. Never returns the raw code. */
export function partnerAuditActionVi(action: string | null | undefined, metadata?: unknown): string {
  if (!action) return "Thao tác khác";
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : null;
  if (action === "GYM_ADMIN_STATUS_CHANGED" && m && typeof m.lifecycleAction === "string" && LIFECYCLE_ACTION_VI[m.lifecycleAction]) {
    return LIFECYCLE_ACTION_VI[m.lifecycleAction];
  }
  return PARTNER_AUDIT_ACTION_VI[action] ?? "Thao tác khác";
}

/** A short second line for an audit row (the document it was about, the old -> new branch status); null when there is nothing to add. */
export function partnerAuditDetailVi(action: string | null | undefined, metadata?: unknown): string | null {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : null;
  if (!m) return null;
  if (typeof m.docType === "string") return docTypeVi(m.docType);
  if (action === "GYM_ADMIN_STATUS_CHANGED" && typeof m.from === "string" && typeof m.to === "string") {
    const from = BRANCH_STATUS_PHRASE_VI[m.from];
    const to = BRANCH_STATUS_PHRASE_VI[m.to];
    if (from && to) return `Từ "${from}" sang "${to}"`;
  }
  return null;
}

const CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const PLAIN_PARTNER_STATUS = /\b(PROSPECT|INVITED|SUSPENDED|TERMINATED)\b/g;

/**
 * Free text from the server or a hint that may carry a raw code ("Giấy tờ BUSINESS_LICENSE chưa được chấp nhận", "(PROSPECT)"):
 * known document types / partner statuses become Vietnamese, any other UPPER_SNAKE token becomes lower-case words.
 */
export function humanizeCodes(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(CODE_TOKEN, (t) => (DOC_TYPE_VI[t] ? `"${DOC_TYPE_VI[t]}"` : readableCode(t)))
    .replace(PLAIN_PARTNER_STATUS, (t) => PARTNER_STATUS_PHRASE_VI[t] ?? t);
}
