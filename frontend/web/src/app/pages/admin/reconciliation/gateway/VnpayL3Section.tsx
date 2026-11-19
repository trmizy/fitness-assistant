import { useMemo, useState } from "react";
import { ArrowClockwiseIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { AdminLink } from "../../../../components/layout/admin/AdminLink";
import { formatMoneyExact, formatVnDateTime } from "../../adminFinanceOverview.utils";
import { Pill } from "../../shared/b9bPill";
import { ShortIdCopy, SkeletonBlock, TxnStatusPill } from "../../finance/transactions/TransactionParts";
import { FOCUS, Rows, type Column } from "../ExceptionParts";
import { errorView } from "../useReconciliationData";
import type { DayRange } from "./gatewayReconciliationModel";
import {
  L3_CLEAN_TEXT,
  L3_INTRO,
  L3_ITEM_CAP,
  L3_MAX_RANGE_DAYS,
  L3_NOT_CONFIGURED_TEXT,
  L3_RANGE_PROBLEM_TEXT,
  L3_TITLE,
  RESULT_LABEL,
  countChips,
  defaultL3Range,
  groupL3Items,
  isL3Clean,
  l3RangeProblem,
  l3TransactionLink,
  resultTone,
  vnpayStatusText,
  type VnpayL3Item,
  type VnpayL3Report,
} from "./vnpayL3Model";
import { useVnpayL3 } from "./useVnpayL3";

/**
 * Section "Đối chiếu trực tiếp với VNPay (L3)" of the gateway view. READ ONLY and ON DEMAND: nothing is asked until "Hỏi VNPay" is clicked.
 * "Không hỏi được" rows are shown apart from the mismatches — a failed lookup is not a discrepancy.
 */

const CARD = "rounded-xl border border-adm-border bg-adm-surface shadow-adm-card";
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 disabled:opacity-60 motion-reduce:transition-none lg:min-h-9 ${FOCUS}`;
const INPUT = `min-h-11 rounded-lg border border-adm-border bg-adm-surface px-2.5 text-sm text-adm-text lg:min-h-9 ${FOCUS}`;

function columns(): Column<VnpayL3Item>[] {
  return [
    {
      header: "Giao dịch",
      cell: (i) => (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <ShortIdCopy id={i.transactionId} label="mã giao dịch" />
          <AdminLink to={l3TransactionLink(i.transactionId)} className={`inline-flex min-h-11 items-center rounded text-xs font-semibold text-adm-text underline underline-offset-2 ${FOCUS}`}>
            Xem giao dịch
          </AdminLink>
        </span>
      ),
    },
    { header: "Mã tham chiếu cổng", cell: (i) => <ShortIdCopy id={i.providerTransactionId} label="mã tham chiếu cổng" /> },
    { header: "Gymini", cell: (i) => <TxnStatusPill status={i.gyminiStatus} /> },
    { header: "Số tiền Gymini", right: true, cell: (i) => formatMoneyExact(i.gyminiAmount) },
    { header: "VNPay", cell: (i) => vnpayStatusText(i.vnpayStatusCode) },
    { header: "Số tiền VNPay", right: true, cell: (i) => formatMoneyExact(i.vnpayAmount) },
    { header: "Kết quả", cell: (i) => <Pill tone={resultTone(i.result)}>{RESULT_LABEL[i.result]}</Pill> },
    { header: "Ghi chú", cell: (i) => <span className="whitespace-normal break-words">{i.note}</span> },
  ];
}

function ResultTable({ testId, title, hint, rows }: { testId: string; title: string; hint?: string; rows: VnpayL3Item[] }) {
  const cols = useMemo(columns, []);
  if (rows.length === 0) return null;
  return (
    <section data-testid={testId} className={`${CARD} space-y-2 px-4 pb-4 pt-3`}>
      <h4 className="m-0 flex items-center gap-2 text-sm font-semibold text-adm-text">
        {title} <span className="text-xs font-normal text-adm-text-2">({rows.length})</span>
      </h4>
      {hint && <p className="text-[11px] leading-relaxed text-adm-text-2">{hint}</p>}
      <Rows rows={rows} columns={cols} rowKey={(i) => i.transactionId} />
    </section>
  );
}

function Result({ report }: { report: VnpayL3Report }) {
  const g = groupL3Items(report);
  if (!report.configured) {
    return (
      <p data-testid="l3-not-configured" role="status" className={`${CARD} px-4 py-5 text-sm font-semibold text-adm-text-2`}>
        {L3_NOT_CONFIGURED_TEXT}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul data-testid="l3-counts" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {countChips(report.counts).map((c) => (
          <li key={c.key} data-testid={`l3-count-${c.key}`} className="flex items-center gap-1.5 text-xs text-adm-text-2">
            <Pill tone={c.tone}>{c.label}</Pill>
            <span className="text-sm font-bold tabular-nums text-adm-text">{c.value}</span>
          </li>
        ))}
      </ul>
      <p data-testid="l3-summary" className="text-xs text-adm-text-2">
        Đã hỏi VNPay {report.counts.checked} giao dịch lúc {formatVnDateTime(report.generatedAt)}.
      </p>
      {report.truncated && (
        <p data-testid="l3-truncated" className="text-[11px] text-st-warning">
          Chỉ hỏi {L3_ITEM_CAP} giao dịch cũ nhất trong khoảng này. Thu hẹp khoảng thời gian để xem các giao dịch còn lại.
        </p>
      )}
      {report.ignored > 0 && (
        <p data-testid="l3-ignored" className="text-xs text-st-warning">
          {report.ignored} dòng của kết quả không đọc được nên không hiển thị.
        </p>
      )}
      {report.counts.checked === 0 && (
        <p data-testid="l3-none" className={`${CARD} px-4 py-5 text-sm text-adm-text-2`}>
          Không có giao dịch VNPay nào trong khoảng thời gian này.
        </p>
      )}
      {isL3Clean(report) && (
        <div data-testid="l3-clean" className={`${CARD} flex items-center gap-2 px-4 py-5 text-sm font-semibold text-st-success`}>
          <CheckCircleIcon className="size-5 shrink-0" aria-hidden /> {L3_CLEAN_TEXT}
        </div>
      )}
      <ResultTable testId="l3-attention" title="Lệch so với VNPay" rows={g.attention} />
      <ResultTable
        testId="l3-failed"
        title="Không hỏi được"
        hint="Chưa kiểm tra được các giao dịch này (lỗi mạng, quá thời gian chờ, chữ ký không hợp lệ hoặc VNPay giới hạn tốc độ). Đây không phải là lệch — hỏi lại sau."
        rows={g.failed}
      />
      {g.notFoundNormal.length > 0 && (
        <p data-testid="l3-notfound-normal" className="text-[11px] leading-relaxed text-adm-text-2">
          {g.notFoundNormal.length} giao dịch chưa thanh toán ở Gymini mà VNPay cũng không có — thường là khách chưa vào trang thanh toán, không phải lệch.
        </p>
      )}
    </div>
  );
}

export function VnpayL3Section() {
  const [range, setRange] = useState<DayRange>(() => defaultL3Range(new Date()));
  const { query: q, asked, ask } = useVnpayL3();
  const problem = l3RangeProblem(range);
  const err = q.isError ? errorView(q.error, "kết quả đối chiếu trực tiếp với VNPay") : null;
  const report = q.data ?? null;

  return (
    <section data-testid="recon-gateway-l3" aria-labelledby="gw-l3-title" className="space-y-3">
      <h3 id="gw-l3-title" className="m-0 text-base font-bold text-adm-text">
        {L3_TITLE}
      </h3>
      <p data-testid="l3-intro" className="text-[11px] leading-relaxed text-adm-text-2">
        {L3_INTRO}
      </p>

      <div role="group" aria-label="Khoảng thời gian hỏi VNPay" data-testid="l3-range" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-adm-text-2">
          Từ ngày
          <input type="date" value={range.from} max={range.to} data-testid="l3-range-from" onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-adm-text-2">
          Đến hết ngày
          <input type="date" value={range.to} min={range.from} data-testid="l3-range-to" onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className={INPUT} />
        </label>
        <button type="button" data-testid="l3-ask" onClick={() => ask(range)} disabled={!!problem || q.isFetching} className={BTN}>
          <ArrowClockwiseIcon className={`size-3.5 ${q.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Hỏi VNPay
        </button>
      </div>
      <p className="text-[11px] text-adm-text-2">Tối đa {L3_MAX_RANGE_DAYS} ngày mỗi lần hỏi. Mặc định là 7 ngày gần nhất. Chỉ hỏi khi bấm nút.</p>
      {problem && (
        <p data-testid="l3-range-problem" role="alert" className="text-xs font-semibold text-st-danger">
          {L3_RANGE_PROBLEM_TEXT[problem]}
        </p>
      )}

      {!asked && !problem && (
        <p data-testid="l3-idle" className="text-xs text-adm-text-2">
          Chưa hỏi VNPay. Chọn khoảng thời gian rồi bấm “Hỏi VNPay”.
        </p>
      )}
      {asked && q.isFetching && <SkeletonBlock rows={3} testId="l3-loading" />}
      {asked && !q.isFetching && err && (
        <div data-testid="l3-error" role="alert" className={`${CARD} space-y-2 p-4`}>
          <p className="flex items-start gap-2 text-sm font-semibold text-st-danger">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {err.forbidden ? "Tài khoản này không có quyền hỏi VNPay, hoặc phiên đăng nhập đã hết hạn." : err.message}
          </p>
        </div>
      )}
      {asked && !q.isFetching && report && <Result report={report} />}
    </section>
  );
}
