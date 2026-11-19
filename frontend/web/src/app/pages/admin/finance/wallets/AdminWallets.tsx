import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { SkeletonBlock } from "../transactions/TransactionParts";
import { WalletLoadError } from "./WalletParts";
import { EmptyWallets, WalletFiltersBar, WalletsPager, WalletsTable } from "./WalletsList";
import { WalletDrawer } from "./WalletDrawer";
import { useWalletList } from "./useWalletsData";
import { buildWalletsParams, hasActiveFilters, parseWalletsParams, type WalletFilters } from "./walletsUrlState";

/**
 * "Tài chính › Ví" (G-09 / G-10) — look up a wallet and every ledger entry on it. READ ONLY: no write call anywhere.
 *
 * URL state: `?ownerType&ownerId&page&id&ep` (`id` = the open drawer, `ep` = its entries page). Opening a drawer pushes a
 * history entry (browser Back closes it); closing goes back when WE opened it, else replaces. Changing a filter resets to
 * page 1. A failed load is a failure message with a retry — never an empty table and never "0 ₫".
 */
export function AdminWallets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { filters, id, entriesPage } = useMemo(() => parseWalletsParams(searchParams), [searchParams]);
  const list = useWalletList(filters);

  const hasData = list.data !== undefined;
  const rows = list.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  const setFilters = useCallback(
    (patch: Partial<WalletFilters>) => {
      // Any filter change goes back to page 1 and closes the drawer; only a page change keeps the filters as they are.
      const next = { ...filters, ...patch, page: patch.page ?? 1 };
      setSearchParams(buildWalletsParams({ filters: next }), { replace: false });
    },
    [filters, setSearchParams],
  );

  const openDrawer = useCallback(
    (walletId: string) => setSearchParams(buildWalletsParams({ filters, id: walletId }), { state: { walletDrawer: true } }),
    [filters, setSearchParams],
  );
  const setEntriesPage = useCallback(
    (p: number) => {
      if (id) setSearchParams(buildWalletsParams({ filters, id, entriesPage: p }), { replace: true, state: location.state });
    },
    [filters, id, location.state, setSearchParams],
  );
  const closeDrawer = useCallback(() => {
    if ((location.state as { walletDrawer?: boolean } | null)?.walletDrawer) navigate(-1);
    else setSearchParams(buildWalletsParams({ filters }), { replace: true });
  }, [filters, location.state, navigate, setSearchParams]);

  const clearAll = () => setFilters({ ownerType: null, ownerId: "" });

  return (
    <div className="space-y-4" data-testid="admin-wallets-page">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-adm-text">Ví</h2>
        <p className="mt-0.5 text-sm text-adm-text-2">Tra cứu một ví và mọi bút toán đã ghi trên ví đó. Màn hình này chỉ để xem.</p>
      </div>

      <WalletFiltersBar filters={filters} onChange={setFilters} />

      {list.isLoading ? (
        <SkeletonBlock rows={5} testId="admin-wallets-loading" />
      ) : list.isError && !hasData ? (
        <WalletLoadError error={list.error} what="danh sách ví" onRetry={() => list.refetch()} testId="admin-wallets-error" />
      ) : list.data ? (
        <>
          {list.isError && (
            <p role="status" data-testid="admin-wallets-stale" className="rounded-lg border border-st-pending-border bg-st-pending-bg px-3 py-2 text-sm text-st-pending">
              Không làm mới được — đang hiện dữ liệu cũ. Bấm “Làm mới” để thử lại.
            </p>
          )}
          {list.data.ignored > 0 && <p className="text-xs text-adm-text-2">Có {list.data.ignored} bản ghi không đọc được trong phản hồi nên không hiển thị.</p>}
          {rows.length === 0 ? (
            <EmptyWallets filtered={filtered} onClear={clearAll} />
          ) : (
            <WalletsTable rows={rows} activeId={id} onOpen={openDrawer} dimmed={list.isPlaceholderData || (list.isFetching && !list.isLoading)} />
          )}
          <WalletsPager page={filters.page} total={list.data.total} hasMore={list.data.hasMore} shown={rows.length} onPage={(p) => setFilters({ page: p })} />
        </>
      ) : null}

      {id && <WalletDrawer id={id} entriesPage={entriesPage} onEntriesPage={setEntriesPage} onClose={closeDrawer} />}
    </div>
  );
}
