/**
 * N15M-07/08/09/10 — what each internal partner role gets in the gym workspace on the phone.
 *
 * Mirrors web's `utils/gymStaffRole.ts` (which itself mirrors gym-service `partner-permissions.ts`,
 * default-deny). It only decides what to SHOW: a mistake here can at worst surface a 403, it never
 * grants anything. The matrix, for the parts this app cares about:
 *
 *   OWNER         Tổng quan · Phòng gym · Ví · Hồ sơ
 *   MANAGER       Tổng quan · Phòng gym · Hồ sơ
 *   RECEPTIONIST  Quầy lễ tân (branch, QR, check-in hộ, khách hôm nay) · Hồ sơ
 *                 — 403 on /owner/brands, memberships, plans, wallet: those blocks are never drawn
 *   ACCOUNTANT    Tài chính (read-only: sales, wallet, withdrawals, PT commission totals) · Hồ sơ
 */
export type StaffRole = "OWNER" | "MANAGER" | "RECEPTIONIST" | "ACCOUNTANT";

/** Short label under the user's name — the REAL role, never "Quản lý chi nhánh" for everyone. */
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: "Chủ phòng gym",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

export type StaffTabName = "dashboard" | "gyms" | "wallet" | "front-desk" | "finance" | "profile";

export const ALL_STAFF_TABS: StaffTabName[] = ["dashboard", "gyms", "wallet", "front-desk", "finance", "profile"];

function roleOf(onboardingStatus: unknown): StaffRole | null {
  const role = (onboardingStatus as { role?: unknown } | null | undefined)?.role;
  return role === "OWNER" || role === "MANAGER" || role === "RECEPTIONIST" || role === "ACCOUNTANT" ? role : null;
}

/**
 * Label for the badge on "Hồ sơ". A legacy owner row has no role on the status (isBrandOwner treats
 * that as OWNER), so no role reads as the owner; a role this app does not know falls back to the
 * neutral "Nhân sự phòng gym" instead of a wrong specific one.
 */
export function staffRoleLabel(onboardingStatus: unknown): string {
  const raw = (onboardingStatus as { role?: unknown } | null | undefined)?.role;
  if (raw == null) return STAFF_ROLE_LABEL.OWNER;
  const role = roleOf(onboardingStatus);
  return role ? STAFF_ROLE_LABEL[role] : "Nhân sự phòng gym";
}

/** Tabs shown for the role. Role not known yet (status still loading / unreadable) → the owner/manager bar, as before. */
export function staffTabsFor(onboardingStatus: unknown): StaffTabName[] {
  const role = roleOf(onboardingStatus);
  const manager = role === "MANAGER";
  if (role === "RECEPTIONIST") return ["front-desk", "profile"];
  if (role === "ACCOUNTANT") return ["finance", "profile"];
  if (manager) return ["dashboard", "gyms", "profile"];
  return ["dashboard", "gyms", "wallet", "profile"];
}

/** Where a role starts. Landing config points every gym login at the dashboard; narrow roles are sent on from there. */
export function staffHomeRoute(onboardingStatus: unknown): string {
  const role = roleOf(onboardingStatus);
  if (role === "RECEPTIONIST") return "/gym-owner/front-desk";
  if (role === "ACCOUNTANT") return "/gym-owner/finance";
  return "/gym-owner/dashboard";
}

/** The operations dashboard reads memberships (owner/manager only — receptionist and accountant get 403). */
export function canUseOperationsDashboard(onboardingStatus: unknown): boolean {
  const role = roleOf(onboardingStatus);
  return role === null || role === "OWNER" || role === "MANAGER";
}

/** `GET /owner/brands` — brand.view: owner, manager, accountant. Never the receptionist. */
export function canReadBrands(onboardingStatus: unknown): boolean {
  const role = roleOf(onboardingStatus);
  return role === null || role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";
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
