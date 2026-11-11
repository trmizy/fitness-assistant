/**
 * How the admin aggregates (GET /admin/users, GET /admin/dashboard) label an auth-service account.
 * Same rules as backend/gateway/src/utils/adminUserView.ts, which does not exist on AWS — kept in one
 * place here so the two admin routes cannot drift apart.
 */
export function adminRoleLabel(role: string | null | undefined): "Admin" | "PT" | "Gym Owner" | "Client" {
  switch (role) {
    case "ADMIN": return "Admin";
    case "PT": return "PT";
    case "GYM_OWNER": return "Gym Owner";
    default: return "Client";
  }
}

/** `isActive` missing (older auth-service) means "not known to be locked". */
export function adminUserStatus(isActive: boolean | null | undefined): "Active" | "Inactive" {
  return isActive === false ? "Inactive" : "Active";
}
