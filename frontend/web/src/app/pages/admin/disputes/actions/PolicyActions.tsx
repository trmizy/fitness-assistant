/**
 * D5 / M7 - policy-eligibility forms: propose a review (A22, investigator) and approve one (A23, a second admin). Both exist only when the server's
 * `allowedActions` lists them; the review ids a viewer may approve come from `actions.approvePolicyEligibility.options` (four-eyes and conflict of
 * interest are the server's call). Proposing opens or closes nothing; approving opens or closes the ruling right for EVERY session of the contract, so it
 * has a strong confirm: "Mở/đóng quyền phán quyết cho mọi buổi của hợp đồng này.".
 */
import { useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { POLICY_RESULT_LABEL } from "../disputeCaseLabels";
import { POLICY_RESULTS, type PolicyReviewResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { POLICY_APPROVE_CONFIRM, POLICY_PROPOSE_CAPTION, describePolicyReviews, supersedableReviews, type PolicyReviewRow } from "../workspace/policyModel";
import { ActionButton, ButtonRow, Check, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, ResultNote, Select, TextArea, counter, useCloseOnResult, useWrite } from "./actionKit";
import {
  LIMITS,
  approvableReviewIds,
  evidenceChoices,
  hasErrors,
  policyApproveBody,
  policyReviewBody,
  validatePolicyApprove,
  validatePolicyReview,
  type Errors,
} from "./actionModel";
import { COI_HELP, COI_LABEL } from "./actionText";

// ───────────────────────────────────────────────────────────── propose ──
export function ProposePolicyCard({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const id = useId();
  const w = useWrite<ReturnType<typeof policyReviewBody>, PolicyReviewResult>(onChanged);
  const choices = evidenceChoices(detail).filter((c) => !c.unreadable);
  const known = evidenceChoices(detail).map((c) => c.id);
  const view = describePolicyReviews(detail, approvableReviewIds(detail), currentUserId);
  const [result, setResult] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [shown, setShown] = useState(false);
  const form = { result: result as never, evidenceIds: picked, reasoning, supersedesId: supersedes };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validatePolicyReview(form, known) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validatePolicyReview(form, known))) return;
    const r = await w.submit(policyReviewBody(form), (key, b) => disputeCaseApi.proposePolicyEligibility(detail.case.id, b, key));
    if (r.ok) {
      setResult("");
      setPicked([]);
      setReasoning("");
      setSupersedes("");
      setShown(false);
    }
  }
  const toggle = (evId: string, on: boolean) => {
    w.onEdit();
    setPicked((cur) => (on ? [...new Set([...cur, evId])] : cur.filter((x) => x !== evId)));
  };

  return (
    <FormCard title="Đề xuất kết luận áp dụng chính sách" caption={POLICY_PROPOSE_CAPTION} testId="d5-policy-propose">
      <Field id={`${id}-result`} label="Kết luận" required error={errs.result}>
        <Select
          id={`${id}-result`}
          value={result}
          onChange={(v) => {
            w.onEdit();
            setResult(v);
          }}
          placeholder="Chọn kết luận…"
          options={POLICY_RESULTS.map((r) => ({ value: r, label: POLICY_RESULT_LABEL[r] }))}
          error={errs.result}
        />
      </Field>
      <fieldset className="space-y-1" aria-describedby={errs.evidenceIds ? `${id}-ev-err` : undefined}>
        <legend className="text-xs font-semibold text-adm-text">
          Căn cứ: bằng chứng của hồ sơ <span className="font-normal text-adm-text-2">(bắt buộc, chọn ít nhất một)</span>
        </legend>
        {choices.length === 0 ? (
          <MutedLine testId="d5-policy-no-evidence">Hồ sơ chưa có bằng chứng đọc được để làm căn cứ.</MutedLine>
        ) : (
          <div className="space-y-0.5">
            {choices.map((c) => (
              <Check key={c.id} id={`${id}-ev-${c.id}`} checked={picked.includes(c.id)} onChange={(v) => toggle(c.id, v)} label={c.label} />
            ))}
          </div>
        )}
        {errs.evidenceIds && (
          <p id={`${id}-ev-err`} className="text-xs font-medium text-st-danger" data-testid="d5-policy-evidence-err">
            {errs.evidenceIds}
          </p>
        )}
      </fieldset>
      <Field id={`${id}-reasoning`} label="Lý do" required error={errs.reasoning} count={counter(reasoning)} max={LIMITS.policyReasoning}>
        <TextArea
          id={`${id}-reasoning`}
          value={reasoning}
          onChange={(v) => {
            w.onEdit();
            setReasoning(v);
          }}
          error={errs.reasoning}
          rows={4}
        />
      </Field>
      {view.rows.length > 0 && (
        <Field id={`${id}-sup`} label="Thay cho kết luận cũ (không bắt buộc)">
          <Select
            id={`${id}-sup`}
            value={supersedes}
            onChange={(v) => {
              w.onEdit();
              setSupersedes(v);
            }}
            placeholder="Không thay kết luận nào"
            options={supersedableReviews(view).map((r) => ({ value: r.id, label: r.label }))}
          />
        </Field>
      )}
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d5-policy-propose-send">
          Gửi đề xuất
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d5-policy-propose-error" />
      {w.result && !w.error && <ResultNote testId="d5-policy-propose-result">Đã gửi đề xuất. Chưa mở hay đóng quyền phán quyết nào: cần một quản trị viên khác duyệt.</ResultNote>}
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────────── approve ──
export function ApprovePolicyCard({ review, detail, contractId, onChanged }: Pick<ActionSlotProps, "onChanged"> & { detail?: ActionSlotProps["detail"]; contractId?: string; review: PolicyReviewRow }) {
  const id = useId();
  const w = useWrite<ReturnType<typeof policyApproveBody>, PolicyReviewResult>(onChanged);
  const [reason, setReason] = useState("");
  const [coi, setCoi] = useState(false);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);
  const form = { reason, coi };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validatePolicyApprove(form) : {}) };

  function ask() {
    setShown(true);
    if (hasErrors(validatePolicyApprove(form))) return;
    setOpen(true);
  }
  async function confirm() {
    const r = contractId
      ? await w.submit(policyApproveBody(form), (key, b) =>
          disputeCaseApi.approveContractPolicy(contractId, review.id, b, key))
      : await w.submit(policyApproveBody(form), (key, b) =>
          disputeCaseApi.approvePolicyEligibility(detail!.case.id, review.id, b, key));
    if (r.ok) setOpen(false);
    else if (r.error && r.error.kind !== "unavailable") setOpen(false);
  }
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d5-policy-approve-dialog-error" />;

  return (
    <FormCard title={`Duyệt kết luận: ${review.resultLabel}`} testId="d5-policy-approve">
      <Field id={`${id}-reason`} label="Lý do duyệt (bắt buộc)" required error={errs.reason} count={counter(reason)} max={LIMITS.policyApproveReason}>
        <TextArea
          id={`${id}-reason`}
          value={reason}
          onChange={(v) => {
            w.onEdit();
            setReason(v);
          }}
          error={errs.reason}
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
      <ButtonRow>
        <ActionButton variant="danger" onClick={ask} disabled={!coi || w.mustReload} pending={w.pending && !open} testId="d5-policy-approve-open">
          Duyệt kết luận…
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d5-policy-approve-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Duyệt kết luận áp dụng chính sách?"
        rows={[
          { label: "Kết luận", value: review.resultLabel },
          { label: "Lý do", value: reason.trim() },
          { label: "Xung đột lợi ích", value: "Đã khai báo không có" },
        ]}
        notice={POLICY_APPROVE_CONFIRM}
        confirmLabel="Duyệt"
        pendingLabel="Đang ghi…"
        danger
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d5-policy-approve-dialog"
        error={dialogError}
      />
    </FormCard>
  );
}
