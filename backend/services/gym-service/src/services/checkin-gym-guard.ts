/**
 * The ONE rule for "may anyone physically check in at this branch right now": the branch must be
 * APPROVED and operationally OPEN (Money-flow 2.5 + Vong 4 / C3). Shared by the member path
 * (checkin.service.ts) and the PT path (pt-checkin.service.ts) so the two cannot drift.
 *
 * It deliberately does NOT look at the partner's suspension: a suspended partner's running
 * memberships "run until they expire" (partner-guard.service.ts doc comment), and that includes
 * walking in. Both paths therefore behave identically for a suspended partner.
 */
export function assertGymOpenForCheckin(gymStatus: string, operationalStatus: string): void {
  if (gymStatus !== 'APPROVED' || operationalStatus !== 'OPEN') {
    throw Object.assign(new Error('GYM_NOT_ACTIVE'), { status: 409 });
  }
}
