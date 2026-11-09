/**
 * D5 - Execution slot: execute (A27), reconcile (A28), acknowledge-needs-human (A29).
 * A control exists only when `capabilities.execution` is true AND the server lists the action in `allowedActions`; otherwise one muted line says the
 * executor is off (no dead button). Execute and reconcile change the session, the quota and money, so each goes through a two-step confirm with the
 * sentence "Thao tác sẽ đổi trạng thái buổi, quyền buổi và tiền. Chỉ có thể chạy lại, không thể hoàn tác.". Acknowledging a NEEDS_HUMAN case moves no money
 * and says so; its `STAYS_LOCKED` answer is shown as a lock that stays, never as success. `BUSINESS_DONE` never says money arrived.
 */
import { useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { outcomeLabel } from "../disputeCaseLabels";
import type { AckNeedsHumanResult, ExecuteResult, ReconcileResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { describeExecution, outcomeConsequence } from "../workspace/workspaceModel";
import { ActionButton, ActionGroup, ButtonRow, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, SlotNotes, TextArea, counter, useCloseOnResult, useSlotNotes, useWrite, type PushNote } from "./actionKit";
import { LIMITS, hasErrors, validateNeedsHumanNote, type Errors } from "./actionModel";
import {
  ACK_NEEDS_HUMAN_HELP,
  ACK_NEEDS_HUMAN_NOTICE,
  EXECUTE_CONFIRM_NOTICE,
  RECONCILE_CONFIRM_NOTICE,
  ackNeedsHumanResultText,
  executeBody,
  executeResultText,
  executionControls,
  reconcileResultText,
} from "./executionModel";

// ───────────────────────────────────────────────────────────── execute ──
function ExecuteCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const w = useWrite<{ decisionId?: string }, ExecuteResult>(onChanged);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);
  const view = describeExecution(detail);
  const outcome = detail.decision?.outcome ?? detail.execution?.outcome ?? null;

  async function confirm() {
    const r = await w.submit(executeBody(detail), (key, b) => disputeCaseApi.execute(detail.case.id, b, key));
    if (r.ok) {
      const t = executeResultText(r.value);
      push({ tone: t.tone, testId: "d5-execute-result", text: t.text });
      setOpen(false);
    } else if (r.error && r.error.kind !== "unavailable") {
      // keep the dialog open for a retry only when nothing was written (unavailable); otherwise close it so the error sits next to the button
      setOpen(false);
      // EXEC_BLOCKED / NEEDS_HUMAN are written onto the case by the server: re-read so the screen shows the new state, not "chưa thực thi".
      if (r.error.code === "EXEC_BLOCKED" || r.error.code === "NEEDS_HUMAN") void Promise.resolve(onChanged()).catch(() => undefined);
    }
  }
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d5-execute-dialog-error" />;

  return (
    <FormCard title="Thực thi quyết định" caption="Chạy quyết định đã được duyệt lên buổi tập. Máy chủ đọc lại và kiểm lại mọi điều kiện trước khi đổi gì." testId="d5-execute">
      {view.blockers.length > 0 && (
        <div role="note" data-testid="d5-execute-blockers" className="space-y-1 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm text-st-warning">
          <p className="font-semibold">Hiện còn điều kiện chưa đạt (máy chủ vẫn kiểm lại khi bạn bấm):</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {view.blockers.map((b) => (
              <li key={b.code}>{b.text}</li>
            ))}
          </ul>
        </div>
      )}
      <ButtonRow>
        <ActionButton variant="danger" onClick={() => setOpen(true)} disabled={w.mustReload} pending={w.pending && !open} testId="d5-execute-open">
          Thực thi quyết định…
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d5-execute-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Thực thi quyết định này?"
        rows={[
          { label: "Kết quả của quyết định", value: outcome ? outcomeLabel(outcome) : "—" },
          { label: "Hệ quả", value: outcome ? outcomeConsequence(outcome) : "—" },
        ]}
        notice={EXECUTE_CONFIRM_NOTICE}
        confirmLabel="Thực thi"
        pendingLabel="Đang thực thi…"
        danger
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d5-execute-dialog"
        error={dialogError}
      />
    </FormCard>
  );
}

// ─────────────────────────────────────────────────────────── reconcile ──
function ReconcileCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const w = useWrite<Record<string, never>, ReconcileResult>(onChanged);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);

  async function confirm() {
    const r = await w.submit({}, (key) => disputeCaseApi.reconcileExecution(detail.case.id, key));
    if (r.ok) {
      const t = reconcileResultText(r.value);
      push({ tone: t.tone, testId: "d5-reconcile-result", text: t.text });
      setOpen(false);
    } else if (r.error && r.error.kind !== "unavailable") setOpen(false);
  }
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d5-reconcile-dialog-error" />;

  return (
    <FormCard title="Đối soát thực thi" caption="Dùng khi một lần thực thi bị dở (trạng thái «Đang thực thi» kéo dài). Hệ thống đọc trạng thái thật của buổi rồi hoàn tất, chạy nốt hoặc chuyển cho người xem xét." testId="d5-reconcile">
      <ButtonRow>
        <ActionButton variant="outline" onClick={() => setOpen(true)} disabled={w.mustReload} pending={w.pending && !open} testId="d5-reconcile-open">
          Đối soát thực thi…
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d5-reconcile-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Đối soát thực thi?"
        notice={RECONCILE_CONFIRM_NOTICE}
        confirmLabel="Đối soát"
        pendingLabel="Đang đối soát…"
        danger
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d5-reconcile-dialog"
        error={dialogError}
      />
    </FormCard>
  );
}

// ──────────────────────────────────────────────── acknowledge needs human ──
function AckNeedsHumanCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const w = useWrite<{ note: string }, AckNeedsHumanResult>(onChanged);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateNeedsHumanNote(note) : {}) };

  function ask() {
    setShown(true);
    if (hasErrors(validateNeedsHumanNote(note))) return;
    setOpen(true);
  }
  async function confirm() {
    const r = await w.submit({ note: note.trim() }, (key, b) => disputeCaseApi.acknowledgeNeedsHuman(detail.case.id, b, key));
    if (r.ok) {
      const t = ackNeedsHumanResultText(r.value);
      push({ tone: t.tone, testId: r.value.action === "STAYS_LOCKED" ? "d5-ack-stays-locked" : "d5-ack-result", text: t.text });
      setOpen(false);
      setNote("");
      setShown(false);
    } else if (r.error && r.error.kind !== "unavailable") setOpen(false);
  }
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d5-ack-dialog-error" />;

  return (
    <FormCard title="Xác nhận việc thực thi cần người xem xét" caption={ACK_NEEDS_HUMAN_HELP} testId="d5-ack-needs-human">
      <MutedLine testId="d5-ack-no-money">Thao tác này không chuyển tiền.</MutedLine>
      <Field id={`${id}-note`} label="Ghi chú xác nhận" required error={errs.note} count={counter(note)} max={LIMITS.needsHumanNote}>
        <TextArea
          id={`${id}-note`}
          value={note}
          onChange={(v) => {
            w.onEdit();
            setNote(v);
          }}
          error={errs.note}
        />
      </Field>
      <ButtonRow>
        <ActionButton variant="outline" onClick={ask} disabled={w.mustReload} pending={w.pending && !open} testId="d5-ack-open">
          Xác nhận đã xem xét…
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d5-ack-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Xác nhận đã xem xét?"
        rows={[{ label: "Ghi chú", value: note.trim() }]}
        notice={ACK_NEEDS_HUMAN_NOTICE}
        confirmLabel="Xác nhận"
        pendingLabel="Đang ghi…"
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d5-ack-dialog"
        error={dialogError}
      />
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────────────── slot ──
export function ExecutionActions(props: ActionSlotProps) {
  const { detail, currentUserId, capabilities } = props;
  const { notes, push } = useSlotNotes();
  const c = executionControls(detail, currentUserId, capabilities);
  if (!currentUserId) return null;
  if (c.line) {
    return (
      <ActionGroup title="Thao tác thực thi" testId="d5-actions-execution">
        <MutedLine testId="d5-execution-off">{c.line}</MutedLine>
        <SlotNotes notes={notes} />
      </ActionGroup>
    );
  }
  if (!c.execute && !c.reconcile && !c.ackNeedsHuman && notes.length === 0) return null;
  return (
    <ActionGroup title="Thao tác thực thi" testId="d5-actions-execution">
      <SlotNotes notes={notes} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {c.execute && <ExecuteCard {...props} push={push} />}
        {c.reconcile && <ReconcileCard {...props} push={push} />}
        {c.ackNeedsHuman && <AckNeedsHumanCard {...props} push={push} />}
      </div>
    </ActionGroup>
  );
}
