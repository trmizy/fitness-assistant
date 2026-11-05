import { prisma } from '../../repositories/prisma';
import { userClient } from '../../clients/user.client';
import { caseError, notFoundCase } from './errors';
import { assertAdmin, assertNotParty, assertRealAdmin, lockCase, mutate, notifyMember, requireUuid, type Actor } from './case.service';
import { appealWindow, canTransition, type CaseStatus } from './rules';

/**
 * A1 (Ngài approved) - the APPEAL of a gym case. Rules, all enforced here and by the database:
 *   who      the MEMBER who filed the complaint, ONCE per case (UNIQUE case_id). The Gym never appeals; during an appeal it can only add evidence / an explanation
 *            (C10). Nobody else can file.
 *   when     only a CONCLUDED case (DECISION_APPROVED + BUSINESS_DONE), within 14 days of the VALID conclusion notice (a notice user-service accepted). If no valid
 *            notice was ever recorded the window has not started.
 *   how      the case re-opens as APPEAL_REVIEW with no investigator. An INDEPENDENT reviewer is then assigned: a real active admin who is not the member, not linked
 *            to the gym / brand, and has played NO role earlier in this case (investigator, assessor, finding author, proposer, approver, executor, opener).
 *   result   the reviewer works in the normal steps; the new finding references the old one (supersedes_id, set by recordFinding); a new proposal needs a different
 *            approver (four eyes). Money moves ONLY through the existing execute -> refundByAdmin path, whose own guard needs an ACTIVE membership, so an appeal can
 *            never refund twice and never reverses a refund that already happened (no automatic reversal exists; that stays a human matter).
 *   never    automatic: filing, assigning, deciding and executing are each an explicit call.
 */
export const appealService = {
  async fileAppeal(actor: Actor, caseId: string, b: { reason: string }, idempotencyKey?: string) {
    requireUuid(caseId);
    const r = await mutate({
      actor,
      action: 'APPEAL_FILED',
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.reporterUserId !== actor.id) throw notFoundCase(); // a case the user did not file does not exist for them
        const existing = await ctx.tx.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
        if (existing) throw caseError(409, 'APPEAL_ALREADY_USED', 'Hồ sơ này đã có một kháng nghị. Mỗi hồ sơ chỉ được kháng nghị một lần');
        if (c.status !== 'DECISION_APPROVED' || c.execStatus !== 'BUSINESS_DONE') {
          throw caseError(409, 'APPEAL_NOT_AVAILABLE', 'Chỉ kháng nghị được khi hồ sơ đã có kết luận cuối cùng', { status: c.status, execStatus: c.execStatus });
        }
        const notice = await ctx.tx.gymCaseNotice.findFirst({ where: { caseId: c.id, kind: 'CONCLUSION', recipientRole: 'MEMBER', delivered: true }, orderBy: { createdAt: 'desc' } });
        const win = appealWindow(notice?.createdAt ?? null, new Date());
        if (!win.open) throw caseError(409, 'APPEAL_WINDOW_CLOSED', 'Đã quá 14 ngày kể từ khi bạn nhận thông báo kết luận nên không kháng nghị được nữa', { noticeAt: notice!.createdAt, closedAt: win.closesAt });
        const finding = await ctx.tx.gymCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
        if (!finding) throw caseError(409, 'FINDING_REQUIRED', 'Hồ sơ chưa có kết luận để kháng nghị');
        // B1: the payout sweep decides "hold or release" under this same row lock, so the re-opening cannot slip between its check and its release.
        if (c.membershipId) await ctx.tx.$queryRaw`SELECT id FROM gym_membership_contracts WHERE id = ${c.membershipId} FOR UPDATE`;
        if (!canTransition(c.status as CaseStatus, 'APPEAL_REVIEW')) throw caseError(409, 'CASE_STATE_NOT_ALLOWED', 'Trạng thái hiện tại của hồ sơ không cho phép thao tác này');
        const appeal = await ctx.tx.gymCaseAppeal.create({ data: { caseId: c.id, filedBy: actor.id, reason: b.reason, noticeAt: notice?.createdAt ?? null, reviewedFindingId: finding.id } });
        try {
          const moved = await ctx.tx.gymComplaintCase.updateMany({
            where: { id: c.id, version: c.version, status: 'DECISION_APPROVED' },
            data: { status: 'APPEAL_REVIEW', investigatorId: null, version: { increment: 1 } },
          });
          if (moved.count !== 1) throw caseError(409, 'CASE_VERSION_CONFLICT', 'Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại');
        } catch (e: any) {
          if (e?.code === 'P2002') throw caseError(409, 'CASE_ALREADY_OPEN', 'Gói hội viên này đang có hồ sơ khác chưa kết thúc nên chưa mở lại hồ sơ để kháng nghị được');
          throw e;
        }
        ctx.transitions.push({ from: 'DECISION_APPROVED', to: 'APPEAL_REVIEW', note: b.reason });
        return { caseId: c.id, result: { id: appeal.id, status: 'FILED', caseId: c.id, windowClosesAt: win.closesAt }, note: b.reason };
      },
    });
    if (!r.replayed) {
      await notifyMember({ id: caseId, reporterUserId: actor.id }, 'Kháng nghị của bạn đã được tiếp nhận. Gymini sẽ giao một người độc lập xem xét lại, không có kết quả nào được tự động thay đổi.', 'GYM_COMPLAINT_CASE_APPEAL_FILED', 'APPEAL');
      await userClient.notifyAdmins({ id: `gym-case-appeal:${caseId}`, text: 'Có một kháng nghị hồ sơ khiếu nại phòng gym cần giao người xem xét lại độc lập.', eventType: 'GYM_COMPLAINT_CASE_APPEAL_FILED', entityType: 'GYM_COMPLAINT_CASE', entityId: caseId });
    }
    return r;
  },

  /** The ids of everyone who played a role earlier in this case: none of them may review its appeal. */
  async priorParticipants(caseId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, select: { createdBy: true, investigatorId: true } });
    if (c?.createdBy) ids.add(c.createdBy);
    if (c?.investigatorId) ids.add(c.investigatorId);
    const [proposals, approvals, findings, assessments, executions, events] = await Promise.all([
      prisma.gymCaseProposal.findMany({ where: { caseId }, select: { proposerId: true } }),
      prisma.gymCaseApproval.findMany({ where: { proposal: { caseId } }, select: { approverId: true } }),
      prisma.gymCaseFinding.findMany({ where: { caseId }, select: { recordedBy: true } }),
      prisma.gymCaseAssessment.findMany({ where: { caseId }, select: { assessorId: true } }),
      prisma.gymCaseExecution.findMany({ where: { caseId }, select: { actorUserId: true } }),
      prisma.gymCaseEvent.findMany({ where: { caseId, action: { in: ['INVESTIGATOR_ASSIGNED', 'CLAIM_RECORDED', 'EVIDENCE_CHANGE_ACK', 'EVIDENCE_RECOLLECTED'] } }, select: { actorUserId: true } }),
    ]);
    for (const p of proposals) ids.add(p.proposerId);
    for (const a of approvals) ids.add(a.approverId);
    for (const f of findings) ids.add(f.recordedBy);
    for (const a of assessments) ids.add(a.assessorId);
    for (const x of executions) ids.add(x.actorUserId);
    for (const e of events) ids.add(e.actorUserId);
    ids.delete('system');
    return ids;
  },

  async assignReviewer(actor: Actor, caseId: string, reviewerId: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const target = reviewerId ?? actor.id;
    await assertRealAdmin(target, actor);
    return mutate({
      actor,
      action: 'APPEAL_REVIEWER_ASSIGNED',
      scope: caseId,
      idempotencyKey,
      body: { reviewerId: target },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.status !== 'APPEAL_REVIEW') throw caseError(409, 'CASE_STATE_NOT_ALLOWED', 'Hồ sơ không ở bước chờ giao người xem xét kháng nghị', { status: c.status });
        const appeal = await ctx.tx.gymCaseAppeal.findUnique({ where: { caseId: c.id } });
        if (!appeal || appeal.status !== 'FILED') throw caseError(409, 'APPEAL_NOT_AVAILABLE', 'Kháng nghị này đã được giao người xem xét');
        await assertNotParty(ctx.tx, c, target);
        if (target === appeal.filedBy) throw caseError(403, 'REVIEWER_NOT_INDEPENDENT', 'Người xem xét kháng nghị không được là người kháng nghị');
        const prior = await appealService.priorParticipants(c.id);
        if (prior.has(target)) throw caseError(403, 'REVIEWER_NOT_INDEPENDENT', 'Người xem xét kháng nghị phải độc lập: không được từng tham gia xử lý hồ sơ này');
        const now = new Date();
        await ctx.tx.gymCaseAppeal.update({ where: { caseId: c.id }, data: { status: 'REVIEWING', reviewerId: target, assignedAt: now } });
        const moved = await ctx.tx.gymComplaintCase.updateMany({
          where: { id: c.id, version: c.version, status: 'APPEAL_REVIEW' },
          data: { status: 'ASSESSING', investigatorId: target, version: { increment: 1 } },
        });
        if (moved.count !== 1) throw caseError(409, 'CASE_VERSION_CONFLICT', 'Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại');
        ctx.transitions.push({ from: 'APPEAL_REVIEW', to: 'ASSESSING', note: 'giao người xem xét kháng nghị độc lập' });
        return { caseId: c.id, result: { reviewerId: target, status: 'ASSESSING' }, note: target };
      },
    });
  },
};
