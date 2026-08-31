import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useApp, type UserRole } from "../context/AppContext";

/**
 * Route-level role guard. Wraps an entire workspace (e.g. the whole /admin/*
 * subtree, AppShell included) so a role mismatch never renders that
 * workspace's sidebar/chrome or any page content — only backend RBAC is a
 * real security boundary (see backend proxy.routes.ts's requireRoles and
 * each service's own role checks), this is strictly a UX guard: it stops a
 * Client from *seeing* /admin/* or /pt/* by typing the URL directly, it
 * does not by itself protect any data.
 *
 * `role` is derived synchronously from the already-loaded `user` object
 * (itself read from localStorage during AppProvider's initial state), so
 * there is no separate "role loading" state to guard against here — the
 * flash-of-wrong-content window that a real async role fetch would create
 * doesn't exist in this app's current auth model.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: UserRole[];
  children: ReactNode;
}) {
  const { role, isAuthenticated } = useApp();

  // Redirect rather than render nothing. This used to `return null` on the assumption that
  // AppShell (inside `children`) would do the redirecting — but returning null is exactly
  // what stops AppShell from ever mounting, so nothing redirected and an unauthenticated
  // visit to /admin/* or /pt/* simply sat on a blank screen at the guarded URL. Session
  // restore now resolves before anything renders (see services/session.ts), so by the time
  // this runs, `isAuthenticated: false` is a settled answer, not a still-loading one.
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (!allow.includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <div className="max-w-md w-full rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
          <h2 className="text-amber-300 text-lg font-bold mb-2">
            403 — Không có quyền truy cập
          </h2>
          <p className="text-amber-200/80 text-sm">
            Tài khoản của bạn không có quyền xem trang này.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
