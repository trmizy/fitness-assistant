/**
 * CL-13 — pure parts of "Ví của tôi" (web's WalletPage). Shapes are payment-service's real
 * `/me/wallet`, `/me/wallet/transactions`, `/me/withdrawals` answers (checked 22/9).
 *
 * The client wallet only ever RECEIVES money (refunds, no-show compensation — top-up was removed
 * from the product, POST /me/wallet/topup answers 410). Only refund/compensation-sourced money
 * can be withdrawn; payment-service enforces that when the request is created, and exposes no
 * "withdrawable" figure, so none is shown.
 */

export type WithdrawalStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";

export const WITHDRAWAL_STATUS: Record<WithdrawalStatus, { tone: "warning" | "info" | "success" | "danger"; label: string; hint: string }> = {
  PENDING: { tone: "warning", label: "Chờ duyệt", hint: "Đang chờ xử lý — sẽ chuyển khoản thủ công" },
  APPROVED: { tone: "info", label: "Đã duyệt", hint: "Đã giữ chỗ — đang chờ chuyển khoản" },
  PAID: { tone: "success", label: "Đã chi trả", hint: "Đã chuyển khoản" },
  REJECTED: { tone: "danger", label: "Từ chối", hint: "Yêu cầu bị từ chối" },
};

export function withdrawalStatus(s: string | null | undefined) {
  return WITHDRAWAL_STATUS[(s ?? "") as WithdrawalStatus] ?? { tone: "info" as const, label: s ?? "—", hint: "" };
}

/**
 * Plain-Vietnamese label for one wallet-history row. payment-service adds a derived `category` to every row of
 * `/me/wallet/transactions` (services/wallet-entry-category.ts); the raw `description` is an internal English ledger
 * string with ids and enum names ("PERSONALIZED_SERVICE_PURCHASE <uuid> — refund (contract could not be activated)")
 * and is never shown. An unknown category falls back to a neutral direction label; an answer from a backend that
 * predates `category` falls back to a product-aware reading of the description. Keep this table in step with the web
 * copy (frontend/web/src/app/utils/walletEntryLabel.ts).
 */
export const WALLET_ENTRY_LABEL: Record<string, string> = {
  REFUND_UNACTIVATED_PERSONALIZED_SERVICE: "Hoàn tiền dịch vụ cá nhân hóa (đơn đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_MEMBERSHIP: "Hoàn tiền gói hội viên (gói đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_PT_CONTRACT: "Hoàn tiền hợp đồng PT (hợp đồng đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_OTHER: "Hoàn tiền (đơn đã hủy trước khi thanh toán xong)",
  REFUND_PT_CONTRACT: "Hoàn tiền hợp đồng PT",
  REFUND_PT_SESSION_NOT_DELIVERED: "Hoàn tiền buổi PT chưa diễn ra",
  REFUND_MEMBERSHIP: "Hoàn tiền gói hội viên",
  REFUND_PERSONALIZED_SERVICE: "Hoàn tiền dịch vụ cá nhân hóa",
  REFUND_OTHER: "Hoàn tiền",
  COMPENSATION_PT_NO_SHOW: "Hoàn tiền buổi PT vắng",
  COMPENSATION_PT_LATE_ARRIVAL: "Bồi thường PT đến muộn",
  COMPENSATION_PT_FAULT: "Bồi thường do PT không thực hiện hợp đồng",
  TOPUP: "Nạp tiền vào ví",
  WITHDRAWAL_LOCKED: "Rút tiền: đã giữ chờ chuyển khoản",
  WITHDRAWAL_RESTORED: "Rút tiền bị từ chối: tiền trả về ví",
  WITHDRAWAL_PAID: "Rút tiền: đã chuyển khoản",
  EARNING_HELD: "Thu nhập hợp đồng đang được giữ",
  EARNING_RELEASED: "Thu nhập đã nhận",
  EARNING_MOVED_TO_AVAILABLE: "Chuyển thu nhập sang số dư khả dụng",
  PT_CHARGE_NO_SHOW: "Trừ phí PT vắng mặt buổi tập",
  PT_CHARGE_LATE_ARRIVAL: "Trừ phí PT đến muộn",
  HOLDBACK_KEPT: "Tạm giữ một phần thu nhập hợp đồng (của bạn, chưa rút được)",
  HOLDBACK_RELEASED: "Trả lại khoản tạm giữ vào số dư",
  HOLDBACK_USED_FOR_COMPENSATION: "Dùng khoản tạm giữ để bồi thường khách của hợp đồng này",
  CLAWBACK: "Thu hồi thu nhập đã nhận",
  REFERRAL_COMMISSION: "Hoa hồng giới thiệu",
  REFERRAL_CLAWBACK: "Thu hồi hoa hồng giới thiệu",
  DEBT_WITHHELD: "Trừ vào khoản đang nợ",
  PENDING_REVERSED: "Hoàn lại khoản đang giữ (thanh toán đã hoàn)",
  OTHER_CREDIT: "Tiền vào ví",
  OTHER_DEBIT: "Tiền ra khỏi ví",
};

export interface WalletEntryLike {
  category?: string | null;
  description?: string | null;
  entryType?: string | null;
}

const directionLabel = (entryType: string | null | undefined) =>
  entryType === "DEBIT" ? WALLET_ENTRY_LABEL.OTHER_DEBIT : WALLET_ENTRY_LABEL.OTHER_CREDIT;

/** Reads an old-backend description (no `category`) the way the server would. Never returns the raw text. */
function labelFromDescription(description: string, entryType: string | null | undefined): string {
  const d = description.toLowerCase();
  const credit = entryType !== "DEBIT";
  const product = /personalized/.test(d)
    ? "service"
    : /^(gym_membership|membership)\b/.test(d)
      ? "membership"
      : /^(pt_contract|contract)\b/.test(d)
        ? "contract"
        : null;
  if (credit && /compensation for a missed session|no[-_ ]?show/.test(d)) return WALLET_ENTRY_LABEL.COMPENSATION_PT_NO_SHOW;
  if (credit && /late arrival|late-arrival/.test(d)) return WALLET_ENTRY_LABEL.COMPENSATION_PT_LATE_ARRIVAL;
  if (/withdrawal/.test(d)) {
    if (/rejected/.test(d)) return WALLET_ENTRY_LABEL.WITHDRAWAL_RESTORED;
    if (/paid/.test(d)) return WALLET_ENTRY_LABEL.WITHDRAWAL_PAID;
    return WALLET_ENTRY_LABEL.WITHDRAWAL_LOCKED;
  }
  if (credit && /refund/.test(d)) {
    const unactivated = /could not be activated/.test(d);
    if (product === "service") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_PERSONALIZED_SERVICE" : "REFUND_PERSONALIZED_SERVICE"];
    if (product === "membership") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_MEMBERSHIP" : "REFUND_MEMBERSHIP"];
    if (product === "contract") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_PT_CONTRACT" : "REFUND_PT_CONTRACT"];
    return WALLET_ENTRY_LABEL.REFUND_OTHER;
  }
  return directionLabel(entryType);
}

export function walletEntryLabel(entry: WalletEntryLike): string {
  const byCategory = entry.category ? WALLET_ENTRY_LABEL[entry.category] : undefined;
  if (byCategory) return byCategory;
  if (entry.category) return directionLabel(entry.entryType); // a category this build does not know yet
  return entry.description ? labelFromDescription(entry.description, entry.entryType) : directionLabel(entry.entryType);
}

/** Back-compatible entry point: (description, entryType) as before, plus the server's `category` when the row has one. */
export function transactionLabel(description: string | null | undefined, entryType: string, category?: string | null): string {
  return walletEntryLabel({ description, entryType, category });
}

/** Money strings from payment-service ("26353274.61") → number; bad input → 0. */
export function money(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Digits only ("240.000" / "240,000 đ" → "240000"); the request body carries a string amount. */
export function parseAmountInput(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/**
 * Trần rút THẬT, theo đúng `payment-service/withdrawal.service.ts`: số dư khả dụng **trừ** tổng các
 * yêu cầu còn PENDING. Yêu cầu đã APPROVED thì tiền đã rời `availableBalance` sang `lockedBalance`,
 * trừ lần nữa là trừ hai lần.
 *
 * Không có bước trừ này thì biểu mẫu mời người dùng rút một số tiền mà máy chủ chắc chắn từ chối
 * bằng 400 `EXCEEDS_WITHDRAWABLE_BALANCE`. Ví khách còn một luật chặt hơn nữa (chỉ rút được phần
 * tiền hoàn), nên đây là trần TRÊN chứ không phải toàn bộ luật.
 */
export function withdrawableCeiling(wallet: unknown, withdrawals: unknown): number {
  const available = money((wallet as any)?.availableBalance);
  const rows: any[] = Array.isArray(withdrawals) ? withdrawals : ((withdrawals as any)?.data ?? []);
  const pendingReserved = (Array.isArray(rows) ? rows : [])
    .filter((w) => w?.status === "PENDING")
    .reduce((sum, w) => sum + money(w?.amount), 0);
  return Math.max(0, available - pendingReserved);
}

export function withdrawFormError(amount: string, payoutInfo: string, available: number): string | null {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n) || n <= 0) return "Nhập số tiền muốn rút.";
  if (n > available) return "Số tiền vượt quá số dư khả dụng.";
  if (!payoutInfo.trim()) return "Nhập số tài khoản và ngân hàng nhận tiền.";
  return null;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
