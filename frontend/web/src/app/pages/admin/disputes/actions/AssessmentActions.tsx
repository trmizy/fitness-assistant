/**
 * D3 - Assessments slot: add a claim (A9) while the case is being collected/assessed, and assess a claim (A11, ASSESSING only).
 * The assessment form gives EVERY evidence exactly one choice (Không dùng / Trực tiếp / Gián tiếp / Phản bác), so an id can not sit in
 * two groups; `validateAssessment` re-checks the final body anyway.
 */
import { useId, useMemo, useState } from "react";
import { disputeCaseApi } from "../disputeCaseApi";
import { CLAIM_MOVE_LABEL, CLAIM_RESULT_LABEL, CLAIMANT_ROLE_LABEL, claimantRoleLabel } from "../disputeCaseLabels";
import { CLAIM_MOVES, CLAIM_RESULTS, CLAIMANT_ROLES, type ClaimMove } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { ActionButton, ActionGroup, ButtonRow, Check, ErrorBox, Field, FormCard, MutedLine, ResultNote, Select, TextArea, counter, useWrite } from "./actionKit";
import {
  EVIDENCE_GROUP_LABEL,
  LIMITS,
  assessmentBody,
  availability,
  claimBody,
  evidenceChoices,
  hasErrors,
  investigatorOnlyLine,
  splitGroups,
  validateAssessment,
  validateClaim,
  type Errors,
  type EvidenceGroupKey,
  type GroupAssignment,
} from "./actionModel";
import { GROUPS_NOTE } from "./actionText";

// ─────────────────────────────────────────────────────────────── claim ──
function ClaimCard({ detail, onChanged }: ActionSlotProps) {
  const id = useId();
  const w = useWrite<ReturnType<typeof claimBody>, { id: string }>(onChanged);
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [moves, setMoves] = useState<ClaimMove[]>([]);
  const [shown, setShown] = useState(false);
  const form = { claimantRole: role as never, text, moves };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateClaim(form) : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(validateClaim(form))) return;
    const r = await w.submit(claimBody(form), (key, b) => disputeCaseApi.addClaim(detail.case.id, b, key));
    if (r.ok) {
      setText("");
      setMoves([]);
      setRole("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Thêm khẳng định" caption="Một khẳng định của khách, PT hoặc hệ thống cần được kiểm chứng. Mỗi khẳng định phải được đánh giá trước khi ghi kết luận." testId="d3-claim">
      <Field id={`${id}-role`} label="Bên khẳng định" required error={errs.claimantRole}>
        <Select
          id={`${id}-role`}
          value={role}
          onChange={(v) => {
            w.onEdit();
            setRole(v);
          }}
          placeholder="Chọn bên…"
          options={CLAIMANT_ROLES.map((r) => ({ value: r, label: CLAIMANT_ROLE_LABEL[r] }))}
          error={errs.claimantRole}
        />
      </Field>
      <Field id={`${id}-text`} label="Nội dung khẳng định" required error={errs.text} count={counter(text)} max={LIMITS.claimText}>
        <TextArea
          id={`${id}-text`}
          value={text}
          onChange={(v) => {
            w.onEdit();
            setText(v);
          }}
          error={errs.text}
        />
      </Field>
      <fieldset className="space-y-0.5" aria-describedby={errs.moves ? `${id}-moves-err` : undefined}>
        <legend className="text-xs font-semibold text-adm-text">Khẳng định này ảnh hưởng tới (không bắt buộc)</legend>
        {CLAIM_MOVES.map((m) => (
          <Check
            key={m}
            id={`${id}-m-${m}`}
            checked={moves.includes(m)}
            onChange={(v) => {
              w.onEdit();
              setMoves((cur) => (v ? [...cur, m] : cur.filter((x) => x !== m)));
            }}
            label={CLAIM_MOVE_LABEL[m]}
          />
        ))}
        {errs.moves && (
          <p id={`${id}-moves-err`} className="text-xs font-medium text-st-danger">
            {errs.moves}
          </p>
        )}
      </fieldset>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-claim-send">
          Thêm khẳng định
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-claim-error" />
      {w.result && !w.error && <ResultNote testId="d3-claim-result">Đã thêm khẳng định. Bước tiếp theo: đánh giá khẳng định này.</ResultNote>}
    </FormCard>
  );
}

// ────────────────────────────────────────────────────────── assessment ──
function AssessCard({ detail, onChanged }: ActionSlotProps) {
  const id = useId();
  const w = useWrite<ReturnType<typeof assessmentBody>, { id: string }>(onChanged);
  const claims = detail.claims ?? [];
  const evidence = useMemo(() => evidenceChoices(detail), [detail]);
  const claimIds = claims.map((c) => c.id);
  const assessed = new Set((detail.assessments ?? []).map((x) => x.claimId));
  const [claimId, setClaimId] = useState("");
  const [groups, setGroups] = useState<GroupAssignment>({});
  const [relevanceNote, setRelevance] = useState("");
  const [verifiabilityNote, setVerifiability] = useState("");
  const [consistencyNote, setConsistency] = useState("");
  const [result, setResult] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [shown, setShown] = useState(false);

  const form = { claimId, groups, relevanceNote, verifiabilityNote, consistencyNote, result: result as never, reasoning };
  const errs: Errors = { ...w.fieldErrors, ...(shown ? validateAssessment(form, claimIds) : {}) };
  const counts = splitGroups(groups);

  function setGroup(evId: string, g: EvidenceGroupKey | "none") {
    w.onEdit();
    setGroups((cur) => {
      const next = { ...cur };
      if (g === "none") delete next[evId];
      else next[evId] = g;
      return next;
    });
  }
  async function send() {
    setShown(true);
    if (hasErrors(validateAssessment(form, claimIds))) return;
    const r = await w.submit(assessmentBody(form), (key, b) => disputeCaseApi.addAssessment(detail.case.id, b, key));
    if (r.ok) {
      setClaimId("");
      setGroups({});
      setRelevance("");
      setVerifiability("");
      setConsistency("");
      setResult("");
      setReasoning("");
      setShown(false);
    }
  }
  const edit = (set: (v: string) => void) => (v: string) => {
    w.onEdit();
    set(v);
  };

  return (
    <FormCard title="Đánh giá một khẳng định" caption="Xếp từng bằng chứng vào đúng một nhóm rồi ghi nhận xét. Chỉ ghi được khi hồ sơ ở bước «Đang đánh giá»." testId="d3-assess">
      <Field id={`${id}-claim`} label="Khẳng định cần đánh giá" required error={errs.claimId}>
        <Select
          id={`${id}-claim`}
          value={claimId}
          onChange={edit(setClaimId)}
          placeholder="Chọn khẳng định…"
          options={claims.map((c) => ({
            value: c.id,
            label: `${claimantRoleLabel(c.claimantRole)}: ${c.text.length > 70 ? `${c.text.slice(0, 70)}…` : c.text}${assessed.has(c.id) ? " (đã có đánh giá)" : " (chưa đánh giá)"}`,
          }))}
          error={errs.claimId}
        />
      </Field>

      <fieldset className="space-y-2" aria-describedby={errs.groups ? `${id}-groups-err` : `${id}-groups-hint`} data-testid="d3-assess-groups">
        <legend className="text-xs font-semibold text-adm-text">Bằng chứng</legend>
        <p id={`${id}-groups-hint`} className="text-xs text-adm-text-2">
          {GROUPS_NOTE}
        </p>
        {evidence.length === 0 ? (
          <MutedLine>Hồ sơ chưa có bằng chứng nào để xếp nhóm.</MutedLine>
        ) : (
          <ul className="space-y-2">
            {evidence.map((e) => {
              const value = groups[e.id] ?? "none";
              return (
                <li key={e.id} className="grid grid-cols-1 gap-1.5 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-2.5 sm:grid-cols-[1fr_11rem] sm:items-center" data-testid="d3-assess-evidence">
                  <label htmlFor={`${id}-e-${e.id}`} className="min-w-0 break-words text-sm text-adm-text">
                    {e.label}
                  </label>
                  <select
                    id={`${id}-e-${e.id}`}
                    value={value}
                    onChange={(ev) => setGroup(e.id, ev.target.value as EvidenceGroupKey | "none")}
                    className="block min-h-11 w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] xl:min-h-9"
                  >
                    {(["none", "direct", "indirect", "rebuttal"] as const).map((g) => (
                      <option key={g} value={g}>
                        {EVIDENCE_GROUP_LABEL[g]}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-adm-text-2" data-testid="d3-assess-counts">
          Trực tiếp: {counts.direct.length} · Gián tiếp: {counts.indirect.length} · Phản bác: {counts.rebuttal.length}
        </p>
        {errs.groups && (
          <p id={`${id}-groups-err`} className="text-xs font-medium text-st-danger">
            {errs.groups}
          </p>
        )}
      </fieldset>

      <Field id={`${id}-rel`} label="Mức liên quan" required error={errs.relevanceNote} count={counter(relevanceNote)} max={LIMITS.assessmentNote}>
        <TextArea id={`${id}-rel`} value={relevanceNote} onChange={edit(setRelevance)} error={errs.relevanceNote} rows={2} />
      </Field>
      <Field id={`${id}-ver`} label="Khả năng kiểm chứng" required error={errs.verifiabilityNote} count={counter(verifiabilityNote)} max={LIMITS.assessmentNote}>
        <TextArea id={`${id}-ver`} value={verifiabilityNote} onChange={edit(setVerifiability)} error={errs.verifiabilityNote} rows={2} />
      </Field>
      <Field id={`${id}-con`} label="Độ nhất quán" required error={errs.consistencyNote} count={counter(consistencyNote)} max={LIMITS.assessmentNote}>
        <TextArea id={`${id}-con`} value={consistencyNote} onChange={edit(setConsistency)} error={errs.consistencyNote} rows={2} />
      </Field>
      <Field id={`${id}-res`} label="Kết quả đánh giá" required error={errs.result}>
        <Select
          id={`${id}-res`}
          value={result}
          onChange={edit(setResult)}
          placeholder="Chọn kết quả…"
          options={CLAIM_RESULTS.map((r) => ({ value: r, label: CLAIM_RESULT_LABEL[r] }))}
          error={errs.result}
        />
      </Field>
      <Field id={`${id}-rsn`} label="Lý do kết luận" required error={errs.reasoning} count={counter(reasoning)} max={LIMITS.assessmentReasoning}>
        <TextArea id={`${id}-rsn`} value={reasoning} onChange={edit(setReasoning)} error={errs.reasoning} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d3-assess-send">
          Ghi đánh giá
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d3-assess-error" />
      {w.result && !w.error && <ResultNote testId="d3-assess-result">Đã ghi đánh giá.</ResultNote>}
    </FormCard>
  );
}

export function AssessmentActions(props: ActionSlotProps) {
  const { detail, currentUserId } = props;
  const a = availability(detail, currentUserId);
  if (!a.signedIn || a.terminal) return null;
  const line = investigatorOnlyLine(detail, currentUserId);
  const status = detail.case.status;
  return (
    <ActionGroup title="Thao tác đánh giá" testId="d3-actions-assessments">
      {line && <MutedLine testId="d3-who-may-act">{line}</MutedLine>}
      {a.investigator && status !== "ASSESSING" && (detail.claims ?? []).length > 0 && <MutedLine testId="d3-assess-not-now">Chỉ ghi được đánh giá khi hồ sơ ở bước «Đang đánh giá».</MutedLine>}
      <div className="grid grid-cols-1 items-start gap-4">
        {a.addClaim && <ClaimCard {...props} />}
        {a.assess && <AssessCard {...props} />}
      </div>
    </ActionGroup>
  );
}
