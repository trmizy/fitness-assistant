import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  ArrowClockwiseIcon,
  InfoIcon,
  LockKeyIcon,
  MoneyIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { Button } from "../../components/ui/button";
import { describeAdminError } from "./shared/useAdminError";
import { moneyText } from "./shared/moneyGuards";
import { QUEUE_KEY, ROW_GRID, WithdrawalRow } from "./withdrawals/WithdrawalRow";
import { WithdrawalHistoryPanel } from "./withdrawals/WithdrawalHistoryPanel";
import { TAB_LABEL, parseHistoryPage, parseHistoryTab, type WithdrawalTab } from "./withdrawals/withdrawalHistory";
import {
  QUEUE_STATUSES,
  WITHDRAWAL_API_LIMIT,
  centsToVnd,
  countText,
  formatAge,
  normalizeQueue,
  parseStatusParam,
  rowsFor,
  staleMinutes,
  summarize,
  type QueueStatus,
} from "./withdrawals/withdrawalQueue";

/**
 * "Tài chính › Rút tiền" (B5) — the withdrawal queue as a worklist: two status chips kept in the URL
 * (`?status=PENDING|APPROVED`), a per-chip summary (count, total of THAT status only, oldest age), and a
 * table-on-desktop / card-on-phone list. Manual payout flow, no payout API: "Đã chi trả" only records a transfer
 * the admin already made outside the system.
 *
 * Data limits are shown, not hidden: the queue endpoint returns only PENDING + APPROVED, oldest first, max 100 rows
 * (≥100 ⇒ "có thể còn nữa"). The two history chips (G-08, `?status=PAID|REJECTED&page=`) read the separate paged,
 * read-only `withdrawal-history` API — see `withdrawals/WithdrawalHistoryPanel.tsx`. The requester's name is not
 * available anywhere, so people are identified by their user code.
 *
 * B1 behaviour (confirmation dialogs, per-row pending, one POST per confirmation, no retry, errors ≠ empty) lives
 * in `withdrawals/WithdrawalRow.tsx` and is unchanged.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

const CHIP_LABEL: Record<QueueStatus, string> = { PENDING: TAB_LABEL.PENDING, APPROVED: TAB_LABEL.APPROVED };
const ALL_TABS: readonly WithdrawalTab[] = ["PENDING", "APPROVED", "PAID", "REJECTED"];

function timeText(ms: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

/** Re-renders every `intervalMs` so ages and the "dữ liệu đã cũ" note stay true while the tab stays open. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Skeleton() {
  const bar = "animate-pulse rounded-md bg-adm-pill motion-reduce:animate-none";
  return (
    <div role="status" aria-label="Đang tải" aria-busy="true" data-testid="admin-withdrawals-loading" className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[150, 230, 130, 110].map((w, i) => (
          <div key={i} className={`${bar} h-10 rounded-full`} style={{ width: w }} />
        ))}
      </div>
      <div className={`${bar} h-5 w-72 max-w-full`} />
      <div className="overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-2 gap-3 border-t border-adm-border-soft px-4 py-4 first:border-t-0">
            <div className={`${bar} h-12`} />
            <div className={`${bar} ml-auto h-6 w-28`} />
            <div className={`${bar} col-span-2 h-4`} />
            <div className={`${bar} col-span-2 h-9`} />
          </div>
        ))}
      </div>
      <span className="sr-only">Đang tải hàng đợi rút tiền…</span>
    </div>
  );
}

function ErrorBlock({ title, message, onRetry, icon: Icon }: { title: string; message: string; onRetry?: () => void; icon: typeof WarningCircleIcon }) {
  return (
    <div
      data-testid="admin-withdrawals-error"
      className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center"
    >
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{message}</p>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-11 xl:min-h-8">
          <ArrowClockwiseIcon aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

export function AdminWithdrawals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseStatusParam(searchParams.get("status"));
  const historyTab = parseHistoryTab(searchParams.get("status"));
  const historyPage = parseHistoryPage(searchParams.get("page"));
  const now = useNow(30_000);
  // After an approve / pay / reject the row leaves the list; keep keyboard focus on the chips instead of the page top.
  const focusLostPending = useRef(false);

  const query = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => adminService.listPendingWithdrawals(),
  });

  const queue = normalizeQueue(query.data);
  const summary = summarize(queue);
  const hasData = query.data !== undefined;
  const view = summary[active];
  const rows = rowsFor(queue.rows, active);
  const other: QueueStatus = active === "PENDING" ? "APPROVED" : "PENDING";

  const selectChip = (status: WithdrawalTab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("status", status);
        next.delete("page");
        return next;
      },
      { replace: false },
    );
  };

  const selectHistoryPage = (page: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (page > 1) next.set("page", String(page));
        else next.delete("page");
        return next;
      },
      { replace: false },
    );
  };

  useEffect(() => {
    if (!focusLostPending.current) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) {
      document.querySelector<HTMLElement>(`[data-testid="admin-withdrawals-chip-${active}"]`)?.focus();
      focusLostPending.current = false;
    }
  }, [query.dataUpdatedAt, active, rows.length]);

  const errorView = query.isError ? describeAdminError(query.error) : null;
  const forbidden = !!errorView && !hasData && (errorView.kind === "forbidden" || errorView.kind === "unauthorized");
  const loadFailed = !!errorView && !hasData && !forbidden;
  const ageOfData = hasData ? staleMinutes(query.dataUpdatedAt, now) : null;
  const refreshFailedWithData = !!errorView && hasData;
  const dimmed = hasData && (ageOfData !== null || refreshFailedWithData);

  const totalVnd = centsToVnd(view.total.cents);
  const totalText = totalVnd === null ? "—" : `${view.lowerBound ? "≥ " : ""}${moneyText(totalVnd)}`;

  const selectedTab: WithdrawalTab = historyTab ?? active;
  // Chips (URL: ?status=). The queue chips carry a count once the queue has loaded; the history chips have none (the
  // count would need a second request per chip) — the total of the open history tab is shown inside it.
  const chips = (
    <div role="group" aria-label="Lọc theo trạng thái" data-testid="admin-withdrawals-chips" className="flex flex-wrap gap-2">
      {ALL_TABS.map((tab) => {
        const selected = tab === selectedTab;
        const queueStatus = tab === "PENDING" || tab === "APPROVED" ? tab : null;
        return (
          <button
            key={tab}
            type="button"
            aria-pressed={selected}
            data-testid={`admin-withdrawals-chip-${tab}`}
            onClick={() => selectChip(tab)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
              selected
                ? "border-adm-text bg-adm-text text-adm-bg"
                : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
            }`}
          >
            {TAB_LABEL[tab]}
            {queueStatus && hasData && (
              <span
                data-testid={`admin-withdrawals-chip-count-${queueStatus}`}
                className={`rounded-full px-2 py-px text-xs font-semibold tabular-nums ${selected ? "bg-adm-bg/20 text-adm-bg" : "bg-adm-pill text-adm-text"}`}
              >
                {countText(summary[queueStatus].count, summary[queueStatus].lowerBound)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5" data-testid="admin-withdrawals-page">
      {/* Header: title + subtitle, last update (the "Làm mới" button is the Tài chính header's) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-adm-text">Rút tiền</h2>
          <p className="mt-0.5 text-sm text-adm-text-2">Duyệt và chuyển khoản các yêu cầu rút tiền của PT và chủ phòng gym.</p>
        </div>
        {/* "Làm mới" lives in the Tài chính header (it re-reads this queue); only the timestamp stays here. */}
        <div className="flex items-center gap-3">
          {hasData && !historyTab && (
            <span data-testid="admin-withdrawals-updated" className="text-xs tabular-nums text-adm-text-2">
              Cập nhật lúc {timeText(query.dataUpdatedAt)}
            </span>
          )}
        </div>
      </div>

      {historyTab ? (
        <>
          {chips}
          <WithdrawalHistoryPanel status={historyTab} page={historyPage} onPage={selectHistoryPage} />
        </>
      ) : query.isLoading ? (
        <Skeleton />
      ) : forbidden ? (
        <ErrorBlock
          icon={LockKeyIcon}
          title="Không có quyền xem"
          message="Tài khoản này không có quyền xem dữ liệu tài chính."
        />
      ) : loadFailed ? (
        <ErrorBlock
          icon={errorView!.kind === "network" ? WifiSlashIcon : WarningCircleIcon}
          title={errorView!.kind === "network" ? "Mất kết nối mạng" : "Không tải được hàng đợi rút tiền"}
          message="Không tải được hàng đợi rút tiền. Đây không phải là “không có yêu cầu” — hãy thử lại trước khi kết luận."
          onRetry={() => query.refetch()}
        />
      ) : (
        <>
          {/* Stale / refresh-failed note (E-08): numbers stay, slightly dimmed */}
          {hasData && (ageOfData !== null || refreshFailedWithData) && (
            <div
              role="status"
              data-testid="admin-withdrawals-stale"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-st-pending-border bg-st-pending-bg px-3 py-2 text-sm text-st-pending"
            >
              <WarningCircleIcon className="size-4 shrink-0" weight="fill" aria-hidden />
              <span>
                {refreshFailedWithData ? "Không làm mới được — " : ""}
                Dữ liệu lúc {timeText(query.dataUpdatedAt)}
                {ageOfData !== null ? ` — đã cũ ${ageOfData} phút` : ""}
              </span>
            </div>
          )}

          {chips}
          <p data-testid="admin-withdrawals-queue-note" className="flex items-start gap-2 text-xs text-adm-text-2">
            <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Hàng đợi chỉ gồm yêu cầu chờ duyệt và đã duyệt (cũ nhất trước, tối đa {WITHDRAWAL_API_LIMIT}); tên người rút chưa có nên đối chiếu người rút bằng mã
              người dùng. Yêu cầu đã chuyển hoặc bị từ chối nằm ở hai nhãn “Đã chuyển” và “Từ chối”.
            </span>
          </p>

          {/* A-03: the list hit the API cap */}
          {queue.truncated && (
            <div
              role="status"
              data-testid="admin-withdrawals-truncated"
              className="flex items-start gap-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2 text-sm text-st-warning"
            >
              <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
              <span>
                Hiển thị {queue.rawCount} yêu cầu cũ nhất — có thể còn nữa. Số lượng và tổng tiền bên dưới là mức tối thiểu; xử lý bớt rồi bấm “Làm mới” để xem tiếp.
              </span>
            </div>
          )}

          {/* Process note: Duyệt is optional; Duyệt ≠ đã chuyển */}
          {active === "APPROVED" ? (
            <div
              role="note"
              data-testid="admin-withdrawal-approved-note"
              className="flex items-start gap-2 rounded-lg border border-st-info-border bg-st-info-bg px-3 py-2 text-sm text-st-info"
            >
              <InfoIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
              <span>
                <b>Đã duyệt ≠ đã chuyển.</b> Tiền mới chỉ được khoá trong ví của người rút, chưa rời khỏi nền tảng. Chuyển khoản xong hãy bấm “Đã chi trả” và nhập
                mã tham chiếu ngân hàng — chỉ lúc đó tiền mới bị trừ.
              </span>
            </div>
          ) : (
            <p data-testid="admin-withdrawals-process-note" className="text-xs text-adm-text-2">
              “Duyệt” chỉ là bước giữ chỗ tuỳ chọn (khoá số tiền lại) khi việc chuyển khoản sẽ mất thời gian — chuyển được ngay thì bấm thẳng “Đã chi trả”. Riêng khoản từ 5.000.000 ₫ trở lên bắt buộc phải “Duyệt” trước, rồi một quản trị viên khác bấm “Đã chi trả”. Tiền
              chỉ thực sự bị trừ khỏi ví ở bước “Đã chi trả”.
            </p>
          )}

          {/* Per-chip summary: count · total of this status only · oldest */}
          {view.count > 0 && (
            <p data-testid="admin-withdrawals-summary" className={`text-sm text-adm-text ${dimmed ? "opacity-80" : ""}`}>
              <span className="font-semibold tabular-nums">{countText(view.count, view.lowerBound)}</span> yêu cầu · Tổng{" "}
              <span data-testid="admin-withdrawals-total" className="font-semibold tabular-nums">
                {totalText}
              </span>
              {view.oldest && (
                <>
                  {" "}
                  · cũ nhất <span className="tabular-nums">{formatAge(view.oldest, now)}</span>
                </>
              )}
              {view.total.invalid > 0 && (
                <span className="text-adm-text-2"> · {view.total.invalid} yêu cầu có số tiền không đọc được nên chưa cộng tổng</span>
              )}
            </p>
          )}
          {queue.ignored > 0 && (
            <p className="text-xs text-adm-text-2">Có {queue.ignored} bản ghi không đọc được trong phản hồi nên không hiển thị.</p>
          )}

          {rows.length === 0 ? (
            <div
              data-testid="admin-withdrawals-empty"
              className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center"
            >
              <MoneyIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
              <p className="text-sm text-adm-text">
                {queue.rows.length === 0
                  ? "Không có yêu cầu rút tiền nào đang chờ xử lý."
                  : active === "PENDING"
                    ? "Không có yêu cầu nào đang chờ duyệt."
                    : "Không có yêu cầu nào đã duyệt đang chờ chuyển khoản."}
              </p>
              {queue.rows.length > 0 && summary[other].count > 0 && (
                <button
                  type="button"
                  onClick={() => selectChip(other)}
                  data-testid="admin-withdrawals-goto-other"
                  className={`mt-3 min-h-11 rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 xl:min-h-8 ${FOCUS}`}
                >
                  Xem {countText(summary[other].count, summary[other].lowerBound)} yêu cầu “{CHIP_LABEL[other]}”
                </button>
              )}
            </div>
          ) : (
            <div
              role="table"
              aria-label={`Yêu cầu rút tiền — ${CHIP_LABEL[active]}`}
              data-testid="admin-withdrawal-requests-list"
              className={`overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card ${dimmed ? "opacity-85" : ""}`}
            >
              <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${ROW_GRID}`}>
                <div role="columnheader">Người rút</div>
                <div role="columnheader" className="text-right">Số tiền</div>
                <div role="columnheader">Thông tin nhận tiền</div>
                <div role="columnheader">Tuổi yêu cầu</div>
                <div role="columnheader">Trạng thái</div>
                <div role="columnheader" className="text-right">Thao tác</div>
              </div>
              <div role="rowgroup">
                {rows.map((r) => (
                  <WithdrawalRow key={r.id} r={r} now={now} onActionDone={() => { focusLostPending.current = true; }} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
