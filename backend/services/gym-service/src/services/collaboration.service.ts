import { logger } from '@gym-coach/shared';
import { Prisma, CollaborationStatus, CollaborationParty } from '../generated/prisma';
import type { GymBrandPtAgreement } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { gymService } from './gym.service';
import { partnerGuard } from './partner-guard.service';

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
 * Notice period of a BRAND agreement's termination when the caller names no date. New contracts
 * stop the moment termination is initiated; contracts already paid keep being served until the
 * agreement is finally TERMINATED this many days later. (A legacy branch row still defaults to
 * "immediately" — see terminateLegacy.)
 */
export const BRAND_TERMINATION_NOTICE_DAYS = Number(process.env.COLLABORATION_TERMINATION_NOTICE_DAYS ?? '14');
/**
 * A caller-supplied termination date this far in the past still counts as "now": the date travels
 * from a client clock through a network hop, so "terminate right now" arrives a moment late.
 * Anything older is a real past date and is refused.
 */
const TERMINATION_DATE_GRACE_MS = 60 * 1000;

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

/**
 * Which revenue-share agreement (if any) governs a NEW gym-tied PT contract at a branch — ONE
 * definition, shared by the client's gym picker (listAcceptedGymsForPt) and the rate lookup at
 * contract creation (activeRates), so the picker can never offer a branch the lookup would then
 * refuse. Both go through branchAcceptsNewContracts() + pickAgreement() below; neither has a
 * filter of its own.
 *
 * For branch G and trainer PT a new contract is possible when ALL hold:
 *   1. G is APPROVED (admin moderation) AND OPEN (the owner's own switch). A temporarily or
 *      permanently closed branch is still APPROVED and must not take on a NEW contract.
 *   2. G's owner is accepting new money — partnerGuard.assertAcceptsNewMoney, the very check
 *      membership purchase uses (SUSPENDED / TERMINATED partner refused; an owner with no
 *      partner record, i.e. a pre-partner-model owner, allowed).
 *   3. An agreement applies, looked for in this order:
 *        a. BRAND: G has a brandId and (brand, PT) holds a GymBrandPtAgreement that is ACCEPTED
 *           with no termination started (terminationInitiatedAt AND effectiveAt both null).
 *           It covers EVERY branch of the brand, including ones that never had a legacy row.
 *        b. BRANCH (legacy): a GymPtCollaboration for exactly (G, PT) that is ACCEPTED, with no
 *           termination started, and NOT superseded by a brand agreement. This keeps pairs the
 *           backfill has not migrated, conflict pairs (several branches on different rates) and
 *           brandless gyms working on their own old terms, branch by branch.
 *
 * A SUPERSEDED legacy row is never an agreement again. Its terms were folded into a brand
 * agreement; if that agreement is later terminated, the old branch row must not quietly come
 * back to life at the old rates — the pair simply has no agreement until a new one is made.
 *
 * Contracts already signed never come back through here: their rates are a snapshot.
 */
const BRAND_AGREEMENT_USABLE = {
  status: 'ACCEPTED',
  terminationInitiatedAt: null,
  effectiveAt: null,
} as const satisfies Prisma.GymBrandPtAgreementWhereInput;

const LEGACY_AGREEMENT_USABLE = {
  status: 'ACCEPTED',
  terminationInitiatedAt: null,
  effectiveAt: null,
  supersededByAgreementId: null,
} as const satisfies Prisma.GymPtCollaborationWhereInput;

const RESOLUTION_GYM_SELECT = {
  id: true,
  name: true,
  city: true,
  ownerId: true,
  brandId: true,
  status: true,
  operationalStatus: true,
} as const satisfies Prisma.GymSelect;
type ResolutionGym = Prisma.GymGetPayload<{ select: typeof RESOLUTION_GYM_SELECT }>;

interface ResolvedAgreement {
  /** GymBrandPtAgreement.id for BRAND, GymPtCollaboration.id for BRANCH. */
  id: string;
  scope: 'BRAND' | 'BRANCH';
  ptRate: string;
  gymRate: string;
  platformRate: string;
  acceptedAt: Date | null;
}

type AgreementRow = {
  id: string;
  proposedPtRate: Prisma.Decimal;
  proposedGymRate: Prisma.Decimal;
  platformRate: Prisma.Decimal;
  acceptedAt: Date | null;
};

function toResolved(row: AgreementRow, scope: 'BRAND' | 'BRANCH'): ResolvedAgreement {
  return {
    id: row.id,
    scope,
    ptRate: row.proposedPtRate.toString(),
    gymRate: row.proposedGymRate.toString(),
    platformRate: row.platformRate.toString(),
    acceptedAt: row.acceptedAt,
  };
}

/** Conditions 1 and 2. `ownerOk` memoises the partner lookup per owner (one query per owner, not per branch). */
async function branchAcceptsNewContracts(gym: ResolutionGym, ownerOk: Map<string, boolean>): Promise<boolean> {
  if (gym.status !== 'APPROVED' || gym.operationalStatus !== 'OPEN') return false;
  let ok = ownerOk.get(gym.ownerId);
  if (ok === undefined) {
    // Non-throwing form of the membership gate: only its own refusal reads as "no"; a database
    // failure propagates, so an outage is never mistaken for "this branch is not eligible".
    ok = await partnerGuard.acceptsNewMoney(gym.ownerId);
    ownerOk.set(gym.ownerId, ok);
  }
  return ok;
}

/** Condition 3: the brand agreement wins; the legacy row is a fallback, and only if it is itself usable. */
function pickAgreement(brandAgreement: AgreementRow | null | undefined, legacy: AgreementRow | null | undefined): ResolvedAgreement | null {
  if (brandAgreement) return toResolved(brandAgreement, 'BRAND');
  if (legacy) return toResolved(legacy, 'BRANCH');
  return null;
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

/**
 * Vòng 4 / Phase E3 — mirrors expireIfStale above, but for a collaboration whose notice-period
 * termination has actually arrived: status stays 'ACCEPTED' while effectiveAt is in the
 * future (existing affiliation/roster display is unaffected during the wind-down), and only
 * flips to TERMINATED (+ suspends the affiliation, same as an immediate terminate()) once
 * effectiveAt has passed. Called from every read path that returns collaboration rows, same as
 * expireIfStale, so a stale ACCEPTED never leaks out just because nothing has written to the
 * row since its effectiveAt passed.
 */
async function finalizeIfEffective<T extends { id: string; gymId: string; ptUserId: string; status: CollaborationStatus; effectiveAt: Date | null }>(
  row: T,
): Promise<T> {
  if (row.status !== 'ACCEPTED' || !row.effectiveAt || row.effectiveAt > new Date()) return row;
  const { count } = await prisma.gymPtCollaboration.updateMany({
    where: { id: row.id, status: 'ACCEPTED' },
    data: { status: 'TERMINATED', terminatedAt: row.effectiveAt },
  });
  if (count > 0) {
    await prisma.gymTrainerAffiliation.updateMany({
      where: { gymId: row.gymId, ptId: row.ptUserId },
      data: { status: 'SUSPENDED' },
    });
  }
  const real = await prisma.gymPtCollaboration.findUniqueOrThrow({ where: { id: row.id } });
  return { ...row, ...real };
}

/** Parse + validate a rate table in one place — the legacy and brand flows must never drift apart on this. */
function parseRates(ptRate: Prisma.Decimal.Value, gymRate: Prisma.Decimal.Value, platformRate: Prisma.Decimal.Value) {
  const rates = { ptRate: D(ptRate), gymRate: D(gymRate), platformRate: D(platformRate) };
  validateRates(rates.ptRate, rates.gymRate, rates.platformRate);
  return rates;
}

/** Shared by both flows: an answer is only possible while the offer is open. `fresh` has already been through expiry. */
function assertOpen(fresh: { status: CollaborationStatus }) {
  if (fresh.status === 'EXPIRED') throw err('Đề xuất đã hết hạn', 409);
  if (fresh.status !== 'PENDING' && fresh.status !== 'COUNTERED') {
    throw err(`Không thể phản hồi đề xuất ở trạng thái ${fresh.status}`, 409);
  }
}

/** Without this the side that made the offer could "accept" its own proposal and bind the other party. */
function assertMyTurn(fresh: { proposedBy: CollaborationParty }, actor: CollaborationParty) {
  if (fresh.proposedBy === actor) throw err('Đang chờ phía bên kia phản hồi, không phải lượt của bạn', 409);
}

/**
 * What a COUNTER does to the row, as plain update data — shared by the legacy and brand flows so
 * the round cap, the "rates required" rule and validateRates behave identically on both. Past
 * MAX_ROUNDS the negotiation is retired instead of continued (still a normal 200 to the caller,
 * as it always was).
 */
function planCounter(
  fresh: { round: number; platformRate: Prisma.Decimal; note: string | null },
  params: { ptRate?: string; gymRate?: string; platformRate?: string; note?: string },
  actor: CollaborationParty,
) {
  if (fresh.round >= MAX_ROUNDS) {
    return { status: 'EXPIRED' as const, note: `Quá ${MAX_ROUNDS} vòng thương thảo mà chưa thống nhất` };
  }
  if (params.ptRate === undefined || params.gymRate === undefined) {
    throw err('Đề xuất lại phải kèm tỷ lệ mới', 400);
  }
  const { ptRate, gymRate, platformRate } = parseRates(params.ptRate, params.gymRate, params.platformRate ?? fresh.platformRate);
  return {
    proposedPtRate: ptRate,
    proposedGymRate: gymRate,
    platformRate,
    status: 'COUNTERED' as const,
    proposedBy: actor,
    round: fresh.round + 1,
    expiresAt: offerDeadline(),
    note: params.note ?? fresh.note,
  };
}

// ───────────────────────────── Brand agreements (GymBrandPtAgreement) ─────────────────────────────

/** expireIfStale for a brand agreement — same guarded write, same reasoning (see above). */
async function expireBrandIfStale<T extends { id: string; status: CollaborationStatus; expiresAt: Date }>(row: T): Promise<T> {
  const open = row.status === 'PENDING' || row.status === 'COUNTERED';
  if (!open || row.expiresAt > new Date()) return row;
  const { count } = await prisma.gymBrandPtAgreement.updateMany({
    where: { id: row.id, status: { in: ['PENDING', 'COUNTERED'] } },
    data: { status: 'EXPIRED' },
  });
  if (count === 0) {
    const real = await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: row.id } });
    return { ...row, ...real };
  }
  return { ...row, status: 'EXPIRED' as CollaborationStatus };
}

/**
 * A terminated brand agreement stops serving every branch of the brand, so the PT's affiliation
 * rows there stop granting floor access too — the same SUSPENDED the legacy flow applies to its one
 * gym, just across the brand's gyms. Only ACTIVE rows are touched: a PENDING invitation or a row
 * the owner already rejected is not this agreement's to change. `db` is the transaction when the
 * caller has one, so the status flip and the suspension land together.
 */
async function suspendBrandAffiliations(db: Prisma.TransactionClient, brandId: string, ptUserId: string) {
  await db.gymTrainerAffiliation.updateMany({
    where: { ptId: ptUserId, status: 'ACTIVE', gym: { brandId } },
    data: { status: 'SUSPENDED' },
  });
}

/**
 * finalizeIfEffective for a brand agreement: once the notice period has run out the status finally
 * flips to TERMINATED (guarded, so two readers racing cannot both do it) and the PT's ACTIVE
 * affiliations at the brand's gyms are suspended. Until then the status stays ACCEPTED — contracts
 * already signed keep being served — while the read path already refuses NEW contracts because
 * terminationInitiatedAt is set.
 */
async function finalizeBrandIfEffective<
  T extends { id: string; brandId: string; ptUserId: string; status: CollaborationStatus; effectiveAt: Date | null },
>(row: T): Promise<T> {
  if (row.status !== 'ACCEPTED' || !row.effectiveAt || row.effectiveAt > new Date()) return row;
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.gymBrandPtAgreement.updateMany({
      where: { id: row.id, status: 'ACCEPTED' },
      data: { status: 'TERMINATED', terminatedAt: row.effectiveAt },
    });
    if (count > 0) await suspendBrandAffiliations(tx, row.brandId, row.ptUserId);
  });
  const real = await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: row.id } });
  return { ...row, ...real };
}

/**
 * Fold every still-live legacy branch row of (brand, PT) into the new agreement: they are marked
 * superseded and from then on the read path ignores them (even if the agreement is later
 * terminated). Raw SQL on purpose — Prisma's @updatedAt would bump updated_at on rows whose terms
 * we did not change, and "which legacy row was last touched" is audit data (the backfill script
 * does the same, for the same reason). Rates are never rewritten. Winding-down rows (ACCEPTED with a
 * future effectiveAt) are included: after this the brand agreement is the only truth for the pair.
 */
async function supersedeLegacyRows(tx: Prisma.TransactionClient, brandId: string, ptUserId: string, agreementId: string, now: Date) {
  await tx.$executeRaw`
    UPDATE gym_pt_collaborations c
    SET superseded_by_agreement_id = ${agreementId}, superseded_at = ${now}
    FROM gyms g
    WHERE g.id = c.gym_id AND g.brand_id = ${brandId}
      AND c.pt_user_id = ${ptUserId} AND c.status = 'ACCEPTED' AND c.superseded_by_agreement_id IS NULL`;
}

type BrandAgreementRow = GymBrandPtAgreement;
interface BrandContext {
  brand: { id: string; name: string };
  /** The "representative branch" shown to clients that only know branch-level rows — rule in brandContexts(). */
  gym: { id: string; name: string; city: string | null };
}

/**
 * Representative branch of each brand: the EARLIEST-CREATED APPROVED branch, otherwise the
 * earliest-created branch of any status (ties broken by id, so it is stable). The apps in the field
 * render `row.gym.name` and read `row.gymId`, and a brand agreement has no single branch; this keeps
 * both non-null. A brand with no branch at all (all deleted) falls back to the brand's own name with
 * an empty id. One query for any number of brands.
 */
async function brandContexts(brandIds: string[]): Promise<Map<string, BrandContext>> {
  const out = new Map<string, BrandContext>();
  if (brandIds.length === 0) return out;
  const brands = await prisma.gymBrand.findMany({
    where: { id: { in: brandIds } },
    select: {
      id: true,
      name: true,
      branches: {
        select: { id: true, name: true, city: true, status: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  for (const b of brands) {
    const rep = b.branches.find((g) => g.status === 'APPROVED') ?? b.branches[0];
    out.set(b.id, {
      brand: { id: b.id, name: b.name },
      gym: rep ? { id: rep.id, name: rep.name, city: rep.city } : { id: '', name: b.name, city: null },
    });
  }
  return out;
}

/** A brand agreement in the shape every existing client already reads, plus additive fields. */
function presentBrandAgreement(row: BrandAgreementRow, ctx: BrandContext | undefined) {
  const c = ctx ?? { brand: { id: row.brandId, name: '' }, gym: { id: '', name: '', city: null } };
  return { ...row, gymId: c.gym.id, gym: c.gym, scope: 'BRAND' as const, brand: c.brand };
}

async function presentBrandAgreements(rows: BrandAgreementRow[]) {
  const ctx = await brandContexts([...new Set(rows.map((r) => r.brandId))]);
  return rows.map((r) => presentBrandAgreement(r, ctx.get(r.brandId)));
}

async function proposeForBrand(
  brandId: string,
  gym: { id: string; status: string },
  params: { ptUserId: string; proposedBy: CollaborationParty; note?: string },
  rates: { ptRate: Prisma.Decimal; gymRate: Prisma.Decimal; platformRate: Prisma.Decimal },
) {
  if (gym.status !== 'APPROVED') throw err('Phòng gym chưa được duyệt nên chưa thể đề xuất hợp tác', 409);

  const existing = await prisma.gymBrandPtAgreement.findFirst({
    where: { brandId, ptUserId: params.ptUserId, status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    // Retire what time has already retired first, so a lapsed offer or a finished notice period
    // never blocks a new proposal. An ACCEPTED agreement that is merely winding down still blocks
    // (one ACCEPTED per pair is also enforced by the database).
    const fresh = await finalizeBrandIfEffective(await expireBrandIfStale(existing));
    if (fresh.status === 'ACCEPTED') {
      throw err(
        fresh.terminationInitiatedAt
          ? 'Thoả thuận hợp tác hiện tại đang trong thời gian báo trước chấm dứt — chỉ có thể đề xuất lại sau khi nó kết thúc'
          : 'Đã có thoả thuận hợp tác đang hiệu lực với thương hiệu này',
        409,
      );
    }
    if (fresh.status === 'PENDING' || fresh.status === 'COUNTERED') {
      throw err('Đang có một đề xuất chờ phản hồi — hãy trả lời đề xuất đó trước', 409);
    }
  }

  try {
    const created = await prisma.gymBrandPtAgreement.create({
      data: {
        brandId,
        ptUserId: params.ptUserId,
        proposedPtRate: rates.ptRate,
        proposedGymRate: rates.gymRate,
        platformRate: rates.platformRate,
        proposedBy: params.proposedBy,
        status: 'PENDING',
        round: 1,
        expiresAt: offerDeadline(),
        note: params.note,
        origin: 'NATIVE',
      },
    });
    return (await presentBrandAgreements([created]))[0];
  } catch (e) {
    // The partial unique indexes are the backstop the check above cannot close: two concurrent
    // proposals for the same (brand, PT) can both pass it.
    if ((e as { code?: string }).code === 'P2002') {
      throw err('Đang có một đề xuất hoặc thoả thuận hợp tác khác với thương hiệu này', 409);
    }
    throw e;
  }
}

async function respondToBrandAgreement(
  row: BrandAgreementRow,
  params: {
    actor: CollaborationParty;
    action: 'ACCEPT' | 'REJECT' | 'COUNTER';
    ptRate?: string;
    gymRate?: string;
    platformRate?: string;
    note?: string;
  },
) {
  const fresh = await expireBrandIfStale(row);
  assertOpen(fresh);
  assertMyTurn(fresh, params.actor);

  const reload = async () =>
    (await presentBrandAgreements([await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: fresh.id } })]))[0];
  // Every write is guarded by "still open", like the ACCEPT claim: a REJECT/COUNTER racing an
  // ACCEPT must not overwrite it.
  const openWhere = { id: fresh.id, status: { in: ['PENDING', 'COUNTERED'] as CollaborationStatus[] } };
  const raced = () => err('Đề xuất đã được xử lý bởi một yêu cầu khác', 409);

  if (params.action === 'REJECT') {
    const { count } = await prisma.gymBrandPtAgreement.updateMany({
      where: openWhere,
      data: { status: 'REJECTED', note: params.note ?? fresh.note },
    });
    if (count === 0) throw raced();
    return reload();
  }

  if (params.action === 'ACCEPT') {
    try {
      const accepted = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.gymBrandPtAgreement.updateMany({
          where: openWhere,
          data: { status: 'ACCEPTED', acceptedAt: now },
        });
        if (claimed.count === 0) throw raced();

        await supersedeLegacyRows(tx, fresh.brandId, fresh.ptUserId, fresh.id, now);
        // The pair's disagreement is settled by this very agreement.
        await tx.gymPtAgreementConflict.updateMany({
          where: { brandId: fresh.brandId, ptUserId: fresh.ptUserId, status: 'OPEN' },
          data: { status: 'RESOLVED', resolvedAgreementId: fresh.id, resolvedAt: now },
        });
        // Deliberately NO GymTrainerAffiliation here: the legacy accept upserts an ACTIVE row whose
        // visibility defaults to PUBLIC, which would list the PT on every public roster the moment a
        // partnership is made. Whoever wants the PT shown on a branch invites them explicitly.
        return tx.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: fresh.id } });
      });
      logger.info(
        `[Collaboration] brand ${accepted.brandId} ↔ PT ${accepted.ptUserId} accepted at pt=${accepted.proposedPtRate} gym=${accepted.proposedGymRate}`,
      );
      return (await presentBrandAgreements([accepted]))[0];
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw err('Đã có một hợp tác khác được chấp nhận cho cặp PT–thương hiệu này', 409);
      }
      throw e;
    }
  }

  // COUNTER
  const plan = planCounter(fresh, params, params.actor);
  const { count } = await prisma.gymBrandPtAgreement.updateMany({
    where: { ...openWhere, round: fresh.round },
    data: plan,
  });
  if (count === 0) throw raced();
  return reload();
}

async function terminateBrandAgreement(row: BrandAgreementRow, actorUserId: string, requested?: Date) {
  // A notice period that has just run out makes this a 409 "already TERMINATED", not a second termination.
  const fresh = await finalizeBrandIfEffective(row);
  if (fresh.status !== 'ACCEPTED') throw err(`Không thể chấm dứt hợp tác ở trạng thái ${fresh.status}`, 409);
  if (fresh.terminationInitiatedAt) throw err('Hợp tác này đã được báo chấm dứt và đang trong thời gian báo trước', 409);

  const now = new Date();
  if (requested && requested.getTime() < now.getTime() - TERMINATION_DATE_GRACE_MS) {
    throw err('Ngày chấm dứt không được ở trong quá khứ', 400);
  }
  const effectiveAt = requested ?? new Date(now.getTime() + BRAND_TERMINATION_NOTICE_DAYS * 24 * 60 * 60 * 1000);
  const immediate = effectiveAt.getTime() <= now.getTime();

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.gymBrandPtAgreement.updateMany({
      where: { id: fresh.id, status: 'ACCEPTED', terminationInitiatedAt: null },
      data: {
        terminationInitiatedAt: now,
        terminatedBy: actorUserId,
        effectiveAt: immediate ? now : effectiveAt,
        ...(immediate ? { status: 'TERMINATED' as const, terminatedAt: now } : {}),
      },
    });
    if (count === 0) throw err('Hợp tác đã được xử lý bởi một yêu cầu khác', 409);
    if (immediate) await suspendBrandAffiliations(tx, fresh.brandId, fresh.ptUserId);
  });
  return (await presentBrandAgreements([await prisma.gymBrandPtAgreement.findUniqueOrThrow({ where: { id: fresh.id } })]))[0];
}

const LEGACY_AT_BRANDED_GYM_MESSAGE =
  'Thoả thuận hợp tác nay được lập cho cả thương hiệu, không còn theo từng chi nhánh — hãy gửi một đề xuất mới cho thương hiệu';

/** An id may name a brand agreement or a legacy branch row (uuids do not collide in practice). */
async function loadAgreement(id: string, notFoundMessage: string) {
  const brandRow = await prisma.gymBrandPtAgreement.findUnique({ where: { id } });
  if (brandRow) return { kind: 'BRAND' as const, row: brandRow };
  const legacyRow = await prisma.gymPtCollaboration.findUnique({ where: { id } });
  if (legacyRow) return { kind: 'LEGACY' as const, row: legacyRow };
  throw err(notFoundMessage, 404);
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

    const { ptRate, gymRate, platformRate } = parseRates(params.ptRate, params.gymRate, params.platformRate ?? MIN_PLATFORM_RATE);

    // Brand-level write path: a gym that belongs to a brand gets ONE agreement for the whole
    // brand, never a new branch row. A brandless gym keeps the legacy branch-level flow below.
    if (gym.brandId) {
      return proposeForBrand(gym.brandId, gym, params, { ptRate, gymRate, platformRate });
    }

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
    // The id may name a brand agreement (the current model) or a legacy branch-level row.
    const target = await loadAgreement(params.collaborationId, 'Không tìm thấy đề xuất hợp tác');
    await this.assertParty(
      target.kind === 'BRAND' ? { brandId: target.row.brandId, ptUserId: target.row.ptUserId } : target.row,
      params.actor,
      params.actorUserId,
    );
    if (target.kind === 'BRAND') return respondToBrandAgreement(target.row, params);

    const row = target.row;
    const fresh = await expireIfStale(row);
    assertOpen(fresh);

    if (params.action !== 'REJECT') {
      // Agreements are brand-level now. An open branch-level negotiation at a gym that belongs to a
      // brand may still be turned down or lapse, but must not become (or stay) a new branch-level
      // agreement — that would recreate exactly what the brand model replaced.
      const gym = await prisma.gym.findUnique({ where: { id: fresh.gymId }, select: { brandId: true } });
      if (gym?.brandId) throw err(LEGACY_AT_BRANDED_GYM_MESSAGE, 409);
    }
    assertMyTurn(fresh, params.actor);

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

    // COUNTER — new numbers, and the turn passes back (or, past MAX_ROUNDS, the negotiation lapses).
    return prisma.gymPtCollaboration.update({ where: { id: fresh.id }, data: planCounter(fresh, params, params.actor) });
  },

  /**
   * End a partnership.
   *
   * Contracts already running keep the rates they were signed with — they are snapshots on
   * the contract, not lookups into this table (see docs/money-flow.md §12). Only future
   * contracts lose the arrangement.
   */
  /**
   * Vòng 4 / Phase E3 — `effectiveAt` is optional and defaults to immediate (today's exact
   * behavior, unchanged for any caller not passing it). Passed a future date instead, this
   * becomes a notice-period termination: `activeRates()` refuses this row for any NEW
   * referral/rate lookup starting right now, but `status` stays ACCEPTED (so the affiliation
   * row is NOT suspended yet — the PT keeps showing as affiliated) until that date arrives,
   * when `finalizeIfEffective` (called from every read path) finishes the job.
   */
  async terminate(collaborationId: string, actor: CollaborationParty, actorUserId: string, effectiveAt?: Date) {
    const target = await loadAgreement(collaborationId, 'Không tìm thấy hợp tác');
    await this.assertParty(
      target.kind === 'BRAND' ? { brandId: target.row.brandId, ptUserId: target.row.ptUserId } : target.row,
      actor,
      actorUserId,
    );
    // A brand agreement ends after a notice period (default BRAND_TERMINATION_NOTICE_DAYS) and
    // blocks new contracts from the first moment; see terminateBrandAgreement.
    if (target.kind === 'BRAND') return terminateBrandAgreement(target.row, actorUserId, effectiveAt);

    // Legacy branch row. Its default stays "immediately" (unchanged for every caller): giving it
    // the brand's 14-day notice would change behaviour for rows nobody asked to migrate. What is
    // new is only the marker: terminationInitiatedAt, which the brand-aware read path refuses on.
    const row = target.row;
    if (row.status !== 'ACCEPTED') throw err(`Không thể chấm dứt hợp tác ở trạng thái ${row.status}`, 409);

    const now = new Date();
    const isFuture = effectiveAt && effectiveAt.getTime() > now.getTime();
    if (isFuture) {
      // Notice period: leave status ACCEPTED, affiliation untouched — just mark it winding
      // down. activeRates() above already stops honoring it from this point on regardless.
      return prisma.gymPtCollaboration.update({
        where: { id: row.id },
        data: { effectiveAt, terminatedBy: actorUserId, terminationInitiatedAt: now },
      });
    }

    const [updated] = await prisma.$transaction([
      prisma.gymPtCollaboration.update({
        where: { id: row.id },
        data: {
          status: 'TERMINATED',
          terminatedAt: now,
          terminatedBy: actorUserId,
          effectiveAt: now,
          terminationInitiatedAt: now,
        },
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

  /**
   * Everything either side of a partnership can see: brand agreements AND legacy branch rows
   * (superseded ones too — they are history; clients can hide them via `supersededByAgreementId`),
   * newest activity first. Brand items are shaped like legacy ones (see presentBrandAgreement) plus
   * additive `scope`, `brand`; legacy items get `scope: 'BRANCH'` and `brand` (null for a brandless gym).
   */
  async listFor(params: { ptUserId?: string; ownerId?: string }) {
    const legacyInclude = { gym: { select: { id: true, name: true, city: true, brandId: true } } } as const;
    let brandRows: BrandAgreementRow[];
    let legacyRows;
    if (params.ptUserId) {
      [brandRows, legacyRows] = await Promise.all([
        prisma.gymBrandPtAgreement.findMany({ where: { ptUserId: params.ptUserId } }),
        prisma.gymPtCollaboration.findMany({ where: { ptUserId: params.ptUserId }, include: legacyInclude }),
      ]);
    } else {
      const [brands, gyms] = await Promise.all([
        prisma.gymBrand.findMany({ where: { ownerId: params.ownerId }, select: { id: true } }),
        prisma.gym.findMany({ where: { ownerId: params.ownerId }, select: { id: true } }),
      ]);
      [brandRows, legacyRows] = await Promise.all([
        prisma.gymBrandPtAgreement.findMany({ where: { brandId: { in: brands.map((b) => b.id) } } }),
        prisma.gymPtCollaboration.findMany({ where: { gymId: { in: gyms.map((g) => g.id) } }, include: legacyInclude }),
      ]);
    }

    const [brandSettled, legacySettled] = await Promise.all([
      Promise.all(brandRows.map((r) => expireBrandIfStale(r).then((row) => finalizeBrandIfEffective(row)))),
      Promise.all(legacyRows.map((r) => expireIfStale(r).then((row) => finalizeIfEffective(row)))),
    ]);

    // One brand lookup serves both the brand items and the `brand` field of legacy items.
    const ctx = await brandContexts([
      ...new Set([...brandSettled.map((r) => r.brandId), ...legacySettled.flatMap((r) => (r.gym.brandId ? [r.gym.brandId] : []))]),
    ]);

    const items = [
      ...brandSettled.map((r) => presentBrandAgreement(r, ctx.get(r.brandId))),
      ...legacySettled.map(({ gym, ...r }) => ({
        ...r,
        gym: { id: gym.id, name: gym.name, city: gym.city },
        scope: 'BRANCH' as const,
        brand: gym.brandId ? (ctx.get(gym.brandId)?.brand ?? null) : null,
      })),
    ];
    return items.sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
  },

  /**
   * Public: which gyms a trainer may be booked through, for the client's "where do you
   * train?" picker on the hire-a-PT flow.
   *
   * Uses the SAME resolution as activeRates() below (rules: see the comment above
   * BRAND_AGREEMENT_USABLE): anything this list offers, contract creation must then be able to
   * resolve a rate table for — it is built from the very same branchAcceptsNewContracts() and
   * pickAgreement(), just evaluated over many branches at once. One entry per BRANCH: every
   * eligible branch of each brand the trainer holds a usable brand agreement with (including
   * branches that never had a legacy row), plus every eligible branch carrying only a usable
   * legacy row. A branch appears once, under the agreement that actually governs it.
   *
   * Order (deterministic): governing agreement's acceptedAt newest first (nulls last), then gym
   * name, then gym id as the final tiebreaker. Queries: 3 fixed, plus one partner lookup per
   * distinct owner (not per branch).
   */
  async listAcceptedGymsForPt(ptUserId: string) {
    const [brandAgreements, legacyRows] = await Promise.all([
      prisma.gymBrandPtAgreement.findMany({
        where: { ptUserId, ...BRAND_AGREEMENT_USABLE },
        orderBy: { acceptedAt: { sort: 'desc', nulls: 'last' } },
      }),
      prisma.gymPtCollaboration.findMany({
        where: { ptUserId, ...LEGACY_AGREEMENT_USABLE },
        orderBy: { acceptedAt: { sort: 'desc', nulls: 'last' } },
      }),
    ]);
    if (brandAgreements.length === 0 && legacyRows.length === 0) return [];

    const brandAgreementByBrand = new Map<string, AgreementRow>();
    for (const a of brandAgreements) if (!brandAgreementByBrand.has(a.brandId)) brandAgreementByBrand.set(a.brandId, a);
    const legacyByGym = new Map<string, AgreementRow>();
    for (const r of legacyRows) if (!legacyByGym.has(r.gymId)) legacyByGym.set(r.gymId, r);

    const candidates = await prisma.gym.findMany({
      where: {
        OR: [
          ...(brandAgreementByBrand.size > 0 ? [{ brandId: { in: [...brandAgreementByBrand.keys()] } }] : []),
          ...(legacyByGym.size > 0 ? [{ id: { in: [...legacyByGym.keys()] } }] : []),
        ],
      },
      select: RESOLUTION_GYM_SELECT,
    });

    const ownerOk = new Map<string, boolean>();
    const offered: Array<{ resolved: ResolvedAgreement; gym: ResolutionGym }> = [];
    for (const gym of candidates) {
      if (!(await branchAcceptsNewContracts(gym, ownerOk))) continue;
      const resolved = pickAgreement(gym.brandId ? brandAgreementByBrand.get(gym.brandId) : null, legacyByGym.get(gym.id));
      if (resolved) offered.push({ resolved, gym });
    }

    offered.sort((x, y) => {
      const ax = x.resolved.acceptedAt?.getTime() ?? -Infinity;
      const ay = y.resolved.acceptedAt?.getTime() ?? -Infinity;
      if (ax !== ay) return ay - ax;
      return x.gym.name.localeCompare(y.gym.name) || (x.gym.id < y.gym.id ? -1 : x.gym.id > y.gym.id ? 1 : 0);
    });

    return offered.map(({ resolved, gym }) => ({
      collaborationId: resolved.id,
      gym: { id: gym.id, name: gym.name, city: gym.city },
      rates: { ptRate: resolved.ptRate, gymRate: resolved.gymRate, platformRate: resolved.platformRate },
    }));
  },

  /**
   * The live rate table for a (branch, trainer) pair, or null when no agreement may take a NEW
   * contract there. `collaborationId` is the brand agreement's id when `agreementScope` is
   * 'BRAND', the branch-level collaboration's id when 'BRANCH'. Resolution rules: see the
   * comment above BRAND_AGREEMENT_USABLE.
   *
   * Money-flow plan 2.5 — third chokepoint: a gym that is no longer APPROVED, that the owner has
   * closed, or whose partner is locked must not hand out a rate table for NEW contracts, even if
   * an agreement is still ACCEPTED. A pending termination (terminate() sets effectiveAt; the
   * brand flow sets terminationInitiatedAt) blocks NEW lookups the moment it is set, not only once
   * the effective date arrives. Contracts already signed never come back through here — their
   * rates are a snapshot.
   */
  async activeRates(gymId: string, ptUserId: string) {
    const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: RESOLUTION_GYM_SELECT });
    if (!gym) return null;
    if (!(await branchAcceptsNewContracts(gym, new Map()))) return null;

    const brandAgreement = gym.brandId
      ? await prisma.gymBrandPtAgreement.findFirst({
          where: { brandId: gym.brandId, ptUserId, ...BRAND_AGREEMENT_USABLE },
          orderBy: { acceptedAt: { sort: 'desc', nulls: 'last' } },
        })
      : null;
    // Only looked up when no brand agreement decides: the brand agreement takes precedence here.
    const legacyRow = brandAgreement
      ? null
      : await prisma.gymPtCollaboration.findFirst({
          where: { gymId, ptUserId, ...LEGACY_AGREEMENT_USABLE },
          orderBy: { acceptedAt: { sort: 'desc', nulls: 'last' } },
        });

    const resolved = pickAgreement(brandAgreement, legacyRow);
    if (!resolved) return null;
    return {
      collaborationId: resolved.id,
      platformRate: resolved.platformRate,
      ptRate: resolved.ptRate,
      gymRate: resolved.gymRate,
      agreementScope: resolved.scope,
    };
  },

  /**
   * Only the trainer named on the row, or the owner of what the row is attached to, may act: the
   * owner of the BRAND for a brand agreement (`brandId`), the owner of the GYM for a legacy row
   * (`gymId`). The owner side throws 403 when someone else owns it and 404 when it does not exist.
   */
  async assertParty(
    row: { gymId: string; ptUserId: string } | { brandId: string; ptUserId: string },
    actor: CollaborationParty,
    actorUserId: string,
  ): Promise<void> {
    if (actor === 'PT') {
      if (row.ptUserId !== actorUserId) throw err('Không có quyền với hợp tác này', 403);
      return;
    }
    if ('brandId' in row) {
      const brand = await prisma.gymBrand.findUnique({ where: { id: row.brandId }, select: { ownerId: true } });
      if (!brand) throw err('Không tìm thấy thương hiệu', 404);
      if (brand.ownerId !== actorUserId) throw err('Không có quyền với hợp tác này', 403);
      return;
    }
    await gymService.getOwnedGym(row.gymId, actorUserId); // throws 403/404 when not the owner
  },
};
