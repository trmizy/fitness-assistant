/**
 * D5 - closing a case WITHOUT a decision: close-orphan (A25, the session left the dispute) and close-not-a-dispute (A26, the finding is
 * "not a dispute"). Both need a reason (it is the audit), both go through a two-step confirm that says plainly there is no money effect.
 * The control exists only while the server lists the action in `allowedActions`.
 */
import { useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import type { CloseResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { ActionButton, ButtonRow, ConfirmModal, ErrorBox, Field, FormCard, TextArea, counter, useCloseOnResult, useWrite, type PushNote } from "./actionKit";
import { LIMITS, hasErrors, validateReasonOnly, type Errors } from "./actionModel";
import { CLOSE_NOT_A_DISPUTE_NOTICE, CLOSE_ORPHAN_NOTICE, closeResultText } from "./executionModel";

export type CloseKind = "orphan" | "notADispute";

const COPY: Record<CloseKind, { title: string; caption: string; button: string; dialogTitle: string; notice: string; testId: string }> = {
  orphan: {
    title: "Đóng hồ sơ: buổi tập không còn trong khiếu nại",
    caption: "Dùng khi buổi tập đã được xử lý hoặc đã rời khỏi diện khiếu nại nhưng hồ sơ vẫn mở. Việc đóng không có quyết định và không đụng tới tiền.",
    button: "Đóng hồ sơ…",
    dialogTitle: "Đóng hồ sơ này?",
    notice: CLOSE_ORPHAN_NOTICE,
    testId: "d5-close-orphan",
  },
  notADispute: {
    title: "Đóng hồ sơ: không phải khiếu nại",
    caption: "Dùng khi kết luận hiện tại là «Không phải khiếu nại». Buổi tập không bị đổi, vẫn ở trạng thái khiếu nại và quay lại hàng đợi. Không đụng tới tiền.",
    button: "Đóng hồ sơ…",
    dialogTitle: "Đóng hồ sơ: không phải khiếu nại?",
    notice: CLOSE_NOT_A_DISPUTE_NOTICE,
    testId: "d5-close-not-a-dispute",
  },
};

export function CloseCard({ kind, detail, onChanged, push }: ActionSlotProps & { kind: CloseKind; push: PushNote }) {
  const id = useId();
  const copy = COPY[kind];
  const w = useWrite<{ reason: string }, CloseResult>(onChanged);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateReasonOnly(reason, LIMITS.closeReason) : {}) };

  function ask() {
    setShown(true);
    if (hasErrors(validateReasonOnly(reason, LIMITS.closeReason))) return;
    setOpen(true);
  }
  async function confirm() {
    const send = kind === "orphan"
      ? (key: string, b: { reason: string }) => disputeCaseApi.closeOrphan(detail.case.id, b, key)
      : (key: string, b: { reason: string }) => disputeCaseApi.closeNotADispute(detail.case.id, b, key);
    const r = await w.submit({ reason: reason.trim() }, send);
    if (r.ok) {
      const t = closeResultText(kind, r.value);
      push({ tone: t.tone, testId: `${copy.testId}-result`, text: t.text });
      setOpen(false);
      setReason("");
      setShown(false);
    } else if (r.error && r.error.kind !== "unavailable") setOpen(false);
  }
  const dialogError = <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId={`${copy.testId}-dialog-error`} />;

  return (
    <FormCard title={copy.title} caption={copy.caption} testId={copy.testId}>
      <Field id={`${id}-reason`} label="Lý do đóng hồ sơ" required error={errs.reason} count={counter(reason)} max={LIMITS.closeReason}>
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
      <ButtonRow>
        <ActionButton variant="danger" onClick={ask} disabled={w.mustReload} pending={w.pending && !open} testId={`${copy.testId}-open`}>
          {copy.button}
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId={`${copy.testId}-error`} />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={copy.dialogTitle}
        rows={[{ label: "Lý do", value: reason.trim() }]}
        notice={copy.notice}
        confirmLabel="Đóng hồ sơ"
        pendingLabel="Đang ghi…"
        danger
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId={`${copy.testId}-dialog`}
        error={dialogError}
      />
    </FormCard>
  );
}
