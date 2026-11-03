import { useState } from "react";
import { formatMoneyString, staleness } from "./adminFinanceOverview.utils";
import {
  TargetUnverifiedCandidate,
  DisputeItem,
  EndedWithoutSettledEndingItem,
  NegativeSubledgerRow,
  NegativeWalletRow,
  ObligationEventRow,
  ObligationsReport,
  PaidNotActivatedRow,
  ProductPaymentRow,
  PtHoldbackRow,
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
  formatObligationEvent,
  formatPendingPayment,
  obligationKindLabel,
  obligationStatusLabel,
  obligationTone,
  partyLabel,
  productLookupNote,
  productOutcomeLabel,
  productTargetStatusLabel,
  purposeLabel,
  rowsWithStatus,
  settlementKindLabel,
  settlementStatusLabel,
  shortId,
  slaLabel,
  terminationReasonLabel,
  toAmount,
} from "./adminReconciliation.utils";
import { Block, ExpandContext, FOCUS, GroupTitle, LoadError, Rows, type Column, type ExpandControl } from "./reconciliation/ExceptionParts";
import { EXCEPTIONS_MAX_AGE_MS, ForbiddenPanel, LevelNote, StaleChip, useNow } from "./reconciliation/ReconStates";
import { errorView, useExceptionReports } from "./reconciliation/useReconciliationData";
import {
  NO_PROCEDURE_TEXT,
  exceptionAttention,
  discrepancyDelta,
  discrepancySourceLabel,
  exceptionGroupStats,
  overviewOfGroups,
  providerLabel,
  type GatewayDiscrepancyReport,
  type GatewayDiscrepancyRow,
  type GroupStat,
  type GroupsOverview,
} from "./reconciliation/reconciliationView";

/**
 * Chip "Ngoại lệ" của Tài chính › Đối soát — các nhóm CHỈ ĐỌC (FH-4, DQ-6): không có nút chuyển tiền, hoàn tiền hay
 * sửa. Mỗi nhóm cho admin thấy "cái gì đang kẹt và kẹt bao lâu"; xử lý đi qua công cụ có kiểm toán phía vận hành.
 * 23 nhóm P13/U2 (L1, `EXCEPTION_GROUPS`: 22 nhóm cũ + «Đã trả vào ví Gymini» thêm ở D1) + 1 nhóm P2 (L2). Nguồn độc lập: nếu một bên lỗi, bên kia vẫn hiện.
 * Số nhóm chỉ ĐẾM, không cộng thành tiền.
 */

const money = (v: unknown) => formatMoneyString(v);

// ───────────────────────────────────────────────────────────── cột từng khối ──
const subledgerCols: Column<NegativeSubledgerRow>[] = [
  { header: "Bên giữ tiền", cell: (r) => `${partyLabel(r.ownerType)} ${shortId(r.owner)}` },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionShortId) },
  { header: "Âm", cell: (r) => <span className="text-st-danger font-semibold">{money(r.net)}</span>, right: true },
  { header: "Số bút toán", cell: (r) => r.entries, right: true },
  { header: "Từ — đến", cell: (r) => `${formatDateTimeVi(r.firstEntry)} — ${formatDateTimeVi(r.lastEntry)}` },
];
const HOLDBACK_STATE_LABEL: Record<string, string> = {
  RUNNING: "Hợp đồng đang chạy (bình thường)",
  WAITING_RECONCILIATION: "Đã kết thúc, chờ xử lý việc của chính hợp đồng",
  STUCK: "Đã kết thúc và đối soát xong nhưng chưa trả",
};
const HOLDBACK_KIND_LABEL: Record<string, string> = {
  OPEN_OBLIGATION: "nghĩa vụ của hợp đồng",
  UNSECURED_DISPUTE: "buổi tranh chấp chưa được đảm bảo",
  UNCOMPUTABLE: "chưa tính được rủi ro",
};
const ptHoldbackCols: Column<PtHoldbackRow>[] = [
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.transactionId) },
  { header: "PT", cell: (r) => shortId(r.pt) },
  { header: "Đang tạm giữ", cell: (r) => money(r.held), right: true },
  { header: "Tình trạng", cell: (r) => <span className={r.state === "STUCK" ? "text-st-danger font-semibold" : r.state === "WAITING_RECONCILIATION" ? "text-st-warning" : "text-adm-text"}>{HOLDBACK_STATE_LABEL[r.state] ?? r.state}</span> },
  { header: "Dự phòng", cell: (r) => (toAmount(r.reserved) > 0 ? `${money(r.reserved)} · ${r.reviewKinds.map((k) => HOLDBACK_KIND_LABEL[k] ?? k).join(", ")}` : "—") },
  {
    header: "Hạn xem xét",
    cell: (r) => (r.reviewBy ? <span className={r.overdue ? "text-st-danger font-semibold" : "text-adm-text"}>{formatDateTimeVi(r.reviewBy)}{r.overdue ? " · QUÁ HẠN" : ""}</span> : "—"),
  },
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
  { header: "Chênh", cell: (r) => <span className={r.isEscrow ? "text-st-warning" : "text-st-danger font-semibold"}>{money(r.difference)}</span>, right: true },
];
const receivableCols: Column<ReceivableRow>[] = [
  { header: "Đối tượng", cell: (r) => `${partyLabel(r.partnerType)} ${shortId(r.partner)}` },
  {
    header: "Trạng thái",
    cell: (r) =>
      r.state === "SUSPENDED" ? (
        <span className="text-st-warning">Đã tạm ngừng (lưu vết){r.suspensionRef ? ` (${r.suspensionRef})` : ""}</span>
      ) : (
        <span className="text-adm-text">Đang mở (lưu vết, không tự thu)</span>
      ),
  },
  { header: "Còn nợ", cell: (r) => <span className="font-semibold">{money(r.outstanding)}</span>, right: true },
  { header: "Đã thu / đã miễn", cell: (r) => `${money(r.recovered)} / ${money(r.waived)}`, right: true },
  { header: "Lý do", cell: (r) => r.reason || "—" },
  { header: "Phát sinh", cell: (r) => formatDateTimeVi(r.createdAt) },
];
/** Lịch sử thao tác của một nghĩa vụ (chỉ đọc, thu gọn sẵn để thẻ ở màn hình hẹp không dài). */
function History({ events }: { events: ObligationEventRow[] | undefined }) {
  if (!events || events.length === 0) return <span className="text-adm-text-2">—</span>;
  return (
    <details data-testid="recon-obligation-history" className="text-left">
      <summary className="cursor-pointer text-adm-text-2">{events.length} lần ghi nhận</summary>
      <ul className="mt-1 space-y-1 text-[11px] text-adm-text-2">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="break-words">
            {formatObligationEvent(e, money)}
            {e.note ? ` — ${e.note}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
const TONE_CLASS: Record<string, string> = {
  verified: "text-st-success",
  ledgerPaid: "text-st-success",
  unverified: "text-st-warning font-semibold",
  pending: "text-st-info",
  open: "text-adm-text",
  closed: "text-adm-text",
};
const StatusText = ({ status }: { status: string }) => <span className={TONE_CLASS[obligationTone(status)]}>{obligationStatusLabel(status)}</span>;

// Còn thiếu / đang mở
const obligationCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Tình trạng", cell: (r) => <StatusText status={r.status} /> },
  { header: "Phải trả cho", cell: (r) => partyLabel(r.party) },
  { header: "Còn thiếu", cell: (r) => <span className="font-semibold">{money(r.unpaid)}</span>, right: true },
  { header: "Đã trả / phải trả", cell: (r) => `${money(r.paid)} / ${money(r.owed)}`, right: true },
  {
    header: "Đã trả và được xác minh",
    cell: (r) => (toAmount(r.verifiedPaid) ? <span className="text-st-success">{money(r.verifiedPaid)}</span> : "—"),
    right: true,
  },
  {
    header: "Ghi nhận cũ, chưa xác minh",
    cell: (r) => (toAmount(r.externallyPaid) ? <span className="text-st-warning">{money(r.externallyPaid)} (chưa xác minh)</span> : "—"),
    right: true,
  },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Buổi", cell: (r) => shortId(r.sessionId) },
  { header: "Lý do", cell: (r) => r.reason || "—" },
  { header: "Phát sinh", cell: (r) => formatDateTimeVi(r.createdAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
// Đã phê duyệt chi / đang chờ chứng từ: vẫn còn thiếu, kèm khoản chi đang chờ
const inFlightCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Tình trạng", cell: (r) => <StatusText status={r.status} /> },
  { header: "Còn thiếu", cell: (r) => <span className="font-semibold">{money(r.unpaid)}</span>, right: true },
  {
    header: "Khoản chi đang chờ",
    cell: (r) => (r.pendingPayment ? <span className="break-words">{formatPendingPayment(r.pendingPayment, money)}</span> : "—"),
  },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Phát sinh", cell: (r) => formatDateTimeVi(r.createdAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
// Đã thanh toán được xác minh
const verifiedCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Kết quả", cell: (r) => <StatusText status={r.status} /> },
  { header: "Đã trả và được xác minh", cell: (r) => <span className="text-st-success font-semibold">{money(r.verifiedPaid)}</span>, right: true },
  { header: "Phải trả", cell: (r) => money(r.owed), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Đóng lúc", cell: (r) => formatDateTimeVi(r.resolvedAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
// Đã trả vào ví Gymini (bút toán sổ cái nội bộ): KHÔNG phải chuyển khoản ngân hàng, KHÔNG gộp với "được xác minh"
const ledgerPaidCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Kết quả", cell: (r) => <StatusText status={r.status} /> },
  { header: "Đã trả vào ví Gymini", cell: (r) => <span className="text-st-success font-semibold">{money(r.paid)}</span>, right: true },
  { header: "Phải trả", cell: (r) => money(r.owed), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Buổi", cell: (r) => shortId(r.sessionId) },
  { header: "Đóng lúc", cell: (r) => formatDateTimeVi(r.resolvedAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
// BẢN GHI CŨ: chứng từ tự nhập, chưa xác minh
const unverifiedCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Kết quả", cell: (r) => <StatusText status={r.status} /> },
  { header: "Ghi nhận đã trả (CHƯA xác minh)", cell: (r) => <span className="text-st-warning">{money(r.externallyPaid)}</span>, right: true },
  { header: "Đã xác minh", cell: (r) => money(r.verifiedPaid), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Ghi nhận lúc", cell: (r) => formatDateTimeVi(r.resolvedAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
// Không truy đòi / giải quyết cách khác / bản ghi cũ: khách KHÔNG được ghi nhận là đã trả
const closedNotPaidCols: Column<UnpaidObligationRow>[] = [
  { header: "Loại", cell: (r) => obligationKindLabel(r.kind) },
  { header: "Kết quả", cell: (r) => <StatusText status={r.status} /> },
  { header: "Số tiền không trả", cell: (r) => money(r.unpaid), right: true },
  { header: "Lý do", cell: (r) => r.history?.length ? (r.history[r.history.length - 1].note || "—") : "—" },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId ?? r.contract) },
  { header: "Đóng lúc", cell: (r) => formatDateTimeVi(r.resolvedAt) },
  { header: "Lịch sử", cell: (r) => <History events={r.history} /> },
];
const productCols: Column<ProductPaymentRow>[] = [
  { header: "Loại giao dịch", cell: (r) => purposeLabel(r.targetType) },
  { header: "Kết quả", cell: (r) => productOutcomeLabel(r.outcome) },
  { header: "Ở dịch vụ sở hữu", cell: (r) => productTargetStatusLabel(r.targetStatus) },
  { header: "Số tiền khách đã trả", cell: (r) => money(r.amount), right: true },
  { header: "Đã hoàn cho khách", cell: (r) => money(r.refundedToClient), right: true },
  { header: "Còn thiếu", cell: (r) => (toAmount(r.refundShortBy) ? <span className="text-st-warning font-semibold">{money(r.refundShortBy)}</span> : "—"), right: true },
  { header: "Tiền còn giữ ở đối tác", cell: (r) => money(r.partnerPendingRemaining), right: true },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionId) },
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
      <span className={r.slaState === "OVERDUE" ? "text-st-danger font-semibold" : r.slaState === "DUE_SOON" ? "text-st-warning" : "text-adm-text"}>
        {slaLabel(r.slaState)} ({r.ageDays} ngày)
      </span>
    ),
  },
  { header: "Giá trị buổi", cell: (r) => money(r.sessionValue), right: true },
  { header: "Hợp đồng", cell: (r) => shortId(r.contractId) },
];

// ───────────────────────────────────────────────────────────── phần hiển thị ──
function PaymentBlocks({ r, stats }: { r: ObligationsReport; stats: Record<string, GroupStat> }) {
  const s = r.summary;
  return (
    <>
      <GroupTitle>Sổ cái tiền</GroupTitle>
      <Block
        testId="recon-negative-subledgers"
        title="Tiền chờ của hợp đồng bị rút quá mức"
        hint="Một hợp đồng đã bị trừ nhiều hơn số tiền đã ghi cho nó (lấy từ tiền chờ của hợp đồng khác)."
        count={stats["negative-subledgers"].count}
        tone="critical"
        truncated={stats["negative-subledgers"].truncated}
        emptyText="Không có hợp đồng nào bị trừ quá số tiền của nó."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Tổng tiền chờ của hợp đồng khác đang bị thiếu: <span className="text-st-danger font-semibold">{money(s.negativeSubledgers.unbackedTotal)}</span>
        </p>
        <Rows rows={r.negativeSubledgers} columns={subledgerCols} rowKey={(x) => `${x.ownerType}-${x.owner}-${x.transactionId}`} />
      </Block>
      <Block
        testId="recon-negative-wallets"
        title="Ví có số dư âm"
        hint="Luôn là lỗi, không bao giờ được xảy ra."
        count={stats["negative-wallets"].count}
        tone="critical"
        truncated={stats["negative-wallets"].truncated}
        emptyText="Không có ví nào âm."
      >
        <Rows rows={r.negativeWallets} columns={negativeWalletCols} rowKey={(x) => `${x.ownerType}-${x.owner}`} />
      </Block>
      <Block
        testId="recon-wallet-mismatch"
        title="Ví lệch so với sổ cái"
        hint="Số dư trên ví khác tổng các bút toán của chính ví đó. Dòng “tiền giữ hộ” chỉ là thông tin (dữ liệu mẫu có thể không ghi đủ)."
        count={stats["wallet-mismatch"].count}
        tone="critical"
        truncated={stats["wallet-mismatch"].truncated}
        emptyText="Mọi ví khớp với sổ cái."
      >
        <Rows rows={r.walletMismatches} columns={mismatchCols} rowKey={(x) => `${x.ownerType}-${x.owner}-${x.bucket}`} />
      </Block>

      <Block
        testId="recon-pt-holdback"
        title="Tiền tạm giữ của PT theo hợp đồng"
        hint="Tiền PT đã kiếm nhưng chưa rút được; chỉ trả khi hợp đồng kết thúc và đối soát xong. Đây không phải doanh thu của nền tảng. “Đã xong mà chưa trả” phải bằng 0."
        count={stats["pt-holdback"].count}
        tone="neutral"
        truncated={stats["pt-holdback"].truncated}
        emptyText="Không có hợp đồng nào đang tạm giữ tiền của PT."
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
          <div data-testid="recon-pt-holdback-overdue">
            <div className="text-adm-text-2">Quá hạn xem xét</div>
            <div className={s.ptHoldback.overdue.count > 0 ? "text-st-danger font-semibold" : "text-adm-text font-semibold"}>{s.ptHoldback.overdue.count} · {money(s.ptHoldback.overdue.reserved)}</div>
          </div>
          <div data-testid="recon-pt-holdback-total">
            <div className="text-adm-text-2">Đang tạm giữ</div>
            <div className="text-adm-text font-semibold">{money(s.ptHoldback.totalHeld)} · {s.ptHoldback.contractsHolding} hợp đồng</div>
          </div>
          <div data-testid="recon-pt-holdback-waiting">
            <div className="text-adm-text-2">Chờ xử lý việc của hợp đồng</div>
            <div className="text-st-warning font-semibold">{s.ptHoldback.waitingReconciliation.count} · {money(s.ptHoldback.waitingReconciliation.held)}</div>
          </div>
          <div data-testid="recon-pt-holdback-stuck">
            <div className="text-adm-text-2">Xong mà chưa trả</div>
            <div className={s.ptHoldback.stuck.count > 0 ? "text-st-danger font-semibold" : "text-adm-text font-semibold"}>{s.ptHoldback.stuck.count} · {money(s.ptHoldback.stuck.held)}</div>
          </div>
        </div>
        <Rows rows={r.ptHoldbacks} columns={ptHoldbackCols} rowKey={(x) => x.transactionId} />
      </Block>

      <GroupTitle>Khoản đối tác còn nợ và nghĩa vụ chưa trả</GroupTitle>
      <Block
        testId="recon-receivables"
        title="Khoản phải thu từ đối tác"
        hint="Khoản cũ nền tảng từng ứng trước. Chỉ để lưu vết và ra quyết định: hệ thống KHÔNG tự trừ vào thu nhập của đối tác (cả khoản đang thu lẫn tạm ngừng)."
        count={stats["receivables"].count}
        tone="watch"
        truncated={stats["receivables"].truncated}
        emptyText="Không có khoản phải thu nào còn mở."
      >
        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
          <div data-testid="recon-receivables-active">
            <div className="text-adm-text-2">Đang mở (lưu vết)</div>
            <div className="text-adm-text font-semibold">
              {s.receivables.active.count} khoản · {money(s.receivables.active.outstanding)}
            </div>
          </div>
          <div data-testid="recon-receivables-suspended">
            <div className="text-adm-text-2">Đã tạm ngừng</div>
            <div className="text-adm-text font-semibold">
              {s.receivables.suspended.count} khoản · {money(s.receivables.suspended.outstanding)}
            </div>
          </div>
        </div>
        <Rows rows={r.receivables} columns={receivableCols} rowKey={(x) => x.id} />
      </Block>
      <GroupTitle>Nghĩa vụ chưa thanh toán — mỗi trạng thái một nhóm</GroupTitle>
      <p data-testid="recon-obligations-note" className="text-[11px] text-adm-text-2">
        Số tiền nền tảng còn phải trả cho khách mà chính hợp đồng đó không đủ tiền để chi (không phải nợ của PT). Hệ thống không tự chi. Việc trả được làm
        ngoài hệ thống và chỉ được tính là ĐÃ THANH TOÁN khi chứng từ được một người khác xác minh; mã chuyển khoản tự nhập chưa phải bằng chứng.
      </p>
      <Block
        testId="recon-obligations-open"
        title="Đang mở"
        hint="Đã ghi nhận, chưa ai phê duyệt chi."
        count={stats["obligations-open"].count}
        tone="watch"
        truncated={stats["obligations-open"].truncated}
        emptyText="Không có nghĩa vụ nào đang mở."
      >
        <p data-testid="recon-obligations-summary" className="text-xs text-adm-text-2 mb-2">
          Còn thiếu: <span className="text-adm-text font-semibold">{money(s.unpaidObligations.open.unpaid)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.unpaidObligations, "OPEN")} columns={obligationCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-under-review"
        title="Đang xem xét"
        hint="Có người đang xem xét; chưa phê duyệt chi."
        count={stats["obligations-under-review"].count}
        tone="watch"
        truncated={stats["obligations-under-review"].truncated}
        emptyText="Không có nghĩa vụ nào đang xem xét."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Còn thiếu: <span className="text-adm-text font-semibold">{money(s.unpaidObligations.underReview.unpaid)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.unpaidObligations, "UNDER_REVIEW")} columns={obligationCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-approved"
        title="Đã phê duyệt chi"
        hint="Người có thẩm quyền đã duyệt số tiền và nguồn chi; chưa có chứng từ. Vẫn CHƯA trả."
        count={stats["obligations-approved"].count}
        tone="watch"
        truncated={stats["obligations-approved"].truncated}
        emptyText="Không có khoản nào đang chờ chi."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Còn thiếu: <span className="text-adm-text font-semibold">{money(s.unpaidObligations.approvedForPayment.unpaid)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.inFlightObligations, "APPROVED_FOR_PAYMENT")} columns={inFlightCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-awaiting"
        title="Đang chờ chứng từ"
        hint="Đã trả ngoài hệ thống và đã nộp chứng từ, đang chờ MỘT NGƯỜI KHÁC xác minh. Chưa xác minh thì chưa tính là đã trả."
        count={stats["obligations-awaiting"].count}
        tone="watch"
        truncated={stats["obligations-awaiting"].truncated}
        emptyText="Không có khoản nào đang chờ xác minh chứng từ."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Vẫn còn thiếu: <span className="text-adm-text font-semibold">{money(s.unpaidObligations.awaitingEvidence.unpaid)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.inFlightObligations, "AWAITING_EVIDENCE")} columns={inFlightCols} rowKey={(x) => x.id} />
      </Block>

      <GroupTitle>Nghĩa vụ đã đóng — mỗi kết quả một nhóm</GroupTitle>
      <Block
        testId="recon-obligations-paid-verified"
        title="Đã thanh toán được xác minh"
        hint="Đã phê duyệt, đã trả ngoài hệ thống và chứng từ đã được một người khác xác minh. Đây là nhóm DUY NHẤT được tính là đã trả."
        count={stats["obligations-paid-verified"].count}
        tone="neutral"
        truncated={stats["obligations-paid-verified"].truncated}
        emptyText="Chưa có khoản nào được thanh toán và xác minh."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Tổng đã trả và được xác minh (gồm các lần trả một phần): <span className="text-st-success font-semibold">{money(s.unpaidObligations.paidVerified.amount)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.closedObligations, "PAID_VERIFIED")} columns={verifiedCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-paid-via-ledger"
        title="Đã trả vào ví Gymini"
        hint="Khoản được trả bằng bút toán trong sổ cái nội bộ của Gymini (vào ví của khách), không phải chuyển khoản ngân hàng và không qua bước xác minh chứng từ. Tách riêng khỏi nhóm «Đã thanh toán được xác minh»."
        count={stats["obligations-paid-via-ledger"].count}
        tone="neutral"
        truncated={stats["obligations-paid-via-ledger"].truncated}
        emptyText="Chưa có khoản nào được trả vào ví Gymini."
      >
        <Rows rows={rowsWithStatus(r.closedObligations, "PAID_VIA_LEDGER")} columns={ledgerPaidCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-unverified"
        title="Đã ghi nhận chứng từ — CHƯA xác minh (bản ghi cũ)"
        hint="Ghi nhận theo cách cũ: chỉ có mã chuyển khoản tự nhập, chưa ai kiểm tra. KHÔNG phải bằng chứng đã trả và không được tự nâng thành đã xác minh."
        count={stats["obligations-unverified"].count}
        tone="watch"
        truncated={stats["obligations-unverified"].truncated}
        emptyText="Không có bản ghi cũ nào chưa xác minh."
      >
        <p className="text-xs text-st-warning mb-2">
          Tổng đã ghi nhận nhưng CHƯA xác minh: <span className="font-semibold">{money(s.unpaidObligations.paidExternally.amount)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.closedObligations, "PAID_EXTERNALLY")} columns={unverifiedCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-waived"
        title="Không truy đòi"
        hint="Chủ sở hữu quyết định không truy đòi; khách KHÔNG được trả."
        count={stats["obligations-waived"].count}
        tone="neutral"
        truncated={stats["obligations-waived"].truncated}
        emptyText="Chưa có khoản nào bị bỏ qua."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Tổng bỏ qua: <span className="text-adm-text font-semibold">{money(s.unpaidObligations.waived.unpaid)}</span>
        </p>
        <Rows rows={rowsWithStatus(r.closedObligations, "WAIVED")} columns={closedNotPaidCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-resolved-other"
        title="Đã giải quyết bằng phương thức khác"
        hint="Được giải quyết không qua chi trả có xác minh (lý do ghi ở lịch sử). Không tính là đã trả."
        count={stats["obligations-resolved-other"].count}
        tone="neutral"
        truncated={stats["obligations-resolved-other"].truncated}
        emptyText="Chưa có khoản nào được giải quyết bằng phương thức khác."
      >
        <Rows rows={rowsWithStatus(r.closedObligations, "RESOLVED_OTHER")} columns={closedNotPaidCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-obligations-legacy"
        title="Bản ghi cũ (đã xử lý)"
        hint="Đánh dấu 'đã xử lý' theo cách cũ, không có bằng chứng."
        count={stats["obligations-legacy"].count}
        tone="neutral"
        truncated={stats["obligations-legacy"].truncated}
        emptyText="Không có bản ghi cũ."
      >
        <Rows rows={rowsWithStatus(r.closedObligations, "RESOLVED")} columns={closedNotPaidCols} rowKey={(x) => x.id} />
      </Block>

      <GroupTitle>Thanh toán chưa hoàn tất</GroupTitle>
      <Block
        testId="recon-paid-not-activated"
        title="Đã thanh toán nhưng chưa kích hoạt"
        hint={`Khách đã trả hơn ${r.params.staleMinutes} phút trước mà hợp đồng/đơn/gói chưa chạy.`}
        count={stats["paid-not-activated"].count}
        tone="critical"
        truncated={stats["paid-not-activated"].truncated}
        emptyText="Không có thanh toán nào bị kẹt."
      >
        <Rows rows={r.paidNotActivated} columns={paidNotActivatedCols} rowKey={(x) => x.transactionId} />
      </Block>
      <p data-testid="recon-product-active-valid" className="text-[11px] text-adm-text-2">
        Đã kiểm tra với dịch vụ sở hữu: {s.productPayments.activeValid} gói/đơn còn hiệu lực (bình thường, không phải vấn đề).
      </p>
      <Block
        testId="recon-cancelled-paid"
        title="Gói/đơn đã hủy nhưng khách đã trả"
        hint="Dịch vụ sở hữu xác nhận gói/đơn đã hủy, nhưng tiền khách trả vẫn nằm ở trạng thái chờ của đối tác và khách chưa được hoàn."
        count={stats["cancelled-paid"].count}
        tone="critical"
        truncated={stats["cancelled-paid"].truncated}
        emptyText="Không có gói/đơn nào đã hủy mà tiền vẫn bị giữ."
      >
        <Rows rows={r.cancelledPaid} columns={productCols} rowKey={(x) => x.transactionId} />
      </Block>
      <Block
        testId="recon-refund-outcomes"
        title="Hoàn tiền của gói/đơn đã hủy"
        hint="Gói/đơn đã hủy và khách đã được hoàn một phần hoặc toàn bộ. 'Hoàn chưa đủ' là số khách nhận ít hơn số đáng được hoàn."
        count={stats["refund-outcomes"].count}
        tone={s.productPayments.refundShort > 0 ? "watch" : "neutral"}
        truncated={stats["refund-outcomes"].truncated}
        emptyText="Chưa có gói/đơn đã hủy nào có hoàn tiền."
      >
        <p className="text-xs text-adm-text-2 mb-2">
          Đã hoàn đủ {s.productPayments.refundCompleted} · hoàn chưa đủ {s.productPayments.refundShort}
        </p>
        <Rows rows={r.refundOutcomes} columns={productCols} rowKey={(x) => x.transactionId} />
      </Block>
      <Block
        testId="recon-target-unverified"
        title="Chưa xác minh trạng thái"
        hint={`Thanh toán gói tập/dịch vụ đã kích hoạt mà tiền vẫn nằm ở trạng thái chờ của đối tác và khách chưa được hoàn. Phần lớn là bình thường (gói/đơn đang chạy). ${productLookupNote(s.productPayments)}`}
        count={stats["target-unverified"].count}
        tone="neutral"
        truncated={stats["target-unverified"].truncated}
        emptyText="Không có giao dịch nào cần đối chiếu."
      >
        <Rows rows={r.targetUnverified.candidates} columns={candidateCols} rowKey={(x) => x.transactionId} />
      </Block>
    </>
  );
}

function SessionBlocks({ r, stats }: { r: SessionsReconciliationReport; stats: Record<string, GroupStat> }) {
  return (
    <>
      <GroupTitle>Tất toán hợp đồng và buổi tập</GroupTitle>
      <Block
        testId="recon-needs-attention"
        title="Tất toán cần người xử lý"
        hint="Các bước tiền bị dừng vì lệch số liệu, cần người xem hoặc đã thử lại hết số lần."
        count={stats["needs-attention"].count}
        tone="critical"
        truncated={stats["needs-attention"].truncated}
        emptyText="Không có tất toán nào đang chờ người xử lý."
      >
        <Rows rows={r.needsAttention.items} columns={attentionCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-endings-unconfirmed"
        title="Kết thúc hợp đồng chưa được xác nhận"
        hint="Đã ghi nhận kết thúc nhưng chưa có xác nhận hoàn tất phần tiền."
        count={stats["endings-unconfirmed"].count}
        tone="watch"
        truncated={stats["endings-unconfirmed"].truncated}
        emptyText="Mọi hợp đồng vừa kết thúc đều đã xác nhận."
      >
        <Rows rows={r.endingsUnconfirmed.items} columns={unconfirmedCols} rowKey={(x) => x.id} />
      </Block>
      <Block
        testId="recon-ended-unsettled"
        title="Hợp đồng đã kết thúc nhưng chưa tất toán"
        hint="Khách đã thanh toán và hợp đồng đã đóng, nhưng chưa có bước tất toán hoàn tất."
        count={stats["ended-unsettled"].count}
        tone="critical"
        truncated={stats["ended-unsettled"].truncated}
        emptyText="Mọi hợp đồng đã kết thúc đều đã tất toán."
      >
        <Rows rows={r.endedWithoutSettledEnding.items} columns={endedCols} rowKey={(x) => x.contractId} />
      </Block>
      <Block
        testId="recon-disputes"
        title="Tranh chấp buổi tập đang chờ"
        hint={`Tiền của buổi tranh chấp bị giữ cho tới khi có phán quyết. Hạn: cảnh báo sau ${r.disputes.sla?.warnDays ?? 10} ngày, quá hạn sau ${r.disputes.sla?.breachDays ?? 14} ngày.`}
        count={stats["disputes"].count}
        tone="watch"
        truncated={stats["disputes"].truncated}
        emptyText="Không có tranh chấp nào đang chờ."
      >
        <Rows rows={r.disputes.items} columns={disputeCols} rowKey={(x) => x.sessionId} />
      </Block>
    </>
  );
}

const gatewayCols: Column<GatewayDiscrepancyRow>[] = [
  { header: "Cổng", cell: (r) => providerLabel(r.provider) },
  { header: "Mã giao dịch của cổng", cell: (r) => <span className="break-all font-mono">{r.gatewayTransactionNo ?? "—"}</span> },
  { header: "Gymini kỳ vọng", cell: (r) => money(r.expectedAmount), right: true },
  { header: "Cổng báo", cell: (r) => <span className="font-semibold text-st-danger">{money(r.reportedAmount)}</span>, right: true },
  { header: "Chênh", cell: (r) => discrepancyDelta(r.expectedAmount, r.reportedAmount), right: true },
  { header: "Số lần cổng gửi", cell: (r) => r.occurrences, right: true },
  { header: "Phát hiện lần đầu", cell: (r) => formatDateTimeVi(r.firstDetectedAt) },
  { header: "Nguồn báo", cell: (r) => discrepancySourceLabel(r.source) },
  { header: "Giao dịch", cell: (r) => shortId(r.transactionId) },
  { header: "Xử lý", cell: () => <span className="text-adm-text-2">{NO_PROCEDURE_TEXT}</span> },
];

function GatewayBlock({ report }: { report: GatewayDiscrepancyReport }) {
  return (
    <Block
      testId="recon-gateway-discrepancies"
      title="Cổng báo số tiền khác số Gymini"
      hint="Cổng gọi về với số tiền khác giá của giao dịch: giao dịch KHÔNG được ghi sổ (không cộng tiền giữ hộ, không kích hoạt). Đây là dữ liệu L2 — callback cổng do hệ thống tự lưu, chưa phải xác minh độc lập từ cổng/ngân hàng (L3 — BLOCKED). Hệ thống chưa có bước ghi nhận xử lý: chưa có quy trình (G-15)."
      count={report.rows.length}
      tone="critical"
      truncated={report.truncated}
      emptyText="Chưa có callback nào của cổng báo số tiền khác số Gymini."
    >
      <Rows rows={report.rows} columns={gatewayCols} rowKey={(x) => x.transactionId} />
    </Block>
  );
}

function ExpandBar({ overview, onAll, onNone }: { overview: GroupsOverview; onAll: () => void; onNone: () => void }) {
  const btn = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 disabled:opacity-60 motion-reduce:transition-none lg:min-h-9 ${FOCUS}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p data-testid="recon-groups-overview" className="text-xs text-adm-text-2">
        {overview.known === overview.total
          ? `${overview.withItems} trong ${overview.total} nhóm có mục${overview.truncated ? ` · ${overview.truncated} nhóm chưa hiện hết` : ""}`
          : `Mới đọc được ${overview.known} trong ${overview.total} nhóm`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAll} data-testid="recon-expand-all" className={btn}>
          Mở hết
        </button>
        <button type="button" onClick={onNone} data-testid="recon-collapse-all" className={btn}>
          Thu gọn hết
        </button>
      </div>
    </div>
  );
}

export function AdminReconciliationBlocks() {
  const { payment, sessions, gateway } = useExceptionReports({ gateway: true });
  const nowMs = useNow(30_000);
  const [ctrl, setCtrl] = useState<ExpandControl>({ epoch: 0, mode: "default" });

  const paymentData = payment.data ?? null;
  const sessionData = sessions.data ?? null;
  const gatewayData = gateway.data ?? null;
  const stats = exceptionGroupStats(paymentData, sessionData);
  const overview = overviewOfGroups(stats);
  // Gồm cả nhóm P2 khi đã tải (khớp huy hiệu thanh bên); P2 lỗi thì nhóm đó tự báo lỗi bên dưới.
  const attention = exceptionAttention(paymentData, sessionData, gatewayData) ?? countAttention(paymentData, sessionData);
  const loading = payment.isLoading || sessions.isLoading;
  const refreshing = payment.isFetching || sessions.isFetching || gateway.isFetching;
  const bothLoaded = Boolean(paymentData) && Boolean(sessionData);

  const paymentErr = payment.isError ? errorView(payment.error, "dữ liệu sổ cái và nghĩa vụ") : null;
  const sessionsErr = sessions.isError ? errorView(sessions.error, "dữ liệu tất toán hợp đồng") : null;
  const gatewayErr = gateway.isError ? errorView(gateway.error, "báo cáo sai lệch số tiền cổng") : null;

  const refetchAll = () => {
    void payment.refetch();
    void sessions.refetch();
    void gateway.refetch();
  };

  if (paymentErr?.forbidden || sessionsErr?.forbidden || gatewayErr?.forbidden) return <ForbiddenPanel />;

  // E-08: some data on screen but it is old or the last refresh failed → say so, with the time.
  const loadedAt = [paymentData && payment.dataUpdatedAt, sessionData && sessions.dataUpdatedAt].filter((x): x is number => typeof x === "number" && x > 0);
  const oldest = loadedAt.length ? Math.min(...loadedAt) : 0;
  const stale = staleness({
    hasData: loadedAt.length > 0,
    updatedAt: oldest,
    refetchFailed: (payment.isError && !!paymentData) || (sessions.isError && !!sessionData),
    nowMs,
    maxAgeMs: EXCEPTIONS_MAX_AGE_MS,
  });

  // A "successful" read whose body could not be understood is a failure, not an empty list.
  const paymentBad = !payment.isLoading && !paymentData;
  const sessionsBad = !sessions.isLoading && !sessionData;

  return (
    <div data-testid="admin-recon-blocks" className="space-y-3">
      <h2 className="text-base font-bold text-adm-text">Ngoại lệ đối soát</h2>

      <LevelNote
        level="L1"
        testId="recon-exceptions-level"
        text="Các nhóm dưới đây đọc từ sổ cái và hợp đồng của Gymini (P13 nghĩa vụ và tiền giữ lại, U2 tất toán và tranh chấp buổi tập) — không đối chiếu với bên ngoài. Riêng “Cổng báo số tiền khác số Gymini” là L2 (callback cổng do hệ thống tự lưu, P2). Báo cáo độc lập của cổng/ngân hàng (L3) chưa có nguồn nên chưa làm được."
      />

      <p className="text-[11px] text-adm-text-2">Chỉ để xem, không có thao tác tiền ở đây. Số mục được đếm, không cộng thành tiền. Hệ thống chưa có quy trình ghi nhận xử lý ngoại lệ — {NO_PROCEDURE_TEXT}.</p>

      {stale.stale && (
        <StaleChip info={stale} nowMs={nowMs} busy={refreshing} onRefresh={refetchAll} testId="recon-exceptions-stale" />
      )}

      {!loading && bothLoaded && (
        <div
          data-testid="recon-attention-summary"
          role="status"
          className={`rounded-xl border p-3 text-xs font-semibold ${
            attention.critical > 0
              ? "border-st-danger-border bg-st-danger-bg text-st-danger"
              : attention.watch > 0
                ? "border-st-warning-border bg-st-warning-bg text-st-warning"
                : "border-st-success-border bg-st-success-bg text-st-success"
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
        <div role="status" aria-busy="true" data-testid="recon-exceptions-loading" className="space-y-2">
          <span className="sr-only">Đang tải các nhóm ngoại lệ</span>
          <div aria-hidden className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-adm-pill motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      )}

      <ExpandBar
        overview={overview}
        onAll={() => setCtrl((c) => ({ epoch: c.epoch + 1, mode: "all" }))}
        onNone={() => setCtrl((c) => ({ epoch: c.epoch + 1, mode: "none" }))}
      />

      <ExpandContext.Provider value={ctrl}>
        <GroupTitle>Callback cổng đã lưu — L2</GroupTitle>
        {gateway.isLoading && <p className="text-xs text-adm-text-2">Đang tải sai lệch số tiền cổng…</p>}
        {gatewayErr && <LoadError testId="recon-gateway-error" what="báo cáo sai lệch số tiền cổng" onRetry={() => void gateway.refetch()} />}
        {gatewayData && <GatewayBlock report={gatewayData} />}

        {(paymentErr || paymentBad) && !payment.isLoading && (
          <LoadError testId="recon-payment-error" what="dữ liệu sổ cái và nghĩa vụ" onRetry={() => void payment.refetch()} />
        )}
        {paymentData && <PaymentBlocks r={paymentData} stats={stats} />}

        {(sessionsErr || sessionsBad) && !sessions.isLoading && (
          <LoadError testId="recon-sessions-error" what="dữ liệu tất toán hợp đồng" onRetry={() => void sessions.refetch()} />
        )}
        {sessionData && <SessionBlocks r={sessionData} stats={stats} />}
      </ExpandContext.Provider>

      {paymentData?.generatedAt && <p className="text-[11px] text-adm-text-2">Số liệu tại {formatDateTimeVi(paymentData.generatedAt)}</p>}
    </div>
  );
}
