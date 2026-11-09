/** D6 - the "file" tabs of a gym case: evidence, statements, claims & assessments. */
import { DECLARED_HASH_NOTE, gymSourceLabel } from "../gymCaseLabels";
import { describeEvidence, evidenceGroups, gatesOf, isSharedWithMember, shortRefOf } from "../gymCaseModel";
import { formatDateTimeSafe } from "../gymFormat";
import type { GymCaseDetail, GymEvidence } from "../gymCaseTypes";
import { AckCard, RecollectCard } from "../forms/InvestigationForms";
import { ClaimCard, EvidenceOnBehalfCard, ShareCard, StatementOnBehalfCard } from "../forms/EvidenceForms";
import { AssessmentCard } from "../forms/JudgementForms";
import type { FormProps } from "../forms/formTypes";
import { EmptyBox, FieldList, Muted, Pill, Section } from "../GymParts";
import { GateLine, Group } from "../gymCaseKit";
import { CompactReference } from "../../disputes/shared/CompactReference";

const BOX = "rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3";

function EvidenceRow({ e, detail, older }: { e: GymEvidence; detail: GymCaseDetail; older: boolean }) {
  const v = describeEvidence(e);
  const shared = isSharedWithMember(detail, "evidence", e.id);
  return (
    <li className={`${BOX} space-y-2`} data-testid="d6-evidence-row" data-source={e.source}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-adm-text">{v.title}</span>
        {older && <Pill tone="neutral">Bản cũ</Pill>}
        <Pill tone={v.partySubmitted ? "warning" : "info"}>{v.provenance}</Pill>
        {v.onBehalf && <Pill tone="pending">Admin nhận hộ</Pill>}
        {v.partySubmitted && !v.onBehalf && <Pill tone="warning">Người dùng tự khai, chưa xác minh</Pill>}
        {shared && <Pill tone="success">Đã chia sẻ cho hội viên</Pill>}
      </div>
      <FieldList fields={v.fields} />
      {v.declaredSha && (
        <div className="min-w-0 text-sm" data-testid="d6-declared-sha">
          <p className="text-xs text-adm-text-2">Mã sha256 do người nộp tự khai</p>
          <CompactReference value={v.declaredSha} label="Mã băm tự khai" />
        </div>
      )}
      {v.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
      <p className="text-xs text-adm-text-2">
        Ghi nhận {formatDateTimeSafe(v.capturedAt)}
        {v.eventAt ? ` · sự việc ${formatDateTimeSafe(v.eventAt)}` : ""} · bản {v.version}
      </p>
    </li>
  );
}

export function EvidenceTab(props: FormProps) {
  const { detail } = props;
  const g = gatesOf(detail);
  const groups = evidenceGroups(detail.evidence);
  return (
    <div className="space-y-4" data-testid="d6-tab-evidence">
      <Section title="Bằng chứng trong hồ sơ" testId="d6-evidence" aside={<span className="text-xs text-adm-text-2">Mỗi lần xem được ghi lại</span>}>
        {groups.length === 0 ? (
          <EmptyBox testId="d6-evidence-empty">Hồ sơ chưa có bằng chứng nào.</EmptyBox>
        ) : (
          groups.map((grp) => (
            <div key={grp.source} className="space-y-2" data-testid={`d6-evidence-group-${grp.source}`}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-adm-text-2">{gymSourceLabel(grp.source)}</h4>
              <ul className="space-y-2">
                {grp.rows.map((e) => (
                  <EvidenceRow key={e.id} e={e} detail={detail} older={grp.rows.some((o) => o.subject === e.subject && o.snapshotVersion > e.snapshotVersion)} />
                ))}
              </ul>
            </div>
          ))
        )}
        <Muted>Bằng chứng không bao giờ bị sửa: khi nguồn đổi, hệ thống thêm một bản mới và giữ bản cũ. {DECLARED_HASH_NOTE}</Muted>
      </Section>
      {!g.writeOff && (
        <Group title="Thao tác với bằng chứng" testId="d6-actions-evidence">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {g.recollect.open && <RecollectCard {...props} />}
            {g.ack.open && <AckCard {...props} />}
            {g.evidenceOnBehalf.open && <EvidenceOnBehalfCard {...props} />}
            {g.share.open && <ShareCard {...props} kind="evidence" />}
          </div>
          {!g.recollect.open && !g.evidenceOnBehalf.open && !g.share.open && <GateLine why={g.recollect.why} testId="d6-gate-evidence" />}
        </Group>
      )}
    </div>
  );
}

export function StatementsTab(props: FormProps) {
  const { detail } = props;
  const g = gatesOf(detail);
  const rows = [...detail.statements].sort((a, b) => a.partyRole.localeCompare(b.partyRole) || a.version - b.version);
  return (
    <div className="space-y-4" data-testid="d6-tab-statements">
      <Section title="Lời khai" testId="d6-statements">
        {rows.length === 0 ? (
          <EmptyBox testId="d6-statements-empty">Chưa có lời khai nào.</EmptyBox>
        ) : (
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.id} className={`${BOX} space-y-1.5`} data-testid="d6-statement-row">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-adm-text">{s.partyRole === "MEMBER" ? "Hội viên" : "Admin nhận hộ hội viên"}</span>
                  <Pill tone="neutral">Lần {s.version}</Pill>
                  {isSharedWithMember(detail, "statement", s.id) && <Pill tone="success">Đã chia sẻ cho hội viên</Pill>}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-adm-text">{s.text}</p>
                {s.supplementReason && <p className="break-words text-xs text-adm-text-2">Lý do bổ sung: {s.supplementReason}</p>}
                <p className="text-xs text-adm-text-2">{formatDateTimeSafe(s.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        <Muted>Chủ phòng tập không phải một bên của hồ sơ nên không có lời khai của phòng tập.</Muted>
      </Section>
      {!g.writeOff && (
        <Group title="Thao tác với lời khai" testId="d6-actions-statements">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {g.statementOnBehalf.open && <StatementOnBehalfCard {...props} />}
            {g.share.open && <ShareCard {...props} kind="statement" />}
          </div>
          {!g.statementOnBehalf.open && !g.share.open && <GateLine why={g.statementOnBehalf.why} testId="d6-gate-statements" />}
        </Group>
      )}
    </div>
  );
}

const RESULT_LABEL: Record<string, { text: string; tone: "success" | "neutral" | "danger" }> = {
  ESTABLISHED: { text: "Khẳng định đúng", tone: "success" },
  NOT_ESTABLISHED: { text: "Chưa đủ căn cứ", tone: "neutral" },
  REFUTED: { text: "Khẳng định bị bác bỏ", tone: "danger" },
};

export function AssessmentsTab(props: FormProps) {
  const { detail } = props;
  const g = gatesOf(detail);
  const byClaim = (id: string) => detail.assessments.filter((a) => a.claimId === id);
  return (
    <div className="space-y-4" data-testid="d6-tab-assessments">
      <Section title="Khẳng định và đánh giá" testId="d6-claims">
        {detail.claims.length === 0 ? (
          <EmptyBox testId="d6-claims-empty">Chưa có khẳng định nào. Ghi khẳng định trước rồi mới đánh giá được.</EmptyBox>
        ) : (
          <ul className="space-y-3">
            {detail.claims.map((c, i) => {
              const list = byClaim(c.id);
              return (
                <li key={c.id} className={`${BOX} space-y-2`} data-testid="d6-claim-row">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-adm-text">Khẳng định {i + 1}</span>
                    <Pill tone="neutral">{c.claimantRole === "MEMBER" ? "Hội viên nêu" : "Admin ghi hộ"}</Pill>
                    {list.length === 0 && <Pill tone="warning">Chưa đánh giá</Pill>}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-adm-text">{c.text}</p>
                  {list.map((a) => {
                    const r = RESULT_LABEL[a.result] ?? { text: "Chưa rõ", tone: "neutral" as const };
                    return (
                      <div key={a.id} className="space-y-1 border-t border-adm-border-soft pt-2 text-sm" data-testid="d6-assessment-row">
                        <Pill tone={r.tone}>{r.text}</Pill>
                        <p className="break-words text-adm-text">{a.reasoning}</p>
                        <p className="text-xs text-adm-text-2">
                          Bằng chứng trực tiếp {a.directEvidenceIds.length} · gián tiếp {a.indirectEvidenceIds.length} · phản bác {a.rebuttalEvidenceIds.length} · {formatDateTimeSafe(a.createdAt)} · người đánh giá mã {shortRefOf(a.assessorId)}
                        </p>
                        <details className="text-xs text-adm-text-2">
                          <summary className="cursor-pointer text-adm-text">Ghi chú đánh giá</summary>
                          <ul className="mt-1 space-y-1">
                            <li className="break-words">Liên quan: {a.relevanceNote}</li>
                            <li className="break-words">Kiểm chứng: {a.verifiabilityNote}</li>
                            <li className="break-words">Nhất quán: {a.consistencyNote}</li>
                          </ul>
                        </details>
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {!g.writeOff && (
        <Group title="Thao tác" testId="d6-actions-assessments">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {g.claim.open && <ClaimCard {...props} />}
            {g.assess.open && <AssessmentCard {...props} />}
          </div>
          {!g.claim.open && !g.assess.open && <GateLine why={g.assess.why ?? g.claim.why} testId="d6-gate-assessments" />}
          {g.claim.open && !g.assess.open && <GateLine why={g.assess.why} testId="d6-gate-assess" />}
        </Group>
      )}
    </div>
  );
}
