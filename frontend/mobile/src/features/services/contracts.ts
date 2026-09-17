/**
 * The client's side of a PT contract: what each status means, what the client may do about it, and
 * what ending it would cost them.
 *
 * The eight statuses and the seven termination reasons are the backend's, and the mapping from
 * "what the user wants to do" to "which endpoint" is not interchangeable:
 *
 *  - before any money has settled (PENDING_REVIEW, PENDING_SIGNATURE, PENDING_PAYMENT) the client
 *    withdraws with `PATCH /contracts/:id/cancel` — a plain status flip, nothing to refund;
 *  - once ACTIVE, ending it is `POST /contracts/:id/terminate` with a REASON, and the reason
 *    selects the refund formula. A client may only pick two of the seven: they walk away
 *    (CLIENT_CANCELLED, forfeiting a slice of the unused value) or they exercise their right after
 *    repeated confirmed PT no-shows (PT_REPEATED_NO_SHOW, full refund) — and the server re-counts
 *    that second one itself rather than believing the app.
 */

export type ContractRow = {
  id: string;
  ptUserId: string;
  ptName: string;
  status: string;
  packageName: string;
  sessionMode: string | null;
  price: number;
  totalSessions: number;
  usedSessions: number;
  source: string | null;
  gymId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  clientMessage: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  terminationReason: string | null;
  paid: boolean;
};

function ptNameOf(raw: any): string {
  const p = raw?.ptProfile ?? raw?.pt ?? {};
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
  return name || p?.email || "Huấn luyện viên";
}

export function normalizeContract(raw: any): ContractRow {
  return {
    id: String(raw?.id ?? ""),
    ptUserId: String(raw?.ptUserId ?? ""),
    ptName: ptNameOf(raw),
    status: String(raw?.status ?? ""),
    packageName: String(raw?.packageName ?? raw?.packageSourceName ?? "Gói huấn luyện"),
    sessionMode: raw?.sessionMode ?? null,
    // Decimal-as-string again, same as membership plans.
    price: Number(raw?.price) || 0,
    totalSessions: Number(raw?.totalSessions) || 0,
    usedSessions: Number(raw?.usedSessions) || 0,
    source: raw?.source ?? null,
    gymId: raw?.gymId ?? null,
    startDate: raw?.startDate ?? null,
    endDate: raw?.endDate ?? null,
    createdAt: raw?.createdAt ?? null,
    clientMessage: raw?.clientMessage ?? null,
    rejectionReason: raw?.rejectionReason ?? null,
    cancellationReason: raw?.cancellationReason ?? null,
    terminationReason: raw?.terminationReason ?? null,
    paid: Boolean(raw?.paymentTransactionId),
  };
}

export function normalizeContracts(raw: any): ContractRow[] {
  const list = Array.isArray(raw?.contracts) ? raw.contracts : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return list
    .map(normalizeContract)
    .filter((c: ContractRow) => c.id)
    .sort((a: ContractRow, b: ContractRow) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
    );
}

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

export const CONTRACT_STATUS: Record<string, { label: string; tone: StatusTone; note?: string }> = {
  PENDING_REVIEW: { label: "Chờ PT duyệt", tone: "warning", note: "Huấn luyện viên đang xem yêu cầu của bạn." },
  // Reachable only if e-signing is turned back on — it is paused as a settled decision, so this is
  // defensive rather than a screen anyone sees today.
  PENDING_SIGNATURE: { label: "Chờ ký", tone: "warning", note: "Hợp đồng đang chờ hai bên ký điện tử." },
  PENDING_PAYMENT: { label: "Chờ thanh toán", tone: "warning", note: "PT đã đồng ý — còn bước thanh toán." },
  ACTIVE: { label: "Đang hiệu lực", tone: "success" },
  COMPLETED: { label: "Đã hoàn thành", tone: "neutral" },
  EXPIRED: { label: "Đã hết hạn", tone: "neutral" },
  CANCELLED: { label: "Đã chấm dứt", tone: "neutral" },
  REJECTED: { label: "PT đã từ chối", tone: "danger" },
};

export function contractStatus(status: string) {
  return CONTRACT_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone };
}

/** Only these three ever move; everything else is history. */
export const OPEN_STATUSES = ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE"];

export function isOpen(contract: ContractRow): boolean {
  return OPEN_STATUSES.includes(contract.status);
}

export function sessionsLeft(contract: ContractRow): number {
  return Math.max(0, contract.totalSessions - contract.usedSessions);
}

export function sessionProgress(contract: ContractRow): number {
  if (contract.totalSessions <= 0) return 0;
  return Math.min(1, Math.max(0, contract.usedSessions / contract.totalSessions));
}

/** Which of the two endpoints ends this contract — they are not interchangeable. */
export type EndAction = "withdraw" | "terminate" | null;

export function endActionFor(contract: ContractRow): EndAction {
  if (["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT"].includes(contract.status)) {
    return "withdraw";
  }
  if (contract.status === "ACTIVE") return "terminate";
  return null;
}

export type TerminationChoice = {
  reason: "CLIENT_CANCELLED" | "PT_REPEATED_NO_SHOW";
  label: string;
  description: string;
};

/**
 * The only two reasons a client may send. The other five (PT_CANCELLED, PT_BANNED, MUTUAL, EXPIRED,
 * COMPLETED) belong to the trainer or an admin, and the server answers 403 for them — so they are
 * not offered here rather than offered and refused.
 */
export const CLIENT_TERMINATION_CHOICES: TerminationChoice[] = [
  {
    reason: "CLIENT_CANCELLED",
    label: "Tôi muốn dừng hợp đồng",
    description:
      "Bạn được hoàn phần lớn giá trị số buổi chưa dùng, trừ một phần theo quy định khi tự dừng giữa chừng.",
  },
  {
    reason: "PT_REPEATED_NO_SHOW",
    label: "Huấn luyện viên vắng mặt nhiều lần",
    description:
      "Hoàn toàn bộ số buổi chưa dùng. Hệ thống tự kiểm lại số lần vắng mặt đã được xác nhận — chưa đủ thì yêu cầu sẽ bị từ chối kèm lý do.",
  },
];

export type MoneyBreakdown = {
  /** What the client would get back if they ended it right now — the number that matters to them. */
  refundIfCancelledNow: number | null;
  /** Value of one session, and of the sessions not yet used. */
  unit: number | null;
  remaining: number | null;
  /** What the ledger has ACTUALLY moved, as opposed to what the formula says it should have. */
  releasedToPt: number | null;
  releasedToGym: number | null;
  releasedToPlatform: number | null;
  pendingToPt: number | null;
  pendingToGym: number | null;
  pendingToPlatform: number | null;
  paid: boolean;
};

const money = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * `GET /contracts/:id/money-breakdown`. Every figure arrives as a STRING ("8100000.00"), and the
 * response deliberately carries two different truths side by side: `released` (what the formula
 * says) and `actuallyReleased` (what the ledger moved). The screen quotes the second, because that
 * is the one the client can check against their wallet.
 */
export function normalizeMoneyBreakdown(raw: any): MoneyBreakdown | null {
  if (!raw) return null;
  return {
    refundIfCancelledNow: money(raw?.refundIfCancelledNow),
    unit: money(raw?.unit),
    remaining: money(raw?.remaining),
    releasedToPt: money(raw?.actuallyReleased?.pt),
    releasedToGym: money(raw?.actuallyReleased?.gym),
    releasedToPlatform: money(raw?.actuallyReleased?.platform),
    pendingToPt: money(raw?.stillPending?.pt),
    pendingToGym: money(raw?.stillPending?.gym),
    pendingToPlatform: money(raw?.stillPending?.platform),
    paid: Boolean(raw?.paid),
  };
}
