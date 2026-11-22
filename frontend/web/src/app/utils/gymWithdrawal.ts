/**
 * Gym wallet "Có thể rút" and the withdrawal destination (Gym Owner handoff items 1 and 7, owner decisions 22/11/2026). Pure, no React.
 *
 * - Item 7: payment-service returns `withdrawable` (and `reservedPending`) on GET .../wallet, computed by the SAME function the withdrawal
 *   request is checked against. The label "Có thể rút" shows it; an older server that does not send it falls back to `availableBalance`.
 * - Item 1: the destination of a gym withdrawal is the partner's REGISTERED payout account (read-only here); the owner no longer types one.
 */

export type WalletLike = { withdrawable?: string | number | null; reservedPending?: string | number | null; availableBalance?: string | number | null } | null | undefined;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** What can really be withdrawn now. Falls back to availableBalance only when the server did not send `withdrawable` (old payment-service). */
export function withdrawableOf(wallet: WalletLike): number {
  if (!wallet) return 0;
  if (wallet.withdrawable !== undefined && wallet.withdrawable !== null && wallet.withdrawable !== "") return Math.max(0, num(wallet.withdrawable));
  return num(wallet.availableBalance);
}

/** Money held for requests still waiting for an admin (0 when the server did not send it). */
export function reservedPendingOf(wallet: WalletLike): number {
  return wallet ? Math.max(0, num(wallet.reservedPending)) : 0;
}

export type RegisteredPayout = { bankName: string | null; accountNumber: string | null; accountHolder: string | null } | null | undefined;

/** "Ngân hàng — số tài khoản — chủ tài khoản" of a COMPLETE registered account, else "" (the server refuses with PAYOUT_ACCOUNT_REQUIRED then). */
export function registeredPayoutText(payout: RegisteredPayout): string {
  if (!payout?.bankName?.trim() || !payout.accountNumber?.trim() || !payout.accountHolder?.trim()) return "";
  return [payout.bankName, payout.accountNumber, payout.accountHolder].map((s) => (s as string).trim()).join(" — ");
}

/** Keeps only the last 4 digits readable ("•••• 6789") for places that should not repeat a full account number. */
export function maskAccountNumber(n: string): string {
  const t = n.trim();
  return t.length <= 4 ? t : `${"•".repeat(Math.min(t.length - 4, 8))} ${t.slice(-4)}`;
}
