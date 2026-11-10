import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { TransactionDrawer } from "./finance/transactions/TransactionDrawer";
import { EmptyList, Pager, TransactionFiltersBar, TransactionsTable } from "./finance/transactions/TransactionsList";
import { LoadError, SkeletonBlock } from "./finance/transactions/TransactionParts";
import { useTransactionList } from "./finance/transactions/useTransactionsData";
import { buildTransactionsParams, hasActiveFilters, parseTransactionsParams, type TransactionFilters } from "./finance/transactions/transactionsUrlState";

/**
 * "Tài chính › Giao dịch" (B7) — find one payment transaction and follow its money. READ ONLY: no write call anywhere.
 *
 * URL state: `?q&status&provider&purpose&from&to&page&id` (`id` = the open drawer). Opening a drawer pushes a history entry
 * (browser Back closes it); closing goes back when WE opened it, else replaces. Changing a filter resets to page 1.
 * Data: payment-service G-04 (list, exact-match search, 25 per page) and G-05 (detail). A failed load is a failure
 * message with a retry — never an empty table and never "0 ₫".
 */
export function AdminTransactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { filters, id } = useMemo(() => parseTransactionsParams(searchParams), [searchParams]);
  const list = useTransactionList(filters);

  const hasData = list.data !== undefined;
  const rows = list.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  const setFilters = useCallback(
    (patch: Partial<TransactionFilters>) => {
      // Any filter change goes back to page 1 and closes the drawer; only a page change keeps the filters as they are.
      const next = { ...filters, ...patch, page: patch.page ?? 1 };
      setSearchParams(buildTransactionsParams({ filters: next }), { replace: false });
    },
    [filters, setSearchParams],
  );

  const openDrawer = useCallback(
    (txId: string) => {
      setSearchParams(buildTransactionsParams({ filters, id: txId }), { state: { txnDrawer: true } });
    },
    [filters, setSearchParams],
  );
  /** Switch the open drawer to another transaction (a refund / the original) without stacking history. */
  const switchDrawer = useCallback(
    (txId: string) => {
      setSearchParams(buildTransactionsParams({ filters, id: txId }), { replace: true, state: { txnDrawer: true } });
    },
    [filters, setSearchParams],
  );
  const closeDrawer = useCallback(() => {
    if ((location.state as { txnDrawer?: boolean } | null)?.txnDrawer) navigate(-1);
    else setSearchParams(buildTransactionsParams({ filters }), { replace: true });
  }, [filters, location.state, navigate, setSearchParams]);

  const clearAll = () => setFilters({ q: "", status: null, provider: null, purpose: null, from: null, to: null });

  return (
    <div className="space-y-4" data-testid="admin-transactions-page">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-adm-text">Giao dịch</h2>
        <p className="mt-0.5 text-sm text-adm-text-2">Tìm một giao dịch thanh toán và lần theo hành trình tiền của nó. Màn hình này chỉ để xem.</p>
      </div>

      <TransactionFiltersBar filters={filters} onChange={setFilters} />

      {list.isLoading ? (
        <SkeletonBlock rows={5} testId="admin-transactions-loading" />
      ) : list.isError && !hasData ? (
        <LoadError error={list.error} what="danh sách giao dịch" onRetry={() => list.refetch()} testId="admin-transactions-error" />
      ) : list.data ? (
        <>
          {list.isError && (
            <p role="status" data-testid="admin-transactions-stale" className="rounded-lg border border-st-pending-border bg-st-pending-bg px-3 py-2 text-sm text-st-pending">
              Không làm mới được — đang hiện dữ liệu cũ. Bấm “Làm mới” để thử lại.
            </p>
          )}
          {list.data.ignored > 0 && (
            <p className="text-xs text-adm-text-2">Có {list.data.ignored} bản ghi không đọc được trong phản hồi nên không hiển thị.</p>
          )}
          {rows.length === 0 ? (
            <EmptyList filtered={filtered} onClear={clearAll} />
          ) : (
            <TransactionsTable rows={rows} activeId={id} onOpen={openDrawer} dimmed={list.isPlaceholderData || (list.isFetching && !list.isLoading)} />
          )}
          <Pager page={filters.page} total={list.data.total} hasMore={list.data.hasMore} shown={rows.length} onPage={(p) => setFilters({ page: p })} />
        </>
      ) : null}

      {id && <TransactionDrawer id={id} onClose={closeDrawer} onOpenTransaction={switchDrawer} />}
    </div>
  );
}
