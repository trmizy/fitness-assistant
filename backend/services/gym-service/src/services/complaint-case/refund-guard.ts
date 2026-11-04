import { prisma } from '../../repositories/prisma';
import { caseError } from './errors';

/**
 * Q21 (Ngài): independent gym refunds are NOT blocked. Only a refund that would BYPASS a Gym Case or CONTRADICT an approved decision is refused (409,
 * stable code). A membership with no case, or only cases that never reached an approved decision (REJECTED_INTAKE), is refunded exactly as before.
 *
 * Every refund door of a membership (searched in the code, 04/11):
 *   1. POST /admin/gym-memberships/:id/refund            -> membershipService.refundByAdmin   GUARDED here.
 *   2. partnerService.terminate (PRORATED_REFUND policy) -> membershipService.refundByAdmin   GUARDED here (same function; a refused membership is listed
 *                                                          in `refundErrors` with its code and is finished through its case).
 *   3. the Case executor                                  -> membershipService.refundByAdmin   the SANCTIONED door: allowed only with the id of the APPROVED
 *                                                          decision that is currently EXECUTING on this very membership.
 *   4. resolvePendingIssueByAdmin / activation failure   -> refundPendingIssue                 NOT guarded: only a PENDING_ISSUE membership (never
 *                                                          activated), which a refund outcome cannot target (it needs an ACTIVE one).
 *   5. cancelByClient (forfeit) and the expiry sweep     -> release with refund 0              not a refund of money to the member.
 *   6. payment-service POST /admin/payments/:id/refund -> gym POST /internal/gym-memberships/:id/cancel-after-refund   the money has ALREADY moved in
 *                                                          payment-service (owned by Financial Hardening, not changed here). gym-service cannot prevent it
 *                                                          and refusing the callback would leave an ACTIVE membership whose price was refunded; it only
 *                                                          RECORDS the fact on the open case (see membership.service cancelAfterRefundViaTransaction). The case
 *                                                          then cannot refund a second time: refundByAdmin needs an ACTIVE membership.
 */
export async function assertRefundNotBypassingCase(membershipId: string, opts: { caseDecisionId?: string } = {}): Promise<void> {
  const cases = await prisma.gymComplaintCase.findMany({
    where: { membershipId },
    select: { id: true, status: true, execStatus: true, execDecisionId: true },
  });

  if (opts.caseDecisionId) {
    const ok = cases.some((c) => c.status === 'DECISION_APPROVED' && c.execStatus === 'EXECUTING' && c.execDecisionId === opts.caseDecisionId);
    if (!ok) {
      throw caseError(409, 'GYM_CASE_DECISION_MISMATCH', 'Quyết định của hồ sơ không khớp với gói hội viên cần hoàn tiền nên không thực hiện hoàn tiền');
    }
    return;
  }

  const open = cases.find((c) => c.status !== 'DECISION_APPROVED' && c.status !== 'REJECTED_INTAKE');
  if (open) {
    throw caseError(409, 'GYM_CASE_OPEN', 'Gói hội viên này đang có hồ sơ khiếu nại chưa kết thúc. Việc hoàn tiền phải đi qua hồ sơ đó', { caseId: open.id, status: open.status });
  }
  const decided = cases.find((c) => c.status === 'DECISION_APPROVED');
  if (decided) {
    throw caseError(409, 'GYM_CASE_DECISION_EXISTS', 'Gói hội viên này đã có quyết định được duyệt trong hồ sơ khiếu nại. Không hoàn tiền ngoài hồ sơ để tránh mâu thuẫn với quyết định đó', {
      caseId: decided.id,
      execStatus: decided.execStatus,
    });
  }
}
