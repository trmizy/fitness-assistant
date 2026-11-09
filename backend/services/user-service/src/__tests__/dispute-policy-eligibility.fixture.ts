/**
 * TEST FIXTURE (B-1 release gate, D-NEW-12). The guard `assertPolicyEligibility` lets a dispute ruling through only when the contract's newest APPROVED review says
 * ELIGIBLE_CURRENT_POLICY, and there is no switch that turns it off. A test that rules a disputed session therefore needs such a review. This helper INSERTS one (a case
 * row that is already closed, one evidence row of it, and the review, already approved by a different person). It is a fixture: the API path (propose + approve) is exercised by
 * dispute-policy-eligibility.integration.test.ts. The fixture case uses a synthetic session id, so it never gets in the way of a real case for the contract's sessions.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma";

type Result = "ELIGIBLE_CURRENT_POLICY" | "EXCEPTION_APPLIES";

export async function insertPolicyReviewFixture(
  db: PrismaClient,
  contract: { id: string; clientUserId: string; ptUserId: string },
  o: { result?: Result; approved?: boolean; proposedBy?: string; approvedBy?: string } = {},
): Promise<{ caseId: string; reviewId: string; evidenceId: string }> {
  const caseRow = await db.disputeCase.create({
    data: {
      id: randomUUID(),
      sessionId: `fixture-policy-${randomUUID()}`,
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      type: "PT_DELIVERY",
      status: "REJECTED_INTAKE",
      createdBy: "fixture",
    },
  });
  const ev = await db.disputeCaseEvidence.create({
    data: {
      caseId: caseRow.id,
      provenanceType: "NOT_APPLICABLE",
      source: "FIXTURE",
      subject: "policy-eligibility",
      scopeSessionId: caseRow.sessionId,
      scopeContractId: contract.id,
      captureStatus: "NOT_APPLICABLE",
      contentHash: "fixture",
      payload: {},
    },
  });
  const approved = o.approved ?? true;
  const review = await db.disputeCasePolicyEligibilityReview.create({
    data: {
      caseId: caseRow.id,
      contractId: contract.id,
      result: o.result ?? "ELIGIBLE_CURRENT_POLICY",
      evidenceIds: [ev.id],
      reasoning: "TEST FIXTURE: the contract is under the current policy",
      proposedBy: o.proposedBy ?? "fixture-proposer",
      ...(approved ? { approvedBy: o.approvedBy ?? "fixture-approver", approvedAt: new Date() } : {}),
    },
  });
  return { caseId: caseRow.id, reviewId: review.id, evidenceId: ev.id };
}
