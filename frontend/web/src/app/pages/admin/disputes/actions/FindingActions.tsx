/**
 * D3 - Findings slot: record a finding (A12, ASSESSING) with the consequence of the selected finding, and propose (A13, FINDING_RECORDED).
 * A proposal carries a note only: no outcome, no amount (the server computes both). A13 answers HTTP 201 in two shapes; the "no proposal"
 * one (`kind: "POLICY_PENDING"`) is NOT a success and is worded from the labels file, never from the server's `reason` / `nextStep`.
 */
import { useId, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { FINDING_LABEL, OUTCOME_LABEL, POLICY_PENDING_NO_PROPOSAL, caseStatusLabel, findingLabel } from "../disputeCaseLabels";
import { FINDING_KINDS, type ProposeResult, type RecordFindingResult } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { latestFinding, blockedText } from "../workspace/workspaceModel";
import { CloseCard } from "./CloseActions";
import { ActionButton, ActionGroup, ButtonRow, ErrorBox, Field, FormCard, MutedLine, Select, SlotNotes, TextArea, counter, useSlotNotes, useWrite, type PushNote } from "./actionKit";
import {
  LIMITS,
  availability,
  consequenceFor,
  findingBody,
  hasErrors,
  investigatorOnlyLine,
  proposalBody,
  unassessedClaims,
  validateFinding,
  validateProposal,
  type Errors,
} from "./actionModel";
import { FINDING_PREREQ_NOTE, PROPOSE_DONE, PROPOSE_NOT_A_DISPUTE, PROPOSE_ONLY_NOTE } from "./actionText";

function ConsequenceBox({ finding }: { finding: (typeof FINDING_KINDS)[number] }) {
  const c = consequenceFor(finding);
  return (
    <div className="space-y-1 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d3-consequence" data-finding={finding}>
      <p className="text-xs font-semibold text-adm-text-2">Kết quả và hệ quả (minh hoạ, máy chủ tính lại khi lập đề xuất)</p>
      <p className="text-adm-text">
        <span className="font-medium">Kết quả:</span> {c.outcomeLabel}
      </p>
      <p className="break-words text-adm-text">
        <span className="font-medium">Hệ quả:</span> {c.consequence}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── finding ──
function RecordFindingCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const w = useWrite<ReturnType<typeof findingBody>, RecordFindingResult>(onChanged);
  const [finding, setFinding] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [shown, setShown] = useState(false);
  const form = { finding: finding as never, reasoning };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateFinding(form) : {}) };
  const missing = unassessedClaims(detail);

  async function send() {
    setShown(true);
    if (hasErrors(validateFinding(form))) return;
    const r = await w.submit(findingBody(form), (key, b) => disputeCaseApi.recordFinding(detail.case.id, b, key));
    if (r.ok) {
      const v = r.value;
      push({
        tone: v.blocked ? "warning" : "success",
        testId: "d3-finding-result",
        text: v.blocked
          ? "Đã ghi kết luận, nhưng chưa có thiết kế xử lý cho kết luận này nên chưa lập được đề xuất."
          : v.caseStatus === "POLICY_PENDING"
            ? `Đã ghi kết luận «${findingLabel(v.finding)}». Hồ sơ chuyển sang «${caseStatusLabel(v.caseStatus)}»; chưa có đề xuất nào.`
            : `Đã ghi kết luận «${findingLabel(v.finding)}». Bước tiếp theo: lập đề xuất.`,
      });
      setFinding("");
      setReasoning("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Ghi kết luận" caption={FINDING_PREREQ_NOTE} testId="d3-finding">
      {(detail.claims ?? []).length === 0 ? (
        <MutedLine testId="d3-finding-no-claims">Hồ sơ chưa có khẳng định nào. Thêm và đánh giá khẳng định ở tab Đánh giá trước.</MutedLine>
      ) : missing.length > 0 ? (
        <MutedLine testId="d3-finding-unassessed">Còn {missing.length} khẳng định chưa được đánh giá. Máy chủ sẽ từ chối kết luận (trừ «Không phải khiếu nại»).</MutedLine>
      ) : null}
      <Field id={`${id}-f`} label="Kết luận" required error={errs.finding}>
        <Select
          id={`${id}-f`}
          value={finding}
          onChange={(v) => {
            w.onEdit();
            setFinding(v);
          }}
          placeholder="Chọn kết luận…"
          options={FINDING_KINDS.map((f) => ({ value: f, label: FINDING_LABEL[f] }))}
          error={errs.finding}
        />
      </Field>
      {finding && (FINDING_KINDS as readonly string[]).includes(finding) && <ConsequenceBox finding={finding as (typeof FINDING_KINDS)[number]} />}
      <Field id={`${id}-r`} label="Lý do kết luận" required error={errs.reasoning} count={counter(reasoning)} max={LIMITS.findingReasoning}>
        <TextArea
          id={`${id}-r`}
          value={reasoning}
          onChange={(v) => {
            w.onEdit();
            setReasoning(v);
          }}
          error={errs.reasoning}
          rows={4}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-finding-send">
          Ghi kết luận
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-finding-error" />
    </FormCard>
  );
}

// ─────────────────────────────────────────────────────────── propose ──
function ProposeCard({ detail, onChanged, push }: ActionSlotProps & { push: PushNote }) {
  const id = useId();
  const w = useWrite<ReturnType<typeof proposalBody>, ProposeResult>(onChanged);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const form = { note };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateProposal(form) : {}) };
  const newest = latestFinding(detail.findings);
  const view = newest ? consequenceFor(newest.finding) : null;
  const impossible = !!view && !view.proposalPossible && newest?.finding === "NOT_A_DISPUTE";

  async function send() {
    setShown(true);
    if (hasErrors(validateProposal(form))) return;
    const r = await w.submit(proposalBody(form), (key, b) => disputeCaseApi.propose(detail.case.id, b, key));
    if (r.ok) {
      const v = r.value;
      // F4: a proposal exists only when the server said proposalCreated:true (the client maps anything else to POLICY_PENDING or an error).
      if (v.kind === "POLICY_PENDING") push({ tone: "warning", testId: "d3-propose-policy-pending", text: POLICY_PENDING_NO_PROPOSAL });
      else {
        const blocked = v.proposal.executionBlockedReason ? blockedText(v.proposal.executionBlockedReason, false) : null;
        push({ tone: "success", testId: "d3-propose-result", text: `${PROPOSE_DONE} Kết quả đề xuất: ${OUTCOME_LABEL[v.proposal.outcome] ?? "kết quả khác"}.${blocked ? ` ${blocked}` : ""}` });
      }
      setNote("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Lập đề xuất" caption={PROPOSE_ONLY_NOTE} testId="d3-propose">
      {newest ? (
        <div className="space-y-1.5 text-sm" data-testid="d3-propose-finding">
          <p className="text-adm-text">
            <span className="font-medium">Kết luận hiện tại:</span> {findingLabel(newest.finding)}
          </p>
          {view && <ConsequenceBox finding={newest.finding} />}
        </div>
      ) : (
        <MutedLine>Hồ sơ chưa có kết luận.</MutedLine>
      )}
      {impossible && <MutedLine testId="d3-propose-impossible">{PROPOSE_NOT_A_DISPUTE}</MutedLine>}
      <Field id={`${id}-n`} label="Ghi chú cho người duyệt" error={errs.note} count={counter(note)} max={LIMITS.proposalNote}>
        <TextArea
          id={`${id}-n`}
          value={note}
          onChange={(v) => {
            w.onEdit();
            setNote(v);
          }}
          error={errs.note}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload || impossible || !newest} pending={w.pending} testId="d3-propose-send">
          Lập đề xuất
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-propose-error" />
    </FormCard>
  );
}

export function FindingActions(props: ActionSlotProps) {
  const { detail, currentUserId } = props;
  const { notes, push } = useSlotNotes();
  const a = availability(detail, currentUserId);
  if (!a.signedIn || a.terminal) return null;
  const line = investigatorOnlyLine(detail, currentUserId);
  return (
    <ActionGroup title="Thao tác kết luận và đề xuất" testId="d3-actions-findings">
      {line && <MutedLine testId="d3-who-may-act">{line}</MutedLine>}
      <SlotNotes notes={notes} />
      <div className="grid grid-cols-1 items-start gap-4">
        {a.recordFinding && <RecordFindingCard {...props} push={push} />}
        {a.propose && <ProposeCard {...props} push={push} />}
        {a.closeNotADispute && <CloseCard kind="notADispute" {...props} push={push} />}
      </div>
    </ActionGroup>
  );
}
