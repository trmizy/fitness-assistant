/**
 * D3 - Overview slot: assign (A4), transition (A6), request more (A7), classify (A8), PT-late issue (A10).
 * Server is the authority: the forms only decide what to SHOW. One POST per confirm, stable Idempotency-Key, nothing sent twice.
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { disputeCaseApi } from "../disputeCaseApi";
import { AWAITING_PARTIES_NOTE } from "../workspace/workspaceModel";
import { CASE_TYPE_LABEL, PT_LATE_FINDING_LABEL, PT_LATE_ISSUE_NOTE, caseStatusLabel } from "../disputeCaseLabels";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../disputeQueryKeys";
import { CLASSIFIABLE_TYPES, PT_LATE_FINDINGS, type CaseStatus } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import {
  ActionButton,
  ActionGroup,
  ButtonRow,
  ConfirmModal,
  ErrorBox,
  Field,
  FormCard,
  MutedLine,
  ResultNote,
  Select,
  SlotNotes,
  TextArea,
  counter,
  useCloseOnResult,
  useSlotNotes,
  useWrite,
  type PushNote,
} from "./actionKit";
import {
  LIMITS,
  assignBody,
  availability,
  transitionTargets,
  hasErrors,
  investigatorOnlyLine,
  issueBody,
  requestMoreBody,
  transitionBody,
  transitionNeedsReason,
  validateAssign,
  validateClassify,
  validateIssue,
  validateRequestMore,
  validateTransition,
  type Errors,
} from "./actionModel";
import { listAdminOptions } from "./adminDirectory";
import { CloseCard } from "./CloseActions";
import { ASSIGN_LIST_EMPTY, ASSIGN_LIST_FAILED, ASSIGN_NOTE, CLASSIFY_NOTE, CONFIRM_ASSIGN, CONFIRM_REJECT_INTAKE } from "./actionText";
import { shortRef } from "../workspace/format";

// ───────────────────────────────────────────────────────────── assign ──
function AssignForm({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const id = useId();
  const caseId = detail.case.id;
  const w = useWrite<{ investigatorId?: string }, { investigatorId: string; version: number }>(onChanged);
  const { keys } = useDisputeQueryKeys();
  const [others, setOthers] = useState(false);
  const [target, setTarget] = useState("");
  const [open, setOpen] = useState(false);
  const admins = useQuery({
    queryKey: keys ? [...keys.all, "admins"] : ["dispute-case", "disabled"],
    queryFn: () => listAdminOptions(currentUserId),
    enabled: !!keys && others,
    ...DISPUTE_QUERY_OPTIONS,
  });
  useCloseOnResult(open, setOpen, w);

  const mine = detail.case.investigatorId === currentUserId;
  const options = admins.data ?? [];
  const chosen = options.find((o) => o.id === target);
  const body = assignBody({ investigatorId: target });
  const errs: Errors = { ...w.fieldErrors, ...validateAssign({ investigatorId: target }) };
  const who = target ? chosen?.label ?? "Quản trị viên đã chọn" : "Bạn";

  async function confirm() {
    const r = await w.submit(body, (key, b) => disputeCaseApi.assign(caseId, b, key));
    if (r.ok) {
      setOpen(false);
      setTarget("");
    }
  }

  return (
    <FormCard title="Giao người phụ trách" caption={ASSIGN_NOTE} testId="d3-assign">
      <p className="text-sm text-adm-text" data-testid="d3-assign-current">
        Hiện tại: {detail.case.investigatorId ? (mine ? "bạn đang phụ trách" : `quản trị viên mã ${shortRef(detail.case.investigatorId)}`) : "chưa có người phụ trách"}.
      </p>
      {others ? (
        <Field id={`${id}-who`} label="Quản trị viên nhận hồ sơ" error={errs.investigatorId}>
          {admins.isLoading ? (
            <p className="text-sm text-adm-text-2" role="status" data-testid="d3-assign-loading">
              Đang tải danh sách quản trị viên…
            </p>
          ) : admins.isError ? (
            <div className="space-y-2" role="alert" data-testid="d3-assign-list-error">
              <p className="text-sm text-st-danger">{ASSIGN_LIST_FAILED}</p>
              <ActionButton variant="outline" onClick={() => void admins.refetch()} pending={admins.isFetching} testId="d3-assign-list-retry">
                Thử lại
              </ActionButton>
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-adm-text-2" data-testid="d3-assign-empty">
              {ASSIGN_LIST_EMPTY}
            </p>
          ) : (
            <Select
              id={`${id}-who`}
              value={target}
              onChange={(v) => {
                w.onEdit();
                setTarget(v);
              }}
              placeholder="Chọn quản trị viên…"
              options={options.map((o) => ({ value: o.id, label: o.label }))}
              error={errs.investigatorId}
            />
          )}
        </Field>
      ) : null}
      <ButtonRow>
        <ActionButton
          variant="primary"
          onClick={() => {
            setTarget("");
            setOpen(true);
          }}
          disabled={mine || w.mustReload}
          pending={w.pending && open}
          testId="d3-assign-self"
        >
          Nhận hồ sơ cho mình
        </ActionButton>
        {!others ? (
          <ActionButton variant="outline" onClick={() => setOthers(true)} testId="d3-assign-others">
            Giao cho quản trị viên khác
          </ActionButton>
        ) : (
          <ActionButton variant="outline" onClick={() => setOpen(true)} disabled={!target || w.mustReload} testId="d3-assign-send">
            Giao hồ sơ…
          </ActionButton>
        )}
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-assign-error" />}
      {w.result && !w.error && (
        <ResultNote testId="d3-assign-result">{w.result.investigatorId === currentUserId ? "Bạn đã nhận hồ sơ." : "Đã giao hồ sơ."}</ResultNote>
      )}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title={target ? "Giao hồ sơ cho quản trị viên khác?" : "Nhận hồ sơ cho mình?"}
        rows={[{ label: "Người nhận", value: who }]}
        notice={CONFIRM_ASSIGN}
        confirmLabel={target ? "Giao hồ sơ" : "Nhận hồ sơ"}
        pendingLabel="Đang ghi…"
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void confirm()}
        testId="d3-assign-dialog"
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d3-assign-dialog-error" />}
      />
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────── transition ──
function TransitionCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const status = detail.case.status;
  const targets = transitionTargets(detail);
  const w = useWrite<ReturnType<typeof transitionBody>, { from: string; to: string; version: number }>(onChanged);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useCloseOnResult(open, setOpen, w);

  const form = { to: to as never, reason, note };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateTransition(form, status, targets) : {}) };
  const isReject = transitionNeedsReason(to);

  async function send() {
    const r = await w.submit(transitionBody(form), (key, b) => disputeCaseApi.transition(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d3-transition-result", text: `Đã chuyển hồ sơ sang bước «${caseStatusLabel(r.value.to)}».` });
      setOpen(false);
      setTo("");
      setReason("");
      setNote("");
      setShown(false);
    }
  }
  function click() {
    setShown(true);
    if (hasErrors(validateTransition(form, status, targets))) return;
    if (isReject) setOpen(true);
    else void send();
  }

  return (
    <FormCard title="Chuyển bước" caption="Các bước gợi ý theo luật chuyển bước của hồ sơ; máy chủ vẫn kiểm lại." testId="d3-transition">
      <Field id={`${id}-to`} label="Chuyển tới" required error={errs.to}>
        <Select
          id={`${id}-to`}
          value={to}
          onChange={(v) => {
            w.onEdit();
            setTo(v);
          }}
          placeholder="Chọn bước…"
          options={targets.map((s: CaseStatus) => ({ value: s, label: s === "REJECTED_INTAKE" ? "Từ chối tiếp nhận" : caseStatusLabel(s) }))}
          error={errs.to}
        />
      </Field>
      {to === "AWAITING_PARTIES" && <MutedLine>{AWAITING_PARTIES_NOTE}</MutedLine>}
      {isReject ? (
        <Field id={`${id}-reason`} label="Lý do từ chối" required error={errs.reason} count={counter(reason)} max={LIMITS.transitionReason}>
          <TextArea id={`${id}-reason`} value={reason} onChange={(v) => { w.onEdit(); setReason(v); }} error={errs.reason} />
        </Field>
      ) : (
        <Field id={`${id}-note`} label="Ghi chú" error={errs.note} count={counter(note)} max={LIMITS.transitionNote}>
          <TextArea id={`${id}-note`} value={note} onChange={(v) => { w.onEdit(); setNote(v); }} error={errs.note} />
        </Field>
      )}
      <ButtonRow>
        <ActionButton variant={isReject ? "danger" : "primary"} onClick={click} disabled={w.mustReload} pending={w.pending && !open} testId="d3-transition-send">
          {isReject ? "Từ chối hồ sơ…" : "Chuyển bước"}
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-transition-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Từ chối hồ sơ?"
        rows={[{ label: "Lý do", value: reason.trim() }]}
        notice={CONFIRM_REJECT_INTAKE}
        confirmLabel="Từ chối hồ sơ"
        pendingLabel="Đang ghi…"
        danger
        pending={w.pending}
        confirmDisabled={w.mustReload}
        onConfirm={() => void send()}
        testId="d3-reject-intake-dialog"
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload().then(() => setOpen(false))} onRetry={w.retry} pending={w.pending} testId="d3-reject-intake-dialog-error" />}
      />
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────── request more ──
function RequestMoreCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const w = useWrite<ReturnType<typeof requestMoreBody>, { from: string; to: string; version: number }>(onChanged);
  const [to, setTo] = useState<"COLLECTING" | "AWAITING_PARTIES">("AWAITING_PARTIES");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const form = { to, note };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateRequestMore(form) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validateRequestMore(form))) return;
    const r = await w.submit(requestMoreBody(form), (key, b) => disputeCaseApi.requestMore(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d3-request-more-result", text: `Đã đưa hồ sơ sang bước «${caseStatusLabel(r.value.to)}».` });
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Yêu cầu bổ sung" caption="Đưa hồ sơ về bước thu thập để các bên bổ sung lời khai, bằng chứng." testId="d3-request-more">
      <Field id={`${id}-to`} label="Chuyển hồ sơ sang" required>
        <Select
          id={`${id}-to`}
          value={to}
          onChange={(v) => {
            w.onEdit();
            setTo(v as "COLLECTING" | "AWAITING_PARTIES");
          }}
          options={[
            { value: "AWAITING_PARTIES", label: caseStatusLabel("AWAITING_PARTIES") },
            { value: "COLLECTING", label: caseStatusLabel("COLLECTING") },
          ]}
        />
      </Field>
      {to === "AWAITING_PARTIES" && <MutedLine>{AWAITING_PARTIES_NOTE}</MutedLine>}
      <Field id={`${id}-note`} label="Cần bổ sung gì" required error={errs.note} count={counter(note)} max={LIMITS.requestMoreNote}>
        <TextArea id={`${id}-note`} value={note} onChange={(v) => { w.onEdit(); setNote(v); }} error={errs.note} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-request-more-send">
          Gửi yêu cầu bổ sung
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-request-more-error" />
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────────── classify ──
function ClassifyCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const w = useWrite<{ type: string }, { from: string; to: string; version: number }>(onChanged);
  const [type, setType] = useState("");
  const [shown, setShown] = useState(false);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateClassify(type) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validateClassify(type))) return;
    const r = await w.submit({ type }, (key) => disputeCaseApi.classify(detail.case.id, type as (typeof CLASSIFIABLE_TYPES)[number], key));
    if (r.ok) {
      push({ tone: "success", testId: "d3-classify-result", text: "Đã phân loại hồ sơ." });
      setType("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Phân loại hồ sơ" caption={CLASSIFY_NOTE} testId="d3-classify">
      <Field id={`${id}-type`} label="Loại khiếu nại" required error={errs.type}>
        <Select
          id={`${id}-type`}
          value={type}
          onChange={(v) => {
            w.onEdit();
            setType(v);
          }}
          placeholder="Chọn loại…"
          options={CLASSIFIABLE_TYPES.map((t) => ({ value: t, label: CASE_TYPE_LABEL[t] }))}
          error={errs.type}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-classify-send">
          Phân loại
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-classify-error" />
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────────── PT late ──
function IssueCard({ detail, onChanged }: ActionSlotProps) {
  const id = useId();
  const w = useWrite<ReturnType<typeof issueBody>, { id: string }>(onChanged);
  const [finding, setFinding] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const form = { finding: finding as never, note };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateIssue(form) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validateIssue(form))) return;
    const r = await w.submit(issueBody(form), (key, b) => disputeCaseApi.addIssue(detail.case.id, b, key));
    if (r.ok) {
      setFinding("");
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Ghi vấn đề «PT đến muộn»" caption={PT_LATE_ISSUE_NOTE} testId="d3-issue">
      <Field id={`${id}-finding`} label="Kết quả xác minh" required error={errs.finding}>
        <Select
          id={`${id}-finding`}
          value={finding}
          onChange={(v) => {
            w.onEdit();
            setFinding(v);
          }}
          placeholder="Chọn kết quả…"
          options={PT_LATE_FINDINGS.map((f) => ({ value: f, label: PT_LATE_FINDING_LABEL[f] }))}
          error={errs.finding}
        />
      </Field>
      <Field id={`${id}-note`} label="Ghi chú" error={errs.note} count={counter(note)} max={LIMITS.issueNote}>
        <TextArea id={`${id}-note`} value={note} onChange={(v) => { w.onEdit(); setNote(v); }} error={errs.note} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-issue-send">
          Ghi nhận
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-issue-error" />
      {w.result && !w.error && <ResultNote testId="d3-issue-result">Đã ghi nhận. Việc này không kích hoạt bồi thường.</ResultNote>}
    </FormCard>
  );
}

// ───────────────────────────────────────────────────────────── slot ──
export function OverviewActions(props: ActionSlotProps) {
  const { detail, currentUserId } = props;
  const { notes, push } = useSlotNotes();
  const a = availability(detail, currentUserId);
  const line = investigatorOnlyLine(detail, currentUserId);
  if (!a.signedIn) return null;
  return (
    <ActionGroup title="Thao tác" testId="d3-actions-overview">
      {line && <MutedLine testId="d3-who-may-act">{line}</MutedLine>}
      <SlotNotes notes={notes} />
      {a.terminal ? null : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {a.assign && <AssignForm {...props} />}
          {a.transition && <TransitionCard {...props} push={push} />}
          {a.requestMore && <RequestMoreCard {...props} push={push} />}
          {a.classify && <ClassifyCard {...props} push={push} />}
          {a.addIssue && <IssueCard {...props} />}
          {a.closeOrphan && <CloseCard kind="orphan" {...props} push={push} />}
        </div>
      )}
    </ActionGroup>
  );
}
