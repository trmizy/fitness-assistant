/**
 * BACKEND INTEGRATION - Listing Management B1, the constraints the migration puts in the database itself (the last line
 * of defence behind the service code that B2 will add): immutable closed revisions, one open revision per gym, the
 * amenity-proposal CHECK + partial unique index, one PUBLISHED cover per gym, no duplicate staged/published file hash,
 * the catalogue's unique slug / normalised name.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { cleanupRegistry, makeGym, makeOwner, makePhoto, newRegistry } from './listing-b1.test-helpers';

const reg = newRegistry();
let prisma: typeof import('../repositories/prisma').prisma;
let gymId: string;
let ownerId: string;
let brandId: string;

test.before(async () => {
  if (skip) return;
  prisma = (await import('../repositories/prisma')).prisma;
  const owner = await makeOwner(reg);
  ownerId = owner.ownerId;
  brandId = owner.brandId;
  gymId = await makeGym(reg, { ownerId, brandId: owner.brandId });
});

test.after(async () => {
  if (skip) return;
  await prisma.amenityProposal.deleteMany({ where: { gymId } });
  // Closed revisions are immutable by design (and refuse to be deleted along with their gym), so test cleanup is the one
  // place that switches the guard off - inside ONE transaction, so it is back on the moment this block ends.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "gym_listing_revisions" DISABLE TRIGGER "gym_listing_revisions_immutable"');
    await tx.gymListingRevision.deleteMany({ where: { gymId: { in: reg.gyms } } });
    await tx.$executeRawUnsafe('ALTER TABLE "gym_listing_revisions" ENABLE TRIGGER "gym_listing_revisions_immutable"');
  });
  await cleanupRegistry(reg);
  await prisma.$disconnect();
});

test('gym_listing_revisions: at most ONE open (DRAFT or PENDING) revision per gym', async () => {
  const own = await makeGym(reg, { ownerId, brandId: (await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).brandId! });
  const create = (status: string) =>
    prisma.gymListingRevision.create({ data: { gymId: own, status: status as any, baseVersion: 1, payload: {} } });
  const draft = await create('DRAFT');
  await assert.rejects(() => create('DRAFT'), /gym_listing_revisions_one_open_per_gym|Unique constraint/);
  await assert.rejects(() => create('PENDING'), /gym_listing_revisions_one_open_per_gym|Unique constraint/);
  // Closing it frees the slot (DRAFT -> WITHDRAWN is the one transition a draft may make besides submit).
  await prisma.gymListingRevision.update({ where: { id: draft.id }, data: { status: 'WITHDRAWN' } });
  const next = await create('DRAFT');
  await prisma.gymListingRevision.delete({ where: { id: next.id } }); // an OPEN row may be deleted
});

for (const closed of ['APPROVED', 'REJECTED', 'WITHDRAWN', 'CHANGES_REQUESTED', 'STALE']) {
  test(`gym_listing_revisions: a ${closed} revision is immutable - UPDATE of any real column and DELETE are refused`, async () => {
    const owner = await makeOwner(reg);
    const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
    const r = await prisma.gymListingRevision.create({ data: { gymId: g, status: closed as any, baseVersion: 1, payload: { a: 1 } } });
    await assert.rejects(() => prisma.gymListingRevision.update({ where: { id: r.id }, data: { payload: { a: 2 } } }), /is immutable/);
    await assert.rejects(() => prisma.gymListingRevision.update({ where: { id: r.id }, data: { reviewNote: 'late edit' } }), /is immutable/);
    await assert.rejects(() => prisma.gymListingRevision.update({ where: { id: r.id }, data: { status: 'DRAFT' } }), /is immutable/);
    await assert.rejects(() => prisma.gymListingRevision.delete({ where: { id: r.id } }), /cannot be deleted/);
    // The one exception: system_adjustments (a housekeeping job notes what it did).
    const noted = await prisma.gymListingRevision.update({ where: { id: r.id }, data: { systemAdjustments: [{ type: 'NOTE' }] } });
    assert.deepEqual(noted.systemAdjustments, [{ type: 'NOTE' }]);
    assert.deepEqual((await prisma.gymListingRevision.findUniqueOrThrow({ where: { id: r.id } })).payload, { a: 1 });
  });
}

test('gym_listing_revisions: the transition that CLOSES a revision is allowed (PENDING -> APPROVED), and the row then freezes', async () => {
  const owner = await makeOwner(reg);
  const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const r = await prisma.gymListingRevision.create({ data: { gymId: g, status: 'PENDING', baseVersion: 1, payload: {} } });
  const approved = await prisma.gymListingRevision.update({ where: { id: r.id }, data: { status: 'APPROVED', reviewedBy: 'admin', reviewedAt: new Date() } });
  assert.equal(approved.status, 'APPROVED');
  await assert.rejects(() => prisma.gymListingRevision.update({ where: { id: r.id }, data: { reviewedBy: 'someone else' } }), /is immutable/);
});

test('amenity_proposals: CHECK - APPROVED/MERGED need resulting_amenity_id, REJECTED/CANCELLED must not have one', async () => {
  const wifi = await prisma.amenity.findUniqueOrThrow({ where: { slug: 'WIFI' } });
  const base = (n: string) => ({ ownerUserId: ownerId, gymId, name: `Phòng ${n}`, nameNormalized: `phong ${n} ${randomUUID()}`, suggestedCategory: 'SERVICE' as const });
  for (const status of ['APPROVED', 'MERGED'] as const) {
    await assert.rejects(() => prisma.amenityProposal.create({ data: { ...base(status), status } }), /amenity_proposals_resulting_amenity_chk/);
    const ok = await prisma.amenityProposal.create({ data: { ...base(status), status, resultingAmenityId: wifi.id } });
    assert.equal(ok.resultingAmenityId, wifi.id);
  }
  for (const status of ['REJECTED', 'CANCELLED'] as const) {
    await assert.rejects(() => prisma.amenityProposal.create({ data: { ...base(status), status, resultingAmenityId: wifi.id } }), /amenity_proposals_resulting_amenity_chk/);
    await prisma.amenityProposal.create({ data: { ...base(status), status } });
  }
  const pending = await prisma.amenityProposal.create({ data: base('pending') });
  assert.equal(pending.status, 'PENDING');
  await assert.rejects(() => prisma.amenityProposal.update({ where: { id: pending.id }, data: { status: 'APPROVED' } }), /amenity_proposals_resulting_amenity_chk/);
});

test('amenity_proposals: one PENDING proposal per (owner, branch, normalised name); other owners, other branches of the same owner and decided rows do not conflict', async () => {
  const name = `boxing-${randomUUID()}`;
  const data = (owner: string, status: 'PENDING' | 'CANCELLED' = 'PENDING') => ({
    ownerUserId: owner, gymId, name: 'Phòng boxing', nameNormalized: name, suggestedCategory: 'TRAINING_ZONE' as const, status,
  });
  await prisma.amenityProposal.create({ data: data(ownerId) });
  await assert.rejects(() => prisma.amenityProposal.create({ data: data(ownerId) }), /amenity_proposals_one_pending_per_owner_gym_name|Unique constraint/);
  await prisma.amenityProposal.create({ data: data(`other-${randomUUID()}`) }); // another owner: its own proposal
  await prisma.amenityProposal.create({ data: data(ownerId, 'CANCELLED') }); // a decided row never conflicts
  const gym2 = await makeGym(reg, { ownerId, brandId });
  // (the proposals of gym2 are removed with the gym by the registry cleanup)
  await prisma.amenityProposal.create({ data: { ...data(ownerId), gymId: gym2 } }); // the same owner, ANOTHER branch: its own proposal
  await assert.rejects(() => prisma.amenityProposal.create({ data: { ...data(ownerId), gymId: gym2 } }), /amenity_proposals_one_pending_per_owner_gym_name|Unique constraint/);
});

test('amenities: slug and normalised name are unique', async () => {
  const slug = `u-${randomUUID().slice(0, 8)}`;
  const nn = `unique name ${randomUUID()}`;
  const a = await prisma.amenity.create({ data: { slug, name: 'U', nameNormalized: nn, category: 'SERVICE', iconKey: 'users', source: 'CUSTOM' } });
  reg.amenities.push(a.id);
  await assert.rejects(() => prisma.amenity.create({ data: { slug, name: 'U2', nameNormalized: `${nn} 2`, category: 'SERVICE', iconKey: 'users' } }), /Unique constraint/);
  await assert.rejects(() => prisma.amenity.create({ data: { slug: `${slug}-2`, name: 'U3', nameNormalized: nn, category: 'SERVICE', iconKey: 'users' } }), /Unique constraint/);
  // same normalised name as a SYSTEM row is refused as well (the 18 seeds participate in the unique index)
  await assert.rejects(() => prisma.amenity.create({ data: { slug: `${slug}-3`, name: 'Wifi', nameNormalized: 'wifi mien phi', category: 'FACILITY', iconKey: 'wifi' } }), /Unique constraint/);
});

test('gym_photos: a second PUBLISHED cover is refused by the database (STAGED covers are not constrained)', async () => {
  const owner = await makeOwner(reg);
  const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const cover = await makePhoto(reg, { gymId: g, isCover: true });
  const second = await makePhoto(reg, { gymId: g, sortOrder: 1 });
  await assert.rejects(() => prisma.gymPhoto.update({ where: { id: second.id }, data: { isCover: true } }), /gym_photos_one_cover|Unique constraint/);
  await makePhoto(reg, { gymId: g, status: 'STAGED', isCover: true, sortOrder: 2 });
  // Re-pointing the cover is two statements in one transaction (clear, then set) - exactly what B2 will do.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'seed'`);
    await tx.gymPhoto.update({ where: { id: cover.id }, data: { isCover: false } });
    await tx.gymPhoto.update({ where: { id: second.id }, data: { isCover: true } });
  });
});

test('gym_photos: the same content_hash cannot be STAGED/PUBLISHED twice for one gym; retired rows and other gyms are exempt', async () => {
  const owner = await makeOwner(reg);
  const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const other = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const hash = `sha256-${randomUUID()}`;
  const a = await makePhoto(reg, { gymId: g });
  const b = await makePhoto(reg, { gymId: g, status: 'STAGED', sortOrder: 1 });
  await prisma.gymPhoto.update({ where: { id: a.id }, data: { contentHash: hash } });
  await assert.rejects(() => prisma.gymPhoto.update({ where: { id: b.id }, data: { contentHash: hash } }), /gym_photos_unique_hash|Unique constraint/);
  await prisma.gymPhoto.update({ where: { id: a.id }, data: { status: 'RETIRED', retiredAt: new Date() } });
  await prisma.gymPhoto.update({ where: { id: b.id }, data: { contentHash: hash } });
  const c = await makePhoto(reg, { gymId: other });
  await prisma.gymPhoto.update({ where: { id: c.id }, data: { contentHash: hash } });
  // NULL hashes (legacy rows) are ignored.
  const d = await makePhoto(reg, { gymId: g, sortOrder: 5 });
  const e = await makePhoto(reg, { gymId: g, sortOrder: 6 });
  assert.equal(d.id === e.id, false);
});

test('new gym rows default to listing_version 0, no legacy flags; the compat tables exist and accept a row', async () => {
  const owner = await makeOwner(reg);
  const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'DRAFT' });
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: g } });
  assert.equal(row.listingVersion, 0);
  assert.equal(row.listingPublishedAt, null);
  assert.equal(row.createdFlowVersion, null);
  assert.equal(row.legacyNoAmenities, false);
  assert.equal(row.legacyClientAt, null);
  const hb = await prisma.compatWriterHeartbeat.create({ data: { instanceId: 'test', writerVersion: 'v1' } });
  const audit = await prisma.amenityAuditLog.create({ data: { actorUserId: 'a', action: 'TEST' } });
  const ev = await prisma.legacyCompatEvent.create({ data: { outcome: 'ACCEPTED', action: 'BRANCH_CREATE_QUICK', entityType: 'GYM', entityId: g } });
  assert.ok(hb.id && audit.id && ev.id);
  await prisma.compatWriterHeartbeat.delete({ where: { id: hb.id } });
  await prisma.amenityAuditLog.delete({ where: { id: audit.id } });
  await prisma.legacyCompatEvent.delete({ where: { id: ev.id } });
});
