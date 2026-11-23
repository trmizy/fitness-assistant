/**
 * Tab "Trạng thái" of the branch detail (batch G2): temporary close / reopen (OWNER, MANAGER: `branch.status.temporary`) and
 * permanent close (OWNER only, with the existing closure-impact screen). Same service call and payload as the legacy panel
 * (gymService.setGymOperationalStatus(id, status, reason, expectedReopenAt)); each action now asks in a dialog (06 modal).
 *
 * Honesty: the success check (10) shows only after the server answered 2xx; a refusal (409 / 403 ...) keeps the dialog open and
 * shows the server's own Vietnamese sentence with a shake (12) - nothing is closed optimistically. The submit label swaps
 * through 04 text-states-swap. A role that cannot do an action sees it disabled with the reason, never a button that returns 403.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockIcon as Lock, LockOpenIcon as Unlock, WarningIcon as AlertTriangle, CircleNotchIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Gym } from "../../../types";
import { formatVND } from "../../../utils/currency";
import { formatViDate } from "../../../utils/branchCheckinState";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { apiMessage, approvalTag, closeDialogProblem, operationalTag, statusActionsFor, type ClosureMode } from "./branchesModel";
import { useSetOperationalStatus } from "./useBranchMutations";

type Phase = "idle" | "pending" | "success" | "error";

export function StatusTab({ gym }: { gym: Gym }) {
  const { can } = useGymOwnerScope();
  const actions = statusActionsFor(can);
  // `mode` null = dialog closed; `shown` keeps the last mode so the dialog keeps its content while it animates out, and
  // `openCount` remounts the dialog on every open so a new dialog never inherits the previous reason / error.
  const [mode, setModeRaw] = useState<ClosureMode | null>(null);
  const [shown, setShown] = useState<ClosureMode>("TEMPORARILY_CLOSED");
  const [openCount, setOpenCount] = useState(0);
  const setMode = (next: ClosureMode | null) => {
    if (next) {
      setShown(next);
      setOpenCount((c) => c + 1);
    }
    setModeRaw(next);
  };
  const op = operationalTag(gym);
  const ap = approvalTag(gym.status);
  const permanentlyClosed = gym.operationalStatus === "PERMANENTLY_CLOSED";
  const temporarilyClosed = gym.operationalStatus === "TEMPORARILY_CLOSED";

  return (
    <div className="go-stack" data-testid="go-branch-status">
      <section className="go-card" aria-labelledby="go-h-state">
        <div className="go-card-head"><h2 id="go-h-state">Trạng thái hiện tại</h2></div>
        <dl className="go-dl">
          <div><dt>Duyệt hồ sơ</dt><dd><GoTag tone={ap.tone} text={ap.text} /></dd></div>
          <div>
            <dt>Vận hành</dt>
            <dd>
              <GoTag tone={op.tone} text={op.text} />
              {gym.closureReason && gym.operationalStatus && gym.operationalStatus !== "OPEN" ? <span className="go-dd-sub">Lý do: {gym.closureReason}</span> : null}
              {temporarilyClosed && gym.expectedReopenAt ? <span className="go-dd-sub">Dự kiến mở lại: {formatViDate(gym.expectedReopenAt)}</span> : null}
            </dd>
          </div>
        </dl>
        {gym.status === "SUSPENDED" && (
          <div role="status" data-testid="gym-admin-suspended" className="go-note" data-tone="warn">
            <AlertTriangle aria-hidden="true" width={16} height={16} />
            <div>
              <strong>Đang bị tạm khoá trên Gymini</strong>
              {gym.adminSuspensionReason && <p>Lý do: {gym.adminSuspensionReason}</p>}
              <p>Chi nhánh tạm ẩn khỏi tìm kiếm và không bán gói mới. Hội viên đang có gói vẫn check-in bình thường tới hết hạn.</p>
            </div>
          </div>
        )}
      </section>

      <section className="go-card" aria-labelledby="go-h-ops">
        <div className="go-card-head"><h2 id="go-h-ops">Đóng và mở cửa</h2></div>
        {permanentlyClosed ? (
          <p className="go-card-note" role="status">Chi nhánh đã đóng cửa vĩnh viễn, không thể đổi trạng thái nữa.</p>
        ) : (
          <div className="go-ops">
            {temporarilyClosed ? (
              <div className="go-op">
                <div>
                  <strong>Mở lại chi nhánh</strong>
                  <p>Chi nhánh nhận check-in bằng mã QR trở lại.</p>
                </div>
                <button type="button" className="go-btn go-btn-sm" data-variant="primary" data-testid="gym-reopen-button" disabled={!actions.canTemporary} onClick={() => setMode("OPEN")}>
                  <Unlock aria-hidden="true" width={14} height={14} /> Mở lại
                </button>
              </div>
            ) : (
              <div className="go-op">
                <div>
                  <strong>Tạm đóng cửa</strong>
                  <p>Dừng nhận check-in trong một thời gian. Bạn mở lại được bất kỳ lúc nào.</p>
                </div>
                <button type="button" className="go-btn go-btn-sm" data-tone="warn" data-testid="gym-temporarily-close-toggle" disabled={!actions.canTemporary} onClick={() => setMode("TEMPORARILY_CLOSED")}>
                  <Lock aria-hidden="true" width={14} height={14} /> Tạm đóng cửa
                </button>
              </div>
            )}
            <div className="go-op" data-danger="true">
              <div>
                <strong>Đóng cửa vĩnh viễn</strong>
                <p>Không thể hoàn tác. Bạn sẽ xem tác động đến hội viên, hợp tác PT và số dư ví trước khi xác nhận.</p>
                {!actions.canPermanent && actions.permanentReason && <p className="go-op-reason" data-testid="go-permanent-reason">{actions.permanentReason}</p>}
              </div>
              <button type="button" className="go-btn go-btn-sm" data-tone="risk" data-testid="gym-permanently-close-toggle" disabled={!actions.canPermanent} onClick={() => setMode("PERMANENTLY_CLOSED")}>
                <Lock aria-hidden="true" width={14} height={14} /> Đóng cửa vĩnh viễn
              </button>
            </div>
          </div>
        )}
      </section>

      <StatusDialog key={openCount} gym={gym} open={mode !== null} mode={shown} canPermanent={actions.canPermanent} onClose={() => setMode(null)} />
    </div>
  );
}

function StatusDialog({ gym, open, mode, canPermanent, onClose }: { gym: Gym; open: boolean; mode: ClosureMode; canPermanent: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [reopenDate, setReopenDate] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetOperationalStatus(gym.id);
  const { ref: boxRef, shake } = useShake<HTMLDivElement>();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // GET closure-impact is owner-only: fetched only once the owner opens the permanent-close dialog (as the legacy panel did).
  const impactQ = useQuery({
    queryKey: ["owned-gym-closure-impact", gym.id],
    queryFn: () => gymService.getClosureImpact(gym.id),
    enabled: open && mode === "PERMANENTLY_CLOSED" && canPermanent,
  });

  const m: ClosureMode = mode;
  const busy = phase === "pending";
  const done = phase === "success";
  const needsReason = m !== "OPEN";
  const problem = closeDialogProblem(m, reason);

  async function confirm() {
    if (problem) {
      setError(problem);
      setPhase("error");
      shake();
      return;
    }
    setError(null);
    setPhase("pending");
    try {
      await mutation.mutateAsync({
        operationalStatus: m,
        ...(m === "OPEN" ? {} : { reason }),
        ...(m === "TEMPORARILY_CLOSED" && reopenDate ? { expectedReopenAt: reopenDate } : {}),
      });
      setPhase("success"); // 2xx only
      closeTimer.current = setTimeout(onClose, 1100);
    } catch (err) {
      setError(apiMessage(err, "Không thể cập nhật trạng thái chi nhánh."));
      setPhase("error");
      shake();
    }
  }

  const title = m === "TEMPORARILY_CLOSED" ? "Tạm đóng cửa chi nhánh?" : m === "PERMANENTLY_CLOSED" ? "Đóng cửa vĩnh viễn chi nhánh?" : "Mở lại chi nhánh?";
  const confirmLabel = m === "TEMPORARILY_CLOSED" ? "Xác nhận tạm đóng cửa" : m === "PERMANENTLY_CLOSED" ? "Xác nhận đóng cửa vĩnh viễn" : "Xác nhận mở lại";
  const label = busy ? "Đang gửi" : done ? "Đã cập nhật" : confirmLabel;

  return (
    <GoModal
      open={open}
      onClose={onClose}
      title={title}
      tone={m === "PERMANENTLY_CLOSED" ? "risk" : "default"}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      initialFocusRef={needsReason ? reasonRef : undefined}
      testId="go-status-dialog"
      description={
        m === "TEMPORARILY_CLOSED"
          ? "Trong lúc tạm đóng, chi nhánh không nhận check-in bằng mã QR. Bạn mở lại được bất kỳ lúc nào; ngày dự kiến chỉ để thông báo, chi nhánh không tự mở lại."
          : m === "OPEN"
            ? "Chi nhánh sẽ nhận check-in bằng mã QR trở lại."
            : undefined
      }
      footer={
        <>
          <button type="button" className="go-btn" onClick={onClose} disabled={busy}>{done ? "Đóng" : "Huỷ"}</button>
          <button
            type="button"
            className="go-btn"
            data-variant={m === "PERMANENTLY_CLOSED" ? "danger" : "primary"}
            data-testid="gym-confirm-close-button"
            onClick={() => void confirm()}
            disabled={busy || done || (needsReason && !reason.trim())}
          >
            <SuccessCheck show={done} size={16} />
            <TextStates value={label} />
          </button>
        </>
      }
    >
      <div className="go-form" ref={boxRef} data-error={error ? "true" : undefined}>
        {m === "PERMANENTLY_CLOSED" && (
          <div data-testid="gym-closure-impact-summary" className="go-impact">
            <p className="go-impact-title"><AlertTriangle aria-hidden="true" width={14} height={14} /> Ảnh hưởng khi đóng cửa vĩnh viễn</p>
            {impactQ.isLoading ? (
              <CircleNotchIcon className="go-spin" aria-label="Đang tải tác động" width={16} height={16} />
            ) : impactQ.data ? (
              <ul>
                <li>
                  <strong>{impactQ.data.activeMembers}</strong> hội viên đang có gói hiệu lực
                  {impactQ.data.unusedValueTotal > 0 && <>, tổng giá trị chưa dùng ước tính <strong>{formatVND(impactQ.data.unusedValueTotal)}</strong></>}
                </li>
                <li><strong>{impactQ.data.activeCollaborations}</strong> thỏa thuận hợp tác PT đang áp dụng cho chi nhánh này</li>
                <li>Số dư ví hiện tại: <strong>{formatVND(impactQ.data.walletBalance)}</strong></li>
              </ul>
            ) : (
              <p>Không thể tải số liệu ảnh hưởng, bạn vẫn có thể tiếp tục.</p>
            )}
            <p className="go-muted-text">Hành động này không thể hoàn tác. Hội viên đang hoạt động sẽ được Gymini xem xét hoàn tiền riêng, không tự động ngay lúc này.</p>
          </div>
        )}
        {needsReason && (
          <label className="go-field">
            <span className="go-label">Lý do đóng cửa</span>
            <textarea
              ref={reasonRef}
              data-testid="gym-close-reason-input"
              className="go-input go-textarea"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (phase === "error") {
                  setPhase("idle");
                  setError(null);
                }
              }}
              placeholder="Lý do đóng cửa..."
              rows={3}
              aria-invalid={error && !reason.trim() ? true : undefined}
              disabled={busy || done}
            />
          </label>
        )}
        {m === "TEMPORARILY_CLOSED" && (
          <label className="go-field">
            <span className="go-label">Ngày dự kiến mở lại (không bắt buộc)</span>
            <input
              type="date"
              data-testid="gym-close-reopen-date-input"
              className="go-input"
              value={reopenDate}
              onChange={(e) => setReopenDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              disabled={busy || done}
            />
          </label>
        )}
        {error && <p className="go-error" role="alert" data-testid="go-status-error">{error}</p>}
      </div>
    </GoModal>
  );
}
