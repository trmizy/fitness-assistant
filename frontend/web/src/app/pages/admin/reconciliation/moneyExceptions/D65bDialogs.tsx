/** D7 - D65-B propose, approve/resume, reject and handover. No amount field anywhere. */
import { useId, useState } from "react";
import { DialogShell } from "./DialogShell";
import { Btn, Check, Field, MutedLine, SelectField, TextArea } from "./MoneyExceptionParts";
import { moneyExceptionApi } from "./moneyExceptionApi";
import { fieldErrorsOf } from "./moneyExceptionErrors";
import { formatMoneyString } from "../../adminFinanceOverview.utils";
import {
  LIMITS,
  NOTICE_APPROVE_MONEY,
  NOTICE_PROPOSE_D65B,
  NOTICE_RESUME,
  buildApprove,
  buildProposeD65b,
  d65bResultNote,
  type D65bRef,
  validateApprove,
  validateProposeD65b,
  type Errors,
  type ResultNote,
} from "./moneyExceptionModel";
import { d65bExecutionOf, normalizeD65bSummary, type D65bSummary } from "./moneyExceptionTypes";
import { useAfterMoneyWrite } from "./useMoneyExceptionData";
import { useMoneyWrite } from "./useMoneyWrite";

export interface D65bDone {
  /** the proposal that now exists (after a propose) */
  resolutionId?: string;
  note: ResultNote;
}

export function ProposeD65bDialog({ sessionId, unit, onClose, onDone }: { sessionId: string; unit: string | null; onClose: () => void; onDone: (d: D65bDone) => void }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [refs, setRefs] = useState<D65bRef[]>([{ type: "EVIDENCE", id: "", contentHash: "" }]);
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<ReturnType<typeof buildProposeD65b>, unknown>(useAfterMoneyWrite());

  const clear = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));

  async function confirm() {
    const e = validateProposeD65b({ reason, refs });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const out = await w.submit(buildProposeD65b({ reason, refs }), (key, body) => moneyExceptionApi.d65bPropose(sessionId, body, key));
    if (out.ok) {
      const made = normalizeD65bSummary(out.value.data);
      onDone({
        resolutionId: made?.id,
        note: { tone: "success", title: "Đã lập đề xuất", text: "Đề xuất đang chờ một quản trị viên khác duyệt. Chưa có khoản tiền nào được chuyển." },
      });
    } else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }

  return (
    <DialogShell
      testId="d65b-propose-dialog"
      title="Lập đề xuất giải quyết khoản đang giữ"
      description="Chỉ có một kết quả: PT vắng mặt, tiền về ví của khách. Số tiền do sổ cái tính từ phần đang giữ của chính hợp đồng này."
      rows={unit ? [{ label: "Giá trị một buổi (sổ cái tính, không nhập)", value: formatMoneyString(unit) }] : undefined}
      notice={NOTICE_PROPOSE_D65B}
      confirmLabel="Lập đề xuất"
      pendingLabel="Đang lập đề xuất…"
      write={w}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id={`${uid}-reason`} label="Lý do và cách đã xác minh PT vắng" error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={4} error={errors.reason} onChange={(v) => { setReason(v); clear("reason"); w.clearError(); }} />
      </Field>
      <Field
        id={`${uid}-refs`}
        label="Tham chiếu bằng chứng"
        hint="Chỉ dùng bản ghi bằng chứng đã lưu (mã và hash) hoặc khoá thao tác sổ cái thuộc đúng hợp đồng. Máy chủ kiểm chứng từng tham chiếu; chữ tự do không được chấp nhận."
        error={errors.evidenceRefs}
      >
        <div className="space-y-3">
          {refs.map((ref, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-adm-border p-3">
              <SelectField id={`${uid}-ref-${index}-type`} value={ref.type} onChange={(type) => { setRefs((current) => current.map((item, i) => i === index ? (type === "LEDGER_OP" ? { type: "LEDGER_OP", key: "" } : { type: "EVIDENCE", id: "", contentHash: "" }) : item)); clear("evidenceRefs"); }} options={[{ value: "EVIDENCE", label: "Bản ghi bằng chứng" }, { value: "LEDGER_OP", label: "Thao tác sổ cái" }]} placeholder="Chọn loại tham chiếu" />
              {ref.type === "EVIDENCE" ? <>
                <label htmlFor={`${uid}-ref-${index}-id`} className="block text-xs font-medium text-adm-text">Mã bản ghi bằng chứng</label>
                <TextArea id={`${uid}-ref-${index}-id`} value={ref.id} rows={2} onChange={(v) => { setRefs((current) => current.map((item, i) => i === index && item.type === "EVIDENCE" ? { ...item, id: v } : item)); clear("evidenceRefs"); w.clearError(); }} />
                <label htmlFor={`${uid}-ref-${index}-hash`} className="block text-xs font-medium text-adm-text">Hash SHA-256 của bản ghi (64 ký tự hex)</label>
                <TextArea id={`${uid}-ref-${index}-hash`} value={ref.contentHash} rows={2} onChange={(v) => { setRefs((current) => current.map((item, i) => i === index && item.type === "EVIDENCE" ? { ...item, contentHash: v } : item)); clear("evidenceRefs"); w.clearError(); }} />
              </> : <>
                <label htmlFor={`${uid}-ref-${index}-key`} className="block text-xs font-medium text-adm-text">Khoá thao tác sổ cái</label>
                <TextArea id={`${uid}-ref-${index}-key`} value={ref.key} rows={2} onChange={(v) => { setRefs((current) => current.map((item, i) => i === index && item.type === "LEDGER_OP" ? { ...item, key: v } : item)); clear("evidenceRefs"); w.clearError(); }} />
              </>}
              {refs.length > 1 && <Btn variant="outline" onClick={() => setRefs((current) => current.filter((_, i) => i !== index))}>Bỏ tham chiếu</Btn>}
            </div>
          ))}
          {refs.length < 20 && <Btn variant="outline" onClick={() => setRefs((current) => [...current, { type: "EVIDENCE", id: "", contentHash: "" }])}>Thêm tham chiếu</Btn>}
        </div>
      </Field>
    </DialogShell>
  );
}

export function ApproveD65bDialog({ resolution, mode, onClose, onDone }: { resolution: D65bSummary; mode: "approve" | "resume" | "reject" | "handover"; onClose: () => void; onDone: (d: D65bDone) => void }) {
  const uid = useId();
  const [reason, setReason] = useState(mode === "resume" ? (resolution.approvalReason ?? "") : "");
  const [coi, setCoi] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const w = useMoneyWrite<ReturnType<typeof buildApprove>, unknown>(useAfterMoneyWrite());

  async function confirm() {
    const e = validateApprove({ reason, coi });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const send = mode === "reject" ? moneyExceptionApi.d65bReject : mode === "handover" ? moneyExceptionApi.d65bHandover : moneyExceptionApi.d65bApprove;
    const out = await w.submit(buildApprove({ reason, coi }), (key, body) => send(resolution.id, body, key));
    if (out.ok) {
      if (mode === "reject") onDone({ note: { tone: "info", title: "Đã từ chối đề xuất", text: "Đề xuất này đã đóng, không có khoản tiền nào được chuyển. Một quản trị viên có thể lập đề xuất mới sau khi kiểm tra lại bằng chứng." } });
      else onDone({ note: d65bResultNote(d65bExecutionOf(out.value.status, out.value.data), formatMoneyString, mode === "handover") });
    } else if (out.error?.kind === "validation" && out.error.fields.length > 0) setErrors(fieldErrorsOf(out.error));
  }

  return (
    <DialogShell
      testId={`d65b-${mode}-dialog`}
      title={mode === "resume" ? "Chạy lại việc ghi có đã duyệt" : mode === "reject" ? "Từ chối đề xuất này?" : mode === "handover" ? "Tiếp quản việc ghi có?" : "Duyệt đề xuất giải quyết khoản đang giữ"}
      description={
        mode === "resume"
          ? "Đề xuất đã được bạn duyệt nhưng sổ cái chưa xác nhận ghi có cho khách. Chạy lại cùng đề xuất; sổ cái chỉ ghi một lần."
          : mode === "reject" ? "Người lập đề xuất không thể tự từ chối. Từ chối không chuyển tiền; sau đó có thể lập đề xuất mới."
          : mode === "handover" ? "Chỉ tiếp quản khi người đã duyệt không còn là quản trị viên đang hoạt động. Máy chủ sẽ kiểm tra; người lập đề xuất không được tiếp quản."
          : "Bạn là người thứ hai. Sau khi duyệt, hệ thống ghi có cho khách qua sổ cái ngay."
      }
      notice={mode === "resume" ? NOTICE_RESUME : mode === "reject" ? "Từ chối không chuyển tiền và không xoá dấu vết đề xuất." : NOTICE_APPROVE_MONEY}
      confirmLabel={mode === "resume" ? "Chạy lại việc ghi có" : mode === "reject" ? "Từ chối đề xuất" : mode === "handover" ? "Tiếp quản và chạy tiếp" : "Duyệt và ghi có cho khách"}
      pendingLabel="Đang gửi…"
      danger
      write={w}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id={`${uid}-reason`} label={mode === "reject" ? "Lý do từ chối" : mode === "handover" ? "Lý do tiếp quản" : "Lý do duyệt"} error={errors.reason} count={reason.trim().length} max={LIMITS.reason}>
        <TextArea id={`${uid}-reason`} value={reason} rows={3} error={errors.reason} onChange={(v) => { setReason(v); setErrors((x) => ({ ...x, reason: "" })); w.clearError(); }} />
      </Field>
      <Check id={`${uid}-coi`} checked={coi} error={errors.coi} onChange={(v) => { setCoi(v); setErrors((x) => ({ ...x, coi: "" })); }} label="Tôi khai báo không có xung đột lợi ích: tôi không phải khách hay PT của hợp đồng này." />
      <MutedLine>Tiền chỉ về ví Gymini của khách và không có ô nhập số tiền: số tiền do sổ cái tính.</MutedLine>
    </DialogShell>
  );
}
