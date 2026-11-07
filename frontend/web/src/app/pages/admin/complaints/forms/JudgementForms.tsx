/**
 * D6 - the judgement steps of a gym case: assessment of a claim (G11), finding (G12) and proposal (G13).
 * The outcome is NEVER typed: the server computes it from (case class, latest finding) and no body carries an amount.
 */
import { useId, useState } from "react";
import { gymCaseApi } from "../gymCaseApi";
import { findingConsequence, gymFindingLabel, gymOutcomeLabel } from "../gymCaseLabels";
import {
  LIMITS,
  evidenceChoices,
  hasErrors,
  latestFinding,
  splitGroups,
  textError,
  unassessedClaims,
  validateAssessment,
  validateFinding,
  type AssessmentForm,
  type Errors,
} from "../gymCaseModel";
import type { GymCreatedId, GymFindingResult, GymProposalResult } from "../gymCaseTypes";
import { ActionButton, ButtonRow, ErrorBox, Field, FormCard, MutedLine, Select, TextArea, counter, useGymWrite } from "../gymCaseKit";
import type { FormProps } from "./formTypes";

const GROUPS: Array<{ value: "none" | "direct" | "indirect" | "rebuttal"; label: string }> = [
  { value: "none", label: "Không dùng" },
  { value: "direct", label: "Bằng chứng trực tiếp" },
  { value: "indirect", label: "Bằng chứng gián tiếp" },
  { value: "rebuttal", label: "Bằng chứng phản bác" },
];

export function AssessmentCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const pending = unassessedClaims(detail);
  const claimIds = detail.claims.map((c) => c.id);
  const w = useGymWrite<ReturnType<typeof bodyOf>, GymCreatedId>(onChanged);
  const [f, setF] = useState<AssessmentForm>({
    claimId: pending[0]?.id ?? detail.claims[0]?.id ?? "",
    groups: {},
    relevanceNote: "",
    verifiabilityNote: "",
    consistencyNote: "",
    result: "",
    reasoning: "",
  });
  const [shown, setShown] = useState(false);
  const v = validateAssessment(f, claimIds);
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };
  const choices = evidenceChoices(detail);
  const set = (patch: Partial<AssessmentForm>) => {
    w.onEdit();
    setF((cur) => ({ ...cur, ...patch }));
  };
  const text = (k: "relevanceNote" | "verifiabilityNote" | "consistencyNote", label: string, hint: string) => (
    <Field id={`${id}-${k}`} label={label} required error={errs[k]} count={counter(f[k])} max={LIMITS.assessmentNote} hint={hint}>
      <TextArea id={`${id}-${k}`} value={f[k]} rows={2} onChange={(x) => set({ [k]: x } as Partial<AssessmentForm>)} error={errs[k]} hint />
    </Field>
  );

  function bodyOf(form: AssessmentForm) {
    const g = splitGroups(form.groups);
    return {
      claimId: form.claimId,
      directEvidenceIds: g.direct,
      indirectEvidenceIds: g.indirect,
      rebuttalEvidenceIds: g.rebuttal,
      relevanceNote: form.relevanceNote.trim(),
      verifiabilityNote: form.verifiabilityNote.trim(),
      consistencyNote: form.consistencyNote.trim(),
      result: form.result as "ESTABLISHED" | "NOT_ESTABLISHED" | "REFUTED",
      reasoning: form.reasoning.trim(),
    };
  }

  async function send() {
    setShown(true);
    if (hasErrors(v)) return;
    const r = await w.submit(bodyOf(f), (key, b) => gymCaseApi.addAssessment(detail.case.id, b, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-assess-done", text: "Đã ghi đánh giá." });
      setF({ claimId: f.claimId, groups: {}, relevanceNote: "", verifiabilityNote: "", consistencyNote: "", result: "", reasoning: "" });
      setShown(false);
    }
  }

  return (
    <FormCard title="Ghi đánh giá một khẳng định" caption="Xếp mỗi bằng chứng vào đúng một nhóm (hoặc không dùng), nêu cách bạn cân nhắc rồi chọn kết quả." testId="d6-assess">
      <Field id={`${id}-claim`} label="Khẳng định cần đánh giá" required error={errs.claimId}>
        <Select
          id={`${id}-claim`}
          value={f.claimId}
          onChange={(x) => set({ claimId: x })}
          options={detail.claims.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.text.length > 70 ? `${c.text.slice(0, 70)}…` : c.text}${pending.some((p) => p.id === c.id) ? "" : " (đã có đánh giá)"}` }))}
          placeholder="Chọn khẳng định"
          error={errs.claimId}
        />
      </Field>
      <fieldset className="space-y-2 rounded-lg border border-adm-border-soft p-3">
        <legend className="px-1 text-xs font-semibold text-adm-text">Xếp bằng chứng vào nhóm</legend>
        <p className="text-xs text-adm-text-2">Mỗi bằng chứng chỉ xếp vào một nhóm. Chọn «Không dùng» nếu bằng chứng không liên quan đến khẳng định này.</p>
        {choices.length === 0 ? (
          <MutedLine>Hồ sơ chưa có bằng chứng nào.</MutedLine>
        ) : (
          choices.map((c) => (
            <div key={c.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_14rem] sm:items-center sm:gap-3">
              <label htmlFor={`${id}-g-${c.id}`} className="min-w-0 break-words text-sm text-adm-text">
                {c.label}
              </label>
              <Select
                id={`${id}-g-${c.id}`}
                value={f.groups[c.id] ?? "none"}
                onChange={(x) => set({ groups: { ...f.groups, [c.id]: x as AssessmentForm["groups"][string] } })}
                options={GROUPS}
              />
            </div>
          ))
        )}
      </fieldset>
      {text("relevanceNote", "Liên quan đến khẳng định thế nào", "Bằng chứng này nói lên điều gì về khẳng định.")}
      {text("verifiabilityNote", "Kiểm chứng được đến đâu", "Nguồn do hệ thống ghi nhận hay do người dùng tự cung cấp.")}
      {text("consistencyNote", "Có nhất quán với các bằng chứng khác không", "Chỗ khớp và chỗ mâu thuẫn.")}
      <Field id={`${id}-result`} label="Kết quả đánh giá" required error={errs.result}>
        <Select
          id={`${id}-result`}
          value={f.result}
          onChange={(x) => set({ result: x })}
          options={[
            { value: "ESTABLISHED", label: "Khẳng định đúng" },
            { value: "NOT_ESTABLISHED", label: "Chưa đủ căn cứ" },
            { value: "REFUTED", label: "Khẳng định bị bác bỏ" },
          ]}
          placeholder="Chọn kết quả"
          error={errs.result}
        />
      </Field>
      <Field id={`${id}-reasoning`} label="Lập luận" required error={errs.reasoning} count={counter(f.reasoning)} max={LIMITS.reasoning}>
        <TextArea id={`${id}-reasoning`} value={f.reasoning} onChange={(x) => set({ reasoning: x })} error={errs.reasoning} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-assess-send">
          Ghi đánh giá
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-assess-error" />
    </FormCard>
  );
}

export function FindingCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ finding: string; reasoning: string }, GymFindingResult>(onChanged);
  const [finding, setFinding] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [shown, setShown] = useState(false);
  const v = validateFinding({ finding, reasoning });
  const errs: Errors = { ...w.fieldErrors, ...(shown ? v : {}) };

  async function send() {
    setShown(true);
    if (hasErrors(v)) return;
    const r = await w.submit({ finding, reasoning: reasoning.trim() }, (key, b) => gymCaseApi.recordFinding(detail.case.id, { finding: b.finding as "ESTABLISHED" | "NOT_ESTABLISHED", reasoning: b.reasoning }, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-finding-done", text: `Đã ghi kết luận «${gymFindingLabel(r.value.finding)}». Bước tiếp theo: lập đề xuất.` });
      setFinding("");
      setReasoning("");
      setShown(false);
    }
  }

  return (
    <FormCard title="Ghi kết luận" caption="Cần ít nhất một khẳng định và mỗi khẳng định đã được đánh giá. Kết quả xử lý do máy chủ tính từ loại hồ sơ và kết luận, bạn không nhập." testId="d6-finding">
      <Field id={`${id}-finding`} label="Kết luận" required error={errs.finding}>
        <Select
          id={`${id}-finding`}
          value={finding}
          onChange={(x) => {
            w.onEdit();
            setFinding(x);
          }}
          options={[
            { value: "ESTABLISHED", label: "Khiếu nại đúng" },
            { value: "NOT_ESTABLISHED", label: "Chưa đủ căn cứ" },
          ]}
          placeholder="Chọn kết luận"
          error={errs.finding}
        />
      </Field>
      {finding && (
        <p className="rounded-lg border border-adm-border-soft bg-adm-surface-2 px-3 py-2 text-sm text-adm-text" data-testid="d6-finding-consequence">
          {findingConsequence(detail.case.caseClass, finding)}
        </p>
      )}
      <Field id={`${id}-reasoning`} label="Lập luận của kết luận" required error={errs.reasoning} count={counter(reasoning)} max={LIMITS.reasoning}>
        <TextArea
          id={`${id}-reasoning`}
          value={reasoning}
          onChange={(x) => {
            w.onEdit();
            setReasoning(x);
          }}
          error={errs.reasoning}
        />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-finding-send">
          Ghi kết luận
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-finding-error" />
    </FormCard>
  );
}

export function ProposeCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<{ note: string }, GymProposalResult>(onChanged);
  const [note, setNote] = useState("");
  const f = latestFinding(detail.findings);
  const err = textError(note, LIMITS.note, false);

  async function send() {
    if (err) return;
    const r = await w.submit({ note: note.trim() }, (key, b) => gymCaseApi.propose(detail.case.id, b.note ? { note: b.note } : {}, key));
    if (r.ok) {
      push({ tone: "success", testId: "d6-propose-done", text: `Đã lập đề xuất: ${r.value.outcomeLabel || gymOutcomeLabel(r.value.outcome)}. Hồ sơ chờ một quản trị viên khác duyệt.` });
      setNote("");
    }
  }

  return (
    <FormCard title="Lập đề xuất" caption="Đề xuất không có ô kết quả hay số tiền: máy chủ tự tính kết quả từ kết luận và, với hồ sơ có hoàn tiền, kiểm lại gói hội viên còn hoàn được." testId="d6-propose">
      {f && (
        <p className="text-sm text-adm-text">
          Dựa trên kết luận: <strong>{gymFindingLabel(f.finding)}</strong>. {findingConsequence(detail.case.caseClass, f.finding)}
        </p>
      )}
      <Field id={`${id}-note`} label="Ghi chú cho người duyệt (không bắt buộc)" error={err} count={counter(note)} max={LIMITS.note}>
        <TextArea id={`${id}-note`} value={note} rows={2} onChange={(x) => { w.onEdit(); setNote(x); }} error={err} />
      </Field>
      <ButtonRow>
        <ActionButton onClick={() => void send()} disabled={w.mustReload} pending={w.pending} testId="d6-propose-send">
          Lập đề xuất
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-propose-error" />
    </FormCard>
  );
}
