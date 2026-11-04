/**
 * D6 - the four-eyes decision of a gym case (G15). Drawn only when the server allows APPROVE or REJECT for this admin; the server re-checks
 * proposer / investigator / party and the evidence-change guard. Approving executes NOTHING: the money step is a separate, explicit action.
 */
import { useEffect, useId, useState } from "react";
import { gymCaseApi } from "../gymCaseApi";
import { findingConsequence, gymFindingLabel, gymOutcomeLabel } from "../gymCaseLabels";
import { LIMITS, hasErrors, latestFinding, newestProposal, validateDecision, type Errors } from "../gymCaseModel";
import type { GymDecideResult } from "../gymCaseTypes";
import { ActionButton, ButtonRow, Check, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, Select, TextArea, counter, useCloseOnResult, useGymWrite } from "../gymCaseKit";
import type { FormProps } from "./formTypes";

export const COI_LABEL = "Tôi khai báo không có xung đột lợi ích với vụ việc này.";
export const COI_HELP = "Bắt buộc phải tích để gửi. Người duyệt không được là người lập đề xuất, điều tra viên, hội viên hay chủ phòng tập.";
export const EVIDENCE_ACK_LABEL = "Tôi đã xem thay đổi bằng chứng mà điều tra viên đã xác nhận.";
export const APPROVE_NOTICE = "Sau khi duyệt, hồ sơ không thể sửa hay huỷ duyệt. Duyệt chưa thực thi gì: hoàn tiền (nếu có) chỉ chạy ở bước «Thực thi».";
export const REJECT_NOTICE = "Hồ sơ quay lại bước đánh giá.";

export function DecisionCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const proposal = newestProposal(detail.proposals);
  const finding = latestFinding(detail.findings);
  const w = useGymWrite<{ result: string; reason: string; coi: boolean; ack: boolean }, GymDecideResult>(onChanged);
  const [result, setResult] = useState("");
  const [reason, setReason] = useState("");
  const [coi, setCoi] = useState(false);
  const [ack, setAck] = useState(false);
  const [askAck, setAskAck] = useState(false);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const v = validateDecision({ result, reason, coi, evidenceAck: ack });
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };
  useCloseOnResult(open, setOpen, w);

  // The server asked for an acknowledgement (EVIDENCE_CHANGED without a pending re-collect): show the tick box, once.
  useEffect(() => {
    if (w.error?.code === "EVIDENCE_CHANGED" && w.error.evidenceChange && !w.error.evidenceChange.needsRecollect) setAskAck(true);
  }, [w.error]);

  async function confirm() {
    const r = await w.submit({ result, reason: reason.trim(), coi, ack }, (key, b) =>
      gymCaseApi.decide(detail.case.id, { result: b.result as "APPROVED" | "REJECTED", reason: b.reason, conflictOfInterestDeclaredNone: b.coi, ...(b.ack ? { evidenceChangeAcknowledged: true } : {}) }, key),
    );
    if (r.ok) {
      push({
        tone: r.value.result === "APPROVED" ? "success" : "info",
        testId: "d6-decision-done",
        text: r.value.result === "APPROVED" ? "Đã duyệt. Quyết định chưa được thực thi và chưa có khoản tiền nào được chuyển." : "Đã bác đề xuất. Hồ sơ quay lại bước «Đang đánh giá».",
      });
      setOpen(false);
      setReason("");
      setResult("");
      setCoi(false);
      setAck(false);
      setAskAck(false);
      setShown(false);
    }
  }

  if (!proposal) return null;
  const approving = result === "APPROVED";

  return (
    <FormCard title="Duyệt hoặc bác đề xuất" caption="Cần một quản trị viên khác với người lập đề xuất và điều tra viên. Máy chủ kiểm lại điều này khi bạn gửi." testId="d6-decision">
      <section aria-label="Quyết định cần duyệt" className="space-y-2 rounded-xl border border-adm-border bg-adm-surface-2 p-4 text-sm" data-testid="d6-decision-summary">
        <p className="text-xs font-semibold text-adm-text-2">Bạn đang duyệt (chỉ đọc, không sửa được)</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-adm-text-2">Kết luận</dt>
            <dd className="font-medium text-adm-text">{finding ? gymFindingLabel(finding.finding) : "Chưa rõ"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-adm-text-2">Kết quả đề xuất</dt>
            <dd className="font-medium text-adm-text" data-testid="d6-decision-outcome">
              {proposal.outcomeLabel || gymOutcomeLabel(proposal.outcome)}
            </dd>
          </div>
          {finding && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-adm-text-2">Hệ quả</dt>
              <dd className="break-words text-adm-text">{findingConsequence(detail.case.caseClass, finding.finding)}</dd>
            </div>
          )}
          {finding?.reasoning && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-adm-text-2">Lập luận của kết luận</dt>
              <dd className="whitespace-pre-wrap break-words text-adm-text">{finding.reasoning}</dd>
            </div>
          )}
        </dl>
      </section>

      <Field id={`${id}-result`} label="Quyết định của bạn" required error={errs.result}>
        <Select
          id={`${id}-result`}
          value={result}
          onChange={(x) => {
            w.onEdit();
            setResult(x);
          }}
          options={[
            { value: "APPROVED", label: "Duyệt đề xuất" },
            { value: "REJECTED", label: "Bác đề xuất" },
          ]}
          placeholder="Chọn"
          error={errs.result}
        />
      </Field>
      <Field id={`${id}-reason`} label="Lý do (bắt buộc kể cả khi duyệt)" required error={errs.reason} count={counter(reason)} max={LIMITS.decisionReason}>
        <TextArea
          id={`${id}-reason`}
          value={reason}
          onChange={(x) => {
            w.onEdit();
            setReason(x);
          }}
          error={errs.reason}
        />
      </Field>
      <Check id={`${id}-coi`} checked={coi} onChange={setCoi} label={COI_LABEL} help={COI_HELP} error={errs.coi} />
      {askAck && (
        <div className="space-y-2" data-testid="d6-decision-ack">
          <MutedLine>Điều tra viên đã xác nhận bằng chứng thay đổi sau khi lập đề xuất. Tích ô dưới đây rồi gửi lại.</MutedLine>
          <Check id={`${id}-ack`} checked={ack} onChange={setAck} label={EVIDENCE_ACK_LABEL} />
        </div>
      )}
      <ButtonRow>
        <ActionButton
          variant={approving ? "primary" : result === "REJECTED" ? "danger" : "primary"}
          onClick={() => {
            setShown(true);
            if (!hasErrors(v)) setOpen(true);
          }}
          disabled={w.mustReload}
          testId="d6-decision-open"
        >
          {approving ? "Duyệt…" : result === "REJECTED" ? "Bác…" : "Gửi quyết định…"}
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-decision-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={approving ? "Duyệt đề xuất" : "Bác đề xuất"}
        rows={[
          { label: "Kết quả đề xuất", value: proposal.outcomeLabel || gymOutcomeLabel(proposal.outcome) },
          { label: "Lý do của bạn", value: reason.trim() },
        ]}
        notice={approving ? APPROVE_NOTICE : REJECT_NOTICE}
        danger={!approving}
        confirmLabel={approving ? "Xác nhận duyệt" : "Xác nhận bác"}
        pendingLabel="Đang gửi…"
        pending={w.pending}
        onConfirm={() => void confirm()}
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-decision-dialog-error" />}
        testId="d6-decision-dialog"
      />
    </FormCard>
  );
}
