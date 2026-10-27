import { Navigate, useLocation } from "react-router";
import { resolveLegacyAdminRedirect } from "./adminRedirects";

/**
 * Route element for old admin URLs that moved (`/admin/withdrawals`, `/admin/pt-service-refunds`).
 * `replace` so Back does not bounce through the dead URL; query + hash are preserved.
 *
 * Renders nothing once the location is no longer a legacy one: after `Navigate` fires, this
 * element can render once more with the NEW location before it unmounts, and must not redirect
 * again (an earlier version fell back to /admin/finance there and lost the target tab).
 */
export function LegacyAdminRedirect() {
  const { pathname, search, hash } = useLocation();
  const target = resolveLegacyAdminRedirect(pathname, search, hash);
  return target ? <Navigate to={target} replace /> : null;
}
