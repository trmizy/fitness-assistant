/**
 * D5 / M7 - pure model of the policy-eligibility reviews of the case's CONTRACT (D-NEW-12): which review is in force, the list newest first,
 * and the fixed wording. No React, no I/O (runs under `tsx --test`).
 *
 * Why it matters: the latest APPROVED review of a contract decides whether ANY session of that contract may be ruled (case executor and the old door
 * alike). Approving one therefore opens or closes the ruling right for every session of the contract, which is why the approval has a strong confirm
 * and the four-eyes rule comes from the server (`allowedActions.approvePolicyEligibility.options` = the reviews this viewer may approve).
 */
import { POLICY_RESULT_LABEL } from "../disputeCaseLabels";
import type { DisputeCaseDetail, DisputeEvidence, PolicyReviewItem } from "../disputeCaseTypes";
import { evidenceRefText } from "./evidenceModel";
import { shortRef } from "./format";

export const POLICY_SECTION_TITLE = "Kết luận áp dụng chính sách của hợp đồng";
export const POLICY_SECTION_NOTE =
  "Chỉ khi kết luận đã duyệt MỚI NHẤT của hợp đồng là «thuộc chính sách hiện hành» thì buổi nào của hợp đồng này mới phán quyết được. Duyệt một kết luận mới mở hoặc đóng quyền phán quyết cho mọi buổi của hợp đồng.";
export const POLICY_NONE_IN_FORCE = "Hợp đồng chưa có kết luận áp dụng chính sách đã được duyệt, nên mọi phán quyết của hợp đồng này (qua hồ sơ lẫn đường cũ) đang bị từ chối.";
export const POLICY_EXCEPTION_IN_FORCE = "Kết luận đang có hiệu lực là «ngoại lệ lịch sử»: phán quyết của hợp đồng này đang bị chặn và cần xử lý riêng.";
export const POLICY_ELIGIBLE_IN_FORCE = "Kết luận đang có hiệu lực cho phép phán quyết các buổi của hợp đồng này.";
export const POLICY_APPROVE_CONFIRM = "Mở/đóng quyền phán quyết cho mọi buổi của hợp đồng này.";
export const POLICY_PROPOSE_CAPTION = "Đề xuất chưa mở hay đóng gì: cần một quản trị viên khác duyệt. Chọn bằng chứng của hồ sơ này làm căn cứ.";
export const POLICY_PENDING_MINE = "Bạn lập kết luận này (hoặc là điều tra viên, hoặc là một bên của vụ việc) nên không duyệt được. Cần một quản trị viên khác.";

export type PolicyStatusTone = "success" | "warning" | "pending" | "neutral" | "info";
export interface PolicyReviewRow {
  id: string;
  resultLabel: string;
  /** "Đang có hiệu lực" | "Chờ duyệt" | "Đã được thay bằng kết luận mới hơn" */
  statusLabel: string;
  tone: PolicyStatusTone;
  inForce: boolean;
  pending: boolean;
  /** this viewer may approve it (server list) */
  approvable: boolean;
  reasoning: string;
  evidence: string[];
  proposedAt: string;
  proposedByText: string;
  approvedAt: string | null;
  approvedByText: string | null;
  replacesPrevious: boolean;
  /** the review belongs to another case of the same contract */
  otherCase: boolean;
}
export interface PolicyView {
  contractReadable: boolean;
  inForce: PolicyReviewRow | null;
  forceLine: string;
  rows: PolicyReviewRow[];
  pendingCount: number;
}

function who(id: string | null | undefined, currentUserId: string | null | undefined): string {
  if (!id) return "—";
  return currentUserId && id === currentUserId ? "Bạn" : `Quản trị viên (mã ${shortRef(id)})`;
}

export function describePolicyReviews(detail: Pick<DisputeCaseDetail, "policyReviews" | "case" | "evidence">, approvable: readonly string[], currentUserId: string | null | undefined): PolicyView {
  const list = detail.policyReviews;
  if (!list || !Array.isArray(list.items)) return { contractReadable: false, inForce: null, forceLine: "Chưa đọc được các kết luận áp dụng chính sách. Hãy tải lại hồ sơ.", rows: [], pendingCount: 0 };
  const rows: PolicyReviewRow[] = [...list.items]
    .sort((a: PolicyReviewItem, b: PolicyReviewItem) => Date.parse(b.proposedAt) - Date.parse(a.proposedAt) || (a.reviewId < b.reviewId ? 1 : -1))
    .map((r) => {
      const pending = r.status === "PENDING";
      const inForce = r.current === true || r.reviewId === list.currentReviewId;
      return {
        id: r.reviewId,
        resultLabel: r.result in POLICY_RESULT_LABEL ? POLICY_RESULT_LABEL[r.result] : "Kết luận khác",
        statusLabel: inForce ? "Đang có hiệu lực" : pending ? "Chờ duyệt" : "Đã được thay bằng kết luận mới hơn",
        tone: inForce ? (r.result === "ELIGIBLE_CURRENT_POLICY" ? "success" : "warning") : pending ? "pending" : "neutral",
        inForce,
        pending,
        approvable: pending && approvable.includes(r.reviewId),
        reasoning: r.reasoning,
        evidence: (r.evidenceIds ?? []).map((id) => evidenceRefText(id, detail.evidence as DisputeEvidence[])),
        proposedAt: r.proposedAt,
        proposedByText: who(r.proposedBy, currentUserId),
        approvedAt: r.approvedAt ?? null,
        approvedByText: r.approvedBy ? who(r.approvedBy, currentUserId) : null,
        replacesPrevious: !!r.supersedesId,
        otherCase: !!r.caseId && r.caseId !== detail.case?.id,
      };
    });
  const inForce = rows.find((r) => r.inForce) ?? null;
  const forceLine = !inForce ? POLICY_NONE_IN_FORCE : inForce.resultLabel && list.currentResult === "EXCEPTION_APPLIES" ? POLICY_EXCEPTION_IN_FORCE : POLICY_ELIGIBLE_IN_FORCE;
  return { contractReadable: true, inForce, forceLine, rows, pendingCount: rows.filter((r) => r.pending).length };
}

/** Reviews that this case can name as "replaced by the new one": every review of the contract. */
export function supersedableReviews(view: PolicyView): Array<{ id: string; label: string }> {
  return view.rows.map((r) => ({ id: r.id, label: `${r.resultLabel} (${r.statusLabel.toLowerCase()}, mã ${shortRef(r.id)})` }));
}
