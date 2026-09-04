import type { UserRole } from "../context/AppContext";

/**
 * Where each role belongs when the app has to pick a destination itself — after login,
 * after session restore, or when something lands on "/" with no route of its own.
 *
 * One table, one source of truth: the login form, the root redirect and the Android
 * back-button handler must never disagree about where a role's home screen is.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  client: "/client/dashboard",
  pt: "/pt/dashboard",
  gym_owner: "/gym-owner/dashboard",
  admin: "/admin/dashboard",
};

/** Resolves a role the same way AppContext does, but from a raw stored/served user object. */
export function roleOf(user: { role?: string | null; isPT?: boolean | null } | null | undefined): UserRole {
  const raw = String(user?.role ?? "").toUpperCase();
  if (raw === "ADMIN") return "admin";
  if (raw === "GYM_OWNER") return "gym_owner";
  if (user?.isPT || raw === "PT") return "pt";
  return "client";
}

export function landingPathFor(user: { role?: string | null; isPT?: boolean | null } | null | undefined): string {
  return ROLE_HOME[roleOf(user)];
}
