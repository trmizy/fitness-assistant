/**
 * Compact wallet block of a branch (batch G2). Reads the same endpoints as the legacy GymManagePage (wallet, withdrawals, the
 * saved payout hint) with the same query keys, and keeps the withdrawal request HERE until the Tài chính batch (G5) takes it over:
 * `useRequestWithdrawal` = gymService.requestGymWithdrawal(gymId, amount), owner-only on the server. The destination is always the
 * partner's REGISTERED payout account, shown read-only (no free-text field); "Có thể rút" is the server's `withdrawable`.
 *
 * Honesty: a wallet that has not loaded (or failed) is never drawn as 0. Money digits are never animated (06 section 4).
 * Motion: 01 card-resize (the withdrawal form and the open requests reveal in place), 04 text-states-swap on the submit button,
 * 10 success-check only after the server answered 2xx, 12 error-state-shake on a refused request.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoneyIcon as Banknote, WalletIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Wallet } from "../../../types";
import { formatVND } from "../../../utils/currency";
import { canUseFeature, type PartnerRole } from "../../../utils/gymStaffRole";
import { registeredPayoutText, reservedPendingOf, withdrawableOf } from "../../../utils/gymWithdrawal";
import { GoReveal } from "../../../components/layout/gym-owner/GoAccordion";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { apiMessage } from "./branchesModel";
import { useRequestWithdrawal } from "./useBranchMutations";

// Money-flow §16: PENDING/APPROVED are not an eligibility gate; both mean "Gymini still has to send a bank transfer".
const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ xử lý, sẽ chuyển khoản thủ công",
  APPROVED: "Đã giữ chỗ, đang chờ chuyển khoản",
  PAID: "Đã chi trả",
  REJECTED: "Bị từ chối",
};

export function WalletBlock({ gymId, role, canWithdraw }: { gymId: string; role: PartnerRole | undefined; canWithdraw: boolean }) {
  const walletQ = useQuery<Wallet>({ queryKey: ["owned-gym-wallet", gymId], queryFn: () => gymService.getOwnedWallet(gymId) });
  const withdrawalsQ = useQuery<any[]>({ queryKey: ["owned-gym-withdrawals", gymId], queryFn: () => gymService.listGymWithdrawals(gymId) });
  const onboardingQ = useQuery<{ payout?: { bankName: string | null; accountNumber: string | null; accountHolder: string | null } | null }>({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const payout = onboardingQ.data?.payout;
  // `payout` is only present for the OWNER (null for other roles); an owner who has not filled it in gets an object with missing fields.
  const savedPayout = registeredPayoutText(payout);
  const payoutMissing = !!payout && !savedPayout;

  const withdraw = useRequestWithdrawal(gymId);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { ref: formRef, shake } = useShake<HTMLDivElement>();
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = (withdrawalsQ.data ?? []).filter((w) => w.status === "PENDING" || w.status === "APPROVED");
  const wallet = walletQ.data;
  const loading = walletQ.isLoading;
  const failed = walletQ.isError && !wallet;

  async function submit() {
    setError(null);
    try {
      await withdraw.mutateAsync({ amount });
      setShowForm(false);
      setAmount("");
      setSent(true);
      if (sentTimer.current) clearTimeout(sentTimer.current);
      sentTimer.current = setTimeout(() => setSent(false), 3500);
    } catch (err) {
      const e = err as { response?: { data?: { error?: { code?: unknown } } } } | null;
      setError(
        e?.response?.data?.error?.code === "PAYOUT_ACCOUNT_REQUIRED"
          ? "Chưa có tài khoản nhận tiền đã đăng ký. Hãy khai báo trong Hồ sơ đối tác rồi gửi lại yêu cầu."
          : apiMessage(err, "Không thể tạo yêu cầu rút tiền"),
      );
      shake();
    }
  }

  return (
    <section className="go-card go-wallet" aria-labelledby="go-h-wallet" data-testid="go-branch-wallet" data-state={loading ? "loading" : failed ? "error" : "ready"}>
      <div className="go-card-head">
        <h2 id="go-h-wallet"><WalletIcon aria-hidden="true" width={18} height={18} /> Ví của chi nhánh</h2>
        {canUseFeature(role, "finance") && <GoLink to={`/gym-owner/finance?gymId=${gymId}`} className="go-btn go-btn-sm" data-testid="go-wallet-finance-link">Mở trong Tài chính</GoLink>}
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

      {canWithdraw && wallet && (
        <div className="go-wallet-actions">
          <button
            type="button"
            className="go-btn go-btn-sm"
            data-variant="primary"
            data-testid="gym-request-withdrawal-toggle"
            aria-expanded={showForm}
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
            }}
          >
            <Banknote aria-hidden="true" width={14} height={14} /> Yêu cầu rút tiền
          </button>
          <span className="go-sent" data-show={sent ? "true" : "false"} role="status" data-testid="go-withdraw-sent">
            <SuccessCheck show={sent} size={16} /> {sent ? "Đã gửi yêu cầu rút tiền" : ""}
          </span>
        </div>
      )}

      {canWithdraw && (
        <GoReveal open={showForm}>
          <div className="go-withdraw-form" ref={formRef} data-error={error ? "true" : undefined}>
            <input data-testid="gym-withdraw-amount-input" aria-label="Số tiền (VNĐ)" className="go-input" type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} placeholder="Số tiền (VNĐ)" />
            {savedPayout ? (
              <div data-testid="gym-withdraw-registered-payout">
                <p className="go-muted-text">Chuyển khoản tới tài khoản nhận tiền đã đăng ký</p>
                <p style={{ overflowWrap: "anywhere" }}>{savedPayout}</p>
                <GoLink to="/gym-owner/profile" className="go-btn go-btn-sm" data-testid="gym-withdraw-change-payout-link">Đổi tài khoản trong Hồ sơ đối tác</GoLink>
              </div>
            ) : payoutMissing ? (
              <div className="go-notice" data-tone="warn" data-testid="gym-withdraw-payout-missing">
                <span>Chưa có tài khoản nhận tiền đã đăng ký. Tiền rút luôn được chuyển tới tài khoản này, nên cần khai báo trước.</span>
                <GoLink to="/gym-owner/profile" className="go-btn go-btn-sm" data-testid="gym-withdraw-add-payout-link">Khai báo trong Hồ sơ đối tác</GoLink>
              </div>
            ) : null}
            <p className="go-muted-text">Máy chủ kiểm tra số tiền khi bạn gửi.</p>
            {error && <p className="go-error" role="alert" data-testid="go-withdraw-error">{error}</p>}
            <div className="go-form-actions">
              <button type="button" className="go-btn go-btn-sm" onClick={() => setShowForm(false)}>Huỷ</button>
              <button
                type="button"
                className="go-btn go-btn-sm"
                data-variant="primary"
                data-testid="gym-withdraw-submit-button"
                onClick={() => void submit()}
                disabled={!amount || !savedPayout || withdraw.isPending}
              >
                <TextStates value={withdraw.isPending ? "Đang gửi" : "Gửi yêu cầu"} />
              </button>
            </div>
          </div>
        </GoReveal>
      )}

      <GoReveal open={open.length > 0}>
        <div data-testid="gym-open-withdrawal-requests" className="go-wd-list">
          {open.map((w) => (
            <div key={w.id} data-testid="gym-withdrawal-request-row" data-status={w.status} data-amount={w.amount} className="go-wd-row">
              <span>{formatVND(Number(w.amount))}</span>
              <span className="go-badge" data-tone="warn">{WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}</span>
            </div>
          ))}
        </div>
      </GoReveal>
      {withdrawalsQ.isError && <p className="go-muted-text">Chưa tải được danh sách yêu cầu rút tiền.</p>}
    </section>
  );
}
