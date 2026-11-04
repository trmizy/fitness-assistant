/**
 * D7 - the nine late-open forms (L3-L11). None has an amount field: the money is whatever the existing ledger step books after the approval.
 * Every form sends a stable `Idempotency-Key` except "Chạy lại" (L8), which the server does not read: that one is guarded by the one-flight lock only.
 */
import { useId, useState } from "react";
import { DialogShell } from "./DialogShell";
import { Check, Field, MutedLine, SelectField, TextArea } from "./MoneyExceptionParts";
import { moneyExceptionApi } from "./moneyExceptionApi";
import { fieldErrorsOf } from "./moneyExceptionErrors";
import { formatMoneyString } from "../../adminFinanceOverview.utils";
import type { AdminDirectoryEntry } from "./adminDirectory";
import {
  LIMITS,
  NOTICE_APPROVE_MONEY,
  NOTICE_CLAIM,
  NOTICE_HANDOVER,
  NOTICE_OPEN_RECOVERY,
  NOTICE_PROPOSE_LATE,
  NOTICE_REJECT,
  NOTICE_RETRY,
  buildApprove,
  buildHandover,
  buildProposeLate,
  lateResultNote,
  recoveryResultNote,
  splitRefs,
  validateApprove,
  validateHandover,
  validateProposeLate,
  validateReason,
  type Errors,
  type ResultNote,
} from "./moneyExceptionModel";
import { lateExecutionOf, recoveryApproveOf, recoveryOpenedOf, type LateItem } from "./moneyExceptionTypes";
import { recoveryClassText } from "./moneyExceptionLabels";
import { reasonOrGeneric } from "./moneyExceptionText";
import { useAfterMoneyWrite } from "./useMoneyExceptionData";
import { useMoneyWrite } from "./useMoneyWrite";

export interface LateDone {
  note: ResultNote;
}

export type LateDialogKind = "claim" | "handover" | "propose" | "approve" | "reject" | "retry" | "openRecovery" | "approveRecovery" | "rejectRecovery";

interface Common {
  item: LateItem;
  onClose: () => void;
  onDone: (d: LateDone) => void;
}

const ok = (title: string, text: string): ResultNote => ({ tone: "success", title, text });

// ── L3
export function ClaimDialog({ item, onClose, onDone }: Common) {
  const w = useMoneyWrite<Record<string, never>, unknown>(useAfterMoneyWrite());
  async function confirm() {
    const out = await w.submit({}, (key) => moneyExceptionApi.lateClaim(item.rowId, key));
    if (out.ok) onDone({ note: ok("Bạn đã nhận phụ trách dòng này", "Bước tiếp theo là lập đề xuất. Người phụ trách không được tự duyệt đề xuất của mình.") });
  }
  return <DialogShell testId="late-claim-dialog" title="Nhận phụ trách dòng này" notice={NOTICE_CLAIM} confirmLabel="Nhận phụ trách" pendingLabel="Đang gửi…" write={w} onConfirm={confirm} onClose={onClose} />;
}

// ── L4
export function HandoverDialog({ item, admins, adminsLoading, onClose, onDone }: Common & { admins: AdminDirectoryEntry[]; adminsLoading: boolean }) {
  const uid = useId();
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<ReturnType<typeof buildHandover>, unknown>(useAfterMoneyWrite());
  async function confirm() {
    const e = validateHandover({ newAssigneeId: assignee, reason });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const out = await w.submit(buildHandover({ newAssigneeId: assignee, reason }), (key, body) => moneyExceptionApi.lateHandover(item.rowId, body, key));
    if (out.ok) onDone({ note: ok("Đã chuyển giao", "Người nhận hiện là người phụ trách dòng này.") });
    else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }
  return (
    <DialogShell testId="late-handover-dialog" title="Chuyển giao người phụ trách" notice={NOTICE_HANDOVER} confirmLabel="Chuyển giao" pendingLabel="Đang chuyển giao…" write={w} onConfirm={confirm} onClose={onClose}>
      <Field id={`${uid}-who`} label="Người nhận (quản trị viên)" error={errors.newAssigneeId}>
        <SelectField
          id={`${uid}-who`}
          value={assignee}
          placeholder={adminsLoading ? "Đang tải danh sách…" : "Chọn quản trị viên"}
          options={admins.map((a) => ({ value: a.id, label: a.label }))}
          error={errors.newAssigneeId}
          disabled={adminsLoading}
          onChange={(v) => { setAssignee(v); setErrors((x) => ({ ...x, newAssigneeId: "" })); w.clearError(); }}
        />
      </Field>
      {!adminsLoading && admins.length === 0 && <MutedLine testId="late-handover-no-admins">Chưa tải được danh sách quản trị viên khác nên chưa chuyển giao được. Đóng hộp thoại rồi thử lại sau.</MutedLine>}
      <Field id={`${uid}-reason`} label="Lý do chuyển giao" error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={3} error={errors.reason} onChange={(v) => { setReason(v); setErrors((x) => ({ ...x, reason: "" })); w.clearError(); }} />
      </Field>
    </DialogShell>
  );
}

// ── L5
export function ProposeLateDialog({ item, onClose, onDone }: Common) {
  const uid = useId();
  const [form, setForm] = useState({ reason: "", verificationNote: "", refsText: "", policyBasis: "" });
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<ReturnType<typeof buildProposeLate>, unknown>(useAfterMoneyWrite());
  const set = (k: keyof typeof form, errKey: string) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((x) => ({ ...x, [errKey]: "" }));
    w.clearError();
  };
  async function confirm() {
    const e = validateProposeLate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const out = await w.submit(buildProposeLate(form), (key, body) => moneyExceptionApi.latePropose(item.rowId, body, key));
    if (out.ok) onDone({ note: ok("Đã lập đề xuất", "Đề xuất đang chờ một quản trị viên khác duyệt. Chưa có khoản tiền nào được chuyển.") });
    else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }
  return (
    <DialogShell
      testId="late-propose-dialog"
      title="Lập đề xuất cho khoản bồi thường đến muộn"
      description="Nêu vì sao việc PT đến muộn đã được xác minh. Số tiền do sổ cái tính; bạn không nhập số tiền."
      notice={NOTICE_PROPOSE_LATE}
      confirmLabel="Lập đề xuất"
      pendingLabel="Đang lập đề xuất…"
      write={w}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id={`${uid}-reason`} label="Lý do" error={errors.reason} count={form.reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={form.reason} rows={3} error={errors.reason} onChange={set("reason", "reason")} />
      </Field>
      <Field id={`${uid}-ver`} label="Đã xác minh bằng cách nào" error={errors.verificationNote} count={form.verificationNote.trim().length} max={LIMITS.verificationNote}>
        <TextArea id={`${uid}-ver`} value={form.verificationNote} rows={3} error={errors.verificationNote} onChange={set("verificationNote", "verificationNote")} />
      </Field>
      <Field id={`${uid}-refs`} label="Tham chiếu bằng chứng" hint={`Mỗi dòng một tham chiếu (tối đa ${LIMITS.refsMax} dòng). Hiện có ${splitRefs(form.refsText).length} dòng.`} error={errors.evidenceRefs}>
        <TextArea id={`${uid}-refs`} value={form.refsText} rows={3} hint error={errors.evidenceRefs} onChange={set("refsText", "evidenceRefs")} />
      </Field>
      <Field id={`${uid}-pol`} label="Căn cứ chính sách" error={errors.policyBasis} count={form.policyBasis.trim().length} max={LIMITS.policyBasis}>
        <TextArea id={`${uid}-pol`} value={form.policyBasis} rows={3} error={errors.policyBasis} onChange={set("policyBasis", "policyBasis")} />
      </Field>
    </DialogShell>
  );
}

// ── approve (L6) / approve recovery (L10): same form, other endpoint
function ApproveForm({ kind, item, targetId, onClose, onDone }: Common & { kind: "approve" | "approveRecovery"; targetId: string }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [coi, setCoi] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<ReturnType<typeof buildApprove>, unknown>(useAfterMoneyWrite());
  const recovery = kind === "approveRecovery";
  async function confirm() {
    const e = validateApprove({ reason, coi });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const out = await w.submit(buildApprove({ reason, coi }), (key, body) => (recovery ? moneyExceptionApi.lateApproveRecovery(targetId, body, key) : moneyExceptionApi.lateApprove(targetId, body, key)));
    if (!out.ok) {
      if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
      return;
    }
    const data = out.value.data as { execution?: unknown } | null;
    // HTTP 200 is NOT "executed": the honest sentence comes from `execution.status` (or the recovery's own APPLIED / HALTED)
    onDone({ note: recovery ? recoveryResultNote(recoveryApproveOf(out.value.data), formatMoneyString, item.attempts) : lateResultNote(lateExecutionOf(data?.execution), formatMoneyString, item.attempts) });
  }
  return (
    <DialogShell
      testId={recovery ? "late-approve-recovery-dialog" : "late-approve-dialog"}
      title={recovery ? "Duyệt đợt chạy bổ sung" : "Duyệt đề xuất đối soát"}
      description={recovery ? "Hệ thống đọc lại sổ cái rồi mới quyết định phát lại, cấp thêm lượt chạy hoặc dừng." : "Bạn là người thứ hai. Sau khi duyệt, hệ thống chạy bước tiền qua sổ cái ngay."}
      notice={NOTICE_APPROVE_MONEY}
      confirmLabel={recovery ? "Duyệt đợt bổ sung" : "Duyệt và chạy"}
      pendingLabel="Đang gửi…"
      danger
      write={w}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id={`${uid}-reason`} label="Lý do duyệt" error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={3} error={errors.reason} onChange={(v) => { setReason(v); setErrors((x) => ({ ...x, reason: "" })); w.clearError(); }} />
      </Field>
      <Check id={`${uid}-coi`} checked={coi} error={errors.coi} onChange={(v) => { setCoi(v); setErrors((x) => ({ ...x, coi: "" })); }} label="Tôi khai báo không có xung đột lợi ích: tôi không phải khách hay PT của hợp đồng này." />
      <MutedLine>Kết quả thật (đã ghi, bị chặn, chưa thành công hay đang chạy) sẽ hiện sau khi sổ cái trả lời; duyệt không có nghĩa là đã trả.</MutedLine>
    </DialogShell>
  );
}
export const ApproveLateDialog = (p: Common & { proposalId: string }) => <ApproveForm kind="approve" item={p.item} targetId={p.proposalId} onClose={p.onClose} onDone={p.onDone} />;
export const ApproveRecoveryDialog = (p: Common & { recoveryId: string }) => <ApproveForm kind="approveRecovery" item={p.item} targetId={p.recoveryId} onClose={p.onClose} onDone={p.onDone} />;

// ── reject (L7) / reject recovery (L11)
function RejectForm({ recovery, item, targetId, onClose, onDone }: Common & { recovery: boolean; targetId: string }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<{ reason: string }, unknown>(useAfterMoneyWrite());
  void item;
  async function confirm() {
    const e = validateReason({ reason });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const body = { reason: reason.trim() };
    const out = await w.submit(body, (key, b) => (recovery ? moneyExceptionApi.lateRejectRecovery(targetId, b, key) : moneyExceptionApi.lateReject(targetId, b, key)));
    if (out.ok) onDone({ note: ok(recovery ? "Đã bác đợt chạy bổ sung" : "Đã bác đề xuất", "Chưa có khoản tiền nào được chuyển.") });
    else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }
  return (
    <DialogShell
      testId={recovery ? "late-reject-recovery-dialog" : "late-reject-dialog"}
      title={recovery ? "Bác đợt chạy bổ sung" : "Bác đề xuất"}
      notice={recovery ? "Đợt chạy bổ sung bị bác; không chạy gì thêm." : NOTICE_REJECT}
      confirmLabel={recovery ? "Bác đợt bổ sung" : "Bác đề xuất"}
      pendingLabel="Đang gửi…"
      danger
      write={w}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id={`${uid}-reason`} label="Lý do bác" error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={3} error={errors.reason} onChange={(v) => { setReason(v); setErrors((x) => ({ ...x, reason: "" })); w.clearError(); }} />
      </Field>
    </DialogShell>
  );
}
export const RejectLateDialog = (p: Common & { proposalId: string }) => <RejectForm recovery={false} item={p.item} targetId={p.proposalId} onClose={p.onClose} onDone={p.onDone} />;
export const RejectRecoveryDialog = (p: Common & { recoveryId: string }) => <RejectForm recovery item={p.item} targetId={p.recoveryId} onClose={p.onClose} onDone={p.onDone} />;

// ── L8 (no Idempotency-Key: the server ignores it)
export function RetryDialog({ item, proposalId, onClose, onDone }: Common & { proposalId: string }) {
  const w = useMoneyWrite<Record<string, never>, unknown>(useAfterMoneyWrite());
  async function confirm() {
    const out = await w.submit({}, () => moneyExceptionApi.lateRetry(proposalId));
    if (out.ok) {
      const data = out.value.data as { execution?: unknown } | null;
      onDone({ note: lateResultNote(lateExecutionOf(data?.execution), formatMoneyString, item.attempts) });
    }
  }
  const left = item.attempts ? `Đã thất bại ${item.attempts.failures}/${item.attempts.cap} lượt.` : undefined;
  return (
    <DialogShell testId="late-retry-dialog" title="Chạy lại bước tiền đã duyệt" description={left} notice={NOTICE_RETRY} confirmLabel="Chạy lại" pendingLabel="Đang chạy…" danger write={w} onConfirm={confirm} onClose={onClose} />
  );
}

// ── L9
export function OpenRecoveryDialog({ item, proposalId, onClose, onDone }: Common & { proposalId: string }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<{ reason: string }, unknown>(useAfterMoneyWrite());
  async function confirm() {
    const e = validateReason({ reason });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const out = await w.submit({ reason: reason.trim() }, (key, b) => moneyExceptionApi.lateOpenRecovery(proposalId, b, key));
    if (out.ok) {
      const opened = recoveryOpenedOf(out.value.data);
      onDone({
        note: {
          tone: opened?.classification === "HALT" ? "warning" : "success",
          title: "Đã mở đợt chạy bổ sung",
          text: `${recoveryClassText(opened?.classification)}${opened?.haltCode ? ` ${reasonOrGeneric(opened.haltCode, "")}` : ""} Cần một quản trị viên khác duyệt. Chưa có khoản tiền nào được chuyển.`,
        },
      });
    } else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }
  const left = item.attempts ? `Đợt bổ sung còn lại: ${item.attempts.recoveriesLeft}.` : undefined;
  return (
    <DialogShell testId="late-open-recovery-dialog" title="Mở đợt chạy bổ sung" description={`Dùng khi đã hết lượt chạy. ${left ?? ""}`.trim()} notice={NOTICE_OPEN_RECOVERY} confirmLabel="Mở đợt bổ sung" pendingLabel="Đang gửi…" write={w} onConfirm={confirm} onClose={onClose}>
      <Field id={`${uid}-reason`} label="Lý do mở đợt bổ sung" error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={3} error={errors.reason} onChange={(v) => { setReason(v); setErrors((x) => ({ ...x, reason: "" })); w.clearError(); }} />
      </Field>
    </DialogShell>
  );
}
