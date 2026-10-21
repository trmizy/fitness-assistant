import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowsClockwiseIcon as RefreshCw, CheckCircleIcon as CheckCircle2, CircleNotchIcon as Loader2, WarningIcon as AlertTriangle } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { formatVND } from "../../utils/currency";
import {
  TargetUnverifiedCandidate,
  DisputeItem,
  EndedWithoutSettledEndingItem,
  NegativeSubledgerRow,
  NegativeWalletRow,
  ObligationsReport,
  PaidNotActivatedRow,
  ReceivableRow,
  SessionsReconciliationReport,
  SettlementAttentionItem,
  UnconfirmedEndingItem,
  UnpaidObligationRow,
  WalletMismatchRow,
  activationLabel,
  attentionReasonLabel,
  bucketLabel,
  contractStatusLabel,
  countAttention,
  disputeTypeLabel,
  formatAge,
  formatDateTimeVi,
  normalizeObligationsReport,
  normalizeSessionsReport,
  obligationKindLabel,
  partyLabel,
  purposeLabel,
  settlementKindLabel,
  settlementStatusLabel,
  shortId,
  slaLabel,
  terminationReasonLabel,
  toAmount,
} from "./adminReconciliation.utils";

/**
 * Tab "Đối soát" — các khối CHỈ ĐỌC (FH-4, DQ-6): không có nút chuyển tiền, hoàn tiền hay sửa. Mỗi khối là một
 * danh sách để admin nhìn thấy "cái gì đang kẹt và kẹt bao lâu"; việc xử lý đi qua công cụ có kiểm toán phía vận hành.
 * Hai nguồn độc lập: nếu một bên lỗi, bên kia vẫn hiện.
 */

const money = (v: string | number | null | undefined) => {
  const n = toAmount(v);
  return n === null ? "—" : formatVND(n);
};

// ───────────────────────────────────────────────────────────── khung dùng chung ──
interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  right?: boolean;
}

/** Bảng từ `sm` trở lên; thẻ xếp dọc (nhãn: giá trị) ở màn hình hẹp 360–412px, không cuộn ngang. */
function Rows<T>({ rows, columns, rowKey }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string }) {
  return (
    <>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 text-left border-b border-zinc-800/60">
              {columns.map((c) => (
                <th key={c.header} className={`py-1.5 pr-3 font-medium ${c.right ? "text-right" : ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-b border-zinc-800/40 last:border-0 text-zinc-300 align-top">
                {columns.map((c) => (
                  <td key={c.header} className={`py-1.5 pr-3 ${c.right ? "text-right" : ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="sm:hidden space-y-2">
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2.5 text-xs space-y-1">
            {columns.map((c, i) => (
              <div key={c.header} className={i === 0 ? "text-zinc-100 font-semibold" : "flex justify-between gap-3"}>
                {i === 0 ? (
                  c.cell(r)
                ) : (
                  <>
                    <span className="text-zinc-500 shrink-0">{c.header}</span>
                    <span className="text-zinc-300 text-right break-words min-w-0">{c.cell(r)}</span>
                  </>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function Block({
  testId,
  title,
  hint,
  count,
  tone,
  truncated,
  emptyText,
  children,
}: {
  testId: string;
  title: string;
  hint?: string;
  count: number;
  /** critical: đỏ khi count>0 · watch: vàng khi count>0 · neutral: xám (thông tin, không phải cảnh báo) */
  tone: "critical" | "watch" | "neutral";
  truncated?: boolean;
  emptyText: string;
  children?: ReactNode;
}) {
  const active = count > 0;
  const badge = !active
    ? "bg-green-500/10 text-green-400"
    : tone === "critical"
      ? "bg-red-500/10 text-red-400"
      : tone === "neutral"
        ? "bg-zinc-500/10 text-zinc-300"
        : "bg-amber-500/10 text-amber-400";
  return (
    <section data-testid={testId} className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-zinc-200">{title}</h4>
          {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
        </div>
        <span data-testid={`${testId}-count`} className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${badge}`}>
          {count}
        </span>
      </div>
      <div className="mt-3">
        {active ? (
          <>
            {children}
            {truncated && (
              <p className="text-[11px] text-zinc-500 mt-2">Chỉ hiện các mục đầu tiên; còn nhiều mục khác chưa hiển thị.</p>
            )}
          </>
        ) : (
          <p data-testid={`${testId}-empty`} className="text-xs text-zinc-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> {emptyText}
          </p>
        )}
      </div>
    </section>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 pt-2">{children}</h3>;
}

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between gap-3">
      <p className="text-xs text-amber-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Không tải được {what}.
      </p>
      <button onClick={onRetry} className="text-xs font-semibold text-zinc-300 hover:text-zinc-100 shrink-0">
        Thử lại
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── cột từng khối ──
const subledgerCols: Column<NegativeSubledgerRow>[] = [
  { header: "Bên giữ tiền", cell: (r) => `${partyLabel(r.ownerType)} ${shortId(r.owner)}` },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionShortId) },
  { header: "Âm", cell: (r) => <span className="text-red-400 font-semibold">{money(r.net)}</span>, right: true },
  { header: "Số bút toán", cell: (r) => r.entries, right: true },
  { header: "Từ — đến", cell: (r) => `${formatDateTimeVi(r.firstEntry)} — ${formatDateTimeVi(r.lastEntry)}` },
];
const negativeWalletCols: Column<NegativeWalletRow>[] = [
  { header: "Ví", cell: (r) => `${partyLabel(r.ownerType)} ${shortId(r.owner)}` },
  { header: "Khả dụng", cell: (r) => money(r.available), right: true },
  { header: "Đang chờ", cell: (r) => money(r.pending), right: true },
  { header: "Đang khóa", cell: (r) => money(r.locked), right: true },
];
const mismatchCols: Column<WalletMismatchRow>[] = [
  { header: "Ví", cell: (r) => `${partyLabel(r.ownerType)} ${shortId(r.owner)}${r.isEscrow ? " (tiền giữ hộ)" : ""}` },
  { header: "Khoản", cell: (r) => bucketLabel(r.bucket) },
  { header: "Trên ví", cell: (r) => money(r.wallet), right: true },
  { header: "Theo sổ cái", cell: (r) => money(r.ledger), right: true },
  { header: "Chênh", cell: (r) => <span className={r.isEscrow ? "text-amber-400" : "text-red-400 font-semibold"}>{money(r.difference)}</span>, right: true },
];
const receivableCols: Column<ReceivableRow>[] = [
  { header: "Đối tượng", cell: (r) => `${partyLabel(r.partnerType)} ${shortId(r.partner)}` },
  {
    header: "Trạng thái",
    cell: (r) =>
      r.state === "SUSPENDED" ? (
        <span className="text-amber-400">Tạm ngừng thu{r.suspensionRef ? ` (${r.suspensionRef})` : ""}</span>
      ) : (
        <span className="text-zinc-300">Đang thu</span>
      ),
  },
  { header: "Còn nợ", cell: (r) => <span className="font-semibold">{money(r.outstanding)}</span>, right: true },
  { header: "Đã thu / đã miễn", cell: (r) => `${money(r.recovered)} / ${money(r.waived)}`, right: true },
  { header: "Lý do", cell: (r) => r.reason || "—" },
  { header: "Phát sinh", cell: (r) => formatDateTimeVi(r.createdAt) },
];
const obligationCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Phải trả cho", cell: (r) => partyLabel(r.party) },
  { header: "Còn thiếu", cell: (r) => <span className="font-semibold">{money(r.unpaid)}</span>, right: true },
  { header: "Đã trả / phải trả", cell: (r) => `${money(r.paid)} / ${money(r.owed)}`, right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Buổi", cell: (r) => shortId(r.sessionId) },
  { header: "Lý do", cell: (r) => r.reason || "—" },
  { header: "Phát sinh", cell: (r) => formatDateTimeVi(r.createdAt) },
];
const paidNotActivatedCols: Column<PaidNotActivatedRow>[] = [
  { header: "Loại giao dịch", cell: (r) => purposeLabel(r.purpose) },
  { header: "Số tiền", cell: (r) => money(r.amount), right: true },
  { header: "Tình trạng", cell: (r) => activationLabel(r.activationStatus) },
  { header: "Đã trả cách đây", cell: (r) => formatAge(r.ageMinutes), right: true },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionId) },
];
const candidateCols: Column<TargetUnverifiedCandidate>[] = [
  { header: "Loại giao dịch", cell: (r) => purposeLabel(r.targetType) },
  { header: "Số tiền", cell: (r) => money(r.amount), right: true },
  { header: "Tiền còn giữ ở đối tác", cell: (r) => money(r.partnerPendingRemaining), right: true },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionId) },
];
const attentionCols: Column<SettlementAttentionItem>[] = [
  { header: "Việc", cell: (r) => settlementKindLabel(r.kind) },
  { header: "Vì sao cần xem", cell: (r) => attentionReasonLabel(r.reason) },
  { header: "Số tiền liên quan", cell: (r) => money(r.amountAtStake), right: true },
  { header: "Số lần thử", cell: (r) => r.attempts, right: true },
  { header: "Treo", cell: (r) => formatAge(r.ageMinutes), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId) },
];
const unconfirmedCols: Column<UnconfirmedEndingItem>[] = [
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId) },
  { header: "Lý do kết thúc", cell: (r) => terminationReasonLabel(r.endingReason) },
  { header: "Tình trạng", cell: (r) => settlementStatusLabel(r.status) },
  { header: "Số tiền liên quan", cell: (r) => money(r.amountAtStake), right: true },
  { header: "Chờ", cell: (r) => formatAge(r.ageMinutes), right: true },
];
const endedCols: Column<EndedWithoutSettledEndingItem>[] = [
  { header: "Hợp đồng", cell: (r) => `${shortId(r.contractId)} · ${contractStatusLabel(r.contractStatus)}` },
  { header: "Lý do kết thúc", cell: (r) => terminationReasonLabel(r.terminationReason) },
  { header: "Tất toán", cell: (r) => (r.hasIntent ? settlementStatusLabel(r.settlementStatus) : "Chưa ghi nhận việc tất toán") },
  { header: "Số tiền liên quan", cell: (r) => money(r.amountAtStake), right: true },
  { header: "Kết thúc cách đây", cell: (r) => formatAge(r.ageMinutes), right: true },
];
const disputeCols: Column<DisputeItem>[] = [
  { header: "Tranh chấp", cell: (r) => disputeTypeLabel(r.disputeType) },
  {
    header: "Hạn xử lý",
    cell: (r) => (
      <span className={r.slaState === "OVERDUE" ? "text-red-400 font-semibold" : r.slaState === "DUE_SOON" ? "text-amber-400" : "text-zinc-300"}>
        {slaLabel(r.slaState)} ({r.ageDays} ngày)
      </span>
    ),
  },
  { header: "Giá trị buổi", cell: (r) => money(r.sessionValue), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId) },
];

// ───────────────────────────────────────────────────────────── phần hiển thị ──
function PaymentBlocks({ r }: { r: ObligationsReport }) {
  const s = r.summary;
  return (
    <>
      <GroupTitle>Sổ cái tiền</GroupTitle>
      <Block
        testId="recon-negative-subledgers"
        title="Tiền chờ của hợp đồng bị rút quá mức"
        hint="Một hợp đồng đã bị trừ nhiều hơn số tiền đã ghi cho nó (lấy từ tiền chờ của hợp đồng khác)."
        count={s.negativeSubledgers.count}
        tone="critical"
        truncated={r.truncated.negativeSubledgers}
        emptyText="Không có hợp đồng nào bị trừ quá số tiền của nó."
      >
        <p className="text-xs text-zinc-400 mb-2">
          Tổng tiền chờ của hợp đồng khác đang bị thiếu: <span className="text-red-400 font-semibold">{money(s.negativeSubledgers.unbackedTotal)}</span>
        </p>
        <Rows rows={r.negativeSubledgers} columns={subledgerCols} rowKey={(x) => `${x.ownerType}-${x.owner}-${x.transactionId}`} />
      </Block>
      <Block
        testId="recon-negative-wallets"
        title="Ví có số dư âm"
        hint="Luôn là lỗi, không bao giờ được xảy ra."
        count={s.negativeWallets}
        tone="critical"
        truncated={r.truncated.negativeWallets}
        emptyText="Không có ví nào âm."
      >
        <Rows rows={r.negativeWallets} columns={negativeWalletCols} rowKey={(x) => `${x.ownerType}-${x.owner}`} />
      </Block>
      <Block
        testId="recon-wallet-mismatch"
        title="Ví lệch so với sổ cái"
        hint="Số dư trên ví khác tổng các bút toán của chính ví đó. Dòng “tiền giữ hộ” chỉ là thông tin (dữ liệu mẫu có thể không ghi đủ)."
        count={s.walletMismatches.nonEscrowCount}
        tone="critical"
        truncated={r.truncated.walletMismatches}
        emptyText="Mọi ví khớp với sổ cái."
      >
        <Rows rows={r.walletMismatches} columns={mismatchCols} rowKey={(x) => `${x.ownerType}-${x.owner}-${x.bucket}`} />
      </Block>

      <GroupTitle>Khoản đối tác còn nợ và nghĩa vụ chưa trả</GroupTitle>
      <Block
        testId="recon-receivables"
        title="Khoản phải thu từ đối tác"
        hint="Nền tảng đã ứng trước và chưa thu lại. Đang thu: sẽ trừ vào thu nhập sau này (nếu bật). Tạm ngừng: không thu cho đến khi có quyết định."
        count={s.receivables.active.count + s.receivables.suspended.count}
        tone="watch"
        truncated={r.truncated.receivables}
        emptyText="Không có khoản phải thu nào còn mở."
      >
        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
          <div data-testid="recon-receivables-active">
            <div className="text-zinc-500">Đang thu</div>
            <div className="text-zinc-200 font-semibold">
              {s.receivables.active.count} khoản · {money(s.receivables.active.outstanding)}
            </div>
          </div>
          <div data-testid="recon-receivables-suspended">
            <div className="text-zinc-500">Tạm ngừng thu</div>
            <div className="text-zinc-200 font-semibold">
              {s.receivables.suspended.count} khoản · {money(s.receivables.suspended.outstanding)}
            </div>
          </div>
        </div>
        <Rows rows={r.receivables} columns={receivableCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations"
        title="Nghĩa vụ chưa thanh toán"
        hint="Số tiền nền tảng còn phải trả mà chính hợp đồng đó không đủ tiền để chi. Đây không phải nợ của PT."
        count={s.unpaidObligations.open.count}
        tone="watch"
        truncated={r.truncated.unpaidObligations}
        emptyText="Không có nghĩa vụ nào đang mở."
      >
        <p className="text-xs text-zinc-400 mb-2">
          Tổng còn thiếu: <span className="text-zinc-200 font-semibold">{money(s.unpaidObligations.open.unpaid)}</span> · đã xử lý{" "}
          {s.unpaidObligations.resolved.count + s.unpaidObligations.waived.count} khoản
        </p>
        <Rows rows={r.unpaidObligations} columns={obligationCols} rowKey={(x) => x.id} />
      </Block>

      <GroupTitle>Thanh toán chưa hoàn tất</GroupTitle>
      <Block
        testId="recon-paid-not-activated"
        title="Đã thanh toán nhưng chưa kích hoạt"
        hint={`Khách đã trả hơn ${r.params.staleMinutes} phút trước mà hợp đồng/đơn/gói chưa chạy.`}
        count={s.paidNotActivated}
        tone="critical"
        truncated={r.truncated.paidNotActivated}
        emptyText="Không có thanh toán nào bị kẹt."
      >
        <Rows rows={r.paidNotActivated} columns={paidNotActivatedCols} rowKey={(x) => x.transactionId} />
      </Block>
      <Block
        testId="recon-target-unverified"
        title="Chưa xác minh trạng thái"
        hint="Thanh toán gói tập/dịch vụ đã kích hoạt mà tiền vẫn nằm ở trạng thái chờ của đối tác và khách chưa được hoàn. Phần lớn là bình thường (gói/đơn đang chạy). Hệ thống chưa kiểm tra được trạng thái gói/đơn ở dịch vụ sở hữu nên không kết luận là đã hủy."
        count={s.targetUnverified.candidates}
        tone="neutral"
        truncated={r.truncated.targetUnverified}
        emptyText="Không có giao dịch nào cần đối chiếu."
      >
        <Rows rows={r.targetUnverified.candidates} columns={candidateCols} rowKey={(x) => x.transactionId} />
      </Block>
    </>
  );
}

function SessionBlocks({ r }: { r: SessionsReconciliationReport }) {
  return (
    <>
      <GroupTitle>Tất toán hợp đồng và buổi tập</GroupTitle>
      <Block
        testId="recon-needs-attention"
        title="Tất toán cần người xử lý"
        hint="Các bước tiền bị dừng vì lệch số liệu, cần người xem hoặc đã thử lại hết số lần."
        count={r.needsAttention.items.length}
        tone="critical"
        truncated={r.needsAttention.truncated}
        emptyText="Không có tất toán nào đang chờ người xử lý."
      >
        <Rows rows={r.needsAttention.items} columns={attentionCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-endings-unconfirmed"
        title="Kết thúc hợp đồng chưa được xác nhận"
        hint="Đã ghi nhận kết thúc nhưng chưa có xác nhận hoàn tất phần tiền."
        count={r.endingsUnconfirmed.items.length}
        tone="watch"
        truncated={r.endingsUnconfirmed.truncated}
        emptyText="Mọi hợp đồng vừa kết thúc đều đã xác nhận."
      >
        <Rows rows={r.endingsUnconfirmed.items} columns={unconfirmedCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-ended-unsettled"
        title="Hợp đồng đã kết thúc nhưng chưa tất toán"
        hint="Khách đã thanh toán và hợp đồng đã đóng, nhưng chưa có bước tất toán hoàn tất."
        count={r.endedWithoutSettledEnding.items.length}
        tone="critical"
        truncated={r.endedWithoutSettledEnding.truncated}
        emptyText="Mọi hợp đồng đã kết thúc đều đã tất toán."
      >
        <Rows rows={r.endedWithoutSettledEnding.items} columns={endedCols} rowKey={(x) => x.contractId} />
      </Block>
      <Block
        testId="recon-disputes"
        title="Tranh chấp buổi tập đang chờ"
        hint={`Tiền của buổi tranh chấp bị giữ cho tới khi có phán quyết. Hạn: cảnh báo sau ${r.disputes.sla?.warnDays ?? 10} ngày, quá hạn sau ${r.disputes.sla?.breachDays ?? 14} ngày.`}
        count={r.disputes.items.length}
        tone="watch"
        truncated={r.disputes.truncated}
        emptyText="Không có tranh chấp nào đang chờ."
      >
        <Rows rows={r.disputes.items} columns={disputeCols} rowKey={(x) => x.sessionId} />
      </Block>
    </>
  );
}

export function AdminReconciliationBlocks() {
  const payment = useQuery({
    queryKey: ["admin", "finance", "obligations-report"],
    queryFn: async () => normalizeObligationsReport(await adminService.getObligationsReport()),
    refetchInterval: 60_000,
  });
  const sessions = useQuery({
    queryKey: ["admin", "finance", "sessions-reconciliation"],
    queryFn: async () => normalizeSessionsReport(await adminService.getSessionsReconciliation()),
    refetchInterval: 60_000,
  });

  const paymentData = payment.data ?? null;
  const sessionData = sessions.data ?? null;
  const attention = countAttention(paymentData, sessionData);
  const loading = payment.isLoading || sessions.isLoading;
  const refreshing = payment.isFetching || sessions.isFetching;
  const bothLoaded = Boolean(paymentData) && Boolean(sessionData);

  return (
    <div data-testid="admin-recon-blocks" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-zinc-200">Tiền đang kẹt và việc cần theo dõi</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Chỉ để xem. Mọi điều chỉnh đi qua công cụ vận hành có lưu vết và cần chủ sở hữu duyệt.</p>
        </div>
        <button
          onClick={() => {
            payment.refetch();
            sessions.refetch();
          }}
          disabled={refreshing}
          className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          title="Làm mới"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!loading && bothLoaded && (
        <div
          data-testid="recon-attention-summary"
          className={`rounded-xl border p-3 text-xs font-semibold ${
            attention.critical > 0
              ? "bg-red-500/5 border-red-500/20 text-red-400"
              : attention.watch > 0
                ? "bg-amber-500/5 border-amber-500/20 text-amber-400"
                : "bg-green-500/5 border-green-500/20 text-green-400"
          }`}
        >
          {attention.critical > 0
            ? `${attention.critical} mục cần xem ngay, ${attention.watch} mục cần theo dõi`
            : attention.watch > 0
              ? `Không có lỗi sổ cái; ${attention.watch} mục cần theo dõi`
              : "Không có mục nào cần chú ý"}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
        </div>
      )}

      {!payment.isLoading && !paymentData && <LoadError what="dữ liệu sổ cái và nghĩa vụ" onRetry={() => payment.refetch()} />}
      {paymentData && <PaymentBlocks r={paymentData} />}

      {!sessions.isLoading && !sessionData && <LoadError what="dữ liệu tất toán hợp đồng" onRetry={() => sessions.refetch()} />}
      {sessionData && <SessionBlocks r={sessionData} />}

      {paymentData?.generatedAt && (
        <p className="text-[11px] text-zinc-600">Số liệu tại {formatDateTimeVi(paymentData.generatedAt)}</p>
      )}
    </div>
  );
}
