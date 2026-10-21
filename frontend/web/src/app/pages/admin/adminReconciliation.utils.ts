/**
 * Đối soát (FH-4 phần 2, chỉ đọc) — phần thuần: nhãn tiếng Việt, định dạng, chuẩn hoá phản hồi và đếm "cần chú ý".
 * Không gọi mạng, không phụ thuộc React, để kiểm bằng `npx tsx --test` (từ frontend/web).
 *
 * Hai nguồn:
 *   - payment-service  GET /admin/payments/obligations      -> { success, data: ObligationsReport }
 *   - user-service     GET /admin/sessions/reconciliation   -> SessionsReconciliationReport (không bọc)
 */

// ───────────────────────────────────────────────────────────── payment-service ──
export interface NegativeSubledgerRow {
  ownerType: string;
  owner: string;
  transactionId: string;
  transactionShortId: string;
  net: string;
  entries: number;
  firstEntry: string | null;
  lastEntry: string | null;
}
export interface NegativeWalletRow {
  ownerType: string;
  owner: string;
  available: string;
  pending: string;
  locked: string;
}
export interface WalletMismatchRow {
  ownerType: string;
  owner: string;
  bucket: string;
  ledger: string;
  wallet: string;
  difference: string;
  isEscrow: boolean;
}
export interface ReceivableRow {
  id: string;
  partnerType: string;
  partner: string;
  state: "ACTIVE" | "SUSPENDED";
  amount: string;
  recovered: string;
  waived: string;
  outstanding: string;
  reason: string;
  transactionId: string | null;
  contract: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspensionRef: string | null;
}
/** Một dòng lịch sử (chỉ thêm, không sửa) của một nghĩa vụ: ai làm gì, theo phê duyệt nào, bằng chứng nào. */
export interface ObligationEventRow {
  at: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actor: string;
  approvedBy: string | null;
  approvalRef: string;
  note: string;
  /** Bằng chứng khi ghi nhận "đã trả ngoài hệ thống" (null ở các thao tác khác). */
  paidAmount: string | null;
  transferReference: string | null;
  paidOn: string | null;
  unpaidAfter: string | null;
}
export interface UnpaidObligationRow {
  id: string;
  kind: string;
  party: string;
  status: string;
  owed: string;
  paid: string;
  unpaid: string;
  transactionId: string;
  contract: string | null;
  /** The real contract id and the session the step was about (absent on older payment-service builds). */
  contractId?: string | null;
  sessionId?: string | null;
  /** Why the obligation exists, in words (D77 sets it; absent / null on older rows). */
  reason?: string | null;
  /** Tổng đã trả cho khách NGOÀI hệ thống và lịch sử thao tác (absent on older payment-service builds). */
  externallyPaid?: string;
  history?: ObligationEventRow[];
  createdAt: string;
  resolvedAt?: string | null;
}
export interface PaidNotActivatedRow {
  transactionId: string;
  purpose: string;
  activationStatus: string;
  amount: string;
  paidAt: string | null;
  ageMinutes: number;
  retryCount: number;
}
export interface TargetUnverifiedCandidate {
  transactionId: string;
  targetType: string;
  amount: string;
  partnerPendingRemaining: string;
}
/** Gói tập / đơn đã được dịch vụ sở hữu xác nhận là đã hủy (cảnh báo hoặc kết quả hoàn tiền). */
export interface ProductPaymentRow {
  transactionId: string;
  targetType: string;
  targetId: string;
  targetStatus: string;
  outcome: "CANCELLED_PAID" | "REFUND_COMPLETED" | "REFUND_SHORT" | string;
  amount: string;
  partnerPendingRemaining: string;
  refundedToClient: string;
  ownerRefundedAmount: string | null;
  refundShortBy: string;
  openObligationUnpaid: string;
}
export type ProductLookupState = "OK" | "PARTIAL" | "UNAVAILABLE" | "NOT_CHECKED";
export interface ProductPaymentsSummary {
  lookup: ProductLookupState;
  activeValid: number;
  cancelledPaid: number;
  pendingVerification: number;
  refundCompleted: number;
  refundShort: number;
}

export interface ObligationsReport {
  generatedAt: string;
  params: { limit: number; staleMinutes: number };
  summary: {
    negativeWallets: number;
    negativeSubledgers: { count: number; unbackedTotal: string };
    walletMismatches: { count: number; nonEscrowCount: number };
    receivables: { active: { count: number; outstanding: string }; suspended: { count: number; outstanding: string } };
    unpaidObligations: {
      open: { count: number; unpaid: string };
      underReview: { count: number; unpaid: string };
      paidExternally: { count: number; amount: string };
      waived: { count: number; unpaid: string };
      resolved: { count: number };
    };
    paidNotActivated: number;
    /** Neutral group (not a warning, not counted by countAttention). */
    targetUnverified: { status: string; candidates: number };
    productPayments: ProductPaymentsSummary;
  };
  negativeWallets: NegativeWalletRow[];
  negativeSubledgers: NegativeSubledgerRow[];
  walletMismatches: WalletMismatchRow[];
  receivables: ReceivableRow[];
  unpaidObligations: UnpaidObligationRow[];
  /** Đã đóng (trả ngoài hệ thống / không truy đòi / bản ghi cũ), kèm lịch sử. */
  closedObligations: UnpaidObligationRow[];
  paidNotActivated: PaidNotActivatedRow[];
  targetUnverified: { status: string; candidates: TargetUnverifiedCandidate[] };
  cancelledPaid: ProductPaymentRow[];
  refundOutcomes: ProductPaymentRow[];
  truncated: Record<
    | "negativeWallets"
    | "negativeSubledgers"
    | "walletMismatches"
    | "receivables"
    | "unpaidObligations"
    | "closedObligations"
    | "paidNotActivated"
    | "targetUnverified"
    | "cancelledPaid"
    | "refundOutcomes",
    boolean
  >;
}

// ───────────────────────────────────────────────────────────── user-service ──
export interface Group<T> {
  items: T[];
  truncated: boolean;
}
export interface SettlementAttentionItem {
  id: string;
  kind: string;
  status: string;
  reason: string;
  contractId: string;
  sessionId: string | null;
  attempts: number;
  errorCode: string | null;
  amountAtStake: number;
  createdAt: string;
  ageMinutes: number;
}
export interface UnconfirmedEndingItem {
  id: string;
  status: string;
  contractId: string;
  endingReason: string | null;
  attempts: number;
  errorCode: string | null;
  amountAtStake: number | null;
  createdAt: string;
  ageMinutes: number;
}
export interface EndedWithoutSettledEndingItem {
  contractId: string;
  contractStatus: string;
  terminationReason: string | null;
  endedAt: string;
  ageMinutes: number;
  hasIntent: boolean;
  settlementStatus: string | null;
  attempts: number | null;
  errorCode: string | null;
  amountAtStake: number | null;
}
export interface DisputeItem {
  sessionId: string;
  contractId: string;
  disputeType: string | null;
  disputedAt: string | null;
  ageDays: number;
  slaState: "WITHIN_SLA" | "DUE_SOON" | "OVERDUE";
  sessionValue: number | null;
}
export interface SessionsReconciliationReport {
  generatedAt: string;
  needsAttention: Group<SettlementAttentionItem>;
  endingsUnconfirmed: Group<UnconfirmedEndingItem>;
  endedWithoutSettledEnding: Group<EndedWithoutSettledEndingItem>;
  disputes: Group<DisputeItem> & { sla?: { warnDays: number; breachDays: number } };
}

// ───────────────────────────────────────────────────────────── nhãn tiếng Việt ──
const lookup = (map: Record<string, string>, key: string | null | undefined, fallback = "Khác") =>
  (key && map[key]) || fallback;

export const PARTY_LABEL: Record<string, string> = {
  CLIENT: "Khách hàng",
  PT: "Huấn luyện viên",
  GYM: "Phòng gym",
  PLATFORM: "Nền tảng",
};
export const partyLabel = (p: string | null | undefined) => lookup(PARTY_LABEL, p);

export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  NO_SHOW: "PT vắng mặt — chưa đền đủ",
  LATE_ARRIVAL: "PT đến trễ — chưa đền đủ",
  REFUND_SHORT: "Hoàn tiền còn thiếu",
  OVER_RELEASED: "Đã giải ngân vượt mức",
};
export const obligationKindLabel = (k: string | null | undefined) => lookup(OBLIGATION_KIND_LABEL, k, "Nghĩa vụ khác");

export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  OPEN: "Đã ghi nhận, chưa trả",
  UNDER_REVIEW: "Đang xem xét",
  PAID_EXTERNALLY: "Đã trả ngoài hệ thống",
  WAIVED: "Không truy đòi",
  RESOLVED: "Đã xử lý (bản ghi cũ)",
};
export const obligationStatusLabel = (s: string | null | undefined) => lookup(OBLIGATION_STATUS_LABEL, s, "Chưa rõ");

export const OBLIGATION_ACTION_LABEL: Record<string, string> = {
  REVIEW: "Chuyển sang xem xét",
  RELEASE_REVIEW: "Trả về chưa xử lý",
  PAY_EXTERNALLY: "Ghi nhận đã trả ngoài hệ thống",
  WAIVE: "Quyết định không truy đòi",
  RESOLVE: "Đánh dấu đã xử lý (cách cũ)",
};
export const obligationActionLabel = (a: string | null | undefined) => lookup(OBLIGATION_ACTION_LABEL, a, "Thao tác khác");

export const PRODUCT_OUTCOME_LABEL: Record<string, string> = {
  CANCELLED_PAID: "Đã hủy nhưng tiền vẫn bị giữ",
  REFUND_COMPLETED: "Đã hoàn đủ",
  REFUND_SHORT: "Hoàn chưa đủ",
};
export const productOutcomeLabel = (o: string | null | undefined) => lookup(PRODUCT_OUTCOME_LABEL, o, "Chưa rõ");

export const PRODUCT_TARGET_STATUS_LABEL: Record<string, string> = { CANCELLED: "Đã hủy", REFUNDED: "Đã hoàn tiền" };
export const productTargetStatusLabel = (s: string | null | undefined) => lookup(PRODUCT_TARGET_STATUS_LABEL, s, "Chưa rõ");

/** Câu giải thích kết quả kiểm tra trạng thái gói/đơn ở dịch vụ sở hữu (hiện cạnh nhóm "Chưa xác minh"). */
export function productLookupNote(p: ProductPaymentsSummary | null | undefined): string {
  switch (p?.lookup) {
    case "OK":
      return "Đã kiểm tra trạng thái ở dịch vụ sở hữu; không còn giao dịch nào chờ xác minh.";
    case "PARTIAL":
      return "Một số giao dịch chưa kiểm tra được (dịch vụ không phản hồi kịp hoặc chưa hỗ trợ kiểm tra); các giao dịch đó nằm trong danh sách dưới đây.";
    case "UNAVAILABLE":
      return "Chưa kiểm tra được trạng thái ở dịch vụ sở hữu (không phản hồi kịp). Danh sách dưới đây chưa kết luận gì về việc đã hủy.";
    default:
      return "Hệ thống chưa kiểm tra trạng thái gói/đơn ở dịch vụ sở hữu nên không kết luận là đã hủy.";
  }
}

/** Một dòng lịch sử nghĩa vụ -> câu tiếng Việt cho admin ("12/10/2026 · Ghi nhận đã trả ngoài hệ thống · 100.000 đ · mã chuyển khoản ..."). */
export function formatObligationEvent(e: ObligationEventRow, fmtMoney: (v: string | number | null | undefined) => string): string {
  const parts = [formatDateTimeVi(e.at), obligationActionLabel(e.action)];
  if (e.paidAmount !== null && e.paidAmount !== undefined) parts.push(fmtMoney(e.paidAmount));
  if (e.transferReference) parts.push(`mã chuyển khoản ${e.transferReference}`);
  if (e.paidOn) parts.push(`ngày trả ${formatDateTimeVi(e.paidOn).split(" ")[0]}`);
  if (e.unpaidAfter !== null && e.unpaidAfter !== undefined && e.action === "PAY_EXTERNALLY") parts.push(`còn thiếu ${fmtMoney(e.unpaidAfter)}`);
  parts.push(`${e.approvedBy ?? e.actor} · phê duyệt ${e.approvalRef}`);
  return parts.join(" · ");
}

export const PURPOSE_LABEL: Record<string, string> = {
  PT_CONTRACT: "Hợp đồng PT",
  GYM_MEMBERSHIP: "Gói thành viên gym",
  PERSONALIZED_SERVICE_PURCHASE: "Đơn cá nhân hóa",
  TRAINING_PACKAGE_PURCHASE: "Gói tập",
  WALLET_TOPUP: "Nạp ví",
  REFUND: "Hoàn tiền",
};
export const purposeLabel = (p: string | null | undefined) => lookup(PURPOSE_LABEL, p);

export const ACTIVATION_LABEL: Record<string, string> = {
  PENDING: "Chưa kích hoạt",
  ACTIVATION_FAILED: "Kích hoạt lỗi",
};
export const activationLabel = (s: string | null | undefined) => lookup(ACTIVATION_LABEL, s, "Chưa rõ");

export const BUCKET_LABEL: Record<string, string> = { AVAILABLE: "Khả dụng", PENDING: "Đang chờ", LOCKED: "Đang khóa" };
export const bucketLabel = (b: string | null | undefined) => lookup(BUCKET_LABEL, b);

export const SETTLEMENT_KIND_LABEL: Record<string, string> = {
  SESSION_RELEASE: "Giải ngân buổi tập",
  PT_NO_SHOW_COMPENSATION: "Đền buổi PT vắng mặt",
  PT_LATE_ARRIVAL_COMPENSATION: "Đền buổi PT đến trễ",
  CONTRACT_TERMINATION: "Kết thúc hợp đồng",
  UNRESOLVED_SESSION_RESOLUTION: "Xử lý buổi đang treo",
};
export const settlementKindLabel = (k: string | null | undefined) => lookup(SETTLEMENT_KIND_LABEL, k, "Tất toán");

export const ATTENTION_REASON_LABEL: Record<string, string> = {
  CONFLICT: "Hai bên lệch số liệu",
  NEEDS_HUMAN: "Cần người xem xét",
  UNCONFIRMED: "Chưa được xác nhận",
  ATTEMPTS_AT_CAP: "Đã thử lại hết số lần",
  STUCK_PROCESSING: "Kẹt khi đang xử lý",
};
export const attentionReasonLabel = (r: string | null | undefined) => lookup(ATTENTION_REASON_LABEL, r, "Cần xem xét");

export const TERMINATION_REASON_LABEL: Record<string, string> = {
  CLIENT_CANCELLED: "Khách hủy",
  PT_BANNED: "PT bị đình chỉ",
  PT_CANCELLED: "PT rút khỏi hợp đồng",
  MUTUAL: "Hai bên thỏa thuận",
  EXPIRED: "Hết hạn",
  COMPLETED: "Dùng hết số buổi",
  PT_REPEATED_NO_SHOW: "PT vắng nhiều lần",
  CLIENT_EXIT_DUE_TO_PT_RESTRICTION: "Khách rời vì PT bị hạn chế",
};
export const terminationReasonLabel = (r: string | null | undefined) => lookup(TERMINATION_REASON_LABEL, r, "Chưa rõ lý do");

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Đã hoàn thành",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã hủy",
};
export const contractStatusLabel = (s: string | null | undefined) => lookup(CONTRACT_STATUS_LABEL, s, "Đã kết thúc");

export const DISPUTE_TYPE_LABEL: Record<string, string> = {
  DELIVERY_DISPUTE: "Khách phản đối buổi tập",
  PT_NO_SHOW_CLAIM: "PT phản đối báo vắng",
};
export const disputeTypeLabel = (t: string | null | undefined) => lookup(DISPUTE_TYPE_LABEL, t, "Tranh chấp");

export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ",
  PROCESSING: "Đang xử lý",
  FAILED: "Lỗi, sẽ thử lại",
  NEEDS_HUMAN: "Cần người xem xét",
  CONFLICT: "Lệch số liệu",
  SETTLED: "Đã tất toán",
  UNCONFIRMED: "Chưa xác nhận",
};
export const settlementStatusLabel = (s: string | null | undefined) => lookup(SETTLEMENT_STATUS_LABEL, s, "Chưa có");

export const SLA_LABEL: Record<string, string> = { WITHIN_SLA: "Trong hạn", DUE_SOON: "Sắp quá hạn", OVERDUE: "Quá hạn" };
export const slaLabel = (s: string | null | undefined) => lookup(SLA_LABEL, s, "Chưa rõ");

// ───────────────────────────────────────────────────────────── định dạng ──
/** 8 ký tự đầu của một mã — đủ để admin đối chiếu, không bày cả mã dài. */
export function shortId(id: string | null | undefined, n = 8): string {
  return id ? id.slice(0, n) : "—";
}

/** Số phút -> "45 phút" / "3 giờ" / "2 ngày". */
export function formatAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${Math.floor(minutes)} phút`;
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)} giờ`;
  return `${Math.floor(minutes / (60 * 24))} ngày`;
}

/** Chuỗi tiền của payment-service ("70000.00") hoặc số của user-service -> số, null nếu không đọc được. */
export function toAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatDateTimeVi(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

// ───────────────────────────────────────────────────────────── chuẩn hoá ──
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const group = <T>(v: any): Group<T> => ({ items: arr<T>(v?.items), truncated: Boolean(v?.truncated) });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const withHistory = (r: UnpaidObligationRow): UnpaidObligationRow => ({
  ...r,
  externallyPaid: r.externallyPaid ?? "0.00",
  history: arr<ObligationEventRow>(r.history),
});

/** Phản hồi payment-service có bọc `{success, data}`; chấp nhận cả dạng đã bóc. Trả null nếu không dùng được. */
export function normalizeObligationsReport(raw: unknown): ObligationsReport | null {
  const data: any = (raw as any)?.data ?? raw;
  if (!data || typeof data !== "object" || !data.summary) return null;
  const s = data.summary;
  const t = data.truncated ?? {};
  return {
    generatedAt: String(data.generatedAt ?? ""),
    params: { limit: num(data.params?.limit), staleMinutes: num(data.params?.staleMinutes) },
    summary: {
      negativeWallets: num(s.negativeWallets),
      negativeSubledgers: { count: num(s.negativeSubledgers?.count), unbackedTotal: String(s.negativeSubledgers?.unbackedTotal ?? "0") },
      walletMismatches: { count: num(s.walletMismatches?.count), nonEscrowCount: num(s.walletMismatches?.nonEscrowCount) },
      receivables: {
        active: { count: num(s.receivables?.active?.count), outstanding: String(s.receivables?.active?.outstanding ?? "0") },
        suspended: { count: num(s.receivables?.suspended?.count), outstanding: String(s.receivables?.suspended?.outstanding ?? "0") },
      },
      unpaidObligations: {
        open: { count: num(s.unpaidObligations?.open?.count), unpaid: String(s.unpaidObligations?.open?.unpaid ?? "0") },
        underReview: { count: num(s.unpaidObligations?.underReview?.count), unpaid: String(s.unpaidObligations?.underReview?.unpaid ?? "0") },
        paidExternally: { count: num(s.unpaidObligations?.paidExternally?.count), amount: String(s.unpaidObligations?.paidExternally?.amount ?? "0") },
        waived: { count: num(s.unpaidObligations?.waived?.count), unpaid: String(s.unpaidObligations?.waived?.unpaid ?? "0") },
        resolved: { count: num(s.unpaidObligations?.resolved?.count) },
      },
      paidNotActivated: num(s.paidNotActivated),
      targetUnverified: { status: String(s.targetUnverified?.status ?? ""), candidates: num(s.targetUnverified?.candidates) },
      productPayments: {
        lookup: (["OK", "PARTIAL", "UNAVAILABLE"].includes(s.productPayments?.lookup) ? s.productPayments.lookup : "NOT_CHECKED") as ProductLookupState,
        activeValid: num(s.productPayments?.activeValid),
        cancelledPaid: num(s.productPayments?.cancelledPaid),
        pendingVerification: num(s.productPayments?.pendingVerification),
        refundCompleted: num(s.productPayments?.refundCompleted),
        refundShort: num(s.productPayments?.refundShort),
      },
    },
    negativeWallets: arr(data.negativeWallets),
    negativeSubledgers: arr(data.negativeSubledgers),
    walletMismatches: arr(data.walletMismatches),
    receivables: arr(data.receivables),
    unpaidObligations: arr<UnpaidObligationRow>(data.unpaidObligations).map(withHistory),
    closedObligations: arr<UnpaidObligationRow>(data.closedObligations).map(withHistory),
    paidNotActivated: arr(data.paidNotActivated),
    targetUnverified: { status: String(data.targetUnverified?.status ?? ""), candidates: arr(data.targetUnverified?.candidates) },
    cancelledPaid: arr(data.cancelledPaid),
    refundOutcomes: arr(data.refundOutcomes),
    truncated: {
      negativeWallets: Boolean(t.negativeWallets),
      negativeSubledgers: Boolean(t.negativeSubledgers),
      walletMismatches: Boolean(t.walletMismatches),
      receivables: Boolean(t.receivables),
      unpaidObligations: Boolean(t.unpaidObligations),
      closedObligations: Boolean(t.closedObligations),
      paidNotActivated: Boolean(t.paidNotActivated),
      targetUnverified: Boolean(t.targetUnverified),
      cancelledPaid: Boolean(t.cancelledPaid),
      refundOutcomes: Boolean(t.refundOutcomes),
    },
  };
}

export function normalizeSessionsReport(raw: unknown): SessionsReconciliationReport | null {
  const d: any = raw;
  if (!d || typeof d !== "object" || !d.needsAttention) return null;
  return {
    generatedAt: String(d.generatedAt ?? ""),
    needsAttention: group(d.needsAttention),
    endingsUnconfirmed: group(d.endingsUnconfirmed),
    endedWithoutSettledEnding: group(d.endedWithoutSettledEnding),
    disputes: { ...group<DisputeItem>(d.disputes), sla: d.disputes?.sla },
  };
}

// ───────────────────────────────────────────────────────────── đếm "cần chú ý" ──
export interface AttentionCounts {
  /** Mục chắc chắn là lỗi sổ cái / tiền kẹt: cần xem ngay. */
  critical: number;
  /** Mục cần theo dõi hoặc quyết định (nợ phải thu, nghĩa vụ, tranh chấp...). */
  watch: number;
}

/** Tổng hợp để hiện "mọi thứ đều ổn" hay "có N mục cần xem". Bản ghi bị cắt (truncated) vẫn dùng số đếm chính xác của server. */
export function countAttention(payment: ObligationsReport | null, sessions: SessionsReconciliationReport | null): AttentionCounts {
  let critical = 0;
  let watch = 0;
  if (payment) {
    const s = payment.summary;
    // Đã hủy mà khách đã trả và tiền vẫn bị giữ = cảnh báo thật (dịch vụ sở hữu xác nhận). "Chưa xác minh" và "còn hiệu lực" là thông tin, cố ý không đếm.
    critical += s.negativeWallets + s.negativeSubledgers.count + s.walletMismatches.nonEscrowCount + s.paidNotActivated + s.productPayments.cancelledPaid;
    // "Đã trả ngoài hệ thống", "không truy đòi" và bản ghi cũ đã đóng nên không đếm; "đang xem xét" vẫn là việc còn mở. Hoàn chưa đủ cần theo dõi.
    watch += s.receivables.active.count + s.receivables.suspended.count + s.unpaidObligations.open.count + s.unpaidObligations.underReview.count + s.productPayments.refundShort;
  }
  if (sessions) {
    critical += sessions.needsAttention.items.length + sessions.endedWithoutSettledEnding.items.length;
    watch += sessions.endingsUnconfirmed.items.length + sessions.disputes.items.length;
  }
  return { critical, watch };
}

/** Tổng tiền (đồng) của một cột chuỗi tiền, bỏ qua giá trị không đọc được. */
export function sumAmounts(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (toAmount(v) ?? 0), 0);
}
