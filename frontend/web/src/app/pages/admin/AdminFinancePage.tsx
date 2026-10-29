import { Suspense, type ReactNode } from "react";
import { Navigate, useLocation, useOutlet } from "react-router";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwiseIcon, CurrencyCircleDollarIcon as CircleDollarSign } from "@phosphor-icons/react";
import { AdminLink } from "../../components/layout/admin/AdminLink";
import { ADMIN_FINANCE_TABS } from "../../components/layout/admin/adminNav";
import { resolveLegacyAdminRedirect } from "../../components/layout/admin/adminRedirects";
import { PageSkeleton } from "../../components/layout/PageSkeleton";
import { activeFinanceTab, financeRefreshKeys, financeTitle, keyMatchesAny } from "./reconciliation/financeHeader";

/**
 * "Tài chính" — layout of the finance workspace. Each level-2 tab is a real route
 * (`/admin/finance`, `/reconciliation`, `/withdrawals`, `/refunds`) rendering the SAME tab
 * component as before; the tab content is untouched (B3–B6 redesign it).
 *
 * Header (B4, approved by Ngài 28/10): the H1 follows the active tab and the header "Làm mới" re-reads that tab's queries.
 * It is the ONLY refresh button of the workspace (B3b removed the duplicates inside the four tabs; their "Cập nhật lúc …" /
 * "Tính đến …" timestamps and the "dữ liệu đã cũ" chips stay).
 *
 * The old `/admin/finance?tab=…` URLs (tab held in state, never written to the URL) are
 * redirected here, preserving any other query params — see `resolveLegacyAdminRedirect`.
 */
export function AdminFinancePage() {
  const location = useLocation();
  const outlet = useOutlet() as ReactNode;
  const queryClient = useQueryClient();
  const activeTab = activeFinanceTab(ADMIN_FINANCE_TABS, location.pathname);
  const refreshKeys = financeRefreshKeys(activeTab?.key ?? null);
  const refreshing =
    useIsFetching({ predicate: (q) => keyMatchesAny(q.queryKey, refreshKeys) }) > 0;

  const legacyTarget = resolveLegacyAdminRedirect(location.pathname, location.search, location.hash);
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 data-testid="admin-finance-title" className="text-adm-text flex items-center gap-2 text-xl font-bold">
            <CircleDollarSign className="w-5 h-5 text-st-success" aria-hidden /> {financeTitle(activeTab?.key ?? null)}
          </h1>
          <p className="text-adm-text-2 text-sm mt-0.5">
            Toàn bộ số tiền thu, chi, đối soát và các yêu cầu rút/hoàn tiền của nền tảng, ở một chỗ.
          </p>
        </div>
        <button
          type="button"
          data-testid="admin-finance-refresh"
          aria-busy={refreshing}
          disabled={refreshKeys.length === 0}
          onClick={() => {
            for (const queryKey of refreshKeys) void queryClient.invalidateQueries({ queryKey });
          }}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] disabled:opacity-60 motion-reduce:transition-none lg:min-h-9"
        >
          <ArrowClockwiseIcon className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Làm mới
        </button>
      </div>

      <nav
        aria-label="Tài chính"
        data-testid="admin-finance-tabs"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-adm-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ADMIN_FINANCE_TABS.map((t) => {
          const active = activeTab?.key === t.key;
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
