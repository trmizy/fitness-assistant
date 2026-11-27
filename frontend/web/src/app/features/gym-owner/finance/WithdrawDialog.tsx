/**
 * "Rút tiền" dialog (06 modal) of ONE branch. Two steps in one dialog:
 *   1. amount (whole dong) + the REGISTERED payout account, read-only (the owner no longer types a destination; no account yet = a way to
 *      Hồ sơ, the request is not offered);
 *   2. confirmation that names the branch, the amount and the receiving account. Only this step sends.
 * One request at a time: the send button is off while a request is in flight and after an ambiguous failure (timeout / 5xx), so a
 * second click cannot create a second withdrawal; the owner is told to look at Lệnh rút first. The server stays the authority for the
 * minimum and for the ceiling (it answers 400 with the figures; its Vietnamese sentence is shown). 10 success-check only after a 2xx,
 * 12 error-state-shake on every refusal, 04 text-states-swap on the buttons.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { registeredPayoutText } from "../../../utils/gymWithdrawal";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import type { ScopeGym } from "../scope/scopeModel";
import { financeHref, checkAmountInput, withdrawFailure, type WalletView, type WithdrawFailure } from "./financeModel";
import { refreshAfterWithdrawal, useOnboardingPayout } from "./useFinanceData";

type Phase = "form" | "confirm" | "sending" | "done";

export function WithdrawDialog({ open, onClose, gym, code, wallet, onDone }: { open: boolean; onClose: () => void; gym: ScopeGym; code: string; wallet: WalletView | null; onDone: () => void }) {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const payoutQ = useOnboardingPayout(open);
  const payout = payoutQ.data?.payout;
  // `payout` is only sent to the OWNER (null for other roles). An owner who has not filled it in gets an object with missing fields.
  const savedPayout = registeredPayoutText(payout);
  const payoutMissing = !payoutQ.isLoading && (!!payout ? !savedPayout : false);
  const payoutUnknown = !payoutQ.isLoading && (payoutQ.isError || payout === undefined || payout === null);

  const [phase, setPhase] = useState<Phase>("form");
  const [raw, setRaw] = useState("");
  const [failure, setFailure] = useState<WithdrawFailure | null>(null);
  // After a timeout / 5xx the request may exist: nothing can be sent again from this dialog until it is closed and the list was looked at.
  const [blocked, setBlocked] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const withdraw = useMutation({ mutationFn: (amount: string) => gymService.requestGymWithdrawal(gym.id, amount) });
  const check = checkAmountInput(raw);

  // A fresh dialog every time it opens: nothing typed (and no old refusal) is carried over.
  useEffect(() => {
    if (open) {
      setPhase("form");
      setRaw("");
      setFailure(null);
      setBlocked(false);
      lock.current = false;
    }
  }, [open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const sending = phase === "sending";
  const ambiguous = blocked;

  const send = async () => {
    if (!check.ok || !savedPayout || lock.current || ambiguous) return;
    lock.current = true;
    setFailure(null);
    setPhase("sending");
    try {
      await withdraw.mutateAsync(check.value);
      setPhase("done");
      toast.success("Đã gửi yêu cầu rút tiền");
      refreshAfterWithdrawal(queryClient, scope.userId, gym.id);
      onDone();
      timer.current = setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      const f = withdrawFailure(err);
      setFailure(f);
      // An amount the server refused goes back to the amount box; a payout / permission / ambiguous answer stays on the confirmation.
      setPhase(f.kind === "amount" ? "form" : "confirm");
      shake.shake();
      refreshAfterWithdrawal(queryClient, scope.userId, gym.id);
      // An ambiguous failure keeps the lock: the request may exist.
      if (f.ambiguous) setBlocked(true);
      lock.current = f.ambiguous;
    }
  };

  const close = () => {
    if (sending) return;
    onClose();
  };

  const confirmDisabled = !check.ok || !savedPayout;

  return (
    <GoModal
      open={open}
      onClose={close}
      closeOnEscape={!sending}
      closeOnBackdrop={!sending && phase !== "confirm"}
      initialFocusRef={inputRef}
      testId="go-withdraw-dialog"
      title={phase === "form" ? `Rút tiền từ ${gym.name}` : `Xác nhận rút tiền từ ${gym.name}`}
      description={phase === "form" ? "Yêu cầu chờ Gymini duyệt. Số dư của ví chưa đổi cho tới khi lệnh được duyệt." : "Kiểm lại chi nhánh, số tiền và tài khoản nhận trước khi gửi."}
      footer={
        phase === "form" ? (
          <>
            <button type="button" className="go-btn" onClick={close}>Huỷ</button>
            <button type="button" className="go-btn" data-variant="primary" disabled={confirmDisabled || ambiguous} onClick={() => { setFailure(null); setPhase("confirm"); }} data-testid="go-withdraw-next">Tiếp tục</button>
          </>
        ) : (
          <>
            <button type="button" className="go-btn" onClick={() => { if (!sending && phase !== "done") { setFailure(null); setPhase("form"); } }} disabled={sending || phase === "done" || ambiguous} data-testid="go-withdraw-back">Sửa số tiền</button>
            <button type="button" className="go-btn" data-variant="primary" disabled={confirmDisabled || sending || phase === "done" || ambiguous} onClick={() => void send()} data-testid="gym-withdraw-submit-button">
              <SuccessCheck show={phase === "done"} />
              <TextStates value={sending ? "Đang gửi" : phase === "done" ? "Đã gửi" : "Gửi yêu cầu rút"} />
            </button>
          </>
        )
      }
    >
      <div ref={shake.ref} className="go-form-box" data-error={failure ? "true" : undefined}>
        {failure && (
          <div className="go-notice" data-tone="risk" role="alert" data-testid="go-withdraw-error" data-kind={failure.kind}>
            <span>{failure.text}</span>
            {failure.kind === "payout" && <GoLink to="/gym-owner/profile?section=payout" className="go-btn go-btn-sm" data-testid="gym-withdraw-add-payout-link">Khai báo trong Hồ sơ</GoLink>}
            {failure.ambiguous && <GoLink to={financeHref(gym.id, "withdrawals")} className="go-btn go-btn-sm" onNavigate={onClose} data-testid="go-withdraw-check-list">Mở Lệnh rút</GoLink>}
          </div>
        )}

        <div className="go-wd-branch" data-testid="go-withdraw-branch">
          <span className="go-code-chip" aria-hidden="true">{code}</span>
          <strong>{gym.name}</strong>
        </div>

        {phase === "form" ? (
          <>
            <label className="go-field">
              <span className="go-label">Số tiền (VNĐ)</span>
              <input
                ref={inputRef}
                className="go-input"
                inputMode="numeric"
                autoComplete="off"
                aria-label="Số tiền (VNĐ)"
                aria-invalid={!check.ok && check.error ? true : undefined}
                data-testid="gym-withdraw-amount-input"
                value={raw}
                placeholder="Ví dụ 500000"
                onChange={(e) => { setRaw(e.target.value); setFailure(null); }}
              />
              {!check.ok && check.error ? <span className="go-field-error" role="alert">{check.error}</span> : <span className="go-hint-text">Nhập số đồng nguyên. Máy chủ kiểm tra mức tối thiểu và số có thể rút khi bạn gửi.</span>}
            </label>
            {wallet && (
              <p className="go-hint-text" data-testid="go-withdraw-withdrawable">
                Có thể rút theo máy chủ lúc này: <strong>{formatVND(wallet.withdrawable)}</strong>
              </p>
            )}
          </>
        ) : (
          <dl className="go-confirm-dl" data-testid="go-withdraw-summary">
            <div><dt>Chi nhánh</dt><dd>{gym.name}</dd></div>
            <div><dt>Số tiền</dt><dd data-testid="go-withdraw-confirm-amount">{check.ok ? formatVND(Number(check.value)) : ""}</dd></div>
            <div><dt>Tài khoản nhận</dt><dd style={{ overflowWrap: "anywhere" }} data-testid="go-withdraw-confirm-payout">{savedPayout}</dd></div>
          </dl>
        )}

        {savedPayout ? (
          phase === "form" && (
            <div className="go-payout" data-testid="gym-withdraw-registered-payout">
              <span className="go-hint-text">Chuyển khoản tới tài khoản nhận tiền đã đăng ký</span>
              <p style={{ overflowWrap: "anywhere" }}>{savedPayout}</p>
              <GoLink to="/gym-owner/profile?section=payout" className="go-btn go-btn-sm" onNavigate={onClose} data-testid="gym-withdraw-change-payout-link">Đổi tài khoản trong Hồ sơ đối tác</GoLink>
            </div>
          )
        ) : payoutMissing ? (
          <div className="go-notice" data-tone="warn" data-testid="gym-withdraw-payout-missing">
            <span>Chưa có tài khoản nhận tiền đã đăng ký. Tiền rút luôn được chuyển tới tài khoản này, nên cần khai báo trước.</span>
            <GoLink to="/gym-owner/profile?section=payout" className="go-btn go-btn-sm" onNavigate={onClose} data-testid="gym-withdraw-add-payout-link-2">Khai báo trong Hồ sơ đối tác</GoLink>
          </div>
        ) : payoutQ.isLoading ? (
          <p className="go-hint-text" data-testid="go-withdraw-payout-loading">Đang tải tài khoản nhận tiền đã đăng ký.</p>
        ) : payoutUnknown ? (
          <div className="go-notice" data-tone="risk" role="alert" data-testid="go-withdraw-payout-error">
            <span>Chưa đọc được tài khoản nhận tiền đã đăng ký, nên chưa gửi yêu cầu được.</span>
            <button type="button" className="go-btn go-btn-sm" onClick={() => void payoutQ.refetch()}>Thử lại</button>
          </div>
        ) : null}
      </div>
    </GoModal>
  );
}
