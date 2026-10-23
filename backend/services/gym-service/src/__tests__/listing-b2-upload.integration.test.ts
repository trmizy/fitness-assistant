/**
 * Listing Management B2 - branch PHOTO UPLOAD (presign / confirm / delete) and the cleanup SWEEP (plan §12.2, §12.13).
 *
 * Evidence label: BACKEND INTEGRATION - real Express app + real `*_test` database + the REAL sharp decoder; object
 * storage is the in-memory adapter behind the storage port (TEST FIXTURE: no MinIO is wired in, so the S3 wire protocol
 * itself - presigned POST policy enforcement (the 8 MB + 1 B block), the anonymous-read bucket policy (403), real
 * HEAD / GET - is NOT exercised here).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_gym_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/listing-b2-upload.integration.test.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { guardedTest as test, skip } from './test-db-guard';
import { setListingPhotoStorage } from '../services/listing-photo-storage';
import {
  MemoryListingStorage,
  cleanupAll,
  hugeDimensionPng,
  jpegImage,
  makeAdminUser,
  makeOwnerUser,
  makePublishedGym,
  newRegistry,
  pngImage,
  seed,
  seedPhoto,
  sha256,
  startHarness,
  webpImage,
  type Harness,
  type OwnerFx,
  type Reply,
} from './listing-b2.test-helpers';

const reg = newRegistry();
const storage = new MemoryListingStorage();
let restoreStorage: () => void;
let h: Harness;
let prisma: typeof import('../repositories/prisma').prisma;
let runGymListingSweep: typeof import('../services/gym-listing-sweep.service').runGymListingSweep;
let ownerA: OwnerFx;
let ownerB: OwnerFx;
let admin: ReturnType<typeof makeAdminUser>;
const DAY = 24 * 3600 * 1000;

test.before(async () => {
  if (skip) return;
  restoreStorage = setListingPhotoStorage(storage);
  h = await startHarness();
  prisma = (await import('../repositories/prisma')).prisma;
  ({ runGymListingSweep } = await import('../services/gym-listing-sweep.service'));
  ownerA = await makeOwnerUser(reg, h, 'A');
  ownerB = await makeOwnerUser(reg, h, 'B');
  admin = makeAdminUser(h);
});

test.after(async () => {
  if (skip) return;
  restoreStorage();
  await h.stop();
  await cleanupAll(reg, { adminIds: [admin.adminId] });
  await prisma.$disconnect();
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const code = (r: Reply) => r.json?.error?.code;
const L = (gymId: string, sub = '') => `/owner/gyms/${gymId}/listing${sub}`;
const A = (path: string) => `/admin/listings/gyms${path}`;
const gymOf = (owner: OwnerFx = ownerA, opts: Parameters<typeof makePublishedGym>[3] = {}) => makePublishedGym(reg, storage, owner, { photos: 1, ...opts });
const presign = (tok: string, gymId: string, contentType = 'image/jpeg', admin_ = false) =>
  h.call(tok, 'POST', admin_ ? A(`/${gymId}/photos/presign`) : L(gymId, '/photos/presign'), { contentType });
const confirm = (tok: string, gymId: string, uploadId: string, admin_ = false) =>
  h.call(tok, 'POST', admin_ ? A(`/${gymId}/photos/confirm`) : L(gymId, '/photos/confirm'), { uploadId });
/** presign + "the browser uploads these bytes with this Content-Type" */
async function stage(tok: string, gymId: string, bytes: Buffer, declared = 'image/jpeg', admin_ = false) {
  const p = await presign(tok, gymId, declared, admin_);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const key = p.json.data.fields.key as string;
  storage.upload(key, bytes, declared);
  return { uploadId: p.json.data.uploadId as string, key };
}
const photoCount = (gymId: string) => prisma.gymPhoto.count({ where: { gymId } });
const intentOf = (id: string) => prisma.partnerUploadIntent.findUniqueOrThrow({ where: { id } });
const photoRow = (id: string) => prisma.gymPhoto.findUniqueOrThrow({ where: { id } });
const revRow = (id: string) => prisma.gymListingRevision.findUniqueOrThrow({ where: { id } });

// ═══ presign ══════════════════════════════════════════════════════════════════════════════════════

test('presign: server-chosen key listing-photos/<gymId>/<uuid>, 8 MB cap + Content-Type in the signed fields, intent row for 10 minutes; bad type / a client key / missing body are 400; storage not configured -> 503', async () => {
  const g = await gymOf();
  const p = await presign(ownerA.token, g.gymId, 'image/png');
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const d = p.json.data;
  assert.equal(d.method, 'POST');
  assert.equal(d.maxBytes, 8 * 1024 * 1024);
  assert.equal(d.fields['Content-Type'], 'image/png');
  assert.equal(d.fields['x-max-bytes'], String(8 * 1024 * 1024));
  assert.match(d.fields.key, new RegExp(`^listing-photos/${g.gymId}/[0-9a-f-]{36}$`));
  const intent = await intentOf(d.uploadId);
  assert.equal(intent.kind, 'PHOTO');
  assert.equal(intent.gymId, g.gymId);
  assert.equal(intent.partnerId, ownerA.partnerId);
  assert.equal(intent.createdBy, ownerA.ownerId);
  assert.equal(intent.objectKey, d.fields.key);
  assert.equal(intent.contentType, 'image/png');
  assert.equal(intent.confirmedAt, null);
  const ttl = intent.expiresAt.getTime() - Date.now();
  assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000 + 2000, `ttl ${ttl}`);

  assert.equal((await presign(ownerA.token, g.gymId, 'image/gif')).status, 400);
  assert.equal((await h.call(ownerA.token, 'POST', L(g.gymId, '/photos/presign'), { contentType: 'image/png', key: 'listing-photos/x/y' })).status, 400, 'the client never names the key');
  assert.equal((await h.call(ownerA.token, 'POST', L(g.gymId, '/photos/presign'), {})).status, 400);

  storage.configured = false;
  try {
    const off = await presign(ownerA.token, g.gymId);
    assert.equal(off.status, 503);
    assert.equal(code(off), 'UPLOADS_UNAVAILABLE');
  } finally {
    storage.configured = true;
  }
});

test('presign caps: at most 40 STAGED photos per branch (422 STAGED_LIMIT), a DRAFT branch holds at most 20 photos (422 PHOTO_LIMIT), at most 20 unconfirmed presigns (429 TOO_MANY_UPLOADS)', async () => {
  const g = await gymOf();
  for (let i = 0; i < 40; i++) await seedPhoto(storage, g.gymId, 'STAGED');
  const full = await presign(ownerA.token, g.gymId);
  assert.equal(full.status, 422);
  assert.equal(code(full), 'STAGED_LIMIT');
  assert.equal((await presign(admin.token, g.gymId, 'image/jpeg', true)).status, 422, 'the cap is per branch, admin included');

  const draft = await gymOf(ownerA, { status: 'DRAFT', photos: 0 });
  for (let i = 0; i < 20; i++) await seedPhoto(storage, draft.gymId, 'STAGED', { sortOrder: i, isCover: i === 0 });
  const over = await presign(ownerA.token, draft.gymId);
  assert.equal(over.status, 422);
  assert.equal(code(over), 'PHOTO_LIMIT');

  const g2 = await gymOf();
  for (let i = 0; i < 20; i++) assert.equal((await presign(ownerA.token, g2.gymId)).status, 200);
  const many = await presign(ownerA.token, g2.gymId);
  assert.equal(many.status, 429);
  assert.equal(code(many), 'TOO_MANY_UPLOADS');
});

// ═══ confirm: the happy path ══════════════════════════════════════════════════════════════════════

test('confirm: real bytes are hashed, decoded, auto-rotated, shrunk to <= 2048 px and re-encoded to WebP with NO metadata; the original is deleted; the photo is STAGED and private', async () => {
  const g = await gymOf();
  const original = await jpegImage(3000, 1500, { exifMarker: 'SECRET-GPS-MARKER', orientation: 6 });
  assert.ok(original.includes(Buffer.from('SECRET-GPS-MARKER')), 'fixture: the EXIF string is really in the upload');
  const { uploadId, key } = await stage(ownerA.token, g.gymId, original);

  const res = await confirm(ownerA.token, g.gymId, uploadId);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.deduplicated, false);
  const view = res.json.data.photo;
  assert.equal(view.status, 'STAGED');
  assert.ok(view.expiresAt, 'a STAGED photo\'s URL is a short-lived presigned link');
  assert.ok(view.url.startsWith(`https://memory.test/get/listing-photos/${g.gymId}/`));

  const photo = await photoRow(view.id);
  assert.equal(photo.gymId, g.gymId);
  assert.equal(photo.status, 'STAGED');
  assert.equal(photo.visibility, 'PRIVATE');
  assert.equal(photo.contentHash, sha256(original), 'the hash is computed server-side from the ORIGINAL bytes');
  assert.equal(photo.uploadedBy, ownerA.ownerId);
  assert.equal(photo.isCover, false);
  assert.equal(photo.s3Key, `listing-photos/${g.gymId}/${uploadId}.webp`);
  assert.equal(photo.fileName, `${uploadId}.webp`);
  assert.equal(storage.objects.has(key), false, 'the original object is deleted');
  const stored = storage.objects.get(photo.s3Key!)!;
  assert.equal(stored.contentType, 'image/webp');
  const meta = await sharp(stored.body).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined, 'EXIF / GPS is gone');
  assert.ok(!stored.body.includes(Buffer.from('SECRET-GPS-MARKER')));
  assert.deepEqual([meta.width, meta.height], [1024, 2048], '3000x1500 rotated by EXIF 6 -> 1500x3000 -> fits 2048');
  assert.ok(Math.max(meta.width!, meta.height!) <= 2048);
  assert.ok((await intentOf(uploadId)).confirmedAt, 'the intent is spent');

  // still not public: the public routes know nothing about it, and /media refuses a STAGED photo
  assert.equal((await h.call(null, 'GET', `/media/gym-photos/${photo.id}`)).status, 404);
  const pub = (await h.call(null, 'GET', `/gyms/${g.gymId}`)).json.data;
  assert.ok(!(pub.photos as any[]).some((x) => x.id === photo.id));
  // the owner's classic photo list shows it (STAGED + PUBLISHED), with a usable url
  const list = (await h.call(ownerA.token, 'GET', `/owner/gyms/${g.gymId}/photos`)).json.data as any[];
  assert.ok(list.some((x) => x.id === photo.id && x.status === 'STAGED' && x.url));
});

test('confirm: PNG and WebP are accepted too (all become WebP); a small image is not enlarged; a JPEG with trailing HTML is re-encoded clean', async () => {
  const g = await gymOf();
  for (const [bytes, type, w, h2] of [
    [await pngImage(300, 200), 'image/png', 300, 200],
    [await webpImage(120, 80), 'image/webp', 120, 80],
  ] as Array<[Buffer, string, number, number]>) {
    const { uploadId } = await stage(ownerA.token, g.gymId, bytes, type);
    const r = await confirm(ownerA.token, g.gymId, uploadId);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const meta = await sharp(storage.objects.get((await photoRow(r.json.data.photo.id)).s3Key!)!.body).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', w, h2]);
  }
  const jpeg = await jpegImage(200, 100);
  const polyglot = Buffer.concat([jpeg, Buffer.from('<script>alert("pwned-b2")</script>')]);
  const { uploadId } = await stage(ownerA.token, g.gymId, polyglot);
  const r = await confirm(ownerA.token, g.gymId, uploadId);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const out = storage.objects.get((await photoRow(r.json.data.photo.id)).s3Key!)!.body;
  assert.ok(!out.includes(Buffer.from('pwned-b2')), 'the re-encode drops everything that is not pixels');
});

test('confirm: the same file twice answers with the SAME photoId and leaves one object; two uploads of it in parallel too', async () => {
  const g = await gymOf();
  const bytes = await jpegImage(500, 300);
  const s1 = await stage(ownerA.token, g.gymId, bytes);
  const c1 = await confirm(ownerA.token, g.gymId, s1.uploadId);
  assert.equal(c1.status, 201);
  const s2 = await stage(ownerA.token, g.gymId, bytes);
  const c2 = await confirm(ownerA.token, g.gymId, s2.uploadId);
  assert.equal(c2.status, 201);
  assert.equal(c2.json.data.photo.id, c1.json.data.photo.id);
  assert.equal(c2.json.data.deduplicated, true);
  assert.equal(await photoCount(g.gymId), 2, 'the seed photo + one upload');
  assert.deepEqual(storage.keysWithPrefix(`listing-photos/${g.gymId}/`).filter((k) => k.endsWith('.webp') && k.includes(s1.uploadId)), [`listing-photos/${g.gymId}/${s1.uploadId}.webp`]);
  assert.equal(storage.objects.has(`listing-photos/${g.gymId}/${s2.uploadId}.webp`), false, 'the surplus copy was deleted');
  assert.equal(storage.objects.has(s2.key), false, 'and the second original');

  const g2 = await gymOf();
  const same = await jpegImage(640, 480);
  const [x, y] = await Promise.all([stage(ownerA.token, g2.gymId, same), stage(ownerA.token, g2.gymId, same)]);
  const both = await Promise.all([confirm(ownerA.token, g2.gymId, x.uploadId), confirm(ownerA.token, g2.gymId, y.uploadId)]);
  assert.deepEqual(both.map((r) => r.status), [201, 201], JSON.stringify(both.map((r) => r.json)));
  assert.equal(both[0].json.data.photo.id, both[1].json.data.photo.id, 'both got the same photoId');
  assert.equal(await prisma.gymPhoto.count({ where: { gymId: g2.gymId, contentHash: sha256(same) } }), 1);
  assert.equal(storage.keysWithPrefix(`listing-photos/${g2.gymId}/`).filter((k) => k.endsWith('.webp') && (k.includes(x.uploadId) || k.includes(y.uploadId))).length, 1, 'the bucket keeps ONE object');
});

// ═══ confirm: refusals ════════════════════════════════════════════════════════════════════════════

test('confirm REFUSES (422, nothing stored, objects deleted, intent spent): exe / zip / text declared as images, truncated PNG, header-only JPEG, a 48-megapixel bomb, a declared-type mismatch, an empty object, a missing object, an object over 8 MB', async () => {
  const g = await gymOf();
  const png = await pngImage(400, 400);
  const cases: Array<{ name: string; bytes: Buffer | null; declared: string; code: string }> = [
    { name: 'exe declared as jpeg', bytes: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000, 0x90)]), declared: 'image/jpeg', code: 'IMAGE_INVALID' },
    { name: 'zip declared as png', bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 1)]), declared: 'image/png', code: 'IMAGE_INVALID' },
    { name: 'text renamed .png', bytes: Buffer.from('this is not an image at all, just text pretending'), declared: 'image/png', code: 'IMAGE_INVALID' },
    { name: 'truncated PNG', bytes: png.subarray(0, Math.floor(png.length / 2)), declared: 'image/png', code: 'IMAGE_INVALID' },
    { name: 'JPEG with only its header', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), declared: 'image/jpeg', code: 'IMAGE_INVALID' },
    { name: '48 MP decompression bomb', bytes: hugeDimensionPng(), declared: 'image/png', code: 'IMAGE_INVALID' },
    { name: 'png bytes declared as jpeg', bytes: png, declared: 'image/jpeg', code: 'IMAGE_INVALID' },
    { name: 'empty object', bytes: Buffer.alloc(0), declared: 'image/jpeg', code: 'IMAGE_INVALID' },
    { name: 'object that was never uploaded', bytes: null, declared: 'image/jpeg', code: 'IMAGE_MISSING' },
    // written straight into the bucket (the presign policy would have stopped it): 8 MB + 1 B
    { name: 'object over 8 MB', bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8 * 1024 * 1024 - 3, 0)]), declared: 'image/jpeg', code: 'IMAGE_TOO_LARGE' },
  ];
  assert.equal(cases[cases.length - 1].bytes!.length, 8 * 1024 * 1024 + 1);
  const before = await photoCount(g.gymId);
  for (const c of cases) {
    const p = await presign(ownerA.token, g.gymId, c.declared);
    const key = p.json.data.fields.key as string;
    if (c.bytes) storage.upload(key, c.bytes, c.declared);
    const r = await confirm(ownerA.token, g.gymId, p.json.data.uploadId);
    assert.equal(r.status, 422, `${c.name}: ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(code(r), c.code, c.name);
    assert.equal(storage.objects.has(key), false, `${c.name}: the object is gone`);
    assert.equal(storage.keysWithPrefix(`listing-photos/${g.gymId}/${p.json.data.uploadId}`).length, 0, `${c.name}: no normalised copy either`);
    const replay = await confirm(ownerA.token, g.gymId, p.json.data.uploadId);
    assert.equal(replay.status, 409, `${c.name}: a refused intent cannot be retried`);
    assert.equal(code(replay), 'INTENT_ALREADY_USED');
  }
  assert.equal(await photoCount(g.gymId), before, 'no photo row was written by any refusal');
});

test('confirm: another owner\'s / another branch\'s / unknown uploadId is 404; a replay after CONFIRMED is 409; two confirms in parallel -> one 201 and one 409; an expired intent is 409 INTENT_EXPIRED', async () => {
  const gA = await gymOf(ownerA);
  const gA2 = await gymOf(ownerA);
  const gB = await gymOf(ownerB);
  const s = await stage(ownerA.token, gA.gymId, await jpegImage(200, 200));

  assert.equal(code(await confirm(ownerB.token, gB.gymId, s.uploadId)), 'UPLOAD_NOT_FOUND', "B on B's branch with A's uploadId");
  assert.equal(code(await confirm(ownerB.token, gA.gymId, s.uploadId)), 'GYM_NOT_FOUND', "B on A's branch");
  assert.equal(code(await confirm(ownerA.token, gA2.gymId, s.uploadId)), 'UPLOAD_NOT_FOUND', "A, same owner, another branch's path");
  assert.equal(code(await confirm(ownerA.token, gA.gymId, randomUUID())), 'UPLOAD_NOT_FOUND');
  assert.equal((await h.call(ownerA.token, 'POST', L(gA.gymId, '/photos/confirm'), { uploadId: 'nope' })).status, 400);
  assert.equal(code(await confirm(admin.token, gA.gymId, s.uploadId, true)), 'UPLOAD_NOT_FOUND', "an admin cannot confirm the owner's intent either");
  assert.equal((await intentOf(s.uploadId)).confirmedAt, null, 'none of the above claimed it');

  const race = await Promise.all([confirm(ownerA.token, gA.gymId, s.uploadId), confirm(ownerA.token, gA.gymId, s.uploadId)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  assert.equal(code(race.find((r) => r.status === 409)!), 'INTENT_ALREADY_USED');
  assert.equal(code(await confirm(ownerA.token, gA.gymId, s.uploadId)), 'INTENT_ALREADY_USED');

  const s2 = await stage(ownerA.token, gA.gymId, await jpegImage(210, 210));
  await prisma.partnerUploadIntent.update({ where: { id: s2.uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const late = await confirm(ownerA.token, gA.gymId, s2.uploadId);
  assert.equal(late.status, 409);
  assert.equal(code(late), 'INTENT_EXPIRED');
});

test('MANAGER cannot presign / confirm / delete; a foreign branch\'s upload endpoints answer 404 and create nothing', async () => {
  const gB = await gymOf(ownerB);
  const before = await prisma.partnerUploadIntent.count({ where: { gymId: gB.gymId } });
  assert.equal(code(await presign(ownerA.token, gB.gymId)), 'GYM_NOT_FOUND');
  assert.equal(await prisma.partnerUploadIntent.count({ where: { gymId: gB.gymId } }), before);
  assert.equal(code(await presign(ownerA.token, randomUUID())), 'GYM_NOT_FOUND');
});

// ═══ the add-branch wizard (DRAFT branch) ═════════════════════════════════════════════════════════

test('DRAFT branch (wizard): presign + confirm work, photos are STAGED in order with the first as cover, delete renumbers, the legacy disk routes stay 410, and the FIRST APPROVAL publishes them with exactly one cover', async () => {
  const g = await gymOf(ownerA, { status: 'DRAFT', photos: 0 });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { uploadId } = await stage(ownerA.token, g.gymId, await jpegImage(300 + i, 200));
    const r = await confirm(ownerA.token, g.gymId, uploadId);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    ids.push(r.json.data.photo.id);
  }
  let rows = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(rows.map((r) => r.id), ids);
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);
  assert.deepEqual(rows.map((r) => r.isCover), [true, false, false]);
  assert.ok(rows.every((r) => r.status === 'STAGED' && r.visibility === 'PRIVATE'));
  assert.equal((await h.call(ownerA.token, 'GET', `/owner/gyms/${g.gymId}/photos`)).json.data.length, 3);

  // delete the cover: the next photo becomes the cover, sort_order stays gap-free, the file is deleted
  const doomedKey = rows[0].s3Key!;
  const del = await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${ids[0]}`));
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(storage.objects.has(doomedKey), false);
  assert.equal((await photoRow(ids[0])).status, 'DISCARDED');
  rows = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'STAGED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(rows.map((r) => [r.id, r.sortOrder, r.isCover]), [[ids[1], 0, true], [ids[2], 1, false]]);
  assert.equal((await h.call(ownerA.token, 'GET', `/owner/gyms/${g.gymId}/photos`)).json.data.length, 2, 'a DISCARDED photo is not listed');

  // the retired disk routes
  assert.equal((await h.call(ownerA.token, 'POST', `/owner/gyms/${g.gymId}/photos`, {})).status, 410);
  assert.equal((await h.call(ownerA.token, 'DELETE', `/owner/gyms/${g.gymId}/photos/${ids[1]}`)).status, 410);

  // first approval -> PUBLISHED, one cover
  const ap = await h.call(admin.token, 'PATCH', `/admin/gyms/${g.gymId}/status`, { status: 'APPROVED' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  rows = await prisma.gymPhoto.findMany({ where: { gymId: g.gymId, status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' } });
  assert.deepEqual(rows.map((r) => r.id), [ids[1], ids[2]]);
  assert.equal(rows.filter((r) => r.isCover).length, 1);
  const pub = (await h.call(null, 'GET', `/gyms/${g.gymId}`)).json.data;
  assert.deepEqual((pub.photos as any[]).map((p) => p.id), [ids[1], ids[2]]);
  assert.ok(storage.objects.has(rows[0].s3Key!), 'the file was never moved: the media route redirects to a signed link');
});

// ═══ admin upload ═════════════════════════════════════════════════════════════════════════════════

test('admin presign / confirm: the admin uploads for any branch, the owner cannot confirm that intent, the photo is STAGED and joins the listing only through a direct edit', async () => {
  const g = await gymOf(ownerA);
  const { uploadId } = await stage(admin.token, g.gymId, await jpegImage(640, 360), 'image/jpeg', true);
  const intent = await intentOf(uploadId);
  assert.equal(intent.createdBy, admin.adminId);
  assert.equal(intent.partnerId, ownerA.partnerId, 'the partner is resolved from the branch owner');
  assert.equal(code(await confirm(ownerA.token, g.gymId, uploadId)), 'UPLOAD_NOT_FOUND');
  const r = await confirm(admin.token, g.gymId, uploadId, true);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const photoId = r.json.data.photo.id as string;
  const row = await photoRow(photoId);
  assert.equal(row.status, 'STAGED');
  assert.equal(row.uploadedBy, admin.adminId);
  assert.equal((await h.call(null, 'GET', `/media/gym-photos/${photoId}`)).status, 404);

  const edit = await h.call(admin.token, 'POST', A(`/${g.gymId}/direct-edit`), { photoIds: [...g.photoIds, photoId], coverPhotoId: photoId, reason: 'Thêm ảnh mặt tiền do quản trị viên chụp', expectedListingVersion: 1 });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await photoRow(photoId)).status, 'PUBLISHED');
  assert.equal((await photoRow(photoId)).isCover, true);
  assert.equal((await photoRow(g.photoIds[0])).isCover, false);
  assert.equal((await h.call(admin.token, 'GET', `/admin/gyms/${g.gymId}/photos`)).json.data.find((p: any) => p.id === photoId).status, 'PUBLISHED', 'the admin photo list carries the status');

  // a branch whose owner has no partner record cannot take uploads (the intent table needs a partner)
  const orphan = randomUUID();
  const orphanGym = randomUUID();
  await seed(async (tx) => {
    await tx.gym.create({ data: { id: orphanGym, ownerId: orphan, name: 'Không đối tác', address: 'x', status: 'APPROVED', approvedName: 'Không đối tác', listingVersion: 1 } });
  });
  reg.gyms.push(orphanGym);
  const refused = await presign(admin.token, orphanGym, 'image/jpeg', true);
  assert.equal(refused.status, 409);
  assert.equal(code(refused), 'PARTNER_REQUIRED');
});

// ═══ delete ═══════════════════════════════════════════════════════════════════════════════════════

test('DELETE a photo: STAGED only - out of an open DRAFT (version +1), blocked by a PENDING revision, PUBLISHED / RETIRED / foreign answer 409 / 404, the file is deleted', async () => {
  const g = await gymOf();
  const staged = await seedPhoto(storage, g.gymId, 'STAGED');
  const l = (await h.call(ownerA.token, 'GET', L(g.gymId))).json.data;
  const d = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), {});
  const saved = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), {
    expectedDraftVersion: d.json.data.revision.draftVersion,
    payload: { ...l.published.payload, photoIds: [...g.photoIds, staged.id], coverPhotoId: staged.id },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const rev = saved.json.data.revision;

  const del = await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${staged.id}`));
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await photoRow(staged.id)).status, 'DISCARDED');
  assert.equal(storage.objects.has(staged.key), false);
  const after = await revRow(rev.id);
  assert.deepEqual((after.payload as any).photoIds, g.photoIds);
  assert.equal((after.payload as any).coverPhotoId, g.photoIds[0], 'the cover falls back to the first remaining photo');
  assert.equal(after.draftVersion, rev.draftVersion + 1);
  assert.equal(code(await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${staged.id}`))), 'PHOTO_NOT_FOUND', 'already discarded');

  assert.equal(code(await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${g.photoIds[0]}`))), 'PHOTO_PUBLISHED');
  const retired = await seedPhoto(storage, g.gymId, 'RETIRED', { retiredAt: new Date() });
  assert.equal(code(await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${retired.id}`))), 'PHOTO_NOT_FOUND');
  assert.equal(code(await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${randomUUID()}`))), 'PHOTO_NOT_FOUND');
  const other = await gymOf(ownerA);
  assert.equal(code(await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${other.photoIds[0]}`))), 'PHOTO_NOT_FOUND', "another branch's photo is not found through this branch");

  // a STAGED photo inside a PENDING revision cannot be deleted
  const s2 = await seedPhoto(storage, g.gymId, 'STAGED');
  const cur = (await h.call(ownerA.token, 'GET', L(g.gymId))).json.data.openRevision;
  const saved2 = await h.call(ownerA.token, 'PUT', L(g.gymId, '/draft'), {
    expectedDraftVersion: cur.draftVersion,
    payload: { ...cur.payload, photoIds: [...g.photoIds, s2.id] },
  });
  assert.equal(saved2.status, 200, JSON.stringify(saved2.json));
  const sub = await h.call(ownerA.token, 'POST', L(g.gymId, '/submit'), { expectedDraftVersion: saved2.json.data.revision.draftVersion });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  const blocked = await h.call(ownerA.token, 'DELETE', L(g.gymId, `/photos/${s2.id}`));
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'PHOTO_IN_REVIEW');
  assert.equal((await photoRow(s2.id)).status, 'STAGED');
  assert.equal(storage.objects.has(s2.key), true);
});

// ═══ the sweep ════════════════════════════════════════════════════════════════════════════════════

test('sweep: dead upload intents - an abandoned presign (> 1 h past expiry) is removed with its object; a fresh one and one inside the grace hour stay; a claim that produced no photo is cleaned, a recent claim stays', async () => {
  const g = await gymOf();
  const now = new Date();
  const mk = async (over: { expiresAt: Date; confirmedAt?: Date | null }) => {
    const p = await presign(ownerA.token, g.gymId);
    const id = p.json.data.uploadId as string;
    storage.upload(p.json.data.fields.key, Buffer.from('bytes'), 'image/jpeg');
    await prisma.partnerUploadIntent.update({ where: { id }, data: { expiresAt: over.expiresAt, confirmedAt: over.confirmedAt ?? null } });
    return { id, key: p.json.data.fields.key as string };
  };
  const abandoned = await mk({ expiresAt: new Date(now.getTime() - 2 * 3600_000) });
  const fresh = await mk({ expiresAt: new Date(now.getTime() + 5 * 60_000) });
  const grace = await mk({ expiresAt: new Date(now.getTime() - 10 * 60_000) });
  const stuck = await mk({ expiresAt: new Date(now.getTime() - 3600_000), confirmedAt: new Date(now.getTime() - 10 * 60_000) });
  storage.upload(`listing-photos/${g.gymId}/${stuck.id}.webp`, Buffer.from('half-written'), 'image/webp');
  const recentClaim = await mk({ expiresAt: new Date(now.getTime() + 5 * 60_000), confirmedAt: new Date(now.getTime() - 60_000) });

  const out = await runGymListingSweep(now, { gymIds: [g.gymId] });
  assert.equal(out.skipped, false);
  assert.equal(out.intentsCleaned, 2);
  assert.equal(await prisma.partnerUploadIntent.count({ where: { id: abandoned.id } }), 0);
  assert.equal(storage.objects.has(abandoned.key), false);
  assert.equal(await prisma.partnerUploadIntent.count({ where: { id: stuck.id } }), 0);
  assert.equal(storage.objects.has(stuck.key), false);
  assert.equal(storage.objects.has(`listing-photos/${g.gymId}/${stuck.id}.webp`), false, 'the half-written normalised copy goes too');
  for (const keep of [fresh, grace, recentClaim]) {
    assert.equal(await prisma.partnerUploadIntent.count({ where: { id: keep.id } }), 1);
    assert.equal(storage.objects.has(keep.key), true);
  }

  // a claim that DID produce a photo is never touched (and a finished upload through the API survives the sweep)
  const done = await stage(ownerA.token, g.gymId, await jpegImage(333, 222));
  const c = await confirm(ownerA.token, g.gymId, done.uploadId);
  assert.equal(c.status, 201);
  await prisma.partnerUploadIntent.update({ where: { id: done.uploadId }, data: { confirmedAt: new Date(now.getTime() - 20 * 60_000) } });
  await runGymListingSweep(now, { gymIds: [g.gymId] });
  assert.equal(await prisma.partnerUploadIntent.count({ where: { id: done.uploadId } }), 1);
  assert.equal((await photoRow(c.json.data.photo.id)).status, 'STAGED');
  assert.ok(storage.objects.has((await photoRow(c.json.data.photo.id)).s3Key!));
});

test('sweep: an orphaned STAGED photo goes only when no open revision, no revision closed in the last 30 days and not a never-public branch holds it AND it is older than 7 days; PUBLISHED is never touched; RETIRED goes after 90 days', async () => {
  const g = await gymOf(ownerA, { photos: 2 });
  const now = new Date();
  const old = new Date(now.getTime() - 8 * DAY);
  const stage2 = (over: Parameters<typeof seedPhoto>[3] = {}) => seedPhoto(storage, g.gymId, 'STAGED', { createdAt: old, ...over });

  const orphan = await stage2();
  const young = await stage2({ createdAt: new Date(now.getTime() - 6 * DAY) });
  const inDraft = await stage2();
  const closedRecent = await stage2();
  const closedOld = await stage2();
  const published = await seedPhoto(storage, g.gymId, 'PUBLISHED', { createdAt: new Date(now.getTime() - 400 * DAY), sortOrder: 5 });

  const payload = (ids: string[]) => ({ description: null, amenityIds: [], proposalIds: [], photoIds: ids, coverPhotoId: ids[0] ?? null });
  await seed(async (tx) => {
    await tx.gymListingRevision.create({ data: { gymId: g.gymId, status: 'REJECTED', baseVersion: 1, payload: payload([closedRecent.id]), reviewedAt: new Date(now.getTime() - 10 * DAY) } });
    await tx.gymListingRevision.create({ data: { gymId: g.gymId, status: 'REJECTED', baseVersion: 1, payload: payload([closedOld.id]), reviewedAt: new Date(now.getTime() - 31 * DAY) } });
    await tx.gymListingRevision.create({ data: { gymId: g.gymId, status: 'DRAFT', baseVersion: 1, payload: payload([inDraft.id]) } });
  });
  const retiredOld = await seedPhoto(storage, g.gymId, 'RETIRED', { retiredAt: new Date(now.getTime() - 91 * DAY) });
  const retiredNew = await seedPhoto(storage, g.gymId, 'RETIRED', { retiredAt: new Date(now.getTime() - 89 * DAY) });

  const out = await runGymListingSweep(now, { gymIds: [g.gymId] });
  assert.equal(out.orphansDiscarded, 2, 'the orphan and the one whose only revision closed more than 30 days ago');
  assert.equal(out.retiredCleaned, 1);
  assert.equal(out.failed, 0);
  const status = async (p: { id: string }) => (await photoRow(p.id)).status;
  assert.equal(await status(orphan), 'DISCARDED');
  assert.equal(storage.objects.has(orphan.key), false);
  assert.equal(await status(closedOld), 'DISCARDED');
  assert.equal(await status(young), 'STAGED');
  assert.equal(await status(inDraft), 'STAGED', 'an open DRAFT still points at it');
  assert.equal(await status(closedRecent), 'STAGED', 'a revision closed 10 days ago can still be copied');
  assert.equal(await status(published), 'PUBLISHED');
  assert.equal(storage.objects.has(published.key), true);
  assert.equal(await status(retiredOld), 'DISCARDED');
  assert.equal(storage.objects.has(retiredOld.key), false);
  assert.equal(await status(retiredNew), 'RETIRED');
  assert.equal(storage.objects.has(retiredNew.key), true);
  assert.ok((await photoRow(retiredOld.id)).retiredAt, 'the row is kept as history');

  // branches that have never been public own their STAGED photos (the first approval publishes them)
  for (const status2 of ['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const) {
    const never = await gymOf(ownerA, { status: status2, photos: 0 });
    const p = await seedPhoto(storage, never.gymId, 'STAGED', { createdAt: new Date(now.getTime() - 30 * DAY) });
    await runGymListingSweep(now, { gymIds: [never.gymId] });
    assert.equal((await photoRow(p.id)).status, 'STAGED', status2);
  }
  // not configured -> nothing happens
  storage.configured = false;
  try {
    assert.equal((await runGymListingSweep(now, { gymIds: [g.gymId] })).skipped, true);
  } finally {
    storage.configured = true;
  }
});

test('sweep vs a draft being copied: a photo row locked FOR SHARE (what the copy takes) is skipped, never deleted underneath it', async () => {
  const g = await gymOf();
  const now = new Date();
  const orphan = await seedPhoto(storage, g.gymId, 'STAGED', { createdAt: new Date(now.getTime() - 9 * DAY) });
  let during: Awaited<ReturnType<typeof runGymListingSweep>> | null = null;
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM gym_photos WHERE id = '${orphan.id}' FOR SHARE`);
      during = await runGymListingSweep(now, { gymIds: [g.gymId] });
    },
    { timeout: 20_000 },
  );
  assert.equal(during!.orphansDiscarded, 0);
  assert.equal((await photoRow(orphan.id)).status, 'STAGED', 'skipped while locked');
  assert.equal(storage.objects.has(orphan.key), true);
  assert.equal((await runGymListingSweep(now, { gymIds: [g.gymId] })).orphansDiscarded, 1, 'discarded on the next tick');
});

test('a draft copy (copyFromRevisionId) never points at a photo the sweep discarded in the meantime', async () => {
  const g = await gymOf();
  const now = new Date();
  const doomed = await seedPhoto(storage, g.gymId, 'STAGED', { createdAt: new Date(now.getTime() - 40 * DAY) });
  const closed = await seed((tx) =>
    tx.gymListingRevision.create({
      data: { gymId: g.gymId, status: 'REJECTED', baseVersion: 1, payload: { description: null, amenityIds: [], proposalIds: [], photoIds: [...g.photoIds, doomed.id], coverPhotoId: g.photoIds[0] }, reviewedAt: new Date(now.getTime() - 35 * DAY) },
    }),
  );
  await runGymListingSweep(now, { gymIds: [g.gymId] });
  assert.equal((await photoRow(doomed.id)).status, 'DISCARDED');
  // the revision is still inside the 30-day copy window as far as the API is concerned only if it closed recently; make it so
  const recent = await seed((tx) =>
    tx.gymListingRevision.create({
      data: { gymId: g.gymId, status: 'REJECTED', baseVersion: 1, payload: { description: null, amenityIds: [], proposalIds: [], photoIds: [...g.photoIds, doomed.id], coverPhotoId: doomed.id }, reviewedAt: new Date() },
    }),
  );
  const copy = await h.call(ownerA.token, 'POST', L(g.gymId, '/draft'), { copyFromRevisionId: recent.id });
  assert.equal(copy.status, 201, JSON.stringify(copy.json));
  assert.deepEqual(copy.json.data.revision.payload.photoIds, g.photoIds, 'the dead id is not carried over');
  assert.equal(copy.json.data.revision.payload.coverPhotoId, g.photoIds[0]);
  assert.deepEqual(copy.json.data.revision.systemAdjustments, [{ type: 'PHOTO_NO_LONGER_AVAILABLE', photoId: doomed.id }]);
  assert.ok(closed.id);
});

test('no upload path produced a WRITER_ABSENT compat event', async () => {
  const events = await prisma.legacyCompatEvent.findMany({ where: { outcome: 'WRITER_ABSENT', entityId: { in: [...reg.gyms, ...reg.partners] } } });
  assert.deepEqual(events.map((e) => `${e.entityType}:${e.action}:${e.entityId}`), []);
});
