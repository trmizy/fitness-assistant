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
  /** `"PAUSED_BY_ADMIN"` while the trainer is restricted; otherwise null (or the plain status). */
  effectiveStatus: string | null;
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
    effectiveStatus: typeof raw?.effectiveStatus === "string" ? raw.effectiveStatus : null,
  };
}

/** The trainer is temporarily restricted; the contract itself is untouched. */
export function isPausedByAdmin(contract: Pick<ContractRow, "effectiveStatus">): boolean {
  return contract.effectiveStatus === "PAUSED_BY_ADMIN";
}

export const PAUSED_BY_ADMIN_NOTICE =
  "Hợp đồng đang tạm dừng trong lúc huấn luyện viên tạm ngưng hoạt động. Buổi tập và thời hạn của bạn được giữ nguyên.";

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
  /** True only while the server says the client may end the contract with no fee (trainer restricted). */
  canExitWithoutPenalty: boolean;
  /** Sessions the trainer reported as done that still await the client's confirmation or a review. */
  unresolvedSessions: number;
  /** Value held for those sessions; null when the server did not say. */
  unresolvedAmountHeld: number | null;
  /** Server's label for the exit it would apply right now (informational; the screen never branches on it). */
  exitReasonIfCancelledNow: string | null;
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
    // Strict `=== true`: a missing or malformed flag must never open the no-fee path.
    canExitWithoutPenalty: raw?.canExitWithoutPenalty === true,
    unresolvedSessions: wholeCount(raw?.unresolvedSessions),
    unresolvedAmountHeld: money(raw?.unresolvedAmountHeld),
    exitReasonIfCancelledNow:
      typeof raw?.exitReasonIfCancelledNow === "string" ? raw.exitReasonIfCancelledNow : null,
  };
}

function wholeCount(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Text the end-contract sheet shows. Wording mirrors web's ContractPage cancel dialog. */
export const END_TERMS_TEXT = {
  loadFailed: "Không tải được số tiền hoàn. Vui lòng đóng cửa sổ này và thử lại.",
  noFeeIntro:
    "Huấn luyện viên của bạn đang tạm ngưng hoạt động. Nếu kết thúc hợp đồng bây giờ, bạn được hoàn toàn bộ giá trị các buổi chưa tập vào ví và không mất phí.",
  termsChanged:
    "Huấn luyện viên đã hoạt động trở lại nên điều kiện kết thúc không mất phí trước đó không còn áp dụng. Vui lòng xác nhận lại nếu bạn vẫn muốn hủy.",
  refundLabelNoFee: "Hoàn về ví (không mất phí)",
  refundLabelOrdinary: "Hoàn về ví nếu dừng bây giờ",
  unresolvedAmountLabel: "Đang chờ xác nhận hoặc xem xét",
  confirmNoFee: "Xác nhận kết thúc",
  confirmAfterChange: "Vẫn hủy hợp đồng",
  confirmDefault: "Xác nhận",
} as const;

export function unresolvedSessionsNote(count: number): string {
  return `Có ${count} buổi huấn luyện viên đã báo là đã dạy nhưng đang chờ bạn xác nhận hoặc chờ xem xét. Giá trị các buổi này chưa nằm trong số tiền hoàn ở trên; chúng sẽ được xử lý sau khi bạn xác nhận hoặc buổi đó được xem xét xong.`;
}

/** Terminate answers 409 PT_RESTRICTION_LIFTED when the no-fee terms the client saw no longer apply. */
export function isPtRestrictionLifted(error: any): boolean {
  if (error?.response?.status !== 409) return false;
  const d = error?.response?.data;
  return [d?.code, d?.errorCode, d?.error, d?.error?.code].includes("PT_RESTRICTION_LIFTED");
}

/**
 * The fresh preview a 409 carries, read defensively (`data.preview`, `preview`, or `data` itself).
 * Returns null when the payload has none, so the caller re-fetches the breakdown instead.
 */
export function previewFromRestrictionLifted(error: any): Record<string, any> | null {
  const body = error?.response?.data;
  const candidate = body?.data?.preview ?? body?.preview ?? body?.data ?? null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  return money(candidate.refundIfCancelledNow) == null ? null : candidate;
}

/**
 * Cached raw breakdown after a 409: the previous figures overlaid with the server's fresh preview,
 * forced to the ordinary terms. Null when the 409 had no usable preview (re-fetch instead).
 */
export function applyLiftedPreview(old: any, error: any): Record<string, any> | null {
  const preview = previewFromRestrictionLifted(error);
  if (!preview) return null;
  return { ...(old && typeof old === "object" ? old : {}), ...preview, canExitWithoutPenalty: false };
}

export type EndSheetView = {
  /** loading: figures not yet fresh; error: no usable server figure; ready: show the terms. */
  phase: "loading" | "error" | "ready";
  /** Show the no-fee wording and send `expectNoPenalty: true`. */
  noFee: boolean;
  expectNoPenalty: boolean;
  /** The server's refund figure, shown only when it applies to the reason chosen. */
  refund: number | null;
  refundLabel: string;
  intro: string | null;
  unresolvedNote: string | null;
  /** Value held for those sessions, only when there are some and the server said how much. */
  unresolvedAmount: number | null;
  changedNote: string | null;
  /** The reason picker is offered only on the ordinary terms. */
  showReasons: boolean;
  confirmLabel: string;
  canConfirm: boolean;
};

/**
 * Which terms the client is looking at, what to say, and what to send. The refund is always the
 * server's `refundIfCancelledNow` — nothing here computes money.
 *
 * `termsChanged` is set after a 409. From then on the no-fee terms are never offered again for this
 * sheet; if the (re-fetched) breakdown still claims no-fee, the sheet reports an error instead of
 * showing terms that contradict what the server just said.
 */
export function endSheetView(input: {
  breakdown: MoneyBreakdown | null;
  fetching: boolean;
  failed: boolean;
  reason: TerminationChoice["reason"];
  termsChanged: boolean;
}): EndSheetView {
  const { breakdown, fetching, failed, reason, termsChanged } = input;
  const base: EndSheetView = {
    phase: "loading",
    noFee: false,
    expectNoPenalty: false,
    refund: null,
    refundLabel: END_TERMS_TEXT.refundLabelOrdinary,
    intro: null,
    unresolvedNote: null,
    unresolvedAmount: null,
    changedNote: null,
    showReasons: false,
    confirmLabel: termsChanged ? END_TERMS_TEXT.confirmAfterChange : END_TERMS_TEXT.confirmDefault,
    canConfirm: false,
  };

  if (fetching) return base;
  const stillNoFee = termsChanged && breakdown?.canExitWithoutPenalty === true;
  if (failed || !breakdown || breakdown.refundIfCancelledNow == null || stillNoFee) {
    return { ...base, phase: "error", intro: END_TERMS_TEXT.loadFailed };
  }

  const noFee = breakdown.canExitWithoutPenalty && !termsChanged && reason === "CLIENT_CANCELLED";
  if (noFee) {
    return {
      ...base,
      phase: "ready",
      noFee: true,
      expectNoPenalty: true,
      refund: breakdown.refundIfCancelledNow,
      refundLabel: END_TERMS_TEXT.refundLabelNoFee,
      intro: END_TERMS_TEXT.noFeeIntro,
      unresolvedNote:
        breakdown.unresolvedSessions > 0 ? unresolvedSessionsNote(breakdown.unresolvedSessions) : null,
      unresolvedAmount:
        breakdown.unresolvedSessions > 0 && (breakdown.unresolvedAmountHeld ?? 0) > 0
          ? breakdown.unresolvedAmountHeld
          : null,
      confirmLabel: END_TERMS_TEXT.confirmNoFee,
      canConfirm: true,
    };
  }

  return {
    ...base,
    phase: "ready",
    // The preview is the CLIENT_CANCELLED figure; the no-show right has its own (full) refund.
    refund: reason === "CLIENT_CANCELLED" ? breakdown.refundIfCancelledNow : null,
    intro: "Lý do bạn chọn quyết định phần tiền được hoàn, nên hãy chọn đúng.",
    changedNote: termsChanged ? END_TERMS_TEXT.termsChanged : null,
    showReasons: true,
    canConfirm: true,
  };
}

/** Toast after a successful terminate; the no-fee exit says so, the ordinary one keeps today's wording. */
export function terminateSuccessMessage(result: any, formatMoney: (n: number) => string): string {
  if (result?.exitWithoutPenalty !== true) return "Đã cập nhật hợp đồng.";
  const refund = Number(result?.settlement?.refund ?? 0);
  return Number.isFinite(refund) && refund > 0
    ? `Đã kết thúc hợp đồng — hoàn ${formatMoney(refund)} vào ví của bạn, không mất phí`
    : "Đã kết thúc hợp đồng";
}

/**
 * user-service wrote `requestContract`'s refusals in Vietnamese (contract.service.ts:308-326 —
 * "Gói dịch vụ này đã ngừng bán", "PT hiện đang tạm ngưng nhận khách mới", …) with one straggler
 * the translation pass missed: line 392 still answers in English. A Vietnamese user should never
 * be shown that sentence, so known English messages are mapped here and everything else is passed
 * through untouched (it is already Vietnamese, and the server says it better than a generic
 * fallback would). Reported upstream in MOBILE_BACKEND_GAPS.md so the source can be fixed too.
 *
 * Found live 25/9: requesting a second contract from a PT the client already trains with showed
 * "You already have an active or pending contract with this PT" verbatim.
 */
const CONTRACT_REQUEST_ERROR_VI: { match: RegExp; text: string }[] = [
  {
    match: /already have an active or pending contract/i,
    text: "Bạn đang có hợp đồng với huấn luyện viên này rồi. Hãy kết thúc hợp đồng cũ trước khi gửi yêu cầu mới.",
  },
  { match: /pt not found|not found or not approved/i, text: "Không tìm thấy huấn luyện viên này." },
  { match: /not authorized/i, text: "Bạn không có quyền thực hiện việc này." },
];

export function contractRequestError(error: any): string {
  const raw = String(
    error?.response?.data?.error?.message ?? error?.response?.data?.error ?? error?.response?.data?.message ?? "",
  ).trim();
  if (!raw) return "Không gửi được yêu cầu";
  const hit = CONTRACT_REQUEST_ERROR_VI.find((m) => m.match.test(raw));
  if (hit) return hit.text;
  // Already Vietnamese (has a Vietnamese-only letter) — the server's own wording is the clearest.
  if (/[ăâđêôơưÀ-ỹ]/.test(raw)) return raw;
  return "Không gửi được yêu cầu";
}
