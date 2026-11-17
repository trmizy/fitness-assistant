/**
 * N15M-05 — the PT wallet's top card says what the money that is not withdrawable YET is made of, with the
 * SAME words the per-contract cards use (PtContractMoney), so one sum of money never carries two names.
 *
 * Balance fields of payment-service's PT wallet (schema.prisma, FH-9):
 *  - pendingBalance  = attributed to the PT but NOT EARNED yet (the sessions have not happened)  -> "Chưa kiếm"
 *  - holdbackBalance = EARNED, held back per contract until it ends and reconciles                -> "Đang tạm giữ"
 *  - lockedBalance   = already requested for a payout, waiting for the transfer                   -> "Đang xử lý rút tiền"
 * Before, the top card summed all three under "Đang tạm giữ", so 1.449.000 of NOT-YET-EARNED money read as
 * "held" while the contract card said "Chưa kiếm 1.449.000 / Đang tạm giữ 0 ₫".
 */
export type PtWalletPart = { key: "pending" | "holdback" | "locked"; label: string; amount: number };

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function ptWalletNotWithdrawable(wallet: unknown): { total: number; parts: PtWalletPart[] } {
  const w = (wallet ?? {}) as Record<string, unknown>;
  const all: PtWalletPart[] = [
    { key: "pending", label: "Chưa kiếm", amount: n(w.pendingBalance) },
    { key: "holdback", label: "Đang tạm giữ", amount: n(w.holdbackBalance) },
    { key: "locked", label: "Đang xử lý rút tiền", amount: n(w.lockedBalance) },
  ];
  const parts = all.filter((p) => p.amount > 0);
  return { total: parts.reduce((s, p) => s + p.amount, 0), parts };
}
