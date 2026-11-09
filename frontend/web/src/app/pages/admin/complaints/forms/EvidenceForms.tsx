/**
 * D6 - writes that add to the file of a gym case: a claim (G9), a statement received on behalf of the member (G16), a document received on
 * behalf of the member (G17, the sha256 is only DECLARED) and a share with the member (G15, cannot be withdrawn).
 */
import { useId, useRef, useState } from "react";
import { gymCaseApi } from "../gymCaseApi";
import {
  LIMITS,
  adminStatementNeedsSupplement,
  documentBody,
  hasErrors,
  shareableEvidence,
  shareableStatements,
  statementBody,
  textError,
  validateClaim,
  validateDocument,
  validateStatement,
  type DocumentForm,
  type Errors,
} from "../gymCaseModel";
import { DECLARED_HASH_NOTE } from "../gymCaseLabels";
import { HASH_MESSAGE, sha256OfFile } from "../gymSha256";
import type { GymCreatedId, GymStatementResult } from "../gymCaseTypes";
import { ActionButton, ButtonRow, Check, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, Select, TextArea, TextInput, counter, useCloseOnResult, useGymWrite } from "../gymCaseKit";
import type { FormProps } from "./formTypes";

export function ClaimCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ claimantRole: string; text: string }, GymCreatedId>(onChanged);
  const [role, setRole] = useState("MEMBER");
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const v = validateClaim({ claimantRole: role, text });
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(v)) return;
    const r = await w.submit({ claimantRole: role, text: text.trim() }, (key, b) => gymCaseApi.addClaim(detail.case.id, { claimantRole: b.claimantRole as "MEMBER" | "ADMIN_ON_BEHALF", text: b.text }, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-claim-done", text: "Đã ghi khẳng định. Khẳng định nào cũng phải được đánh giá trước khi ghi kết luận." });
      setText("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Ghi khẳng định" caption="Mỗi điều hội viên nêu (hoặc admin ghi hộ) là một khẳng định. Điều tra viên sẽ đánh giá từng khẳng định ở mục này." testId="d6-claim">
      <Field id={`${id}-role`} label="Ai nêu khẳng định" required error={errs.claimantRole}>
        <Select
          id={`${id}-role`}
          value={role}
          onChange={setRole}
          options={[
            { value: "MEMBER", label: "Hội viên nêu" },
            { value: "ADMIN_ON_BEHALF", label: "Admin ghi hộ hội viên" },
          ]}
        />
      </Field>
      <Field id={`${id}-text`} label="Nội dung khẳng định" required error={errs.text} count={counter(text)} max={LIMITS.claim}>
        <TextArea
          id={`${id}-text`}
          value={text}
          onChange={(x) => {
            w.onEdit();
            setText(x);
          }}
          error={errs.text}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-claim-send">
          Ghi khẳng định
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-claim-error" />
    </FormCard>
  );
}

export function StatementOnBehalfCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const needsSupplement = adminStatementNeedsSupplement(detail.statements);
  const w = useGymWrite<{ text: string; supplementReason?: string }, GymStatementResult>(onChanged);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const v = validateStatement({ text, supplementReason: reason }, needsSupplement);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(v)) return;
    const r = await w.submit(statementBody({ text, supplementReason: reason }, needsSupplement), (key, b) => gymCaseApi.statementOnBehalf(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-stmt-done", text: "Đã ghi lời khai nhận hộ hội viên." });
      setText("");
      setReason("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Nhận lời khai hộ hội viên" caption="Dùng khi hội viên nói lời khai ngoài ứng dụng (qua điện thoại, tại quầy). Lời khai được ghi là «admin nhận hộ»." testId="d6-stmt-behalf">
      <Field id={`${id}-text`} label="Nội dung lời khai" required error={errs.text} count={counter(text)} max={LIMITS.statement}>
        <TextArea
          id={`${id}-text`}
          value={text}
          onChange={(x) => {
            w.onEdit();
            setText(x);
          }}
          error={errs.text}
        />
      </Field>
      {needsSupplement && (
        <Field id={`${id}-reason`} label="Lý do bổ sung" required error={errs.supplementReason} count={counter(reason)} max={LIMITS.supplement} hint="Đã có lời khai nhận hộ trước đó nên lần này cần ghi lý do bổ sung.">
          <TextArea
            id={`${id}-reason`}
            value={reason}
            rows={2}
            onChange={(x) => {
              w.onEdit();
              setReason(x);
            }}
            error={errs.supplementReason}
            hint
          />
        </Field>
      )}
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-stmt-send">
          Ghi lời khai
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-stmt-error" />
    </FormCard>
  );
}

export function EvidenceOnBehalfCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<ReturnType<typeof documentBody>, GymCreatedId>(onChanged);
  const [f, setF] = useState<DocumentForm>({ description: "", sha256: "", title: "", fileName: "" });
  const [shown, setShown] = useState(false);
  const [hashNote, setHashNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const v = validateDocument(f);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };
  const set = (patch: Partial<DocumentForm>) => {
    w.onEdit();
    setF((cur) => ({ ...cur, ...patch }));
  };

  async function pick(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    setHashNote(null);
    const r = await sha256OfFile(chosen);
    if (r.status === "ok") set({ sha256: r.hex, fileName: f.fileName || chosen.name.slice(0, LIMITS.fileName) });
    else setHashNote(HASH_MESSAGE[r.status]);
    if (file.current) file.current.value = "";
  }

  async function send() {
    setShown(true);
    if (hasErrors(v)) return;
    const r = await w.submit(documentBody(f), (key, b) => gymCaseApi.evidenceOnBehalf(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-doc-done", text: "Đã ghi tài liệu nhận hộ. Mã sha256 là lời khai của người nộp, hệ thống chưa kiểm chứng tệp." });
      setF({ description: "", sha256: "", title: "", fileName: "" });
      setShown(false);
    }
  }

  return (
    <FormCard title="Nhận tài liệu hộ hội viên" caption={`Hệ thống không nhận tệp ở bước này, chỉ ghi mô tả và mã sha256. ${DECLARED_HASH_NOTE}`} testId="d6-doc-behalf">
      <Field id={`${id}-desc`} label="Mô tả tài liệu" required error={errs.description} count={counter(f.description)} max={LIMITS.description}>
        <TextArea id={`${id}-desc`} value={f.description} rows={3} onChange={(x) => set({ description: x })} error={errs.description} />
      </Field>
      <Field id={`${id}-sha`} label="Mã sha256 của tệp" required error={errs.sha256} hint="64 ký tự thập lục phân. Hoặc chọn tệp trên máy để trình duyệt tự tính (tệp không được gửi đi).">
        <TextInput id={`${id}-sha`} value={f.sha256} onChange={(x) => set({ sha256: x })} error={errs.sha256} hint mono maxLength={80} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-adm-border bg-adm-surface px-4 text-sm font-semibold text-adm-text focus-within:outline-2 focus-within:outline-[var(--adm-focus)] hover:bg-adm-surface-2 xl:min-h-9">
          Chọn tệp để tính mã
          <input ref={file} type="file" className="sr-only" onChange={(e) => void pick(e.target.files)} data-testid="d6-doc-file" />
        </label>
      </div>
      {hashNote && <MutedLine testId="d6-doc-hash-note">{hashNote}</MutedLine>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={`${id}-title`} label="Tiêu đề (không bắt buộc)" error={errs.title}>
          <TextInput id={`${id}-title`} value={f.title} onChange={(x) => set({ title: x })} error={errs.title} />
        </Field>
        <Field id={`${id}-file`} label="Tên tệp (không bắt buộc)" error={errs.fileName}>
          <TextInput id={`${id}-file`} value={f.fileName} onChange={(x) => set({ fileName: x })} error={errs.fileName} />
        </Field>
      </div>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-doc-send">
          Ghi tài liệu
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-doc-error" />
    </FormCard>
  );
}

/** Share ONE item with the member. Only the member can receive a share (the gym is not a party), so there is no recipient field. */
export function ShareCard({ detail, onChanged, push, kind }: FormProps & { kind: "evidence" | "statement" }) {
  const id = useId();
  const choices = kind === "evidence" ? shareableEvidence(detail) : shareableStatements(detail);
  const w = useGymWrite<{ kind: string; itemId: string; reason: string }, GymCreatedId>(onChanged);
  const [item, setItem] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const errs: Errors = {
    ...w.fieldErrors,
    ...(shown && !item ? { item: "Chọn mục cần chia sẻ." } : {}),
    ...(shown && textError(reason, LIMITS.reason, true) ? { reason: textError(reason, LIMITS.reason, true)! } : {}),
  };
  useCloseOnResult(open, setOpen, w);
  const noun = kind === "evidence" ? "bằng chứng" : "lời khai";

  async function confirm() {
    const r = await w.submit({ kind, itemId: item, reason: reason.trim() }, (key, b) =>
      gymCaseApi.share(detail.case.id, kind === "evidence" ? { evidenceId: b.itemId, reason: b.reason } : { statementId: b.itemId, reason: b.reason }, key),
    );
    if (r.ok) {
      push({ tone: "success", testId: "d6-share-done", text: `Đã chia sẻ ${noun} cho hội viên. Không thu hồi được.` });
      setOpen(false);
      setItem("");
      setReason("");
      setAck(false);
      setShown(false);
    }
  }

  return (
    <FormCard
      title={`Chia sẻ ${noun} cho hội viên`}
      caption="Hội viên chỉ thấy phần bạn chia sẻ, kèm lý do bạn ghi. Chủ phòng tập không phải một bên của hồ sơ nên không có người nhận nào khác."
      testId={`d6-share-${kind}`}
    >
      {choices.length === 0 ? (
        <MutedLine>{kind === "evidence" ? "Chưa có bằng chứng nào chia sẻ được." : "Chưa có lời khai nào do admin nhận hộ để chia sẻ."}</MutedLine>
      ) : (
        <>
          <Field id={`${id}-item`} label={`Chọn ${noun}`} required error={errs.item}>
            <Select id={`${id}-item`} value={item} onChange={setItem} options={choices.map((c) => ({ value: c.id, label: c.label }))} placeholder="Chọn…" error={errs.item} />
          </Field>
          <Field id={`${id}-reason`} label="Lý do chia sẻ" required error={errs.reason} count={counter(reason)} max={LIMITS.reason}>
            <TextArea id={`${id}-reason`} value={reason} rows={2} onChange={(x) => setReason(x)} error={errs.reason} />
          </Field>
          <ButtonRow>
            <ActionButton
              variant="outline"
              onClick={() => {
                setShown(true);
                if (item && !textError(reason, LIMITS.reason, true)) setOpen(true);
              }}
              testId={`d6-share-${kind}-open`}
            >
              Chia sẻ…
            </ActionButton>
          </ButtonRow>
        </>
      )}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Chia sẻ ${noun} cho hội viên`}
        rows={[{ label: "Lý do", value: reason.trim() }]}
        notice="Không thể thu hồi."
        confirmLabel="Chia sẻ"
        pendingLabel="Đang chia sẻ…"
        confirmDisabled={!ack}
        pending={w.pending}
        onConfirm={() => void confirm()}
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId={`d6-share-${kind}-error`} />}
        testId={`d6-share-${kind}-dialog`}
      >
        <Check id={`${id}-ack`} checked={ack} onChange={setAck} label={`Tôi hiểu hội viên sẽ thấy ${noun} này và việc chia sẻ không thu hồi được.`} />
      </ConfirmModal>
    </FormCard>
  );
}
