/**
 * D3 - "Chia sẻ cho một bên" (A18), used by the Evidence slot (evidenceId) and the Statements slot (statementId).
 * Exactly one of evidenceId / statementId is sent. The picker only lists what the server would accept (for evidence: not party-submitted,
 * verified or not-applicable, sensitivity NORMAL), so there is no button to press on a row that can only fail. Irreversible: two-step confirm.
 */
import { useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { PARTY_ROLE_LABEL } from "../disputeCaseLabels";
import type { ShareRole } from "../disputeCaseTypes";
import { ActionButton, ButtonRow, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, ResultNote, Select, TextArea, counter, useCloseOnResult, useWrite, type Reload } from "./actionKit";
import { LIMITS, hasErrors, shareBody, validateShare, type Errors, type ShareChoice } from "./actionModel";
import { CONFIRM_SHARE } from "./actionText";

export function ShareForm({
  kind,
  caseId,
  choices,
  emptyText,
  onChanged,
  testId,
  title,
  caption,
  pickLabel,
}: {
  kind: "evidence" | "statement";
  caseId: string;
  choices: ShareChoice[];
  emptyText: string;
  onChanged: Reload;
  testId: string;
  title: string;
  caption?: string;
  pickLabel: string;
}) {
  const id = useId();
  const w = useWrite<ReturnType<typeof shareBody>, { id: string }>(onChanged);
  const [targetId, setTargetId] = useState("");
  const [role, setRole] = useState<ShareRole | "">("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);

  const form = { targetId, role, reason };
  const ids = choices.map((c) => c.id);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateShare(form, ids) : {}) };
  const chosen = choices.find((c) => c.id === targetId);

  async function send() {
    const r = await w.submit(shareBody(kind, form), (key, b) => disputeCaseApi.share(caseId, b, key));
    if (r.ok) {
      setOpen(false);
      setTargetId("");
      setRole("");
      setReason("");
      setShown(false);
    }
  }
  function click() {
    setShown(true);
    if (hasErrors(validateShare(form, ids))) return;
    setOpen(true);
  }

  return (
    <FormCard title={title} caption={caption} testId={testId}>
      {choices.length === 0 ? (
        <MutedLine testId={`${testId}-none`}>{emptyText}</MutedLine>
      ) : (
        <>
          <Field id={`${id}-target`} label={pickLabel} required error={errs.target ?? errs.evidenceId ?? errs.statementId}>
            <Select
              id={`${id}-target`}
              value={targetId}
              onChange={(v) => {
                w.onEdit();
                setTargetId(v);
              }}
              placeholder="Chọn…"
              options={choices.map((c) => ({ value: c.id, label: c.label }))}
              error={errs.target ?? errs.evidenceId ?? errs.statementId}
            />
          </Field>
          <Field id={`${id}-role`} label="Chia sẻ cho" required error={errs.sharedWithRole}>
            <Select
              id={`${id}-role`}
              value={role}
              onChange={(v) => {
                w.onEdit();
                setRole(v as ShareRole | "");
              }}
              placeholder="Chọn bên nhận…"
              options={[
                { value: "CLIENT", label: PARTY_ROLE_LABEL.CLIENT },
                { value: "PT", label: PARTY_ROLE_LABEL.PT },
              ]}
              error={errs.sharedWithRole}
            />
          </Field>
          <Field id={`${id}-reason`} label="Lý do chia sẻ" required error={errs.reason} count={counter(reason)} max={LIMITS.shareReason}>
            <TextArea id={`${id}-reason`} value={reason} onChange={(v) => { w.onEdit(); setReason(v); }} error={errs.reason} />
          </Field>
          <ButtonRow>
            <ActionButton variant="danger" onClick={click} disabled={w.mustReload} pending={w.pending && !open} testId={`${testId}-send`}>
              Chia sẻ…
            </ActionButton>
          </ButtonRow>
          {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId={`${testId}-error`} />}
          {w.result && !w.error && <ResultNote testId={`${testId}-result`}>Đã chia sẻ. Không thể thu hồi.</ResultNote>}
          <ConfirmModal
            open={open}
            onClose={() => setOpen(false)}
            title="Chia sẻ cho bên kia?"
            rows={[
              { label: kind === "evidence" ? "Bằng chứng" : "Lời khai", value: chosen?.label ?? "" },
              { label: "Bên nhận", value: role ? PARTY_ROLE_LABEL[role] : "" },
              { label: "Lý do", value: reason.trim() },
            ]}
            notice={CONFIRM_SHARE}
            confirmLabel="Chia sẻ"
            pendingLabel="Đang chia sẻ…"
            danger
            pending={w.pending}
            confirmDisabled={w.mustReload}
            onConfirm={() => void send()}
            testId={`${testId}-dialog`}
            error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId={`${testId}-dialog-error`} />}
          />
        </>
      )}
    </FormCard>
  );
}
