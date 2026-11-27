/**
 * N15M-07/08/09/10 — what each internal partner role gets in the gym workspace on the phone.
 *
 * Mirrors web's `utils/gymStaffRole.ts` (which itself mirrors gym-service `partner-permissions.ts`,
 * default-deny). It only decides what to SHOW: a mistake here can at worst surface a 403, it never
 * grants anything. The matrix, for the parts this app cares about:
 *
 *   OWNER         Tổng quan · Phòng gym · Quầy lễ tân · Tài chính (có lối vào Ví và rút tiền) · Hồ sơ
 *   MANAGER       Tổng quan · Phòng gym · Quầy lễ tân · Hồ sơ
 *   RECEPTIONIST  Quầy lễ tân (branch, QR, check-in hộ, khách hôm nay) · Hồ sơ
 *                 — 403 on /owner/brands, memberships, plans, wallet: those blocks are never drawn
 *   ACCOUNTANT    Tài chính (read-only: sales, wallet, withdrawals, PT commission totals) · Hồ sơ
 */
import { hasPartnerPermission } from "./permissions";

export type StaffRole = "OWNER" | "MANAGER" | "RECEPTIONIST" | "ACCOUNTANT";

/** Short label under the user's name — the REAL role, never "Quản lý chi nhánh" for everyone. */
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: "Chủ phòng gym",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

export type StaffTabName = "dashboard" | "gyms" | "front-desk" | "finance" | "profile";

export const ALL_STAFF_TABS: StaffTabName[] = ["dashboard", "gyms", "front-desk", "finance", "profile"];

/**
 * "Ví" không còn là một tab (đã gộp vào "Tài chính", còn 5 tab): `/gym-owner/wallet` vẫn là một route ẨN trong cùng nhóm tab,
 * nên liên kết cũ / thông báo cũ vẫn mở đúng màn. Lối vào duy nhất từ giao diện là mục "Ví & rút tiền" trong Tài chính.
 */
export const WALLET_ROUTE = "/gym-owner/wallet";

function roleOf(onboardingStatus: unknown): StaffRole | null {
  const role = (onboardingStatus as { role?: unknown } | null | undefined)?.role;
  return role === "OWNER" || role === "MANAGER" || role === "RECEPTIONIST" || role === "ACCOUNTANT" ? role : null;
}

/**
 * Label for the badge on "Hồ sơ". Fail-closed (22/11/2026): no role (still loading / unreadable) or a role this app does not
 * know reads as the neutral "Nhân sự phòng gym" — never as the owner. (A legacy owner row without a partner account still
 * answers role OWNER from gym-service, so a real owner is not affected.)
 */
export function staffRoleLabel(onboardingStatus: unknown): string {
  const role = roleOf(onboardingStatus);
  return role ? STAFF_ROLE_LABEL[role] : "Nhân sự phòng gym";
}

/**
 * Tabs shown for the role. Role not known yet (status still loading / unreadable) → ONLY "Hồ sơ" (fail-closed, as web shows no
 * menu until the role is known); the tab bar fills in as soon as the status arrives.
 *
 * Item 6: "Quầy lễ tân" is for owner AND manager (it carries the pending check-in exception badge), "Tài chính" for the owner
 * (in this group; the accountant has it as its home). "Ví" is no longer a tab: it is a drill-down of "Tài chính" (WALLET_ROUTE).
 */
export function staffTabsFor(onboardingStatus: unknown): StaffTabName[] {
  const role = roleOf(onboardingStatus);
  if (role === "OWNER") return ["dashboard", "gyms", "front-desk", "finance", "profile"];
  if (role === "MANAGER") return ["dashboard", "gyms", "front-desk", "profile"];
  if (role === "RECEPTIONIST") return ["front-desk", "profile"];
  if (role === "ACCOUNTANT") return ["finance", "profile"];
  return ["profile"];
}

/** Where a role starts. Landing config points every gym login at the dashboard; narrow roles are sent on from there. */
export function staffHomeRoute(onboardingStatus: unknown): string {
  const role = roleOf(onboardingStatus);
  if (role === "RECEPTIONIST") return "/gym-owner/front-desk";
  if (role === "ACCOUNTANT") return "/gym-owner/finance";
  return "/gym-owner/dashboard";
}

/** The operations dashboard reads memberships (owner/manager only — receptionist, accountant and an unknown role: no). */
export function canUseOperationsDashboard(onboardingStatus: unknown): boolean {
  const role = roleOf(onboardingStatus);
  return role === "OWNER" || role === "MANAGER";
}

/** `GET /owner/brands` — brand.view: owner, manager, accountant. Never the receptionist, never an unknown role. */
export function canReadBrands(onboardingStatus: unknown): boolean {
  const role = roleOf(onboardingStatus);
  return role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";
}

/** The front desk (member lookup, assisted check-in, today's guests): owner, manager, receptionist. */
export function canUseFrontDesk(onboardingStatus: unknown): boolean {
  const role = roleOf(onboardingStatus);
  return role === "OWNER" || role === "MANAGER" || role === "RECEPTIONIST";
}

/**
 * Which trainer list the check-in screen may call. `pt-checkins` (full history, scan counts) is
 * owner/manager; the receptionist only has `pt-checkins/today` (name + time).
 */
export function ptCheckinListMode(onboardingStatus: unknown): "all" | "today" {
  return roleOf(onboardingStatus) === "RECEPTIONIST" ? "today" : "all";
}

/**
 * Lối vào "Ví & rút tiền" trong Tài chính. Cần CẢ `finance.wallet.view` và `finance.withdraw` trong `permissions[]` của server
 * (hiện chỉ chủ sở hữu) - đúng tập vai trò từng có tab "Ví". Kế toán vẫn đọc số dư/lịch sử ngay trong Tài chính nhưng không có lối
 * vào màn rút tiền. Vai trò chưa biết / backend cũ chưa trả `permissions` → false (fail-closed).
 */
export function canOpenWalletDrilldown(onboardingStatus: unknown): boolean {
  return hasPartnerPermission(onboardingStatus, "finance.wallet.view") && hasPartnerPermission(onboardingStatus, "finance.withdraw");
}

/**
 * Route `/gym-owner/wallet` (nay là route ẩn): vai trò đã biết nhưng không được xem ví → đường dẫn về trang chủ của vai trò đó,
 * thay vì một ngõ cụt. `null` = ở lại (được xem, hoặc chưa có phản hồi trạng thái: màn tự hiện trạng thái chờ / đóng).
 */
export function walletRouteRedirect(onboardingStatus: unknown): string | null {
  if (onboardingStatus == null) return null;
  return hasPartnerPermission(onboardingStatus, "finance.wallet.view") ? null : staffHomeRoute(onboardingStatus);
}
