/**
 * Can people physically walk into this branch? APPROVED, or SUSPENDED by an admin (a platform-only measure: the
 * real gym keeps operating, so members with a running membership still check in - owner decision 15/11 4a) -
 * in both cases only while the branch is operationally OPEN. DRAFT / PENDING_REVIEW / REJECTED never.
 */
export function isGymAcceptingCheckin(gymStatus: string, operationalStatus: string): boolean {
  return (gymStatus === 'APPROVED' || gymStatus === 'SUSPENDED') && operationalStatus === 'OPEN';
}

/**
 * The ONE rule for "may anyone physically check in at this branch right now": the branch must be
 * APPROVED (or admin-SUSPENDED, see above) and operationally OPEN (Money-flow 2.5 + Vong 4 / C3). Shared by the member path
 * (checkin.service.ts) and the PT path (pt-checkin.service.ts) so the two cannot drift.
 *
 * It deliberately does NOT look at the partner's suspension: a suspended partner's running
 * memberships "run until they expire" (partner-guard.service.ts doc comment), and that includes
 * walking in. Both paths therefore behave identically for a suspended partner.
 */
export function assertGymOpenForCheckin(gymStatus: string, operationalStatus: string): void {
  if (!isGymAcceptingCheckin(gymStatus, operationalStatus)) {
    throw Object.assign(new Error('GYM_NOT_ACTIVE'), { status: 409 });
  }
}
