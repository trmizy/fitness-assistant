import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { ArrowClockwiseIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { AdminLink } from "../../../../components/layout/admin/AdminLink";
import { formatMoneyExact, formatVnDateTime } from "../../adminFinanceOverview.utils";
import { Pill } from "../../shared/b9bPill";
import { ShortIdCopy, SkeletonBlock, TxnStatusPill } from "../../finance/transactions/TransactionParts";
import { FOCUS, Rows, type Column } from "../ExceptionParts";
import { ForbiddenPanel, LevelNote, useNow } from "../ReconStates";
import { errorView } from "../useReconciliationData";
import { GATEWAY_CHIP_REASON } from "../reconciliationView";
import {
  EMPTY_TEXT,
  ITEM_CAP,
  L2_BANNER_TEXT,
  MAX_RANGE_DAYS,
  RANGE_PROBLEM_TEXT,
  SEVERITY_LABEL,
  categoryRule,
  categoryTitle,
  categoryTotal,
  isReportClean,
  itemProviderText,
  orderedCategories,
  parseRange,
  rangeProblem,
  transactionLink,
  withRange,
  type DayRange,
  type GatewayCategory,
  type GatewayCounts,
  type GatewayItem,
} from "./gatewayReconciliationModel";
import { useGatewayReconciliation } from "./useGatewayReconciliation";

/**
 * Chip "Đối chiếu cổng ↔ Gymini (L2)". READ ONLY — there is no action on this screen.
 * L2 = what the gateways sent back and Gymini stored; it is NOT an independent comparison with the gateways' settlement files (L3, no source yet).
 * The day range lives in the URL (`?from&to`); loading / error / 403 are states, never "no discrepancy".
 */

const CARD = "rounded-xl border border-adm-border bg-adm-surface shadow-adm-card";
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 disabled:opacity-60 motion-reduce:transition-none lg:min-h-9 ${FOCUS}`;
const INPUT = `min-h-11 rounded-lg border border-adm-border bg-adm-surface px-2.5 text-sm text-adm-text lg:min-h-9 ${FOCUS}`;
const SEVERITY_TONE = { danger: "danger", warning: "warning", info: "info" } as const;

function columns(): Column<GatewayItem>[] {
  return [
    {
      header: "Mã",
      cell: (i) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          {i.transactionId ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className="text-adm-text-2">Giao dịch</span>
              <ShortIdCopy id={i.transactionId} label="mã giao dịch" />
              <AdminLink to={transactionLink(i.transactionId)} className={`inline-flex min-h-11 items-center rounded text-xs font-semibold text-adm-text underline underline-offset-2 ${FOCUS}`}>
                Xem giao dịch
              </AdminLink>
            </span>
          ) : (
            <span className="text-adm-text-2">Chưa khớp giao dịch nào</span>
          )}
          {i.webhookEventId && (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className="text-adm-text-2">Sự kiện</span>
              <ShortIdCopy id={i.webhookEventId} label="mã sự kiện" />
            </span>
          )}
        </span>
      ),
    },
    { header: "Cổng", cell: (i) => itemProviderText(i) },
    { header: "Mã tham chiếu cổng", cell: (i) => <ShortIdCopy id={i.providerTransactionId} label="mã tham chiếu cổng" /> },
    { header: "Trạng thái giao dịch", cell: (i) => (i.transactionStatus ? <TxnStatusPill status={i.transactionStatus} /> : "—") },
    { header: "Số tiền Gymini", right: true, cell: (i) => formatMoneyExact(i.amount) },
    { header: "Số tiền cổng báo", right: true, cell: (i) => formatMoneyExact(i.reportedAmount) },
    { header: "Thời điểm", cell: (i) => formatVnDateTime(i.createdAt) },
    { header: "Ghi chú", cell: (i) => <span className="whitespace-normal break-words">{i.note}</span> },
  ];
}

function CategoryCard({ category, counts }: { category: GatewayCategory; counts: GatewayCounts }) {
  const total = categoryTotal(category, counts);
  const rule = categoryRule(category.code);
  const cols = useMemo(columns, []);
  const truncated = category.truncated || total > category.items.length;
  return (
    <section data-testid={`gw-category-${category.code}`} className={CARD}>
      <h3 className="m-0 flex flex-wrap items-start gap-x-2 gap-y-1.5 px-4 py-3">
        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-adm-text">{categoryTitle(category)}</span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {total > 0 ? (
            <Pill tone={SEVERITY_TONE[category.severity]}>
              <WarningIcon className="size-3.5" aria-hidden /> {SEVERITY_LABEL[category.severity]}
            </Pill>
          ) : (
            <Pill tone="success">
              <CheckCircleIcon className="size-3.5" aria-hidden /> Không có
            </Pill>
          )}
          <span className="min-w-[3.5rem] text-right text-xs text-adm-text-2">
            <span data-testid={`gw-category-${category.code}-count`} className="text-sm font-bold tabular-nums text-adm-text">
              {total}
            </span>{" "}
            mục
          </span>
        </span>
      </h3>
      {rule && <p className="px-4 pb-2 text-[11px] leading-relaxed text-adm-text-2">{rule}</p>}
      {total > 0 && (
        <div className="space-y-2 border-t border-adm-border-soft px-4 pb-4 pt-3">
          <Rows rows={category.items} columns={cols} rowKey={(i) => `${i.webhookEventId ?? ""}:${i.transactionId ?? ""}`} />
          {truncated && (
            <p data-testid={`gw-category-${category.code}-truncated`} className="text-[11px] text-st-warning">
              Chỉ hiện {category.items.length}/{total} mục mới nhất (tối đa {ITEM_CAP} mục mỗi nhóm). Thu hẹp khoảng thời gian để xem đủ.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function GatewayReconciliationView() {
  const [search, setSearch] = useSearchParams();
  const nowMs = useNow(60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const { from, to, explicit } = parseRange(search, now);
  const range: DayRange = useMemo(() => ({ from, to }), [from, to]);
  const problem = rangeProblem(range);
  const q = useGatewayReconciliation(range);

  const setRange = (next: DayRange | null) => setSearch((prev) => withRange(prev, next, new Date()), { replace: true });

  const errInfo = q.isError ? errorView(q.error, "kết quả đối chiếu cổng") : null;
  if (errInfo?.forbidden) return <ForbiddenPanel />;

  const report = problem ? null : (q.data ?? null);
  const clean = report ? isReportClean(report) : false;

  return (
    <div data-testid="recon-gateway" className="space-y-4">
      <h2 className="text-base font-bold text-adm-text">Đối chiếu cổng ↔ Gymini</h2>

      <LevelNote level="L2" testId="gw-level-note" text={`Mức L2 — ${L2_BANNER_TEXT} Chỉ đọc: màn hình này không có thao tác nào.`} />
      <p data-testid="gw-l3-note" className="text-[11px] leading-relaxed text-adm-text-2">
        Đối soát độc lập với báo cáo quyết toán của cổng/ngân hàng: {GATEWAY_CHIP_REASON}. Gymini không hiện số liệu giả thay cho phần này.
      </p>

      <div role="group" aria-label="Khoảng thời gian đối chiếu" data-testid="gw-range" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-adm-text-2">
          Từ ngày
          <input
            type="date"
            value={from}
            max={to}
            data-testid="gw-range-from"
            onChange={(e) => e.target.value && setRange({ from: e.target.value, to })}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-adm-text-2">
          Đến hết ngày
          <input
            type="date"
            value={to}
            min={from}
            data-testid="gw-range-to"
            onChange={(e) => e.target.value && setRange({ from, to: e.target.value })}
            className={INPUT}
          />
        </label>
        {explicit && (
          <button type="button" data-testid="gw-range-reset" onClick={() => setRange(null)} className={BTN}>
            30 ngày gần nhất
          </button>
        )}
        <button type="button" data-testid="gw-refresh" onClick={() => void q.refetch()} disabled={!!problem || q.isFetching} className={BTN}>
          <ArrowClockwiseIcon className={`size-3.5 ${q.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Tải lại
        </button>
      </div>
      <p className="text-[11px] text-adm-text-2">Tối đa {MAX_RANGE_DAYS} ngày mỗi lần xem. Mặc định là 30 ngày gần nhất.</p>
      {problem && (
        <p data-testid="gw-range-problem" role="alert" className="text-xs font-semibold text-st-danger">
          {RANGE_PROBLEM_TEXT[problem]}
        </p>
      )}

      {!problem && q.isPending && <SkeletonBlock rows={4} testId="gw-loading" />}

      {!problem && errInfo && !report && (
        <div data-testid="gw-error" role="alert" className={`${CARD} space-y-2 p-4`}>
          <p className="flex items-start gap-2 text-sm font-semibold text-st-danger">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {errInfo.message}
          </p>
          <button type="button" onClick={() => void q.refetch()} className={BTN}>
            <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
          </button>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <p data-testid="gw-summary" className="text-xs text-adm-text-2">
            Đã xem {report.counts.webhookEventsInRange} sự kiện cổng gửi về và {report.counts.paidGatewayTransactionsInRange} giao dịch đã thanh toán qua cổng
            trong khoảng này. Dữ liệu lúc {formatVnDateTime(report.generatedAt)}.
          </p>
          {report.counts.coveredByGatewayDiscrepancies > 0 && (
            <p data-testid="gw-covered" className="text-xs text-adm-text-2">
              {report.counts.coveredByGatewayDiscrepancies} giao dịch lệch đã có trong nhóm “Cổng báo số tiền khác số Gymini” ở tab Ngoại lệ nên không đếm lại ở đây.{" "}
              <AdminLink to="/admin/finance/reconciliation?view=exceptions" className={`inline-flex min-h-11 items-center rounded font-semibold text-adm-text underline underline-offset-2 ${FOCUS}`}>
                Mở tab Ngoại lệ
              </AdminLink>
            </p>
          )}
          {report.ignored > 0 && (
            <p data-testid="gw-ignored" className="text-xs text-st-warning">
              {report.ignored} dòng của kết quả không đọc được nên không hiển thị.
            </p>
          )}

          {clean ? (
            <div data-testid="gw-empty" className={`${CARD} flex items-center gap-2 px-4 py-6 text-sm font-semibold text-st-success`}>
              <CheckCircleIcon className="size-5 shrink-0" aria-hidden /> {EMPTY_TEXT}
            </div>
          ) : (
            <div className="space-y-3">
              {orderedCategories(report).map((c) => (
                <CategoryCard key={c.code} category={c} counts={report.counts} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
