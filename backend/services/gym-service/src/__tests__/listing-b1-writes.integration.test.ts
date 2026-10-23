/**
 * REAL HTTP/API on the real Express app + a fake auth-service + the isolated test database.
 * Listing Management B1, the WRITE side that the plan replaces or closes:
 *   - owner PATCH /owner/gyms/:id: description / facilities on a branch that has left DRAFT -> 409 LISTING_REVIEW_REQUIRED
 *     (gym unchanged, client_compat_events recorded); other fields still free;
 *   - the disk-photo routes POST / PUT / PATCH / DELETE /owner/gyms/:id/photos* -> 410 UPLOAD_ROUTE_RETIRED for EVERY
 *     gym status, nothing written to disk or to gym_photos;
 *   - the DRAFT wizard keeps working, writes facilities to gym_amenities + the mirror, rejects unknown keys (.strict());
 *   - admin PATCH /admin/gyms/:id with `description` needs a `reason`;
 *   - syncFacilitiesMirrorTx (the only writer of gyms.facilities) and the photo publish on first approval.
 * Evidence label: BACKEND INTEGRATION (real service code and DB; auth-service is a TEST FIXTURE).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import { cleanupRegistry, makeGym, makeOwner, makePhoto, newRegistry, PHOTO_DIR, seed } from './listing-b1.test-helpers';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4062';

const reg = newRegistry();
let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let owner: { ownerId: string; partnerId: string; brandId: string };
const ADMIN_ID = randomUUID();
const USERS: Record<string, { id: string; role: string; email: string }> = {};

async function call(token: string | null, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

/** Files multer would have written (`<epoch ms>-<random>.<ext>`). Other test files share this directory and add their own
 * fixtures (`b1-*.jpg`, ...) concurrently, so only the multer naming pattern is a signal for "an upload reached the disk". */
const uploadedFiles = () =>
  new Set(fs.existsSync(PHOTO_DIR) ? fs.readdirSync(PHOTO_DIR).filter((f) => /^\d{10,}-\d+\.(jpe?g|png|webp)$/i.test(f)) : []);
const compatCount = async (outcome: string, since: Date) =>
  prisma.clientCompatEvent.count({ where: { outcome, createdAt: { gte: since } } });

test.before(async () => {
  if (skip) return;
  authServer = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    const user = USERS[token];
    if (req.method === 'POST' && req.url === '/auth/verify' && user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => authServer.listen(4062, '127.0.0.1', r));
  prisma = (await import('../repositories/prisma')).prisma;
  owner = await makeOwner(reg);
  USERS['tok-owner'] = { id: owner.ownerId, role: 'GYM_OWNER', email: 'owner@b1.test' };
  USERS['tok-admin'] = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@b1.test' };
  USERS['tok-customer'] = { id: randomUUID(), role: 'CUSTOMER', email: 'c@b1.test' };
  const app = (await import('../app')).default;
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (skip) return;
  await cleanupRegistry(reg);
  await prisma.$disconnect();
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

const ownerGym = (status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED', extra: Partial<Parameters<typeof makeGym>[1]> = {}) =>
  makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId, status, ...extra });

// ── owner PATCH: 409 LISTING_REVIEW_REQUIRED ─────────────────────────────────────────────

test('PATCH /owner/gyms/:id on an APPROVED gym: description -> 409 LISTING_REVIEW_REQUIRED, gym unchanged, event recorded', async () => {
  const gymId = await ownerGym('APPROVED', { description: 'Original', amenities: ['WIFI'] });
  const before = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const since = new Date();
  const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { description: 'Sneaky edit' }, { 'X-Gymini-Client': 'mobile/1.2.3/45' });
  assert.equal(r.status, 409);
  assert.equal(r.json.success, false);
  assert.equal(r.json.error.code, 'LISTING_REVIEW_REQUIRED');
  assert.match(r.json.error.message, /cần gửi duyệt/);
  assert.equal(r.json.message, r.json.error.message, 'old builds read `message`');
  const after = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  assert.deepEqual(after, before, 'the gym row is untouched');

  const events = await prisma.clientCompatEvent.findMany({ where: { outcome: 'REVIEW_REQUIRED_409', createdAt: { gte: since }, actorUserId: owner.ownerId } });
  assert.equal(events.length, 1);
  assert.equal(events[0].clientHeader, 'mobile/1.2.3/45');
  assert.match(events[0].route, /PATCH .*\/gyms\/:id/);
});

test('PATCH /owner/gyms/:id on an APPROVED gym: facilities -> 409; a body mixing allowed + refused fields writes NOTHING', async () => {
  const gymId = await ownerGym('APPROVED', { amenities: ['WIFI'] });
  const before = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const r1 = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { facilities: ['SAUNA'] });
  assert.equal(r1.status, 409);
  assert.equal(r1.json.error.code, 'LISTING_REVIEW_REQUIRED');
  const r2 = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { phone: '0911111111', facilities: [] });
  assert.equal(r2.status, 409);
  const after = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  assert.deepEqual(after, before, 'phone was NOT applied either');
  assert.deepEqual(after.facilities, ['WIFI']);
  assert.equal(await prisma.gymAmenity.count({ where: { gymId } }), 1);
});

test('PATCH /owner/gyms/:id on an APPROVED gym: the other fields stay free edits (phone, email, city, locationNote)', async () => {
  const gymId = await ownerGym('APPROVED');
  const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { phone: '0922222222', email: 'x@y.co', city: 'Huế', locationNote: 'Cổng sau' });
  assert.equal(r.status, 200);
  const g = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  assert.equal(g.phone, '0922222222');
  assert.equal(g.city, 'Huế');
  assert.equal(g.locationNote, 'Cổng sau');
});

for (const status of ['PENDING_REVIEW', 'REJECTED'] as const) {
  test(`PATCH /owner/gyms/:id on a ${status} gym: description -> 409 as well ("not DRAFT" is the rule)`, async () => {
    const gymId = await ownerGym(status, { description: 'keep' });
    const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { description: 'change' });
    assert.equal(r.status, 409);
    assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).description, 'keep');
  });
}

test('PATCH /owner/gyms/:id on a DRAFT gym: description saves directly; facilities go to gym_amenities and the mirror', async () => {
  const gymId = await ownerGym('DRAFT', { description: null });
  const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}`, { description: 'Draft text', facilities: ['SAUNA', 'FREE_WEIGHTS', 'SAUNA'] });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.description, 'Draft text');
  assert.deepEqual(r.json.data.facilities, ['FREE_WEIGHTS', 'SAUNA'], 'mirror in catalogue order, duplicates collapsed');
  const rows = await prisma.gymAmenity.findMany({ where: { gymId }, include: { amenity: true } });
  assert.deepEqual(rows.map((x) => x.amenity.slug).sort(), ['FREE_WEIGHTS', 'SAUNA']);
});

// ── 410 UPLOAD_ROUTE_RETIRED ─────────────────────────────────────────────────────────────

for (const status of ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const) {
  test(`disk-photo write routes are 410 UPLOAD_ROUTE_RETIRED for a ${status} gym - nothing written to disk or gym_photos`, async () => {
    const gymId = await ownerGym(status);
    const existing = await makePhoto(reg, { gymId, status: status === 'APPROVED' ? 'PUBLISHED' : 'STAGED', isCover: true });
    const filesBefore = uploadedFiles();
    const photosBefore = await prisma.gymPhoto.findMany({ where: { gymId }, orderBy: { id: 'asc' } });
    const since = new Date();

    const calls: Array<[string, string, unknown?]> = [
      ['POST', `/owner/gyms/${gymId}/photos`, {}],
      ['PUT', `/owner/gyms/${gymId}/photos/reorder`, { orderedPhotoIds: [existing.id] }],
      ['PATCH', `/owner/gyms/${gymId}/photos/${existing.id}/cover`],
      ['DELETE', `/owner/gyms/${gymId}/photos/${existing.id}`],
    ];
    for (const [method, p, body] of calls) {
      const r = await call('tok-owner', method, p, body, { 'X-Gymini-Client': 'web/abc123' });
      assert.equal(r.status, 410, `${method} ${p}`);
      assert.equal(r.json.success, false);
      assert.equal(r.json.error.code, 'UPLOAD_ROUTE_RETIRED');
      assert.equal(r.json.message, r.json.error.message);
    }
    // A REAL multipart upload (what the old wizard sent): multer would have written it to uploads/gym-photos before the
    // handler ran. It must be answered 410 without the upload middleware ever seeing the body.
    const form = new FormData();
    form.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], { type: 'image/jpeg' }), 'x.jpg');
    const multipart = await fetch(`${base}/owner/gyms/${gymId}/photos`, { method: 'POST', headers: { authorization: 'Bearer tok-owner' }, body: form });
    assert.equal(multipart.status, 410);
    assert.deepEqual([...uploadedFiles()].filter((f) => !filesBefore.has(f)), [], 'no file reached the public disk');
    assert.deepEqual(await prisma.gymPhoto.findMany({ where: { gymId }, orderBy: { id: 'asc' } }), photosBefore);
    assert.ok((await compatCount('UPLOAD_RETIRED_410', since)) >= 4);
  });
}

test('the retired photo routes still require the owner role (a customer gets 403, not 410) and an owner can still LIST', async () => {
  const gymId = await ownerGym('DRAFT');
  assert.equal((await call('tok-customer', 'POST', `/owner/gyms/${gymId}/photos`, {})).status, 403);
  assert.equal((await call(null, 'DELETE', `/owner/gyms/${gymId}/photos/x`)).status, 401);
  assert.equal((await call('tok-owner', 'GET', `/owner/gyms/${gymId}/photos`)).status, 200);
});

// ── DRAFT wizard ─────────────────────────────────────────────────────────────────────────

test('wizard: create draft, save step by step (values stay unvalidated), facilities -> gym_amenities + mirror', async () => {
  const created = await call('tok-owner', 'POST', '/owner/gyms/draft', {});
  assert.equal(created.status, 201);
  const gymId = created.json.data.id as string;
  reg.gyms.push(gymId);
  assert.equal(created.json.data.status, 'DRAFT');

  const s1 = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { name: 'Gymini Q1', address: '', description: 'Mô tả', wizardStep: 2 });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.data.name, 'Gymini Q1');
  assert.equal(s1.json.data.address, '', 'empty address is accepted on a draft');
  assert.equal(s1.json.data.wizardStep, 2);

  const s2 = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, {
    city: null, phone: '0900', email: '', provinceCode: 79, wardCode: null, latitude: 10.7, longitude: 106.6, locationNote: 'Tầng 3',
    facilities: ['WIFI', 'PARKING'], wizardStep: 4,
  });
  assert.equal(s2.status, 200);
  assert.deepEqual([...s2.json.data.facilities].sort(), ['PARKING', 'WIFI']);
  assert.equal(await prisma.gymAmenity.count({ where: { gymId } }), 2);

  // Changing the selection replaces the SYSTEM rows; a CUSTOM amenity attached meanwhile survives.
  const custom = await prisma.amenity.create({
    data: { slug: `c-${randomUUID().slice(0, 8)}`, name: 'Tùy chỉnh B1', nameNormalized: `tuy chinh b1 ${randomUUID()}`, category: 'SERVICE', iconKey: 'users', source: 'CUSTOM' },
  });
  reg.amenities.push(custom.id);
  await prisma.gymAmenity.create({ data: { gymId, amenityId: custom.id } });
  const s3 = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { facilities: ['SAUNA'] });
  assert.deepEqual(s3.json.data.facilities, ['SAUNA']);
  const rows = await prisma.gymAmenity.findMany({ where: { gymId }, include: { amenity: true } });
  assert.deepEqual(rows.map((x) => x.amenity.slug).sort(), [custom.slug, 'SAUNA'].sort());

  const cleared = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { facilities: [] });
  assert.deepEqual(cleared.json.data.facilities, []);
  assert.equal(await prisma.gymAmenity.count({ where: { gymId } }), 1, 'only the custom amenity is left');
});

test('wizard: the draft body is STRICT - unknown keys and invalid facility values are 400, nothing is written', async () => {
  const gymId = await ownerGym('DRAFT');
  const before = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  for (const bad of [
    { status: 'APPROVED' },
    { ownerId: 'someone-else' },
    { listingVersion: 9 },
    { approvedName: 'Hacked' },
    { name: 'ok', amenities: ['x'] },
    { facilities: ['NOT_A_FACILITY'] },
    { wizardStep: 'three' },
  ]) {
    const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
  }
  const unknown = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { status: 'APPROVED' });
  assert.match(unknown.json.error.message, /Trường không được hỗ trợ khi lưu bản nháp: status/);
  assert.deepEqual(await prisma.gym.findUniqueOrThrow({ where: { id: gymId } }), before);
});

test('wizard: a DISABLED catalogue amenity cannot be attached to a draft (422 AMENITY_DISABLED), nothing changes', async () => {
  const gymId = await ownerGym('DRAFT', { amenities: ['WIFI'] });
  const before = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  await prisma.amenity.update({ where: { slug: 'VENDING_MACHINE' }, data: { status: 'DISABLED' } });
  try {
    const r = await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { facilities: ['WIFI', 'VENDING_MACHINE'], name: 'renamed' });
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'AMENITY_DISABLED');
  } finally {
    await prisma.amenity.update({ where: { slug: 'VENDING_MACHINE' }, data: { status: 'ACTIVE' } });
  }
  const after = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  assert.equal(after.name, before.name, 'the whole save rolled back, including the name');
  assert.deepEqual(after.facilities, ['WIFI']);
});

test('wizard: saving a draft that already left DRAFT is still refused (409)', async () => {
  const gymId = await ownerGym('PENDING_REVIEW');
  assert.equal((await call('tok-owner', 'PATCH', `/owner/gyms/${gymId}/draft`, { name: 'x' })).status, 409);
});

// ── admin PATCH: description needs a reason ──────────────────────────────────────────────

test('admin PATCH /admin/gyms/:id: description without a reason -> 400 REASON_REQUIRED; with a reason it still saves (B2 adds ADMIN_DIRECT)', async () => {
  // (a listing keeps at least one amenity: B2 follow-up, 422 AMENITIES_REQUIRED otherwise)
  const gymId = await ownerGym('APPROVED', { description: 'old', amenities: ['WIFI'] });
  const noReason = await call('tok-admin', 'PATCH', `/admin/gyms/${gymId}`, { description: 'new' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.error.code, 'REASON_REQUIRED');
  const blank = await call('tok-admin', 'PATCH', `/admin/gyms/${gymId}`, { description: 'new', reason: '   ' });
  assert.equal(blank.status, 400);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).description, 'old');

  const ok = await call('tok-admin', 'PATCH', `/admin/gyms/${gymId}`, { description: 'new', reason: 'Sửa lỗi chính tả theo yêu cầu chủ gym' });
  assert.equal(ok.status, 200);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).description, 'new');
});

test('admin PATCH /admin/gyms/:id: fields other than description need no reason; a non-admin is refused', async () => {
  const gymId = await ownerGym('APPROVED');
  const ok = await call('tok-admin', 'PATCH', `/admin/gyms/${gymId}`, { phone: '0933333333', city: 'Đà Nẵng' });
  assert.equal(ok.status, 200);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).phone, '0933333333');
  assert.equal((await call('tok-owner', 'PATCH', `/admin/gyms/${gymId}`, { phone: '1' })).status, 403);
});

// ── syncFacilitiesMirrorTx ───────────────────────────────────────────────────────────────

class Rollback extends Error {}

test('syncFacilitiesMirrorTx: mirror = ACTIVE SYSTEM amenities in catalogue order; DISABLED and CUSTOM never enter it', async () => {
  const { syncFacilitiesMirrorTx } = await import('../services/gym-amenity.service');
  const gymId = await ownerGym('APPROVED');
  const other = await ownerGym('APPROVED', { amenities: ['PARKING'] });
  const otherBefore = await prisma.gym.findUniqueOrThrow({ where: { id: other } });
  let seen: Record<string, string[]> = {};
  await assert.rejects(
    () =>
      seed(async (tx) => {
        const all = await tx.amenity.findMany({ where: { slug: { in: ['WIFI', 'SAUNA', 'FREE_WEIGHTS', 'VENDING_MACHINE'] } } });
        const custom = await tx.amenity.create({
          data: { slug: `c-${randomUUID().slice(0, 8)}`, name: 'Mirror custom', nameNormalized: `mirror custom ${randomUUID()}`, category: 'SERVICE', iconKey: 'users', source: 'CUSTOM' },
        });
        await tx.gymAmenity.createMany({ data: [...all.map((a) => ({ gymId, amenityId: a.id })), { gymId, amenityId: custom.id }] });
        await syncFacilitiesMirrorTx(tx, gymId);
        seen.all = (await tx.gym.findUniqueOrThrow({ where: { id: gymId } })).facilities;

        await tx.amenity.update({ where: { slug: 'WIFI' }, data: { status: 'DISABLED' } });
        await syncFacilitiesMirrorTx(tx, gymId);
        seen.wifiOff = (await tx.gym.findUniqueOrThrow({ where: { id: gymId } })).facilities;

        await tx.amenity.update({ where: { slug: 'WIFI' }, data: { status: 'ACTIVE' } });
        await tx.gymAmenity.deleteMany({ where: { gymId } });
        await syncFacilitiesMirrorTx(tx, gymId);
        seen.empty = (await tx.gym.findUniqueOrThrow({ where: { id: gymId } })).facilities;
        throw new Rollback();
      }),
    Rollback,
  );
  assert.deepEqual(seen.all, ['FREE_WEIGHTS', 'SAUNA', 'WIFI', 'VENDING_MACHINE']);
  assert.deepEqual(seen.wifiOff, ['FREE_WEIGHTS', 'SAUNA', 'VENDING_MACHINE']);
  assert.deepEqual(seen.empty, []);
  assert.deepEqual(await prisma.gym.findUniqueOrThrow({ where: { id: other } }), otherBefore, 'editing one gym never moves another');
});

// ── first approval publishes STAGED photos ───────────────────────────────────────────────

async function photoState(gymId: string) {
  return (await prisma.gymPhoto.findMany({ where: { gymId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })).map((p) => ({
    id: p.id, status: p.status, isCover: p.isCover, sortOrder: p.sortOrder,
  }));
}

test('gymRepository.updateStatus(APPROVED) on a PENDING_REVIEW gym publishes its STAGED photos: one cover, sort_order 0..n-1', async () => {
  const { gymRepository } = await import('../repositories/gym.repository');
  const gymId = await ownerGym('PENDING_REVIEW');
  const t = (n: number) => new Date(`2026-06-0${n}T00:00:00Z`);
  const a = await makePhoto(reg, { gymId, status: 'STAGED', isCover: true, sortOrder: 4, createdAt: t(2) });
  const b = await makePhoto(reg, { gymId, status: 'STAGED', isCover: true, sortOrder: 4, createdAt: t(1) });
  const c = await makePhoto(reg, { gymId, status: 'STAGED', sortOrder: 9, createdAt: t(3) });
  const retired = await makePhoto(reg, { gymId, status: 'RETIRED', sortOrder: 0 });

  await gymRepository.updateStatus(gymId, 'APPROVED');
  const state = await photoState(gymId);
  const live = state.filter((s) => s.id !== retired.id);
  assert.deepEqual(live.map((s) => s.id), [b.id, a.id, c.id], 'order kept');
  assert.deepEqual(live.map((s) => s.status), ['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
  assert.deepEqual(live.map((s) => s.isCover), [true, false, false], 'the first flagged photo is the only cover');
  assert.ok(state.find((s) => s.id === retired.id)!.status === 'RETIRED', 'a RETIRED photo stays RETIRED');

  const detail = await call(null, 'GET', `/gyms/${gymId}`);
  assert.deepEqual(detail.json.data.photos.map((p: any) => p.id), [b.id, a.id, c.id]);
});

test('re-approval (SUSPENDED -> APPROVED) does NOT publish STAGED photos (they belong to a later revision)', async () => {
  const { gymRepository } = await import('../repositories/gym.repository');
  const gymId = await ownerGym('APPROVED');
  const live = await makePhoto(reg, { gymId, isCover: true });
  await gymRepository.updateStatus(gymId, 'SUSPENDED');
  const staged = await makePhoto(reg, { gymId, status: 'STAGED', sortOrder: 5 });
  await gymRepository.updateStatus(gymId, 'APPROVED');
  const state = await photoState(gymId);
  assert.equal(state.find((s) => s.id === staged.id)!.status, 'STAGED');
  assert.equal(state.find((s) => s.id === live.id)!.status, 'PUBLISHED');
});

test('applyGymApprovalTx (application approval path) publishes the STAGED photos of the DRAFT branch too', async () => {
  const { applyGymApprovalTx } = await import('../services/gym-approval.tx');
  const gymId = await ownerGym('DRAFT');
  const p1 = await makePhoto(reg, { gymId, status: 'STAGED', isCover: true, sortOrder: 0 });
  const p2 = await makePhoto(reg, { gymId, status: 'STAGED', sortOrder: 1 });
  await prisma.$transaction((tx) => applyGymApprovalTx(tx, gymId));
  const state = await photoState(gymId);
  assert.deepEqual(state.map((s) => [s.id, s.status, s.isCover]), [[p1.id, 'PUBLISHED', true], [p2.id, 'PUBLISHED', false]]);
  assert.equal((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).status, 'APPROVED');
});
