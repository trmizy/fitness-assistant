import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { InfoIcon, WalletIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { personalizedServiceApi } from "../../services/api";
import { describeAdminError } from "./shared/useAdminError";
import { MembershipRefundCard } from "./refunds/MembershipRefundCard";
import { ErrorBlock } from "./refunds/ErrorBlock";
import { REFUND_LIST_KEY, REFUND_ROW_GRID, ServiceRefundRow } from "./refunds/ServiceRefundRow";
import {
  REFUND_TYPES,
  formatAge,
  normalizeServiceRefunds,
  parseTypeParam,
  staleMinutes,
  summarizeServiceRefunds,
  type RefundType,
} from "./refunds/refundQueue";

/**
 * "Tài chính › Hoàn tiền" (B6a) — one place for the two refund flows, as two chips kept in the URL
 * (`?type=service|membership`):
 *  - `service`  — personalised PT service orders whose client asked for a refund (ai-service `REFUND_REQUESTED`):
 *    a table-on-desktop / card-on-phone worklist, oldest first, the admin opens a row to see the REAL numbers (total
 *    paid, already refunded, refundable ceiling, delivery milestones) and decides explicitly (approve ≤ ceiling / deny
 *    with a note). Approving really moves money through payment-service.
 *  - `membership` — the exceptional gym-membership refund. There is NO list and NO read-by-id endpoint, so this chip
 *    is the paste-an-id form (shared component with the dashboard card) and says so; the amount is computed by the
 *    server and cannot be previewed.
 *
 * Both credit the CLIENT'S WALLET (available balance) — never a card or bank transfer; the money leaves the platform
 * only when the client withdraws. Data limits are shown, not hidden: the service endpoint returns only pending
 * requests (no history, no status filter) so there are no status chips, and no total of refund money is computed
 * (the ceiling exists per order only).
 *
 * B1 behaviour (confirmation dialogs, per-row pending, one POST per confirmation, no retry, errors ≠ empty,
 * amount ≤ ceiling guard, note required) lives in `refunds/ServiceRefundRow.tsx` / `MembershipRefundCard.tsx`.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

const CHIP_LABEL: Record<RefundType, string> = { service: "Dịch vụ cá nhân hoá", membership: "Gói hội viên (ngoại lệ)" };

const timeText = (ms: number) =>
  ms ? new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";

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
    <div role="status" aria-label="Đang tải" aria-busy="true" data-testid="admin-refunds-loading" className="space-y-4">
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
      <span className="sr-only">Đang tải danh sách yêu cầu hoàn tiền…</span>
    </div>
  );
}

export function PTServiceRefunds() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseTypeParam(searchParams.get("type"));
  const now = useNow(30_000);
  // After an approve / deny the row leaves the list; keep keyboard focus on the chips instead of the page top.
  const focusLostPending = useRef(false);

  const query = useQuery({ queryKey: REFUND_LIST_KEY, queryFn: () => personalizedServiceApi.listRefundRequests() });

  const hasData = query.data !== undefined;
  const queue = normalizeServiceRefunds(query.data);
  const summary = summarizeServiceRefunds(queue.rows);

  const selectChip = (type: RefundType) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("type", type);
        return next;
      },
      { replace: false },
    );
  };

  useEffect(() => {
    if (!focusLostPending.current) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) {
      document.querySelector<HTMLElement>(`[data-testid="admin-refunds-chip-${active}"]`)?.focus();
      focusLostPending.current = false;
    }
  }, [query.dataUpdatedAt, active, queue.rows.length]);

  const errorView = query.isError ? describeAdminError(query.error) : null;
  const forbidden = !!errorView && !hasData && (errorView.kind === "forbidden" || errorView.kind === "unauthorized");
  const loadFailed = !!errorView && !hasData && !forbidden;
  const ageOfData = hasData ? staleMinutes(query.dataUpdatedAt, now) : null;
  const refreshFailedWithData = !!errorView && hasData;
  const dimmed = hasData && (ageOfData !== null || refreshFailedWithData);

  return (
    <div className="space-y-5" data-testid="admin-refunds-page">
      {/* Header: title + subtitle, last update (the "Làm mới" button is the Tài chính header's) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-adm-text">Hoàn tiền</h2>
          <p className="mt-0.5 text-sm text-adm-text-2">Xử lý các yêu cầu hoàn tiền dịch vụ cá nhân hoá và hoàn tiền gói hội viên ngoại lệ.</p>
        </div>
        {active === "service" && (
          // "Làm mới" lives in the Tài chính header (it re-reads this queue); only the timestamp stays here.
          <div className="flex items-center gap-3">
            {hasData && (
              <span data-testid="admin-refunds-updated" className="text-xs tabular-nums text-adm-text-2">
                Cập nhật lúc {timeText(query.dataUpdatedAt)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Where the money goes — the same for both kinds */}
      <p
        role="note"
        data-testid="admin-refunds-wallet-note"
        className="flex items-start gap-2 rounded-lg border border-st-info-border bg-st-info-bg px-3 py-2 text-sm text-st-info"
      >
        <WalletIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
        <span>
          <b>Hoàn tiền = ghi có vào ví khách hàng</b> (số dư khả dụng), không phải chuyển khoản về thẻ hay ngân hàng. Tiền chỉ rời nền tảng khi khách tự rút.
        </span>
      </p>

      {/* Chips (URL: ?type=) */}
      <div role="group" aria-label="Loại hoàn tiền" data-testid="admin-refunds-chips" className="flex flex-wrap gap-2">
        {REFUND_TYPES.map((type) => {
          const selected = type === active;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={selected}
              data-testid={`admin-refunds-chip-${type}`}
              onClick={() => selectChip(type)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
                selected ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
              }`}
            >
              {CHIP_LABEL[type]}
              {type === "service" && hasData && (
                <span
                  data-testid="admin-refunds-chip-count-service"
                  className={`rounded-full px-2 py-px text-xs font-semibold tabular-nums ${selected ? "bg-adm-bg/20 text-adm-bg" : "bg-adm-pill text-adm-text"}`}
                >
                  {summary.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active === "membership" ? (
        <section className="space-y-4" aria-label="Hoàn tiền gói hội viên" data-testid="admin-refunds-membership">
          <div
            role="note"
            data-testid="admin-refunds-membership-note"
            className="flex items-start gap-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2 text-sm text-st-warning"
          >
            <InfoIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
            <span>
              Hoàn tiền hội viên là <b>ngoại lệ</b>, không có hàng đợi: backend chưa có API cho admin liệt kê hoặc xem gói hội viên theo mã, nên chưa hiện được khách,
              gói hay số tiền trước khi hoàn. Số tiền do hệ thống tự tính theo số ngày còn lại của gói — màn hình này không ước tính con số đó. Hãy lấy mã gói từ nguồn
              đáng tin rồi dán vào đây.
            </span>
          </div>
          <MembershipRefundCard />
        </section>
      ) : query.isLoading ? (
        <Skeleton />
      ) : forbidden ? (
        <ErrorBlock testId="refund-requests-error" view={errorView!} message="" />
      ) : loadFailed ? (
        <ErrorBlock
          testId="refund-requests-error"
          view={errorView!}
          message="Không tải được danh sách yêu cầu hoàn tiền. Đây không phải là “không có yêu cầu” — hãy thử lại trước khi kết luận."
          onRetry={() => query.refetch()}
        />
      ) : (
        <>
          {/* Stale / refresh-failed note (E-08): numbers stay, slightly dimmed */}
          {hasData && (ageOfData !== null || refreshFailedWithData) && (
            <div
              role="status"
              data-testid="admin-refunds-stale"
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

          <p data-testid="admin-refunds-data-note" className="flex items-start gap-2 text-xs text-adm-text-2">
            <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Danh sách chỉ gồm các đơn đang chờ xử lý hoàn tiền (cũ nhất trước); lịch sử đã duyệt/từ chối chưa có API nên chưa hiển thị. Số tiền tối đa được hoàn của từng đơn
              chỉ có sau khi mở đơn đó.
            </span>
          </p>

          {summary.count > 0 && (
            <p data-testid="admin-refunds-summary" className={`text-sm text-adm-text ${dimmed ? "opacity-80" : ""}`}>
              <span className="font-semibold tabular-nums">{summary.count}</span> yêu cầu đang chờ
              {summary.oldest && (
                <>
                  {" "}
                  · cũ nhất <span className="tabular-nums">{formatAge(summary.oldest, now)}</span>
                </>
              )}
            </p>
          )}
          {queue.ignored > 0 && (
            <p className="text-xs text-adm-text-2">Có {queue.ignored} bản ghi không đọc được trong phản hồi nên không hiển thị.</p>
          )}

          {queue.rows.length === 0 ? (
            <div data-testid="admin-refunds-empty" className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center">
              <WalletIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
              <p className="text-sm text-adm-text">Không có yêu cầu hoàn tiền nào đang chờ xử lý.</p>
            </div>
          ) : (
            <div
              role="table"
              aria-label="Yêu cầu hoàn tiền dịch vụ cá nhân hoá"
              data-testid="refund-requests-list"
              className={`overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card ${dimmed ? "opacity-85" : ""}`}
            >
              <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${REFUND_ROW_GRID}`}>
                <div role="columnheader">Ai</div>
                <div role="columnheader">Dịch vụ</div>
                <div role="columnheader" className="text-right">Giá đơn</div>
                <div role="columnheader">Tuổi yêu cầu</div>
                <div role="columnheader">Trạng thái</div>
                <div role="columnheader" className="text-right">Thao tác</div>
              </div>
              <div role="rowgroup">
                {queue.rows.map((item) => (
                  <ServiceRefundRow
                    key={item.id}
                    item={item}
                    now={now}
                    onActionDone={() => {
                      focusLostPending.current = true;
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
