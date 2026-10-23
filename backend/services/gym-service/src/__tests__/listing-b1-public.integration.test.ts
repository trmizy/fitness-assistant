/**
 * REAL HTTP/API on the real Express app (src/app.ts) + a fake auth-service + the isolated test database.
 * Listing Management B1, public read side:
 *   - ONE visibility rule (gymPublicWhere) on every public route, including the new /media/gym-photos and the
 *     checked /uploads/gym-photos replacement of express.static;
 *   - the public DTO allowlist (no pending* / changesRequested* / owner or audit columns), amenities[] ACTIVE only,
 *     photos PUBLISHED only, stable /media URLs, reader order;
 *   - STAGED / RETIRED / DISCARDED photos are never reachable (JSON or bytes).
 * Evidence label: BACKEND INTEGRATION (real service code and DB; auth-service and S3 presigning are TEST FIXTURES).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { guardedTest as test, skip } from './test-db-guard';
import {
  PHOTO_DIR, allKeys, cleanupRegistry, makeAcceptedCollaboration, makeGym, makeOwner, makePhoto, makePublicContent,
  newRegistry, seed,
} from './listing-b1.test-helpers';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4061';

const reg = newRegistry();
let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let partnerS3: typeof import('../services/partner-s3.service').partnerS3;
let originalPresign: typeof partnerS3.presignGet;
const PT_USER = `pt-${randomUUID()}`;

interface Fx {
  visible: string;
  visiblePhotos: { cover: string; second: string; staged: string; retired: string; discarded: string; s3: string };
  hidden: Record<string, { gymId: string; photoId: string; fileName: string }>;
}
const fx = {} as Fx;

async function get(p: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${p}`, { redirect: 'manual', ...init });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json, text };
}

test.before(async () => {
  if (skip) return;
  authServer = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => authServer.listen(4061, '127.0.0.1', r));

  prisma = (await import('../repositories/prisma')).prisma;
  ({ partnerS3 } = await import('../services/partner-s3.service'));
  originalPresign = partnerS3.presignGet;
  const app = (await import('../app')).default;
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;

  // ── one fully visible gym with the whole photo zoo ──
  const owner = await makeOwner(reg);
  fx.visible = await makeGym(reg, {
    ownerId: owner.ownerId, brandId: owner.brandId, name: 'Visible Gym', withPendingOverlay: true,
    amenities: ['SAUNA', 'FREE_WEIGHTS', 'WIFI'],
  });
  await makePublicContent(reg, fx.visible, owner.brandId);
  const t = (n: number) => new Date(`2026-05-0${n}T00:00:00Z`);
  const second = await makePhoto(reg, { gymId: fx.visible, sortOrder: 1, createdAt: t(2) });
  const cover = await makePhoto(reg, { gymId: fx.visible, isCover: true, sortOrder: 5, createdAt: t(3) });
  const s3 = await makePhoto(reg, { gymId: fx.visible, storage: 's3', sortOrder: 2, createdAt: t(4) });
  const staged = await makePhoto(reg, { gymId: fx.visible, status: 'STAGED', sortOrder: 0, createdAt: t(1) });
  const retired = await makePhoto(reg, { gymId: fx.visible, status: 'RETIRED', sortOrder: 0, createdAt: t(1) });
  const discarded = await makePhoto(reg, { gymId: fx.visible, status: 'DISCARDED', sortOrder: 0, createdAt: t(1) });
  fx.visiblePhotos = { cover: cover.id, second: second.id, staged: staged.id, retired: retired.id, discarded: discarded.id, s3: s3.id };
  await makeAcceptedCollaboration(fx.visible, PT_USER);

  // ── one hidden gym per way of being hidden, each with PUBLISHED content that would otherwise show ──
  const hiddenOwner = await makeOwner(reg);
  const suspendedOwner = await makeOwner(reg, { partnerStatus: 'SUSPENDED' });
  const terminatedOwner = await makeOwner(reg, { partnerStatus: 'TERMINATED' });
  const variants: Array<[string, Parameters<typeof makeGym>[1]]> = [
    ['DRAFT', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, status: 'DRAFT' }],
    ['PENDING_REVIEW', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, status: 'PENDING_REVIEW' }],
    ['REJECTED', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, status: 'REJECTED' }],
    ['SUSPENDED', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, status: 'SUSPENDED' }],
    ['TEMPORARILY_CLOSED', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, operationalStatus: 'TEMPORARILY_CLOSED' }],
    ['PERMANENTLY_CLOSED', { ownerId: hiddenOwner.ownerId, brandId: hiddenOwner.brandId, operationalStatus: 'PERMANENTLY_CLOSED' }],
    ['PARTNER_SUSPENDED', { ownerId: suspendedOwner.ownerId, brandId: suspendedOwner.brandId }],
    ['PARTNER_TERMINATED', { ownerId: terminatedOwner.ownerId, brandId: terminatedOwner.brandId }],
  ];
  for (const [label, seedGym] of variants) {
    const gymId = await makeGym(reg, seedGym);
    const photo = await makePhoto(reg, { gymId, isCover: true });
    await makePublicContent(reg, gymId, seedGym.brandId);
    await makeAcceptedCollaboration(gymId, PT_USER);
    fx.hidden = { ...(fx.hidden ?? {}), [label]: { gymId, photoId: photo.id, fileName: photo.fileName } };
  }
});

test.after(async () => {
  if (skip) return;
  partnerS3.presignGet = originalPresign;
  await cleanupRegistry(reg);
  await prisma.$disconnect();
  await new Promise<void>((r) => authServer.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
});

// ── visibility matrix ─────────────────────────────────────────────────────────────────────

test('visible gym: list, detail, plans, trainers, reviews and /pt/:id/gyms all answer', async () => {
  const list = await get('/gyms');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((g: any) => g.id === fx.visible));

  const detail = await get(`/gyms/${fx.visible}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.id, fx.visible);

  const plans = await get(`/gyms/${fx.visible}/plans`);
  assert.equal(plans.status, 200);
  assert.equal(plans.json.data.length, 1);
  const trainers = await get(`/gyms/${fx.visible}/trainers`);
  assert.equal(trainers.status, 200);
  assert.equal(trainers.json.data.length, 1);
  const reviews = await get(`/gyms/${fx.visible}/reviews`);
  assert.equal(reviews.status, 200);
  assert.equal(reviews.json.data.count, 1);

  const pt = await get(`/pt/${PT_USER}/gyms`);
  assert.equal(pt.status, 200);
  assert.ok(pt.json.data.some((r: any) => r.gym.id === fx.visible));
});

for (const label of ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'SUSPENDED', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED', 'PARTNER_SUSPENDED', 'PARTNER_TERMINATED']) {
  test(`hidden gym (${label}): absent from the list, 404 on id / plans / trainers / reviews / media / legacy file, filtered from /pt/:id/gyms`, async () => {
    const h = fx.hidden[label];
    const list = await get('/gyms');
    assert.ok(!list.json.data.some((g: any) => g.id === h.gymId), 'listed');

    for (const p of [`/gyms/${h.gymId}`, `/gyms/${h.gymId}/plans`, `/gyms/${h.gymId}/trainers`, `/gyms/${h.gymId}/reviews`]) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.json?.success, false, p);
    }
    const media = await get(`/media/gym-photos/${h.photoId}`);
    assert.equal(media.status, 404, 'media of a hidden gym');
    const legacy = await get(`/uploads/gym-photos/${h.fileName}`);
    assert.equal(legacy.status, 404, 'legacy static URL of a hidden gym');

    const pt = await get(`/pt/${PT_USER}/gyms`);
    assert.ok(!pt.json.data.some((r: any) => r.gym.id === h.gymId), 'offered to a PT');
  });
}

test('unknown ids answer 404 everywhere', async () => {
  const id = randomUUID();
  for (const p of [`/gyms/${id}`, `/gyms/${id}/plans`, `/gyms/${id}/trainers`, `/gyms/${id}/reviews`, `/media/gym-photos/${id}`, `/uploads/gym-photos/nope.jpg`]) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('visibility follows the data: a gym that leaves APPROVED/OPEN disappears at once, and comes back', async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  const photo = await makePhoto(reg, { gymId, isCover: true });
  assert.equal((await get(`/gyms/${gymId}`)).status, 200);
  assert.equal((await get(`/media/gym-photos/${photo.id}`)).status, 200);

  await seed((tx) => tx.gym.update({ where: { id: gymId }, data: { operationalStatus: 'TEMPORARILY_CLOSED' } }));
  assert.equal((await get(`/gyms/${gymId}`)).status, 404);
  assert.equal((await get(`/media/gym-photos/${photo.id}`)).status, 404);

  await seed((tx) => tx.gym.update({ where: { id: gymId }, data: { operationalStatus: 'OPEN' } }));
  assert.equal((await get(`/gyms/${gymId}`)).status, 200);
  assert.equal((await get(`/media/gym-photos/${photo.id}`)).status, 200);
});

// ── DTO ───────────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = [
  'pendingName', 'pendingAddress', 'pendingNameNote', 'pendingAddressNote', 'changesRequestedAt', 'changesRequestedBy',
  'ownerId', 'wizardStep', 'closedBy', 'closedAt', 'reopenedAt', 'listingVersion', 'listingPublishedAt', 'legacyClientAt',
  'legacyNoAmenities', 'createdFlowVersion', 'logoKey', 's3Key', 'fileName', 'isPreview', 'revisionStatus', 'visibility',
];

test('public DTO: no pending*/changesRequested*/owner/audit/preview keys anywhere, in list or detail (brand included)', async () => {
  const list = await get('/gyms');
  const inList = list.json.data.find((g: any) => g.id === fx.visible);
  const detail = await get(`/gyms/${fx.visible}`);
  for (const [where, value] of [['list', inList], ['detail', detail.json.data]] as const) {
    const keys = allKeys(value);
    for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${where}: leaked key ${k}`);
    assert.ok(!JSON.stringify(value).includes('SECRET'), `${where}: a pending value leaked`);
  }
});

test('public DTO: name/address are the approved ones, brand uses its approved name, mirror + amenities are present', async () => {
  const d = (await get(`/gyms/${fx.visible}`)).json.data;
  assert.equal(d.name, 'Visible Gym');
  assert.equal(d.address, 'Addr 1');
  assert.equal(d.brand.name, 'B1 Brand');
  assert.equal(d.brand.facebookUrl, 'https://facebook.com/b1');
  assert.ok(!('pendingName' in d.brand));
  assert.equal(d.brand.logoUrl, null);
  assert.deepEqual([...d.facilities].sort(), ['FREE_WEIGHTS', 'SAUNA', 'WIFI'], 'facilities mirror kept for old clients');
  assert.deepEqual(
    d.amenities.map((a: any) => a.slug),
    ['FREE_WEIGHTS', 'SAUNA', 'WIFI'],
    'amenities in catalogue sort order',
  );
  assert.deepEqual(Object.keys(d.amenities[0]).sort(), ['category', 'iconKey', 'name', 'slug']);
  assert.deepEqual(d.amenities[0], { slug: 'FREE_WEIGHTS', name: 'Tạ tự do', category: 'TRAINING_ZONE', iconKey: 'dumbbell' });
  assert.equal(d.averageRating, 5);
  assert.equal(d.reviewCount, 1);
});

test('public DTO: a DISABLED catalogue amenity is filtered out of amenities[] (and a CUSTOM ACTIVE one is shown)', async () => {
  const custom = await prisma.amenity.create({
    data: { slug: `custom-${randomUUID().slice(0, 8)}`, name: 'Phòng boxing B1', nameNormalized: `phong boxing b1 ${randomUUID()}`, category: 'TRAINING_ZONE', iconKey: 'dumbbell', source: 'CUSTOM', status: 'ACTIVE', sortOrder: 999 },
  });
  reg.amenities.push(custom.id);
  const disabled = await prisma.amenity.create({
    data: { slug: `custom-${randomUUID().slice(0, 8)}`, name: 'Đã tắt B1', nameNormalized: `da tat b1 ${randomUUID()}`, category: 'SERVICE', iconKey: 'users', source: 'CUSTOM', status: 'DISABLED', sortOrder: 998 },
  });
  reg.amenities.push(disabled.id);
  await prisma.gymAmenity.createMany({ data: [{ gymId: fx.visible, amenityId: custom.id }, { gymId: fx.visible, amenityId: disabled.id }] });
  try {
    const d = (await get(`/gyms/${fx.visible}`)).json.data;
    const slugs = d.amenities.map((a: any) => a.slug);
    assert.ok(slugs.includes(custom.slug), 'ACTIVE custom shown');
    assert.ok(!slugs.includes(disabled.slug), 'DISABLED hidden');
    assert.deepEqual([...d.facilities].sort(), ['FREE_WEIGHTS', 'SAUNA', 'WIFI'], 'custom amenities never enter the mirror');
  } finally {
    await prisma.gymAmenity.deleteMany({ where: { amenityId: { in: [custom.id, disabled.id] } } });
  }
});

test('public DTO: detail photos are PUBLISHED only, cover first then (sort_order, created_at, id), on stable /media URLs', async () => {
  const d = (await get(`/gyms/${fx.visible}`)).json.data;
  const p = fx.visiblePhotos;
  assert.deepEqual(d.photos.map((x: any) => x.id), [p.cover, p.second, p.s3]);
  for (const photo of d.photos) {
    assert.equal(photo.url, `/media/gym-photos/${photo.id}`);
    assert.deepEqual(Object.keys(photo).sort(), ['category', 'id', 'isCover', 'url']);
  }
  const text = JSON.stringify(d);
  for (const hiddenId of [p.staged, p.retired, p.discarded]) assert.ok(!text.includes(hiddenId), `${hiddenId} must not appear`);
  assert.equal(d.photos[0].isCover, true);
});

test('public DTO: the list carries coverPhotoUrl (the PUBLISHED cover) but not the gallery', async () => {
  const g = (await get('/gyms')).json.data.find((x: any) => x.id === fx.visible);
  assert.equal(g.coverPhotoUrl, `/media/gym-photos/${fx.visiblePhotos.cover}`);
  assert.ok(!('photos' in g));
  assert.ok(Array.isArray(g.amenities));
});

test('public DTO: a gym whose only photos are STAGED has no cover and an empty gallery', async () => {
  const owner = await makeOwner(reg);
  const gymId = await makeGym(reg, { ownerId: owner.ownerId, brandId: owner.brandId });
  await makePhoto(reg, { gymId, status: 'STAGED', isCover: true });
  const g = (await get('/gyms')).json.data.find((x: any) => x.id === gymId);
  assert.equal(g.coverPhotoUrl, null);
  assert.deepEqual((await get(`/gyms/${gymId}`)).json.data.photos, []);
});

// ── media ─────────────────────────────────────────────────────────────────────────────────

test('media: a PUBLISHED disk photo streams its bytes with Cache-Control: private, max-age=300', async () => {
  const bytes = Buffer.from('PUBLISHED-DISK-BYTES');
  const photo = await makePhoto(reg, { gymId: fx.visible, bytes, sortOrder: 40 });
  const r = await get(`/media/gym-photos/${photo.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.text, 'PUBLISHED-DISK-BYTES');
  assert.equal(r.headers.get('cache-control'), 'private, max-age=300');
  assert.match(r.headers.get('content-type') ?? '', /image\/jpeg/);
});

test('media: a PUBLISHED S3 photo answers 302 to a 10-minute presigned URL, Cache-Control: private, max-age=300', async () => {
  const calls: Array<{ key: string; expiresSec?: number; attachment?: boolean }> = [];
  partnerS3.presignGet = (async (params: any) => {
    calls.push(params);
    return `https://minio.test/${params.key}?X-Amz-Expires=${params.expiresSec}`;
  }) as typeof partnerS3.presignGet;
  try {
    const r = await get(`/media/gym-photos/${fx.visiblePhotos.s3}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('cache-control'), 'private, max-age=300');
    assert.equal(r.headers.get('location'), `https://minio.test/listing-photos/${fx.visiblePhotos.s3}.webp?X-Amz-Expires=600`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expiresSec, 600);
    assert.equal(calls[0].attachment, false);
  } finally {
    partnerS3.presignGet = originalPresign;
  }
});

test('media: when presigning fails the answer is 503 JSON, never a redirect', async () => {
  partnerS3.presignGet = (async () => {
    throw new Error('minio down');
  }) as typeof partnerS3.presignGet;
  try {
    const r = await get(`/media/gym-photos/${fx.visiblePhotos.s3}`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('location'), null);
  } finally {
    partnerS3.presignGet = originalPresign;
  }
});

test('media: STAGED, RETIRED and DISCARDED photos are 404 - even when the gym is public and the file is on disk', async () => {
  const p = fx.visiblePhotos;
  for (const id of [p.staged, p.retired, p.discarded]) {
    const r = await get(`/media/gym-photos/${id}`);
    assert.equal(r.status, 404, id);
    assert.ok(!r.text.includes('fake-jpeg'), 'no bytes');
  }
});

test('media: a RETIRED disk file stays unreachable through the OLD static URL too (express.static is gone)', async () => {
  const retired = await prisma.gymPhoto.findUniqueOrThrow({ where: { id: fx.visiblePhotos.retired } });
  assert.ok(fs.existsSync(path.join(PHOTO_DIR, retired.fileName)), 'the file really is on disk');
  assert.equal((await get(`/uploads/gym-photos/${retired.fileName}`)).status, 404);
  const staged = await prisma.gymPhoto.findUniqueOrThrow({ where: { id: fx.visiblePhotos.staged } });
  assert.equal((await get(`/uploads/gym-photos/${staged.fileName}`)).status, 404);
});

test('legacy /uploads/gym-photos/:file serves a PUBLISHED disk photo of a visible gym, with the same cache header', async () => {
  const photo = await makePhoto(reg, { gymId: fx.visible, bytes: Buffer.from('LEGACY-URL-BYTES'), sortOrder: 41 });
  const r = await get(`/uploads/gym-photos/${photo.fileName}`);
  assert.equal(r.status, 200);
  assert.equal(r.text, 'LEGACY-URL-BYTES');
  assert.equal(r.headers.get('cache-control'), 'private, max-age=300');
});

test('legacy /uploads/gym-photos/:file never serves a file that is not a PUBLISHED database row (traversal, stray files)', async () => {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const stray = path.join(PHOTO_DIR, `stray-${randomUUID()}.jpg`);
  fs.writeFileSync(stray, 'STRAY');
  reg.files.push(stray);
  assert.equal((await get(`/uploads/gym-photos/${path.basename(stray)}`)).status, 404, 'a file with no row');
  for (const attempt of ['..%2Fpackage.json', '..%2F..%2Fpackage.json', '%2e%2e%2fpackage.json']) {
    const r = await get(`/uploads/gym-photos/${attempt}`);
    assert.ok(r.status === 404 || r.status === 400, `${attempt} -> ${r.status}`);
    assert.ok(!r.text.includes('"name"'), 'no file content');
  }
});

test('media: the cover/gallery URLs from the detail DTO actually resolve', async () => {
  const d = (await get(`/gyms/${fx.visible}`)).json.data;
  const first = d.photos[0];
  const r = await get(first.url);
  // the cover is a disk photo here
  assert.equal(r.status, 200);
});
