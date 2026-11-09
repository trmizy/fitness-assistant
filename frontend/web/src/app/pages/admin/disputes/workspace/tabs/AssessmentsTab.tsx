import { claimMoveLabel, claimResultLabel, claimantRoleLabel } from "../../disputeCaseLabels";
import type { DisputeAssessment, DisputeCaseDetail, DisputeClaim } from "../../disputeCaseTypes";
import { evidenceRefText } from "../evidenceModel";
import { formatDateTime, shortRef } from "../format";
import { AssessmentsActionsSlot, type ActionSlotProps } from "../actionSlots";
import { CARD, EmptyBox, Muted, Pill, type PillTone } from "../WorkspaceParts";

const RESULT_TONE: Record<string, PillTone> = { ESTABLISHED: "success", NOT_ESTABLISHED: "warning", REFUTED: "danger" };

function EvidenceRefs({ title, ids, detail }: { title: string; ids: string[]; detail: DisputeCaseDetail }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-adm-text-2">{title}</p>
      {ids.length === 0 ? (
        <p className="text-sm text-adm-text-2">Không có</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-adm-text">
          {ids.map((id) => (
            <li key={id} className="break-words">
              {evidenceRefText(id, detail.evidence)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentCard({ a, detail, latest }: { a: DisputeAssessment; detail: DisputeCaseDetail; latest: boolean }) {
  return (
    <article className={`rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 ${latest ? "" : "opacity-90"}`} data-testid="d2-assessment">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={RESULT_TONE[a.result] ?? "neutral"}>{claimResultLabel(a.result)}</Pill>
        <span className="text-xs text-adm-text-2">
          {latest ? "Đánh giá mới nhất" : "Đánh giá trước"} · người đánh giá mã {shortRef(a.assessorId)} · {formatDateTime(a.createdAt)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <EvidenceRefs title="Bằng chứng trực tiếp" ids={a.directEvidenceIds ?? []} detail={detail} />
        <EvidenceRefs title="Bằng chứng gián tiếp" ids={a.indirectEvidenceIds ?? []} detail={detail} />
        <EvidenceRefs title="Bằng chứng phản bác" ids={a.rebuttalEvidenceIds ?? []} detail={detail} />
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {[
          ["Mức liên quan", a.relevanceNote],
          ["Khả năng kiểm chứng", a.verifiabilityNote],
          ["Độ nhất quán", a.consistencyNote],
          ["Lý do kết luận", a.reasoning],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-adm-text-2">{label}</dt>
            <dd className="whitespace-pre-wrap break-words text-adm-text">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function ClaimBlock({ claim, assessments, detail }: { claim: DisputeClaim; assessments: DisputeAssessment[]; detail: DisputeCaseDetail }) {
  const sorted = [...assessments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <section className={`${CARD} space-y-3 p-4`} data-testid="d2-claim-block" aria-label={`Khẳng định của ${claimantRoleLabel(claim.claimantRole)}`}>
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-adm-text">{claimantRoleLabel(claim.claimantRole)} khẳng định</span>
          {(claim.moves ?? []).map((m) => (
            <Pill key={m} tone="neutral">
              {claimMoveLabel(m)}
            </Pill>
          ))}
          {sorted.length === 0 && <Pill tone="warning">Chưa được đánh giá</Pill>}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-adm-text">{claim.text}</p>
      </div>
      {sorted.map((a, i) => (
        <AssessmentCard key={a.id} a={a} detail={detail} latest={i === 0} />
      ))}
    </section>
  );
}

export function AssessmentsTab({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const claims = detail.claims ?? [];
  const assessments = detail.assessments ?? [];
  const known = new Set(claims.map((c) => c.id));
  const orphan = assessments.filter((a) => !known.has(a.claimId));
  return (
    <div className="space-y-4" data-testid="d2-tab-assessments">
      <Muted>Mỗi khẳng định cần được đánh giá trước khi ghi kết luận. Đánh giá chỉ ghi được khi hồ sơ ở bước «Đang đánh giá».</Muted>
      <AssessmentsActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
      {claims.length === 0 && orphan.length === 0 ? (
        <EmptyBox testId="d2-assessments-empty">Chưa có khẳng định hoặc đánh giá nào trong hồ sơ.</EmptyBox>
      ) : (
        <>
          {claims.map((cl) => (
            <ClaimBlock key={cl.id} claim={cl} assessments={assessments.filter((a) => a.claimId === cl.id)} detail={detail} />
          ))}
          {orphan.length > 0 && (
            <section className="space-y-2" aria-label="Đánh giá không gắn với khẳng định nào">
              <h3 className="text-sm font-semibold text-adm-text">Đánh giá không gắn với khẳng định nào trong danh sách</h3>
              {orphan.map((a) => (
                <AssessmentCard key={a.id} a={a} detail={detail} latest={false} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
