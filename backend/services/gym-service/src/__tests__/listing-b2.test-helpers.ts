/**
 * Shared fixtures for the Listing Management B2 integration tests. Not a test file (no `.test.ts` suffix).
 *
 * Evidence label: BACKEND INTEGRATION - the real Express app (src/app.ts) over an isolated `*_test` database.
 * auth-service is NOT running (a token -> identity table = TEST FIXTURE) and object storage is an IN-MEMORY adapter
 * injected through the storage port (TEST FIXTURE: no MinIO is wired in, so the S3 wire protocol itself - presigned POST
 * policy enforcement, bucket policy - is NOT exercised here). The image decoder (sharp) is the REAL one.
 *
 * Every fixture write runs inside a transaction that declares `gymini.compat_writer = 'seed'` (see listing-b1.test-helpers),
 * so "no WRITER_ABSENT for these gyms" assertions are meaningful.
 */
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import sharp from 'sharp';
import type { ListingPhotoStorage } from '../services/listing-photo-storage';
import { cleanupRegistry as cleanupB1, makeGym, makeOwner, seed, type Registry } from './listing-b1.test-helpers';

export { makeGym, makeOwner, newRegistry, seed, type Registry } from './listing-b1.test-helpers';

// ── in-memory storage (the port's contract: 404 -> null, size cap -> tooLarge) ────────────────────

export class MemoryListingStorage implements ListingPhotoStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  deleted: string[] = [];
  configured = true;

  isConfigured() {
    return this.configured;
  }
  async presignUpload(p: { key: string; contentType: string; maxBytes: number; expiresSec?: number }) {
    return { url: 'https://memory.test/upload', fields: { key: p.key, 'Content-Type': p.contentType, 'x-max-bytes': String(p.maxBytes) } };
  }
  async presignGet(p: { key: string; contentType?: string; expiresSec?: number }) {
    return `https://memory.test/get/${p.key}?exp=${Date.now() + (p.expiresSec ?? 600) * 1000}&sig=fake`;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
  }
  async getObject(key: string, maxBytes: number) {
    const o = this.objects.get(key);
    if (!o) return null;
    if (o.body.length > maxBytes) throw Object.assign(new Error('object too large'), { tooLarge: true });
    return Buffer.from(o.body);
  }
  async putObject(p: { key: string; body: Buffer; contentType: string }) {
    this.objects.set(p.key, { body: Buffer.from(p.body), contentType: p.contentType });
  }
  async deleteObject(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  /** What a browser does after presign: drop the bytes at the intent's key with the declared Content-Type. */
  upload(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  keysWithPrefix(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── HTTP harness: real app + fake auth-service ───────────────────────────────────────────────────

export interface Reply {
  status: number;
  json: any;
  headers: Headers;
  location: string | null;
}

export interface Harness {
  base: string;
  users: Record<string, { id: string; role: string; email: string }>;
  call(token: string | null, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  addUser(token: string, user: { id: string; role: string }): void;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const users: Harness['users'] = {};
  const authServer = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    const user = users[token];
    if (req.method === 'POST' && req.url === '/auth/verify' && user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;

  const app = (await import('../app')).default;
  const appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;

  return {
    base,
    users,
    addUser(token, user) {
      users[token] = { ...user, email: `${user.id}@b2.test` };
    },
    async call(token, method, path, body, headers = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        redirect: 'manual',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* no JSON body */
      }
      return { status: res.status, json, headers: res.headers, location: res.headers.get('location') };
    },
    async stop() {
      (appServer as any).closeAllConnections?.();
      await new Promise<void>((r) => appServer.close(() => r()));
      await new Promise<void>((r) => authServer.close(() => r()));
    },
  };
}

// ── identities ────────────────────────────────────────────────────────────────────────────────────

/** An owner (partner + OWNER account + brand) and its bearer tokens registered with the harness. */
export async function makeOwnerUser(reg: Registry, h: Harness, label: string) {
  const owner = await makeOwner(reg);
  const token = `tok-${label}-${owner.ownerId.slice(0, 8)}`;
  h.addUser(token, { id: owner.ownerId, role: 'GYM_OWNER' });
  return { ...owner, token };
}
export type OwnerFx = Awaited<ReturnType<typeof makeOwnerUser>>;

/** A MANAGER account of the same partner, scoped to `gymIds`. */
export async function makeManagerUser(_reg: Registry, h: Harness, owner: OwnerFx, gymIds: string[]) {
  const managerId = randomUUID();
  await seed((tx) =>
    tx.gymPartnerAccount.create({
      data: { partnerId: owner.partnerId, userId: managerId, role: 'MANAGER', scopedGymIds: gymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
    }),
  );
  const token = `tok-mgr-${managerId.slice(0, 8)}`;
  h.addUser(token, { id: managerId, role: 'GYM_OWNER' });
  return { managerId, token };
}

export function makeAdminUser(h: Harness, label = 'admin') {
  const id = randomUUID();
  const token = `tok-${label}-${id.slice(0, 8)}`;
  h.addUser(token, { id, role: 'ADMIN' });
  return { adminId: id, token };
}

export function makeCustomerUser(h: Harness) {
  const id = randomUUID();
  const token = `tok-cust-${id.slice(0, 8)}`;
  h.addUser(token, { id, role: 'CUSTOMER' });
  return { customerId: id, token };
}

// ── fixtures: gyms, photos, amenities ─────────────────────────────────────────────────────────────

let photoSeq = 0;
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** A photo row (and its object in `storage`) without going through the upload pipeline. */
export async function seedPhoto(
  storage: MemoryListingStorage,
  gymId: string,
  status: 'STAGED' | 'PUBLISHED' | 'RETIRED' | 'DISCARDED' = 'STAGED',
  over: Partial<{ sortOrder: number; isCover: boolean; createdAt: Date; retiredAt: Date | null; withHash: boolean; uploadedBy: string }> = {},
) {
  photoSeq += 1;
  const id = randomUUID();
  const key = `listing-photos/${gymId}/${id}.webp`;
  storage.upload(key, Buffer.from(`image-${id}`), 'image/webp');
  await seed((tx) =>
    tx.gymPhoto.create({
      data: {
        id,
        gymId,
        fileName: `${id}.webp`,
        s3Key: key,
        status,
        sortOrder: over.sortOrder ?? 0,
        isCover: over.isCover ?? false,
        visibility: 'PRIVATE',
        contentHash: over.withHash === false ? null : sha256(`hash-${id}-${photoSeq}`),
        uploadedBy: over.uploadedBy ?? 'seed',
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
        ...(over.retiredAt !== undefined ? { retiredAt: over.retiredAt } : {}),
      },
    }),
  );
  return { id, key };
}

/** An APPROVED branch (listing_version 1) with `photos` PUBLISHED photos (the first is the cover, sort_order 0..n-1). */
export async function makePublishedGym(
  reg: Registry,
  storage: MemoryListingStorage,
  owner: { ownerId: string; brandId: string },
  opts: { photos?: number; amenities?: string[]; description?: string | null; name?: string; status?: 'APPROVED' | 'PENDING_REVIEW' | 'DRAFT' | 'REJECTED' | 'SUSPENDED' } = {},
) {
  const gymId = await makeGym(reg, {
    ownerId: owner.ownerId,
    brandId: owner.brandId,
    status: opts.status ?? 'APPROVED',
    description: opts.description === undefined ? 'Mô tả ban đầu' : opts.description,
    amenities: opts.amenities ?? ['WIFI', 'SAUNA'],
    name: opts.name,
  });
  const photoIds: string[] = [];
  const n = opts.photos ?? 3;
  for (let i = 0; i < n; i++) {
    const p = await seedPhoto(storage, gymId, opts.status === 'APPROVED' || opts.status === undefined ? 'PUBLISHED' : 'STAGED', { sortOrder: i, isCover: i === 0 });
    photoIds.push(p.id);
  }
  return { gymId, photoIds };
}

export async function amenityBySlug(slug: string) {
  const { prisma } = await import('../repositories/prisma');
  return prisma.amenity.findUniqueOrThrow({ where: { slug } });
}

/** Cleans everything the B2 tests created: closed revisions need the immutability trigger out of the way for ONE
 * transaction (session_replication_role only affects this transaction), then the B1 cleanup removes the rest. */
export async function cleanupAll(reg: Registry, extra: { adminIds?: string[]; amenityNamePrefix?: string } = {}) {
  const { prisma } = await import('../repositories/prisma');
  if (reg.gyms.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`DELETE FROM gym_listing_revisions WHERE gym_id = ANY($1::text[])`, reg.gyms);
    });
    await prisma.partnerUploadIntent.deleteMany({ where: { gymId: { in: reg.gyms } } });
  }
  if (extra.adminIds?.length) await prisma.amenityAuditLog.deleteMany({ where: { actorUserId: { in: extra.adminIds } } });
  if (reg.gyms.length) await prisma.amenityProposal.deleteMany({ where: { gymId: { in: reg.gyms } } });
  if (extra.amenityNamePrefix) {
    const rows = await prisma.amenity.findMany({ where: { nameNormalized: { startsWith: extra.amenityNamePrefix } }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await prisma.amenityAuditLog.deleteMany({ where: { amenityId: { in: ids } } });
      await prisma.gymAmenity.deleteMany({ where: { amenityId: { in: ids } } });
      await prisma.amenityProposal.deleteMany({ where: { OR: [{ resultingAmenityId: { in: ids } }, { targetAmenityId: { in: ids } }] } });
      await prisma.amenity.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await cleanupB1(reg);
}

// ── images ────────────────────────────────────────────────────────────────────────────────────────

let colorSeed = 0;
/** Distinct pixels each call, so two calls never hash the same. */
function uniqueColor() {
  colorSeed += 1;
  return { r: (colorSeed * 37) % 256, g: (colorSeed * 91) % 256, b: (colorSeed * 17 + 50) % 256 };
}

export async function jpegImage(width = 400, height = 300, opts: { exifMarker?: string; orientation?: number } = {}) {
  let img = sharp({ create: { width, height, channels: 3, background: uniqueColor() } }).jpeg();
  if (opts.exifMarker || opts.orientation) {
    img = img.withMetadata({
      ...(opts.orientation ? { orientation: opts.orientation } : {}),
      ...(opts.exifMarker ? { exif: { IFD0: { Copyright: opts.exifMarker } } } : {}),
    });
  }
  return img.toBuffer();
}
export async function pngImage(width = 300, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: uniqueColor() } }).png().toBuffer();
}
export async function webpImage(width = 300, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: uniqueColor() } }).webp().toBuffer();
}

/** A real, tiny PNG that DECLARES 8000x6000 (48 MP): the decompression-bomb shape sharp must refuse (limit 40 MP). */
export function hugeDimensionPng(): Buffer {
  const width = 8000;
  const height = 6000;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(height * (width + 1)); // filter byte + pixels, all zero
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The payload a draft would carry, from the owner's GET /listing answer. */
export function payloadOf(
  listing: any,
  over: Partial<{ description: string | null; amenityIds: string[]; proposalIds: string[]; photoIds: string[]; coverPhotoId: string | null }> = {},
) {
  const p = listing.published.payload;
  return {
    description: over.description !== undefined ? over.description : p.description,
    amenityIds: over.amenityIds ?? p.amenityIds,
    proposalIds: over.proposalIds ?? [],
    photoIds: over.photoIds ?? p.photoIds,
    coverPhotoId: over.coverPhotoId !== undefined ? over.coverPhotoId : p.coverPhotoId,
  };
}
