/**
 * Listing Management D1 follow-up - GET /admin/listings/gyms/:gymId (the current published listing of a branch,
 * with or without any revision).
 * Evidence label: BACKEND INTEGRATION - real Express app + real `*_test` database; auth-service and object storage are
 * TEST FIXTURES (see listing-b2.test-helpers.ts).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/listing-d1-admin-read.integration.test.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { setListingPhotoStorage } from '../services/listing-photo-storage';
import {
  MemoryListingStorage,
  cleanupAll,
  makeAdminUser,
  makeCustomerUser,
  makeGym,
  makeOwnerUser,
  makePublishedGym,
  newRegistry,
  seedPhoto,
  startHarness,
  type Harness,
  type OwnerFx,
} from './listing-b2.test-helpers';

const reg = newRegistry();
const storage = new MemoryListingStorage();
const PREFIX = `d1read ${randomUUID().slice(0, 6)}`;
let restoreStorage: () => void;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let owner: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;
let customer: ReturnType<typeof makeCustomerUser>;

test.before(async () => {
  if (skip) return;
  restoreStorage = setListingPhotoStorage(storage);
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  owner = await makeOwnerUser(reg, h, 'D1');
  admin = makeAdminUser(h, 'd1');
  customer = makeCustomerUser(h);
});
test.after(async () => {
  if (skip) return;
  restoreStorage();
  await h.stop();
  await cleanupAll(reg, { adminIds: [admin.adminId], amenityNamePrefix: PREFIX.toLowerCase() });
  await prisma.$disconnect();
});

const read = (gymId: string, token: string | null = admin.token) => h.call(token, 'GET', `/admin/listings/gyms/${gymId}`);

test('admin 200: shape, PUBLISHED photos only, custom + disabled amenities included, no revision needed', async () => {
  const { gymId, photoIds } = await makePublishedGym(reg, storage, owner, { photos: 3, amenities: ['WIFI', 'SAUNA'], description: 'Mô tả D1' });
  // a STAGED and a RETIRED photo must not show
  await seedPhoto(storage, gymId, 'STAGED');
  await seedPhoto(storage, gymId, 'RETIRED', { retiredAt: new Date() });
  // a custom amenity (admin-created) that was later switched off, still on the branch
  const created = await h.call(admin.token, 'POST', '/admin/amenities', { name: `${PREFIX} boxing`, category: 'TRAINING_ZONE', iconKey: 'trophy' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const custom = created.json.data.amenity;
  await prisma.gymAmenity.create({ data: { gymId, amenityId: custom.id } });
  await prisma.amenity.update({ where: { id: custom.id }, data: { status: 'DISABLED' } });
  assert.equal(await prisma.gymListingRevision.count({ where: { gymId } }), 0, 'the fixture has no revision');

  const r = await read(gymId);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('cache-control'), 'no-store, private');
  const d = r.json.data;
  assert.equal(r.json.success, true);
  assert.deepEqual(Object.keys(d).sort(), ['amenities', 'gym', 'openRevision', 'photos', 'published']);
  assert.deepEqual(Object.keys(d.gym).sort(), ['brandName', 'id', 'listingPublishedAt', 'listingVersion', 'name', 'operationalStatus', 'status']);
  assert.equal(d.gym.id, gymId);
  assert.equal(d.gym.listingVersion, 1);
  assert.equal(d.gym.status, 'APPROVED');
  assert.equal(d.gym.operationalStatus, 'OPEN');
  assert.deepEqual(Object.keys(d.published).sort(), ['amenityIds', 'coverPhotoId', 'description', 'photoIds']);
  assert.equal(d.published.description, 'Mô tả D1');
  assert.deepEqual(d.published.photoIds, photoIds);
  assert.equal(d.published.coverPhotoId, photoIds[0]);
  assert.equal(d.published.amenityIds.length, 3);
  assert.ok(d.published.amenityIds.includes(custom.id));
  assert.equal(d.amenities.length, 3);
  const c = d.amenities.find((a: any) => a.id === custom.id);
  assert.equal(c.status, 'DISABLED');
  assert.equal(c.source, 'CUSTOM');
  assert.deepEqual(d.photos.map((p: any) => p.id), photoIds);
  assert.ok(d.photos.every((p: any) => p.status === 'PUBLISHED' && String(p.url).startsWith('/media/gym-photos/')));
  assert.equal(d.openRevision, null);
});

test('openRevision: the open DRAFT is reported as {id, status}', async () => {
  const { gymId } = await makePublishedGym(reg, storage, owner, { photos: 1 });
  const created = await h.call(owner.token, 'POST', `/owner/gyms/${gymId}/listing/draft`, {});
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const r = await read(gymId);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.openRevision, { id: created.json.data.revision.id, status: 'DRAFT' });
});

test('no PII / internal columns anywhere in the body', async () => {
  const { gymId } = await makePublishedGym(reg, storage, owner, { photos: 1 });
  const body = JSON.stringify((await read(gymId)).json);
  for (const banned of ['ownerId', 'phone', 'email', 'pendingName', 'changesRequested', 's3Key', 'fileName', 'contentHash', 'uploadedBy', 'ipAddress', 'userAgent', 'password']) {
    assert.ok(!body.includes(banned), `"${banned}" leaked`);
  }
});

test('authorization: non-admin -> 403 (customer, owner), anonymous -> 401', async () => {
  const { gymId } = await makePublishedGym(reg, storage, owner, { photos: 0 });
  assert.equal((await read(gymId, customer.token)).status, 403);
  assert.equal((await read(gymId, owner.token)).status, 403);
  assert.equal((await read(gymId, null)).status, 401);
});

test('eligibility: unknown 404; DRAFT 409 GYM_IS_DRAFT; PENDING_REVIEW / REJECTED / permanently closed 409 LISTING_NOT_AVAILABLE; SUSPENDED + temporarily closed 200', async () => {
  assert.equal((await read(randomUUID())).status, 404);
  const draft = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'DRAFT' });
  const r = await read(draft);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'GYM_IS_DRAFT');
  for (const status of ['PENDING_REVIEW', 'REJECTED'] as const) {
    const g = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status });
    const x = await read(g);
    assert.equal(x.status, 409, status);
    assert.equal(x.json.error.code, 'LISTING_NOT_AVAILABLE', status);
  }
  const closed = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'APPROVED', operationalStatus: 'PERMANENTLY_CLOSED' });
  assert.equal((await read(closed)).json.error.code, 'LISTING_NOT_AVAILABLE');
  const suspended = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'SUSPENDED' });
  const s = await read(suspended);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.data.gym.status, 'SUSPENDED');
  const temp = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' });
  assert.equal((await read(temp)).status, 200);
});

test('the data it returns is what a direct edit needs: quoting its listingVersion succeeds, a wrong one is 409 LISTING_STALE', async () => {
  const { gymId, photoIds } = await makePublishedGym(reg, storage, owner, { photos: 2 });
  const d = (await read(gymId)).json.data;
  const stale = await h.call(admin.token, 'POST', `/admin/listings/gyms/${gymId}/direct-edit`, {
    description: 'Mới',
    reason: 'Cập nhật mô tả theo yêu cầu',
    expectedListingVersion: d.gym.listingVersion + 5,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'LISTING_STALE');
  const ok = await h.call(admin.token, 'POST', `/admin/listings/gyms/${gymId}/direct-edit`, {
    description: 'Mới',
    photoIds: [...photoIds].reverse(),
    reason: 'Cập nhật mô tả theo yêu cầu',
    expectedListingVersion: d.gym.listingVersion,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const after = (await read(gymId)).json.data;
  assert.equal(after.gym.listingVersion, d.gym.listingVersion + 1);
  assert.equal(after.published.description, 'Mới');
});
