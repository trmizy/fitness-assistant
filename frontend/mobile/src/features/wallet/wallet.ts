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
 * Ledger descriptions are internal English strings written by payment-service
 * ("Contract <uuid> termination — refund (CLIENT_CANCELLED)"). Known kinds become a Vietnamese
 * label; anything unrecognised falls back to a neutral credit/debit label rather than leaking
 * ids and enum names to the user.
 */
export function transactionLabel(description: string | null | undefined, entryType: string): string {
  const d = (description ?? "").toLowerCase();
  if (/no[-_ ]?show|compensat|boi thuong|bồi thường/.test(d)) return "Bồi thường PT vắng mặt";
  if (/withdraw|rút tiền|rut tien/.test(d)) return "Rút tiền";
  if (/refund|hoàn tiền|hoan tien/.test(d)) {
    if (/contract/.test(d)) return "Hoàn tiền hợp đồng PT";
    if (/membership|gym/.test(d)) return "Hoàn tiền gói hội viên";
    if (/order|service|plan/.test(d)) return "Hoàn tiền đơn dịch vụ";
    return "Hoàn tiền";
  }
  if (description && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(description) && !/[A-Z]{3,}_[A-Z]/.test(description)) return description;
  return entryType === "CREDIT" ? "Tiền vào ví" : "Tiền ra khỏi ví";
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
