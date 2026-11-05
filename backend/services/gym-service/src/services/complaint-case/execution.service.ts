import { prisma } from '../../repositories/prisma';
import { paymentClient } from '../../clients/payment.client';
import { membershipService } from '../membership.service';
import { caseError, forbiddenRole } from './errors';
import { gymCaseEnabled } from './flags';
import {
  ackTimesOf,
  assertRefundable,
  gymLinkedUserIds,
  evidenceGuard,
  financialOf,
  notifyMember,
  requireUuid,
  toJson,
  type Actor,
  type CaseRow,
  type Tx,
} from './case.service';
import {
  changeAcknowledged,
  checkApprover,
  closureOf,
  deriveFinancialView,
  isRefundOutcome,
  memberResolutionText,
  outcomeFor,
  outcomeLabelVi,
  refundReasonFor,
  type CaseClass,
  type CaseStatus,
  type FindingKind,
  type Outcome,
  type PaymentObservation,
  type SnapshotEntry,
} from './rules';

/**
 * GYM COMPLAINT CASE - the CaseDecision EXECUTOR (design 1.2.2, 1.3.4, 1.7.4). The ONLY door through which a Case changes a complaint's resolution or moves
 * money, and the money goes out ONLY through the existing membershipService.refundByAdmin (which computes the amount itself: this file never passes one).
 * No new money source, no automatic refund from a complaint: execute is an explicit admin call on an APPROVED decision.
 *
 *   flag        GYM_COMPLAINT_CASE_ENABLED, fail-closed (flags.ts): effective only in NODE_ENV=test with an accepted isolated test DB.
 *   pre-checks  everything is re-read from the database (the decision id only SELECTS among the case's approvals): decision APPROVED + of THIS case; outcome
 *               RE-COMPUTED from (class, latest finding); four-eyes + conflict of interest re-checked; the executor is not a party; no unacknowledged evidence
 *               change; for a refund the membership is still refundable. A refusal before the start changes nothing.
 *   start       ONE transaction: compare-and-set on the case (NOT_STARTED | EXEC_BLOCKED -> EXECUTING) + the STARTED history row (key GYM_CASE_DECISION:<id>).
 *   money       refundByAdmin(membership, verified actor, reason). It is retry-safe by itself (payment idempotency keys + refundClawbackDone).
 *   finish      ONE transaction: EXECUTING -> BUSINESS_DONE + the BUSINESS_DONE row (what payment-service returned) + the complaint RESOLVED. BUSINESS_DONE means
 *               the business exit answered; it is NOT "money arrived": the money axis is DERIVED from the stored payment answers (rules.deriveFinancialView).
 *   crash       reconcileExecution reads the real state first: membership still ACTIVE -> run refundByAdmin again (safe); membership CANCELLED -> replay the
 *               payment-service release by its key and only accept it when it shows a refund to the member; anything else -> NEEDS_HUMAN. Never a blind retry.
 *
 * Identity: refundByAdmin is handed the VERIFIED actor (the token's admin). Its calls to payment-service are internal-secret routes that carry no admin id,
 * so the known B-6 issue (adminId taken from the body of POST /admin/payments/:id/refund) is NOT on this path; this layer never calls that route.
 */
export const EXECUTION_IN_PROGRESS = 'EXECUTION_IN_PROGRESS';
export const executionKey = (decisionId: string) => `GYM_CASE_DECISION:${decisionId}`;

export interface RefundResult {
  refundAmount: number;
  clawback: { recovered: string; shortfall: string } | null;
  release: { refundedToClient?: string; shortfall?: string } & Record<string, unknown>;
}
export interface ExecDeps {
  /** The money exit. Default: membershipService.refundByAdmin. */
  refund: (membershipId: string, actorId: string, reason: 'TRANSACTION_ERROR' | 'GYM_CLOSED' | 'GYM_VIOLATION_SUSPENDED', caseDecisionId: string) => Promise<RefundResult>;
  /** Replays the payment-service release of a membership by its key (idempotent read of the first answer). Default: paymentClient.releaseMembershipPending with refund 0. */
  replayRelease: (m: { id: string; paymentTxnId: string; gymId: string; clientId: string; ptUserId: string | null }) => Promise<{ refundedToClient?: string; shortfall?: string }>;
  /** TEST SEAM - awaited after the case was set to EXECUTING and before money is asked to move. */
  afterExecutingCas?: () => Promise<void>;
  /** TEST SEAM - awaited after refundByAdmin returned and before BUSINESS_DONE is recorded. */
  afterRefund?: () => Promise<void>;
}
export const defaultExecDeps = (): ExecDeps => ({
  refund: (membershipId, actorId, reason, caseDecisionId) => membershipService.refundByAdmin(membershipId, actorId, reason, { caseDecisionId }) as unknown as Promise<RefundResult>,
  replayRelease: (m) =>
    paymentClient.releaseMembershipPending({
      transactionId: m.paymentTxnId,
      gymId: m.gymId,
      clientId: m.clientId,
      ptUserId: m.ptUserId,
      refundToClient: '0',
      membershipStatus: 'CANCELLED',
      label: `Membership ${m.id} case replay`,
      idempotencyKey: `MEMBERSHIP_RELEASE:${m.id}`,
    }),
});

function blockedError(reason: string, message: string) {
  return caseError(409, 'EXEC_BLOCKED', message, { reason });
}

interface Loaded {
  c: CaseRow & { complaint: { id: string; status: string; reporterUserId: string | null } };
  approval: NonNullable<Awaited<ReturnType<typeof findApproval>>>;
  outcome: Outcome;
}
const approvalInclude = { proposal: { include: { finding: true } } } as const;
async function findApproval(where: { id: string } | { result: 'APPROVED'; proposal: { caseId: string } }) {
  return 'id' in where ? prisma.gymCaseApproval.findUnique({ where, include: approvalInclude }) : prisma.gymCaseApproval.findFirst({ where, include: approvalInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}

/** Everything read again from the database. */
async function loadAndCheck(actor: Actor, caseId: string, decisionId: string | undefined): Promise<Loaded> {
  if (actor.role !== 'ADMIN') throw forbiddenRole();
  if (!gymCaseEnabled()) throw caseError(409, 'GYM_CASE_DISABLED', 'Lớp hồ sơ khiếu nại phòng gym đang tắt (chỉ bật được trong môi trường kiểm thử cô lập)');
  requireUuid(caseId);
  if (decisionId !== undefined) requireUuidDecision(decisionId);
  const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, include: { complaint: { select: { id: true, status: true, reporterUserId: true } } } });
  if (!c) throw caseError(404, 'CASE_NOT_FOUND', 'Không tìm thấy hồ sơ khiếu nại');
  let approval;
  if (decisionId) {
    approval = await findApproval({ id: decisionId });
    if (!approval) throw caseError(404, 'DECISION_NOT_FOUND', 'Không tìm thấy quyết định');
    if (approval.proposal.caseId !== c.id) throw caseError(409, 'DECISION_WRONG_CASE', 'Quyết định này không thuộc hồ sơ');
  } else {
    approval = await findApproval({ result: 'APPROVED', proposal: { caseId: c.id } });
    if (!approval) throw caseError(409, 'DECISION_NOT_APPROVED', 'Hồ sơ chưa có quyết định được duyệt');
  }
  if (approval.result !== 'APPROVED') throw caseError(409, 'DECISION_NOT_APPROVED', 'Quyết định chưa được duyệt');
  if (c.status !== 'DECISION_APPROVED') throw caseError(409, 'CASE_STATE_NOT_ALLOWED', 'Hồ sơ chưa ở trạng thái đã duyệt quyết định', { status: c.status });

  // The outcome is computed again from (class, the finding the proposal was built on) - and that finding must still be the case's latest.
  const latest = await prisma.gymCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
  const recomputed = outcomeFor(c.caseClass as CaseClass, approval.proposal.finding.finding as FindingKind);
  if (recomputed !== approval.proposal.outcome || latest?.id !== approval.proposal.findingId) {
    throw caseError(409, 'OUTCOME_MISMATCH', 'Kết quả của quyết định không khớp với kết luận của hồ sơ', { stored: approval.proposal.outcome, recomputed });
  }

  const gym = await prisma.gym.findUnique({ where: { id: c.gymId }, select: { ownerId: true } });
  const linkedUserIds = await gymLinkedUserIds(prisma, c.gymId);
  const verdict = checkApprover({
    approverId: approval.approverId,
    approverRole: 'ADMIN',
    proposerId: approval.proposal.proposerId,
    investigatorId: c.investigatorId,
    reporterUserId: c.reporterUserId,
    gymOwnerId: gym?.ownerId ?? null,
    linkedUserIds,
    conflictOfInterestDeclaredNone: approval.conflictOfInterestDeclaredNone,
  });
  if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);
  if (actor.id === c.reporterUserId || (gym?.ownerId && actor.id === gym.ownerId) || linkedUserIds.includes(actor.id)) {
    throw caseError(403, 'CONFLICT_OF_INTEREST', 'Quản trị viên là một bên của vụ việc nên không được thực thi');
  }
  return { c, approval, outcome: approval.proposal.outcome as Outcome };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuidDecision(id: string) {
  if (!UUID_RE.test(id)) throw caseError(404, 'DECISION_NOT_FOUND', 'Không tìm thấy quyết định');
}

async function assertEvidenceUnchanged(l: Loaded): Promise<void> {
  const { c, approval } = l;
  if (!(c.execStatus === 'NOT_STARTED' || c.execStatus === 'EXEC_BLOCKED')) return; // a replay must still answer
  const guard = await evidenceGuard(prisma, c, approval.proposal.evidenceSnapshot as unknown as SnapshotEntry[]);
  if (!guard.changed) return;
  const acked = changeAcknowledged(guard, approval.evidenceChangeAcknowledged, await ackTimesOf(prisma, c));
  const afterApproval = guard.staleLive.length > 0 || (guard.lastChangeAt !== null && guard.lastChangeAt.getTime() > approval.createdAt.getTime());
  if (!acked || afterApproval) {
    throw caseError(409, 'EVIDENCE_CHANGED', 'Bằng chứng đã thay đổi sau khi quyết định được duyệt mà chưa được xác nhận', { changedIds: guard.newIds, staleLive: guard.staleLive });
  }
}

async function recordBlocked(c: { id: string; membershipId: string | null }, approval: { id: string; proposal: { outcome: any } }, actor: Actor, reason: string, message: string): Promise<never> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM gym_complaint_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const cur = await tx.gymComplaintCase.findUniqueOrThrow({ where: { id: c.id } });
    if (cur.execStatus === 'BUSINESS_DONE' || cur.execStatus === 'NEEDS_HUMAN') return;
    await tx.gymComplaintCase.update({ where: { id: c.id }, data: { execStatus: 'EXEC_BLOCKED', execDecisionId: approval.id, version: { increment: 1 } } });
    await tx.gymCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: 'BLOCKED', blockedReason: reason, note: message },
    });
    await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: 'EXECUTION_BLOCKED', note: reason, payload: toJson({ reason, decisionId: approval.id }) } });
  });
  throw blockedError(reason, message);
}

async function recordNeedsHuman(c: { id: string }, approval: { id: string; proposal: { outcome: any } }, actor: Actor, reason: string, detail?: unknown): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM gym_complaint_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const cur = await tx.gymComplaintCase.findUniqueOrThrow({ where: { id: c.id } });
    if (cur.execStatus === 'BUSINESS_DONE') return;
    await tx.gymComplaintCase.update({ where: { id: c.id }, data: { execStatus: 'NEEDS_HUMAN', execDecisionId: approval.id, version: { increment: 1 } } });
    await tx.gymCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, outcome: approval.proposal.outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: 'NEEDS_HUMAN', blockedReason: reason, response: detail === undefined ? undefined : toJson(detail) },
    });
    await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: 'EXECUTION_NEEDS_HUMAN', note: reason, payload: toJson({ reason, decisionId: approval.id, detail: detail ?? null }) } });
  });
}

/** What the executor remembers from payment-service's answers; the money axis is derived from it. */
function observationFrom(r: RefundResult, clawbackWasAlreadyDone: boolean, hasReferral: boolean): PaymentObservation {
  return {
    refundAmount: String(r.refundAmount),
    refundedToClient: r.release?.refundedToClient ?? null,
    releaseShortfall: r.release?.shortfall ?? null,
    // null clawback is normal when there is no referral or nothing to claw; it is "not observed" only when an earlier attempt already ran the clawback step
    clawbackObserved: !(hasReferral && clawbackWasAlreadyDone && r.clawback === null),
    clawbackRecovered: r.clawback?.recovered ?? null,
    clawbackShortfall: r.clawback?.shortfall ?? null,
    observedAt: new Date().toISOString(),
  };
}

async function finish(c: { id: string; complaintId: string; reporterUserId: string }, approval: { id: string; approverId: string; proposal: { outcome: any } }, actor: Actor, via: string, observation: PaymentObservation | null) {
  const outcome = approval.proposal.outcome as Outcome;
  const view = deriveFinancialView({ outcome, execStatus: 'BUSINESS_DONE', observation });
  const text = memberResolutionText(outcome, view);
  const response = { outcome, decisionId: approval.id, via, payment: observation, resolutionText: text };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM gym_complaint_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
    const r = await tx.gymComplaintCase.updateMany({ where: { id: c.id, execStatus: 'EXECUTING', execDecisionId: approval.id }, data: { execStatus: 'BUSINESS_DONE', version: { increment: 1 } } });
    if (r.count !== 1) throw caseError(409, 'EXECUTION_STATE_CHANGED', 'Trạng thái thực thi của hồ sơ đã thay đổi');
    await tx.gymCaseExecution.create({
      data: { caseId: c.id, decisionId: approval.id, outcome, actorUserId: actor.id, idempotencyKey: executionKey(approval.id), attempt: 0, state: 'BUSINESS_DONE', response: toJson(response) },
    });
    // The complaint is resolved HERE (and only here for a complaint that has a case): same wording the member is told.
    await tx.gymComplaint.update({ where: { id: c.complaintId }, data: { status: 'RESOLVED', adminResponse: text, resolvedAt: new Date(), resolvedBy: actor.id } });
    await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: 'EXECUTION_BUSINESS_DONE', note: via, payload: toJson(response) } });
  });
  await notifyMember({ id: c.id, reporterUserId: c.reporterUserId }, text, 'GYM_COMPLAINT_CASE_RESOLVED', 'CONCLUSION'); // A1: a DELIVERED CONCLUSION notice starts the 14-day appeal window
  return { view, text };
}

function answer(l: { c: CaseRow; outcome: Outcome }, replayed: boolean, view: ReturnType<typeof deriveFinancialView>) {
  return {
    replayed,
    executionState: 'BUSINESS_DONE' as const,
    outcome: l.outcome,
    outcomeLabel: outcomeLabelVi(l.outcome),
    money: view,
    closure: closureOf('DECISION_APPROVED', 'BUSINESS_DONE', view),
  };
}

/** Runs the money step (if the outcome has one) for a case that is EXECUTING, then records the end. Used by the first run and by the recovery. */
async function runAndFinish(l: Loaded, actor: Actor, deps: ExecDeps, via: string) {
  const { c, approval, outcome } = l;
  let observation: PaymentObservation | null = null;
  if (isRefundOutcome(outcome)) {
    const reason = refundReasonFor(outcome)!;
    const pre = await prisma.gymMembershipContract.findUnique({ where: { id: c.membershipId! }, include: { referral: true } });
    let r: RefundResult;
    try {
      r = await deps.refund(c.membershipId!, actor.id, reason, approval.id);
    } catch (e: any) {
      // refundByAdmin refuses (409/404/400) BEFORE any money step when the membership is no longer refundable: nothing moved, the case waits.
      if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
        await recordBlocked(c, approval, actor, `REFUND_REFUSED:${String(e?.message ?? e?.status)}`.slice(0, 200), 'Hệ thống từ chối hoàn tiền cho gói hội viên này (không còn ở trạng thái hoàn được). Chưa có khoản tiền nào được chuyển');
      }
      throw e; // 5xx / network: the case stays EXECUTING; reconcileExecution reads the real state before anything is retried
    }
    observation = observationFrom(r, !!pre?.refundClawbackDone, !!pre?.referral);
    if (deps.afterRefund) await deps.afterRefund();
  }
  return finish(c, approval, actor, via, observation);
}

export const complaintCaseExecutionService = {
  /**
   * Executes the approved decision of a case. Returns { executionState: "BUSINESS_DONE", money (derived), ... } or throws a coded refusal:
   * 404/409/403 with a stable `code`; EXEC_BLOCKED / NEEDS_HUMAN / EXECUTION_IN_PROGRESS are 409 with `details.reason`.
   */
  async executeDecision(actor: Actor, caseId: string, opts: { decisionId?: string } = {}, deps: ExecDeps = defaultExecDeps()) {
    const l = await loadAndCheck(actor, caseId, opts.decisionId);
    const { c, approval, outcome } = l;
    const key = executionKey(approval.id);

    // Already executed: the SAME answer, nothing runs again (no second refund).
    if (c.execStatus === 'BUSINESS_DONE' && c.execDecisionId === approval.id) {
      const executions = await prisma.gymCaseExecution.findMany({ where: { caseId: c.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return answer(l, true, financialOf(c, outcome, executions));
    }
    if (c.execStatus === 'EXECUTING') throw caseError(409, EXECUTION_IN_PROGRESS, 'Quyết định đang được thực thi (hoặc lần thực thi trước chưa kết thúc). Dùng đối chiếu thực thi để xử lý', { decisionId: approval.id });
    if (c.execStatus === 'NEEDS_HUMAN') throw caseError(409, 'NEEDS_HUMAN', 'Việc thực thi quyết định này đang chờ người xem xét');
    if (c.execDecisionId && c.execDecisionId !== approval.id) throw caseError(409, 'DECISION_MISMATCH', 'Hồ sơ đã gắn với một quyết định khác');

    await assertEvidenceUnchanged(l);
    if (isRefundOutcome(outcome)) {
      try {
        await assertRefundable(prisma, c);
      } catch (e: any) {
        if (e?.status === 409 || e?.status === 404) await recordBlocked(c, approval, actor, String(e?.code ?? 'MEMBERSHIP_NOT_REFUNDABLE'), String(e?.message ?? 'Gói hội viên không hoàn được'));
        throw e;
      }
    }

    // START: CAS on the case + the STARTED row, one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM gym_complaint_cases WHERE id = ${c.id}::uuid FOR UPDATE`;
      const r = await tx.gymComplaintCase.updateMany({
        where: { id: c.id, execStatus: { in: ['NOT_STARTED', 'EXEC_BLOCKED'] }, OR: [{ execDecisionId: null }, { execDecisionId: approval.id }] },
        data: { execStatus: 'EXECUTING', execDecisionId: approval.id, version: { increment: 1 } },
      });
      if (r.count !== 1) throw caseError(409, EXECUTION_IN_PROGRESS, 'Quyết định đang được thực thi bởi một lệnh khác', { decisionId: approval.id });
      const attempt = (await tx.gymCaseExecution.count({ where: { idempotencyKey: key, state: 'STARTED' } })) + 1;
      await tx.gymCaseExecution.create({ data: { caseId: c.id, decisionId: approval.id, outcome, actorUserId: actor.id, idempotencyKey: key, attempt, state: 'STARTED' } });
      await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: 'EXECUTION_STARTED', note: `attempt ${attempt}`, payload: toJson({ decisionId: approval.id, outcome, attempt }) } });
    });
    if (deps.afterExecutingCas) await deps.afterExecutingCas();

    const { view } = await runAndFinish(l, actor, deps, 'EXECUTE');
    return answer(l, false, view);
  },

  /**
   * Crash recovery for a case left in EXECUTING. Reads the real state first:
   *   no money step (RESOLVE_*)                          -> BUSINESS_DONE
   *   membership still ACTIVE                            -> refundByAdmin again (its idempotency keys make a second run safe)
   *   membership CANCELLED and the payment release replay shows a refund to the member -> BUSINESS_DONE (clawback result then NOT observed -> reconcile flag)
   *   anything else (cancelled elsewhere / expired / unreadable) -> NEEDS_HUMAN, no retry
   */
  async reconcileExecution(actor: Actor, caseId: string, deps: ExecDeps = defaultExecDeps()) {
    if (actor.role !== 'ADMIN') throw forbiddenRole();
    if (!gymCaseEnabled()) throw caseError(409, 'GYM_CASE_DISABLED', 'Lớp hồ sơ khiếu nại phòng gym đang tắt (chỉ bật được trong môi trường kiểm thử cô lập)');
    requireUuid(caseId);
    const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, include: { complaint: { select: { id: true, status: true, reporterUserId: true } } } });
    if (!c) throw caseError(404, 'CASE_NOT_FOUND', 'Không tìm thấy hồ sơ khiếu nại');
    if (c.execStatus !== 'EXECUTING' || !c.execDecisionId) return { action: 'NOTHING_TO_RECONCILE' as const, execStatus: c.execStatus };
    const approval = await findApproval({ id: c.execDecisionId });
    if (!approval || approval.proposal.caseId !== c.id) return { action: 'NEEDS_HUMAN' as const, reason: 'DECISION_UNREADABLE' };
    const outcome = approval.proposal.outcome as Outcome;
    const l: Loaded = { c, approval, outcome };
    const handOver = async (reason: string, detail?: unknown) => {
      await recordNeedsHuman(c, approval, actor, reason, detail);
      return { action: 'NEEDS_HUMAN' as const, reason };
    };
    if (!isRefundOutcome(outcome)) {
      const { view } = await finish(c, approval, actor, 'RECONCILE_NO_MONEY_STEP', null);
      return { action: 'BUSINESS_DONE' as const, ...answer(l, false, view) };
    }
    let m;
    try {
      m = await prisma.gymMembershipContract.findUnique({ where: { id: c.membershipId! }, include: { referral: true } });
    } catch (e: any) {
      return handOver('STATE_UNREADABLE', { message: String(e?.message ?? '').slice(0, 200) });
    }
    if (!m) return handOver('MEMBERSHIP_MISSING');
    if (m.status === 'ACTIVE') {
      const r = await runAndFinish(l, actor, deps, 'RECONCILE_RERUN');
      return { action: 'RERAN_REFUND' as const, ...answer(l, false, r.view) };
    }
    if (m.status === 'CANCELLED' && m.paymentTxnId) {
      let rel: { refundedToClient?: string; shortfall?: string };
      try {
        rel = await deps.replayRelease({ id: m.id, paymentTxnId: m.paymentTxnId, gymId: m.gymId, clientId: m.clientId, ptUserId: m.referral?.referrerPtUserId ?? null });
      } catch (e: any) {
        return handOver('RELEASE_REPLAY_UNREADABLE', { message: String(e?.message ?? '').slice(0, 200) });
      }
      if (Number(rel?.refundedToClient ?? 0) > 0) {
        const obs: PaymentObservation = { refundedToClient: rel.refundedToClient ?? null, releaseShortfall: rel.shortfall ?? null, clawbackObserved: !m.referral, observedAt: new Date().toISOString() };
        const { view } = await finish(c, approval, actor, 'RECONCILE_ALREADY_REFUNDED', obs);
        return { action: 'BUSINESS_DONE' as const, ...answer(l, false, view) };
      }
      return handOver('CANCELLED_WITHOUT_REFUND_BY_THIS_DECISION', { refundedToClient: rel?.refundedToClient ?? null });
    }
    return handOver('MEMBERSHIP_STATE_UNEXPECTED', { status: m.status });
  },

  /** The recovery sweep: every case EXECUTING for longer than `olderThanMs`. */
  async reconcileStale(actor: Actor, olderThanMs = 60_000, deps: ExecDeps = defaultExecDeps()) {
    if (!gymCaseEnabled()) return [];
    const rows = await prisma.gymComplaintCase.findMany({ where: { execStatus: 'EXECUTING', updatedAt: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true }, take: 50 });
    const out: Array<{ caseId: string; result: unknown }> = [];
    for (const r of rows) {
      try {
        out.push({ caseId: r.id, result: await complaintCaseExecutionService.reconcileExecution(actor, r.id, deps) });
      } catch (e: any) {
        out.push({ caseId: r.id, result: { error: String(e?.code ?? e?.message ?? 'ERROR') } });
      }
    }
    return out;
  },
};

export type { CaseStatus, Tx };
