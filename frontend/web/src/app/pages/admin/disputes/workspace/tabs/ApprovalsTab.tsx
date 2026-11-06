import { APPROVAL_RESULT_LABEL, outcomeLabel } from "../../disputeCaseLabels";
import { formatDateTime, shortRef } from "../format";
import { ApprovalsActionsSlot, type ActionSlotProps } from "../actionSlots";
import { blockedText } from "../workspaceModel";
import { CARD, EmptyBox, Muted, Notice, Pill } from "../WorkspaceParts";
import { PolicySection } from "./PolicySection";
import { ReplacementPanel } from "../../actions/ReplacementPanel";

export function ApprovalsTab({ detail, currentUserId, onChanged, capabilities }: ActionSlotProps) {
  const proposals = [...(detail.proposals ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const investigatorId = detail.case?.investigatorId ?? null;
  return (
    <div className="space-y-4" data-testid="d2-tab-approvals">
      <Muted>Người duyệt phải là một quản trị viên khác với người lập đề xuất, điều tra viên, khách và PT của buổi. Sau khi duyệt, hồ sơ không sửa hay huỷ duyệt được.</Muted>
      <ApprovalsActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} capabilities={capabilities} />
      {proposals.length === 0 ? (
        <EmptyBox testId="d2-approvals-empty">Hồ sơ chưa có đề xuất nên chưa có gì để duyệt.</EmptyBox>
      ) : (
        proposals.map((p) => {
          const approvals = [...(p.approvals ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
          const youProposed = !!currentUserId && p.proposerId === currentUserId;
          const youInvestigate = !!currentUserId && investigatorId === currentUserId;
          return (
            <section key={p.id} className={`${CARD} space-y-3 p-4`} data-testid="d2-approval-proposal" aria-label={`Đề xuất: ${outcomeLabel(p.outcome)}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="info">{outcomeLabel(p.outcome)}</Pill>
                <span className="text-xs text-adm-text-2">
                  Lập bởi {youProposed ? "bạn" : `mã ${shortRef(p.proposerId)}`} · {formatDateTime(p.createdAt)}
                </span>
              </div>
              {(youProposed || youInvestigate) && (
                <Muted testId="d2-cannot-approve">
                  {youProposed ? "Bạn là người lập đề xuất này nên không duyệt được." : "Bạn là điều tra viên của hồ sơ này nên không duyệt được."}
                </Muted>
              )}
              {p.executionBlockedReason && <Notice tone="warning">{blockedText(p.executionBlockedReason, detail.decision?.proposalId === p.id)}</Notice>}
              {approvals.length === 0 ? (
                <p className="text-sm text-adm-text-2">Chưa có lượt duyệt hay bác nào.</p>
              ) : (
                <ul className="space-y-2">
                  {approvals.map((a) => (
                    <li key={a.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d2-approval">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={a.result === "APPROVED" ? "success" : "danger"}>{APPROVAL_RESULT_LABEL[a.result] ?? "Chưa rõ"}</Pill>
                        <span className="text-xs text-adm-text-2">
                          {currentUserId && a.approverId === currentUserId ? "Bạn" : `Mã ${shortRef(a.approverId)}`} · {formatDateTime(a.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">{a.reason}</p>
                      <p className="mt-1 text-xs text-adm-text-2">
                        {a.conflictOfInterestDeclaredNone ? "Đã khai báo không có xung đột lợi ích." : "Chưa khai báo không có xung đột lợi ích."}
                        {a.evidenceChangeAcknowledged ? " Đã xác nhận bằng chứng thay đổi." : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
      {detail.case?.status === "DECISION_APPROVED" && (
        <ReplacementPanel
          caseId={detail.case.id}
          caseStatus={detail.case.status}
          execStatus={detail.case.execStatus}
          currentUserId={currentUserId}
          replacementEnabled={capabilities?.decisionReplacement === true}
          onChanged={onChanged}
        />
      )}
      <PolicySection detail={detail} currentUserId={currentUserId} onChanged={onChanged} capabilities={capabilities} />
    </div>
  );
}
