/**
 * D3 - Approvals slot, four-eyes decision (A14, handoff M3).
 * Shown only while AWAITING_APPROVAL and only to an admin who is neither the proposer nor the investigator (an unknown client/PT can not be
 * checked here: the server refuses and the form shows why). A read-only summary comes first (finding, outcome, consequence, "approved
 * but can not run yet" banner); the form has a reason (required even to approve), the conflict-of-interest declaration (must be ticked to
 * send) and, only after the server asked for it, the evidence-change acknowledgement. Approve / reject go through a two-step confirm.
 * There is no undo button, no execute button, no money control.
 */
import { useEffect, useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { APPROVAL_RESULT_LABEL } from "../disputeCaseLabels";
import type { DecideResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { blockedText } from "../workspace/workspaceModel";
import { ActionButton, ActionGroup, ButtonRow, Check, ConfirmModal, ErrorBox, Field, MutedLine, ResultNote, TextArea, counter, useCloseOnResult, useWrite } from "./actionKit";
import {
  LIMITS,
  approvalBody,
  approvalSummary,
  decideGate,
  evidenceChangeBranch,
  hasErrors,
  validateApproval,
  type ApprovalForm,
  type Errors,
  type EvidenceChangeBranch,
} from "./actionModel";
import {
  ACK_THEN_TICK_NOTE,
  APPROVED_DONE,
  APPROVED_DONE_HELP,
  APPROVER_PARTY_UNKNOWN_NOTE,
  COI_HELP,
  COI_LABEL,
  CONFIRM_APPROVE,
  CONFIRM_REJECT_PROPOSAL,
  EVIDENCE_ACK_LABEL,
  RECOLLECT_FIRST_NOTE,
  REJECTED_DONE,
} from "./actionText";

interface Done {
  result: "APPROVED" | "REJECTED";
  blocked: string | null;
}

function Summary({ detail }: Pick<ActionSlotProps, "detail">) {
  const s = approvalSummary(detail);
  if (!s) return null;
  return (
    <section aria-label="Quyết định cần duyệt" data-testid="d3-approval-summary" className="space-y-2 rounded-xl border border-adm-border bg-adm-surface-2 p-4 text-sm">
      <p className="text-xs font-semibold text-adm-text-2">Bạn đang duyệt (chỉ đọc, không sửa được)</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-adm-text-2">Kết luận</dt>
          <dd className="font-medium text-adm-text" data-testid="d3-sum-finding">
            {s.findingTitle}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-adm-text-2">Kết quả</dt>
          <dd className="font-medium text-adm-text" data-testid="d3-sum-outcome">
            {s.outcomeTitle}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-adm-text-2">Hệ quả</dt>
          <dd className="break-words text-adm-text" data-testid="d3-sum-consequence">
            {s.consequence}
          </dd>
        </div>
        {s.findingReasoning && (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs text-adm-text-2">Lý do kết luận</dt>
            <dd className="whitespace-pre-wrap break-words text-adm-text">{s.findingReasoning}</dd>
          </div>
        )}
      </dl>
      {s.blocked && (
        <div role="note" data-testid="d3-sum-blocked" className="rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 font-medium text-st-warning">
          {s.blocked}
        </div>
      )}
    </section>
  );
}

function DecideForm({ detail, onChanged, onDone }: ActionSlotProps & { onDone: (d: Done) => void }) {
  const id = useId();
  const w = useWrite<ReturnType<typeof approvalBody>, DecideResult>(onChanged);
  const [reason, setReason] = useState("");
  const [coi, setCoi] = useState(false);
  const [ack, setAck] = useState(false);
  const [shown, setShown] = useState(false);
  const [deciding, setDeciding] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [branch, setBranch] = useState<EvidenceChangeBranch | null>(null);
  useCloseOnResult(deciding !== null, (v) => !v && setDeciding(null), w);

  useEffect(() => {
    const b = evidenceChangeBranch(w.error);
    if (b) setBranch(b);
  }, [w.error]);

  const form = (result: "APPROVED" | "REJECTED"): ApprovalForm => ({ result, reason, coi, evidenceChangeAcknowledged: ack });
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateApproval(form("APPROVED")) : {}) };
  const approveBlocked = branch === "recollect" || (branch === "acknowledge" && !ack);

  function ask(result: "APPROVED" | "REJECTED") {
    setShown(true);
    if (hasErrors(validateApproval(form(result)))) return;
    setDeciding(result);
  }
  async function confirm() {
    if (!deciding) return;
    const result = deciding;
    const r = await w.submit(approvalBody(form(result)), (key, b) => disputeCaseApi.decide(detail.case.id, b, key));
    if (r.ok) {
      setDeciding(null);
      setBranch(null);
      onDone({ result, blocked: r.value.executionBlockedReason ? blockedText(r.value.executionBlockedReason, true) : null });
    }
  }

  const reload = async () => {
    await w.reload();
    setBranch(null);
  };
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setDeciding(null))} onRetry={w.retry} pending={w.pending} testId="d3-decide-dialog-error" />;

  return (
    <div className="space-y-4" data-testid="d3-decide">
      <Summary detail={detail} />
      <MutedLine testId="d3-party-unknown">{APPROVER_PARTY_UNKNOWN_NOTE}</MutedLine>

      {branch === "recollect" && (
        <div role="alert" data-testid="d3-ec-recollect" className="space-y-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm text-st-warning">
          <p>{RECOLLECT_FIRST_NOTE}</p>
          <ActionButton variant="outline" onClick={() => void reload()} pending={w.reloading} testId="d3-ec-reload">
            Tải lại hồ sơ
          </ActionButton>
        </div>
      )}
      {branch === "acknowledge" && (
        <div role="alert" data-testid="d3-ec-ack" className="space-y-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm text-st-warning">
          <p>{ACK_THEN_TICK_NOTE}</p>
          <ActionButton variant="outline" onClick={() => void reload()} pending={w.reloading} testId="d3-ec-reload">
            Tải lại hồ sơ
          </ActionButton>
        </div>
      )}

      <Field id={`${id}-reason`} label="Lý do (bắt buộc, kể cả khi duyệt)" required error={errs.reason} count={counter(reason)} max={LIMITS.approvalReason}>
        <TextArea
          id={`${id}-reason`}
          value={reason}
          onChange={(v) => {
            w.onEdit();
            setReason(v);
          }}
          error={errs.reason}
          rows={4}
        />
      </Field>
      <Check
        id={`${id}-coi`}
        checked={coi}
        onChange={(v) => {
          w.onEdit();
          setCoi(v);
        }}
        label={COI_LABEL}
        help={COI_HELP}
        error={errs.conflictOfInterestDeclaredNone}
      />
      {branch === "acknowledge" && (
        <Check
          id={`${id}-ack`}
          checked={ack}
          onChange={(v) => {
            w.onEdit();
            setAck(v);
          }}
          label={EVIDENCE_ACK_LABEL}
        />
      )}

      <ButtonRow>
        <ActionButton variant="outline" onClick={() => ask("REJECTED")} disabled={!coi || w.mustReload} testId="d3-reject-open">
          Bác đề xuất…
        </ActionButton>
        <ActionButton variant="primary" onClick={() => ask("APPROVED")} disabled={!coi || w.mustReload || approveBlocked} testId="d3-approve-open">
          Duyệt đề xuất…
        </ActionButton>
      </ButtonRow>
      {deciding === null && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-decide-error" />}

      <ConfirmModal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding === "APPROVED" ? "Duyệt đề xuất này?" : "Bác đề xuất này?"}
        rows={[
          { label: "Quyết định của bạn", value: deciding ? APPROVAL_RESULT_LABEL[deciding] : "" },
          { label: "Lý do", value: reason.trim() },
          { label: "Xung đột lợi ích", value: "Đã khai báo không có" },
        ]}
        notice={deciding === "APPROVED" ? CONFIRM_APPROVE : CONFIRM_REJECT_PROPOSAL}
        confirmLabel={deciding === "APPROVED" ? "Duyệt" : "Bác"}
        pendingLabel="Đang ghi…"
        danger={deciding === "REJECTED"}
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d3-decide-dialog"
        error={dialogError}
      />
    </div>
  );
}

export function ApprovalActions(props: ActionSlotProps) {
  const { detail, currentUserId } = props;
  const gate = decideGate(detail, currentUserId);
  const [done, setDone] = useState<Done | null>(null);
  if (!gate.show && !done) return null;
  return (
    <ActionGroup title="Duyệt hoặc bác đề xuất" testId="d3-actions-approvals">
      {done && done.result === "APPROVED" && (
        <ResultNote testId="d3-approved-note">
          <p className="font-semibold">{APPROVED_DONE}</p>
          <p className="mt-1">{APPROVED_DONE_HELP}</p>
          {done.blocked && <p className="mt-1">{done.blocked}</p>}
        </ResultNote>
      )}
      {done && done.result === "REJECTED" && <ResultNote tone="info" testId="d3-rejected-note">{REJECTED_DONE}</ResultNote>}
      {gate.show && <DecideForm {...props} onDone={setDone} />}
    </ActionGroup>
  );
}
