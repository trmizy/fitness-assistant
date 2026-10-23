/**
 * Fixtures for the PT listing WORKFLOW suites (pt-listing-workflow.* and pt-listing-upload.*), phase C2.
 *
 * Evidence label: BACKEND INTEGRATION against an isolated `*_test` database through the real Express app.
 * auth-service is NOT running (token -> identity table = TEST FIXTURE) and object storage is an IN-MEMORY adapter
 * injected through the storage port (TEST FIXTURE) unless a MinIO is wired in - see InMemoryPtMediaStorage.
 */
import { randomUUID, createHash } from "node:crypto";
import zlib from "node:zlib";
import sharp from "sharp";
import { prisma } from "../repositories/profile.repository";
import type { PtMediaStorage } from "../services/pt-media-s3.service";
import { notificationService } from "../services/notification.service";
import { listingHooks } from "../services/pt-listing.service";
import { makePackage, makePublicPt } from "./pt-listing.test-helpers";
import { patch } from "./pt-restriction.test-helpers";

/** A storage that keeps objects in a Map. Honest about the port's contract (404 -> null, size cap -> tooLarge). */
export class InMemoryPtMediaStorage implements PtMediaStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  deleted: string[] = [];
  configured = true;

  isConfigured() {
    return this.configured;
  }
  async presignUpload(p: { key: string; contentType: string; maxBytes: number; expiresSec?: number }) {
    return { url: "https://memory.test/upload", fields: { key: p.key, "Content-Type": p.contentType, "x-max-bytes": String(p.maxBytes) } };
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
    if (o.body.length > maxBytes) throw Object.assign(new Error("object too large"), { tooLarge: true });
    return Buffer.from(o.body);
  }
  async putObject(p: { key: string; body: Buffer; contentType: string }) {
    this.objects.set(p.key, { body: Buffer.from(p.body), contentType: p.contentType });
  }
  async deleteObject(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  /** What a browser would do after presign: drop the bytes at the intent's key with the declared Content-Type. */
  upload(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  keysWithPrefix(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── notification + admin-broadcast stubs ───────────────────────────────────────────────────────

export function stubSideEffects() {
  const published: unknown[] = [];
  const adminBroadcasts: Array<{ revisionId: string; ptUserId: string }> = [];
  const restores = [
    patch(notificationService, "publish", (n: unknown) => {
      published.push(n);
    }),
    patch(listingHooks, "notifyAdminsSubmitted", (revisionId: string, ptUserId: string) => {
      adminBroadcasts.push({ revisionId, ptUserId });
    }),
  ];
  return { published, adminBroadcasts, restore: () => restores.forEach((r) => r()) };
}

// ── images ─────────────────────────────────────────────────────────────────────────────────────

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
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
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
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ── database fixtures ──────────────────────────────────────────────────────────────────────────

export async function makeApprovedPt(marker?: string) {
  return makePublicPt(marker ? { marker } : {});
}

let photoSeq = 0;
/** A photo row (and its object in `storage`) without going through the upload pipeline. */
export async function seedPhoto(
  storage: InMemoryPtMediaStorage,
  ptUserId: string,
  status: "STAGED" | "PUBLISHED" | "RETIRED" | "DISCARDED" = "STAGED",
  over: Partial<{ sortOrder: number; isCover: boolean; createdAt: Date; retiredAt: Date | null; withHash: boolean }> = {},
) {
  photoSeq += 1;
  const id = randomUUID();
  const key = `pt-physique/${ptUserId}/${id}.webp`;
  storage.upload(key, Buffer.from(`image-${id}`), "image/webp");
  return prisma.ptPhysiquePhoto.create({
    data: {
      id,
      ptUserId,
      storageKey: key,
      status,
      sortOrder: over.sortOrder ?? 0,
      isCover: over.isCover ?? false,
      mime: "image/webp",
      bytes: 1000 + photoSeq,
      contentHash: over.withHash === false ? null : sha256(Buffer.from(`hash-${id}`)),
      uploadedBy: ptUserId,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      ...(over.retiredAt !== undefined ? { retiredAt: over.retiredAt } : {}),
    },
  });
}

/** A fixed payload builder: published listing of `ptUserId` with overrides. */
export function payloadOf(
  published: any,
  over: Partial<{ profile: Record<string, unknown>; packages: unknown[]; photoIds: string[]; coverPhotoId: string | null }> = {},
) {
  return {
    profile: { ...published.published.payload.profile, ...(over.profile ?? {}) },
    packages: over.packages ?? published.published.payload.packages,
    photoIds: over.photoIds ?? published.published.payload.photoIds,
    coverPhotoId: over.coverPhotoId !== undefined ? over.coverPhotoId : published.published.payload.coverPhotoId,
  };
}

/**
 * A second listener over the same Express app, for assertions on response HEADERS and redirects (the shared
 * startApp().call() only returns status + body). It relies on startApp() having installed the auth stub.
 */
export async function startRawServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const { default: expressApp } = await import("../app");
  const server = expressApp.listen(0);
  return {
    base: `http://127.0.0.1:${(server.address() as any).port}`,
    async close() {
      (server as any).closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

export { makePackage };
