/**
 * Ví chi nhánh: "Có thể rút" và điểm đến của lệnh rút (Gym Owner handoff mục 1 và 7, chủ sở hữu chốt 22/11/2026).
 * Thuần TS, không React — phản chiếu web `utils/gymWithdrawal.ts`.
 *
 * - Mục 7: payment-service trả `withdrawable` (và `reservedPending`) trên `GET /owner/gyms/:id/wallet`, tính bằng CHÍNH hàm dùng khi
 *   kiểm yêu cầu rút (`availableBalance − ΣPENDING − nợ nền tảng`). Nhãn "Có thể rút" hiện số này; máy chủ cũ chưa gửi thì lùi về
 *   `availableBalance` (kèm bước trừ yêu cầu PENDING như trước, để không mời rút số mà máy chủ chắc chắn từ chối).
 * - Mục 1: điểm đến lệnh rút là tài khoản nhận tiền ĐÃ ĐĂNG KÝ của đối tác (chỉ đọc); chủ không còn gõ tay, app không gửi `payoutInfo`.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const sent = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

export type WalletLike =
  | { withdrawable?: string | number | null; reservedPending?: string | number | null; availableBalance?: string | number | null }
  | null
  | undefined;

/** Số thực sự rút được lúc này. Chỉ lùi về `availableBalance` khi máy chủ không gửi `withdrawable` (payment-service cũ). */
export function withdrawableOf(wallet: WalletLike): number {
  if (!wallet) return 0;
  if (sent(wallet.withdrawable)) return Math.max(0, num(wallet.withdrawable));
  return num(wallet.availableBalance);
}

/** Tiền đang giữ cho yêu cầu chờ admin (0 khi máy chủ không gửi). */
export function reservedPendingOf(wallet: WalletLike): number {
  return wallet ? Math.max(0, num(wallet.reservedPending)) : 0;
}

/**
 * Trần rút để mở biểu mẫu. Có `withdrawable` → dùng thẳng (đã trừ yêu cầu chờ và nợ, KHÔNG trừ lần nữa).
 * Máy chủ cũ → `availableBalance` trừ tổng yêu cầu PENDING trong danh sách (hành vi trước đây).
 */
export function withdrawCeiling(wallet: WalletLike, withdrawals: unknown): number {
  if (wallet && sent(wallet.withdrawable)) return withdrawableOf(wallet);
  const rows: any[] = Array.isArray(withdrawals) ? withdrawals : ((withdrawals as any)?.data ?? []);
  const pending = (Array.isArray(rows) ? rows : []).filter((w) => w?.status === "PENDING").reduce((s, w) => s + num(w?.amount), 0);
  return Math.max(0, num(wallet?.availableBalance) - pending);
}

export type RegisteredPayout = { bankName?: string | null; accountNumber?: string | null; accountHolder?: string | null } | null | undefined;

/** "Ngân hàng — số tài khoản — chủ tài khoản" của tài khoản ĐỦ ba trường, ngược lại "" (máy chủ trả 409 PAYOUT_ACCOUNT_REQUIRED). */
export function registeredPayoutText(payout: RegisteredPayout): string {
  if (!payout?.bankName?.trim() || !payout.accountNumber?.trim() || !payout.accountHolder?.trim()) return "";
  return [payout.bankName, payout.accountNumber, payout.accountHolder].map((s) => (s as string).trim()).join(" — ");
}

/** Chỉ còn đọc được 4 số cuối ("•••• 6789") cho chỗ không nên lặp lại cả số tài khoản. */
export function maskAccountNumber(n: string): string {
  const t = n.trim();
  return t.length <= 4 ? t : `${"•".repeat(Math.min(t.length - 4, 8))} ${t.slice(-4)}`;
}

/**
 * Trạng thái tài khoản nhận tiền đã đăng ký, đọc từ `GET /owner/onboarding/status`:
 *   registered — có đủ ba trường → hiện chỉ-đọc, cho gửi.
 *   missing    — `payout` là object nhưng thiếu trường (chủ chưa khai) → cảnh báo + khoá nút gửi + dẫn tới Hồ sơ.
 *   unknown    — không có `payout` (vai trò khác chủ / chưa tải / lỗi) → không khẳng định gì, khoá nút gửi (fail-closed).
 */
export type PayoutAccountState = "registered" | "missing" | "unknown";

export function payoutAccountState(onboardingStatus: unknown): PayoutAccountState {
  const payout = (onboardingStatus as { payout?: RegisteredPayout } | null | undefined)?.payout;
  if (!payout || typeof payout !== "object") return "unknown";
  return registeredPayoutText(payout) ? "registered" : "missing";
}

/** Lỗi của biểu mẫu rút (không còn ô nhập tài khoản). null = gửi được. */
export function gymWithdrawFormError(amount: string, ceiling: number, payoutState: PayoutAccountState): string | null {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n) || n <= 0) return "Nhập số tiền muốn rút.";
  if (n > ceiling) return "Số tiền vượt quá số có thể rút.";
  if (payoutState === "missing") return "Cần khai báo tài khoản nhận tiền trong Hồ sơ trước khi rút.";
  if (payoutState === "unknown") return "Chưa xác định được tài khoản nhận tiền đã đăng ký.";
  return null;
}

export const PAYOUT_ACCOUNT_REQUIRED_MESSAGE =
  "Chưa có tài khoản nhận tiền đã đăng ký. Hãy khai báo tài khoản nhận tiền trong Hồ sơ rồi gửi lại.";

/** Chữ hiển thị khi gửi yêu cầu rút bị từ chối: 409 PAYOUT_ACCOUNT_REQUIRED có câu riêng; còn lại dùng thông điệp của máy chủ. */
export function gymWithdrawalErrorMessage(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: any } } | null)?.response;
  const code = res?.data?.error?.code ?? res?.data?.code;
  if (res?.status === 409 && code === "PAYOUT_ACCOUNT_REQUIRED") return PAYOUT_ACCOUNT_REQUIRED_MESSAGE;
  const message = res?.data?.error?.message;
  return typeof message === "string" && message.trim() ? message : "Không gửi được yêu cầu rút tiền";
}

/** Dòng "Lý do từ chối" cho yêu cầu REJECTED; null cho trạng thái khác. Không ghi lý do → câu mặc định. */
export function rejectionReasonLine(w: { status?: string | null; rejectionReason?: string | null } | null | undefined): string | null {
  if (!w || w.status !== "REJECTED") return null;
  return `Lý do từ chối: ${w.rejectionReason?.trim() || "Quản trị viên không ghi lý do."}`;
}
