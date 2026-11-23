/**
 * Tài chính (batch G5) - pure model, no React, no network. `/gym-owner/finance`, brand-or-branch, behind VITE_GYM_OWNER_V2.
 *
 * Money rules this file keeps (05 sections 6 and 8, audit/03, PASS_A_REDLINE B4):
 *  - Every amount on screen is a field the SERVER sent: `withdrawable`, `availableBalance`, `pendingBalance`, `lockedBalance`,
 *    `reservedPending`, `gymDebt.*`, withdrawal `amount`, membership `priceAtPurchase`, the commission totals. Nothing here is a
 *    formula of ours, and wallets of different branches are NEVER added together (each wallet is its own ledger read at its own time).
 *  - The only sum we keep is the one the old Finance page already had, under its own honest name: sales = the list prices of the
 *    cards sold (`recognizedSales`), said to be a gross selling price and not the gym's income.
 *  - "Có thể rút" = `withdrawable` (payment-service computes it with the SAME function the withdrawal request is checked against).
 *    Only when an old server did not send it do we draw `availableBalance` and say that.
 *  - A wallet / list that did not load is never drawn as 0.
 *  - The destination of a withdrawal is the partner's REGISTERED payout account, shown read-only; this module only formats it.
 */
import { reservedPendingOf, withdrawableOf } from "../../../utils/gymWithdrawal";
import type { CanFn } from "../../../utils/gymStaffRole";
import type { Wallet } from "../../../types";
import type { TagTone } from "../scope/scopeModel";

// ---------------------------------------------------------------------------------------------------------------------
// Tabs and URL: /gym-owner/finance?gymId=&tab=wallets|withdrawals|commission|sales&withdrawal=<id>
// ---------------------------------------------------------------------------------------------------------------------

export const FIN_TAB_IDS = ["wallets", "withdrawals", "commission", "sales"] as const;
export type FinTabId = (typeof FIN_TAB_IDS)[number];

export const FIN_TAB_LABEL: Record<FinTabId, string> = {
  wallets: "Ví",
  withdrawals: "Lệnh rút",
  commission: "Hoa hồng PT",
  sales: "Doanh số",
};

export function parseFinTab(raw: string | null | undefined): FinTabId | null {
  return (FIN_TAB_IDS as readonly string[]).includes(raw ?? "") ? (raw as FinTabId) : null;
}

/** The permission each tab needs (the endpoint it reads enforces the same one). */
export const FIN_TAB_PERMISSION: Record<FinTabId, Parameters<CanFn>[0]> = {
  wallets: "finance.wallet.view",
  withdrawals: "finance.withdrawals.view",
  commission: "finance.ptCommission.view",
  sales: "membership.sales",
};

/** Tabs the account may open, in order. No permission (loading / unknown / old backend) = none: never an owner fallback. */
export function finTabsFor(can: CanFn): { id: FinTabId; label: string }[] {
  return FIN_TAB_IDS.filter((id) => can(FIN_TAB_PERMISSION[id])).map((id) => ({ id, label: FIN_TAB_LABEL[id] }));
}

/** The tab to show: the requested one when allowed, else the first allowed one (null = the account reads no finance data). */
export function resolveFinTab(raw: string | null | undefined, can: CanFn): FinTabId | null {
  const tabs = finTabsFor(can);
  if (tabs.length === 0) return null;
  const want = parseFinTab(raw);
  return want && tabs.some((t) => t.id === want) ? want : tabs[0].id;
}

export function financeSearch(s: { gymId?: string | null; tab: FinTabId; withdrawalId?: string | null }): string {
  const sp = new URLSearchParams();
  if (s.gymId && s.gymId !== "ALL") sp.set("gymId", s.gymId);
  if (s.tab !== "wallets") sp.set("tab", s.tab);
  if (s.tab === "withdrawals" && s.withdrawalId) sp.set("withdrawal", s.withdrawalId);
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export function financeHref(gymId?: string | null, tab: FinTabId = "wallets"): string {
  return `/gym-owner/finance${financeSearch({ gymId, tab })}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface WalletView {
  /** `withdrawable` of the server; or `availableBalance` when an old server did not send it (then `withdrawableFromServer` is false). */
  withdrawable: number;
  withdrawableFromServer: boolean;
  available: number;
  pending: number;
  locked: number;
  reservedPending: number;
  debtOpen: number;
  debtRecovered: number;
  debtRecent: { at: string; amount: number; unpaidAfter: number }[];
  active: boolean;
  status: string;
}

export function walletView(w: Wallet): WalletView {
  const sent = w.withdrawable !== undefined && w.withdrawable !== null && (w.withdrawable as unknown) !== "";
  return {
    withdrawable: withdrawableOf(w),
    withdrawableFromServer: sent,
    available: num(w.availableBalance),
    pending: num(w.pendingBalance),
    locked: num(w.lockedBalance),
    reservedPending: reservedPendingOf(w),
    debtOpen: num(w.gymDebt?.openUnpaid),
    debtRecovered: num(w.gymDebt?.recoveredTotal),
    debtRecent: (w.gymDebt?.recent ?? []).map((r) => ({ at: String(r.at), amount: num(r.amount), unpaidAfter: num(r.unpaidAfter) })),
    active: w.status === "ACTIVE" || w.status === undefined,
    status: String(w.status ?? ""),
  };
}

/** One short sentence per compartment (what the number is, in the owner's words). */
export const WALLET_HELP = {
  withdrawable: "Số tối đa máy chủ cho rút lúc này. Đã trừ các lệnh đang chờ duyệt và nợ nền tảng.",
  withdrawableOldServer: "Máy chủ chưa gửi số có thể rút nên đang hiện số khả dụng. Máy chủ sẽ kiểm lại số tiền khi bạn gửi lệnh.",
  available: "Tiền đã giải phóng, chưa bị lệnh rút nào khoá.",
  pending: "Tiền của hội viên, về ví khi gói kết thúc.",
  locked: "Lệnh rút đã duyệt, chưa chuyển khoản.",
  reservedPending: "Đang giữ cho các lệnh rút chờ Gymini duyệt.",
  debt: "Gymini ứng trước khi hoàn tiền cho hội viên thắng khiếu nại. Khoản này tự trừ dần vào thu nhập mới của chi nhánh.",
} as const;

export const WALLET_FROZEN_TEXT: Record<string, string> = {
  FROZEN: "Ví đang bị tạm khoá, chưa rút được. Liên hệ Gymini nếu bạn cần biết lý do.",
  CLOSED: "Ví đã đóng.",
};

/** Columns of the all-branches wallet table (order = the screen); `help` is the header tooltip AND the one compact legend. */
export const WALLET_COLUMNS: readonly { id: "withdrawable" | "available" | "pending" | "locked" | "reserved" | "debt"; label: string; help: string }[] = [
  { id: "withdrawable", label: "Có thể rút", help: "Số tối đa máy chủ cho rút lúc này, đã trừ lệnh đang chờ duyệt và nợ nền tảng." },
  { id: "available", label: "Khả dụng", help: "Tiền đã giải phóng, chưa bị lệnh rút nào khoá." },
  { id: "pending", label: "Đang chờ", help: "Tiền của hội viên, về ví khi gói kết thúc." },
  { id: "locked", label: "Đang khoá", help: "Lệnh rút đã duyệt, chưa chuyển khoản." },
  { id: "reserved", label: "Giữ cho lệnh chờ", help: "Đang giữ cho các lệnh rút chờ Gymini duyệt." },
  { id: "debt", label: "Nợ nền tảng", help: "Gymini ứng trước khi hoàn tiền khiếu nại; tự trừ dần vào thu nhập mới." },
];

export type WalletRowState = "loading" | "failed" | "no-wallet" | "ready";
/** A row of the all-branches table: a failed read of an approved branch is an error row; a failed read of a branch not approved yet is "no wallet" (never 0). */
export function walletRowState(i: { loading: boolean; failed: boolean; approved: boolean }): WalletRowState {
  if (i.loading) return "loading";
  if (i.failed) return i.approved ? "failed" : "no-wallet";
  return "ready";
}

/** Said under the grid of wallets of "all branches": there is deliberately no total row. */
export const NO_TOTAL_NOTE = "Mỗi ví là sổ riêng của một chi nhánh và được đọc ở thời điểm riêng, nên Gymini không cộng tổng các ví.";

export function clockText(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Withdrawal requests (the list `GET /owner/gyms/:id/withdrawals`; the accountant's rows are an allow-list of 9 fields with a masked account)
// ---------------------------------------------------------------------------------------------------------------------

export type WdStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";

export const WD_STATUS: Record<WdStatus, { text: string; tone: TagTone }> = {
  PENDING: { text: "Chờ duyệt", tone: "warn" },
  APPROVED: { text: "Đã duyệt, chưa chuyển tiền", tone: "info" },
  PAID: { text: "Đã chi", tone: "ok" },
  REJECTED: { text: "Bị từ chối", tone: "risk" },
};

export const wdStatusTag = (status: string): { text: string; tone: TagTone } => WD_STATUS[status as WdStatus] ?? { text: status || "Không rõ", tone: "neutral" };

/** A request is "open" while Gymini still has to act on it (PENDING) or still has to send the transfer (APPROVED). */
export const isOpenWithdrawal = (status: string): boolean => status === "PENDING" || status === "APPROVED";

export const APPROVED_NOT_PAID_NOTE = "Đã duyệt khác Đã chi: khi đã duyệt, số tiền chuyển sang ngăn Đang khoá của ví và chỉ rời Gymini khi Gymini xác nhận đã chuyển khoản.";
export const NO_REASON_TEXT = "Gymini không ghi lý do.";

export interface WithdrawalRow {
  id: string;
  gymId: string;
  gymName: string;
  amount: number;
  status: string;
  /** Exactly what the server sent for the viewer's role (the accountant's copy has the account number masked). */
  payoutInfo: string | null;
  /** REGISTERED_ACCOUNT = the server copied the partner's registered account; null = typed by the requester (old request). */
  payoutSource: string | null;
  bankReference: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function normalizeWithdrawals(raw: unknown, gym: { id: string; name: string }): WithdrawalRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = str(x.id);
    if (!id) return [];
    return [
      {
        id,
        gymId: gym.id,
        gymName: gym.name,
        amount: num(x.amount),
        status: str(x.status) ?? "UNKNOWN",
        payoutInfo: str(x.payoutInfo),
        payoutSource: str(x.payoutSource),
        bankReference: str(x.bankReference),
        rejectionReason: str(x.rejectionReason),
        createdAt: str(x.createdAt),
        reviewedAt: str(x.reviewedAt),
        paidAt: str(x.paidAt),
      } satisfies WithdrawalRow,
    ];
  });
}

const ts = (iso: string | null): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Newest first; ties keep a stable order by id so two requests of the same second do not swap on a refetch. */
export function sortWithdrawals(rows: readonly WithdrawalRow[]): WithdrawalRow[] {
  return [...rows].sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || a.id.localeCompare(b.id));
}

export function stamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function dayText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("vi-VN");
}

export interface TimelineStep {
  key: string;
  title: string;
  text: string;
  done: boolean;
  tone: "ok" | "risk" | "todo";
}

/**
 * The drawer's timeline: Chờ duyệt -> Đã duyệt, chưa chuyển -> Đã chi, or Bị từ chối (with the reason when the server sent one).
 * A step with no time from the server says so in words; nothing is invented. The accountant's rows carry no `reviewedAt`.
 */
export function withdrawalTimeline(w: WithdrawalRow): TimelineStep[] {
  const steps: TimelineStep[] = [{ key: "created", title: "Lệnh rút được tạo", text: stamp(w.createdAt) || "Máy chủ không ghi giờ tạo.", done: true, tone: "ok" }];
  if (w.status === "REJECTED") {
    const when = stamp(w.reviewedAt);
    steps.push({ key: "rejected", title: "Gymini từ chối", text: `${when ? `${when}. ` : ""}Lý do: ${w.rejectionReason ?? NO_REASON_TEXT}`, done: true, tone: "risk" });
    return steps;
  }
  const approved = w.status === "APPROVED" || w.status === "PAID";
  steps.push({
    key: "approved",
    title: "Gymini duyệt",
    text: approved ? stamp(w.reviewedAt) || "Đã duyệt." : "Chưa duyệt.",
    done: approved,
    tone: approved ? "ok" : "todo",
  });
  const paid = w.status === "PAID";
  steps.push({
    key: "paid",
    title: "Gymini chi tiền",
    text: paid ? `${stamp(w.paidAt) || "Đã chi."}${w.bankReference ? ` Mã tham chiếu ${w.bankReference}.` : ""}`.trim() : "Chưa chi, tiền chưa rời Gymini.",
    done: paid,
    tone: paid ? "ok" : "todo",
  });
  return steps;
}

/** What the account line says about where the money goes (a registered account, an older typed one, or what the server masked). */
export function payoutSourceNote(w: Pick<WithdrawalRow, "payoutSource">, maskedForRole: boolean): string {
  if (maskedForRole) return "Với vai trò của bạn, máy chủ che số tài khoản và chỉ để lại 4 số cuối.";
  return w.payoutSource === "REGISTERED_ACCOUNT" ? "Tài khoản nhận đã đăng ký của đối tác, máy chủ tự lấy khi tạo lệnh." : "Tài khoản do người tạo lệnh nhập (lệnh tạo trước khi chỉ còn rút về tài khoản đã đăng ký).";
}

// ---------------------------------------------------------------------------------------------------------------------
// The withdrawal request itself
// ---------------------------------------------------------------------------------------------------------------------

export type AmountCheck = { ok: true; value: string } | { ok: false; error: string | null };

/**
 * The amount typed by the owner -> the digit string sent as `amount`. Only "is it a positive whole number of dong" is checked here
 * (spaces and dots as thousand separators are accepted); the MINIMUM and the ceiling are the server's rules and its sentences are shown.
 * An empty box is not an error to shout about (the button is simply off).
 */
export function checkAmountInput(raw: string): AmountCheck {
  const t = raw.trim();
  if (!t) return { ok: false, error: null };
  const digits = t.replace(/[\s.]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "Chỉ nhập số tiền bằng chữ số, ví dụ 500000." };
  const v = digits.replace(/^0+(?=\d)/, "");
  if (/^0+$/.test(v)) return { ok: false, error: "Số tiền phải lớn hơn 0." };
  if (v.length > 12) return { ok: false, error: "Số tiền quá lớn." };
  return { ok: true, value: v };
}

export type WithdrawFailKind = "amount" | "payout" | "forbidden" | "suspended" | "wallet" | "ambiguous" | "other";
export interface WithdrawFailure {
  kind: WithdrawFailKind;
  text: string;
  /** True when the request may or may not have been created (timeout, network, 5xx): do not offer a blind retry. */
  ambiguous: boolean;
}

export const PAYOUT_REQUIRED_TEXT = "Chưa có tài khoản nhận tiền đã đăng ký. Hãy khai báo trong Hồ sơ đối tác rồi gửi lại yêu cầu.";
const AMBIGUOUS_TEXT = "Chưa rõ yêu cầu đã được tạo hay chưa. Hãy mở tab Lệnh rút để kiểm tra trước khi gửi lại, để không rút hai lần.";

const hasVietnamese = (s: string) => /[À-ỹ]/.test(s);

/**
 * One plain Vietnamese sentence per way a withdrawal request can be refused (payment-service / gym-service codes). The server's own
 * sentence is used when it is Vietnamese (the minimum and "vượt quá số dư" ones carry the real figures); a raw code or an English
 * message is never shown. 5xx / no answer is "ambiguous": the request may exist, so the screen asks the owner to look before retrying.
 */
export function withdrawFailure(error: unknown): WithdrawFailure {
  const e = error as { response?: { status?: number; data?: { error?: { code?: unknown; message?: unknown } } } } | null;
  const status = e?.response?.status;
  const code = typeof e?.response?.data?.error?.code === "string" ? (e.response.data.error.code as string) : "";
  const message = typeof e?.response?.data?.error?.message === "string" ? (e.response.data.error.message as string).trim() : "";
  const serverText = message && hasVietnamese(message) ? message : "";
  const mk = (kind: WithdrawFailKind, text: string, ambiguous = false): WithdrawFailure => ({ kind, text, ambiguous });

  if (!status || status >= 500) return mk("ambiguous", AMBIGUOUS_TEXT, true);
  if (code === "PAYOUT_ACCOUNT_REQUIRED") return mk("payout", PAYOUT_REQUIRED_TEXT);
  if (code === "INVALID_AMOUNT" || code === "VALIDATION_ERROR") return mk("amount", "Số tiền không hợp lệ. Hãy nhập số đồng nguyên lớn hơn 0, ví dụ 500000.");
  if (code === "WITHDRAWAL_BELOW_MINIMUM") return mk("amount", serverText || "Số tiền thấp hơn mức rút tối thiểu.");
  if (code === "EXCEEDS_WITHDRAWABLE_BALANCE") return mk("amount", serverText || "Số tiền vượt quá số có thể rút lúc này.");
  if (code === "PARTNER_SUSPENDED") return mk("suspended", serverText || "Đối tác đang bị tạm khoá nên chưa rút tiền được.");
  if (code === "WALLET_NOT_ACTIVE") return mk("wallet", serverText || "Ví của chi nhánh hiện không hoạt động nên chưa rút được.");
  if (code === "SYNTHETIC_RECORD_NOT_TRANSACTABLE") return mk("wallet", "Chi nhánh dữ liệu mẫu chỉ để hiển thị, không rút tiền được.");
  if (status === 403 || code === "PERMISSION_DENIED" || code === "OWNER_ROLE_REQUIRED") return mk("forbidden", "Chỉ chủ phòng tập được tạo lệnh rút tiền.");
  return mk("other", serverText || "Không gửi được yêu cầu rút tiền. Hãy thử lại sau ít phút.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Sales (membership list as a sales report)
// ---------------------------------------------------------------------------------------------------------------------

export const SALES_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang dùng",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_PAYMENT: "Chờ thanh toán",
  PENDING_ISSUE: "Có vấn đề thanh toán",
};

export const SALES_MEANING_NOTE =
  "Giá bán là số khách đã trả khi mua thẻ, chưa trừ phần của nền tảng và hoa hồng giới thiệu PT. Đây không phải thu nhập của phòng tập; thu nhập thật nằm trong tab Ví.";

export const SALES_TOTAL_LABEL = "Giá bán gộp của thẻ đã thanh toán";

export interface SalesView {
  id: string;
  gymId: string;
  planId: string;
  status: string;
  priceAtPurchase: number;
  paymentTxnId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
}

export function normalizeSales(raw: unknown): SalesView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = str(x.id);
    if (!id) return [];
    return [
      {
        id,
        gymId: str(x.gymId) ?? "",
        planId: str(x.planId) ?? "",
        status: str(x.status) ?? "UNKNOWN",
        priceAtPurchase: num(x.priceAtPurchase),
        paymentTxnId: str(x.paymentTxnId),
        startDate: str(x.startDate),
        endDate: str(x.endDate),
        createdAt: str(x.createdAt),
      } satisfies SalesView,
    ];
  });
}

export function sortSales(rows: readonly SalesView[]): SalesView[] {
  return [...rows].sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || a.id.localeCompare(b.id));
}

/** Rows drawn at once (the CSV always carries all of them). */
export const SALES_ROWS_SHOWN = 100;

// ---------------------------------------------------------------------------------------------------------------------
// Partial answers over several branches
// ---------------------------------------------------------------------------------------------------------------------

/** "Đã tải 2/3 chi nhánh, Q7 lỗi" - what to say when some branch requests failed; nothing is added up in that case. */
export function coverageLine(total: number, failedNames: readonly string[]): string | null {
  if (failedNames.length === 0) return null;
  return `Đã tải ${total - failedNames.length}/${total} chi nhánh. Chưa tải được: ${failedNames.join(", ")}.`;
}
