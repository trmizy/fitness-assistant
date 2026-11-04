import {
  INVESTIGATION_STATUSES,
  MANUAL_TARGETS,
  canTransitionManually,
  checkApprover,
  isTerminal,
  type CaseStatus,
} from "./rules";

/**
 * Backend completion: the actions an ADMIN may take on a case RIGHT NOW, computed on the server from the case state and the actor (self-approval /
 * conflict-of-interest aware) so that the frontend never guesses. PURE (no database, no network); the service feeds it rows it already read.
 *
 * It mirrors the checks the write paths make (same constants, same `checkApprover`); the write path stays the authority: an action listed as allowed can
 * still be refused by a check this function cannot see (the ledger being unreadable when proposing, a changed piece of evidence when approving, ...).
 * The reverse never holds: an action listed as not allowed is refused by the server.
 */
export interface AllowedActionsInput {
  actor: { id: string; role: string };
  c: {
    status: string;
    type: string;
    investigatorId: string | null;
    clientUserId: string;
    ptUserId: string;
    execStatus: string;
    version: number;
  };
  /** status of the case's session (null when unknown) */
  sessionStatus: string | null;
  /** proposer of the latest proposal (null when none) */
  proposerId: string | null;
  /** latest finding kind (null when none) */
  latestFinding: string | null;
  /** reviews of the case's contract that are not approved yet, with their proposer */
  pendingPolicyReviews: ReadonlyArray<{ id: string; proposedBy: string }>;
  flags: { executionEnabled: boolean; evidenceStorageEnabled: boolean };
}

export interface ActionVerdict {
  allowed: boolean;
  /** stable machine code of the reason it is not allowed */
  code?: string;
  /** Vietnamese, no internal enum */
  message?: string;
  /** extra choices (transition: the target states; approvePolicyEligibility: the reviews the actor may approve) */
  options?: string[];
}

export const ACTION_NAMES = [
  "assign",
  "recollect",
  "transition",
  "requestMore",
  "classify",
  "addClaim",
  "addIssue",
  "addAssessment",
  "recordFinding",
  "propose",
  "decide",
  "acknowledgeEvidenceChange",
  "proposePolicyEligibility",
  "approvePolicyEligibility",
  "share",
  "execute",
  "reconcileExecution",
  "acknowledgeNeedsHuman",
  "closeNotADispute",
  "closeOrphan",
  "closeExecuted",
  "readEvidenceFile",
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/** A session that is no longer in dispute (neither DISPUTED nor waiting for the PT's answer to a no-show report): a case still open on it is an orphan. */
export const sessionStillInDispute = (sessionStatus: string | null): boolean => sessionStatus === "DISPUTED" || sessionStatus === "PT_NO_SHOW_REPORTED";
export const isOrphanCase = (status: string, sessionStatus: string | null): boolean => sessionStatus !== null && !isTerminal(status as CaseStatus) && !sessionStillInDispute(sessionStatus);

const ok = (options?: string[]): ActionVerdict => (options ? { allowed: true, options } : { allowed: true });
const no = (code: string, message: string): ActionVerdict => ({ allowed: false, code, message });

export function computeAllowedActions(i: AllowedActionsInput): Record<ActionName, ActionVerdict> {
  const { actor, c } = i;
  const status = c.status as CaseStatus;
  const isAdmin = actor.role === "ADMIN";
  const isParty = actor.id === c.clientUserId || actor.id === c.ptUserId;
  const terminal = isTerminal(status);
  const isInvestigator = isAdmin && !!c.investigatorId && c.investigatorId === actor.id;

  const adminOnly = (): ActionVerdict | null => (isAdmin ? null : no("ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này"));
  const investigatorOnly = (): ActionVerdict | null =>
    adminOnly() ?? (isInvestigator ? null : no("NOT_ASSIGNED_INVESTIGATOR", "Chỉ điều tra viên được giao hồ sơ này mới được thực hiện thao tác này"));
  const stateOnly = (allowed: readonly string[]): ActionVerdict | null =>
    allowed.includes(c.status) ? null : no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này");
  const notTerminal = (): ActionVerdict | null => (terminal ? no("CASE_STATE_NOT_ALLOWED", "Hồ sơ đã đóng") : null);
  const notParty = (): ActionVerdict | null => (isParty ? no("CONFLICT_OF_INTEREST", "Bạn là một bên của vụ việc nên không được thực hiện thao tác này") : null);
  const classified = (): ActionVerdict | null =>
    c.type === "LEGACY_UNCLASSIFIED" ? no("CLASSIFICATION_REQUIRED", "Hồ sơ còn ở phân loại tạm; điều tra viên cần phân loại trước") : null;

  const out = {} as Record<ActionName, ActionVerdict>;

  // assign: any admin, not terminal; the chosen target is checked (real admin, not a party) by the server when the call is made.
  out.assign = adminOnly() ?? notTerminal() ?? ok();
  out.recollect = adminOnly() ?? notTerminal() ?? ok();

  // transition: before an investigator exists any admin may move an INTAKE case; afterwards only the investigator.
  {
    const base = adminOnly() ?? notTerminal() ?? (status !== "INTAKE" ? investigatorOnly() : null);
    if (base) out.transition = base;
    else {
      const targets = MANUAL_TARGETS.filter((t) => canTransitionManually(status, t));
      out.transition = targets.length ? ok([...targets]) : no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép chuyển trạng thái thủ công");
    }
  }
  out.requestMore = investigatorOnly() ?? stateOnly(["ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"]) ?? ok(["COLLECTING", "AWAITING_PARTIES"]);
  out.classify = investigatorOnly() ?? notTerminal() ?? (c.type === "LEGACY_UNCLASSIFIED" ? null : no("ALREADY_CLASSIFIED", "Hồ sơ này đã có loại, không phân loại lại")) ?? ok();
  out.addClaim = investigatorOnly() ?? stateOnly(INVESTIGATION_STATUSES) ?? ok();
  out.addIssue = out.addClaim;
  out.addAssessment = investigatorOnly() ?? stateOnly(["ASSESSING"]) ?? ok();
  out.recordFinding = investigatorOnly() ?? stateOnly(["ASSESSING"]) ?? classified() ?? ok();
  out.propose =
    investigatorOnly() ??
    stateOnly(["FINDING_RECORDED"]) ??
    classified() ??
    (i.latestFinding === "NOT_A_DISPUTE"
      ? no("DESIGN_REQUIRED", "Kết luận 'không phải khiếu nại' không tạo đề xuất; dùng thao tác đóng hồ sơ không phải khiếu nại")
      : i.latestFinding === null
        ? no("FINDING_REQUIRED", "Chưa có kết luận để đề xuất")
        : null) ??
    ok();

  // decide (approve / reject): four-eyes and conflict-of-interest aware. The declaration of "no conflict" is the approver's own tick, assumed true here.
  {
    const base = adminOnly() ?? stateOnly(["AWAITING_APPROVAL"]) ?? classified();
    if (base) out.decide = base;
    else if (i.proposerId === null) out.decide = no("PROPOSAL_REQUIRED", "Chưa có đề xuất để duyệt");
    else {
      const v = checkApprover({
        approverId: actor.id,
        approverRole: actor.role,
        proposerId: i.proposerId,
        investigatorId: c.investigatorId,
        clientUserId: c.clientUserId,
        ptUserId: c.ptUserId,
        conflictOfInterestDeclaredNone: true,
      });
      out.decide = v.ok ? ok(["APPROVED", "REJECTED"]) : no(v.code, v.message);
    }
  }
  out.acknowledgeEvidenceChange = investigatorOnly() ?? stateOnly(["AWAITING_APPROVAL"]) ?? ok();
  out.proposePolicyEligibility =
    investigatorOnly() ?? classified() ?? (status === "INTAKE" || status === "REJECTED_INTAKE" || status === "CLOSED" ? no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này") : null) ?? ok();
  {
    const base = adminOnly();
    if (base) out.approvePolicyEligibility = base;
    else {
      const mine = i.pendingPolicyReviews.filter(
        (r) =>
          checkApprover({
            approverId: actor.id,
            approverRole: actor.role,
            proposerId: r.proposedBy,
            investigatorId: c.investigatorId,
            clientUserId: c.clientUserId,
            ptUserId: c.ptUserId,
            conflictOfInterestDeclaredNone: true,
          }).ok,
      );
      out.approvePolicyEligibility = mine.length
        ? ok(mine.map((r) => r.id))
        : no(i.pendingPolicyReviews.length ? "SELF_APPROVAL_FORBIDDEN" : "NO_PENDING_REVIEW", i.pendingPolicyReviews.length ? "Bạn không được duyệt kết luận chính sách đang chờ (người đề xuất, điều tra viên hoặc một bên của vụ việc)" : "Không có kết luận chính sách nào đang chờ duyệt");
    }
  }
  out.share = investigatorOnly() ?? (terminal || status === "INTAKE" ? no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này") : null) ?? ok();

  // execution axis
  out.execute =
    adminOnly() ??
    notParty() ??
    stateOnly(["DECISION_APPROVED"]) ??
    (c.execStatus === "NOT_STARTED" || c.execStatus === "EXEC_BLOCKED" ? null : no("EXECUTION_NOT_STARTABLE", "Quyết định này đang hoặc đã được thực thi")) ??
    (i.flags.executionEnabled ? null : no("EXECUTION_DISABLED", "Bộ thực thi quyết định hồ sơ đang tắt")) ??
    ok();
  out.reconcileExecution =
    adminOnly() ?? notParty() ?? (c.execStatus === "EXECUTING" ? null : no("NOTHING_TO_RECONCILE", "Không có lần thực thi nào đang dở")) ?? (i.flags.executionEnabled ? null : no("EXECUTION_DISABLED", "Bộ thực thi quyết định hồ sơ đang tắt")) ?? ok();
  out.acknowledgeNeedsHuman =
    adminOnly() ?? notParty() ?? (c.execStatus === "NEEDS_HUMAN" ? null : no("NOT_NEEDS_HUMAN", "Việc thực thi không ở trạng thái chờ người xem xét")) ?? (i.flags.executionEnabled ? null : no("EXECUTION_DISABLED", "Bộ thực thi quyết định hồ sơ đang tắt")) ?? ok();

  // closing without a decision (never money)
  out.closeNotADispute =
    investigatorOnly() ?? stateOnly(["FINDING_RECORDED"]) ?? (i.latestFinding === "NOT_A_DISPUTE" ? null : no("FINDING_NOT_A_DISPUTE", "Chỉ đóng được khi kết luận hiện tại là 'không phải khiếu nại'")) ?? ok();
  out.closeOrphan =
    adminOnly() ??
    notParty() ??
    notTerminal() ??
    (i.sessionStatus === null ? no("SESSION_UNKNOWN", "Không đọc được trạng thái buổi tập") : null) ??
    (sessionStillInDispute(i.sessionStatus) ? no("SESSION_STILL_IN_DISPUTE", "Buổi tập vẫn đang trong khiếu nại nên hồ sơ không phải hồ sơ mồ côi") : null) ??
    ok();

  out.closeExecuted =
    adminOnly() ??
    notParty() ??
    stateOnly(["DECISION_APPROVED"]) ??
    (c.execStatus === "BUSINESS_DONE" ? null : no("DECISION_NOT_EXECUTED", "Quyết định đã duyệt chưa được thực thi xong; đóng hồ sơ không thay cho thực thi")) ??
    ok();

  out.readEvidenceFile = adminOnly() ?? notParty() ?? (i.flags.evidenceStorageEnabled ? null : no("FEATURE_DISABLED", "Chức năng lưu tệp bằng chứng chưa được bật")) ?? ok();
  return out;
}

export const allowedList = (m: Record<ActionName, ActionVerdict>): ActionName[] => ACTION_NAMES.filter((a) => m[a].allowed);
