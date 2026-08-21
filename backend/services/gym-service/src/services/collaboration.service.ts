import { logger } from '@gym-coach/shared';
import { Prisma, CollaborationStatus, CollaborationParty } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { gymService } from './gym.service';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ONE = D(1);

/** Cap on counter-offers, so a negotiation cannot ping-pong forever. */
export const MAX_ROUNDS = Number(process.env.MAX_COLLABORATION_ROUNDS ?? '5');
/** How long an offer stays open, measured from the most recent proposal. */
const OFFER_TTL_DAYS = Number(process.env.COLLABORATION_OFFER_TTL_DAYS ?? '7');
const MIN_PLATFORM_RATE = D(process.env.MIN_PLATFORM_RATE ?? '0.10');

/**
 * Rate tables must be exact, not approximately right.
 *
 * These three numbers end up on every contract signed under this partnership and are split
 * to the đồng, so a table summing to 0.9999 is a data-entry mistake to reject rather than
 * floating-point noise to absorb. Mirrors assertRatesValid in payment-service.
 */
export function validateRates(ptRate: Prisma.Decimal, gymRate: Prisma.Decimal, platformRate: Prisma.Decimal): void {
  if (ptRate.lessThan(0) || gymRate.lessThan(0) || platformRate.lessThan(0)) {
    throw err('Tỷ lệ không được âm', 400);
  }
  if (platformRate.lessThan(MIN_PLATFORM_RATE)) {
    throw err(`Tỷ lệ nền tảng không được nhỏ hơn ${MIN_PLATFORM_RATE.toString()}`, 400);
  }
  const sum = ptRate.plus(gymRate).plus(platformRate);
  if (!sum.equals(ONE)) {
    throw err(`Tổng ba tỷ lệ phải bằng đúng 1, hiện là ${sum.toString()}`, 400);
  }
}

function offerDeadline(): Date {
  return new Date(Date.now() + OFFER_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Lazily retire an offer that has run out of time.
 *
 * A cron sweep would work too, but every read already has the row in hand and the deadline is
 * a plain comparison — expiring here means a stale offer can never be accepted, even in the
 * window before a sweep would have caught it.
 *
 * ⚠️ This is a GET-shaped function that WRITES. That is deliberate — flag it if you're reading
 * this expecting a pure read. The write is a guarded `updateMany` (status must still be
 * PENDING/COUNTERED), not a plain `update`: two requests can call this on the same row at once
 * (one about to accept, one just listing), and a plain `update` would unconditionally stamp
 * EXPIRED over a status that had *already* raced to ACCEPTED/REJECTED in between the read and
 * this call — silently reverting a real decision. The guard makes that impossible: the flip
 * only lands if the row is still open when the write executes.
 */
async function expireIfStale<T extends { id: string; status: CollaborationStatus; expiresAt: Date }>(row: T): Promise<T> {
  const open = row.status === 'PENDING' || row.status === 'COUNTERED';
  if (!open || row.expiresAt > new Date()) return row;
  const { count } = await prisma.gymPtCollaboration.updateMany({
    where: { id: row.id, status: { in: ['PENDING', 'COUNTERED'] } },
    data: { status: 'EXPIRED' },
  });
  if (count === 0) {
    // Someone else's write (accept/reject/counter) landed first. Merge the real scalar
    // columns back onto `row` rather than replacing it outright — callers like `listFor`
    // hand this a row carrying an `include`d `gym` relation that a plain re-fetch would not
    // have, and losing it here would silently break their return shape.
    const real = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: row.id } });
    return { ...row, ...real };
  }
  return { ...row, status: 'EXPIRED' as CollaborationStatus };
}

export const collaborationService = {
  /**
   * A trainer proposes terms to a gym (or a gym owner proposes to a trainer).
   *
   * Only one accepted partnership may exist per pair at a time, and only one live
   * negotiation — otherwise two offers could be accepted independently and the pair would end
   * up with two different "current" rate tables.
   */
  async propose(params: {
    gymId: string;
    ptUserId: string;
    proposedBy: CollaborationParty;
    ptRate: string;
    gymRate: string;
    platformRate?: string;
    note?: string;
  }) {
    const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
    if (!gym) throw err('Phòng gym không tồn tại', 404);

    const ptRate = D(params.ptRate);
    const gymRate = D(params.gymRate);
    const platformRate = D(params.platformRate ?? MIN_PLATFORM_RATE);
    validateRates(ptRate, gymRate, platformRate);

    const existing = await prisma.gymPtCollaboration.findFirst({
      where: {
        gymId: params.gymId,
        ptUserId: params.ptUserId,
        status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const fresh = await expireIfStale(existing);
      if (fresh.status === 'ACCEPTED') throw err('Đã có thoả thuận hợp tác đang hiệu lực', 409);
      if (fresh.status === 'PENDING' || fresh.status === 'COUNTERED') {
        throw err('Đang có một đề xuất chờ phản hồi — hãy trả lời đề xuất đó trước', 409);
      }
    }

    return prisma.gymPtCollaboration.create({
      data: {
        gymId: params.gymId,
        ptUserId: params.ptUserId,
        proposedPtRate: ptRate,
        proposedGymRate: gymRate,
        platformRate,
        proposedBy: params.proposedBy,
        status: 'PENDING',
        round: 1,
        expiresAt: offerDeadline(),
        note: params.note,
      },
    });
  },

  /**
   * Answer an open offer: accept it, reject it, or put different numbers on the table.
   *
   * The turn check matters. Without it the side that made the offer could "accept" their own
   * proposal and bind the other party to terms they never agreed to.
   */
  async respond(params: {
    collaborationId: string;
    actor: CollaborationParty;
    actorUserId: string;
    action: 'ACCEPT' | 'REJECT' | 'COUNTER';
    ptRate?: string;
    gymRate?: string;
    platformRate?: string;
    note?: string;
  }) {
    const row = await prisma.gymPtCollaboration.findUnique({ where: { id: params.collaborationId } });
    if (!row) throw err('Không tìm thấy đề xuất hợp tác', 404);

    await this.assertParty(row, params.actor, params.actorUserId);

    const fresh = await expireIfStale(row);
    if (fresh.status === 'EXPIRED') throw err('Đề xuất đã hết hạn', 409);
    if (fresh.status !== 'PENDING' && fresh.status !== 'COUNTERED') {
      throw err(`Không thể phản hồi đề xuất ở trạng thái ${fresh.status}`, 409);
    }
    if (fresh.proposedBy === params.actor) {
      throw err('Đang chờ phía bên kia phản hồi, không phải lượt của bạn', 409);
    }

    if (params.action === 'REJECT') {
      return prisma.gymPtCollaboration.update({
        where: { id: fresh.id },
        data: { status: 'REJECTED', note: params.note ?? fresh.note },
      });
    }

    if (params.action === 'ACCEPT') {
      try {
        const accepted = await prisma.$transaction(async (tx) => {
          // Guarded update: two accepts racing must not both land, and nothing may be accepted
          // out from under a status that has since moved on.
          const claimed = await tx.gymPtCollaboration.updateMany({
            where: { id: fresh.id, status: { in: ['PENDING', 'COUNTERED'] } },
            data: { status: 'ACCEPTED', acceptedAt: new Date() },
          });
          if (claimed.count === 0) throw err('Đề xuất đã được xử lý bởi một yêu cầu khác', 409);

          // The affiliation is what actually grants the trainer free check-in and floor access;
          // an accepted collaboration without it would be a rate table nobody can use.
          await tx.gymTrainerAffiliation.upsert({
            where: { gymId_ptId: { gymId: fresh.gymId, ptId: fresh.ptUserId } },
            create: {
              gymId: fresh.gymId,
              ptId: fresh.ptUserId,
              status: 'ACTIVE',
              commissionRate: fresh.proposedGymRate,
              joinedAt: new Date(),
            },
            update: { status: 'ACTIVE', commissionRate: fresh.proposedGymRate, joinedAt: new Date() },
          });

          return tx.gymPtCollaboration.findUniqueOrThrow({ where: { id: fresh.id } });
        });

        logger.info(
          `[Collaboration] ${accepted.gymId} ↔ PT ${accepted.ptUserId} accepted at pt=${accepted.proposedPtRate} gym=${accepted.proposedGymRate}`,
        );
        return accepted;
      } catch (e) {
        // The partial unique index (§1.1) is the backstop `propose()`'s existence check can't
        // fully close: two concurrent proposals for the same pair can both pass that check
        // and create two open rows before either commits, and then both get accepted here.
        // The database catches what the app check missed — surface it as the same 409 the
        // app-level guard above would have given.
        if ((e as { code?: string }).code === 'P2002') {
          throw err('Đã có một hợp tác khác được chấp nhận cho cặp PT–phòng gym này', 409);
        }
        throw e;
      }
    }

    // COUNTER — new numbers, and the turn passes back.
    if (fresh.round >= MAX_ROUNDS) {
      return prisma.gymPtCollaboration.update({
        where: { id: fresh.id },
        data: {
          status: 'EXPIRED',
          note: `Quá ${MAX_ROUNDS} vòng thương thảo mà chưa thống nhất`,
        },
      });
    }
    if (params.ptRate === undefined || params.gymRate === undefined) {
      throw err('Đề xuất lại phải kèm tỷ lệ mới', 400);
    }
    const ptRate = D(params.ptRate);
    const gymRate = D(params.gymRate);
    const platformRate = D(params.platformRate ?? fresh.platformRate);
    validateRates(ptRate, gymRate, platformRate);

    return prisma.gymPtCollaboration.update({
      where: { id: fresh.id },
      data: {
        proposedPtRate: ptRate,
        proposedGymRate: gymRate,
        platformRate,
        status: 'COUNTERED',
        proposedBy: params.actor,
        round: fresh.round + 1,
        expiresAt: offerDeadline(),
        note: params.note ?? fresh.note,
      },
    });
  },

  /**
   * End a partnership.
   *
   * Contracts already running keep the rates they were signed with — they are snapshots on
   * the contract, not lookups into this table (see docs/money-flow.md §12). Only future
   * contracts lose the arrangement.
   */
  async terminate(collaborationId: string, actor: CollaborationParty, actorUserId: string) {
    const row = await prisma.gymPtCollaboration.findUnique({ where: { id: collaborationId } });
    if (!row) throw err('Không tìm thấy hợp tác', 404);
    await this.assertParty(row, actor, actorUserId);
    if (row.status !== 'ACCEPTED') throw err(`Không thể chấm dứt hợp tác ở trạng thái ${row.status}`, 409);

    const [updated] = await prisma.$transaction([
      prisma.gymPtCollaboration.update({
        where: { id: row.id },
        data: { status: 'TERMINATED', terminatedAt: new Date(), terminatedBy: actorUserId },
      }),
      // No INACTIVE value on AffiliationStatus (PENDING/ACTIVE/REJECTED/SUSPENDED) — SUSPENDED
      // is the closest fit: the trainer no longer checks in free or shares revenue here, but
      // the row survives so a future re-acceptance has history to build on.
      prisma.gymTrainerAffiliation.updateMany({
        where: { gymId: row.gymId, ptId: row.ptUserId },
        data: { status: 'SUSPENDED' },
      }),
    ]);
    return updated;
  },

  /** Everything either side of a partnership can see. */
  async listFor(params: { ptUserId?: string; ownerId?: string }) {
    if (params.ptUserId) {
      const rows = await prisma.gymPtCollaboration.findMany({
        where: { ptUserId: params.ptUserId },
        orderBy: { updatedAt: 'desc' },
        include: { gym: { select: { id: true, name: true, city: true } } },
      });
      return Promise.all(rows.map((r) => expireIfStale(r)));
    }
    const gyms = await prisma.gym.findMany({ where: { ownerId: params.ownerId }, select: { id: true } });
    const rows = await prisma.gymPtCollaboration.findMany({
      where: { gymId: { in: gyms.map((g) => g.id) } },
      orderBy: { updatedAt: 'desc' },
      include: { gym: { select: { id: true, name: true, city: true } } },
    });
    return Promise.all(rows.map((r) => expireIfStale(r)));
  },

  /**
   * Public: which gyms a trainer may be booked through, for the client's "where do you
   * train?" picker on the hire-a-PT flow.
   *
   * Filters on the collaboration's own status AND the gym's current status — an accepted
   * partnership with a gym that has since been suspended or never got past review must not
   * appear as a bookable option.
   */
  async listAcceptedGymsForPt(ptUserId: string) {
    const rows = await prisma.gymPtCollaboration.findMany({
      where: { ptUserId, status: 'ACCEPTED', gym: { status: 'APPROVED' } },
      orderBy: { acceptedAt: 'desc' },
      select: {
        id: true,
        gymId: true,
        proposedPtRate: true,
        proposedGymRate: true,
        platformRate: true,
        gym: { select: { id: true, name: true, city: true } },
      },
    });
    return rows.map((r) => ({
      collaborationId: r.id,
      gym: r.gym,
      rates: {
        ptRate: r.proposedPtRate.toString(),
        gymRate: r.proposedGymRate.toString(),
        platformRate: r.platformRate.toString(),
      },
    }));
  },

  /** The live rate table for a pair, or null when they have no agreement. */
  async activeRates(gymId: string, ptUserId: string) {
    const row = await prisma.gymPtCollaboration.findFirst({
      where: { gymId, ptUserId, status: 'ACCEPTED' },
      orderBy: { acceptedAt: 'desc' },
    });
    if (!row) return null;
    return {
      collaborationId: row.id,
      platformRate: row.platformRate.toString(),
      ptRate: row.proposedPtRate.toString(),
      gymRate: row.proposedGymRate.toString(),
    };
  },

  /** Only the trainer named on the row, or the owner of the gym on it, may act. */
  async assertParty(
    row: { gymId: string; ptUserId: string },
    actor: CollaborationParty,
    actorUserId: string,
  ): Promise<void> {
    if (actor === 'PT') {
      if (row.ptUserId !== actorUserId) throw err('Không có quyền với hợp tác này', 403);
      return;
    }
    await gymService.getOwnedGym(row.gymId, actorUserId); // throws 403/404 when not the owner
  },
};
