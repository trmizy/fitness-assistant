import { Prisma, type GymCheckInSource } from '../generated/prisma';
import { hasPassedEndDate, hasVisitsLeft } from './membership-eligibility.service';
import { assertGymOpenForCheckin } from './checkin-gym-guard';

/**
 * THE rule code for "a member physically walks in", shared by the two ways a `gym_checkins` row can be born:
 *   - the member scans the branch QR with their own session (checkin.service.ts  -> source QR), and
 *   - a front-desk employee checks the member in after verifying identity (assisted-checkin.service.ts -> ASSISTED, D15c).
 * Both lock the membership row FOR UPDATE and then run the SAME validation + visit decrement + expire-on-last-visit +
 * anti-double-scan cooldown, so the two paths cannot drift: an assisted check-in can never extend a plan, add a visit,
 * bypass expiry or beat the cooldown that a QR scan would hit.
 */

export const COOLDOWN_MS = 60 * 1000; // one membership can't be recorded twice within 60s

export function checkinErr(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

// Raw row shape from the FOR UPDATE lock (snake_case columns).
export interface MembershipRow {
  id: string;
  status: string;
  end_date: Date | null;
  total_visits: number | null;
  used_visits: number;
  gym_id: string;
  client_id: string;
  plan_id: string;
  // The SCANNED gym's own status — not the membership's original purchase gym (which may now
  // be a different branch entirely; see the query below).
  gym_status: string;
  gym_operational_status: string;
}

type Tx = Prisma.TransactionClient;

/**
 * Locks the membership that entitles `clientId` to walk into branch `gymId`.
 *
 * Plans are brand-scoped (one owner, one brand — see GymMembershipPlan's schema doc comment): eligibility to check in
 * here is "does this membership's PLAN belong to the SAME BRAND as the gym", not "did they buy it at this exact gym".
 * A gym with no brand at all (legacy standalone) matches nothing. The join to gyms also carries the branch's own
 * status + operational status (Money-flow 2.5 / Vòng 4 C3): a closed or suspended branch blocks check-in.
 *
 * `membershipId` (assisted path only) pins the exact contract the desk verified; the QR path leaves it out and gets
 * "the member's best membership for this brand" (ACTIVE first, then newest). The assisted path may also lock a
 * PENDING_ISSUE (held) contract — purely so it is refused with the same NOT_ACTIVE code instead of "not found".
 */
export async function lockMembershipForCheckIn(
  tx: Tx,
  params: { gymId: string; clientId: string; membershipId?: string },
): Promise<MembershipRow> {
  const { gymId, clientId, membershipId } = params;
  const statusFilter = membershipId
    ? Prisma.sql`c.status IN ('ACTIVE', 'EXPIRED', 'PENDING_ISSUE')`
    : Prisma.sql`c.status IN ('ACTIVE', 'EXPIRED')`;
  const idFilter = membershipId ? Prisma.sql`AND c.id = ${membershipId}` : Prisma.empty;
  const rows = await tx.$queryRaw<MembershipRow[]>`
    SELECT c.id, c.status, c.end_date, c.total_visits, c.used_visits, c.gym_id, c.client_id, c.plan_id,
           scanned.status AS gym_status, scanned.operational_status AS gym_operational_status
    FROM gyms scanned
    JOIN gym_membership_plans p ON p.brand_id = scanned.brand_id
    JOIN gym_membership_contracts c ON c.plan_id = p.id
    WHERE scanned.id = ${gymId} AND scanned.brand_id IS NOT NULL AND c.client_id = ${clientId}
      AND ${statusFilter} ${idFilter}
    ORDER BY CASE WHEN c.status = 'ACTIVE' THEN 0 ELSE 1 END, c.created_at DESC
    LIMIT 1
    FOR UPDATE OF c`;
  if (rows.length === 0) throw checkinErr('NO_MEMBERSHIP', 403);
  return rows[0];
}

export interface AppliedCheckIn {
  checkinId: string;
  checkedInAt: Date;
  clientId: string;
  usedVisits: number;
  totalVisits: number | null;
  endDate: Date | null;
  planName: string | null;
}

/**
 * Everything after the lock: gym open → lazy-expire → ACTIVE → anti double-scan → visit limit → decrement →
 * expire-on-last-visit → write the `gym_check_ins` row. Throws typed codes the UI maps to messages:
 * GYM_NOT_ACTIVE / NOT_ACTIVE / TOO_SOON / VISIT_LIMIT_REACHED.
 */
export async function applyMemberCheckIn(
  tx: Tx,
  m: MembershipRow,
  p: { gymId: string; clientId: string; checkedInBy: string; source: GymCheckInSource; assistedEventId?: string },
): Promise<AppliedCheckIn> {
  assertGymOpenForCheckin(m.gym_status, m.gym_operational_status);

  // Lazy-expire a membership past its end date, then require ACTIVE.
  let status = m.status;
  if (status === 'ACTIVE' && hasPassedEndDate(m.end_date)) {
    await tx.gymMembershipContract.update({ where: { id: m.id }, data: { status: 'EXPIRED' } });
    status = 'EXPIRED';
  }
  if (status !== 'ACTIVE') throw checkinErr('NOT_ACTIVE', 409);

  // Anti double-scan.
  const recent = await tx.gymCheckIn.findFirst({
    where: { membershipId: m.id, createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) throw checkinErr('TOO_SOON', 429);

  // Visit limit (null total = unlimited).
  if (!hasVisitsLeft(m.total_visits, m.used_visits)) {
    throw checkinErr('VISIT_LIMIT_REACHED', 409);
  }

  const updated = await tx.gymMembershipContract.update({
    where: { id: m.id },
    data: { usedVisits: { increment: 1 } },
  });

  // Money-flow plan 3.7: a membership that just used its last visit is done — flip it to
  // EXPIRED right now instead of waiting for it to ALSO pass endDate (which the sweep's
  // date check requires today, and which could be weeks away for a long membership). The
  // existing membershipPayout.sweep.ts already releases the payout for any EXPIRED
  // membership on its next tick via findExpiredNotReleased — it does not care WHY the
  // membership expired, only that it did, so this flip alone is what "kích hoạt giải
  // phóng tiền" needs; no separate release call to duplicate here.
  if (updated.totalVisits != null && updated.usedVisits >= updated.totalVisits) {
    await tx.gymMembershipContract.update({ where: { id: m.id }, data: { status: 'EXPIRED' } });
  }

  const checkin = await tx.gymCheckIn.create({
    data: {
      membershipId: m.id,
      gymId: p.gymId,
      clientId: p.clientId,
      checkedInBy: p.checkedInBy,
      source: p.source,
      assistedEventId: p.assistedEventId ?? null,
    },
  });
  const plan = await tx.gymMembershipPlan.findUnique({ where: { id: m.plan_id } });

  return {
    checkinId: checkin.id,
    checkedInAt: checkin.createdAt,
    clientId: p.clientId,
    usedVisits: updated.usedVisits,
    totalVisits: updated.totalVisits,
    endDate: updated.endDate,
    planName: plan?.name ?? null,
  };
}
