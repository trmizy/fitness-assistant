/**
 * D3 - Evidence slot: recollect sources (A5, any ADMIN), acknowledge a change of evidence (A15, investigator, only while AWAITING_APPROVAL),
 * share a piece of evidence with one party (A18, investigator).
 */
import { useId, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { disputeCaseApi } from "../disputeCaseApi";
import type { RecollectResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { ActionButton, ActionGroup, ButtonRow, ErrorBox, Field, FormCard, MutedLine, ResultNote, TextArea, counter, useWrite } from "./actionKit";
import { LIMITS, availability, hasErrors, investigatorOnlyLine, shareableEvidenceChoices, validateAck, type Errors } from "./actionModel";
import { SHARE_NONE_ELIGIBLE } from "./actionText";
import { ShareForm } from "./ShareForm";

function RecollectCard({ detail, onChanged }: ActionSlotProps) {
  const w = useWrite<Record<string, never>, RecollectResult>(onChanged);
  return (
    <FormCard title="Thu lại bằng chứng" caption="Đọc lại các nguồn của hệ thống. Chỉ thêm phiên bản mới cho nguồn có nội dung đã đổi; bản cũ vẫn được giữ. Quản trị viên nào cũng làm được." testId="d3-recollect">
      <ButtonRow>
        <ActionButton
          variant="outline"
          onClick={() => void w.submit({}, (key) => disputeCaseApi.recollect(detail.case.id, key))}
          disabled={w.mustReload}
          pending={w.pending}
          testId="d3-recollect-send"
        >
          <ArrowClockwiseIcon className="size-4" aria-hidden /> Thu lại bằng chứng
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-recollect-error" />
      {w.result && !w.error && (
        <ResultNote tone={(w.result.skippedUnavailable ?? []).length > 0 ? "warning" : "success"} testId="d3-recollect-result">
          <p>
            Đã thu lại: thêm {w.result.added} phiên bản mới, {w.result.unchanged} nguồn không đổi.
          </p>
          {(w.result.skippedUnavailable ?? []).length > 0 && (
            <p className="mt-1" data-testid="d3-recollect-skipped">
              {(w.result.skippedUnavailable ?? []).length} nguồn không đọc được lần này nên bản đã có được giữ nguyên (không bị thay bằng «không đọc được»). Thử thu lại sau.
            </p>
          )}
        </ResultNote>
      )}
    </FormCard>
  );
}

function AckCard({ detail, onChanged }: ActionSlotProps) {
  const id = useId();
  const w = useWrite<{ note: string }, { acknowledged: true; changedIds: string[]; staleLive: string[] }>(onChanged);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateAck(note) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validateAck(note))) return;
    const r = await w.submit({ note: note.trim() }, (key, b) => disputeCaseApi.acknowledgeEvidenceChange(detail.case.id, b, key));
    if (r.ok) {
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard
      title="Xác nhận thay đổi bằng chứng"
      caption="Dùng khi người duyệt báo bằng chứng đã đổi sau khi lập đề xuất. Nếu nguồn đã đổi mà chưa được thu lại, hãy thu lại bằng chứng trước: khi đó không xác nhận cho qua được."
      testId="d3-ack"
    >
      <Field id={`${id}-note`} label="Ghi chú xác nhận" required error={errs.note} count={counter(note)} max={LIMITS.ackNote}>
        <TextArea id={`${id}-note`} value={note} onChange={(v) => { w.onEdit(); setNote(v); }} error={errs.note} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-ack-send">
          Ghi xác nhận
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-ack-error" />
      {w.result && !w.error && (
        <ResultNote tone={w.result.staleLive.length > 0 ? "warning" : "success"} testId="d3-ack-result">
          {w.result.staleLive.length > 0
            ? `Đã ghi xác nhận nhưng còn ${w.result.staleLive.length} nguồn chưa được thu lại. Hãy thu lại bằng chứng trước khi người duyệt gửi.`
            : `Đã ghi xác nhận cho ${w.result.changedIds.length} bằng chứng thay đổi. Người duyệt tải lại hồ sơ, tích ô xác nhận rồi gửi lại.`}
        </ResultNote>
      )}
    </FormCard>
  );
}

export function EvidenceActions(props: ActionSlotProps) {
  const { detail, currentUserId, onChanged } = props;
  const a = availability(detail, currentUserId);
  if (!a.signedIn || a.terminal) return null;
  const line = investigatorOnlyLine(detail, currentUserId);
  const showShare = a.share;
  return (
    <ActionGroup title="Thao tác với bằng chứng" testId="d3-actions-evidence">
      {line && <MutedLine testId="d3-who-may-act">{line}</MutedLine>}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {a.recollect && <RecollectCard {...props} />}
        {a.ack && <AckCard {...props} />}
        {showShare && (
          <ShareForm
            kind="evidence"
            caseId={detail.case.id}
            choices={shareableEvidenceChoices(detail)}
            emptyText={SHARE_NONE_ELIGIBLE}
            onChanged={onChanged}
            testId="d3-share-evidence"
            title="Chia sẻ bằng chứng cho một bên"
            caption="Chỉ chia sẻ được bằng chứng hệ thống đã đọc được, bình thường và đã xác minh. Không thu hồi được."
            pickLabel="Bằng chứng cần chia sẻ"
          />
        )}
      </div>
    </ActionGroup>
  );
}
