import { Suspense, type ReactNode } from "react";
import { Navigate, useLocation, useOutlet } from "react-router";
import { CurrencyCircleDollarIcon as CircleDollarSign } from "@phosphor-icons/react";
import { AdminLink } from "../../components/layout/admin/AdminLink";
import { ADMIN_FINANCE_TABS } from "../../components/layout/admin/adminNav";
import { resolveLegacyAdminRedirect } from "../../components/layout/admin/adminRedirects";
import { PageSkeleton } from "../../components/layout/PageSkeleton";

/**
 * "Tài chính" — layout of the finance workspace. Each level-2 tab is a real route
 * (`/admin/finance`, `/reconciliation`, `/withdrawals`, `/refunds`) rendering the SAME tab
 * component as before; the tab content is untouched (B3–B6 redesign it).
 *
 * The old `/admin/finance?tab=…` URLs (tab held in state, never written to the URL) are
 * redirected here, preserving any other query params — see `resolveLegacyAdminRedirect`.
 */
export function AdminFinancePage() {
  const location = useLocation();
  const outlet = useOutlet() as ReactNode;

  const legacyTarget = resolveLegacyAdminRedirect(location.pathname, location.search, location.hash);
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <CircleDollarSign className="w-5 h-5 text-green-400" /> Tài chính
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Toàn bộ số tiền thu, chi, đối soát và các yêu cầu rút/hoàn tiền của nền tảng, ở một chỗ.
        </p>
      </div>

      <nav
        aria-label="Tài chính"
        data-testid="admin-finance-tabs"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-adm-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ADMIN_FINANCE_TABS.map((t) => {
          const path = location.pathname.replace(/\/+$/, "");
          const active = t.end ? path === t.to : path === t.to || path.startsWith(`${t.to}/`);
          return (
            <AdminLink
              key={t.key}
              to={t.to}
              aria-current={active ? "page" : undefined}
              data-testid={`admin-finance-tab-${t.key}`}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-t-md border-b-2 px-3.5 text-sm no-underline transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--adm-focus)] lg:min-h-10 ${
                active
                  ? "border-primary font-semibold text-adm-text"
                  : "border-transparent font-medium text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text"
              }`}
            >
              {t.label}
            </AdminLink>
          );
        })}
      </nav>

      <Suspense fallback={<PageSkeleton />}>
        {outlet}
      </Suspense>
    </div>
  );
}
