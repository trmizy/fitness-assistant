/** D6 - finding & proposal, and the four-eyes decision tabs of a gym case. */
import { findingConsequence, gymFindingLabel, gymOutcomeLabel } from "../gymCaseLabels";
import { approvalHint, gatesOf, newestProposal, shortRefOf } from "../gymCaseModel";
import { formatDateTimeSafe } from "../gymFormat";
import { FindingCard, ProposeCard } from "../forms/JudgementForms";
import { DecisionCard } from "../forms/DecisionForm";
import { GymDecisionReplacementPanel } from "../forms/GymDecisionReplacementPanel";
import { GymAppealReviewerPanel } from "../forms/GymAppealReviewerPanel";
import type { FormProps } from "../forms/formTypes";
import { EmptyBox, Muted, Notice, Pill, Section } from "../GymParts";
import { GateLine, Group } from "../gymCaseKit";

const BOX = "rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3";

export function FindingTab(props: FormProps) {
  const { detail, currentUserId } = props;
  const g = gatesOf(detail);
  const classText = detail.case.caseClass;
  return (
    <div className="space-y-4" data-testid="d6-tab-finding">
      <Section title="Kết luận" testId="d6-findings">
        {detail.findings.length === 0 ? (
          <EmptyBox testId="d6-findings-empty">Chưa có kết luận. Cần đánh giá hết các khẳng định rồi mới ghi kết luận.</EmptyBox>
        ) : (
          <ul className="space-y-2">
            {detail.findings.map((f, i) => (
              <li key={f.id} className={`${BOX} space-y-1.5`} data-testid="d6-finding-row">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={f.finding === "ESTABLISHED" ? "success" : "neutral"}>{gymFindingLabel(f.finding)}</Pill>
                  {i < detail.findings.length - 1 && <Pill tone="neutral">Đã được thay bằng kết luận mới</Pill>}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-adm-text">{f.reasoning}</p>
                <p className="text-xs text-adm-text-2">
                  {formatDateTimeSafe(f.createdAt)} · {currentUserId && f.recordedBy === currentUserId ? "bạn ghi" : `người ghi mã ${shortRefOf(f.recordedBy)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Đề xuất" testId="d6-proposals">
        {detail.proposals.length === 0 ? (
          <EmptyBox testId="d6-proposals-empty">Chưa có đề xuất.</EmptyBox>
        ) : (
          <ul className="space-y-2">
            {detail.proposals.map((p) => (
              <li key={p.id} className={`${BOX} space-y-1.5`} data-testid="d6-proposal-row">
                <p className="text-sm font-semibold text-adm-text">{p.outcomeLabel || gymOutcomeLabel(p.outcome)}</p>
                <p className="text-xs text-adm-text-2">
                  {formatDateTimeSafe(p.createdAt)} · {currentUserId && p.proposerId === currentUserId ? "bạn lập" : `người lập mã ${shortRefOf(p.proposerId)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Muted>Kết quả do máy chủ tính từ loại hồ sơ và kết luận. Đề xuất không có số tiền.</Muted>
        {detail.findings.length > 0 && (
          <Muted testId="d6-consequence">{findingConsequence(classText, detail.findings[detail.findings.length - 1].finding)}</Muted>
        )}
      </Section>
      {!g.writeOff && (
        <Group title="Thao tác" testId="d6-actions-finding">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {g.finding.open && <FindingCard {...props} />}
            {g.propose.open && <ProposeCard {...props} />}
          </div>
          {!g.finding.open && !g.propose.open && <GateLine why={g.finding.why ?? g.propose.why} testId="d6-gate-finding" />}
        </Group>
      )}
    </div>
  );
}

export function DecisionTab(props: FormProps) {
  const { detail, currentUserId } = props;
  const g = gatesOf(detail);
  const hint = approvalHint(detail, currentUserId);
  const latest = newestProposal(detail.proposals);
  return (
    <div className="space-y-4" data-testid="d6-tab-decision">
      <Section title="Phê duyệt bốn mắt" testId="d6-approvals">
        {detail.proposals.length === 0 ? (
          <EmptyBox testId="d6-approvals-empty">Chưa có đề xuất nào để duyệt.</EmptyBox>
        ) : (
          <ul className="space-y-3">
            {detail.proposals.map((p) => (
              <li key={p.id} className={`${BOX} space-y-2`} data-testid="d6-approval-proposal">
                <p className="text-sm font-semibold text-adm-text">{p.outcomeLabel || gymOutcomeLabel(p.outcome)}</p>
                {p.approvals.length === 0 ? (
                  <p className="text-sm text-adm-text-2">{p.id === latest?.id && detail.case.status === "AWAITING_APPROVAL" ? "Đang chờ một quản trị viên khác duyệt." : "Chưa có lượt duyệt hoặc bác nào."}</p>
                ) : (
                  p.approvals.map((a) => (
                    <div key={a.id} className="space-y-1 border-t border-adm-border-soft pt-2 text-sm" data-testid="d6-approval-row">
                      <Pill tone={a.result === "APPROVED" ? "success" : "danger"}>{a.result === "APPROVED" ? "Đã duyệt" : "Đã bác"}</Pill>
                      <p className="break-words text-adm-text">{a.reason}</p>
                      <p className="text-xs text-adm-text-2">
                        {formatDateTimeSafe(a.createdAt)} · {currentUserId && a.approverId === currentUserId ? "bạn" : `người duyệt mã ${shortRefOf(a.approverId)}`}
                        {a.conflictOfInterestDeclaredNone ? " · đã khai báo không có xung đột lợi ích" : ""}
                        {a.evidenceChangeAcknowledged ? " · đã xác nhận thay đổi bằng chứng" : ""}
                      </p>
                    </div>
                  ))
                )}
              </li>
            ))}
          </ul>
        )}
        {/* INT-19: after an appeal the old decision stays in `detail.decision` while a NEW proposal waits, and an executed
            case stays DECISION_APPROVED: say "approved, nothing executed" only when both are true. */}
        {detail.decision && detail.case.status === "DECISION_APPROVED" && (
          <Notice tone="info" testId="d6-approved-note">
            Quyết định «{detail.decision.outcomeLabel || gymOutcomeLabel(detail.decision.outcome)}» đã được duyệt.{" "}
            {detail.case.execStatus === "BUSINESS_DONE"
              ? "Đã thực thi phần nghiệp vụ: xem tiền ở mục «Thực thi & tiền»."
              : "Duyệt chưa thực thi gì: xem mục «Thực thi & tiền»."}
          </Notice>
        )}
      </Section>
      {hint && (
        <Notice tone="info" testId="d6-approval-hint" role="note">
          {hint}
        </Notice>
      )}
      {!g.writeOff && detail.case.status === "AWAITING_APPROVAL" && (
        <Group title="Thao tác" testId="d6-actions-decision">
          {g.decide.open ? <DecisionCard {...props} /> : <GateLine why={g.decide.why} testId="d6-gate-decision" />}
        </Group>
      )}
      <GymAppealReviewerPanel {...props} />
      <GymDecisionReplacementPanel {...props} />
    </div>
  );
}
