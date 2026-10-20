/**
 * Listing Management B2 - the BRANCH LISTING REVISION WORKFLOW over HTTP (owner side + admin moderation).
 * Evidence label: BACKEND INTEGRATION - real Express app + real `*_test` database + the real sharp decoder; auth-service
 * and object storage are TEST FIXTURES (see listing-b2.test-helpers.ts).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/listing-b2-workflow.integration.test.ts
 *
 * Covers: the state machine (create / save / submit / withdraw / discard / rebase / approve / reject / request-changes /
 * STALE), optimistic concurrency, concurrent double submit / approve, the photo lifecycle (public A,B,C vs draft A,C,D),
 * multi-branch isolation, the swap tests (plan B19), admin direct edit, PATCH /admin/gyms/:id, preview isolation,
 * Cache-Control, notifications (off by default) and "no WRITER_ABSENT from any new path".
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { setListingPhotoStorage } from '../services/listing-photo-storage';
import {
  MemoryListingStorage,
  amenityBySlug,
  cleanupAll,
  makeAdminUser,
  makeCustomerUser,
  makeManagerUser,
  makeOwnerUser,
  makePublishedGym,
  newRegistry,
  payloadOf,
  seed,
  seedPhoto,
  startHarness,
  type Harness,
  type OwnerFx,
  type Reply,
} from './listing-b2.test-helpers';

const reg = newRegistry();
const storage = new MemoryListingStorage();
let restoreStorage: () => void;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let userClient: typeof import('../clients/user.client').userClient;
let ownerA: OwnerFx;
let ownerB: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;
let admin2: ReturnType<typeof makeAdminUser>;
let customer: ReturnType<typeof makeCustomerUser>;
const startedAt = new Date();
const DAY = 24 * 3600 * 1000;

test.before(async () => {
  if (skip) return;
  restoreStorage = setListingPhotoStorage(storage);
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  userClient = (await import('../clients/user.client')).userClient;
  ownerA = await makeOwnerUser(reg, h, 'A');
  ownerB = await makeOwnerUser(reg, h, 'B');
  admin = makeAdminUser(h, 'adm1');
  admin2 = makeAdminUser(h, 'adm2');
  customer = makeCustomerUser(h);
});

test.after(async () => {
  if (skip) return;
  restoreStorage();
  await h.stop();
  await cleanupAll(reg, { adminIds: [admin.adminId, admin2.adminId] });
  await prisma.$disconnect();
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const L = (gymId: string, sub = '') => `/owner/gyms/${gymId}/listing${sub}`;
const A = (path: string) => `/admin/listings/gyms${path}`;

async function gymOf(owner: OwnerFx = ownerA, opts: Parameters<typeof makePublishedGym>[3] = {}) {
  return makePublishedGym(reg, storage, owner, opts);
}
async function listing(tok: string, gymId: string) {
  const r = await h.call(tok, 'GET', L(gymId));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}
async function startDraft(tok: string, gymId: string, body: unknown = {}) {
  const r = await h.call(tok, 'POST', L(gymId, '/draft'), body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.revision;
}
async function saveDraft(tok: string, gymId: string, rev: { draftVersion: number }, payload: unknown) {
  return h.call(tok, 'PUT', L(gymId, '/draft'), { expectedDraftVersion: rev.draftVersion, payload });
}
/** createDraft + edit + (optionally) submit. Returns the revision as the owner sees it afterwards. */
async function draftWith(tok: string, gymId: string, over: Parameters<typeof payloadOf>[1], opts: { submit?: boolean } = {}) {
  const l = await listing(tok, gymId);
  const rev = await startDraft(tok, gymId);
  const saved = await saveDraft(tok, gymId, rev, payloadOf(l, over));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  let revision = saved.json.data.revision;
  if (opts.submit) {
    const sub = await h.call(tok, 'POST', L(gymId, '/submit'), { expectedDraftVersion: revision.draftVersion });
    assert.equal(sub.status, 200, JSON.stringify(sub.json));
    revision = sub.json.data.revision;
  }
  return revision;
}
const gymRow = (id: string) => prisma.gym.findUniqueOrThrow({ where: { id } });
const revRow = (id: string) => prisma.gymListingRevision.findUniqueOrThrow({ where: { id } });
const photoRow = (id: string) => prisma.gymPhoto.findUniqueOrThrow({ where: { id } });
const code = (r: Reply) => r.json?.error?.code;
async function partnerAuditCount(owner: OwnerFx, gymId: string, action: string) {
  return prisma.partnerAuditLog.count({ where: { partnerId: owner.partnerId, action: action as any, metadata: { path: ['gymId'], equals: gymId } } });
}
const publicGym = async (gymId: string) => (await h.call(null, 'GET', `/gyms/${gymId}`)).json?.data;

// ═══ state machine ════════════════════════════════════════════════════════════════════════════════

test('createDraft copies the published listing; a second one is 409 OPEN_REVISION_EXISTS carrying the open revision', async () => {
  const g = await gymOf(ownerA, { description: 'Mô tả gốc' });
  const l0 = await listing(ownerA.token, g.gymId);
  assert.equal(l0.listingVersion, 1);
  assert.equal(l0.openRevision, null);
  assert.equal(l0.published.payload.description, 'Mô tả gốc');
  assert.equal(l0.published.payload.photoIds.length, 3);
  assert.equal(l0.published.payload.coverPhotoId, g.photoIds[0]);
  assert.equal(l0.limits.maxPhotos, 20);
  assert.equal(l0.limits.maxStagedPhotos, 40);

  const rev = await startDraft(ownerA.token, g.gymId);
  assert.equal(rev.status, 'DRAFT');
  assert.equal(rev.source, 'OWNER');
  assert.equal(rev.baseVersion, 1);
  assert.equal(rev.draftVersion, 1);
  assert.deepEqual(rev.payload, l0.published.payload, 'the draft starts as an exact copy of what is public');
  assert.equal(rev.stale, false);

  const again = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), {});
  assert.equal(again.status, 409);
  assert.equal(code(again), 'OPEN_REVISION_EXISTS');
  assert.equal(again.json.revision.id, rev.id);
  assert.equal((await listing(ownerA.token, g.gymId)).openRevision.id, rev.id);
});

test('PUT draft: expectedDraftVersion is mandatory, a stale one is 409 DRAFT_STALE with the current draft; two concurrent PUTs -> exactly one wins', async () => {
  const g = await gymOf();
  const l = await listing(ownerA.token, g.gymId);
  const rev = await startDraft(ownerA.token, g.gymId);

  const missing = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), { payload: payloadOf(l) });
  assert.equal(missing.status, 400);
  assert.equal(code(missing), 'VALIDATION_FAILED');
  const extra = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), { expectedDraftVersion: 1, payload: { ...payloadOf(l), facilities: ['WIFI'] } });
  assert.equal(extra.status, 400, 'strict payload: an unknown key is refused, not dropped');

  const first = await saveDraft(ownerA.token, g.gymId, rev, payloadOf(l, { description: 'Bản 2' }));
  assert.equal(first.status, 200);
  assert.equal(first.json.data.revision.draftVersion, 2);
  const stale = await saveDraft(ownerA.token, g.gymId, rev, payloadOf(l, { description: 'Ghi đè mù' }));
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'DRAFT_STALE');
  assert.equal(stale.json.revision.payload.description, 'Bản 2', 'the current draft comes back so the client can reload or overwrite on purpose');

  const race = await Promise.all([
    saveDraft(ownerA.token, g.gymId, first.json.data.revision, payloadOf(l, { description: 'Máy 1' })),
    saveDraft(ownerA.token, g.gymId, first.json.data.revision, payloadOf(l, { description: 'Máy 2' })),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const lost = race.find((r) => r.status === 409)!;
  assert.equal(code(lost), 'DRAFT_STALE');
  assert.equal((await revRow(rev.id)).draftVersion, 3, 'only one of the two writes happened');
});

test('validation: description > 300 is 400; > 20 photos 422 PHOTO_LIMIT; 20 photos fine; foreign photo PHOTO_NOT_OWNED; foreign proposal PROPOSAL_NOT_OWNED; unknown / DISABLED amenity refused', async () => {
  const g = await gymOf();
  const l = await listing(ownerA.token, g.gymId);
  const rev = await startDraft(ownerA.token, g.gymId);

  const long = await saveDraft(ownerA.token, g.gymId, rev, payloadOf(l, { description: 'x'.repeat(301) }));
  assert.equal(long.status, 400);
  assert.equal(code(long), 'VALIDATION_FAILED');
  const ok300 = await saveDraft(ownerA.token, g.gymId, rev, payloadOf(l, { description: 'x'.repeat(300) }));
  assert.equal(ok300.status, 200);
  let cur = ok300.json.data.revision;

  // 20 photos are fine, the 21st is refused (the draft is not changed by the refusal)
  const ids = [...g.photoIds];
  for (let i = ids.length; i < 20; i++) ids.push((await seedPhoto(storage, g.gymId, 'STAGED')).id);
  const twenty = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { photoIds: ids, coverPhotoId: ids[0] }));
  assert.equal(twenty.status, 200, JSON.stringify(twenty.json));
  cur = twenty.json.data.revision;
  assert.equal(cur.payload.photoIds.length, 20);
  const extraPhoto = await seedPhoto(storage, g.gymId, 'STAGED');
  const twentyOne = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { photoIds: [...ids, extraPhoto.id], coverPhotoId: ids[0] }));
  assert.equal(twentyOne.status, 422);
  assert.equal(code(twentyOne), 'PHOTO_LIMIT');
  assert.equal((await revRow(rev.id)).draftVersion, cur.draftVersion, 'a refused save leaves the draft alone');

  // a photo of another branch (even the same owner's), and one that does not exist: same answer
  const other = await gymOf(ownerA);
  const foreign = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { photoIds: [...g.photoIds, other.photoIds[0]] }));
  assert.equal(foreign.status, 422);
  assert.equal(code(foreign), 'PHOTO_NOT_OWNED');
  const ghost = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { photoIds: [...g.photoIds, randomUUID()] }));
  assert.equal(code(ghost), 'PHOTO_NOT_OWNED');
  const badCover = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { coverPhotoId: randomUUID() }));
  assert.equal(code(badCover), 'COVER_NOT_IN_PHOTOS');

  // a pending proposal of ANOTHER owner
  const theirs = await h.call(ownerB.token, 'POST', '/owner/amenities/proposals', {
    gymId: (await gymOf(ownerB)).gymId,
    name: `zz-b2wf-${randomUUID().slice(0, 6)} khu cầu lông`,
    suggestedCategory: 'TRAINING_ZONE',
  });
  assert.equal(theirs.status, 201, JSON.stringify(theirs.json));
  const foreignProposal = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { proposalIds: [theirs.json.data.proposal.id] }));
  assert.equal(foreignProposal.status, 422);
  assert.equal(code(foreignProposal), 'PROPOSAL_NOT_OWNED');

  // amenities: unknown id, DISABLED id
  const unknown = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { amenityIds: [...l.published.payload.amenityIds, randomUUID()] }));
  assert.equal(code(unknown), 'AMENITY_UNKNOWN');
  const towel = await amenityBySlug('TOWEL_SERVICE');
  await prisma.amenity.update({ where: { id: towel.id }, data: { status: 'DISABLED' } });
  try {
    const disabled = await saveDraft(ownerA.token, g.gymId, cur, payloadOf(l, { amenityIds: [...l.published.payload.amenityIds, towel.id] }));
    assert.equal(disabled.status, 422);
    assert.equal(code(disabled), 'AMENITY_DISABLED');
    assert.equal(disabled.json.amenities[0].id, towel.id);
  } finally {
    await prisma.amenity.update({ where: { id: towel.id }, data: { status: 'ACTIVE' } });
  }
});

test('submit: NO_CHANGES for an identical draft; concurrent double submit -> exactly one PENDING, one audit row; edit/discard while PENDING -> 409 REVISION_UNDER_REVIEW', async () => {
  const g = await gymOf();
  const l = await listing(ownerA.token, g.gymId);
  const rev = await startDraft(ownerA.token, g.gymId);

  const same = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: 1 });
  assert.equal(same.status, 422);
  assert.equal(code(same), 'NO_CHANGES');
  const noVersion = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), {});
  assert.equal(noVersion.status, 400, 'submit needs expectedDraftVersion');

  const saved = await saveDraft(ownerA.token, g.gymId, rev, payloadOf(l, { description: 'Mô tả mới' }));
  const v = saved.json.data.revision.draftVersion;
  const stale = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: v - 1 });
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'DRAFT_STALE');

  const race = await Promise.all([
    h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: v }),
    h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: v }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(code(race.find((r) => r.status === 409)!), 'REVISION_UNDER_REVIEW');
  const row = await revRow(rev.id);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.submittedBy, ownerA.ownerId);
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_SUBMITTED'), 1, 'exactly one LISTING_SUBMITTED audit row');

  const edit = await saveDraft(ownerA.token, g.gymId, { draftVersion: v }, payloadOf(l, { description: 'Lén sửa' }));
  assert.equal(edit.status, 409);
  assert.equal(code(edit), 'REVISION_UNDER_REVIEW');
  const discard = await h.call(ownerA.token, 'POST', L(g.gymId, '/discard'), {});
  assert.equal(code(discard), 'REVISION_UNDER_REVIEW');
  const rebase = await h.call(ownerA.token, 'POST', L(g.gymId, '/rebase'), {});
  assert.equal(code(rebase), 'REVISION_UNDER_REVIEW');
  const dup = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), {});
  assert.equal(code(dup), 'OPEN_REVISION_EXISTS');
  assert.equal((await revRow(rev.id)).status, 'PENDING', 'nothing above changed it');
});

test('withdraw: PENDING -> WITHDRAWN plus a fresh DRAFT copy (parent_revision_id); discard: DRAFT -> WITHDRAWN; withdraw of a DRAFT is 409', async () => {
  const g = await gymOf();
  const pending = await draftWith(ownerA.token, g.gymId, { description: 'Chờ duyệt' }, { submit: true });

  const wd = await h.call(ownerA.token, 'POST', L(g.gymId, '/withdraw'), {});
  assert.equal(wd.status, 200, JSON.stringify(wd.json));
  assert.equal(wd.json.data.withdrawnRevisionId, pending.id);
  const child = wd.json.data.revision;
  assert.equal(child.status, 'DRAFT');
  assert.equal(child.parentRevisionId, pending.id);
  assert.equal(child.payload.description, 'Chờ duyệt');
  assert.equal((await revRow(pending.id)).status, 'WITHDRAWN');
  assert.equal((await photoRow(g.photoIds[0])).status, 'PUBLISHED', 'withdrawing never touches PUBLISHED photos');

  const notPending = await h.call(ownerA.token, 'POST', L(g.gymId, '/withdraw'), {});
  assert.equal(notPending.status, 409);
  assert.equal(code(notPending), 'REVISION_NOT_PENDING');

  const discard = await h.call(ownerA.token, 'POST', L(g.gymId, '/discard'), {});
  assert.equal(discard.status, 200);
  assert.equal(discard.json.data.discardedRevisionId, child.id);
  assert.equal((await revRow(child.id)).status, 'WITHDRAWN');
  const nothing = await h.call(ownerA.token, 'POST', L(g.gymId, '/discard'), {});
  assert.equal(code(nothing), 'NO_OPEN_REVISION');
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả ban đầu', 'nothing public changed');
});

test('copyFromRevisionId: a closed revision <= 30 days old is copied (dead photos dropped + system_adjustments, cover repaired); 31 days -> REVISION_TOO_OLD_TO_COPY; an open one / a stranger\'s -> refused', async () => {
  const g = await gymOf();
  const staged = await seedPhoto(storage, g.gymId, 'STAGED');
  const gone = await seedPhoto(storage, g.gymId, 'STAGED');
  const mk = (status: string, closedDaysAgo: number, photoIds: string[], cover: string | null) =>
    seed((tx) =>
      tx.gymListingRevision.create({
        data: {
          gymId: g.gymId,
          status: status as any,
          baseVersion: 1,
          payload: { description: 'Từ bản đã đóng', amenityIds: [], proposalIds: [], photoIds, coverPhotoId: cover },
          reviewedAt: new Date(Date.now() - closedDaysAgo * DAY),
          reviewNote: 'bị từ chối',
          ...(status === 'REJECTED' ? { reviewedBy: 'adm' } : {}),
        },
      }),
    );
  const recent = await mk('REJECTED', 20, [gone.id, staged.id, g.photoIds[1]], gone.id);
  const old = await mk('REJECTED', 31, [staged.id], staged.id);
  // the photo was swept by hand
  await prisma.gymPhoto.update({ where: { id: gone.id }, data: { status: 'DISCARDED' } });

  const tooOld = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), { copyFromRevisionId: old.id });
  assert.equal(tooOld.status, 409);
  assert.equal(code(tooOld), 'REVISION_TOO_OLD_TO_COPY');
  assert.equal(await prisma.gymListingRevision.count({ where: { gymId: g.gymId, status: 'DRAFT' } }), 0, 'no draft was created');

  const ok = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), { copyFromRevisionId: recent.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const rev = ok.json.data.revision;
  assert.equal(rev.parentRevisionId, recent.id);
  assert.deepEqual(rev.payload.photoIds, [staged.id, g.photoIds[1]], 'the dead photo is gone, the rest keeps its order');
  assert.equal(rev.payload.coverPhotoId, staged.id, 'the cover that was dropped is replaced by the first remaining photo');
  assert.deepEqual(rev.systemAdjustments, [{ type: 'PHOTO_NO_LONGER_AVAILABLE', photoId: gone.id }]);
  assert.equal(rev.payload.description, 'Từ bản đã đóng');

  await h.call(ownerA.token, 'POST', L(g.gymId, '/discard'), {});
  const strangerRev = await seed((tx) =>
    tx.gymListingRevision.create({ data: { gymId: g.gymId, status: 'WITHDRAWN', baseVersion: 1, payload: { description: null, amenityIds: [], proposalIds: [], photoIds: [], coverPhotoId: null } } }),
  );
  const other = await gymOf(ownerB);
  const notMine = await h.call(ownerB.token, 'POST', L(other.gymId, '/draft'), { copyFromRevisionId: strangerRev.id });
  assert.equal(notMine.status, 404, "another branch's revision is not even found");
  assert.equal(code(notMine), 'REVISION_NOT_FOUND');
  const open = await startDraft(ownerA.token, g.gymId);
  await h.call(ownerA.token, 'POST', L(g.gymId, '/discard'), {});
  const copyOpen = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), { copyFromRevisionId: open.id });
  assert.equal(copyOpen.status, 201, 'a discarded (WITHDRAWN) draft is closed history and may be copied');
});

test('createDraft from the published listing drops DISABLED amenities with AMENITY_DISABLED_REMOVED, and the resulting draft submits fine (never stuck)', async () => {
  const g = await gymOf(ownerA, { amenities: ['WIFI', 'DRINKING_WATER', 'PARKING'] });
  const sauna = await amenityBySlug('DRINKING_WATER'); // (a rarely used SYSTEM amenity: other test files share the catalogue)
  await prisma.amenity.update({ where: { id: sauna.id }, data: { status: 'DISABLED' } });
  try {
    const l = await listing(ownerA.token, g.gymId);
    assert.ok(l.published.payload.amenityIds.includes(sauna.id), 'the published payload still lists the gym row');
    const rev = await startDraft(ownerA.token, g.gymId);
    assert.ok(!rev.payload.amenityIds.includes(sauna.id));
    assert.deepEqual(rev.systemAdjustments, [{ type: 'AMENITY_DISABLED_REMOVED', amenityId: sauna.id, name: sauna.name }]);
    const sub = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: rev.draftVersion });
    assert.equal(sub.status, 200, 'removing a disabled amenity IS a change, so the submit is accepted: ' + JSON.stringify(sub.json));
    const ap = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {});
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    const rows = await prisma.gymAmenity.findMany({ where: { gymId: g.gymId } });
    assert.ok(!rows.some((r) => r.amenityId === sauna.id), 'the disabled amenity left the branch');
  } finally {
    await prisma.amenity.update({ where: { id: sauna.id }, data: { status: 'ACTIVE' } });
  }
});

// ═══ approve / reject / request-changes and the photo lifecycle ═══════════════════════════════════

test('photo lifecycle: public A,B,C vs draft A,C,D - the public listing is unchanged until approve; reject / withdraw never touch PUBLISHED; approve -> A,C,D PUBLISHED, B RETIRED, one cover, sort_order 0..n-1', async () => {
  const g = await gymOf(ownerA, { amenities: ['WIFI'], description: 'Trước' });
  const [a, b, c] = g.photoIds;
  const d = (await seedPhoto(storage, g.gymId, 'STAGED')).id;
  const wifi = await amenityBySlug('WIFI');
  const parking = await amenityBySlug('PARKING');

  const publicPhotoIds = async () => ((await publicGym(g.gymId)).photos as any[]).map((p) => p.id).sort();
  const before = [a, b, c].sort();
  assert.deepEqual(await publicPhotoIds(), before);

  // edit the draft: drop B, add D, cover = C, new description, one more amenity
  const rev = await draftWith(ownerA.token, g.gymId, { photoIds: [a, c, d], coverPhotoId: c, description: 'Sau', amenityIds: [wifi.id, parking.id] });
  assert.deepEqual(rev.payload.photoIds, [a, c, d]);
  assert.deepEqual(await publicPhotoIds(), before, 'a draft does not change the public listing');
  assert.equal((await publicGym(g.gymId)).description, 'Trước');
  assert.equal((await photoRow(b)).status, 'PUBLISHED', 'dropping B from a draft only edits the payload');
  assert.equal((await photoRow(d)).status, 'STAGED');

  const sub = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: rev.draftVersion });
  assert.equal(sub.status, 200);
  assert.deepEqual(await publicPhotoIds(), before, 'submitting does not either');

  // REJECT: public untouched, revision closed, owner can start again from the rejected one
  const rej = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/reject`), { note: 'Ảnh C mờ' });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  assert.equal((await revRow(rev.id)).status, 'REJECTED');
  assert.deepEqual(await publicPhotoIds(), before);
  assert.equal((await photoRow(d)).status, 'STAGED', 'rejection keeps the STAGED photo');
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_REJECTED'), 1);

  const again = await startDraft(ownerA.token, g.gymId, { copyFromRevisionId: rev.id });
  assert.deepEqual(again.payload.photoIds, [a, c, d]);
  const sub2 = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: again.draftVersion });
  assert.equal(sub2.status, 200, JSON.stringify(sub2.json));

  // REQUEST CHANGES: closed + a DRAFT child that carries the admin's note
  const rc = await h.call(admin.token, 'POST', A(`/revisions/${again.id}/request-changes`), { note: 'Hãy đổi ảnh bìa' });
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  const child = await revRow(rc.json.data.draftRevisionId);
  assert.equal(child.status, 'DRAFT');
  assert.equal(child.parentRevisionId, again.id);
  assert.equal(child.reviewNote, 'Hãy đổi ảnh bìa');
  assert.equal((await revRow(again.id)).status, 'CHANGES_REQUESTED');
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_CHANGES_REQUESTED'), 1);
  assert.deepEqual(await publicPhotoIds(), before);

  // APPROVE the child (the owner submits it as is)
  const sub3 = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: child.draftVersion });
  assert.equal(sub3.status, 200, JSON.stringify(sub3.json));
  const ap = await h.call(admin.token, 'POST', A(`/revisions/${child.id}/approve`), { note: 'Đạt' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal(ap.json.data.listingVersion, 2);

  const after = await gymRow(g.gymId);
  assert.equal(after.listingVersion, 2);
  assert.ok(after.listingPublishedAt, 'listing_published_at is set by an apply');
  assert.equal(after.description, 'Sau');
  assert.deepEqual([...after.facilities].sort(), ['PARKING', 'WIFI'], 'the legacy mirror follows gym_amenities');
  assert.equal((await photoRow(a)).status, 'PUBLISHED');
  assert.equal((await photoRow(c)).status, 'PUBLISHED');
  assert.equal((await photoRow(d)).status, 'PUBLISHED');
  const bRow = await photoRow(b);
  assert.equal(bRow.status, 'RETIRED');
  assert.ok(bRow.retiredAt);
  assert.equal(bRow.isCover, false);
  const published = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(published.map((p) => p.id), [a, c, d], 'payload order');
  assert.deepEqual(published.map((p) => p.sortOrder), [0, 1, 2]);
  assert.deepEqual(published.filter((p) => p.isCover).map((p) => p.id), [c], 'exactly one cover, the one the payload names');
  const pub = await publicGym(g.gymId);
  assert.deepEqual((pub.photos as any[]).map((p) => p.id), [c, a, d], 'reader order: cover first, then sort_order');
  assert.equal(pub.coverPhotoUrl, `/media/gym-photos/${c}`);
  assert.deepEqual(pub.amenities.map((x: any) => x.slug).sort(), ['PARKING', 'WIFI']);

  // the closed revision is history: snapshot of what was public, immutable
  const closed = await revRow(child.id);
  assert.equal(closed.status, 'APPROVED');
  assert.equal(closed.reviewedBy, admin.adminId);
  assert.equal((closed.previousSnapshot as any).listingVersion, 1);
  assert.equal((closed.previousSnapshot as any).payload.description, 'Trước');
  assert.deepEqual((closed.previousSnapshot as any).payload.photoIds, [a, b, c]);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE gym_listing_revisions SET review_note = 'tampered' WHERE id = '${closed.id}'`), /immutable|23001/);
  await assert.rejects(() => prisma.gymListingRevision.delete({ where: { id: closed.id } }), /cannot be deleted|23001/);
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_APPROVED'), 1);
  const audit = await prisma.partnerAuditLog.findFirstOrThrow({ where: { partnerId: ownerA.partnerId, action: 'LISTING_APPROVED', metadata: { path: ['gymId'], equals: g.gymId } } });
  assert.equal(audit.actorUserId, admin.adminId);
  assert.deepEqual(((audit.metadata as any).changes as any[]).map((c2) => c2.path).sort(), ['amenityIds', 'coverPhotoId', 'description', 'photoIds']);

  // RETIRED / formerly-STAGED photos on the public media route
  assert.equal((await h.call(null, 'GET', `/media/gym-photos/${b}`)).status, 404, 'a RETIRED photo is never served');
});

test('concurrent approve of the same revision -> exactly one 200 and one 409 ALREADY_DECIDED; listing_version moves once', async () => {
  const g = await gymOf();
  const rev = await draftWith(ownerA.token, g.gymId, { description: 'Hai admin cùng bấm' }, { submit: true });
  const race = await Promise.all([
    h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {}),
    h.call(admin2.token, 'POST', A(`/revisions/${rev.id}/approve`), {}),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(code(race.find((r) => r.status === 409)!), 'ALREADY_DECIDED');
  assert.equal((await gymRow(g.gymId)).listingVersion, 2);
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_APPROVED'), 1);
  // decide it again, any way: 409
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/reject`), { note: 'muộn' })).status, 409);
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/request-changes`), { note: 'muộn' })).status, 409);

  // approve vs reject at the same time: one wins, the final state matches the winner
  const g2 = await gymOf();
  const rev2 = await draftWith(ownerA.token, g2.gymId, { description: 'Duyệt hay từ chối?' }, { submit: true });
  const mix = await Promise.all([
    h.call(admin.token, 'POST', A(`/revisions/${rev2.id}/approve`), {}),
    h.call(admin2.token, 'POST', A(`/revisions/${rev2.id}/reject`), { note: 'không' }),
  ]);
  assert.deepEqual(mix.map((r) => r.status).sort(), [200, 409]);
  const finalStatus = (await revRow(rev2.id)).status;
  const winnerWasApprove = mix[0].status === 200;
  assert.equal(finalStatus, winnerWasApprove ? 'APPROVED' : 'REJECTED');
  assert.equal((await gymRow(g2.gymId)).description, winnerWasApprove ? 'Duyệt hay từ chối?' : 'Mô tả ban đầu');
});

test('admin reject / request-changes need a note; only a PENDING revision can be decided; unknown revision is 404', async () => {
  const g = await gymOf();
  const draft = await startDraft(ownerA.token, g.gymId);
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/approve`), {})).status, 409, 'a DRAFT cannot be approved');
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/reject`), { note: 'x' })).status, 409);
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${randomUUID()}/approve`), {})).status, 404);
  const l = await listing(ownerA.token, g.gymId);
  const saved = await saveDraft(ownerA.token, g.gymId, draft, payloadOf(l, { description: 'x' }));
  await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: saved.json.data.revision.draftVersion });
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/reject`), {})).status, 400, 'a note is required');
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/request-changes`), { note: '   ' })).status, 400);
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/approve`), { surprise: true })).status, 400, 'strict body');
});

// ═══ stale / rebase / admin direct edit ═══════════════════════════════════════════════════════════

test('admin direct edit: a DRAFT is not touched but its submit becomes 409 LISTING_STALE until rebase; a PENDING revision becomes STALE with a rebased child draft', async () => {
  const g = await gymOf();
  const draft = await draftWith(ownerA.token, g.gymId, { description: 'Của chủ' });

  const edit = await h.call(admin.token, 'POST', A(`/${g.gymId}/direct-edit`), { description: 'Admin sửa', reason: 'Sửa lỗi chính tả theo yêu cầu', expectedListingVersion: 1 });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(edit.json.data.listingVersion, 2);
  assert.equal(edit.json.data.invalidatedRevisionId, null, 'a DRAFT is not in the queue, so it is not invalidated');
  assert.equal((await revRow(draft.id)).status, 'DRAFT');
  const adminRev = await revRow(edit.json.data.revisionId);
  assert.equal(adminRev.status, 'APPROVED');
  assert.equal(adminRev.source, 'ADMIN_DIRECT');
  assert.equal(adminRev.adminReason, 'Sửa lỗi chính tả theo yêu cầu');
  assert.equal(adminRev.reviewedBy, admin.adminId);
  assert.equal((adminRev.previousSnapshot as any).payload.description, 'Mô tả ban đầu');
  assert.equal((await gymRow(g.gymId)).description, 'Admin sửa');
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_ADMIN_EDITED'), 1);
  const audit = await prisma.partnerAuditLog.findFirstOrThrow({ where: { partnerId: ownerA.partnerId, action: 'LISTING_ADMIN_EDITED', metadata: { path: ['gymId'], equals: g.gymId } } });
  assert.equal(audit.reason, 'Sửa lỗi chính tả theo yêu cầu', 'the reason is stored on the audit row too');

  const sub = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: draft.draftVersion });
  assert.equal(sub.status, 409);
  assert.equal(code(sub), 'LISTING_STALE');
  assert.equal(sub.json.listingVersion, 2);
  assert.equal(sub.json.revision.stale, true);

  const rb = await h.call(ownerA.token, 'POST', L(g.gymId, '/rebase'), { expectedDraftVersion: draft.draftVersion });
  assert.equal(rb.status, 200, JSON.stringify(rb.json));
  assert.equal(rb.json.data.revision.baseVersion, 2);
  assert.equal(rb.json.data.revision.payload.description, 'Của chủ', "the owner's edits are kept");
  assert.equal(rb.json.data.revision.stale, false);
  const sub2 = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: rb.json.data.revision.draftVersion });
  assert.equal(sub2.status, 200, JSON.stringify(sub2.json));

  // now a PENDING revision (the one just submitted) meets another admin edit -> STALE + rebased child
  const edit2 = await h.call(admin2.token, 'POST', A(`/${g.gymId}/direct-edit`), { description: 'Admin sửa lần nữa', reason: 'Cập nhật theo phản ánh của khách', expectedListingVersion: 2 });
  assert.equal(edit2.status, 200, JSON.stringify(edit2.json));
  assert.equal(edit2.json.data.invalidatedRevisionId, draft.id);
  const stale = await revRow(draft.id);
  assert.equal(stale.status, 'STALE');
  const kid = await revRow(edit2.json.data.rebasedDraftRevisionId);
  assert.equal(kid.status, 'DRAFT');
  assert.equal(kid.parentRevisionId, draft.id);
  assert.equal(kid.baseVersion, 3);
  assert.equal((kid.payload as any).description, 'Của chủ', 'the owner\'s work survives as a rebased draft');
  assert.deepEqual((kid.systemAdjustments as any[])[0], { type: 'REBASED_AFTER_ADMIN_EDIT', fromRevisionId: draft.id });
  // approving a STALE (closed) revision is a 409
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${draft.id}/approve`), {})).status, 409);
});

test('admin direct edit: reason >= 10 characters, expectedListingVersion must match, NO_CHANGES, photos / cover / amenities; an admin-uploaded STAGED photo can be put in', async () => {
  const g = await gymOf(ownerA, { amenities: ['WIFI'] });
  const [a, b, c] = g.photoIds;
  const parking = await amenityBySlug('PARKING');
  const wifi = await amenityBySlug('WIFI');
  const url = A(`/${g.gymId}/direct-edit`);

  assert.equal((await h.call(admin.token, 'POST', url, { description: 'x', expectedListingVersion: 1 })).status, 400, 'reason is required');
  assert.equal((await h.call(admin.token, 'POST', url, { description: 'x', reason: 'ngắn', expectedListingVersion: 1 })).status, 400, 'reason < 10 characters');
  assert.equal((await h.call(admin.token, 'POST', url, { description: 'x', reason: '0123456789' })).status, 400, 'expectedListingVersion is required');
  const stale = await h.call(admin.token, 'POST', url, { description: 'x', reason: '0123456789', expectedListingVersion: 7 });
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'LISTING_STALE');
  assert.equal(stale.json.listingVersion, 1);
  const none = await h.call(admin.token, 'POST', url, { description: 'Mô tả ban đầu', reason: '0123456789', expectedListingVersion: 1 });
  assert.equal(none.status, 422);
  assert.equal(code(none), 'NO_CHANGES');
  assert.equal((await gymRow(g.gymId)).listingVersion, 1, 'refusals change nothing');

  const staged = (await seedPhoto(storage, g.gymId, 'STAGED', { uploadedBy: admin.adminId })).id;
  const edit = await h.call(admin.token, 'POST', url, {
    photoIds: [c, a, staged],
    coverPhotoId: staged,
    amenityIds: [wifi.id, parking.id],
    reason: 'Sắp xếp lại ảnh và thêm bãi đỗ xe',
    expectedListingVersion: 1,
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  const published = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(published.map((p) => p.id), [c, a, staged]);
  assert.deepEqual(published.filter((p) => p.isCover).map((p) => p.id), [staged]);
  assert.equal((await photoRow(b)).status, 'RETIRED');
  assert.deepEqual([...(await gymRow(g.gymId)).facilities].sort(), ['PARKING', 'WIFI']);
  // untouched fields keep their value
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả ban đầu');

  // a photo of another branch, a retired photo: refused, nothing changes
  const other = await gymOf(ownerB);
  const foreign = await h.call(admin.token, 'POST', url, { photoIds: [c, other.photoIds[0]], reason: '0123456789', expectedListingVersion: 2 });
  assert.equal(code(foreign), 'PHOTO_NOT_OWNED');
  const retired = await h.call(admin.token, 'POST', url, { photoIds: [c, b], reason: '0123456789', expectedListingVersion: 2 });
  assert.equal(code(retired), 'PHOTO_NOT_OWNED');
  assert.equal((await gymRow(g.gymId)).listingVersion, 2);
  // a DRAFT branch has no listing
  const draftGym = await gymOf(ownerA, { status: 'DRAFT', photos: 0 });
  assert.equal(code(await h.call(admin.token, 'POST', A(`/${draftGym.gymId}/direct-edit`), { description: 'x', reason: '0123456789', expectedListingVersion: 0 })), 'GYM_IS_DRAFT');
  assert.equal(code(await h.call(admin.token, 'POST', A(`/${randomUUID()}/direct-edit`), { description: 'x', reason: '0123456789', expectedListingVersion: 0 })), 'GYM_NOT_FOUND');
});

test('admin retire photo: reason >= 10, the cover moves to the first remaining photo, /media is 404 at once; purge deletes the file; history lists revisions and audit', async () => {
  const g = await gymOf();
  const [a, b, c] = g.photoIds; // a = cover
  const url = (id: string) => A(`/${g.gymId}/photos/${id}/retire`);
  assert.equal((await h.call(admin.token, 'POST', url(a), { reason: 'ngắn' })).status, 400);
  assert.equal((await h.call(admin.token, 'POST', url(randomUUID()), { reason: 'Ảnh vi phạm quy định' })).status, 404);

  const r1 = await h.call(admin.token, 'POST', url(a), { reason: 'Ảnh vi phạm quy định cộng đồng', purge: true });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.data.purged, true);
  assert.equal((await photoRow(a)).status, 'RETIRED');
  assert.ok(storage.deleted.some((k) => k.includes(a)), 'purge removed the file now');
  const left = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(left.map((p) => p.id), [b, c]);
  assert.deepEqual(left.map((p) => p.sortOrder), [0, 1]);
  assert.deepEqual(left.filter((p) => p.isCover).map((p) => p.id), [b], 'the cover moved to the first remaining photo');
  assert.equal((await h.call(null, 'GET', `/media/gym-photos/${a}`)).status, 404);
  assert.equal((await gymRow(g.gymId)).listingVersion, 2);
  assert.equal((await h.call(admin.token, 'POST', url(a), { reason: 'Ảnh vi phạm quy định cộng đồng' })).status, 404, 'a retired photo cannot be retired again');

  const hist = await h.call(admin.token, 'GET', A(`/${g.gymId}/history`));
  assert.equal(hist.status, 200);
  assert.equal(hist.json.data.revisions.length, 1);
  assert.equal(hist.json.data.revisions[0].source, 'ADMIN_DIRECT');
  assert.equal(hist.json.data.revisions[0].adminReason, 'Ảnh vi phạm quy định cộng đồng');
  assert.ok(hist.json.data.audit.some((x: any) => x.action === 'LISTING_ADMIN_EDITED'));
});

test('PATCH /admin/gyms/:id: description needs a reason >= 10 chars and becomes an ADMIN_DIRECT revision; expectedListingVersion honoured; other fields get GYM_ADMIN_UPDATED', async () => {
  const g = await gymOf(ownerA, { description: 'Mô tả cũ' });
  const p = (body: unknown) => h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}`, body);

  const noReason = await p({ description: 'Mới' });
  assert.equal(noReason.status, 400);
  assert.equal(code(noReason), 'REASON_REQUIRED');
  assert.equal(code(await p({ description: 'Mới', reason: 'ngắn' })), 'REASON_REQUIRED');
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả cũ');
  assert.equal(await prisma.gymListingRevision.count({ where: { gymId: g.gymId } }), 0);

  const stale = await p({ description: 'Mới', reason: 'Cập nhật theo yêu cầu chủ gym', expectedListingVersion: 5 });
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'LISTING_STALE');
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả cũ', 'nothing was written, not even the other fields');

  const ok = await p({ description: 'Mô tả mới', city: 'Đà Nẵng', reason: 'Cập nhật theo yêu cầu chủ gym', expectedListingVersion: 1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const gym = await gymRow(g.gymId);
  assert.equal(gym.description, 'Mô tả mới');
  assert.equal(gym.city, 'Đà Nẵng');
  assert.equal(gym.listingVersion, 2);
  const rev = await prisma.gymListingRevision.findFirstOrThrow({ where: { gymId: g.gymId } });
  assert.equal(rev.source, 'ADMIN_DIRECT');
  assert.equal(rev.status, 'APPROVED');
  assert.equal(rev.adminReason, 'Cập nhật theo yêu cầu chủ gym');
  assert.equal(await partnerAuditCount(ownerA, g.gymId, 'LISTING_ADMIN_EDITED'), 1);
  const upd = await prisma.partnerAuditLog.findFirstOrThrow({ where: { partnerId: ownerA.partnerId, action: 'GYM_ADMIN_UPDATED', metadata: { path: ['gymId'], equals: g.gymId } } });
  assert.deepEqual((upd.metadata as any).changed.city, { from: null, to: 'Đà Nẵng' });
  assert.equal(upd.actorUserId, admin.adminId);

  // the same description again is not a change (the reason is still required whenever `description` is sent); without a version number it just applies
  assert.equal(code(await p({ description: 'Mô tả mới', phone: '0909000111' })), 'REASON_REQUIRED');
  const same = await p({ description: 'Mô tả mới', phone: '0909000111', reason: 'Chỉ đổi số điện thoại liên hệ' });
  assert.equal(same.status, 200, 'an unchanged description creates no revision');
  assert.equal((await gymRow(g.gymId)).phone, '0909000111');
  assert.equal((await gymRow(g.gymId)).listingVersion, 2, 'no new revision');
  const noVersion = await p({ description: 'Lần ba', reason: 'Không gửi version, vẫn áp dụng' });
  assert.equal(noVersion.status, 200);
  assert.equal((await gymRow(g.gymId)).listingVersion, 3);
  assert.equal((await h.call(ownerA.token, 'PATCH', `/admin/gyms/${g.gymId}`, { description: 'x', reason: '0123456789' })).status, 403);
});

test('PATCH /admin/gyms/:id description on a DRAFT branch is written directly (the wizard owns it); status / approve-rename get audit rows', async () => {
  const draftGym = await gymOf(ownerA, { status: 'DRAFT', photos: 0, description: null });
  const r = await h.call(admin.token, 'PATCH', `/admin/gyms/${draftGym.gymId}`, { description: 'Admin điền giúp', reason: 'Điền giúp theo điện thoại' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await gymRow(draftGym.gymId)).description, 'Admin điền giúp');
  assert.equal(await prisma.gymListingRevision.count({ where: { gymId: draftGym.gymId } }), 0);

  // status change: SUSPENDED then APPROVED again
  const g = await gymOf(ownerA);
  const s1 = await h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}/status`, { status: 'SUSPENDED' });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  const s2 = await h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}/status`, { status: 'APPROVED' });
  assert.equal(s2.status, 200);
  const rows = await prisma.partnerAuditLog.findMany({ where: { partnerId: ownerA.partnerId, action: 'GYM_ADMIN_STATUS_CHANGED', metadata: { path: ['gymId'], equals: g.gymId } }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((x) => (x.metadata as any).to), ['SUSPENDED', 'APPROVED']);
  assert.deepEqual(rows.map((x) => (x.metadata as any).from), ['APPROVED', 'SUSPENDED']);
  assert.equal(rows[0].actorUserId, admin.adminId);

  // approve-rename: the owner renames, the admin approves
  await seed((tx) => tx.gym.update({ where: { id: g.gymId }, data: { pendingName: 'Tên mới của chi nhánh', pendingAddress: 'Địa chỉ mới 99' } }));
  const rn = await h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}/approve-rename`, {});
  assert.equal(rn.status, 200, JSON.stringify(rn.json));
  const renamed = await gymRow(g.gymId);
  assert.equal(renamed.approvedName, 'Tên mới của chi nhánh');
  assert.equal(renamed.pendingName, null);
  const rr = await prisma.partnerAuditLog.findFirstOrThrow({ where: { partnerId: ownerA.partnerId, action: 'GYM_ADMIN_RENAME_APPROVED', metadata: { path: ['gymId'], equals: g.gymId } } });
  assert.equal((rr.metadata as any).name.to, 'Tên mới của chi nhánh');
  assert.equal((rr.metadata as any).address.to, 'Địa chỉ mới 99');
});

// ═══ isolation, swap tests, permissions ═══════════════════════════════════════════════════════════

test('multi-branch isolation: approving an edit of A1 leaves A2 (listing, photos, amenities, mirror, version) exactly as it was', async () => {
  const a1 = await gymOf(ownerA, { amenities: ['WIFI'], description: 'A1' });
  const a2 = await gymOf(ownerA, { amenities: ['SAUNA', 'PARKING'], description: 'A2' });
  const snap = async () => ({
    gym: await gymRow(a2.gymId),
    amenities: await prisma.gymAmenity.findMany({ where: { gymId: a2.gymId }, orderBy: { amenityId: 'asc' } }),
    photos: await prisma.gymPhoto.findMany({ where: { gymId: a2.gymId }, orderBy: { id: 'asc' } }),
    pub: await publicGym(a2.gymId),
  });
  const before = await snap();
  const parking = await amenityBySlug('PARKING');
  const rev = await draftWith(ownerA.token, a1.gymId, { description: 'A1 đã sửa', amenityIds: [parking.id], photoIds: [a1.photoIds[2]], coverPhotoId: a1.photoIds[2] }, { submit: true });
  assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {})).status, 200);
  assert.equal((await gymRow(a1.gymId)).description, 'A1 đã sửa');
  assert.deepEqual([...(await gymRow(a1.gymId)).facilities], ['PARKING']);
  const after = await snap();
  assert.deepEqual(after.gym, before.gym, "A2's gym row (incl. the facilities mirror and updated_at) is untouched");
  assert.deepEqual(after.amenities, before.amenities);
  assert.deepEqual(after.photos, before.photos);
  assert.deepEqual(after.pub, before.pub);
  assert.equal(after.gym.listingVersion, 1);
});

test('SWAP: owner A on owner B\'s branch -> 404 everywhere, B\'s data unchanged; a foreign photo / revision is refused; CUSTOMER 403; no token 401; non-admin 403 on admin routes', async () => {
  const b1 = await gymOf(ownerB);
  const bRev = await draftWith(ownerB.token, b1.gymId, { description: 'Bản của B' });
  const bStaged = await seedPhoto(storage, b1.gymId, 'STAGED');
  const before = { gym: await gymRow(b1.gymId), rev: await revRow(bRev.id), photos: await prisma.gymPhoto.count({ where: { gymId: b1.gymId } }), intents: await prisma.partnerUploadIntent.count({ where: { gymId: b1.gymId } }) };

  const tok = ownerA.token;
  const calls: Array<[string, string, unknown?]> = [
    ['GET', L(b1.gymId)],
    ['POST', L(b1.gymId, '/draft'), {}],
    ['PUT', L(b1.gymId, '/draft'), { expectedDraftVersion: bRev.draftVersion, payload: payloadOf({ published: { payload: bRev.payload } }, { description: 'Của A' }) }],
    ['POST', L(b1.gymId, '/submit'), { expectedDraftVersion: bRev.draftVersion }],
    ['POST', L(b1.gymId, '/withdraw'), {}],
    ['POST', L(b1.gymId, '/discard'), {}],
    ['POST', L(b1.gymId, '/rebase'), {}],
    ['GET', L(b1.gymId, '/preview')],
    ['POST', L(b1.gymId, '/photos/presign'), { contentType: 'image/jpeg' }],
    ['POST', L(b1.gymId, '/photos/confirm'), { uploadId: randomUUID() }],
    ['DELETE', L(b1.gymId, `/photos/${bStaged.id}`)],
  ];
  for (const [method, path, body] of calls) {
    const r = await h.call(tok, method, path, body);
    assert.equal(r.status, 404, `${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(code(r), 'GYM_NOT_FOUND');
  }
  const after = { gym: await gymRow(b1.gymId), rev: await revRow(bRev.id), photos: await prisma.gymPhoto.count({ where: { gymId: b1.gymId } }), intents: await prisma.partnerUploadIntent.count({ where: { gymId: b1.gymId } }) };
  assert.deepEqual(after, before, 'B1 is unchanged by every call');
  assert.equal((await photoRow(bStaged.id)).status, 'STAGED');
  // a branch that does not exist answers the same way as one that is not yours
  assert.equal(code(await h.call(tok, 'GET', L(randomUUID()))), 'GYM_NOT_FOUND');

  // B's photo in A's payload, B's revision as a copy source
  const a1 = await gymOf(ownerA);
  const la = await listing(tok, a1.gymId);
  const revA = await startDraft(tok, a1.gymId);
  const withB = await saveDraft(tok, a1.gymId, revA, payloadOf(la, { photoIds: [...a1.photoIds, b1.photoIds[0]] }));
  assert.equal(withB.status, 422);
  assert.equal(code(withB), 'PHOTO_NOT_OWNED');
  await h.call(tok, 'POST', L(a1.gymId, '/discard'), {});
  const copyB = await h.call(tok, 'POST', L(a1.gymId, '/draft'), { copyFromRevisionId: bRev.id });
  assert.equal(copyB.status, 404);
  assert.equal(code(copyB), 'REVISION_NOT_FOUND');

  // CUSTOMER / anonymous
  for (const [method, path, body] of calls.slice(0, 4)) {
    assert.equal((await h.call(customer.token, method, path.replace(b1.gymId, a1.gymId), body)).status, 403, `customer ${method} ${path}`);
    assert.equal((await h.call(null, method, path.replace(b1.gymId, a1.gymId), body)).status, 401, `anonymous ${method} ${path}`);
  }
  // non-admin on every admin route
  const adminRoutes: Array<[string, string, unknown?]> = [
    ['GET', A('')],
    ['GET', A(`/revisions/${bRev.id}`)],
    ['GET', A(`/revisions/${bRev.id}/preview`)],
    ['POST', A(`/revisions/${bRev.id}/approve`), {}],
    ['POST', A(`/revisions/${bRev.id}/reject`), { note: 'x' }],
    ['POST', A(`/revisions/${bRev.id}/request-changes`), { note: 'x' }],
    ['POST', A(`/${b1.gymId}/direct-edit`), { description: 'x', reason: '0123456789', expectedListingVersion: 1 }],
    ['POST', A(`/${b1.gymId}/photos/presign`), { contentType: 'image/png' }],
    ['POST', A(`/${b1.gymId}/photos/confirm`), { uploadId: randomUUID() }],
    ['POST', A(`/${b1.gymId}/photos/${b1.photoIds[0]}/retire`), { reason: '0123456789' }],
    ['GET', A(`/${b1.gymId}/history`)],
    ['GET', '/admin/amenities'],
    ['POST', '/admin/amenities', { name: 'Xx', category: 'FACILITY', iconKey: 'wifi' }],
    ['GET', '/admin/amenities/proposals'],
  ];
  for (const t of [ownerA.token, ownerB.token, customer.token]) {
    for (const [method, path, body] of adminRoutes) assert.equal((await h.call(t, method, path, body)).status, 403, `${method} ${path}`);
  }
  for (const [method, path, body] of adminRoutes) assert.equal((await h.call(null, method, path, body)).status, 401, `${method} ${path}`);
  assert.equal((await revRow(bRev.id)).status, 'DRAFT');
});

test('MANAGER (even one scoped to the branch) is 403 OWNER_ROLE_REQUIRED on every listing and amenity route; the OWNER of the same partner is fine', async () => {
  const g = await gymOf(ownerA);
  const mgr = await makeManagerUser(reg, h, ownerA, [g.gymId]);
  const routes: Array<[string, string, unknown?]> = [
    ['GET', L(g.gymId)],
    ['POST', L(g.gymId, '/draft'), {}],
    ['PUT', L(g.gymId, '/draft'), { expectedDraftVersion: 1, payload: {} }],
    ['POST', L(g.gymId, '/submit'), { expectedDraftVersion: 1 }],
    ['POST', L(g.gymId, '/withdraw'), {}],
    ['POST', L(g.gymId, '/discard'), {}],
    ['POST', L(g.gymId, '/rebase'), {}],
    ['GET', L(g.gymId, '/preview')],
    ['POST', L(g.gymId, '/photos/presign'), { contentType: 'image/png' }],
    ['POST', L(g.gymId, '/photos/confirm'), { uploadId: randomUUID() }],
    ['DELETE', L(g.gymId, `/photos/${randomUUID()}`)],
    ['GET', '/owner/amenities'],
    ['POST', '/owner/amenities/proposals', { gymId: g.gymId, name: 'Khu yoga ngoài trời', suggestedCategory: 'TRAINING_ZONE' }],
    ['PATCH', `/owner/amenities/proposals/${randomUUID()}`, { note: 'x' }],
    ['DELETE', `/owner/amenities/proposals/${randomUUID()}`],
  ];
  for (const [method, path, body] of routes) {
    const r = await h.call(mgr.token, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(code(r), 'OWNER_ROLE_REQUIRED');
  }
  assert.equal(await prisma.gymListingRevision.count({ where: { gymId: g.gymId } }), 0);
  assert.equal((await h.call(ownerA.token, 'GET', L(g.gymId))).status, 200);
});

test('a DRAFT branch (the wizard) has no listing: 409 GYM_IS_DRAFT on every revision route', async () => {
  const g = await gymOf(ownerA, { status: 'DRAFT', photos: 0 });
  for (const [method, path, body] of [
    ['GET', L(g.gymId)],
    ['POST', L(g.gymId, '/draft'), {}],
    ['PUT', L(g.gymId, '/draft'), { expectedDraftVersion: 1, payload: { description: null, amenityIds: [], proposalIds: [], photoIds: [], coverPhotoId: null } }],
    ['POST', L(g.gymId, '/submit'), { expectedDraftVersion: 1 }],
    ['GET', L(g.gymId, '/preview')],
  ] as Array<[string, string, unknown?]>) {
    const r = await h.call(ownerA.token, method, path, body);
    assert.equal(r.status, 409, `${method} ${path}`);
    assert.equal(code(r), 'GYM_IS_DRAFT');
  }
});

// ═══ preview isolation, admin queue, cache headers ═════════════════════════════════════════════════

test('preview: the owner sees the open draft (STAGED photo with a short signed URL + expiry, pending amenity chips); the public listing never carries it; admin preview works; no draft -> 404', async () => {
  const g = await gymOf(ownerA, { amenities: ['WIFI'], description: 'Công khai' });
  assert.equal((await h.call(ownerA.token, 'GET', L(g.gymId, '/preview'))).status, 404);
  const staged = (await seedPhoto(storage, g.gymId, 'STAGED')).id;
  const wifi = await amenityBySlug('WIFI');
  const prop = await h.call(ownerA.token, 'POST', '/owner/amenities/proposals', { gymId: g.gymId, name: `zz-b2pv-${randomUUID().slice(0, 6)} bể sục`, suggestedCategory: 'RECOVERY' });
  assert.equal(prop.status, 201, JSON.stringify(prop.json));
  const rev = await draftWith(ownerA.token, g.gymId, { description: 'BẢN NHÁP RIÊNG', photoIds: [...g.photoIds, staged], amenityIds: [wifi.id], proposalIds: [prop.json.data.proposal.id] });

  const pv = await h.call(ownerA.token, 'GET', L(g.gymId, '/preview'));
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const d = pv.json.data;
  assert.equal(d.isPreview, true);
  assert.equal(d.viewer, 'OWNER');
  assert.equal(d.revisionStatus, 'DRAFT');
  assert.equal(d.description, 'BẢN NHÁP RIÊNG');
  assert.deepEqual(d.pendingAmenities.map((p: any) => p.proposalId), [prop.json.data.proposal.id]);
  assert.equal(d.photos.length, 4);
  const stagedView = d.photos.find((p: any) => p.id === staged);
  assert.ok(stagedView.url.startsWith('https://memory.test/get/listing-photos/'), 'a STAGED photo gets a presigned link');
  assert.ok(stagedView.expiresAt && d.photoUrlsExpireAt, 'with an expiry');
  assert.equal(d.photos.find((p: any) => p.id === g.photoIds[0]).url, `/media/gym-photos/${g.photoIds[0]}`, 'a PUBLISHED photo keeps the stable URL');

  const pub = await h.call(null, 'GET', `/gyms/${g.gymId}`);
  const text = JSON.stringify(pub.json);
  assert.equal(pub.json.data.description, 'Công khai');
  assert.doesNotMatch(text, /BẢN NHÁP RIÊNG|isPreview|revisionStatus|systemAdjustments|memory\.test|pendingAmenities/);
  assert.ok(!(pub.json.data.photos as any[]).some((p) => p.id === staged));
  const list = JSON.stringify((await h.call(null, 'GET', '/gyms')).json);
  assert.doesNotMatch(list, /BẢN NHÁP RIÊNG|isPreview/);

  const ap = await h.call(admin.token, 'GET', A(`/revisions/${rev.id}/preview`));
  assert.equal(ap.status, 200);
  assert.equal(ap.json.data.viewer, 'ADMIN');
  assert.equal(ap.json.data.description, 'BẢN NHÁP RIÊNG');
  assert.equal((await h.call(ownerB.token, 'GET', L(g.gymId, '/preview'))).status, 404, "another owner cannot preview this branch's draft");
});

test('admin queue + revision detail: filters (status / brandId / gymId / q / page), diff, flags, photos with views; unknown status is 400', async () => {
  const g = await gymOf(ownerA, { name: `Quận Hải Châu ${randomUUID().slice(0, 6)}`, amenities: ['AIR_CONDITIONING', 'KIDS_AREA', 'DRINKING_WATER'] });
  const sauna = await amenityBySlug('KIDS_AREA');
  const staged = (await seedPhoto(storage, g.gymId, 'STAGED')).id;
  const wifi = await amenityBySlug('AIR_CONDITIONING');
  const water = await amenityBySlug('DRINKING_WATER');
  const rev = await draftWith(ownerA.token, g.gymId, { description: 'Mô tả để duyệt', amenityIds: [wifi.id, water.id], photoIds: [g.photoIds[0], staged] }, { submit: true });

  const q = await h.call(admin.token, 'GET', A(`?status=PENDING&gymId=${g.gymId}`));
  assert.equal(q.status, 200, JSON.stringify(q.json));
  assert.equal(q.json.data.total, 1);
  const item = q.json.data.items[0];
  assert.equal(item.id, rev.id);
  assert.equal(item.stale, false);
  assert.equal(item.summary.photoCount, 2);
  assert.equal(item.brandId, ownerA.brandId);
  assert.equal(item.currentListingVersion, 1);
  assert.equal((await h.call(admin.token, 'GET', A(`?gymId=${g.gymId}&brandId=${randomUUID()}`))).json.data.total, 0, 'brandId filter');
  assert.equal((await h.call(admin.token, 'GET', A(`?gymId=${g.gymId}&brandId=${ownerA.brandId}`))).json.data.total, 1);
  const byName = await h.call(admin.token, 'GET', A(`?q=${encodeURIComponent(item.gymName.slice(0, 18))}`));
  assert.ok(byName.json.data.items.some((i: any) => i.id === rev.id), 'q matches the branch name');
  assert.equal((await h.call(admin.token, 'GET', A(`?status=APPROVED&gymId=${g.gymId}`))).json.data.total, 0);
  assert.equal((await h.call(admin.token, 'GET', A(`?gymId=${g.gymId}&page=2`))).json.data.items.length, 0);
  assert.equal((await h.call(admin.token, 'GET', A('?status=BOGUS'))).status, 400);

  const det = await h.call(admin.token, 'GET', A(`/revisions/${rev.id}`));
  assert.equal(det.status, 200);
  const d = det.json.data;
  assert.equal(d.revision.payload.description, 'Mô tả để duyệt');
  assert.deepEqual(d.changes.map((c: any) => c.path).sort(), ['amenityIds', 'description', 'photoIds']);
  assert.deepEqual(d.changes.find((c: any) => c.path === 'amenityIds').removed, [sauna.id]);
  assert.deepEqual(d.changes.find((c: any) => c.path === 'photoIds').added, [staged]);
  assert.equal(d.flags.hasDisabledAmenity, false);
  assert.equal(d.flags.hasPendingProposal, false);
  assert.equal(d.stale, false);
  assert.equal(d.photos.length, 4, 'photos of the draft AND of the public listing');
  assert.equal(d.gym.listingVersion, 1);
  assert.ok(d.amenities.some((a: any) => a.id === sauna.id), 'amenity names for both sides of the diff');
  assert.equal((await h.call(admin.token, 'GET', A(`/revisions/${randomUUID()}`))).status, 404);

  // "has a disabled amenity" flag + approve needs an explicit choice
  await prisma.amenity.update({ where: { id: wifi.id }, data: { status: 'DISABLED' } });
  try {
    const d2 = (await h.call(admin.token, 'GET', A(`/revisions/${rev.id}`))).json.data;
    assert.equal(d2.flags.hasDisabledAmenity, true);
    assert.deepEqual(d2.flags.disabledAmenities.map((a: any) => a.id), [wifi.id]);
    const blocked = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), {});
    assert.equal(blocked.status, 409);
    assert.equal(code(blocked), 'AMENITY_DISABLED');
    assert.equal(blocked.json.amenities[0].id, wifi.id);
    assert.equal((await revRow(rev.id)).status, 'PENDING', 'a refused approval changes nothing');
    const ok = await h.call(admin.token, 'POST', A(`/revisions/${rev.id}/approve`), { dropDisabledAmenities: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.data.systemAdjustments, [{ type: 'AMENITY_DISABLED_REMOVED', amenityId: wifi.id, name: wifi.name }]);
    assert.deepEqual((await prisma.gymAmenity.findMany({ where: { gymId: g.gymId } })).map((r) => r.amenityId), [water.id], 'the disabled amenity was dropped, KIDS_AREA was removed by the owner, one amenity is left');
    const closed = await revRow(rev.id);
    assert.deepEqual((closed.payload as any).amenityIds, [water.id], 'the closed row keeps what actually went live');
    assert.deepEqual((closed.systemAdjustments as any[]).map((x) => x.type), ['AMENITY_DISABLED_REMOVED']);
  } finally {
    await prisma.amenity.update({ where: { id: wifi.id }, data: { status: 'ACTIVE' } });
  }
});

test('Cache-Control: every owner / admin / preview JSON is "no-store, private" with Vary: Authorization', async () => {
  const g = await gymOf(ownerA);
  const rev = await draftWith(ownerA.token, g.gymId, { description: 'Header' });
  const checks: Array<[string | null, string, string, unknown?]> = [
    [ownerA.token, 'GET', L(g.gymId)],
    [ownerA.token, 'GET', L(g.gymId, '/preview')],
    [ownerA.token, 'POST', L(g.gymId, '/draft'), {}],
    [ownerA.token, 'PUT', L(g.gymId, '/draft'), { expectedDraftVersion: 99, payload: {} }],
    [ownerA.token, 'POST', L(g.gymId, '/photos/presign'), { contentType: 'image/png' }],
    [ownerA.token, 'GET', '/owner/amenities'],
    [admin.token, 'GET', A('')],
    [admin.token, 'GET', A(`/revisions/${rev.id}`)],
    [admin.token, 'GET', A(`/revisions/${rev.id}/preview`)],
    [admin.token, 'GET', A(`/${g.gymId}/history`)],
    [admin.token, 'GET', '/admin/amenities'],
    [admin.token, 'GET', '/admin/amenities/proposals'],
    // errors carry it too
    [ownerA.token, 'GET', L(randomUUID())],
    [admin.token, 'GET', A(`/revisions/${randomUUID()}`)],
  ];
  for (const [tok, method, path, body] of checks) {
    const r = await h.call(tok, method, path, body);
    assert.equal(r.headers.get('cache-control'), 'no-store, private', `${method} ${path} (${r.status})`);
    assert.match(r.headers.get('vary') ?? '', /Authorization/i, `${method} ${path}`);
  }
});

// ═══ notifications (off by default) ═══════════════════════════════════════════════════════════════

test('notifications: nothing is sent while LISTING_GYM_NOTIFICATIONS_ENABLED is off; with it on, each decision notifies the owner (entity GYM_BRANCH, link /gym-owner/listings?gymId=...)', async () => {
  const sent: any[] = [];
  const original = userClient.notifyUser;
  (userClient as any).notifyUser = async (p: unknown) => {
    sent.push(p);
  };
  const previousFlag = process.env.LISTING_GYM_NOTIFICATIONS_ENABLED;
  try {
    const g = await gymOf(ownerA);
    delete process.env.LISTING_GYM_NOTIFICATIONS_ENABLED;
    const r1 = await draftWith(ownerA.token, g.gymId, { description: 'Thông báo 1' }, { submit: true });
    assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${r1.id}/approve`), {})).status, 200);
    assert.equal(sent.length, 0, 'flag unset -> no notification');
    process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = 'false';
    const r2 = await draftWith(ownerA.token, g.gymId, { description: 'Thông báo 2' }, { submit: true });
    assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${r2.id}/reject`), { note: 'chưa đạt' })).status, 200);
    assert.equal(sent.length, 0, 'flag false -> no notification');

    process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = 'true';
    const types = () => sent.map((s) => s.eventType);
    const a = await startDraft(ownerA.token, g.gymId, { copyFromRevisionId: r2.id });
    await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: a.draftVersion });
    assert.equal((await h.call(admin.token, 'POST', A(`/revisions/${a.id}/approve`), {})).status, 200);
    assert.deepEqual(types(), ['GYM_LISTING_APPROVED']);
    const b = await draftWith(ownerA.token, g.gymId, { description: 'Thông báo 3' }, { submit: true });
    await h.call(admin.token, 'POST', A(`/revisions/${b.id}/reject`), { note: 'chưa đạt' });
    const c = await startDraft(ownerA.token, g.gymId, { copyFromRevisionId: b.id });
    await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: c.draftVersion });
    await h.call(admin.token, 'POST', A(`/revisions/${c.id}/request-changes`), { note: 'sửa lại giúp' });
    const kid = (await prisma.gymListingRevision.findFirstOrThrow({ where: { gymId: g.gymId, status: 'DRAFT' } }));
    await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: kid.draftVersion });
    const listing2 = await listing(ownerA.token, g.gymId);
    const edit = await h.call(admin.token, 'POST', A(`/${g.gymId}/direct-edit`), { description: 'Admin chen vào', reason: '0123456789', expectedListingVersion: listing2.listingVersion });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
    assert.deepEqual(types(), ['GYM_LISTING_APPROVED', 'GYM_LISTING_REJECTED', 'GYM_LISTING_CHANGES_REQUESTED', 'GYM_LISTING_INVALIDATED']);
    for (const s of sent) {
      assert.equal(s.userId, ownerA.ownerId);
      assert.equal(s.entityType, 'GYM_BRANCH');
      assert.equal(s.entityId, g.gymId);
      assert.equal(s.link, `/gym-owner/listings?gymId=${g.gymId}`);
      assert.ok(typeof s.text === 'string' && s.text.length > 10);
    }
  } finally {
    (userClient as any).notifyUser = original;
    if (previousFlag === undefined) delete process.env.LISTING_GYM_NOTIFICATIONS_ENABLED;
    else process.env.LISTING_GYM_NOTIFICATIONS_ENABLED = previousFlag;
  }
});

// ═══ the last word ════════════════════════════════════════════════════════════════════════════════

test('no new path produced a WRITER_ABSENT compat event for any gym or partner created by this file', async () => {
  const events = await prisma.legacyCompatEvent.findMany({
    where: { outcome: 'WRITER_ABSENT', occurredAt: { gte: startedAt }, OR: [{ entityId: { in: reg.gyms } }, { entityId: { in: reg.partners } }] },
  });
  assert.deepEqual(events.map((e) => `${e.entityType}:${e.action}:${e.entityId}`), [], 'every write to gyms / gym_partners declared itself an event-aware writer');
});
