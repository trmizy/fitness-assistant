import { ApprovePolicyCard, ProposePolicyCard } from "../../actions/PolicyActions";
import { approvableReviewIds, availability } from "../../actions/actionModel";
import { formatDateTime } from "../format";
import { POLICY_PENDING_MINE, POLICY_SECTION_NOTE, POLICY_SECTION_TITLE, describePolicyReviews } from "../policyModel";
import type { ActionSlotProps } from "../actionSlots";
import { CARD, Muted, Notice, Pill } from "../WorkspaceParts";

/**
 * M7. The policy-eligibility reviews of the case's contract (read from the detail, A6 `policyReviews`): which one is in force, the list newest
 * first, then the forms the server allows (propose / approve). The forms are four-eyes: the review ids a viewer may approve come from the server.
 */
export function PolicySection({ detail, currentUserId, onChanged, capabilities }: ActionSlotProps) {
  const a = availability(detail, currentUserId);
  const approvable = approvableReviewIds(detail);
  const view = describePolicyReviews(detail, approvable, currentUserId);
  const forms = { detail, currentUserId, onChanged, capabilities };
  return (
    <section className={`${CARD} space-y-3 p-4`} aria-labelledby="d5-policy-title" data-testid="d5-policy-section">
      <h3 id="d5-policy-title" className="text-sm font-semibold text-adm-text">
        {POLICY_SECTION_TITLE}
      </h3>
      <Muted>{POLICY_SECTION_NOTE}</Muted>

      <Notice tone={view.contractReadable ? (view.inForce && view.inForce.tone === "success" ? "info" : "warning") : "danger"} testId="d5-policy-in-force" role="note">
        {view.inForce && (
          <p className="font-semibold" data-testid="d5-policy-in-force-label">
            Đang có hiệu lực: {view.inForce.resultLabel}
          </p>
        )}
        <p className={view.inForce ? "mt-1" : ""}>{view.forceLine}</p>
      </Notice>

      {view.rows.length === 0 ? (
        view.contractReadable && <p className="text-sm text-adm-text-2" data-testid="d5-policy-empty">Chưa có kết luận nào được đề xuất cho hợp đồng này.</p>
      ) : (
        <ul className="space-y-2" data-testid="d5-policy-list">
          {view.rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d5-policy-review" data-review-status={r.inForce ? "IN_FORCE" : r.pending ? "PENDING" : "REPLACED"}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-adm-text">{r.resultLabel}</span>
                <Pill tone={r.tone}>{r.statusLabel}</Pill>
                {r.replacesPrevious && <Pill tone="neutral">Thay cho kết luận cũ</Pill>}
                {r.otherCase && <Pill tone="neutral">Lập ở hồ sơ khác của hợp đồng</Pill>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">{r.reasoning}</p>
              {r.evidence.length > 0 && (
                <p className="mt-1 break-words text-xs text-adm-text-2">
                  Căn cứ ({r.evidence.length}): {r.evidence.join("; ")}
                </p>
              )}
              <p className="mt-1 text-xs text-adm-text-2">
                Đề xuất bởi {r.proposedByText} · {formatDateTime(r.proposedAt)}
                {r.approvedAt ? ` · Duyệt bởi ${r.approvedByText ?? "—"} · ${formatDateTime(r.approvedAt)}` : ""}
              </p>
              {r.pending && !r.approvable && a.serverList && !a.approvePolicy && (
                <p className="mt-1 text-xs text-adm-text-2" data-testid="d5-policy-cannot-approve">
                  {POLICY_PENDING_MINE}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {a.proposePolicy && <ProposePolicyCard {...forms} />}
      {a.approvePolicy &&
        view.rows
          .filter((r) => r.approvable)
          .map((r) => <ApprovePolicyCard key={r.id} review={r} detail={detail} onChanged={onChanged} />)}
    </section>
  );
}
