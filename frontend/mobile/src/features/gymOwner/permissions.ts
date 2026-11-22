/**
 * Item 5 (Ngài chốt 22/11/2026) — MỘT nguồn sự thật cho nút GHI trên điện thoại, đúng như web
 * (`utils/gymStaffRole.ts` → `hasPartnerPermission`). Backend trả `permissions[]` của vai trò trong
 * `GET /owner/onboarding/status` (gym-service `partner-permissions.ts` → `permissionsOf`); app chỉ HỎI
 * danh sách đó, không giữ bảng quyền thứ hai cho các nút ghi.
 *
 * FAIL-CLOSED: chưa biết vai trò, danh sách thiếu / sai kiểu, hoặc backend cũ chưa trả `permissions`
 * → KHÔNG có quyền nào. Hậu quả chỉ là nút ghi biến mất (màn vẫn xem được, chỉ-đọc); máy chủ vẫn là cổng thật
 * (403 OWNER_ROLE_REQUIRED). Không bao giờ mặc định "chủ sở hữu" khi chưa biết.
 */
export type PartnerPermission =
  | "staff.manage" | "brand.write" | "branch.write" | "branch.status.permanent" | "plan.write" | "collaboration.manage" | "finance.withdraw" | "listing.manage"
  | "branch.view" | "brand.view" | "plan.view" | "membership.full" | "membership.sales" | "checkin.qr" | "checkin.list" | "ptCheckin.list" | "ptCheckin.today"
  | "frontDesk.clients" | "member.search" | "checkin.assisted" | "checkin.exception.request" | "checkin.exception.approve" | "branch.status.temporary"
  | "finance.wallet.view" | "finance.withdrawals.view" | "finance.export" | "finance.ptCommission.view";

const KNOWN_ROLES = ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const;

/** Danh sách quyền hợp lệ từ phản hồi server: không phải mảng → rỗng; phần tử không phải chuỗi bị bỏ. */
export function normalizePermissions(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
}

/**
 * `onboardingStatus` là phản hồi THÔ của `GET /owner/onboarding/status`. Vai trò phải là một vai trò đã biết VÀ
 * `permissions` phải liệt kê đúng quyền đó. Mọi trường hợp khác (đang tải, lỗi, backend cũ) → false.
 */
export function hasPartnerPermission(onboardingStatus: unknown, permission: PartnerPermission): boolean {
  const s = (onboardingStatus ?? null) as { role?: unknown; permissions?: unknown } | null;
  const role = s?.role;
  if (!KNOWN_ROLES.includes(role as (typeof KNOWN_ROLES)[number])) return false;
  return normalizePermissions(s?.permissions).includes(permission);
}

/** `can(permission)` đóng gói quanh một phản hồi trạng thái (có thể là undefined khi đang tải). */
export function permissionChecker(onboardingStatus: unknown): (permission: PartnerPermission) => boolean {
  return (permission) => hasPartnerPermission(onboardingStatus, permission);
}
