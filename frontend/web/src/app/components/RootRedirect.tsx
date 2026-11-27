import { lazy } from "react";
import { Navigate } from "react-router";
import { useApp } from "../context/AppContext";
import { ROLE_HOME } from "../config/landing";
import { useGymOwnerAccessState } from "../hooks/useGymOwnerAccessState";
import { APPLICANT_STATES } from "../services/partnerApplication";

// Public website home for guests. Lazy: signed-in users never download it (Root already provides the <Suspense>).
const PublicHomeEntry = lazy(() => import("../pages/public-site/PublicHomeEntry").then((m) => ({ default: m.PublicHomeEntry })));

/**
 * Decides what "/" shows, based on whether a session survived.
 *
 * - Signed in: go straight to the role's home (gym owner applicants: to their application). This is unchanged and
 *   matters because the app can boot at "/" with a perfectly valid stored session — pushing those users to a login
 *   form made them type their password again ("it logs me out every time I close the app").
 * - Guest: the public website home page (canonical URL "/"; the old /gioi-thieu redirects here). It used to be a hard
 *   `<Navigate to="/login" replace />`; the site header's "Đăng nhập" / "Bắt đầu" buttons lead on to /login and /register.
 *
 * Safe to read `isAuthenticated` synchronously here: session restore resolves before the
 * router renders anything (AppProvider holds the splash until then), so this is a settled
 * answer rather than a still-loading one.
 */
export function RootRedirect() {
  const { isAuthenticated, role } = useApp();
  // Chủ phòng gym: đích phụ thuộc trạng thái hồ sơ (ứng viên chưa duyệt không có dashboard vận hành).
  const access = useGymOwnerAccessState();
  if (isAuthenticated && role === "gym_owner") {
    if (access.isLoading) return null;
    if (access.data && APPLICANT_STATES.includes(access.data.accessState)) {
      return <Navigate to="/partner/application" replace />;
    }
  }
  if (!isAuthenticated) return <PublicHomeEntry />;
  return <Navigate to={ROLE_HOME[role]} replace />;
}
