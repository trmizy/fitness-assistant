import { Prisma } from '../../generated/prisma';
import { prisma } from '../../repositories/prisma';
import { paymentClient } from '../../clients/payment.client';
import { caseError } from './errors';
import { replacementEnabled } from './flags';
import { assertAdmin, assertNotParty, lockCase, mutate, requireUuid, toJson, type Actor, type CaseRow, type Db } from './case.service';

/**
 * E3 (Ngài approved; the same rule as user-service's A4) - REPLACING an approved Gym Case decision that has had NO money and NO business effect. Nothing else can be replaced.
 *
 *   what      propose (admin A, a reason) -> approve (admin B != A, neither a party of the case) | reject (admin B). While PENDING the executor answers 409 REPLACEMENT_PENDING.
 *             Approving puts the case back to FINDING_RECORDED (CAS on the case version, under the case row lock, execution axis reset to NOT_STARTED) so the normal path - new
 *             proposal, four-eyes approval, execute - makes the NEW decision. The B1 hold keeps the membership's money pending meanwhile (the case is open again).
 *   never     the old approval / proposal / execution rows are not touched (append-only; the old decision is only EXCLUDED from "the current decision" by the approved replacement),
 *             no money moves, no membership / complaint is written. Anything that shows an effect - the case EXECUTING / BUSINESS_DONE / NEEDS_HUMAN, an execution that finished,
 *             a ledger operation under the membership's release / clawback keys, a released payout, a clawback done, a membership that changed since the proposal, a complaint already
 *             RESOLVED - is refused 409 DECISION_HAS_EFFECT; a ledger that cannot be read is refused 503 (fail closed on any doubt). Refusals write nothing.
 *   race      execute and replace are ordered by the case row lock (+ the version CAS): a replacement proposed first stops the start of the execution; an execution started first
 *             makes the proposal fail (EXECUTING). The loser gets 409.
 *   flag      GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED on top of GYM_COMPLAINT_CASE_ENABLED, both evaluated by the same runtime gate (fail closed).
 */
type Tx = Prisma.TransactionClient;

function assertEnabled() {
  if (!replacementEnabled()) throw caseError(409, 'DECISION_REPLACEMENT_DISABLED', 'Chức năng thay thế quyết định đã duyệt đang tắt (chỉ bật được trong môi trường kiểm thử cô lập)');
}
const hasEffect = (reasons: string[]) => caseError(409, 'DECISION_HAS_EFFECT', 'Quyết định này đã có tác động (tiền hoặc nghiệp vụ) nên không thay thế được', { reasons });

/** The decision the executor must use: the newest APPROVED approval of the case that has NOT been replaced by an approved replacement. */
export async function currentApprovalWhere(db: Db, caseId: string) {
  const replaced = (await db.gymCaseDecisionReplacement.findMany({ where: { caseId, approvedAt: { not: null } }, select: { oldApprovalId: true } })).map((r) => r.oldApprovalId);
  return { result: 'APPROVED' as const, proposal: { caseId }, ...(replaced.length ? { id: { notIn: replaced } } : {}) };
}
export async function replacedApprovalIds(db: Db, caseId: string): Promise<string[]> {
  return (await db.gymCaseDecisionReplacement.findMany({ where: { caseId, approvedAt: { not: null } }, select: { oldApprovalId: true } })).map((r) => r.oldApprovalId);
}
/** True while an undecided replacement exists (read it under the case row lock to be ordered against an executor start). */
export async function hasPendingReplacement(db: Db, caseId: string): Promise<boolean> {
  return (await db.gymCaseDecisionReplacement.count({ where: { caseId, approvedAt: null, rejectedAt: null } })) > 0;
}

interface Facts {
  caseStatus: string;
  execStatus: string;
  execDecisionId: string | null;
  approvalId: string;
  complaintStatus: string;
  membership: { id: string; status: string; payoutReleasedAt: string | null; refundClawbackDone: boolean; endDate: string | null } | null;
  ledgerKeysFound: string[];
  ledgerChecked: boolean;
}

/** The keys under which the money step of an executed refund decision exists in payment-service. */
const ledgerKeysOf = (membershipId: string) => [`MEMBERSHIP_RELEASE:${membershipId}`, `REFERRAL_CLAWBACK:${membershipId}`];

/** Reads payment-service BEFORE the transaction (a network call must not hold the case lock). Unreadable = 503. */
async function readLedger(membershipId: string | null): Promise<{ found: string[]; checked: boolean }> {
  if (!membershipId) return { found: [], checked: false };
  try {
    const r = await paymentClient.lookupLedgerOperations(ledgerKeysOf(membershipId));
    return { found: r.operations.map((o) => o.key), checked: true };
  } catch {
    throw caseError(503, 'LEDGER_UNREADABLE', 'Chưa đọc được sổ cái để kiểm tra quyết định có tác động tiền hay chưa. Vui lòng thử lại sau');
  }
}

/** DB facts + the "no effect" verdict. Throws DECISION_HAS_EFFECT listing every effect found. */
async function checkNoEffect(db: Db, c: CaseRow, approvalId: string, ledger: { found: string[]; checked: boolean }): Promise<Facts> {
  const reasons: string[] = [];
  if (c.status !== 'DECISION_APPROVED') throw caseError(409, 'CASE_STATE_NOT_ALLOWED', 'Hồ sơ chưa ở trạng thái đã duyệt quyết định', { status: c.status });
  if (c.execStatus !== 'NOT_STARTED' && c.execStatus !== 'EXEC_BLOCKED') reasons.push(`EXEC_STATUS_${c.execStatus}`);
  const done = await db.gymCaseExecution.count({ where: { caseId: c.id, decisionId: approvalId, state: { in: ['BUSINESS_DONE', 'NEEDS_HUMAN'] } } });
  if (done > 0) reasons.push('EXECUTION_RECORDED');
  const complaint = await db.gymComplaint.findUniqueOrThrow({ where: { id: c.complaintId }, select: { status: true } });
  if (complaint.status === 'RESOLVED') reasons.push('COMPLAINT_ALREADY_RESOLVED');
  let membership: Facts['membership'] = null;
  if (c.membershipId) {
    const m = await db.gymMembershipContract.findUnique({ where: { id: c.membershipId } });
    if (!m) reasons.push('MEMBERSHIP_MISSING');
    else {
      membership = { id: m.id, status: m.status, payoutReleasedAt: m.payoutReleasedAt?.toISOString() ?? null, refundClawbackDone: m.refundClawbackDone, endDate: m.endDate?.toISOString() ?? null };
      if (m.payoutReleasedAt) reasons.push('PAYOUT_ALREADY_RELEASED');
      if (m.refundClawbackDone) reasons.push('CLAWBACK_ALREADY_DONE');
      if (m.status === 'CANCELLED') reasons.push('MEMBERSHIP_CANCELLED');
      if (!ledger.checked) reasons.push('LEDGER_NOT_CHECKED');
      for (const k of ledger.found) reasons.push(`LEDGER_OPERATION_${k.split(':')[0]}`);
    }
  }
  if (reasons.length) throw hasEffect(reasons);
  return { caseStatus: c.status, execStatus: c.execStatus, execDecisionId: c.execDecisionId, approvalId, complaintStatus: complaint.status, membership, ledgerKeysFound: ledger.found, ledgerChecked: ledger.checked };
}

async function currentApproval(db: Db, caseId: string) {
  return db.gymCaseApproval.findFirst({ where: await currentApprovalWhere(db, caseId), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}

export const decisionReplacementService = {
  async propose(actor: Actor, caseId: string, reason: string, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    requireUuid(caseId);
    const pre = await prisma.gymComplaintCase.findUnique({ where: { id: caseId } });
    if (!pre) throw caseError(404, 'CASE_NOT_FOUND', 'Không tìm thấy hồ sơ khiếu nại');
    const ledger = await readLedger(pre.membershipId);
    return mutate({
      actor,
      action: 'REPLACEMENT_PROPOSED',
      scope: caseId,
      idempotencyKey,
      body: { reason },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        await assertNotParty(ctx.tx, c, actor.id);
        if (c.version !== pre.version) throw caseError(409, 'CASE_VERSION_CONFLICT', 'Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại');
        if (await hasPendingReplacement(ctx.tx, c.id)) throw caseError(409, 'REPLACEMENT_PENDING', 'Hồ sơ đang có đề xuất thay thế chờ xử lý');
        const approval = await currentApproval(ctx.tx, c.id);
        if (!approval) throw caseError(409, 'DECISION_NOT_APPROVED', 'Hồ sơ chưa có quyết định được duyệt để thay thế');
        const facts = await checkNoEffect(ctx.tx, c, approval.id, ledger);
        let row;
        try {
          row = await ctx.tx.gymCaseDecisionReplacement.create({ data: { caseId: c.id, oldApprovalId: approval.id, proposedBy: actor.id, reason, checksAtProposal: toJson(facts) } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw caseError(409, 'REPLACEMENT_PENDING', 'Hồ sơ đang có đề xuất thay thế chờ xử lý');
          throw e;
        }
        return { caseId: c.id, result: { id: row.id, status: 'PENDING', oldApprovalId: approval.id }, note: reason, detail: { checks: facts } };
      },
    });
  },

  async approve(actor: Actor, caseId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    requireUuid(caseId);
    if (b.conflictOfInterestDeclaredNone !== true) throw caseError(403, 'CONFLICT_OF_INTEREST', 'Người duyệt phải khai báo không có xung đột lợi ích');
    const pre = await prisma.gymComplaintCase.findUnique({ where: { id: caseId } });
    if (!pre) throw caseError(404, 'CASE_NOT_FOUND', 'Không tìm thấy hồ sơ khiếu nại');
    const ledger = await readLedger(pre.membershipId);
    return mutate({
      actor,
      action: 'REPLACEMENT_APPROVED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        await assertNotParty(ctx.tx, c, actor.id);
        if (c.version !== pre.version) throw caseError(409, 'CASE_VERSION_CONFLICT', 'Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại');
        const rep = await ctx.tx.gymCaseDecisionReplacement.findFirst({ where: { caseId: c.id, approvedAt: null, rejectedAt: null } });
        if (!rep) throw caseError(409, 'NO_PENDING_REPLACEMENT', 'Không có đề xuất thay thế nào đang chờ');
        if (rep.proposedBy === actor.id) throw caseError(403, 'SELF_APPROVAL_FORBIDDEN', 'Người đề xuất thay thế không được tự duyệt đề xuất của mình');
        const approval = await currentApproval(ctx.tx, c.id);
        if (!approval || approval.id !== rep.oldApprovalId) throw caseError(409, 'DECISION_CHANGED', 'Quyết định hiện hành đã khác với quyết định được đề xuất thay thế');
        const facts = await checkNoEffect(ctx.tx, c, approval.id, ledger);
        // "membership unchanged": the facts that matter must equal what was proven at the proposal
        const was = (rep.checksAtProposal as unknown as Facts).membership;
        if (was && facts.membership && (was.status !== facts.membership.status || was.payoutReleasedAt !== facts.membership.payoutReleasedAt || was.refundClawbackDone !== facts.membership.refundClawbackDone)) {
          throw hasEffect(['MEMBERSHIP_CHANGED_SINCE_PROPOSAL']);
        }
        await ctx.tx.gymCaseDecisionReplacement.update({ where: { id: rep.id }, data: { approvedBy: actor.id, approvedAt: new Date(), approvalReason: b.reason, checksAtApproval: toJson(facts) } });
        // back to FINDING_RECORDED and a fresh execution axis - ONE CAS on the case version, ordered against an executor start by the row lock above
        const moved = await ctx.tx.gymComplaintCase.updateMany({
          where: { id: c.id, version: c.version, status: 'DECISION_APPROVED', execStatus: { in: ['NOT_STARTED', 'EXEC_BLOCKED'] } },
          data: { status: 'FINDING_RECORDED', execStatus: 'NOT_STARTED', execDecisionId: null, version: { increment: 1 } },
        });
        if (moved.count !== 1) throw caseError(409, 'CASE_VERSION_CONFLICT', 'Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại');
        ctx.transitions.push({ from: 'DECISION_APPROVED', to: 'FINDING_RECORDED', note: b.reason });
        return { caseId: c.id, result: { id: rep.id, status: 'APPROVED', caseStatus: 'FINDING_RECORDED', replacedApprovalId: approval.id }, note: b.reason, detail: { checks: facts } };
      },
    });
  },

  async reject(actor: Actor, caseId: string, reason: string, idempotencyKey?: string) {
    assertEnabled();
    assertAdmin(actor);
    requireUuid(caseId);
    return mutate({
      actor,
      action: 'REPLACEMENT_REJECTED',
      scope: caseId,
      idempotencyKey,
      body: { reason },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        await assertNotParty(ctx.tx, c, actor.id);
        const rep = await ctx.tx.gymCaseDecisionReplacement.findFirst({ where: { caseId: c.id, approvedAt: null, rejectedAt: null } });
        if (!rep) throw caseError(409, 'NO_PENDING_REPLACEMENT', 'Không có đề xuất thay thế nào đang chờ');
        if (rep.proposedBy === actor.id) throw caseError(403, 'SELF_APPROVAL_FORBIDDEN', 'Người đề xuất thay thế không được tự quyết định đề xuất của mình');
        await ctx.tx.gymCaseDecisionReplacement.update({ where: { id: rep.id }, data: { rejectedBy: actor.id, rejectedAt: new Date(), rejectionReason: reason } });
        return { caseId: c.id, result: { id: rep.id, status: 'REJECTED' }, note: reason };
      },
    });
  },
};

export type { Tx };
