/**
 * GAP-21 (MOBILE_BACKEND_GAPS.md) — how the admin aggregates (`GET /admin/dashboard`,
 * `GET /admin/users`) label an auth-service account.
 *
 * Before this, both routes mapped every non-PT role to "Client" (so GYM_OWNER accounts showed as
 * clients and fell out of the dashboard's role breakdown entirely), and `/admin/users` hard-coded
 * `status: "Active"` even though auth-service already returns `isActive` — a locked account kept
 * showing as active. Kept in one place so the two routes cannot drift apart again.
 */

export type AdminAuthRole = "ADMIN" | "CUSTOMER" | "PT" | "GYM_OWNER";

export function adminRoleLabel(role: string | null | undefined): "Admin" | "PT" | "Gym Owner" | "Client" {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "PT":
      return "PT";
    case "GYM_OWNER":
      return "Gym Owner";
    default:
      return "Client";
  }
}

/** `isActive` missing (older auth-service) means "not known to be locked" — the old default. */
export function adminUserStatus(isActive: boolean | null | undefined): "Active" | "Inactive" {
  return isActive === false ? "Inactive" : "Active";
}

/**
 * Dashboard role breakdown. `isTrainer` keeps the existing rule (PT role, or a user-service profile
 * flagged `isPT`); gym owners get their own slice instead of vanishing.
 */
export function adminRoleBreakdown(
  users: { id: string; role: string }[],
  isTrainer: (u: { id: string; role: string }) => boolean,
): { name: string; value: number }[] {
  return [
    { name: "Clients", value: users.filter((u) => u.role === "CUSTOMER").length },
    { name: "Trainers", value: users.filter(isTrainer).length },
    { name: "Gym owners", value: users.filter((u) => u.role === "GYM_OWNER").length },
  ];
}

// ── N-A-10: Vietnamese display labels. The English strings above ("Client", "Active", …) stay as
// the stable codes the web and mobile admin clients key on; these are what an admin should READ.

export type AdminRoleCode = "ADMIN" | "CUSTOMER" | "PT" | "GYM_OWNER";

export function adminRoleCode(role: string | null | undefined): AdminRoleCode {
  return role === "ADMIN" || role === "PT" || role === "GYM_OWNER" ? role : "CUSTOMER";
}

export function adminRoleLabelVi(role: string | null | undefined): string {
  switch (adminRoleCode(role)) {
    case "ADMIN":
      return "Quản trị viên";
    case "PT":
      return "Huấn luyện viên";
    case "GYM_OWNER":
      return "Chủ phòng gym";
    default:
      return "Khách hàng";
  }
}

export function adminStatusCode(isActive: boolean | null | undefined): "ACTIVE" | "INACTIVE" {
  return isActive === false ? "INACTIVE" : "ACTIVE";
}

export function adminStatusLabelVi(isActive: boolean | null | undefined): string {
  return isActive === false ? "Đã khoá" : "Đang hoạt động";
}

/** "09/11/2026" (or "09/11" without the year) — fixed format, independent of the server's ICU/locale. */
export function adminDateVi(value: string | Date | null | undefined, withYear = true): string {
  if (value === null || value === undefined) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return withYear ? `${dd}/${mm}/${d.getFullYear()}` : `${dd}/${mm}`;
}

/** "14:05" — 24h, fixed format. */
export function adminTimeVi(value: Date = new Date()): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

/** "T6" — short Vietnamese month label for the user-growth chart. */
export function adminMonthLabelVi(date: Date): string {
  return `T${date.getMonth() + 1}`;
}

const SERVICE_LABEL_VI: Record<string, string> = {
  api: "Cổng API",
  auth: "Dịch vụ tài khoản",
  user: "Dịch vụ hồ sơ & huấn luyện",
  fitness: "Dịch vụ luyện tập",
  ai: "Dịch vụ AI",
  chat: "Dịch vụ trò chuyện",
};

/** Vietnamese name of a monitored service by its key; unknown keys fall back to the given name. */
export function adminServiceLabelVi(key: string, fallback: string): string {
  return SERVICE_LABEL_VI[key] ?? fallback;
}

/**
 * Dashboard role breakdown (Vietnamese names + the role code). Replaces the English
 * "Clients / Trainers / Gym owners" names; `isTrainer` keeps the existing trainer rule.
 */
export function adminRoleBreakdownVi(
  users: { id: string; role: string }[],
  isTrainer: (u: { id: string; role: string }) => boolean,
): { name: string; code: AdminRoleCode; value: number }[] {
  return [
    { name: "Khách hàng", code: "CUSTOMER", value: users.filter((u) => u.role === "CUSTOMER").length },
    { name: "Huấn luyện viên", code: "PT", value: users.filter(isTrainer).length },
    { name: "Chủ phòng gym", code: "GYM_OWNER", value: users.filter((u) => u.role === "GYM_OWNER").length },
  ];
}
