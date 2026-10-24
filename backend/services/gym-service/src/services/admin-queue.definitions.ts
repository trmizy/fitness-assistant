import { prisma } from '../repositories/prisma';

/**
 * Admin work queues - ONE definition per queue (bug B40).
 *
 * Before this module the same word meant different things on different admin screens:
 *   - "Hồ sơ chờ thẩm định" (Partners page) counted EVERY non-rejected PROSPECT - including applicants who were still
 *     filling the wizard or had been sent back for changes - while "Hồ sơ đối tác" (Duyệt) counted only the
 *     applications waiting for the admin (IN_REVIEW). 9 vs 4 for the same data.
 *   - "Tên thương hiệu chờ duyệt" counted any non-null pendingName; the branch-moderation screen ignores a pendingName
 *     equal to the approved name.
 *
 * The definitions below are the single source for `partnerDiligenceService.queue()` and `.overviewStats()`:
 *
 *   applicationsAwaitingReview  self-service application SUBMITTED and NOT DECIDED   = verificationStatus IN_REVIEW
 *                               (same number as GET /admin/partners/applications -> counts.IN_REVIEW)
 *   legacyProspectsAwaitingReview  admin-created PROSPECT not rejected and not yet verified (the retired provisioning
 *                               flow; kept so those rows do not vanish from the queue)
 *   applicationsWaitingApplicant   self-service application sent back (NEEDS_INFO): the APPLICANT's turn, not the admin's
 *   branchesFirstApproval       branch with status PENDING_REVIEW (first approval)
 *   branchRenames               APPROVED-before branch whose pending name/address differs from the live one
 *   brandRenames                brand whose pendingName differs from approvedName
 */
export interface AdminQueueCounts {
  applicationsAwaitingReview: number;
  legacyProspectsAwaitingReview: number;
  applicationsWaitingApplicant: number;
  branchesFirstApproval: number;
  branchRenames: number;
  brandRenames: number;
}

/** A pending name equal to the live one is not a request - same rule as the admin apps' brandRenameQueue(). */
export function isBrandRenameRequest(b: { pendingName: string | null; approvedName: string | null }): boolean {
  return !!b.pendingName && b.pendingName !== b.approvedName;
}

/**
 * A real change request on a branch that was approved before: it has a live name (`approvedName`), is not a first
 * approval or a draft, and its pending name/address differs from what is showing. A DRAFT/first-approval branch
 * also carries `pendingName` - that is the wizard's name, not a rename. Same rule as the admin apps' isRenameRequest().
 */
export function isBranchRenameRequest(g: {
  status: string;
  approvedName: string | null;
  pendingName: string | null;
  approvedAddress: string | null;
  pendingAddress: string | null;
  address: string | null;
}): boolean {
  if (g.status === 'PENDING_REVIEW' || g.status === 'DRAFT' || g.approvedName == null) return false;
  const nameChange = !!g.pendingName && g.pendingName !== g.approvedName;
  const addressChange = !!g.pendingAddress && g.pendingAddress !== (g.approvedAddress ?? g.address);
  return nameChange || addressChange;
}

export async function countAdminQueues(): Promise<AdminQueueCounts> {
  const [applicationsAwaitingReview, legacyProspectsAwaitingReview, applicationsWaitingApplicant, branchesFirstApproval, branchCandidates, brandCandidates] =
    await Promise.all([
      prisma.gymPartner.count({ where: { source: 'SELF_SERVICE', verificationStatus: 'IN_REVIEW' } }),
      prisma.gymPartner.count({
        where: { source: 'ADMIN_CREATED', status: 'PROSPECT', rejectedAt: null, verificationStatus: { in: ['NOT_VERIFIED', 'IN_REVIEW'] } },
      }),
      prisma.gymPartner.count({ where: { source: 'SELF_SERVICE', verificationStatus: 'NEEDS_INFO' } }),
      prisma.gym.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.gym.findMany({
        where: {
          status: { notIn: ['PENDING_REVIEW', 'DRAFT'] },
          approvedName: { not: null },
          OR: [{ pendingName: { not: null } }, { pendingAddress: { not: null } }],
        },
        select: { status: true, approvedName: true, pendingName: true, approvedAddress: true, pendingAddress: true, address: true },
      }),
      prisma.gymBrand.findMany({ where: { pendingName: { not: null } }, select: { pendingName: true, approvedName: true } }),
    ]);

  return {
    applicationsAwaitingReview,
    legacyProspectsAwaitingReview,
    applicationsWaitingApplicant,
    branchesFirstApproval,
    branchRenames: branchCandidates.filter(isBranchRenameRequest).length,
    brandRenames: brandCandidates.filter(isBrandRenameRequest).length,
  };
}
