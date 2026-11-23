/**
 * Compact wallet SUMMARY of a branch (G2, trimmed in G5). The withdrawal request, the registered payout account, the open requests
 * and the history now live in Tài chính (`/gym-owner/finance?gymId=`, the one place that moves money), so this card only shows what
 * the server says right now and links there. "Có thể rút" is the server's `withdrawable` (payment-service computes it with the same
 * function the withdrawal request is checked against); an old server without it falls back to `availableBalance` (gymWithdrawal.ts).
 *
 * Honesty: a wallet that has not loaded (or failed) is never drawn as 0. Money digits are never animated (06 section 4).
 */
import { useQuery } from "@tanstack/react-query";
import { WalletIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Wallet } from "../../../types";
import { formatVND } from "../../../utils/currency";
import { reservedPendingOf, withdrawableOf } from "../../../utils/gymWithdrawal";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";

export function WalletBlock({ gymId, canViewFinance }: { gymId: string; canViewFinance: boolean }) {
  const walletQ = useQuery<Wallet>({ queryKey: ["owned-gym-wallet", gymId], queryFn: () => gymService.getOwnedWallet(gymId) });
  const wallet = walletQ.data;
  const loading = walletQ.isLoading;
  const failed = walletQ.isError && !wallet;

  return (
    <section className="go-card go-wallet" aria-labelledby="go-h-wallet" data-testid="go-branch-wallet" data-state={loading ? "loading" : failed ? "error" : "ready"}>
      <div className="go-card-head">
        <h2 id="go-h-wallet"><WalletIcon aria-hidden="true" width={18} height={18} /> Ví của chi nhánh</h2>
        {canViewFinance && <GoLink to={`/gym-owner/finance?gymId=${encodeURIComponent(gymId)}`} className="go-btn go-btn-sm" data-testid="go-wallet-finance-link">Mở trong Tài chính</GoLink>}
      </div>

      {loading && (
        <div className="go-wallet-grid" aria-hidden="true" data-testid="go-wallet-skeleton">
          <span className="go-skel-bar" style={{ height: 44 }} />
          <span className="go-skel-bar" style={{ height: 44 }} />
        </div>
      )}
      {failed && (
        <div className="go-notice" data-tone="risk" role="alert">
          <span>Không tải được số dư ví của chi nhánh này.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => void walletQ.refetch()}>Thử lại</button>
        </div>
      )}
      {wallet && (
        <div className="go-wallet-grid">
          <div className="go-money" data-kind="available">
            <span className="go-money-label">Có thể rút</span>
            <span className="go-money-num" data-testid="gym-wallet-available-balance" data-value={String(withdrawableOf(wallet))}>{formatVND(withdrawableOf(wallet))}</span>
            <span className="go-money-hint">
              Số tiền rút tối đa do máy chủ tính
              {reservedPendingOf(wallet) > 0 && <span data-testid="gym-wallet-reserved-pending"> · Đang giữ cho yêu cầu rút chờ duyệt: {formatVND(reservedPendingOf(wallet))}</span>}
            </span>
          </div>
          <div className="go-money" data-kind="pending">
            <span className="go-money-label">Đang chờ</span>
            <span className="go-money-num" data-testid="gym-wallet-pending-balance">{formatVND(Number(wallet.pendingBalance ?? 0))}</span>
            <span className="go-money-hint">Gói hội viên chưa kết thúc</span>
          </div>
        </div>
      )}
      {wallet && canViewFinance && <p className="go-card-note" data-testid="go-wallet-moved-note">Rút tiền, tài khoản nhận và lịch sử lệnh rút nằm trong mục Tài chính.</p>}
    </section>
  );
}
