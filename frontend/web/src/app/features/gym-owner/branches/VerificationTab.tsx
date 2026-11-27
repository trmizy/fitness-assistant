/**
 * Tab "Xác minh" of the branch detail (batch G2): the branch documents (existing StepVerification, unchanged: upload through the
 * presign -> S3 -> confirm routes, status per document, partner documents read-only) and the open review issues Gymini flagged
 * (GET /owner/gyms/:id/review-issues, the same query as the wizard). Both endpoints are OWNER-only on the server, so a MANAGER
 * gets a lock note and no request is sent for them.
 */
import { useQuery } from "@tanstack/react-query";
import { LockSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Gym, GymBranchReviewIssue } from "../../../types";
import { StepVerification } from "../../../components/gym/AddBranchWizard/StepVerification";
import { reviewCategoryLabel, type TabAccess } from "./branchesModel";

export function VerificationTab({ gym, access, reason }: { gym: Gym; access: TabAccess; reason: string | null }) {
  const id = gym.id;
  const allowed = access === "edit";
  const issuesQ = useQuery<GymBranchReviewIssue[]>({
    queryKey: ["owned-gym-review-issues", id],
    queryFn: () => gymService.listOpenReviewIssues(id),
    enabled: allowed,
  });
  const issues = issuesQ.data ?? [];

  if (!allowed) {
    return (
      <section className="go-card" data-testid="go-verification-locked">
        <div className="go-card-head"><h2>Xác minh chi nhánh</h2><span className="go-lock"><LockSimpleIcon aria-hidden="true" width={14} height={14} /> Chỉ xem</span></div>
        <p className="go-card-note" role="status">{reason}</p>
      </section>
    );
  }

  return (
    <div className="go-stack" data-testid="go-branch-verification">
      {issues.length > 0 && (
        <section className="go-card" data-tone="warn" aria-labelledby="go-h-issues" data-testid="go-review-issues">
          <div className="go-card-head">
            <h2 id="go-h-issues"><WarningCircleIcon aria-hidden="true" width={18} height={18} /> Gymini yêu cầu chỉnh sửa {issues.length} mục</h2>
          </div>
          <ul className="go-issues">
            {issues.map((issue, i) => (
              <li key={i}>
                <strong>{reviewCategoryLabel(issue.category)}</strong>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {issuesQ.isError && !issuesQ.data && (
        <div className="go-notice" data-tone="risk" role="alert">
          <span>Không tải được các yêu cầu chỉnh sửa của Gymini.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => void issuesQ.refetch()}>Thử lại</button>
        </div>
      )}
      <section className="go-card" aria-labelledby="go-h-docs">
        <div className="go-card-head"><h2 id="go-h-docs">Giấy tờ của chi nhánh</h2></div>
        <div className="go-embed"><StepVerification gymId={id} /></div>
      </section>
    </div>
  );
}
