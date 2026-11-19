import { prisma } from '../repositories/prisma';

/**
 * Phase 3 / P3.1 - "does this client hold a usable gym membership?", read-only.
 *
 * ONE definition of "active". `checkin.service.ts` (the physical door) and the internal lookup
 * API below both call the predicates in this file, so "can walk in" and "counts as a member for
 * a PT contract" cannot drift apart. A membership is active when ALL of:
 *   - status is ACTIVE (EXPIRED / CANCELLED / PENDING_PAYMENT / PENDING_ISSUE never count; the
 *     schema has no freeze state),
 *   - it has started (stacked renewal: a paid membership whose start date is still in the future is
 *     UPCOMING, not active - it is reported separately in `upcoming` and never lets anyone in),
 *   - its end date, when it has one, has not passed (check-in lazy-expires such a row; the
 *     lookup treats it as inactive without writing - this module never mutates),
 *   - it has visits left, when it has a visit limit (null limit = unlimited).
 *
 * Membership is BRAND-level: a plan belongs to a brand and a membership bought at any branch is
 * valid at every branch of that brand (membership.service.ts, GymMembershipPlan doc comment).
 * A gym with no brand matches nothing (same as check-in).
 *
 * Deliberately NOT part of "active": the branch's own status/operational status (check-in
 * additionally requires the scanned branch to be APPROVED+OPEN - that is about the door, not
 * about whether the client is a member) and the anti double-scan cooldown.
 */

/** True when an end date exists and is already behind `now` (check-in: "lazy-expire"). */
export function hasPassedEndDate(endDate: Date | null | undefined, now: Date = new Date()): boolean {
  return endDate != null && endDate < now;
}

/** True when the membership has no visit limit or has not used it up yet. */
export function hasVisitsLeft(totalVisits: number | null | undefined, usedVisits: number): boolean {
  return totalVisits == null || usedVisits < totalVisits;
}

/** True when there is no start date (legacy row) or it is not after `now`. A stacked renewal has a future start. */
export function hasStarted(startDate: Date | null | undefined, now: Date = new Date()): boolean {
  return startDate == null || startDate <= now;
}

export interface MembershipActivityFields {
  status: string;
  startDate?: Date | null;
  endDate: Date | null;
  totalVisits: number | null;
  usedVisits: number;
}

export function isMembershipActive(m: MembershipActivityFields, now: Date = new Date()): boolean {
  return m.status === 'ACTIVE' && hasStarted(m.startDate, now) && !hasPassedEndDate(m.endDate, now) && hasVisitsLeft(m.totalVisits, m.usedVisits);
}

/** Paid (ACTIVE) but its period has not begun yet: the stacked renewal queued behind the current membership. */
export function isMembershipUpcoming(m: MembershipActivityFields, now: Date = new Date()): boolean {
  return m.status === 'ACTIVE' && !hasStarted(m.startDate, now) && !hasPassedEndDate(m.endDate, now) && hasVisitsLeft(m.totalVisits, m.usedVisits);
}

export interface ActiveMembershipInfo {
  membershipId: string;
  brandId: string;
  planId: string;
  planName: string;
  /** The branch it was bought at - attribution only; the membership is valid brand-wide. */
  purchaseGymId: string;
  startDate: string | null;
  endDate: string | null;
  totalVisits: number | null;
  usedVisits: number;
}

export interface ActiveMembershipLookup {
  clientId: string;
  /** Echo of the branch queried, when the lookup was by branch. */
  gymId: string | null;
  /** Brand the answer is about (resolved from the branch); null when no brand applies. */
  brandId: string | null;
  hasActiveMembership: boolean;
  /** Newest active membership of the scope (same preference as check-in), or null. */
  membership: ActiveMembershipInfo | null;
  /** Every active membership of the scope, newest first. */
  memberships: ActiveMembershipInfo[];
  /** Paid memberships of the scope whose period has not started yet (stacked renewals), soonest start first. Never counts as active. */
  upcoming: ActiveMembershipInfo[];
}

export type MembershipScope = { gymId?: string; brandId?: string };

function toInfo(row: {
  id: string;
  gymId: string;
  planId: string;
  startDate: Date | null;
  endDate: Date | null;
  totalVisits: number | null;
  usedVisits: number;
  plan: { name: string; brandId: string };
}): ActiveMembershipInfo {
  return {
    membershipId: row.id,
    brandId: row.plan.brandId,
    planId: row.planId,
    planName: row.plan.name,
    purchaseGymId: row.gymId,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    totalVisits: row.totalVisits,
    usedVisits: row.usedVisits,
  };
}

async function loadActiveAndUpcoming(
  clientId: string,
  brandId: string | null,
  now: Date,
): Promise<{ active: ActiveMembershipInfo[]; upcoming: ActiveMembershipInfo[] }> {
  const rows = await prisma.gymMembershipContract.findMany({
    where: { clientId, status: 'ACTIVE', ...(brandId ? { plan: { brandId } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      gymId: true,
      planId: true,
      status: true,
      startDate: true,
      endDate: true,
      totalVisits: true,
      usedVisits: true,
      plan: { select: { name: true, brandId: true } },
    },
  });
  const upcoming = rows
    .filter((r) => isMembershipUpcoming(r, now))
    .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
  return { active: rows.filter((r) => isMembershipActive(r, now)).map(toInfo), upcoming: upcoming.map(toInfo) };
}

async function loadActive(clientId: string, brandId: string | null, now: Date): Promise<ActiveMembershipInfo[]> {
  return (await loadActiveAndUpcoming(clientId, brandId, now)).active;
}

export const membershipEligibilityService = {
  /**
   * The client's active memberships, narrowed by branch (-> its brand) or by brand. Throws a
   * 404-status error when the branch does not exist. A branch without a brand answers
   * `hasActiveMembership: false` with `brandId: null`.
   */
  async lookup(clientId: string, scope: MembershipScope, now: Date = new Date()): Promise<ActiveMembershipLookup> {
    let gymId: string | null = null;
    let brandId: string | null = null;
    if (scope.gymId) {
      const gym = await prisma.gym.findUnique({ where: { id: scope.gymId }, select: { id: true, brandId: true } });
      if (!gym) throw Object.assign(new Error('GYM_NOT_FOUND'), { status: 404 });
      gymId = gym.id;
      brandId = gym.brandId;
      if (!brandId) {
        return { clientId, gymId, brandId: null, hasActiveMembership: false, membership: null, memberships: [], upcoming: [] };
      }
    } else if (scope.brandId) {
      brandId = scope.brandId;
    }
    const { active: memberships, upcoming } = await loadActiveAndUpcoming(clientId, brandId, now);
    return {
      clientId,
      gymId,
      brandId,
      hasActiveMembership: memberships.length > 0,
      membership: memberships[0] ?? null,
      memberships,
      upcoming,
    };
  },

  /**
   * Every branch the client can train at through an active membership: all APPROVED branches of
   * every brand they hold an active membership at. Feeds pt-discovery's "same gym" label, which
   * compares against PT training locations (branch ids).
   */
  async activeGymIds(clientId: string, now: Date = new Date()): Promise<string[]> {
    const active = await loadActive(clientId, null, now);
    const brandIds = [...new Set(active.map((m) => m.brandId))];
    if (brandIds.length === 0) return [];
    const gyms = await prisma.gym.findMany({
      where: { brandId: { in: brandIds }, status: 'APPROVED' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return gyms.map((g) => g.id);
  },
};
