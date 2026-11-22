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

/** Nhãn ngắn hiển thị dưới tên người dùng (chip hồ sơ, menu tài khoản) — đúng vai trò thật, không gộp chung "Chủ phòng gym". */
export const PARTNER_ROLE_CHIP_LABEL: Record<PartnerRole, string> = {
  OWNER: "Chủ phòng gym",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

/** Các trang của vùng /gym-owner mà từng vai trò được vào. */
export type StaffFeature =
  | "dashboard"
  | "gyms"
  | "gymManage"
  | "gymWizard"
  | "listings"
  | "plans"
  | "members"
  | "collaborations"
  | "partners"
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
  // G3 (Hội viên & gói, behind VITE_GYM_OWNER_V2): membership.full O,M / membership.sales O,A and plan.view O,M,A (audit/02). Plan writes stay owner-only.
  members: ["OWNER", "MANAGER", "ACCOUNTANT"],
  collaborations: ["OWNER"],
  // G4 (Đối tác PT, behind VITE_GYM_OWNER_V2 ONLY: routes.tsx and the new nav use it, the legacy page keeps "collaborations").
  // OWNER agreements; MANAGER "PT check-in tại chi nhánh" (ptCheckin.list O,M); ACCOUNTANT "Hoa hồng PT" (finance.ptCommission.view O,A).
  partners: ["OWNER", "MANAGER", "ACCOUNTANT"],
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

/**
 * Item 5 (Ngài chốt): MỘT nguồn sự thật cho nút GHI. Backend trả `permissions[]` của vai trò trong GET /owner/onboarding/status
 * (gym-service partner-permissions.ts `permissionsOf`) và FE chỉ HỎI danh sách đó — không tự giữ bảng quyền thứ hai cho các nút ghi.
 * Chưa biết vai trò, danh sách thiếu / sai kiểu / backend cũ chưa trả `permissions` → KHÔNG có quyền nào (fail-closed): chỉ làm nút ghi
 * biến mất, trang vẫn xem được ở chế độ chỉ-đọc, và server vẫn là cổng thật.
 */
export type PartnerPermission =
  | "staff.manage" | "brand.write" | "branch.write" | "branch.status.permanent" | "plan.write" | "collaboration.manage" | "finance.withdraw" | "listing.manage"
  | "branch.view" | "brand.view" | "plan.view" | "membership.full" | "membership.sales" | "checkin.qr" | "checkin.list" | "ptCheckin.list" | "ptCheckin.today"
  | "frontDesk.clients" | "member.search" | "checkin.assisted" | "checkin.exception.request" | "checkin.exception.approve" | "branch.status.temporary"
  | "finance.wallet.view" | "finance.withdrawals.view" | "finance.export" | "finance.ptCommission.view";

/** Danh sách quyền hợp lệ từ phản hồi server: không phải mảng → rỗng; phần tử không phải chuỗi bị bỏ. */
export function normalizePermissions(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
}

/** `role` phải là một vai trò đã biết VÀ `permissions` phải liệt kê đúng quyền đó. Mọi trường hợp khác → false. */
export function hasPartnerPermission(role: unknown, permissions: unknown, permission: PartnerPermission): boolean {
  return normalizePartnerRole(role) !== undefined && normalizePermissions(permissions).includes(permission);
}
