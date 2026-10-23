import { partnerS3 } from './partner-s3.service';

/**
 * Listing Management B2 — the storage PORT of the branch-photo pipeline (plan §12.2).
 *
 * Production uses the existing partner pipeline (`partnerS3`: bucket `gymini-partner-private`, no public policy, only
 * short presigned GETs) under the key prefix `listing-photos/<gymId>/`. The code that validates and normalises an
 * upload talks to THIS interface, so integration tests can swap in an in-memory adapter (`setListingPhotoStorage`)
 * and exercise the whole pipeline without a MinIO - exactly like user-service's `PtMediaStorage`.
 *
 * Every default method calls `partnerS3.<method>` at call time (not at import time), so a test that stubs a
 * `partnerS3` method still takes effect.
 */
export interface ListingPhotoStorage {
  isConfigured(): boolean;
  /** Presigned POST: the size range and Content-Type are signed into the policy, S3 itself refuses anything else. */
  presignUpload(params: { key: string; contentType: string; maxBytes: number; expiresSec?: number }): Promise<{ url: string; fields: Record<string, string> }>;
  presignGet(params: { key: string; contentType?: string; expiresSec?: number }): Promise<string>;
  /** Metadata only; null when the object does not exist. */
  head(key: string): Promise<{ contentLength?: number; contentType?: string } | null>;
  /** The whole object. Throws `{ tooLarge: true }` past maxBytes; null when it does not exist. */
  getObject(key: string, maxBytes: number): Promise<Buffer | null>;
  putObject(params: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Deleting a key that is not there is not an error. */
  deleteObject(key: string): Promise<void>;
}

export const s3ListingPhotoStorage: ListingPhotoStorage = {
  isConfigured: () => partnerS3.isConfigured(),
  presignUpload: (p) => partnerS3.presignUpload(p),
  presignGet: (p) => partnerS3.presignGet({ key: p.key, contentType: p.contentType, attachment: false, expiresSec: p.expiresSec }),
  async head(key) {
    const out = await partnerS3.headObject(key);
    return out ? { contentLength: out.contentLength, contentType: out.contentType } : null;
  },
  getObject: (key, maxBytes) => partnerS3.getObjectBytes(key, maxBytes),
  putObject: (p) => partnerS3.putObject(p),
  deleteObject: (key) => partnerS3.deleteObject(key),
};

let active: ListingPhotoStorage = s3ListingPhotoStorage;

/** The storage every listing-photo caller uses. */
export function listingPhotoStorage(): ListingPhotoStorage {
  return active;
}

/** Test seam: swap the adapter (returns a function that restores the previous one). */
export function setListingPhotoStorage(impl: ListingPhotoStorage): () => void {
  const previous = active;
  active = impl;
  return () => {
    active = previous;
  };
}

/** Object-key layout of the pipeline, in ONE place. `original` is what the browser POSTs to; `final` is the
 * normalised WebP. The final key is derived from the INTENT id so a sweep can find (and delete) it after a crash. */
export const LISTING_PHOTO_PREFIX = 'listing-photos';
export const listingPhotoKeys = {
  prefixOf: (gymId: string) => `${LISTING_PHOTO_PREFIX}/${gymId}/`,
  original: (gymId: string, random: string) => `${LISTING_PHOTO_PREFIX}/${gymId}/${random}`,
  final: (gymId: string, intentId: string) => `${LISTING_PHOTO_PREFIX}/${gymId}/${intentId}.webp`,
  /** The final key of an intent, from the intent row alone (its objectKey is the original key). */
  finalOfIntent: (objectKey: string, intentId: string) => {
    const gymId = objectKey.split('/')[1];
    return `${LISTING_PHOTO_PREFIX}/${gymId}/${intentId}.webp`;
  },
  isListingKey: (key: string) => key.startsWith(`${LISTING_PHOTO_PREFIX}/`),
};
