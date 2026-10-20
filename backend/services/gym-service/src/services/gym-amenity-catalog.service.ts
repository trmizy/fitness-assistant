/**
 * Amenity catalogue + proposals (Listing Management B2). The SINGLE implementation of plan §12.3:
 *
 *  - the catalogue (`amenities`) has two states only, ACTIVE | DISABLED; a proposal (`amenity_proposals`) is the
 *    owner's ask (NEW | REENABLE) and is never part of the catalogue;
 *  - every operation that creates / renames / decides a name runs under `pg_advisory_xact_lock(hashtext('amenity-name:' ||
 *    name_normalized))`, so the same name is always handled one after the other;
 *  - NOTHING here catches a unique violation and carries on (PostgreSQL aborts the whole transaction): inserts are
 *    `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, followed by a SELECT when nothing came back;
 *  - a decision locks the proposals (`FOR UPDATE`, ordered by id); any that is no longer PENDING rolls the whole
 *    transaction back with 409 PROPOSAL_ALREADY_DECIDED and nothing is written.
 *
 * Lock order matches the listing flow: proposals -> open revisions -> gyms (mirror sync).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { AMENITY_ICON_KEYS, SYSTEM_AMENITY_SEEDS, normalizeAmenityName } from './amenity-catalog';
import { syncFacilitiesMirrorTx } from './gym-amenity.service';
import { sendListingNotices, type ListingNotice } from './gym-listing-notify';
import { ListingError } from './gym-listing.schemas';
import { LISTING_EDITABLE_STATUSES, recordPartnerAudit, requireOwnedListingGym, type Db } from './gym-listing.helpers';

const TX = { maxWait: 10_000, timeout: 30_000 };

type Category = 'FACILITY' | 'TRAINING_ZONE' | 'SERVICE' | 'RECOVERY';

// ── small helpers ──────────────────────────────────────────────────────────────────────────────

/** Serialises every operation on the same normalised name (and, sorted, on several names without a lock cycle). */
async function lockNames(tx: Db, normalizedNames: readonly string[]) {
  for (const n of [...new Set(normalizedNames)].sort()) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`amenity-name:${n}`}))`);
  }
}

const idsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function slugOf(normalized: string): string {
  const base = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'amenity';
  return `custom-${base}-${randomUUID().slice(0, 8)}`;
}

function assertIconAllowed(iconKey: string) {
  if (!AMENITY_ICON_KEYS.includes(iconKey)) {
    throw new ListingError(422, 'ICON_NOT_ALLOWED', 'Biểu tượng không nằm trong danh sách cho phép.', { allowed: AMENITY_ICON_KEYS });
  }
}

/** Default icon of a category when the admin does not pick one: the icon of the first SYSTEM amenity of that category. */
function defaultIconFor(category: Category): string {
  return SYSTEM_AMENITY_SEEDS.find((s) => s.category === category)?.iconKey ?? SYSTEM_AMENITY_SEEDS[0].iconKey;
}

async function nextSortOrder(tx: Db, category: Category): Promise<number> {
  const max = await tx.amenity.aggregate({ where: { category }, _max: { sortOrder: true } });
  return (max._max.sortOrder ?? 0) + 10;
}

async function audit(
  tx: Db,
  e: { actorUserId: string; action: string; amenityId?: string | null; proposalId?: string | null; before?: unknown; after?: unknown; reason?: string | null },
) {
  await tx.amenityAuditLog.create({
    data: {
      actorUserId: e.actorUserId,
      action: e.action,
      amenityId: e.amenityId ?? null,
      proposalId: e.proposalId ?? null,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: e.reason ?? null,
    },
  });
}

export const amenityDto = (a: { id: string; slug: string; name: string; category: string; iconKey: string; sortOrder: number; source: string; status: string }) => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  category: a.category,
  iconKey: a.iconKey,
  sortOrder: a.sortOrder,
  source: a.source,
  status: a.status,
});

type ProposalRow = Awaited<ReturnType<typeof prisma.amenityProposal.findUniqueOrThrow>>;
export const proposalDto = (p: ProposalRow) => ({
  id: p.id,
  gymId: p.gymId,
  kind: p.kind,
  targetAmenityId: p.targetAmenityId,
  name: p.name,
  suggestedCategory: p.suggestedCategory,
  note: p.note,
  status: p.status,
  resultingAmenityId: p.resultingAmenityId,
  rejectReason: p.rejectReason,
  reviewedAt: p.reviewedAt,
  createdAt: p.createdAt,
});

/**
 * `INSERT INTO amenities ... ON CONFLICT DO NOTHING RETURNING id`, retried with a fresh slug if the (random) slug itself
 * collided. Returns the new id, or the catalogue row that already holds that name. The caller holds the name lock.
 */
async function insertAmenity(
  tx: Db,
  a: { name: string; normalized: string; category: Category; iconKey: string; sortOrder: number; createdFromProposalId: string | null },
): Promise<{ id: string } | { existing: { id: string; name: string; status: string } }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = randomUUID();
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO amenities (id, slug, name, name_normalized, category, icon_key, sort_order, source, status, created_from_proposal_id, created_at, updated_at)
      VALUES (${id}, ${slugOf(a.normalized)}, ${a.name}, ${a.normalized}, ${a.category}::"AmenityCategory", ${a.iconKey}, ${a.sortOrder},
              'CUSTOM'::"AmenitySource", 'ACTIVE'::"AmenityStatus", ${a.createdFromProposalId}, now(), now())
      ON CONFLICT DO NOTHING
      RETURNING id`);
    if (rows[0]) return { id: rows[0].id };
    const existing = await tx.amenity.findUnique({ where: { nameNormalized: a.normalized }, select: { id: true, name: true, status: true } });
    if (existing) return { existing };
    // neither: the random slug collided - try again with another
  }
  throw new ListingError(409, 'AMENITY_CONFLICT', 'Không tạo được tiện ích. Vui lòng thử lại.');
}

/** Re-syncs the legacy `gyms.facilities` mirror of every branch that has one of these amenities (gym id order). */
async function resyncMirrorsOf(tx: Db, amenityIds: readonly string[]): Promise<string[]> {
  if (amenityIds.length === 0) return [];
  const rows = await tx.gymAmenity.findMany({ where: { amenityId: { in: [...amenityIds] } }, select: { gymId: true }, distinct: ['gymId'], orderBy: { gymId: 'asc' } });
  for (const r of rows) await syncFacilitiesMirrorTx(tx, r.gymId);
  return rows.map((r) => r.gymId);
}

interface OpenRevisionRow {
  id: string;
  status: string;
  gym_id: string;
  owner_id: string;
  draft_version: number;
  payload: any;
  system_adjustments: any;
}

/** Locks (FOR UPDATE, id order) the open revisions whose payload mentions any of these ids in `field`. */
async function lockOpenRevisionsMentioning(
  tx: Db,
  field: 'amenityIds' | 'proposalIds',
  ids: readonly string[],
  statuses: readonly ('DRAFT' | 'PENDING')[] = ['DRAFT', 'PENDING'],
): Promise<OpenRevisionRow[]> {
  if (ids.length === 0) return [];
  return tx.$queryRaw<OpenRevisionRow[]>(Prisma.sql`
    SELECT r.id, r.status::text AS status, r.gym_id, g.owner_id, r.draft_version, r.payload, r.system_adjustments
      FROM gym_listing_revisions r
      JOIN gyms g ON g.id = r.gym_id
     WHERE r.status IN (${Prisma.raw(statuses.map((s) => `'${s}'`).join(','))})
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.payload -> ${Prisma.raw(`'${field}'`)}) e(v) WHERE e.v IN (${Prisma.join([...ids])}))
     ORDER BY r.id
       FOR UPDATE OF r`);
}

async function writeRevisionPayload(
  tx: Db,
  rev: OpenRevisionRow,
  payload: Record<string, unknown>,
  newAdjustments: Array<Record<string, unknown>>,
) {
  const previous = Array.isArray(rev.system_adjustments) ? rev.system_adjustments : [];
  await tx.gymListingRevision.update({
    where: { id: rev.id },
    data: {
      payload: payload as unknown as Prisma.InputJsonValue,
      systemAdjustments: [...previous, ...newAdjustments] as unknown as Prisma.InputJsonValue,
      ...(rev.status === 'DRAFT' ? { draftVersion: { increment: 1 } } : {}),
    },
  });
}

/** What an owner's proposal request answers (plan 12.3): the catalogue row it matched, or the (new / existing) proposal. */
export type ProposeResult =
  | { status: 200; body: { matchedAmenity: ReturnType<typeof amenityDto> } }
  | { status: 200 | 201; body: { proposal: ReturnType<typeof proposalDto>; kind: string; created: boolean } };

/**
 * The owner-proposal algorithm of plan 12.3, inside the caller's transaction (so a branch being created can propose in the same
 * transaction as the branch). Runs under the name's advisory lock; a duplicate answers with a SELECT, never a 500.
 * The caller has already established that `gym` belongs to `ownerId` and that proposing for it is allowed.
 */
export async function proposeTx(
  tx: Db,
  p: { ownerId: string; actorUserId: string; gym: { id: string; ownerId: string; brandId?: string | null }; name: string; suggestedCategory: Category; note?: string },
): Promise<ProposeResult> {
  const name = p.name.trim();
  const normalized = normalizeAmenityName(name);
  if (normalized.length < 2) throw new ListingError(422, 'NAME_INVALID', 'Tên tiện ích không hợp lệ.');
  await lockNames(tx, [normalized]);
  const existing = await tx.amenity.findUnique({ where: { nameNormalized: normalized } });
  if (existing && existing.status === 'ACTIVE') {
    return { status: 200 as const, body: { matchedAmenity: amenityDto(existing) } };
  }
  const kind = existing ? 'REENABLE' : 'NEW';
  const id = randomUUID();
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO amenity_proposals (id, owner_user_id, gym_id, kind, target_amenity_id, name, name_normalized, suggested_category, note, status, created_at, updated_at)
    VALUES (${id}, ${p.ownerId}, ${p.gym.id}, ${kind}::"AmenityProposalKind", ${existing?.id ?? null}, ${name}, ${normalized},
            ${p.suggestedCategory}::"AmenityCategory", ${p.note ?? null}, 'PENDING'::"AmenityProposalStatus", now(), now())
    ON CONFLICT (owner_user_id, gym_id, name_normalized) WHERE status = 'PENDING' DO NOTHING
    RETURNING id`);
  if (inserted[0]) {
    const proposal = await tx.amenityProposal.findUniqueOrThrow({ where: { id: inserted[0].id } });
    await recordPartnerAudit(tx, p.gym, {
      actorUserId: p.actorUserId,
      action: 'AMENITY_PROPOSED',
      metadata: { proposalId: proposal.id, name, kind, targetAmenityId: existing?.id ?? null },
    });
    await audit(tx, { actorUserId: p.actorUserId, action: 'AMENITY_PROPOSED', amenityId: existing?.id ?? null, proposalId: proposal.id, after: { name, kind, gymId: p.gym.id } });
    // plan 12.3: a REENABLE proposal answers 200 { proposal, kind: 'REENABLE' }; a brand-new NEW proposal is a 201
    return { status: (kind === 'REENABLE' ? 200 : 201) as 200 | 201, body: { proposal: proposalDto(proposal), kind, created: true } };
  }
  // Nothing inserted: this owner already has a PENDING proposal with that name for THIS branch - return it (another branch of the
  // same owner gets its own proposal; the admin queue groups them by kind + name + target).
  const mine = await tx.amenityProposal.findFirstOrThrow({ where: { ownerUserId: p.ownerId, gymId: p.gym.id, nameNormalized: normalized, status: 'PENDING' } });
  return { status: 200 as const, body: { proposal: proposalDto(mine), kind: mine.kind, created: false } };
}

// ═══ owner side ════════════════════════════════════════════════════════════════════════════════

export const ownerAmenityService = {
  /** GET /owner/amenities - the ACTIVE catalogue and the caller's own proposals. */
  async catalog(ownerId: string) {
    const [amenities, proposals] = await Promise.all([
      prisma.amenity.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.amenityProposal.findMany({ where: { ownerUserId: ownerId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { amenities: amenities.map(amenityDto), proposals: proposals.map(proposalDto) };
  },

  /**
   * POST /owner/amenities/proposals (plan §12.3 "Khi Owner gửi đề xuất tên X"):
   *   X is an ACTIVE amenity            -> { matchedAmenity }, nothing created
   *   X is a DISABLED amenity           -> a REENABLE proposal of this owner (or the one already pending)
   *   X is this owner's PENDING one     -> that proposal again (idempotent)
   *   X is another owner's PENDING one  -> a SEPARATE proposal for this owner
   * The checks and the insert run under the name's advisory lock; a duplicate answers with a SELECT, never a 500.
   */
  async propose(ownerId: string, actorUserId: string, body: { gymId: string; name: string; suggestedCategory: Category; note?: string }) {
    const gym = await requireOwnedListingGym(prisma, body.gymId, ownerId, { allowDraft: true });
    return prisma.$transaction((tx) => proposeTx(tx, { ownerId, actorUserId, gym, name: body.name, suggestedCategory: body.suggestedCategory, note: body.note }), TX);
  },

  /** PATCH /owner/amenities/proposals/:id - only the caller's own PENDING proposal; the name check runs again. */
  async update(ownerId: string, proposalId: string, body: { name?: string; suggestedCategory?: Category; note?: string | null }) {
    return prisma.$transaction(async (tx) => {
      const peek = await tx.amenityProposal.findFirst({ where: { id: proposalId, ownerUserId: ownerId } });
      if (!peek) throw new ListingError(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất');
      const newName = (body.name ?? peek.name).trim();
      const normalized = normalizeAmenityName(newName);
      if (normalized.length < 2) throw new ListingError(422, 'NAME_INVALID', 'Tên tiện ích không hợp lệ.');
      await lockNames(tx, [peek.nameNormalized, normalized]);
      const locked = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM amenity_proposals WHERE id = ${proposalId} FOR UPDATE`);
      if (locked[0]?.status !== 'PENDING') {
        throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Đề xuất đã được xử lý nên không thể thay đổi.');
      }

      let kind = peek.kind;
      let target: string | null = peek.targetAmenityId;
      if (normalized !== peek.nameNormalized) {
        const amenity = await tx.amenity.findUnique({ where: { nameNormalized: normalized } });
        if (amenity?.status === 'ACTIVE') {
          throw new ListingError(409, 'AMENITY_ALREADY_EXISTS', 'Tiện ích này đã có trong danh mục.', { matchedAmenity: amenityDto(amenity) });
        }
        const clash = await tx.amenityProposal.findFirst({ where: { ownerUserId: ownerId, gymId: peek.gymId, nameNormalized: normalized, status: 'PENDING', id: { not: proposalId } } });
        if (clash) throw new ListingError(409, 'PROPOSAL_NAME_TAKEN', 'Chi nhánh này đã có một đề xuất khác với tên này.', { proposal: proposalDto(clash) });
        kind = amenity ? 'REENABLE' : 'NEW';
        target = amenity?.id ?? null;
      }
      const res = await tx.amenityProposal.updateMany({
        where: { id: proposalId, ownerUserId: ownerId, status: 'PENDING' },
        data: {
          name: newName,
          nameNormalized: normalized,
          kind,
          targetAmenityId: target,
          ...(body.suggestedCategory ? { suggestedCategory: body.suggestedCategory } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
      });
      if (res.count === 0) throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Đề xuất đã được xử lý nên không thể thay đổi.');
      return { proposal: proposalDto(await tx.amenityProposal.findUniqueOrThrow({ where: { id: proposalId } })) };
    }, TX);
  },

  /**
   * DELETE /owner/amenities/proposals/:id - cancels the caller's own PENDING proposal. Open DRAFTs that list it lose it
   * (draft_version + 1, with a system adjustment); one sitting in a PENDING revision blocks the cancel (withdraw first).
   */
  async cancel(ownerId: string, actorUserId: string, proposalId: string) {
    return prisma.$transaction(async (tx) => {
      const peek = await tx.amenityProposal.findFirst({ where: { id: proposalId, ownerUserId: ownerId } });
      if (!peek) throw new ListingError(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất');
      await lockNames(tx, [peek.nameNormalized]);
      const locked = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM amenity_proposals WHERE id = ${proposalId} FOR UPDATE`);
      if (locked[0]?.status !== 'PENDING') {
        throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Đề xuất đã được xử lý nên không thể huỷ.');
      }
      const revs = await lockOpenRevisionsMentioning(tx, 'proposalIds', [proposalId]);
      if (revs.some((r) => r.status === 'PENDING')) {
        throw new ListingError(409, 'PROPOSAL_IN_REVIEW', 'Đề xuất đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi huỷ đề xuất.');
      }
      const res = await tx.amenityProposal.updateMany({ where: { id: proposalId, ownerUserId: ownerId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (res.count === 0) throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Đề xuất đã được xử lý nên không thể huỷ.');
      for (const rev of revs) {
        const payload = { ...rev.payload, proposalIds: idsOf(rev.payload?.proposalIds).filter((id) => id !== proposalId) };
        await writeRevisionPayload(tx, rev, payload, [{ type: 'PROPOSAL_CANCELLED_REMOVED', proposalId, name: peek.name }]);
      }
      await audit(tx, { actorUserId, action: 'AMENITY_PROPOSAL_CANCELLED', proposalId, before: { name: peek.name, status: 'PENDING' }, after: { status: 'CANCELLED' } });
      return { cancelled: true, proposalId };
    }, TX);
  },
};

// ═══ admin: catalogue ══════════════════════════════════════════════════════════════════════════

export const adminAmenityService = {
  /** GET /admin/amenities?status=&category=&q= */
  async list(query: { status?: string; category?: string; q?: string }) {
    const where: Prisma.AmenityWhereInput = {};
    if (query.status === 'ACTIVE' || query.status === 'DISABLED') where.status = query.status;
    if (query.category && ['FACILITY', 'TRAINING_ZONE', 'SERVICE', 'RECOVERY'].includes(query.category)) where.category = query.category as Category;
    const q = (query.q ?? '').trim();
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { nameNormalized: { contains: normalizeAmenityName(q) } }, { slug: { contains: q, mode: 'insensitive' } }];
    const [rows, pending] = await Promise.all([
      prisma.amenity.findMany({ where, include: { _count: { select: { gyms: true } } }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.amenityProposal.count({ where: { status: 'PENDING' } }),
    ]);
    return {
      pendingProposalCount: pending,
      amenities: rows.map((a) => ({ ...amenityDto(a), gymCount: a._count.gyms, createdFromProposalId: a.createdFromProposalId, updatedAt: a.updatedAt })),
      iconKeys: AMENITY_ICON_KEYS,
    };
  },

  /** POST /admin/amenities - a SYSTEM-level catalogue row created by an admin (source CUSTOM, status ACTIVE). */
  async create(adminId: string, body: { name: string; category: Category; iconKey: string; sortOrder?: number }) {
    assertIconAllowed(body.iconKey);
    const name = body.name.trim();
    const normalized = normalizeAmenityName(name);
    if (normalized.length < 2) throw new ListingError(422, 'NAME_INVALID', 'Tên tiện ích không hợp lệ.');
    return prisma.$transaction(async (tx) => {
      await lockNames(tx, [normalized]);
      const sortOrder = body.sortOrder ?? (await nextSortOrder(tx, body.category));
      const res = await insertAmenity(tx, { name, normalized, category: body.category, iconKey: body.iconKey, sortOrder, createdFromProposalId: null });
      if ('existing' in res) {
        throw new ListingError(409, 'AMENITY_NAME_TAKEN', 'Đã có tiện ích với tên này trong danh mục.', { amenity: res.existing });
      }
      const created = await tx.amenity.findUniqueOrThrow({ where: { id: res.id } });
      await audit(tx, { actorUserId: adminId, action: 'AMENITY_CREATED', amenityId: created.id, after: amenityDto(created) });
      return { amenity: amenityDto(created) };
    }, TX);
  },

  /**
   * PATCH /admin/amenities/:id - rename / icon (allowlist) / category / sortOrder / enable / disable.
   * Disabling removes the amenity from every open DRAFT (draft_version + 1, system adjustment), keeps it in PENDING
   * revisions (the admin who reviews them is told), leaves `gym_amenities` rows alone and re-syncs the mirror of every
   * branch that has it. Enabling re-syncs the same branches.
   */
  async update(adminId: string, amenityId: string, body: { name?: string; category?: Category; iconKey?: string; sortOrder?: number; status?: 'ACTIVE' | 'DISABLED'; reason?: string }) {
    if (body.iconKey !== undefined) assertIconAllowed(body.iconKey);
    const out = await prisma.$transaction(async (tx) => {
      const peek = await tx.amenity.findUnique({ where: { id: amenityId } });
      if (!peek) throw new ListingError(404, 'AMENITY_NOT_FOUND', 'Không tìm thấy tiện ích');
      let normalized = peek.nameNormalized;
      let name = peek.name;
      if (body.name !== undefined) {
        name = body.name.trim();
        normalized = normalizeAmenityName(name);
        if (normalized.length < 2) throw new ListingError(422, 'NAME_INVALID', 'Tên tiện ích không hợp lệ.');
      }
      await lockNames(tx, [peek.nameNormalized, normalized]);
      const before = await tx.amenity.findUniqueOrThrow({ where: { id: amenityId } });
      if (normalized !== before.nameNormalized) {
        const clash = await tx.amenity.findFirst({ where: { nameNormalized: normalized, id: { not: amenityId } }, select: { id: true, name: true, status: true } });
        if (clash) throw new ListingError(409, 'AMENITY_NAME_TAKEN', 'Đã có tiện ích với tên này trong danh mục.', { amenity: clash });
      }

      // only what really differs is written (and audited): resending the current values is a no-op
      const fieldData: Prisma.AmenityUpdateInput = {};
      if (body.name !== undefined && (name !== before.name || normalized !== before.nameNormalized)) {
        fieldData.name = name;
        fieldData.nameNormalized = normalized;
      }
      if (body.category !== undefined && body.category !== before.category) fieldData.category = body.category;
      if (body.iconKey !== undefined && body.iconKey !== before.iconKey) fieldData.iconKey = body.iconKey;
      if (body.sortOrder !== undefined && body.sortOrder !== before.sortOrder) fieldData.sortOrder = body.sortOrder;
      const statusChange = body.status !== undefined && body.status !== before.status ? body.status : null;
      const fieldsChanged = Object.keys(fieldData).length > 0;
      if (!fieldsChanged && !statusChange) return { amenity: amenityDto(before), notices: [] as ListingNotice[], changed: false };

      const updated = await tx.amenity.update({ where: { id: amenityId }, data: { ...fieldData, ...(statusChange ? { status: statusChange } : {}) } });
      const notices: ListingNotice[] = [];

      if (fieldsChanged) {
        await audit(tx, { actorUserId: adminId, action: 'AMENITY_UPDATED', amenityId, before: amenityDto(before), after: amenityDto(updated), reason: body.reason });
      }
      if (statusChange === 'DISABLED') {
        // every open DRAFT loses it; PENDING revisions are kept (the review screen flags "has a disabled amenity")
        const drafts = await lockOpenRevisionsMentioning(tx, 'amenityIds', [amenityId], ['DRAFT']);
        for (const rev of drafts) {
          const payload = { ...rev.payload, amenityIds: idsOf(rev.payload?.amenityIds).filter((id) => id !== amenityId) };
          await writeRevisionPayload(tx, rev, payload, [{ type: 'AMENITY_DISABLED_REMOVED', amenityId, name: updated.name }]);
          notices.push({
            userId: rev.owner_id,
            gymId: rev.gym_id,
            eventType: 'GYM_LISTING_INVALIDATED',
            text: `Tiện ích "${updated.name}" đã ngừng trong danh mục và được bỏ khỏi bản nháp tin đăng của bạn.`,
          });
        }
        const gyms = await resyncMirrorsOf(tx, [amenityId]);
        await audit(tx, {
          actorUserId: adminId,
          action: 'AMENITY_DISABLED',
          amenityId,
          before: { status: before.status },
          after: { status: 'DISABLED', draftsEdited: drafts.length, gymsResynced: gyms.length },
          reason: body.reason,
        });
      } else if (statusChange === 'ACTIVE') {
        const gyms = await resyncMirrorsOf(tx, [amenityId]);
        await audit(tx, { actorUserId: adminId, action: 'AMENITY_ENABLED', amenityId, before: { status: before.status }, after: { status: 'ACTIVE', gymsResynced: gyms.length }, reason: body.reason });
      }
      return { amenity: amenityDto(updated), notices, changed: true };
    }, TX);
    await sendListingNotices(out.notices);
    return { amenity: out.amenity, changed: out.changed };
  },

  /** GET /admin/amenities/:id/history */
  async history(amenityId: string) {
    const amenity = await prisma.amenity.findUnique({ where: { id: amenityId } });
    if (!amenity) throw new ListingError(404, 'AMENITY_NOT_FOUND', 'Không tìm thấy tiện ích');
    const rows = await prisma.amenityAuditLog.findMany({ where: { amenityId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { amenity: amenityDto(amenity), history: rows };
  },

  // ── proposals ──────────────────────────────────────────────────────────────────────────────

  /** GET /admin/amenities/proposals?status= - grouped by (kind, name_normalized, target): "3 chủ gym cùng đề xuất". */
  async listProposals(query: { status?: string }) {
    const status = (query.status ?? 'PENDING').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED', 'MERGED', 'CANCELLED'].includes(status)) throw new ListingError(400, 'VALIDATION_FAILED', 'status không hợp lệ');
    const rows = await prisma.amenityProposal.findMany({ where: { status: status as ProposalRow['status'] }, orderBy: { createdAt: 'asc' }, take: 1000 });
    const gyms = await prisma.gym.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.gymId))] } }, select: { id: true, name: true, approvedName: true } });
    const gymName = new Map(gyms.map((g) => [g.id, g.approvedName ?? g.name]));
    const norms = [...new Set(rows.map((r) => r.nameNormalized))];
    const catalogue = norms.length ? await prisma.amenity.findMany({ where: { nameNormalized: { in: norms } } }) : [];
    const byNorm = new Map(catalogue.map((a) => [a.nameNormalized, a]));

    const groups = new Map<string, ProposalRow[]>();
    for (const r of rows) {
      const key = `${r.kind}|${r.nameNormalized}|${r.targetAmenityId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return {
      groups: [...groups.entries()].map(([key, members]) => {
        const first = members[0];
        const existing = byNorm.get(first.nameNormalized);
        const categories = members.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.suggestedCategory]: (acc[m.suggestedCategory] ?? 0) + 1 }), {});
        return {
          key,
          kind: first.kind,
          nameNormalized: first.nameNormalized,
          name: first.name,
          targetAmenityId: first.targetAmenityId,
          // The catalogue row that already has this name, if any: tells the admin "merge into X" / "X is disabled" up front.
          existingAmenity: existing ? { id: existing.id, name: existing.name, status: existing.status } : null,
          ownerCount: new Set(members.map((m) => m.ownerUserId)).size,
          suggestedCategories: categories,
          proposalIds: members.map((m) => m.id),
          proposals: members.map((m) => ({ ...proposalDto(m), ownerUserId: m.ownerUserId, gymName: gymName.get(m.gymId) ?? null })),
        };
      }),
    };
  },

  /** POST /admin/amenities/proposals/approve | reject | merge - one group, one transaction (plan §12.3). */
  async decide(
    adminId: string,
    action: 'approve' | 'reject' | 'merge',
    body: {
      proposalIds: string[];
      category?: Category;
      iconKey?: string;
      sortOrder?: number;
      name?: string;
      reenableAndMerge?: boolean;
      reason?: string;
      targetAmenityId?: string;
    },
  ) {
    const proposalIds = [...new Set(body.proposalIds)];
    if (body.iconKey !== undefined) assertIconAllowed(body.iconKey);

    const out = await prisma.$transaction(async (tx) => {
      // 1. the advisory lock(s): every name touched, sorted. (Reading the names first is safe: names never change on a PENDING row
      //    except through the owner's own PATCH, which takes the same lock, and the rows are re-read under FOR UPDATE below.)
      const peek = await tx.amenityProposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, nameNormalized: true } });
      if (peek.length !== proposalIds.length) throw new ListingError(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất');
      const lockKeys = peek.map((p) => p.nameNormalized);
      let mergeTarget: { id: string; name: string; nameNormalized: string; status: string } | null = null;
      if (action === 'merge') {
        mergeTarget = await tx.amenity.findUnique({ where: { id: body.targetAmenityId! }, select: { id: true, name: true, nameNormalized: true, status: true } });
        if (!mergeTarget) throw new ListingError(404, 'AMENITY_NOT_FOUND', 'Không tìm thấy tiện ích đích');
        lockKeys.push(mergeTarget.nameNormalized);
      }
      await lockNames(tx, lockKeys);

      // 2. the proposals, FOR UPDATE in id order; any that is no longer PENDING rolls everything back
      const rows = await tx.$queryRaw<
        { id: string; status: string; kind: string; name: string; name_normalized: string; target_amenity_id: string | null; owner_user_id: string; gym_id: string; suggested_category: string }[]
      >(Prisma.sql`
        SELECT id, status::text AS status, kind::text AS kind, name, name_normalized, target_amenity_id, owner_user_id, gym_id, suggested_category::text AS suggested_category
          FROM amenity_proposals WHERE id IN (${Prisma.join(proposalIds)}) ORDER BY id FOR UPDATE`);
      if (rows.length !== proposalIds.length) throw new ListingError(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất');
      if (rows.some((r) => r.status !== 'PENDING')) {
        throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Có đề xuất đã được xử lý bởi người khác. Hãy tải lại danh sách.');
      }

      // 3. the decision on the catalogue
      let outcome: 'APPROVED' | 'MERGED' | 'REJECTED';
      let resultingAmenityId: string | null = null;
      let rejectReason: string | null = null;
      const reenabled: string[] = [];
      let resultName: string | null = null;

      const reenable = async (id: string) => {
        await tx.$executeRaw(Prisma.sql`UPDATE amenities SET status = 'ACTIVE'::"AmenityStatus", updated_at = now() WHERE id = ${id}`);
        reenabled.push(id);
      };

      if (action === 'reject') {
        outcome = 'REJECTED';
        rejectReason = body.reason ?? null;
      } else if (action === 'merge') {
        const target = mergeTarget!;
        if (target.status !== 'ACTIVE') {
          if (!body.reenableAndMerge) {
            throw new ListingError(409, 'AMENITY_EXISTS_DISABLED', 'Tiện ích đích đang bị tắt. Hãy chọn "bật lại và gộp" hoặc từ chối.', { amenity: { id: target.id, name: target.name, status: target.status } });
          }
          await reenable(target.id);
        }
        outcome = 'MERGED';
        resultingAmenityId = target.id;
        resultName = target.name;
      } else {
        const first = rows[0];
        if (rows.some((r) => r.kind !== first.kind || r.name_normalized !== first.name_normalized || r.target_amenity_id !== first.target_amenity_id)) {
          throw new ListingError(422, 'PROPOSAL_GROUP_MISMATCH', 'Các đề xuất được duyệt cùng lúc phải thuộc cùng một nhóm (cùng loại, cùng tên, cùng tiện ích đích).');
        }
        if (first.kind === 'REENABLE') {
          // REENABLE only ever UPDATEs. An amenity that is already ACTIVE (another admin switched it on) is simply a no-op.
          const target = await tx.amenity.findUnique({ where: { id: first.target_amenity_id! }, select: { id: true, name: true, status: true } });
          if (!target) throw new ListingError(404, 'AMENITY_NOT_FOUND', 'Không tìm thấy tiện ích cần bật lại');
          if (target.status !== 'ACTIVE') await reenable(target.id);
          outcome = 'APPROVED';
          resultingAmenityId = target.id;
          resultName = target.name;
        } else {
          const name = (body.name ?? first.name).trim();
          const normalized = normalizeAmenityName(name);
          if (normalized !== first.name_normalized) {
            throw new ListingError(422, 'NAME_MISMATCH', 'Tên hiển thị phải trùng với tên mà chủ gym đã đề xuất (sau khi chuẩn hoá).');
          }
          const category = body.category ?? (first.suggested_category as Category);
          const iconKey = body.iconKey ?? defaultIconFor(category);
          const sortOrder = body.sortOrder ?? (await nextSortOrder(tx, category));
          const res = await insertAmenity(tx, { name, normalized, category, iconKey, sortOrder, createdFromProposalId: first.id });
          if ('id' in res) {
            outcome = 'APPROVED';
            resultingAmenityId = res.id;
            resultName = name;
          } else if (res.existing.status === 'ACTIVE') {
            // Somebody created the same name meanwhile (e.g. an admin directly): join it, never duplicate.
            outcome = 'MERGED';
            resultingAmenityId = res.existing.id;
            resultName = res.existing.name;
          } else {
            if (!body.reenableAndMerge) {
              throw new ListingError(409, 'AMENITY_EXISTS_DISABLED', 'Đã có tiện ích cùng tên nhưng đang bị tắt. Hãy chọn "bật lại và gộp" hoặc từ chối.', { amenity: res.existing });
            }
            await reenable(res.existing.id);
            outcome = 'MERGED';
            resultingAmenityId = res.existing.id;
            resultName = res.existing.name;
          }
        }
      }

      const upd = await tx.amenityProposal.updateMany({
        where: { id: { in: proposalIds }, status: 'PENDING' },
        data: { status: outcome, resultingAmenityId, reviewedBy: adminId, reviewedAt: new Date(), rejectReason },
      });
      if (upd.count !== proposalIds.length) throw new ListingError(409, 'PROPOSAL_ALREADY_DECIDED', 'Có đề xuất đã được xử lý bởi người khác. Hãy tải lại danh sách.');

      // 4. apply the result to the open revisions that point at these proposals
      const revs = await lockOpenRevisionsMentioning(tx, 'proposalIds', proposalIds);
      const decided = new Set(proposalIds);
      const nameOf = new Map(rows.map((r) => [r.id, r.name]));
      for (const rev of revs) {
        const mine = idsOf(rev.payload?.proposalIds).filter((id) => decided.has(id));
        let amenityIds = idsOf(rev.payload?.amenityIds);
        const adjustments: Array<Record<string, unknown>> = [];
        for (const pid of mine) {
          if (resultingAmenityId) {
            if (!amenityIds.includes(resultingAmenityId)) amenityIds = [...amenityIds, resultingAmenityId];
            adjustments.push({ type: outcome === 'MERGED' ? 'PROPOSAL_MERGED' : 'PROPOSAL_APPROVED', proposalId: pid, name: nameOf.get(pid), amenityId: resultingAmenityId });
          } else {
            adjustments.push({ type: 'PROPOSAL_REJECTED_REMOVED', proposalId: pid, name: nameOf.get(pid) });
          }
        }
        const payload = { ...rev.payload, amenityIds, proposalIds: idsOf(rev.payload?.proposalIds).filter((id) => !decided.has(id)) };
        await writeRevisionPayload(tx, rev, payload, adjustments);
      }

      // 4b. Branches with NO published listing yet (the application's DRAFT branch, a quick-created PENDING_REVIEW one): there is no
      //     revision to patch - the branch's own gym_amenities IS the selection (Listing Management B3). APPROVED / MERGED adds
      //     the resulting amenity to those branches; REJECTED needs nothing (a proposal was never part of gym_amenities, so the
      //     branch simply loses the pending entry). Revision-flow branches (APPROVED / SUSPENDED) are untouched here.
      const unpublished = resultingAmenityId
        ? await tx.gym.findMany({
            where: { id: { in: [...new Set(rows.map((r) => r.gym_id))] }, status: { notIn: [...LISTING_EDITABLE_STATUSES] } },
            select: { id: true },
            orderBy: { id: 'asc' },
          })
        : [];
      for (const g of unpublished) {
        await tx.gymAmenity.createMany({ data: [{ gymId: g.id, amenityId: resultingAmenityId! }], skipDuplicates: true });
        await syncFacilitiesMirrorTx(tx, g.id);
      }

      // 5. mirrors of the branches that had a re-enabled amenity, then the audit rows
      const gymsResynced = await resyncMirrorsOf(tx, reenabled);
      const partnerAction = outcome === 'APPROVED' ? 'AMENITY_PROPOSAL_APPROVED' : outcome === 'MERGED' ? 'AMENITY_PROPOSAL_MERGED' : 'AMENITY_PROPOSAL_REJECTED';
      await audit(tx, {
        actorUserId: adminId,
        action: partnerAction,
        amenityId: resultingAmenityId,
        proposalId: rows[0].id,
        before: { proposalIds, status: 'PENDING' },
        after: { proposalIds, status: outcome, resultingAmenityId, reenabled, revisionsUpdated: revs.length, gymsResynced: gymsResynced.length, unpublishedBranchesUpdated: unpublished.length },
        reason: rejectReason,
      });
      const gymRows = await tx.gym.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.gym_id))] } }, select: { id: true, ownerId: true, brandId: true } });
      const gymById = new Map(gymRows.map((g) => [g.id, g]));
      const notices: ListingNotice[] = [];
      for (const r of rows) {
        const g = gymById.get(r.gym_id);
        if (!g) continue;
        await recordPartnerAudit(tx, { id: g.id, ownerId: r.owner_user_id, brandId: g.brandId }, {
          actorUserId: adminId,
          action: partnerAction,
          reason: rejectReason,
          metadata: { proposalId: r.id, name: r.name, resultingAmenityId },
        });
        notices.push({
          userId: r.owner_user_id,
          gymId: r.gym_id,
          eventType: 'GYM_AMENITY_PROPOSAL_REVIEWED',
          text:
            outcome === 'REJECTED'
              ? `Đề xuất tiện ích "${r.name}" bị từ chối${rejectReason ? `: ${rejectReason}` : '.'}`
              : outcome === 'MERGED'
                ? `Đề xuất tiện ích "${r.name}" đã được gộp vào tiện ích có sẵn "${resultName}".`
                : `Đề xuất tiện ích "${r.name}" đã được duyệt.`,
        });
      }
      return {
        outcome,
        resultingAmenityId,
        reenabled,
        revisionsUpdated: revs.map((r) => r.id),
        decided: rows.map((r) => ({ proposalId: r.id, status: outcome, resultingAmenityId })),
        notices,
        amenity: resultingAmenityId ? await tx.amenity.findUnique({ where: { id: resultingAmenityId } }) : null,
      };
    }, TX);

    await sendListingNotices(out.notices);
    return {
      outcome: out.outcome,
      amenity: out.amenity ? amenityDto(out.amenity) : null,
      reenabledAmenityIds: out.reenabled,
      revisionsUpdated: out.revisionsUpdated,
      decided: out.decided,
    };
  },
};
