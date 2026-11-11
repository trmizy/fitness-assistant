import { ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, LockKeyIcon, MoneyIcon, WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../components/ui/button";
import { useApp } from "../../../context/AppContext";
import { describeAdminError } from "../shared/useAdminError";
import { CopyId } from "./WithdrawalRow";
import { useWithdrawalHistory } from "./useWithdrawalHistory";
import { HISTORY_PAGE_SIZE, TAB_LABEL, historyPageCount, toHistoryRowView, type HistoryStatus } from "./withdrawalHistory";

/**
 * G-08 — "Đã chuyển" / "Từ chối": the read-only history of one status, paged (25 per page, `?page=` in the URL).
 * Same look as the queue: a table from `xl`, cards below. A failed load is an error with "Thử lại", never an empty list.
 * No action buttons: history rows cannot be changed. The requester's bank details are not part of this API.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";
const HISTORY_GRID =
  "xl:grid-cols-[minmax(0,200px)_minmax(0,130px)_minmax(0,120px)_minmax(0,150px)_minmax(0,1fr)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

function HistorySkeleton() {
  const bar = "animate-pulse rounded-md bg-adm-pill motion-reduce:animate-none";
  return (
    <div
      role="status"
      aria-label="Đang tải"
      aria-busy="true"
      data-testid="admin-withdrawal-history-loading"
      className="overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-2 gap-3 border-t border-adm-border-soft px-4 py-4 first:border-t-0">
          <div className={`${bar} h-12`} />
          <div className={`${bar} ml-auto h-6 w-28`} />
          <div className={`${bar} col-span-2 h-4`} />
        </div>
      ))}
      <span className="sr-only">Đang tải lịch sử rút tiền…</span>
    </div>
  );
}

export function WithdrawalHistoryPanel({ status, page, onPage }: { status: HistoryStatus; page: number; onPage: (page: number) => void }) {
  const { user } = useApp();
  const query = useWithdrawalHistory(status, page);
  const data = query.data;
  const errorView = query.isError ? describeAdminError(query.error) : null;
  const forbidden = !!errorView && (errorView.kind === "forbidden" || errorView.kind === "unauthorized");

  if (query.isLoading) return <HistorySkeleton />;

  if (errorView && !data) {
    const Icon = forbidden ? LockKeyIcon : errorView.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
    return (
      <div
        data-testid="admin-withdrawal-history-error"
        className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center"
      >
        <Icon className="size-8 text-st-danger" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-st-danger">
            {forbidden ? "Không có quyền xem" : errorView.kind === "network" ? "Mất kết nối mạng" : "Không tải được lịch sử rút tiền"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">
            {forbidden
              ? "Tài khoản này không có quyền xem dữ liệu tài chính."
              : "Không tải được lịch sử rút tiền. Đây không phải là “chưa có yêu cầu” — hãy thử lại trước khi kết luận."}
          </p>
        </div>
        {!forbidden && (
          <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} className="min-h-11 xl:min-h-8">
            <ArrowClockwiseIcon aria-hidden /> Thử lại
          </Button>
        )}
      </div>
    );
  }

  if (!data) return <HistorySkeleton />;

  const rows = data.items.map((r) => toHistoryRowView(r, user?.id));
  const pages = historyPageCount(data.total);
  const refreshFailed = !!errorView;
  const dimmed = query.isPlaceholderData || query.isFetching || refreshFailed;
  const btn = `inline-flex min-h-11 items-center gap-1 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-9 ${FOCUS}`;

  return (
    <div className="space-y-4" data-testid="admin-withdrawal-history" data-status={status}>
      {refreshFailed && (
        <div
          role="status"
          data-testid="admin-withdrawal-history-refresh-failed"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-st-pending-border bg-st-pending-bg px-3 py-2 text-sm text-st-pending"
        >
          <WarningCircleIcon className="size-4 shrink-0" weight="fill" aria-hidden />
          <span>Không làm mới được — đang hiện dữ liệu đã tải trước đó.</span>
          <button type="button" onClick={() => query.refetch()} className={`min-h-11 rounded-md px-2 font-medium underline underline-offset-4 xl:min-h-8 ${FOCUS}`}>
            Thử lại
          </button>
        </div>
      )}

      {data.total === 0 ? (
        <div
          data-testid="admin-withdrawal-history-empty"
          className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center"
        >
          <MoneyIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
          <p className="text-sm text-adm-text">Chưa có yêu cầu nào ở trạng thái này.</p>
        </div>
      ) : (
        <>
          <p data-testid="admin-withdrawal-history-summary" className="text-sm text-adm-text">
            <span className="font-semibold tabular-nums">{data.total.toLocaleString("vi-VN")}</span> yêu cầu “{TAB_LABEL[status]}” · mới nhất trước
          </p>
          {data.ignored > 0 && <p className="text-xs text-adm-text-2">Có {data.ignored} bản ghi không đọc được trong phản hồi nên không hiển thị.</p>}

          {rows.length === 0 ? (
            <div
              data-testid="admin-withdrawal-history-empty-page"
              className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-10 text-center text-sm text-adm-text"
            >
              Trang này không còn yêu cầu nào.{" "}
              <button type="button" onClick={() => onPage(1)} className={`min-h-11 rounded-md px-2 font-medium text-primary underline underline-offset-4 xl:min-h-8 ${FOCUS}`}>
                Về trang 1
              </button>
            </div>
          ) : (
            <div
              role="table"
              aria-label={`Lịch sử rút tiền — ${TAB_LABEL[status]}`}
              data-testid="admin-withdrawal-history-list"
              className={`overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card ${dimmed ? "opacity-85" : ""}`}
            >
              <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${HISTORY_GRID}`}>
                <div role="columnheader">Người rút</div>
                <div role="columnheader" className="text-right">Số tiền</div>
                <div role="columnheader">Người duyệt</div>
                <div role="columnheader">{status === "PAID" ? "Thời điểm chuyển" : "Thời điểm từ chối"}</div>
                <div role="columnheader">{status === "PAID" ? "Mã tham chiếu ngân hàng" : "Lý do từ chối"}</div>
              </div>
              <div role="rowgroup">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    role="row"
                    data-testid="admin-withdrawal-history-row"
                    data-request-id={r.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-t border-adm-border-soft px-4 py-3.5 first:border-t-0 xl:items-center ${HISTORY_GRID}`}
                  >
                    <div role="cell" className="min-w-0">
                      <p className="text-sm font-semibold text-adm-text">{r.ownerLabel}</p>
                      <p className="mt-0.5 flex items-center gap-0.5 whitespace-nowrap text-xs text-adm-text-2">
                        <span>
                          Người dùng <span className="font-mono tabular-nums">{r.ownerShortId}</span>
                        </span>
                        <CopyId id={r.ownerId} label="Sao chép mã đầy đủ của người rút" />
                      </p>
                      <p className="flex items-center gap-0.5 whitespace-nowrap text-xs text-adm-text-2">
                        <span>
                          Yêu cầu <span className="font-mono tabular-nums">{r.shortId}</span>
                        </span>
                        <CopyId id={r.id} label="Sao chép mã đầy đủ của yêu cầu rút tiền" />
                      </p>
                      <p className="text-[11px] text-adm-text-2">Số dư ví hiện tại: <span className="tabular-nums">{r.walletAvailableText}</span></p>
                    </div>

                    <div role="cell" className="min-w-0 text-right">
                      <p className={CELL_LABEL}>Số tiền</p>
                      <p data-testid="admin-withdrawal-history-amount" className="text-base font-bold tabular-nums text-adm-text xl:text-sm">
                        {r.amountText}
                      </p>
                    </div>

                    <div role="cell" className="min-w-0">
                      <p className={CELL_LABEL}>Người duyệt</p>
                      <p data-testid="admin-withdrawal-history-approver" className="text-sm text-adm-text">{r.approvedByText}</p>
                    </div>

                    <div role="cell" className="min-w-0">
                      <p className={CELL_LABEL}>{r.whenLabel}</p>
                      <p className="text-sm tabular-nums text-adm-text">
                        {r.whenIso ? <time dateTime={r.whenIso}>{r.whenText}</time> : "—"}
                      </p>
                    </div>

                    <div role="cell" className="col-span-2 min-w-0 xl:col-span-1">
                      <p className={CELL_LABEL}>{r.noteLabel}</p>
                      <p data-testid="admin-withdrawal-history-note" className="whitespace-pre-wrap break-words text-sm text-adm-text xl:text-[13px]">{r.noteText}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <nav aria-label="Phân trang lịch sử rút tiền" data-testid="admin-withdrawal-history-pager" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-adm-text-2" aria-live="polite">
              Trang <span className="tabular-nums text-adm-text">{page}</span> / <span className="tabular-nums">{pages}</span> · {HISTORY_PAGE_SIZE} yêu cầu mỗi trang
            </p>
            <div className="flex gap-2">
              <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="admin-withdrawal-history-prev">
                <CaretLeftIcon className="size-4" aria-hidden /> Trang trước
              </button>
              <button type="button" className={btn} disabled={!data.hasMore} onClick={() => onPage(page + 1)} data-testid="admin-withdrawal-history-next">
                Trang sau <CaretRightIcon className="size-4" aria-hidden />
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
