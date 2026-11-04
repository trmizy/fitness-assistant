/**
 * D6 - investigation controls of a gym case: assign (G5), not accepting at intake and the step changes (G6), request more (G7),
 * recollect (G8) and acknowledge an evidence change (G14). Each form is drawn only when the server's `allowedActions` allows it.
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { listAdminOptions } from "../../disputes/actions/adminDirectory";
import { gymCaseApi } from "../gymCaseApi";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../gymCaseQueryKeys";
import { LIMITS, STEP_VERB, textError, transitionTargets, type Errors } from "../gymCaseModel";
import { gymStatusLabel } from "../gymCaseLabels";
import type { GymAssignResult } from "../gymCaseTypes";
import { ActionButton, ButtonRow, ConfirmModal, ErrorBox, Field, FormCard, ResultNote, Select, TextArea, counter, useCloseOnResult, useGymWrite } from "../gymCaseKit";
import type { FormProps } from "./formTypes";

const TARGET_STATUS_LABEL = (s: string) => gymStatusLabel(s);

export function AssignCard({ detail, currentUserId, onChanged, push }: FormProps) {
  const id = useId();
  const { keys } = useGymQueryKeys();
  const w = useGymWrite<{ investigatorId?: string }, GymAssignResult>(onChanged);
  const [pick, setPick] = useState("");
  const [target, setTarget] = useState<{ investigatorId?: string; label: string } | null>(null);
  const options = useQuery({
    queryKey: keys ? keys.adminOptions() : ["gym-complaint", "disabled"],
    queryFn: () => listAdminOptions(currentUserId),
    enabled: !!keys,
    ...GYM_QUERY_OPTIONS,
  });
  useCloseOnResult(!!target, (v) => !v && setTarget(null), w);
  const mine = detail.case.investigatorId === currentUserId;
  const choices = (options.data ?? []).filter((o) => o.id !== detail.case.investigatorId);

  async function confirm() {
    if (!target) return;
    const r = await w.submit(target.investigatorId ? { investigatorId: target.investigatorId } : {}, (key, b) => gymCaseApi.assign(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-assign-done", text: target.investigatorId ? `Đã giao hồ sơ cho ${target.label}.` : "Bạn đã nhận hồ sơ này." });
      setTarget(null);
      setPick("");
    }
  }

  return (
    <FormCard
      title="Giao người phụ trách"
      caption="Người phụ trách làm các bước điều tra. Chỉ chọn được quản trị viên có trong danh sách; máy chủ kiểm lại người đó là quản trị viên đang hoạt động."
      testId="d6-assign"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field id={`${id}-pick`} label="Quản trị viên" hint={options.isError ? "Chưa lấy được danh sách quản trị viên. Bạn vẫn nhận hồ sơ cho mình được." : undefined}>
          <Select
            id={`${id}-pick`}
            value={pick}
            onChange={setPick}
            options={choices.map((o) => ({ value: o.id, label: o.label }))}
            placeholder={options.isLoading ? "Đang tải danh sách…" : choices.length === 0 ? "Không có quản trị viên nào khác" : "Chọn quản trị viên"}
            disabled={options.isLoading || choices.length === 0}
          />
        </Field>
        <ActionButton
          variant="outline"
          disabled={!pick}
          onClick={() => {
            const o = choices.find((c) => c.id === pick);
            if (o) setTarget({ investigatorId: o.id, label: o.label });
          }}
          testId="d6-assign-other"
        >
          Giao cho người đã chọn
        </ActionButton>
      </div>
      {!mine && (
        <ButtonRow>
          <ActionButton onClick={() => setTarget({ label: "bạn" })} testId="d6-assign-self">
            Nhận hồ sơ cho mình
          </ActionButton>
        </ButtonRow>
      )}
      <ConfirmModal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Giao người phụ trách"
        rows={[{ label: "Người nhận", value: target?.label ?? "" }]}
        notice="Người nhận sẽ có quyền làm mọi bước điều tra của hồ sơ này."
        confirmLabel="Xác nhận giao"
        pendingLabel="Đang giao…"
        pending={w.pending}
        onConfirm={() => void confirm()}
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-assign-error" />}
        testId="d6-assign-dialog"
      />
    </FormCard>
  );
}

export function RejectIntakeCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ reason: string }, { status: string }>(onChanged);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const err = textError(reason, LIMITS.reason, true);
  const errs: Errors = { ...w.fieldErrors, ...(shown && err ? { reason: err } : {}) };
  useCloseOnResult(open, setOpen, w);

  async function confirm() {
    const r = await w.submit({ reason: reason.trim() }, (key, b) => gymCaseApi.transition(detail.case.id, { to: "REJECTED_INTAKE", reason: b.reason }, key));
    if (r.ok) {
      push({ tone: "info", testId: "d6-reject-done", text: "Đã không tiếp nhận hồ sơ. Khiếu nại quay lại luồng xử lý cũ." });
      setOpen(false);
    }
  }

  return (
    <FormCard title="Không tiếp nhận hồ sơ" caption="Dùng khi khiếu nại không cần xử lý thành hồ sơ. Khiếu nại quay lại luồng xử lý cũ và không mở lại hồ sơ thứ hai được." testId="d6-reject-intake">
      <Field id={`${id}-reason`} label="Lý do không tiếp nhận" required error={errs.reason} count={counter(reason)} max={LIMITS.reason}>
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
        <ActionButton
          variant="danger"
          onClick={() => {
            setShown(true);
            if (!err) setOpen(true);
          }}
          testId="d6-reject-intake-open"
        >
          Không tiếp nhận…
        </ActionButton>
      </ButtonRow>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Không tiếp nhận hồ sơ"
        rows={[{ label: "Lý do", value: reason.trim() }]}
        notice="Hồ sơ đóng vĩnh viễn."
        danger
        confirmLabel="Không tiếp nhận"
        pendingLabel="Đang gửi…"
        pending={w.pending}
        onConfirm={() => void confirm()}
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-reject-error" />}
        testId="d6-reject-dialog"
      />
    </FormCard>
  );
}

export function TransitionCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const targets = transitionTargets(detail.case.status);
  const w = useGymWrite<{ to: string; reason: string }, { status: string }>(onChanged);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const errs: Errors = { ...w.fieldErrors, ...(shown && !to ? { to: "Chọn bước muốn chuyển tới." } : {}), ...(shown && reason.trim() ? (textError(reason, LIMITS.reason, false) ? { reason: textError(reason, LIMITS.reason, false)! } : {}) : {}) };

  async function send() {
    setShown(true);
    if (!to || textError(reason, LIMITS.reason, false)) return;
    const r = await w.submit({ to, reason: reason.trim() }, (key, b) => gymCaseApi.transition(detail.case.id, { to: b.to as "COLLECTING" | "AWAITING_PARTIES" | "ASSESSING", reason: b.reason || undefined }, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-transition-done", text: `Đã chuyển hồ sơ sang bước «${TARGET_STATUS_LABEL(to)}».` });
      setTo("");
      setReason("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Chuyển bước xử lý" caption="Chỉ các bước nối trực tiếp với bước hiện tại. Ghi kết luận, đề xuất và duyệt có form riêng ở các mục sau." testId="d6-transition">
      <Field id={`${id}-to`} label="Chuyển tới" required error={errs.to}>
        <Select
          id={`${id}-to`}
          value={to}
          onChange={(v) => {
            w.onEdit();
            setTo(v);
          }}
          options={targets.map((t) => ({ value: t, label: STEP_VERB[t] ?? TARGET_STATUS_LABEL(t) }))}
          placeholder="Chọn bước"
          error={errs.to}
        />
      </Field>
      <Field id={`${id}-reason`} label="Ghi chú (không bắt buộc)" error={errs.reason} count={counter(reason)} max={LIMITS.reason}>
        <TextArea
          id={`${id}-reason`}
          value={reason}
          rows={2}
          onChange={(v) => {
            w.onEdit();
            setReason(v);
          }}
          error={errs.reason}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-transition-send">
          Chuyển bước
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-transition-error" />
    </FormCard>
  );
}

export function RequestMoreCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ to: "COLLECTING" | "AWAITING_PARTIES"; note: string }, { status: string }>(onChanged);
  const [to, setTo] = useState<"COLLECTING" | "AWAITING_PARTIES">("AWAITING_PARTIES");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const err = textError(note, LIMITS.note, true);
  const errs: Errors = { ...w.fieldErrors, ...(shown && err ? { note: err } : {}) };

  async function send() {
    setShown(true);
    if (err) return;
    const r = await w.submit({ to, note: note.trim() }, (key, b) => gymCaseApi.requestMore(detail.case.id, b, key));
    if (r.ok) {
      push({
        tone: "success",
        testId: "d6-more-done",
        text: to === "AWAITING_PARTIES" ? "Đã yêu cầu hội viên bổ sung. Hội viên nhận thông báo trong ứng dụng." : "Đã đưa hồ sơ về bước thu thập bằng chứng.",
      });
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Yêu cầu bổ sung" caption="Hỏi thêm hội viên (họ được báo trong ứng dụng) hoặc quay lại thu thập bằng chứng." testId="d6-request-more">
      <Field id={`${id}-to`} label="Bước tiếp theo" required>
        <Select
          id={`${id}-to`}
          value={to}
          onChange={(v) => setTo(v === "COLLECTING" ? "COLLECTING" : "AWAITING_PARTIES")}
          options={[
            { value: "AWAITING_PARTIES", label: "Chờ hội viên bổ sung thông tin" },
            { value: "COLLECTING", label: "Quay lại thu thập bằng chứng" },
          ]}
        />
      </Field>
      <Field id={`${id}-note`} label="Cần hội viên bổ sung điều gì" required error={errs.note} count={counter(note)} max={LIMITS.note}>
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
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-more-send">
          Gửi yêu cầu
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-more-error" />
    </FormCard>
  );
}

export function RecollectCard({ detail, onChanged }: FormProps) {
  const w = useGymWrite<Record<string, never>, { changed: string[] }>(onChanged);
  return (
    <FormCard
      title="Thu lại bằng chứng"
      caption="Đọc lại các nguồn của hệ thống (khiếu nại, gói hội viên, phòng tập, check-in). Chỉ thêm phiên bản mới cho nguồn có nội dung đã đổi; bản cũ vẫn được giữ."
      testId="d6-recollect"
    >
      <ButtonRow>
        <ActionButton variant="outline" onClick={() => void w.submit({}, (key) => gymCaseApi.recollect(detail.case.id, key))} disabled={w.mustReload} pending={w.pending} testId="d6-recollect-send">
          <ArrowClockwiseIcon className="size-4" aria-hidden /> Thu lại bằng chứng
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-recollect-error" />
      {w.result && !w.error && (
        <ResultNote testId="d6-recollect-result">{w.result.changed.length > 0 ? `Đã thu lại: ${w.result.changed.length} nguồn có nội dung mới.` : "Đã thu lại: không có nguồn nào thay đổi."}</ResultNote>
      )}
    </FormCard>
  );
}

export function AckCard({ detail, onChanged }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ note: string }, { acknowledged: boolean }>(onChanged);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const err = textError(note, LIMITS.note, true);
  const errs: Errors = { ...w.fieldErrors, ...(shown && err ? { note: err } : {}) };

  async function send() {
    setShown(true);
    if (err) return;
    const r = await w.submit({ note: note.trim() }, (key, b) => gymCaseApi.acknowledgeEvidenceChange(detail.case.id, b, key));
    if (r.ok) {
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard
      title="Xác nhận thay đổi bằng chứng"
      caption="Dùng khi người duyệt báo bằng chứng đã đổi sau khi lập đề xuất. Nếu nguồn đã đổi mà chưa thu lại, hãy thu lại bằng chứng trước: khi đó không xác nhận cho qua được."
      testId="d6-ack"
    >
      <Field id={`${id}-note`} label="Ghi chú xác nhận" required error={errs.note} count={counter(note)} max={LIMITS.note}>
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
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-ack-send">
          Ghi xác nhận
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-ack-error" />
      {w.result && !w.error && <ResultNote testId="d6-ack-result">Đã ghi xác nhận. Người duyệt tải lại hồ sơ, tích ô xác nhận rồi gửi lại.</ResultNote>}
    </FormCard>
  );
}

