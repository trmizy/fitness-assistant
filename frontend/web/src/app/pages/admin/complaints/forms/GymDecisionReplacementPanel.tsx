import { useState } from "react";
import { gymCaseApi } from "../gymCaseApi";
import type { FormProps } from "./formTypes";
import { CARD, EmptyBox, Muted, Notice, Pill } from "../GymParts";
import {
  ActionButton,
  ButtonRow,
  Check,
  ConfirmModal,
  ErrorBox,
  Field,
  TextArea,
  useWrite,
} from "../../disputes/actions/actionKit";
import {
  APPROVE_REPLACEMENT_CONFIRM,
  PROPOSE_REPLACEMENT_CONFIRM,
  REJECT_REPLACEMENT_CONFIRM,
  validateReplacementReason,
} from "../../disputes/actions/replacementModel";
import { actionOf } from "../gymCaseModel";

export function GymDecisionReplacementPanel({
  detail,
  currentUserId: _currentUserId,
  onChanged,
}: FormProps) {
  const caseId = detail.case.id;

  const proposeAction = actionOf(detail, "PROPOSE_DECISION_REPLACEMENT");
  const approveAction = actionOf(detail, "APPROVE_DECISION_REPLACEMENT");
  const rejectAction = actionOf(detail, "REJECT_DECISION_REPLACEMENT");

  const [proposeReason, setProposeReason] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeConfirmOpen, setProposeConfirmOpen] = useState(false);

  const [decideReason, setDecideReason] = useState("");
  const [coiChecked, setCoiChecked] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [decideAction, setDecideAction] = useState<"APPROVE" | "REJECT" | null>(null);
  const [decideConfirmOpen, setDecideConfirmOpen] = useState(false);

  const proposeWrite = useWrite<{ reason: string }, unknown>(onChanged);
  const decideWrite = useWrite<
    { reason: string; conflictOfInterestDeclaredNone?: boolean },
    unknown
  >(onChanged);

  // Only show if the case has had an approved decision or can propose/decide
  if (
    detail.case.status !== "DECISION_APPROVED" &&
    !proposeAction.allowed &&
    !approveAction.allowed &&
    !rejectAction.allowed
  ) {
    return null;
  }

  const existingReplacement = detail.replacement;

  const isPending = existingReplacement?.status === "PENDING" || approveAction.allowed || rejectAction.allowed;

  const handleOpenPropose = () => {
    const val = validateReplacementReason(proposeReason);
    if (!val.ok) {
      setProposeError(val.message ?? "Lý do không hợp lệ.");
      return;
    }
    setProposeError(null);
    setProposeConfirmOpen(true);
  };

  const handleProposeSubmit = async () => {
    const res = await proposeWrite.submit(
      { reason: proposeReason.trim() },
      (key, b) => gymCaseApi.proposeReplacement(caseId, b, key),
    );
    if (res.ok) {
      setProposeConfirmOpen(false);
      setProposeReason("");
      await onChanged();
    }
  };

  const handleOpenDecide = (action: "APPROVE" | "REJECT") => {
    const val = validateReplacementReason(decideReason);
    if (!val.ok) {
      setDecideError(val.message ?? "Lý do không hợp lệ.");
      return;
    }
    if (action === "APPROVE" && !coiChecked) {
      setDecideError("Vui lòng xác nhận không có xung đột lợi ích.");
      return;
    }
    setDecideError(null);
    setDecideAction(action);
    setDecideConfirmOpen(true);
  };

  const handleDecideSubmit = async () => {
    if (!decideAction) return;

    if (decideAction === "APPROVE") {
      const res = await decideWrite.submit(
        {
          reason: decideReason.trim(),
          conflictOfInterestDeclaredNone: true,
        },
        (key, b) => gymCaseApi.approveReplacement(caseId, { reason: b.reason, conflictOfInterestDeclaredNone: true }, key),
      );
      if (res.ok) {
        setDecideConfirmOpen(false);
        setDecideReason("");
        setCoiChecked(false);
        await onChanged();
      }
    } else {
      // Reject takes ONLY reason, NO COI checkbox (schemas.ts:88)
      const res = await decideWrite.submit(
        { reason: decideReason.trim() },
        (key, b) => gymCaseApi.rejectReplacement(caseId, { reason: b.reason }, key),
      );
      if (res.ok) {
        setDecideConfirmOpen(false);
        setDecideReason("");
        setCoiChecked(false);
        await onChanged();
      }
    }
  };

  return (
    <section
      className={`${CARD} space-y-4 p-4`}
      data-testid="gym-decision-replacement-panel"
      aria-label="Thay quyết định đã duyệt phòng gym"
    >
      <div>
        <h3 className="text-base font-semibold text-adm-text">
          Thay quyết định đã duyệt
        </h3>
        <Muted>
          Khi phát hiện chứng cứ mới hoặc có sai sót, điều tra viên có thể đề
          xuất thay quyết định. Duyệt thay quyết định đòi hỏi nguyên tắc bốn mắt
          và không tự chuyển tiền.
        </Muted>
      </div>

      {/* Existing replacement status */}
      {existingReplacement ? (
        <div className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-adm-text">Đề xuất gần nhất:</span>
            <Pill
              tone={
                existingReplacement.status === "APPROVED"
                  ? "success"
                  : existingReplacement.status === "REJECTED"
                  ? "danger"
                  : "warning"
              }
            >
              {existingReplacement.status === "APPROVED"
                ? "Đã duyệt thay"
                : existingReplacement.status === "REJECTED"
                ? "Đã bác"
                : "Đang chờ duyệt"}
            </Pill>
          </div>

          {existingReplacement.reason && (
            <p className="text-adm-text">
              Lý do đề xuất: {existingReplacement.reason}
            </p>
          )}

          {existingReplacement.proposedBy && (
            <p className="text-xs text-adm-text-2">
              Đề xuất bởi mã {existingReplacement.proposedBy} lúc{" "}
              {existingReplacement.proposedAt
                ? new Date(existingReplacement.proposedAt).toLocaleString("vi-VN")
                : "chưa rõ"}
            </p>
          )}

          {existingReplacement.approvedAt && (
            <p className="text-xs text-st-success">
              Đã duyệt thay bởi mã {existingReplacement.approvedBy} lúc{" "}
              {new Date(existingReplacement.approvedAt).toLocaleString("vi-VN")}
            </p>
          )}

          {existingReplacement.rejectedAt && (
            <p className="text-xs text-st-danger">
              Đã bác bởi mã {existingReplacement.rejectedBy} lúc{" "}
              {new Date(existingReplacement.rejectedAt).toLocaleString("vi-VN")}
            </p>
          )}
        </div>
      ) : (
        <EmptyBox testId="gym-replacement-empty">
          Chưa có đề xuất thay quyết định nào.
        </EmptyBox>
      )}

      {/* Approve / Reject actions for other admins when pending */}
      {isPending && (approveAction.allowed || rejectAction.allowed) && (
        <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
          <h4 className="text-sm font-semibold text-adm-text">
            Xử lý đề xuất thay thế (Bốn mắt)
          </h4>

          <Field id="gym-decide-reason" label="Lý do xử lý" required>
            <TextArea
              id="gym-decide-reason"
              rows={2}
              value={decideReason}
              onChange={(v) => {
                setDecideReason(v);
                setDecideError(null);
              }}
              placeholder="Nêu rõ lý do duyệt thay thế hoặc bác đề xuất..."
            />
          </Field>

          {approveAction.allowed && (
            <Check
              id="gym-replacement-coi"
              checked={coiChecked}
              onChange={(v) => {
                setCoiChecked(v);
                setDecideError(null);
              }}
              label="Tôi cam kết không có xung đột lợi ích với vụ việc này."
            />
          )}

          {decideError && <Notice tone="danger">{decideError}</Notice>}
          {decideWrite.error && (
            <ErrorBox
              error={decideWrite.error}
              mustReload={decideWrite.mustReload}
              reloading={decideWrite.reloading}
              onReload={decideWrite.reload}
              onRetry={decideWrite.retry}
              pending={decideWrite.pending}
            />
          )}

          <ButtonRow>
            {approveAction.allowed && (
              <ActionButton
                variant="primary"
                onClick={() => handleOpenDecide("APPROVE")}
                disabled={!coiChecked || decideWrite.pending}
                pending={decideWrite.pending && decideAction === "APPROVE"}
              >
                Duyệt thay quyết định
              </ActionButton>
            )}

            {rejectAction.allowed && (
              <ActionButton
                variant="danger"
                onClick={() => handleOpenDecide("REJECT")}
                disabled={decideWrite.pending}
                pending={decideWrite.pending && decideAction === "REJECT"}
              >
                Bác đề xuất
              </ActionButton>
            )}
          </ButtonRow>
        </div>
      )}

      {/* Propose form */}
      {proposeAction.allowed && !isPending && (
        <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
          <h4 className="text-sm font-semibold text-adm-text">
            Đề xuất thay quyết định đã duyệt
          </h4>

          <Field id="gym-propose-reason" label="Lý do đề xuất thay thế" required>
            <TextArea
              id="gym-propose-reason"
              rows={3}
              value={proposeReason}
              onChange={(v) => {
                setProposeReason(v);
                setProposeError(null);
              }}
              placeholder="Nêu rõ lý do cần thay thế quyết định đã duyệt..."
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
              variant="primary"
              onClick={handleOpenPropose}
              disabled={proposeWrite.pending || !proposeReason.trim()}
              pending={proposeWrite.pending}
            >
              Gửi đề xuất thay thế
            </ActionButton>
          </ButtonRow>
        </div>
      )}

      {/* Propose confirm modal */}
      <ConfirmModal
        open={proposeConfirmOpen}
        onClose={() => setProposeConfirmOpen(false)}
        title="Xác nhận gửi đề xuất thay quyết định"
        notice={PROPOSE_REPLACEMENT_CONFIRM}
        confirmLabel="Xác nhận đề xuất"
        pendingLabel="Đang gửi..."
        pending={proposeWrite.pending}
        onConfirm={handleProposeSubmit}
        testId="confirm-gym-propose"
      />

      {/* Decide confirm modal */}
      <ConfirmModal
        open={decideConfirmOpen}
        onClose={() => setDecideConfirmOpen(false)}
        title={
          decideAction === "APPROVE"
            ? "Xác nhận duyệt thay quyết định"
            : "Xác nhận bác đề xuất thay quyết định"
        }
        notice={
          decideAction === "APPROVE"
            ? APPROVE_REPLACEMENT_CONFIRM
            : REJECT_REPLACEMENT_CONFIRM
        }
        danger={decideAction === "APPROVE"}
        confirmLabel={
          decideAction === "APPROVE" ? "Duyệt thay quyết định" : "Bác đề xuất"
        }
        pendingLabel="Đang gửi..."
        pending={decideWrite.pending}
        onConfirm={handleDecideSubmit}
        testId="confirm-gym-decide"
      />
    </section>
  );
}
