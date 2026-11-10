/**
 * D15 — vai trò nội bộ trong một đối tác gym (CHỈ để điều hướng/ẩn hiện UI). Nguồn quyền thật là backend
 * (gym-service/src/services/partner-permissions.ts, mặc định từ chối): bảng dưới đây phản chiếu nó để không
 * hiển thị nút/trang mà server chắc chắn từ chối. Sai lệch ở đây chỉ làm người dùng thấy lỗi 403, không bao
 * giờ mở thêm quyền.
 */

export type PartnerRole = "OWNER" | "MANAGER" | "RECEPTIONIST" | "ACCOUNTANT";

export const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = {
  OWNER: "Chủ sở hữu",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán (chỉ xem)",
};

/** Các trang của vùng /gym-owner mà từng vai trò được vào. */
export type StaffFeature =
  | "dashboard"
  | "gyms"
  | "gymManage"
  | "gymWizard"
  | "listings"
  | "plans"
  | "collaborations"
  | "staff"
  | "frontDesk"
  | "finance"
  | "complaintCases"
  | "profile";

const ALLOWED: Record<StaffFeature, readonly PartnerRole[]> = {
  dashboard: ["OWNER", "MANAGER"],
  gyms: ["OWNER", "MANAGER"],
  gymManage: ["OWNER", "MANAGER"],
  gymWizard: ["OWNER"],
  // Listing Management D2 — gym-service owner-listing routes are requirePartnerOwner (a MANAGER gets 403).
  listings: ["OWNER"],
  plans: ["OWNER", "MANAGER"],
  collaborations: ["OWNER"],
  staff: ["OWNER"],
  frontDesk: ["OWNER", "MANAGER", "RECEPTIONIST"],
  finance: ["OWNER", "ACCOUNTANT"],
  // gym-service explainer.service.ts (EXPLAINER_ROLES): chủ và quản lý (đúng chi nhánh được giao); lễ tân/kế toán không thấy gì.
  complaintCases: ["OWNER", "MANAGER"],
  profile: ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
};

export function canUseFeature(role: PartnerRole | undefined, feature: StaffFeature): boolean {
  return !!role && ALLOWED[feature].includes(role);
}

/** Trang chủ của từng vai trò — nơi đăng nhập xong, hoặc bị đẩy về khi vào trang không được phép. */
export function homePathFor(role: PartnerRole | undefined): string {
  switch (role) {
    case "RECEPTIONIST":
      return "/gym-owner/front-desk";
    case "ACCOUNTANT":
      return "/gym-owner/finance";
    default:
      return "/gym-owner/dashboard";
  }
}

const KNOWN: readonly PartnerRole[] = ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"];
export function normalizePartnerRole(value: unknown): PartnerRole | undefined {
  return KNOWN.includes(value as PartnerRole) ? (value as PartnerRole) : undefined;
}

/**
 * Quyền ĐỌC theo từng endpoint của gym-service (phản chiếu partner-permissions.ts) — để trang không gọi endpoint
 * mà server chắc chắn trả 403 (ND-01 / ND-02). Chưa biết vai trò (undefined) → false (fail-closed).
 *   ví chi nhánh / yêu cầu rút tiền : finance.wallet.view, finance.withdrawals.view → OWNER, ACCOUNTANT
 *   cộng tác PT của chủ              : requirePartnerOwner                          → OWNER
 *   thương hiệu                      : brand.view                                   → OWNER, MANAGER, ACCOUNTANT (không có lễ tân)
 */
export function canViewWallet(role: PartnerRole | undefined): boolean {
  return role === "OWNER" || role === "ACCOUNTANT";
}
export function canViewCollaborations(role: PartnerRole | undefined): boolean {
  return role === "OWNER";
}
export function canViewBrands(role: PartnerRole | undefined): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";
}
