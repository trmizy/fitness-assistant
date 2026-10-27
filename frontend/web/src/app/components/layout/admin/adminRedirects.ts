/**
 * Old admin URLs that became redirects (Master Plan §2.3). Pure so it can be unit-tested.
 * Rule: no old admin URL may 404; every redirect keeps the other query params and the hash.
 */
import { ADMIN_FINANCE_PATH } from "./adminNav";

/** `/admin/finance?tab=<key>` (old tab-in-state URL) → the new finance route for that tab. */
export const LEGACY_FINANCE_TAB_PATHS: Record<string, string> = {
  overview: ADMIN_FINANCE_PATH,
  reconciliation: `${ADMIN_FINANCE_PATH}/reconciliation`,
  withdrawals: `${ADMIN_FINANCE_PATH}/withdrawals`,
  refunds: `${ADMIN_FINANCE_PATH}/refunds`,
};

/** Legacy standalone pages that were folded into a finance tab earlier. */
export const LEGACY_ADMIN_PATHS: Record<string, string> = {
  "/admin/withdrawals": LEGACY_FINANCE_TAB_PATHS.withdrawals,
  "/admin/pt-service-refunds": LEGACY_FINANCE_TAB_PATHS.refunds,
};

function stripTrailingSlash(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/**
 * Returns the URL (path + remaining query + hash) a legacy admin location must be replaced
 * with, or `null` when the location is current and must render as-is.
 *
 *  /admin/withdrawals[?x]                → /admin/finance/withdrawals[?x]
 *  /admin/pt-service-refunds[?x]         → /admin/finance/refunds[?x]
 *  /admin/finance?tab=reconciliation&y=1 → /admin/finance/reconciliation?y=1
 *  /admin/finance?tab=overview           → /admin/finance
 *  /admin/finance?tab=unknown            → null (renders the overview, nothing to redirect to)
 */
export function resolveLegacyAdminRedirect(pathname: string, search = "", hash = ""): string | null {
  const path = stripTrailingSlash(pathname);

  const legacyTarget = Object.prototype.hasOwnProperty.call(LEGACY_ADMIN_PATHS, path) ? LEGACY_ADMIN_PATHS[path] : undefined;
  if (legacyTarget) return `${legacyTarget}${search}${hash}`;

  if (path === ADMIN_FINANCE_PATH) {
    const params = new URLSearchParams(search);
    const tab = params.get("tab");
    if (tab !== null && Object.prototype.hasOwnProperty.call(LEGACY_FINANCE_TAB_PATHS, tab)) {
      params.delete("tab");
      const rest = params.toString();
      return `${LEGACY_FINANCE_TAB_PATHS[tab]}${rest ? `?${rest}` : ""}${hash}`;
    }
  }
  return null;
}
