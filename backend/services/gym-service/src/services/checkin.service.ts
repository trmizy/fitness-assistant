import { prisma } from '../repositories/prisma';
import { checkinRepository } from '../repositories/checkin.repository';
import { gymService } from './gym.service';
import { signCheckinToken, verifyCheckinToken } from '../utils/checkinToken';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const COOLDOWN_MS = 60 * 1000; // one membership can't be recorded twice within 60s (anti double-scan)

// Raw row shape from the FOR UPDATE lock (snake_case columns).
interface MembershipRow {
  id: string;
  status: string;
  end_date: Date | null;
  total_visits: number | null;
  used_visits: number;
  gym_id: string;
  client_id: string;
}

export const checkinService = {
  /** Member asks for a fresh, short-lived QR token for one of their ACTIVE memberships. */
  async issueToken(membershipId: string, clientId: string) {
    const m = await prisma.gymMembershipContract.findUnique({ where: { id: membershipId } });
    if (!m) throw err('Membership not found', 404);
    if (m.clientId !== clientId) throw err('Not authorized', 403);
    if (m.status === 'ACTIVE' && m.endDate && m.endDate < new Date()) throw err('Membership expired', 409);
    if (m.status !== 'ACTIVE') throw err('Membership is not active', 409);
    const { token, expiresAt } = signCheckinToken(m.id, clientId);
    return { token, expiresAt, gymId: m.gymId };
  },

  /**
   * Gym owner scans a member's QR to record entry. The whole validate-then-increment runs inside
   * one DB transaction with the membership row locked FOR UPDATE (mirrors payment wallet.service),
   * so concurrent scans can't over-count visits past the limit. Errors are typed codes the UI maps
   * to messages: INVALID_TOKEN / TOKEN_EXPIRED / WRONG_GYM / NOT_ACTIVE / TOO_SOON / VISIT_LIMIT_REACHED.
   */
  async recordCheckIn(gymId: string, ownerId: string, token: string) {
    await gymService.getOwnedGym(gymId, ownerId); // 403/404 if not the owner of this gym
    const payload = verifyCheckinToken(token); // INVALID_TOKEN / TOKEN_EXPIRED

    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<MembershipRow[]>`
        SELECT id, status, end_date, total_visits, used_visits, gym_id, client_id
        FROM gym_membership_contracts WHERE id = ${payload.membershipId} FOR UPDATE`;
      if (rows.length === 0) throw err('MEMBERSHIP_NOT_FOUND', 404);
      const m = rows[0];

      if (m.gym_id !== gymId) throw err('WRONG_GYM', 400);
      if (m.client_id !== payload.clientId) throw err('INVALID_TOKEN', 400);

      // Lazy-expire a membership past its end date, then require ACTIVE.
      let status = m.status;
      if (status === 'ACTIVE' && m.end_date && m.end_date < new Date()) {
        await tx.gymMembershipContract.update({ where: { id: m.id }, data: { status: 'EXPIRED' } });
        status = 'EXPIRED';
      }
      if (status !== 'ACTIVE') throw err('NOT_ACTIVE', 409);

      // Anti double-scan: reject a second check-in within the cooldown window.
      const recent = await tx.gymCheckIn.findFirst({
        where: { membershipId: m.id, createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) throw err('TOO_SOON', 429);

      // Visit limit (null total = unlimited).
      if (m.total_visits != null && m.used_visits >= m.total_visits) throw err('VISIT_LIMIT_REACHED', 409);

      const updated = await tx.gymMembershipContract.update({
        where: { id: m.id },
        data: { usedVisits: { increment: 1 } },
      });
      const checkin = await tx.gymCheckIn.create({
        data: { membershipId: m.id, gymId, clientId: m.client_id, checkedInBy: ownerId },
      });

      return {
        ok: true,
        checkinId: checkin.id,
        clientId: m.client_id,
        usedVisits: updated.usedVisits,
        totalVisits: updated.totalVisits,
        checkedInAt: checkin.createdAt,
      };
    });
  },

  async listForGym(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return checkinRepository.listForGym(gymId);
  },
};
