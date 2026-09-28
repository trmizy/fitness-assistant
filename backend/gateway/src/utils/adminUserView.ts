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
