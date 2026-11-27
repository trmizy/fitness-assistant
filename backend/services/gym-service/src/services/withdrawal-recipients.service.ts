import { prisma } from '../repositories/prisma';
import { resolvePartnerId } from './gym-listing.helpers';

/**
 * Gym Owner handoff item 3 (owner decision 22/11/2026): who must be told in the bell when an admin approves / rejects / pays a GYM
 * withdrawal. payment-service only knows the branch id (the GYM wallet owner), so it asks here — gym-service is the one that knows
 * which partner owns a branch (same lookup as `lifecycleRecipients` in gym-lifecycle-notify.ts and `resolvePartnerId`).
 *
 * Recipients = the branch's `ownerId` (the principal the owner routes authorise as) + every ACTIVE OWNER account of the branch's partner,
 * once each. Managers are deliberately NOT included: only owners can request a withdrawal and see its payout account. The requester is
 * added by payment-service from `withdrawal_requests.requested_by_user_id`.
 */

export interface WithdrawalRecipientsDb {
  gym: { findUnique(args: any): Promise<{ id: string; ownerId: string; brandId: string | null; name: string; approvedName: string | null } | null> };
  gymPartnerAccount: {
    findUnique(args: any): Promise<{ partnerId: string } | null>;
    findMany(args: any): Promise<Array<{ userId: string }>>;
  };
  gymPartner: { findFirst(args: any): Promise<{ id: string } | null> };
}

export async function withdrawalRecipientsForGym(
  gymId: string,
  db: WithdrawalRecipientsDb = prisma as unknown as WithdrawalRecipientsDb,
): Promise<{ userIds: string[]; gymName: string | null } | null> {
  const gym = await db.gym.findUnique({ where: { id: gymId }, select: { id: true, ownerId: true, brandId: true, name: true, approvedName: true } });
  if (!gym) return null;
  const ids = new Set<string>([gym.ownerId]);
  const partnerId = await resolvePartnerId(db as any, gym);
  if (partnerId) {
    const owners = await db.gymPartnerAccount.findMany({ where: { partnerId, role: 'OWNER', status: 'ACTIVE' }, select: { userId: true } });
    for (const o of owners) ids.add(o.userId);
  }
  return { userIds: [...ids], gymName: gym.approvedName ?? gym.name };
}
