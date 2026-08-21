import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { checkinRepository } from '../repositories/checkin.repository';
import { gymService } from './gym.service';
import { signGymCheckinToken, verifyGymCheckinToken } from '../utils/checkinToken';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const COOLDOWN_MS = 60 * 1000; // one membership can't be recorded twice within 60s

// Raw row shape from the FOR UPDATE lock (snake_case columns).
interface MembershipRow {
  id: string;
  status: string;
  end_date: Date | null;
  total_visits: number | null;
  used_visits: number;
  gym_id: string;
  client_id: string;
  plan_id: string;
}

/**
 * Best-effort name lookup so the receptionist sees a person, not a UUID.
 *
 * Names live in auth-service, not on the user-service profile (whose firstName/lastName are
 * usually null — that service enriches them from auth on the way out too).
 */
async function fetchClientName(userId: string): Promise<string | null> {
  try {
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/auth/internal/users/${userId}`, {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 3000,
    });
    const u = data?.user ?? data;
    const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
    return name || u?.email || null;
  } catch {
    return null; // a missing name must never block someone from entering the gym
  }
}

export const checkinService = {
  /** The QR a gym prints for its front desk. Owner-only. */
  async getGymQr(gymId: string, ownerId: string) {
    const gym = await gymService.getOwnedGym(gymId, ownerId); // 403/404 if not the owner
    const { token, expiresAt } = signGymCheckinToken(gym.id);
    return { token, expiresAt, gymId: gym.id, gymName: gym.name };
  },

  /**
   * A member scans the gym's QR and their app posts the token here. Identity comes from the
   * caller's own session, so the QR on the wall reveals nothing and cannot be used by
   * someone without an active membership.
   *
   * The validate-then-increment runs inside one transaction with the membership row locked
   * FOR UPDATE (mirroring payment-service's wallet ledger), so two quick scans can't
   * over-count visits. Errors are typed codes the UI maps to messages:
   * INVALID_TOKEN / TOKEN_EXPIRED / NO_MEMBERSHIP / NOT_ACTIVE / TOO_SOON / VISIT_LIMIT_REACHED.
   */
  async checkInByGymToken(clientId: string, token: string) {
    const payload = verifyGymCheckinToken(token); // INVALID_TOKEN / TOKEN_EXPIRED
    const gymId = payload.gymId;

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<MembershipRow[]>`
        SELECT id, status, end_date, total_visits, used_visits, gym_id, client_id, plan_id
        FROM gym_membership_contracts
        WHERE gym_id = ${gymId} AND client_id = ${clientId}
          AND status IN ('ACTIVE', 'EXPIRED')
        ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
        FOR UPDATE`;
      if (rows.length === 0) throw err('NO_MEMBERSHIP', 403);
      const m = rows[0];

      // Lazy-expire a membership past its end date, then require ACTIVE.
      let status = m.status;
      if (status === 'ACTIVE' && m.end_date && m.end_date < new Date()) {
        await tx.gymMembershipContract.update({
          where: { id: m.id },
          data: { status: 'EXPIRED' },
        });
        status = 'EXPIRED';
      }
      if (status !== 'ACTIVE') throw err('NOT_ACTIVE', 409);

      // Anti double-scan.
      const recent = await tx.gymCheckIn.findFirst({
        where: { membershipId: m.id, createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) throw err('TOO_SOON', 429);

      // Visit limit (null total = unlimited).
      if (m.total_visits != null && m.used_visits >= m.total_visits) {
        throw err('VISIT_LIMIT_REACHED', 409);
      }

      const updated = await tx.gymMembershipContract.update({
        where: { id: m.id },
        data: { usedVisits: { increment: 1 } },
      });
      const checkin = await tx.gymCheckIn.create({
        // The member performed this themselves, so there is no staff member to credit.
        data: { membershipId: m.id, gymId, clientId, checkedInBy: clientId },
      });
      const plan = await tx.gymMembershipPlan.findUnique({ where: { id: m.plan_id } });

      return {
        checkinId: checkin.id,
        checkedInAt: checkin.createdAt,
        clientId,
        usedVisits: updated.usedVisits,
        totalVisits: updated.totalVisits,
        endDate: updated.endDate,
        planName: plan?.name ?? null,
      };
    });

    const [clientName, gym] = await Promise.all([
      fetchClientName(clientId),
      prisma.gym.findUnique({ where: { id: gymId } }),
    ]);

    logger.info(`[Checkin] gym=${gymId} client=${clientId} visit=${result.usedVisits}`);
    // Everything the front desk needs to eyeball on the member's screen.
    return { ok: true, ...result, clientName, gymName: gym?.name ?? null };
  },

  async listForGym(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return checkinRepository.listForGym(gymId);
  },

  /** A member's own check-in history at a gym. */
  async listForClient(clientId: string) {
    return prisma.gymCheckIn.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  },
};
