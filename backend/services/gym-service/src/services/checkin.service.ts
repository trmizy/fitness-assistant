import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import { checkinRepository } from '../repositories/checkin.repository';
import { gymService } from './gym.service';
import { signGymCheckinToken, verifyGymCheckinToken } from '../utils/checkinToken';
import { authServiceClient } from '../clients/auth-service.client';
import { applyMemberCheckIn, lockMembershipForCheckIn } from './checkin-core';

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

/**
 * Best-effort name lookup so the receptionist sees a person, not a UUID.
 *
 * Names live in auth-service, not on the user-service profile (whose firstName/lastName are
 * usually null — that service enriches them from auth on the way out too).
 */
async function fetchClientName(userId: string): Promise<string | null> {
  try {
    const data = await authServiceClient.getInternalUser(userId, INTERNAL_SERVICE_SECRET);
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
    // B46: no new QR for a branch nobody may check in at (temporarily/permanently closed, not approved) - the scan would be
    // refused anyway (assertGymOpenForCheckin), and a printed QR for a closed branch only invites a pointless scan.
    if (gym.status !== 'APPROVED' || gym.operationalStatus !== 'OPEN') {
      throw Object.assign(new Error('Chi nhánh đang đóng cửa hoặc chưa hoạt động nên chưa cấp mã QR check-in'), { status: 409, code: 'GYM_NOT_OPEN' });
    }
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
   *
   * The rules themselves live in checkin-core.ts (shared with the D15c assisted front-desk
   * check-in) so the two ways in cannot drift.
   */
  async checkInByGymToken(clientId: string, token: string) {
    const payload = verifyGymCheckinToken(token); // INVALID_TOKEN / TOKEN_EXPIRED
    const gymId = payload.gymId;

    const result = await prisma.$transaction(async (tx) => {
      const m = await lockMembershipForCheckIn(tx, { gymId, clientId });
      // The member performed this themselves, so there is no staff member to credit.
      return applyMemberCheckIn(tx, m, { gymId, clientId, checkedInBy: clientId, source: 'QR' });
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
