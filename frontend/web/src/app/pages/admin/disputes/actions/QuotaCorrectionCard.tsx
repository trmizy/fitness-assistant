import { useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import type { AppealConsequence, QuotaCorrection } from "../disputeCaseTypes";
import {
  ActionButton,
  ButtonRow,
  ConfirmModal,
  ErrorBox,
  Field,
  TextArea,
  useWrite,
} from "./actionKit";
import { Notice } from "../workspace/WorkspaceParts";
import { shortRef } from "../workspace/format";
import {
  APPROVE_QUOTA_CONFIRM,
  PROPOSE_QUOTA_CONFIRM,
  quotaDelta,
  quotaHistoryLine,
  quotaSentence,
  type QuotaDirection,
} from "../workspace/quotaCorrectionModel";

interface QuotaCorrectionCardProps {
  caseId: string;
  consequence: AppealConsequence;
  currentUserId?: string | null;
  onChanged: () => void | Promise<unknown>;
  appealsCapability: boolean;
}

export function QuotaCorrectionCard({
  caseId,
  consequence,
  currentUserId,
  onChanged,
  appealsCapability,
}: QuotaCorrectionCardProps) {
  const pendingCorr = (consequence.quotaCorrections ?? []).find(
    (q: QuotaCorrection) => !q.appliedAt,
  );
  const appliedCorrs = (consequence.quotaCorrections ?? []).filter(
    (q: QuotaCorrection) => Boolean(q.appliedAt),
  );

  // Propose state
  const [openPropose, setOpenPropose] = useState(false);
  const [direction, setDirection] = useState<QuotaDirection | "">("");
  const [countStr, setCountStr] = useState("");
  const [proposeReason, setProposeReason] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeConfirmOpen, setProposeConfirmOpen] = useState(false);
  const [serverNotice, setServerNotice] = useState<string | null>(null);

  // Approve state
  const [openApprove, setOpenApprove] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [coiDeclared, setCoiDeclared] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

  const proposeWrite = useWrite<
    { delta: number; reason: string },
    { correctionId: string; delta: number; usedSessions: number; totalSessions: number }
  >(onChanged);

  const approveWrite = useWrite<
    { reason: string; conflictOfInterestDeclaredNone: boolean },
    unknown
  >(onChanged);

  if (!appealsCapability) {
    return (
      <p className="text-xs text-adm-text-2">
        Chức năng hiệu chỉnh buổi đang tắt ở môi trường hiện tại.
      </p>
    );
  }

  const computedDelta = quotaDelta(direction, countStr);

  const handleProposeSubmit = async () => {
    if (!computedDelta.ok || typeof computedDelta.delta !== "number") return;
    const delta = computedDelta.delta;
    const res = await proposeWrite.submit(
      { delta, reason: proposeReason.trim() },
      (key, body) => disputeCaseApi.proposeQuotaCorrection(caseId, consequence.id, body, key),
    );
    if (res.ok) {
      setProposeConfirmOpen(false);
      setOpenPropose(false);
      setDirection("");
      setCountStr("");
      setProposeReason("");
      const used = res.value.usedSessions;
      const total = res.value.totalSessions;
      const nextUsed = used + delta;
      setServerNotice(
        `Hợp đồng hiện đã dùng ${used}/${total} buổi. Nếu được duyệt: ${nextUsed}/${total} buổi.`,
      );
      await onChanged();
    }
  };

  const handleApproveSubmit = async () => {
    if (!pendingCorr) return;
    const res = await approveWrite.submit(
      { reason: approveReason.trim(), conflictOfInterestDeclaredNone: true },
      (key, body) =>
        disputeCaseApi.approveQuotaCorrection(caseId, pendingCorr.id, body, key),
    );
    if (res.ok) {
      setApproveConfirmOpen(false);
      setOpenApprove(false);
      setApproveReason("");
      setCoiDeclared(false);
      await onChanged();
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t border-adm-border-soft pt-2 text-xs">
      {serverNotice && <Notice tone="info">{serverNotice}</Notice>}

      {/* Applied history */}
      {appliedCorrs.length > 0 && (
        <div className="space-y-1 rounded border border-adm-border-soft bg-adm-surface-2 p-2">
          <p className="font-semibold text-adm-text">Lịch sử hiệu chỉnh buổi:</p>
          <ul className="space-y-1">
            {appliedCorrs.map((q) => (
              <li key={q.id} className="text-adm-text-2">
                {quotaHistoryLine(q)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* RESOLVED (approval applies and closes the consequence): history only, no more actions (07/11) */}
      {consequence.status !== "OPEN" ? null : pendingCorr ? (
        <div className="space-y-2 rounded border border-adm-border bg-adm-surface p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-adm-text">
              Đề xuất hiệu chỉnh đang chờ duyệt:
            </span>
            <span className="font-medium text-adm-text">
              {quotaSentence(pendingCorr.delta)}
            </span>
          </div>
          <p className="text-adm-text-2">
            Lý do: <span className="text-adm-text">{pendingCorr.reason}</span>
          </p>
          {pendingCorr.proposedBy && (
            <p className="text-adm-text-2">
              Đề xuất bởi{" "}
              {pendingCorr.proposedBy === currentUserId
                ? "bạn"
                : shortRef(pendingCorr.proposedBy)}
            </p>
          )}

          {currentUserId && pendingCorr.proposedBy !== currentUserId ? (
            <div className="space-y-2 pt-1">
              {!openApprove ? (
                <ActionButton
                  variant="primary"
                  onClick={() => setOpenApprove(true)}
                >
                  Phê duyệt hiệu chỉnh buổi
                </ActionButton>
              ) : (
                <div className="space-y-2 border-t border-adm-border-soft pt-2">
                  <Field id="approve-quota-reason" label="Lý do phê duyệt" required>
                    <TextArea
                      id="approve-quota-reason"
                      rows={2}
                      value={approveReason}
                      onChange={(v) => {
                        setApproveReason(v);
                        setApproveError(null);
                      }}
                      placeholder="Nêu căn cứ phê duyệt hiệu chỉnh..."
                    />
                  </Field>

                  <label className="flex items-start gap-2 pt-1 text-xs text-adm-text">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-adm-border"
                      checked={coiDeclared}
                      onChange={(e) => setCoiDeclared(e.target.checked)}
                    />
                    <span>
                      Tôi xác nhận không có xung đột lợi ích đối với hồ sơ này.
                    </span>
                  </label>

                  {approveError && <Notice tone="danger">{approveError}</Notice>}
                  {approveWrite.error && (
                    <ErrorBox
                      error={approveWrite.error}
                      mustReload={approveWrite.mustReload}
                      reloading={approveWrite.reloading}
                      onReload={approveWrite.reload}
                      onRetry={approveWrite.retry}
                      pending={approveWrite.pending}
                    />
                  )}

                  <ButtonRow>
                    <ActionButton
                      variant="outline"
                      onClick={() => setOpenApprove(false)}
                      disabled={approveWrite.pending}
                    >
                      Huỷ
                    </ActionButton>
                    <ActionButton
                      variant="primary"
                      onClick={() => {
                        if (!approveReason.trim()) {
                          setApproveError("Vui lòng nhập lý do phê duyệt.");
                          return;
                        }
                        if (!coiDeclared) {
                          setApproveError("Vui lòng xác nhận không có xung đột lợi ích.");
                          return;
                        }
                        setApproveError(null);
                        setApproveConfirmOpen(true);
                      }}
                      disabled={approveWrite.pending || !approveReason.trim() || !coiDeclared}
                      pending={approveWrite.pending}
                    >
                      Xác nhận duyệt hiệu chỉnh
                    </ActionButton>
                  </ButtonRow>
                </div>
              )}
            </div>
          ) : (
            <p className="italic text-adm-text-2">
              Đang chờ một quản trị viên khác duyệt (nguyên tắc bốn mắt).
            </p>
          )}
        </div>
      ) : (
        <div>
          {!openPropose ? (
            <ActionButton
              variant="outline"
              onClick={() => {
                setOpenPropose(true);
                setDirection("");
                setCountStr("");
                setProposeReason("");
                setProposeError(null);
              }}
            >
              Đề xuất hiệu chỉnh buổi tập
            </ActionButton>
          ) : (
            <div className="space-y-2 rounded border border-adm-border bg-adm-surface p-2.5">
              <h5 className="font-semibold text-adm-text">
                Đề xuất hiệu chỉnh buổi tập
              </h5>

              {/* Direction selector: required radio, no default */}
              <div className="space-y-1">
                <p className="font-medium text-adm-text">
                  Hướng hiệu chỉnh: <span className="text-adm-danger">*</span>
                </p>
                <div className="space-y-1 pl-1">
                  <label className="flex items-center gap-2 text-adm-text">
                    <input
                      type="radio"
                      name="quota-direction"
                      value="give_back"
                      checked={direction === "give_back"}
                      onChange={() => {
                        setDirection("give_back");
                        setProposeError(null);
                      }}
                    />
                    <span>Trả lại buổi cho khách (giảm số buổi đã dùng)</span>
                  </label>
                  <label className="flex items-center gap-2 text-adm-text">
                    <input
                      type="radio"
                      name="quota-direction"
                      value="charge"
                      checked={direction === "charge"}
                      onChange={() => {
                        setDirection("charge");
                        setProposeError(null);
                      }}
                    />
                    <span>Tính thêm buổi đã dùng (khách còn ít buổi hơn)</span>
                  </label>
                </div>
              </div>

              {/* Count input: 1..100, empty by default */}
              <Field id="quota-count" label="Số buổi" required>
                <input
                  id="quota-count"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="Nhập số buổi (1 - 100)"
                  className="block w-full rounded border border-adm-border bg-adm-surface px-2.5 py-1 text-xs text-adm-text"
                  value={countStr}
                  onChange={(e) => {
                    setCountStr(e.target.value);
                    setProposeError(null);
                  }}
                />
              </Field>

              <Field id="quota-reason" label="Lý do hiệu chỉnh" required>
                <TextArea
                  id="quota-reason"
                  rows={2}
                  value={proposeReason}
                  onChange={(v) => {
                    setProposeReason(v);
                    setProposeError(null);
                  }}
                  placeholder="Nêu lý do tăng hoặc giảm buổi tập..."
                />
              </Field>

              {proposeError && <Notice tone="danger">{proposeError}</Notice>}
              {proposeWrite.error && (
                <ErrorBox
                  error={proposeWrite.error}
                  mustReload={proposeWrite.mustReload}
                  reloading={proposeWrite.reloading}
                  onReload={proposeWrite.reload}
                  onRetry={proposeWrite.retry}
                  pending={proposeWrite.pending}
                />
              )}

              <ButtonRow>
                <ActionButton
                  variant="outline"
                  onClick={() => setOpenPropose(false)}
                  disabled={proposeWrite.pending}
                >
                  Huỷ
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={() => {
                    const val = quotaDelta(direction, countStr);
                    if (!val.ok || typeof val.delta !== "number") {
                      setProposeError(val.error ?? "Dữ liệu chưa hợp lệ.");
                      return;
                    }
                    if (!proposeReason.trim()) {
                      setProposeError("Vui lòng nhập lý do hiệu chỉnh.");
                      return;
                    }
                    setProposeError(null);
                    setProposeConfirmOpen(true);
                  }}
                  disabled={proposeWrite.pending || !direction || !countStr || !proposeReason.trim()}
                  pending={proposeWrite.pending}
                >
                  Gửi đề xuất hiệu chỉnh
                </ActionButton>
              </ButtonRow>
            </div>
          )}
        </div>
      )}

      {/* Propose confirm modal */}
      <ConfirmModal
        open={proposeConfirmOpen}
        onClose={() => setProposeConfirmOpen(false)}
        title="Xác nhận đề xuất hiệu chỉnh buổi"
        notice={
          computedDelta.ok && typeof computedDelta.delta === "number"
            ? `${PROPOSE_QUOTA_CONFIRM} Thao tác: ${quotaSentence(computedDelta.delta)}.`
            : PROPOSE_QUOTA_CONFIRM
        }
        confirmLabel="Gửi đề xuất"
        pendingLabel="Đang gửi..."
        pending={proposeWrite.pending}
        onConfirm={handleProposeSubmit}
        testId="confirm-propose-quota"
      />

      {/* Approve confirm modal */}
      {pendingCorr && (
        <ConfirmModal
          open={approveConfirmOpen}
          onClose={() => setApproveConfirmOpen(false)}
          title="Xác nhận phê duyệt hiệu chỉnh buổi"
          notice={`${APPROVE_QUOTA_CONFIRM} Thao tác: ${quotaSentence(pendingCorr.delta)}.`}
          confirmLabel="Phê duyệt hiệu chỉnh"
          pendingLabel="Đang gửi..."
          pending={approveWrite.pending}
          onConfirm={handleApproveSubmit}
          testId="confirm-approve-quota"
        />
      )}
    </div>
  );
}
