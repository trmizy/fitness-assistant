/**
 * Listing Management (Phase D1) — error codes → Vietnamese, shared by the PT page, the admin page and the
 * client contract request. Every refusal of user-service / gym-service listing routes is
 * `{ success:false, error:{ code, message }, message, ...extra }` (sendError / sendListingError), and the
 * legacy contract route answers `{ code, error: "<message>" }`; both are read here.
 *
 * Pure: runs under `npx tsx --test`.
 */
import type { PtListingRevision } from "../types";
import { COPY_FROM_CLOSED_DAYS, normalizeRevision } from "./ptListing";

export const LISTING_ERROR_VI: Record<string, string> = {
  // ── shared validation / state ──
  VALIDATION_FAILED: "Thông tin chưa hợp lệ. Hãy kiểm tra lại các ô đã nhập.",
  NO_CHANGES: "Chưa có thay đổi nào so với tin đăng hiện tại.",
  NO_OPEN_REVISION: "Chưa có bản nháp nào đang mở. Hãy bắt đầu một bản sửa mới.",
  OPEN_REVISION_EXISTS: "Đang có một bản sửa chưa hoàn tất. Đã tải lại để tiếp tục.",
  REVISION_NOT_FOUND: "Không tìm thấy bản sửa này.",
  REVISION_CLOSED: "Bản sửa này đã được xử lý. Đã tải lại bản mới nhất.",
  REVISION_UNDER_REVIEW: "Bản sửa đang chờ duyệt nên chưa sửa được. Hãy rút lại bản sửa nếu muốn chỉnh tiếp.",
  REVISION_NOT_PENDING: "Bản sửa này không còn ở trạng thái chờ duyệt (đã được xử lý). Đã tải lại.",
  ALREADY_DECIDED: "Bản sửa này đã được người khác xử lý. Đã tải lại.",
  REVISION_CONFLICT: "Không thực hiện được lúc này. Vui lòng thử lại.",
  REVISION_NOT_CLOSED: "Bản sửa này vẫn đang mở nên không chép lại được.",
  REVISION_TOO_OLD_TO_COPY: `Chỉ chép lại được bản sửa đã đóng trong ${COPY_FROM_CLOSED_DAYS} ngày gần đây.`,
  DRAFT_STALE: "Bản nháp đã được thay đổi ở nơi khác (ví dụ trên một thẻ trình duyệt khác).",
  LISTING_STALE: "Tin đăng công khai đã thay đổi từ khi bắt đầu sửa. Đã tải lại bản mới nhất.",
  LISTING_REVIEW_REQUIRED: "Thay đổi này cần gửi duyệt. Hãy chỉnh trong mục Tin đăng rồi gửi duyệt.",

  // ── who ──
  NOT_A_PT: "Chỉ huấn luyện viên mới quản lý được tin đăng.",
  PT_NOT_APPROVED: "Hồ sơ huấn luyện viên chưa được duyệt nên chưa có tin đăng.",
  PT_NOT_FOUND: "Không tìm thấy hồ sơ huấn luyện viên.",
  GYM_NOT_FOUND: "Không tìm thấy chi nhánh.",
  GYM_IS_DRAFT: "Chi nhánh còn ở bước nháp nên chưa có tin đăng để sửa.",
  LISTING_NOT_AVAILABLE: "Chi nhánh này hiện chưa có tin đăng để sửa.",

  // ── photos ──
  PHOTO_LIMIT: "Đã đạt giới hạn số ảnh của tin đăng. Hãy gỡ bớt một ảnh trước khi thêm.",
  PHOTO_DUPLICATE: "Một ảnh không thể xuất hiện hai lần trong tin đăng.",
  PHOTO_NOT_OWNED: "Có ảnh không còn dùng được. Hãy tải lại rồi thêm ảnh lại.",
  PHOTO_NOT_FOUND: "Không tìm thấy ảnh này (có thể đã được xóa).",
  PHOTO_NOT_PUBLISHED: "Quản trị viên chỉ được sắp xếp hoặc gỡ ảnh đang công khai, không thêm ảnh mới của huấn luyện viên.",
  PHOTO_PUBLISHED: "Ảnh đang hiển thị công khai. Hãy gỡ ảnh khỏi bản sửa rồi gửi duyệt.",
  PHOTO_IN_REVIEW: "Ảnh đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi xóa ảnh.",
  PHOTO_SET_MISMATCH: "Danh sách ảnh không khớp với ảnh hiện có. Hãy tải lại rồi thử lại.",
  COVER_NOT_IN_PHOTOS: "Ảnh bìa phải là một trong các ảnh của tin đăng.",
  UPLOADS_UNAVAILABLE: "Tính năng tải ảnh hiện chưa sẵn sàng. Vui lòng thử lại sau.",
  PARTNER_REQUIRED: "Chi nhánh này chưa gắn với hồ sơ đối tác nên chưa tải ảnh lên được.",
  STAGED_LIMIT: "Có quá nhiều ảnh đã tải lên mà chưa dùng. Hãy xóa bớt ảnh chưa dùng trước khi tải thêm.",
  TOO_MANY_UPLOADS: "Đang tải quá nhiều ảnh cùng lúc. Vui lòng thử lại sau ít phút.",
  UPLOAD_NOT_FOUND: "Lượt tải ảnh không còn hiệu lực. Hãy chọn ảnh và tải lại.",
  INTENT_EXPIRED: "Lượt tải ảnh đã hết hạn. Hãy tải ảnh lại.",
  INTENT_ALREADY_USED: "Lượt tải ảnh này đã được xử lý.",
  UPLOAD_CONFLICT: "Chưa lưu được ảnh. Vui lòng thử lại.",
  IMAGE_MISSING: "Chưa thấy tệp ảnh nào được tải lên. Hãy thử lại.",
  IMAGE_TOO_LARGE: "Ảnh vượt quá 8 MB. Hãy chọn ảnh nhỏ hơn.",
  IMAGE_INVALID: "Ảnh bị hỏng hoặc không đúng định dạng JPEG, PNG, WebP. Hãy chọn ảnh khác.",

  // ── packages ──
  PACKAGE_LIMIT: "Mỗi huấn luyện viên có tối đa 10 gói đang bán.",
  PACKAGE_DUPLICATE: "Một gói không thể xuất hiện hai lần trong tin đăng.",
  PACKAGE_NOT_OWNED: "Có gói không còn dùng được. Hãy tải lại bản nháp.",
  PACKAGE_CHANGED: "Gói dịch vụ đã thay đổi. Hãy xem lại giá và nội dung mới.",

  // ── gym amenities / proposals ──
  AMENITIES_REQUIRED: "Tin đăng phải có ít nhất một tiện ích.",
  AMENITY_UNKNOWN: "Có tiện ích không có trong danh mục.",
  AMENITY_DISABLED: "Bản sửa có tiện ích đã ngừng trong danh mục. Chọn \"Duyệt và bỏ tiện ích đã tắt\" để tiếp tục.",
  AMENITY_PROPOSAL_DEAD: "Bản sửa còn tiện ích đề xuất đã bị từ chối hoặc huỷ. Chọn \"Duyệt và bỏ tiện ích bị từ chối\" để tiếp tục.",
  CUSTOM_AMENITY_PENDING: "Bản sửa còn tiện ích tùy chỉnh đang chờ duyệt. Hãy xử lý các đề xuất tiện ích trước.",
  AMENITY_NOT_FOUND: "Không tìm thấy tiện ích này.",
  AMENITY_NAME_TAKEN: "Đã có tiện ích với tên này trong danh mục.",
  AMENITY_ALREADY_EXISTS: "Tiện ích này đã có trong danh mục.",
  AMENITY_CONFLICT: "Chưa tạo được tiện ích. Vui lòng thử lại.",
  AMENITY_EXISTS_DISABLED: "Đã có tiện ích cùng tên nhưng đang bị tắt. Hãy chọn \"Bật lại và gộp\" hoặc từ chối.",
  PROPOSAL_NOT_FOUND: "Không tìm thấy đề xuất này.",
  PROPOSAL_ALREADY_DECIDED: "Đề xuất này vừa được người khác xử lý. Đã tải lại danh sách.",
  PROPOSAL_GROUP_MISMATCH: "Các đề xuất duyệt cùng lúc phải cùng loại và cùng tên.",
  PROPOSAL_INVALID: "Có đề xuất không còn hiệu lực.",
  NAME_INVALID: "Tên tiện ích không hợp lệ.",
  NAME_MISMATCH: "Tên hiển thị phải trùng với tên chủ gym đã đề xuất (không tính dấu và chữ hoa).",
  ICON_NOT_ALLOWED: "Biểu tượng này không nằm trong danh sách cho phép.",
};

export interface ListingErrorInfo {
  status: number | null;
  code: string | null;
  /** The server's own sentence (Vietnamese for listing errors), if any. */
  serverMessage: string | null;
  body: any;
}

/** Unwraps an axios error into code / status / body. Never throws. */
export function listingErrorInfo(error: unknown): ListingErrorInfo {
  const e: any = (error as any)?.original ?? error;
  const body = e?.response?.data;
  const code =
    (typeof body?.error?.code === "string" && body.error.code) || (typeof body?.code === "string" && body.code) || null;
  const msg =
    (typeof body?.error?.message === "string" && body.error.message) ||
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    null;
  return { status: typeof e?.response?.status === "number" ? e.response.status : null, code, serverMessage: msg, body };
}

const VIETNAMESE_LETTER = /[ăâđêôơưÀ-ỹ]/;

export function listingErrorMessage(error: unknown, fallback = "Có lỗi xảy ra. Vui lòng thử lại."): string {
  const info = listingErrorInfo(error);
  if (info.code && LISTING_ERROR_VI[info.code]) return LISTING_ERROR_VI[info.code];
  if (info.status === 401) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (info.status === 403) return "Tài khoản của bạn không có quyền thực hiện thao tác này.";
  if (info.status === 404) return "Không tìm thấy nội dung này (có thể đã bị xóa).";
  if (info.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  if (info.status === 503) return "Hệ thống đang bận. Vui lòng thử lại sau.";
  if (info.status === null) {
    const own = (error as any)?.message;
    if (typeof own === "string" && VIETNAMESE_LETTER.test(own)) return own;
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (info.serverMessage && VIETNAMESE_LETTER.test(info.serverMessage)) return info.serverMessage;
  return fallback;
}

export const errorCodeOf = (e: unknown): string | null => listingErrorInfo(e).code;
export const isDraftStale = (e: unknown) => errorCodeOf(e) === "DRAFT_STALE";
export const isListingStale = (e: unknown) => errorCodeOf(e) === "LISTING_STALE";
/** The old package write routes answer this now (pt_service_package.controller.ts). */
export const isReviewRequired = (e: unknown) => errorCodeOf(e) === "LISTING_REVIEW_REQUIRED";

/** 409s after which the screen must simply re-read the listing (something moved the revision). */
export function needsReload(e: unknown): boolean {
  const code = errorCodeOf(e);
  return (
    code === "OPEN_REVISION_EXISTS" ||
    code === "REVISION_CLOSED" ||
    code === "REVISION_UNDER_REVIEW" ||
    code === "REVISION_NOT_PENDING" ||
    code === "REVISION_CONFLICT" ||
    code === "NO_OPEN_REVISION"
  );
}

/** The revision a 409 DRAFT_STALE / LISTING_STALE carried (the server's CURRENT draft), if any. */
export const staleRevisionOf = (e: unknown): PtListingRevision | null => normalizeRevision(listingErrorInfo(e).body?.revision);

/**
 * Admin side: 409s after which the list / detail on screen is wrong and must be re-fetched
 * (someone else decided the revision, the public listing moved, the proposal was decided).
 */
export const ADMIN_REFETCH_CODES = [
  "REVISION_NOT_PENDING",
  "ALREADY_DECIDED",
  "REVISION_CLOSED",
  "LISTING_STALE",
  "PROPOSAL_ALREADY_DECIDED",
  "PROPOSAL_NOT_FOUND",
  "AMENITY_NAME_TAKEN",
  "REVISION_NOT_FOUND",
] as const;

export function adminNeedsRefetch(e: unknown): boolean {
  const code = errorCodeOf(e);
  return !!code && (ADMIN_REFETCH_CODES as readonly string[]).includes(code);
}

/** 409 AMENITY_EXISTS_DISABLED carries the catalogue row that has the name. */
export function readAmenityExistsDisabled(e: unknown): { id: string; name: string } | null {
  const info = listingErrorInfo(e);
  if (info.status !== 409 || info.code !== "AMENITY_EXISTS_DISABLED") return null;
  const a = info.body?.amenity;
  return a && typeof a.id === "string" ? { id: a.id, name: String(a.name ?? "") } : { id: "", name: "" };
}

/** The approve refusals that the admin answers with a checkbox / a link instead of a retry. */
export type ApproveBlock = "CUSTOM_AMENITY_PENDING" | "AMENITY_DISABLED" | "AMENITY_PROPOSAL_DEAD";
export function readApproveBlock(e: unknown): ApproveBlock | null {
  const code = errorCodeOf(e);
  return code === "CUSTOM_AMENITY_PENDING" || code === "AMENITY_DISABLED" || code === "AMENITY_PROPOSAL_DEAD" ? code : null;
}

// ── contract request: PACKAGE_CHANGED ────────────────────────────────────────────────────────
export const PACKAGE_CHANGED_TITLE = "Gói đã thay đổi — xem giá mới";
export const PACKAGE_CHANGED_MESSAGE =
  "Huấn luyện viên vừa cập nhật gói này sau khi bạn mở trang. Hãy xem lại giá và nội dung mới trước khi gửi yêu cầu.";

/** 409 PACKAGE_CHANGED: the body carries the package as it is NOW (with its version), when the server could attach it. */
export function readPackageChanged(error: unknown): { current: Record<string, any> | null } | null {
  const info = listingErrorInfo(error);
  if (info.status !== 409 || info.code !== "PACKAGE_CHANGED") return null;
  const pkg = info.body?.package;
  return { current: pkg && typeof pkg === "object" ? pkg : null };
}

/** 404 on the trainer detail: hidden, suspended or no longer approved — the id cannot be probed past the list. */
export const isPtGone = (error: unknown): boolean => listingErrorInfo(error).status === 404;
