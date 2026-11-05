import { prisma } from "../../repositories/profile.repository";

/**
 * E6 / F2 (Ngài, 05/11/2026) - the read-only answer payment-service asks BEFORE a refund of a PT contract payment (POST /admin/payments/:id/refund): does the refund BYPASS a dispute Case?
 *   an unfinished Case on any session of the contract (every status except REJECTED_INTAKE and DECISION_APPROVED) -> 409 CONTRACT_CASE_OPEN
 *   an approved decision (DECISION_APPROVED, executed or not)                                                   -> 409 CONTRACT_CASE_DECISION_EXISTS
 * `openOnly` (F3, holdback decisions): only an UNFINISHED Case blocks; an approved decision does not. A contract with no Case, or only cases closed at intake (REJECTED_INTAKE), is refundable exactly as before (independent refunds are not blocked). Writes nothing.
 */
export async function assertContractRefundNotBypassingCase(contractId: string, opts: { openOnly?: boolean } = {}): Promise<void> {
  const cases = await prisma.disputeCase.findMany({ where: { contractId, status: { not: "REJECTED_INTAKE" } }, select: { id: true, status: true, execStatus: true, sessionId: true } });
  const open = cases.find((c) => c.status !== "DECISION_APPROVED");
  if (open) {
    throw Object.assign(new Error("Hợp đồng này đang có hồ sơ khiếu nại chưa kết thúc. Việc hoàn tiền phải đi qua hồ sơ đó"), {
      status: 409,
      code: "CONTRACT_CASE_OPEN",
      details: { caseId: open.id, sessionId: open.sessionId, status: open.status },
    });
  }
  const decided = opts.openOnly ? undefined : cases.find((c) => c.status === "DECISION_APPROVED");
  if (decided) {
    throw Object.assign(new Error("Hợp đồng này đã có quyết định được duyệt trong hồ sơ khiếu nại. Không hoàn tiền ngoài hồ sơ để tránh mâu thuẫn"), {
      status: 409,
      code: "CONTRACT_CASE_DECISION_EXISTS",
      details: { caseId: decided.id, sessionId: decided.sessionId, execStatus: decided.execStatus },
    });
  }
}
