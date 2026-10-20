/**
 * Listing Management B2 follow-ups (Ngài's decisions):
 *   1. revisions only for APPROVED / SUSPENDED branches that are not PERMANENTLY_CLOSED (409 LISTING_NOT_AVAILABLE);
 *   2. a revision keeps >= 1 amenity: submit / approve / direct edit with none -> 422 AMENITIES_REQUIRED;
 *   4. the wizard's reorder + cover endpoints for the STAGED photos of a DRAFT branch;
 *   5. the 30-key icon allowlist;
 *   6. the first approval of a branch is listing v1 (listing_version = 1, listing_published_at set).
 * Evidence label: BACKEND INTEGRATION - real Express app + real `*_test` database; auth-service and storage are TEST FIXTURES.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { setListingPhotoStorage } from '../services/listing-photo-storage';
import { AMENITY_ICON_KEYS, SYSTEM_AMENITY_SEEDS } from '../services/amenity-catalog';
import {
  MemoryListingStorage,
  amenityBySlug,
  cleanupAll,
  makeAdminUser,
  makeGym,
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
const P = `zzb2f${randomUUID().slice(0, 5)}`;
let restoreStorage: () => void;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let ownerA: OwnerFx;
let ownerB: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;

test.before(async () => {
  if (skip) return;
  restoreStorage = setListingPhotoStorage(storage);
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  ownerA = await makeOwnerUser(reg, h, 'A');
  ownerB = await makeOwnerUser(reg, h, 'B');
  admin = makeAdminUser(h);
});

test.after(async () => {
  if (skip) return;
  restoreStorage();
  await h.stop();
  await cleanupAll(reg, { adminIds: [admin.adminId], amenityNamePrefix: P });
  await prisma.$disconnect();
});

const code = (r: Reply) => r.json?.error?.code;
const L = (gymId: string, sub = '') => `/owner/gyms/${gymId}/listing${sub}`;
const A = (path: string) => `/admin/listings/gyms${path}`;
const gymRow = (id: string) => prisma.gym.findUniqueOrThrow({ where: { id } });
const revRow = (id: string) => prisma.gymListingRevision.findUniqueOrThrow({ where: { id } });
const listing = async (tok: string, gymId: string) => (await h.call(tok, 'GET', L(gymId))).json.data;
type Op = 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED';
const gymWith = (status: 'APPROVED' | 'SUSPENDED' | 'PENDING_REVIEW' | 'REJECTED' | 'DRAFT', operationalStatus: Op = 'OPEN', owner = ownerA) =>
  makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status, operationalStatus, amenities: ['WIFI', 'SAUNA'] });

// ═══ 1. availability ══════════════════════════════════════════════════════════════════════════════

test('only APPROVED / SUSPENDED branches that are not permanently closed have a listing: PENDING_REVIEW, REJECTED and PERMANENTLY_CLOSED are 409 LISTING_NOT_AVAILABLE (Vietnamese message) on every owner and admin route that writes or reads the revision', async () => {
  const blocked: Array<[string, string]> = [
    ['PENDING_REVIEW', await gymWith('PENDING_REVIEW')],
    ['REJECTED', await gymWith('REJECTED')],
    ['APPROVED + PERMANENTLY_CLOSED', await gymWith('APPROVED', 'PERMANENTLY_CLOSED')],
    ['SUSPENDED + PERMANENTLY_CLOSED', await gymWith('SUSPENDED', 'PERMANENTLY_CLOSED')],
  ];
  for (const [label, gymId] of blocked) {
    const calls: Array<[string | null, string, string, unknown?]> = [
      [ownerA.token, 'GET', L(gymId)],
      [ownerA.token, 'POST', L(gymId, '/draft'), {}],
      [ownerA.token, 'PUT', L(gymId, '/draft'), { expectedDraftVersion: 1, payload: { description: null, amenityIds: [], proposalIds: [], photoIds: [], coverPhotoId: null } }],
      [ownerA.token, 'POST', L(gymId, '/submit'), { expectedDraftVersion: 1 }],
      [ownerA.token, 'GET', L(gymId, '/preview')],
      [ownerA.token, 'POST', L(gymId, '/photos/presign'), { contentType: 'image/png' }],
      [ownerA.token, 'POST', '/owner/amenities/proposals', { gymId, name: `${P} khu ${label}`.slice(0, 40), suggestedCategory: 'SERVICE' }],
      [admin.token, 'POST', A(`/${gymId}/direct-edit`), { description: 'x', reason: '0123456789', expectedListingVersion: 0 }],
      [admin.token, 'POST', A(`/${gymId}/photos/presign`), { contentType: 'image/png' }],
    ];
    for (const [tok, method, path, body] of calls) {
      const r = await h.call(tok, method, path, body);
      assert.equal(r.status, 409, `${label}: ${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
      assert.equal(code(r), 'LISTING_NOT_AVAILABLE', `${label}: ${method} ${path}`);
      assert.match(r.json.message, /Chi nhánh .* tin đăng/);
    }
    assert.equal(await prisma.gymListingRevision.count({ where: { gymId } }), 0, `${label}: nothing was created`);
    assert.equal(await prisma.partnerUploadIntent.count({ where: { gymId } }), 0);
    // read-only history stays available to the admin
    assert.equal((await h.call(admin.token, 'GET', A(`/${gymId}/history`))).status, 200, `${label}: history`);
  }
  // a DRAFT branch keeps its own code
  const draft = await gymWith('DRAFT');
  assert.equal(code(await h.call(ownerA.token, 'GET', L(draft))), 'GYM_IS_DRAFT');
  assert.equal(code(await h.call(admin.token, 'POST', A(`/${draft}/direct-edit`), { description: 'x', reason: '0123456789', expectedListingVersion: 0 })), 'GYM_IS_DRAFT');
});

test('SUSPENDED and TEMPORARILY_CLOSED branches can still revise their listing end to end', async () => {
  for (const [status, op] of [['SUSPENDED', 'OPEN'], ['APPROVED', 'TEMPORARILY_CLOSED'], ['SUSPENDED', 'TEMPORARILY_CLOSED']] as Array<['SUSPENDED' | 'APPROVED', Op]>) {
    const gymId = await gymWith(status, op);
    await seed((tx) => tx.gym.update({ where: { id: gymId }, data: { listingVersion: 1 } }));
    const l = await listing(ownerA.token, gymId);
    const d = await h.call(ownerA.token, 'POST', L(gymId, '/draft'), {});
    assert.equal(d.status, 201, `${status}/${op}: ${JSON.stringify(d.json)}`);
    const saved = await h.call(ownerA.token, 'PUT', L(gymId, '/draft'), { expectedDraftVersion: 1, payload: payloadOf(l, { description: `Sửa khi ${status}/${op}` }) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const sub = await h.call(ownerA.token, 'POST', L(gymId, '/submit'), { expectedDraftVersion: saved.json.data.revision.draftVersion });
    assert.equal(sub.status, 200, JSON.stringify(sub.json));
    const ap = await h.call(admin.token, 'POST', A(`/revisions/${d.json.data.revision.id}/approve`), {});
    assert.equal(ap.status, 200, `${status}/${op}: ${JSON.stringify(ap.json)}`);
    assert.equal((await gymRow(gymId)).description, `Sửa khi ${status}/${op}`);
    const edit = await h.call(admin.token, 'POST', A(`/${gymId}/direct-edit`), { description: 'Admin sửa', reason: '0123456789', expectedListingVersion: 2 });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
  }
});

test('a PENDING revision cannot be approved once its branch was closed for good meanwhile (409 LISTING_NOT_AVAILABLE, nothing applied, revision stays PENDING)', async () => {
  const g = await makePublishedGym(reg, storage, ownerA, { photos: 1 });
  const l = await listing(ownerA.token, g.gymId);
  const d = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), {});
  const saved = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), { expectedDraftVersion: 1, payload: payloadOf(l, { description: 'Chưa kịp duyệt' }) });
  await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: saved.json.data.revision.draftVersion });
  await seed((tx) => tx.gym.update({ where: { id: g.gymId }, data: { operationalStatus: 'PERMANENTLY_CLOSED' } }));
  const ap = await h.call(admin.token, 'POST', A(`/revisions/${d.json.data.revision.id}/approve`), {});
  assert.equal(ap.status, 409);
  assert.equal(code(ap), 'LISTING_NOT_AVAILABLE');
  assert.equal((await revRow(d.json.data.revision.id)).status, 'PENDING');
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả ban đầu');
  assert.equal((await gymRow(g.gymId)).listingVersion, 1);
});

// ═══ 2. at least one amenity ══════════════════════════════════════════════════════════════════════

test('AMENITIES_REQUIRED: a draft may be saved empty, but submit needs >= 1 amenity or proposal; approve and direct edit refuse to leave the branch with none', async () => {
  const g = await makePublishedGym(reg, storage, ownerA, { photos: 1 });
  const l = await listing(ownerA.token, g.gymId);
  const d = (await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), {})).json.data.revision;
  const saved = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), { expectedDraftVersion: d.draftVersion, payload: payloadOf(l, { amenityIds: [], description: 'Không tiện ích' }) });
  assert.equal(saved.status, 200, 'draft save may be empty');
  const v = saved.json.data.revision.draftVersion;
  const sub = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: v });
  assert.equal(sub.status, 422);
  assert.equal(code(sub), 'AMENITIES_REQUIRED');
  assert.equal((await revRow(d.id)).status, 'DRAFT');

  // a pending PROPOSAL counts for the submit...
  const prop = await h.call(ownerA.token, 'POST', '/owner/amenities/proposals', { gymId: g.gymId, name: `${P} khu thiền`, suggestedCategory: 'RECOVERY' });
  assert.equal(prop.status, 201, JSON.stringify(prop.json));
  const saved2 = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), { expectedDraftVersion: v, payload: payloadOf(l, { amenityIds: [], proposalIds: [prop.json.data.proposal.id], description: 'Chỉ có đề xuất' }) });
  assert.equal(saved2.status, 200, JSON.stringify(saved2.json));
  const sub2 = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: saved2.json.data.revision.draftVersion });
  assert.equal(sub2.status, 200, JSON.stringify(sub2.json));

  // ...but when the admin rejects it the revision is left with none: approve is refused, nothing is applied
  const rej = await h.call(admin.token, 'POST', '/admin/amenities/proposals/reject', { proposalIds: [prop.json.data.proposal.id], reason: 'Không phù hợp' });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  const ap = await h.call(admin.token, 'POST', A(`/revisions/${d.id}/approve`), {});
  assert.equal(ap.status, 422);
  assert.equal(code(ap), 'AMENITIES_REQUIRED');
  assert.equal((await revRow(d.id)).status, 'PENDING');
  assert.equal((await gymRow(g.gymId)).description, 'Mô tả ban đầu');
  assert.equal(await prisma.gymAmenity.count({ where: { gymId: g.gymId } }), 2);

  // direct edit with an empty amenity list
  const edit = await h.call(admin.token, 'POST', A(`/${g.gymId}/direct-edit`), { amenityIds: [], reason: '0123456789', expectedListingVersion: 1 });
  assert.equal(edit.status, 422);
  assert.equal(code(edit), 'AMENITIES_REQUIRED');
  assert.equal((await gymRow(g.gymId)).listingVersion, 1);
  assert.equal(await prisma.gymAmenity.count({ where: { gymId: g.gymId } }), 2);
  // and one amenity is enough
  const wifi = await amenityBySlug('WIFI');
  const one = await h.call(admin.token, 'POST', A(`/${g.gymId}/direct-edit`), { amenityIds: [wifi.id], reason: '0123456789', expectedListingVersion: 1 });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.deepEqual((await prisma.gymAmenity.findMany({ where: { gymId: g.gymId } })).map((r) => r.amenityId), [wifi.id]);
});

// ═══ 4. wizard reorder + cover ═════════════════════════════════════════════════════════════════════

test('wizard photos: reorder needs EXACTLY the STAGED photo set, writes sort_order 0..n-1 and keeps the single cover; PATCH cover moves it; non-DRAFT 409; MANAGER 403; foreign 404; the first approval publishes in that order', async () => {
  const g = await makePublishedGym(reg, storage, ownerA, { status: 'DRAFT', photos: 0 });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push((await seedPhoto(storage, g.gymId, 'STAGED', { sortOrder: i, isCover: i === 0 })).id);
  const reorder = (tok: string | null, gymId: string, photoIds: unknown) => h.call(tok, 'PUT', L(gymId, '/photos/reorder'), { photoIds });
  const cover = (tok: string, gymId: string, photoId: string) => h.call(tok, 'PATCH', L(gymId, `/photos/${photoId}/cover`), {});
  const state = async () => (await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'STAGED' }, orderBy: { sortOrder: 'asc' } })).map((p) => [p.id, p.sortOrder, p.isCover]);

  const order = [ids[2], ids[0], ids[3], ids[1]];
  const ok = await reorder(ownerA.token, g.gymId, order);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.data.photos.map((p: any) => p.id), order);
  assert.deepEqual(await state(), [[ids[2], 0, false], [ids[0], 1, true], [ids[3], 2, false], [ids[1], 3, false]], 'the cover (ids[0]) stays the cover, sort_order is 0..n-1');

  // exact set only
  for (const bad of [order.slice(1), [...order, randomUUID()], [...order.slice(0, 3), ids[2]], [...order.slice(0, 3), randomUUID()], []]) {
    const r = await reorder(ownerA.token, g.gymId, bad);
    assert.ok([400, 422].includes(r.status), `${JSON.stringify(bad.length)} -> ${r.status}`);
    if (r.status === 422) assert.equal(code(r), 'PHOTO_SET_MISMATCH');
  }
  assert.equal((await h.call(ownerA.token, 'PUT', L(g.gymId, '/photos/reorder'), { photoIds: order, extra: 1 })).status, 400, 'strict body');
  assert.deepEqual(await state(), [[ids[2], 0, false], [ids[0], 1, true], [ids[3], 2, false], [ids[1], 3, false]], 'refusals change nothing');
  // a DISCARDED / foreign photo is not part of the set
  const other = await makePublishedGym(reg, storage, ownerA, { status: 'DRAFT', photos: 0 });
  const foreignPhoto = (await seedPhoto(storage, other.gymId, 'STAGED')).id;
  assert.equal(code(await reorder(ownerA.token, g.gymId, [...order.slice(0, 3), foreignPhoto])), 'PHOTO_SET_MISMATCH');

  // cover: exactly one
  const c = await cover(ownerA.token, g.gymId, ids[3]);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.deepEqual(await state(), [[ids[2], 0, false], [ids[0], 1, false], [ids[3], 2, true], [ids[1], 3, false]]);
  assert.equal(code(await cover(ownerA.token, g.gymId, randomUUID())), 'PHOTO_NOT_FOUND');
  assert.equal(code(await cover(ownerA.token, g.gymId, foreignPhoto)), 'PHOTO_NOT_FOUND', "another branch's photo");
  assert.equal((await h.call(ownerA.token, 'PATCH', L(g.gymId, `/photos/${ids[0]}/cover`), { x: 1 })).status, 400);

  // deleting a non-cover photo keeps the cover
  assert.equal((await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${ids[2]}`))).status, 200);
  assert.deepEqual(await state(), [[ids[0], 0, false], [ids[3], 1, true], [ids[1], 2, false]]);

  // permissions
  const mgr = await makeManagerUser(reg, h, ownerA, [g.gymId]);
  assert.equal(code(await reorder(mgr.token, g.gymId, [ids[0], ids[3], ids[1]])), 'OWNER_ROLE_REQUIRED');
  assert.equal(code(await cover(mgr.token, g.gymId, ids[0])), 'OWNER_ROLE_REQUIRED');
  assert.equal(code(await reorder(ownerB.token, g.gymId, [ids[0], ids[3], ids[1]])), 'GYM_NOT_FOUND');
  assert.equal(code(await cover(ownerB.token, g.gymId, ids[0])), 'GYM_NOT_FOUND');
  assert.equal((await reorder(null, g.gymId, [ids[0]])).status, 401);
  assert.deepEqual(await state(), [[ids[0], 0, false], [ids[3], 1, true], [ids[1], 2, false]], 'none of that changed anything');

  // the first approval publishes them in the wizard's order with the chosen cover
  assert.equal((await h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}/status`, { status: 'APPROVED' })).status, 200);
  const published = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(published.map((p) => [p.id, p.sortOrder, p.isCover]), [[ids[0], 0, false], [ids[3], 1, true], [ids[1], 2, false]]);

  // a branch that left DRAFT: 409 GYM_NOT_DRAFT (its photos are ordered inside the revision payload)
  for (const gymId of [g.gymId, await gymWith('PENDING_REVIEW'), await gymWith('APPROVED', 'PERMANENTLY_CLOSED')]) {
    const r = await reorder(ownerA.token, gymId, [ids[0]]);
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(code(r), 'GYM_NOT_DRAFT');
    assert.equal(code(await cover(ownerA.token, gymId, ids[0])), 'GYM_NOT_DRAFT');
  }
});

// ═══ 5. icons ═════════════════════════════════════════════════════════════════════════════════════

test('icon allowlist: the 18 SYSTEM keys + 12 general ones = 30 unique lucide-style keys; the admin endpoints accept them all and refuse anything else', async () => {
  assert.equal(AMENITY_ICON_KEYS.length, 30);
  assert.equal(new Set(AMENITY_ICON_KEYS).size, 30);
  assert.deepEqual(AMENITY_ICON_KEYS.slice(0, 18), SYSTEM_AMENITY_SEEDS.map((s) => s.iconKey));
  assert.deepEqual(AMENITY_ICON_KEYS.slice(18), ['bike', 'coffee', 'sparkles', 'sun', 'music', 'star', 'footprints', 'trophy', 'timer', 'zap', 'medal', 'utensils']);
  for (const k of AMENITY_ICON_KEYS) assert.match(k, /^[a-z]+(-[a-z]+)*$/);

  const list = await h.call(admin.token, 'GET', `/admin/amenities?q=${encodeURIComponent(P)}`);
  assert.deepEqual(list.json.data.iconKeys, [...AMENITY_ICON_KEYS]);
  let n = 0;
  for (const key of AMENITY_ICON_KEYS.slice(18)) {
    const r = await h.call(admin.token, 'POST', '/admin/amenities', { name: `${P} biểu tượng ${n++}`, category: 'SERVICE', iconKey: key });
    assert.equal(r.status, 201, `${key}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.data.amenity.iconKey, key);
  }
  const bad = await h.call(admin.token, 'POST', '/admin/amenities', { name: `${P} biểu tượng lạ`, category: 'SERVICE', iconKey: 'rocket' });
  assert.equal(code(bad), 'ICON_NOT_ALLOWED');
});

// ═══ 6. first approval = listing v1 ═══════════════════════════════════════════════════════════════

test('first approval sets listing_version = 1 and listing_published_at (status route AND applyGymApprovalTx); a re-approval from SUSPENDED changes neither', async () => {
  for (const from of ['PENDING_REVIEW', 'REJECTED'] as const) {
    const gymId = await gymWith(from);
    const before = await gymRow(gymId);
    assert.equal(before.listingVersion, 0);
    assert.equal(before.listingPublishedAt, null);
    const t0 = Date.now();
    const r = await h.call(admin.token, 'PATCH', `/admin/gyms/${gymId}/status`, { status: 'APPROVED' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const after = await gymRow(gymId);
    assert.equal(after.status, 'APPROVED');
    assert.equal(after.listingVersion, 1, `${from} -> APPROVED`);
    assert.ok(after.listingPublishedAt && after.listingPublishedAt.getTime() >= t0 - 1000, 'listing_published_at = now');
  }

  // the application-approval path
  const { applyGymApprovalTx } = await import('../services/gym-approval.tx');
  const draft = await gymWith('DRAFT');
  await prisma.$transaction((tx) => applyGymApprovalTx(tx, draft));
  const d = await gymRow(draft);
  assert.equal(d.status, 'APPROVED');
  assert.equal(d.listingVersion, 1);
  assert.ok(d.listingPublishedAt);

  // SUSPENDED -> APPROVED: untouched
  const susp = await gymWith('SUSPENDED');
  const stamp = new Date('2026-01-02T03:04:05Z');
  await seed((tx) => tx.gym.update({ where: { id: susp }, data: { listingVersion: 4, listingPublishedAt: stamp, approvedName: 'Đã duyệt', approvedAddress: 'Đã duyệt' } }));
  assert.equal((await h.call(admin.token, 'PATCH', `/admin/gyms/${susp}/status`, { status: 'APPROVED' })).status, 200);
  const s = await gymRow(susp);
  assert.equal(s.status, 'APPROVED');
  assert.equal(s.listingVersion, 4);
  assert.equal(s.listingPublishedAt!.getTime(), stamp.getTime());
  await prisma.$transaction((tx) => applyGymApprovalTx(tx, susp));
  assert.equal((await gymRow(susp)).listingVersion, 4, 'applyGymApprovalTx on an already-public branch changes nothing either');

  // and a freshly approved branch can immediately take a revision at base version 1
  const fresh = await gymWith('PENDING_REVIEW');
  await h.call(admin.token, 'PATCH', `/admin/gyms/${fresh}/status`, { status: 'APPROVED' });
  const d2 = await h.call(ownerA.token, 'POST', L(fresh, '/draft'), {});
  assert.equal(d2.status, 201);
  assert.equal(d2.json.data.revision.baseVersion, 1);
});

test('no follow-up path produced a WRITER_ABSENT compat event', async () => {
  const events = await prisma.legacyCompatEvent.findMany({ where: { outcome: 'WRITER_ABSENT', entityId: { in: [...reg.gyms, ...reg.partners] } } });
  assert.deepEqual(events.map((e) => `${e.entityType}:${e.action}:${e.entityId}`), []);
});
