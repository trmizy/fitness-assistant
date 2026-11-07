import {
  INVESTIGATION_STATUSES,
  MANUAL_TARGETS,
  PARTY_SUBMIT_STATUSES,
  APPEAL_WINDOW_DAYS,
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
  flags: { executionEnabled: boolean; evidenceStorageEnabled: boolean; appealsEnabled: boolean; decisionReplacementEnabled: boolean };
  /** V2.1 process facts the service reads for the case (optional: absent = nothing recorded) */
  v21?: V21Facts;
}

/** What the V2.1 process actions need to know about the case. Rows only, no behaviour. */
export interface V21Facts {
  agreements: ReadonlyArray<{ id: string; status: string; confirmedRoles: string[] }>;
  appeals: ReadonlyArray<{
    id: string;
    status: string;
    reviewerId: string | null;
    consequences: ReadonlyArray<{ id: string; kind: string; status: string; amountRequested: boolean; corrections: ReadonlyArray<{ id: string; proposedBy: string; appliedAt: Date | null }> }>;
  }>;
  /** proposers and approvers of every proposal of the case (the appeal reviewer must not be one of them) */
  involvedIds: string[];
  replacement: { hasApprovedDecision: boolean; effectCode: string | null; pending: ReadonlyArray<{ id: string; proposedBy: string }> };
  /** open held-money review ids of the case's session */
  openHeldReviewIds: string[];
  /** contract-level (no case) policy reviews not approved yet */
  pendingContractPolicyReviews: ReadonlyArray<{ id: string; proposedBy: string }>;
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
  // V2.1 process (mutual agreement, appeal, consequences, replacement, held money, contract-level policy)
  "proposeAgreement",
  "withdrawAgreement",
  "recordAgreementFinding",
  "assignAppealReviewer",
  "decideAppeal",
  "createAppealObligation",
  "syncAppealObligation",
  "proposeQuotaCorrection",
  "approveQuotaCorrection",
  "proposeDecisionReplacement",
  "approveDecisionReplacement",
  "rejectDecisionReplacement",
  "decideHeldMoney",
  "proposeContractPolicy",
  "approveContractPolicy",
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
    (i.sessionStatus === null ? no("SESSION_NOT_FOUND", "Không đọc được trạng thái buổi tập") : null) ??
    (sessionStillInDispute(i.sessionStatus) ? no("CASE_NOT_ORPHAN", "Buổi tập vẫn đang trong khiếu nại nên hồ sơ không phải hồ sơ mồ côi") : null) ??
    ok();

  out.closeExecuted =
    adminOnly() ??
    notParty() ??
    stateOnly(["DECISION_APPROVED"]) ??
    (c.execStatus === "BUSINESS_DONE" ? null : no("DECISION_NOT_EXECUTED", "Quyết định đã duyệt chưa được thực thi xong; đóng hồ sơ không thay cho thực thi")) ??
    ((i.v21?.appeals ?? []).some((a) => a.status !== "DECIDED") ? no("APPEAL_PENDING", "Còn yêu cầu xem xét lại chưa có kết quả nên chưa đóng được hồ sơ") : null) ??
    ((i.v21?.appeals ?? []).some((a) => a.consequences.some((k) => k.status === "OPEN")) ? no("APPEAL_CONSEQUENCE_OPEN", "Kết quả xem xét lại còn việc chưa xử lý (tiền, buổi hoặc lỗi PT) nên chưa đóng được hồ sơ") : null) ??
    ok();

  out.readEvidenceFile = adminOnly() ?? notParty() ?? (i.flags.evidenceStorageEnabled ? null : no("FEATURE_DISABLED", "Chức năng lưu tệp bằng chứng chưa được bật")) ?? ok();

  // ── V2.1 process actions. Same order as the services: (admin) -> flag -> party/investigator -> state -> object. ──
  const v: V21Facts = i.v21 ?? { agreements: [], appeals: [], involvedIds: [], replacement: { hasApprovedDecision: false, effectCode: null, pending: [] }, openHeldReviewIds: [], pendingContractPolicyReviews: [] };
  const processFlag = (): ActionVerdict | null => (i.flags.appealsEnabled ? null : no("DISPUTE_PROCESS_DISABLED", "Chức năng thoả thuận, xem xét lại và hiệu chỉnh buổi chưa được bật"));
  const replacementFlag = (): ActionVerdict | null => (i.flags.decisionReplacementEnabled ? null : no("DECISION_REPLACEMENT_DISABLED", "Chức năng thay thế quyết định đã duyệt đang tắt"));
  const conflict = (): ActionVerdict | null => (isParty ? no("CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc") : null);

  out.proposeAgreement =
    adminOnly() ?? processFlag() ?? investigatorOnly() ?? stateOnly(["COLLECTING", "AWAITING_PARTIES", "ASSESSING"]) ?? classified() ?? ok(["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"]);
  out.withdrawAgreement = (() => {
    const base = adminOnly() ?? processFlag() ?? investigatorOnly();
    if (base) return base;
    const open = v.agreements.filter((a) => a.status === "PROPOSED" || a.status === "AGREED");
    return open.length ? ok(open.map((a) => a.id)) : no("AGREEMENT_NOT_OPEN", "Không có phương án chung nào còn hiệu lực để rút");
  })();
  out.recordAgreementFinding = (() => {
    const base = adminOnly() ?? processFlag() ?? investigatorOnly() ?? stateOnly(["ASSESSING"]);
    if (base) return base;
    const agreed = v.agreements.filter((a) => a.status === "AGREED" && a.confirmedRoles.length === 2);
    return agreed.length ? ok(agreed.map((a) => a.id)) : no("AGREEMENT_NOT_AGREED", "Chưa có phương án nào được cả hai bên cùng xác nhận");
  })();

  out.assignAppealReviewer = (() => {
    const base = adminOnly() ?? processFlag() ?? conflict();
    if (base) return base;
    if (!v.appeals.length) return no("APPEAL_NOT_FOUND", "Hồ sơ chưa có yêu cầu xem xét lại");
    const open = v.appeals.filter((a) => a.status !== "DECIDED");
    return open.length ? ok(open.map((a) => a.id)) : no("APPEAL_ALREADY_DECIDED", "Mọi yêu cầu xem xét lại của hồ sơ đã có kết quả");
  })();
  out.decideAppeal = (() => {
    const base = adminOnly() ?? processFlag();
    if (base) return base;
    if (!v.appeals.length) return no("APPEAL_NOT_FOUND", "Hồ sơ chưa có yêu cầu xem xét lại");
    const mine = v.appeals.filter((a) => a.status === "UNDER_REVIEW" && a.reviewerId === actor.id);
    if (!mine.length) {
      return v.appeals.every((a) => a.status === "DECIDED") ? no("APPEAL_ALREADY_DECIDED", "Mọi yêu cầu xem xét lại của hồ sơ đã có kết quả") : no("NOT_APPEAL_REVIEWER", "Chỉ người xem xét lại được giao mới ghi kết quả");
    }
    // same order as assertIndependentReviewer
    if (isParty) return no("CONFLICT_OF_INTEREST", "Người xem xét lại là một bên của vụ việc");
    if (c.investigatorId && actor.id === c.investigatorId) return no("REVIEWER_NOT_INDEPENDENT", "Người xem xét lại không được là điều tra viên của hồ sơ");
    if (v.involvedIds.includes(actor.id)) return no("REVIEWER_NOT_INDEPENDENT", "Người xem xét lại không được là người đã đề xuất hoặc duyệt quyết định ban đầu");
    return ok(mine.map((a) => a.id));
  })();

  const consequences = v.appeals.flatMap((a) => a.consequences.map((k) => ({ ...k, reviewerId: a.reviewerId })));
  out.createAppealObligation = (() => {
    const base = adminOnly() ?? processFlag();
    if (base) return base;
    const money = consequences.filter((k) => k.kind === "MONEY");
    if (!money.length) return no("CONSEQUENCE_NOT_FOUND", "Hồ sơ không có hệ quả tiền nào");
    const est = money.filter((k) => k.amountRequested);
    return est.length ? ok(est.map((k) => k.id)) : no("MONEY_NOT_ESTABLISHED", "Kết luận chưa xác lập số tiền và bên chịu trách nhiệm: không tạo khoản nợ, giữ để đối soát");
  })();
  out.syncAppealObligation = (() => {
    const base = adminOnly() ?? processFlag();
    if (base) return base;
    const money = consequences.filter((k) => k.kind === "MONEY");
    if (!money.length) return no("CONSEQUENCE_NOT_FOUND", "Hồ sơ không có hệ quả tiền nào");
    const withDebt = money.filter((k) => k.status === "OBLIGATION_OPEN" || k.status === "RESOLVED");
    return withDebt.length ? ok(withDebt.map((k) => k.id)) : no("NO_OBLIGATION", "Hệ quả này chưa có khoản nợ chính thức");
  })();
  out.proposeQuotaCorrection = (() => {
    const base = adminOnly() ?? processFlag() ?? conflict();
    if (base) return base;
    const quota = consequences.filter((k) => k.kind === "QUOTA");
    if (!quota.length) return no("CONSEQUENCE_NOT_FOUND", "Hồ sơ không có hệ quả buổi tập nào");
    const open = quota.filter((k) => k.status === "OPEN");
    if (!open.length) return no("CONSEQUENCE_NOT_OPEN", "Hệ quả này đã được xử lý");
    const free = open.filter((k) => !k.corrections.some((x) => x.appliedAt === null));
    return free.length ? ok(free.map((k) => k.id)) : no("CORRECTION_ALREADY_PROPOSED", "Đã có đề xuất hiệu chỉnh đang chờ duyệt cho hệ quả này");
  })();
  out.approveQuotaCorrection = (() => {
    const base = adminOnly() ?? processFlag();
    if (base) return base;
    const all = consequences.flatMap((k) => k.corrections.map((x) => ({ ...x, reviewerId: k.reviewerId })));
    if (!all.length) return no("CORRECTION_NOT_FOUND", "Hồ sơ chưa có đề xuất hiệu chỉnh nào");
    const pending = all.filter((x) => x.appliedAt === null);
    if (!pending.length) return no("CORRECTION_ALREADY_APPLIED", "Mọi đề xuất hiệu chỉnh đã được áp dụng");
    const verdicts = pending.map((x) => {
      const r = checkApprover({ approverId: actor.id, approverRole: actor.role, proposerId: x.proposedBy, investigatorId: c.investigatorId, clientUserId: c.clientUserId, ptUserId: c.ptUserId, conflictOfInterestDeclaredNone: true });
      if (!r.ok) return { id: x.id, v: no(r.code, r.message) };
      if (x.reviewerId === actor.id) return { id: x.id, v: no("SELF_APPROVAL_FORBIDDEN", "Người xem xét lại không được tự duyệt hiệu chỉnh buổi do mình quyết định") };
      return { id: x.id, v: ok() };
    });
    const good = verdicts.filter((x) => x.v.allowed);
    return good.length ? ok(good.map((x) => x.id)) : verdicts[0].v;
  })();

  // decision replacement (own flag; admin-only router): admin -> flag -> party -> object
  out.proposeDecisionReplacement =
    adminOnly() ??
    replacementFlag() ??
    conflict() ??
    (v.replacement.hasApprovedDecision ? null : no("DECISION_NOT_APPROVED", "Hồ sơ chưa có quyết định đã duyệt để thay thế")) ??
    (v.replacement.effectCode ? no(v.replacement.effectCode, "Quyết định đã duyệt này đã có tác động (buổi, quyền buổi, tiền hoặc thực thi): không thay thế được") : null) ??
    (v.replacement.pending.length ? no("REPLACEMENT_PENDING", "Hồ sơ đã có một đề xuất thay thế đang chờ") : null) ??
    ok();
  const replacementDecision = (selfCode: string, checkEffect: boolean): ActionVerdict => {
    const base = adminOnly() ?? replacementFlag() ?? conflict();
    if (base) return base;
    if (!v.replacement.pending.length) return no("REPLACEMENT_NOT_FOUND", "Không có đề xuất thay thế nào đang chờ");
    const others = v.replacement.pending.filter((r) => r.proposedBy !== actor.id);
    if (!others.length) {
      return no(selfCode, selfCode === "SELF_APPROVAL_FORBIDDEN" ? "Người đề xuất không được tự duyệt đề xuất thay thế của mình" : "Người đề xuất không được tự từ chối đề xuất của mình (cần người thứ hai)");
    }
    if (checkEffect && v.replacement.effectCode) return no(v.replacement.effectCode, "Quyết định đã duyệt này đã có tác động: không thay thế được");
    return ok(others.map((r) => r.id));
  };
  out.approveDecisionReplacement = replacementDecision("SELF_APPROVAL_FORBIDDEN", true);
  out.rejectDecisionReplacement = replacementDecision("SELF_REJECT_FORBIDDEN", false);

  out.decideHeldMoney = adminOnly() ?? processFlag() ?? (v.openHeldReviewIds.length ? ok(v.openHeldReviewIds) : no("HELD_REVIEW_NOT_FOUND", "Buổi của hồ sơ này không có khoản giữ nào đang chờ rà soát"));

  // contract-level policy review (the contract of this case): no flag; admin -> party of the contract -> object
  out.proposeContractPolicy = adminOnly() ?? (isParty ? no("CONFLICT_OF_INTEREST", "Quản trị viên là một bên của hợp đồng nên không được đề xuất kết luận chính sách") : null) ?? ok();
  out.approveContractPolicy = (() => {
    const base = adminOnly();
    if (base) return base;
    const verdictOf = (proposedBy: string) => checkApprover({ approverId: actor.id, approverRole: actor.role, proposerId: proposedBy, investigatorId: null, clientUserId: c.clientUserId, ptUserId: c.ptUserId, conflictOfInterestDeclaredNone: true });
    const mine = v.pendingContractPolicyReviews.filter((r) => verdictOf(r.proposedBy).ok);
    if (mine.length) return ok(mine.map((r) => r.id));
    if (!v.pendingContractPolicyReviews.length) return no("POLICY_REVIEW_NOT_FOUND", "Không có kết luận chính sách cấp hợp đồng nào đang chờ duyệt");
    const r = verdictOf(v.pendingContractPolicyReviews[0].proposedBy);
    return r.ok ? ok() : no(r.code, r.message);
  })();
  return out;
}

// ── Party side (client / PT): the same idea for the routes under /dispute-cases ─────────────────────────────────────────────────────────────────
export const PARTY_ACTION_NAMES = ["addStatement", "addEvidence", "addEvidenceFile", "confirmAgreement", "requestAppeal"] as const;
export type PartyActionName = (typeof PARTY_ACTION_NAMES)[number];

export interface PartyAllowedActionsInput {
  /** the party's role in the case (null = not a party: the route answers 404) */
  role: "CLIENT" | "PT" | null;
  c: { status: string; closeReason: string | null };
  flags: { evidenceStorageEnabled: boolean; appealsEnabled: boolean };
  now: Date;
  agreements: ReadonlyArray<{ id: string; status: string; confirmedRoles: string[] }>;
  /** when the CONCLUSION notice to THIS party was validly recorded (null = none recorded) */
  conclusionNoticeRecordedAt: Date | null;
  /** this party already requested an appeal for this case */
  appealRequested: boolean;
}

export function computePartyAllowedActions(i: PartyAllowedActionsInput): Record<PartyActionName, ActionVerdict> {
  const out = {} as Record<PartyActionName, ActionVerdict>;
  if (!i.role) {
    for (const n of PARTY_ACTION_NAMES) out[n] = no("CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
    return out;
  }
  const role = i.role;
  const submitState = (): ActionVerdict | null =>
    PARTY_SUBMIT_STATUSES.includes(i.c.status as CaseStatus) ? null : no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này");
  const flag = (): ActionVerdict | null => (i.flags.appealsEnabled ? null : no("DISPUTE_PROCESS_DISABLED", "Chức năng thoả thuận, xem xét lại và hiệu chỉnh buổi chưa được bật"));
  out.addStatement = submitState() ?? ok();
  out.addEvidence = submitState() ?? ok();
  out.addEvidenceFile = (i.flags.evidenceStorageEnabled ? null : no("FEATURE_DISABLED", "Chức năng lưu tệp bằng chứng chưa được bật")) ?? submitState() ?? ok();
  out.confirmAgreement = (() => {
    const base = flag();
    if (base) return base;
    if (!i.agreements.length) return no("AGREEMENT_NOT_FOUND", "Hồ sơ chưa có phương án chung nào");
    const open = i.agreements.filter((a) => a.status === "PROPOSED");
    if (!open.length) return no("AGREEMENT_NOT_OPEN", "Phương án chung này không còn chờ xác nhận");
    const mine = open.filter((a) => !a.confirmedRoles.includes(role));
    return mine.length ? ok(mine.map((a) => a.id)) : no("AGREEMENT_ALREADY_CONFIRMED", "Bạn đã xác nhận phương án này");
  })();
  out.requestAppeal = (() => {
    const base = flag();
    if (base) return base;
    const appealable = i.c.status === "DECISION_APPROVED" || (i.c.status === "CLOSED" && ["EXECUTED", "APPEAL_CONCLUDED"].includes(String(i.c.closeReason ?? "")));
    if (!appealable) return no("CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này");
    if (!i.conclusionNoticeRecordedAt) return no("APPEAL_NOTICE_NOT_RECORDED", "Chưa có thông báo kết luận được ghi nhận cho bạn nên chưa mở thời hạn xem xét lại");
    if (i.now.getTime() > i.conclusionNoticeRecordedAt.getTime() + APPEAL_WINDOW_DAYS * 86_400_000) return no("APPEAL_WINDOW_CLOSED", "Đã quá 14 ngày kể từ khi thông báo kết luận được ghi nhận cho bạn");
    if (i.appealRequested) return no("APPEAL_ALREADY_REQUESTED", "Mỗi bên chỉ được yêu cầu xem xét lại một lần cho mỗi hồ sơ");
    return ok();
  })();
  return out;
}

export const allowedList = (m: Record<ActionName, ActionVerdict>): ActionName[] => ACTION_NAMES.filter((a) => m[a].allowed);
export const allowedPartyList = (m: Record<PartyActionName, ActionVerdict>): PartyActionName[] => PARTY_ACTION_NAMES.filter((a) => m[a].allowed);
