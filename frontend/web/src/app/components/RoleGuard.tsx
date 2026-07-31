import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useApp } from "../context/AppContext";

const HOME: Record<string, string> = {
  admin: "/admin/dashboard",
  gym_owner: "/gym-owner/gyms",
  gym_staff: "/gym-owner/gyms",
  pt: "/pt/dashboard",
  client: "/client/dashboard",
};

/**
 * Client-side role gate for a whole workspace. Not a security boundary — the backend/gateway remain
 * the real enforcement — but it stops a logged-in user from opening a workspace that isn't theirs
 * (e.g. a CLIENT navigating to /admin/*), which otherwise renders the shell and 403-spams the API.
 */
export function RoleGuard({ allow, children }: { allow: string[]; children: ReactNode }) {
  const { isAuthenticated, role } = useApp();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!allow.includes(role)) return <Navigate to={HOME[role] ?? "/login"} replace />;
  return <>{children}</>;
}
