import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Private object storage for PT physique photos (listing management, plan §12.2 / Q3).
 *
 * ONE private bucket (PT_MEDIA_S3_BUCKET), no public policy of any kind: a file is readable only through a
 * short-lived presigned GET that this service hands out - for published photos from GET /media/pt-physique/:id
 * (302), for staged ones inside an authenticated preview response. Configured with PT_MEDIA_S3_* on purpose and
 * NOT with USER_UPLOAD_BUCKET / AWS_*: switching those on would also move the profile-photo / PT-document /
 * contract storage, which is out of scope here.
 *
 * Presigned URLs are signed for PT_MEDIA_S3_PUBLIC_ENDPOINT (the host a BROWSER will call); server-side calls
 * (HEAD, GET, PUT, DELETE) use PT_MEDIA_S3_ENDPOINT. On AWS both stay empty.
 *
 * The code talks to the {@link PtMediaStorage} PORT; tests inject an in-memory adapter with
 * {@link setPtMediaStorage} so the upload pipeline can be exercised without a MinIO.
 */

export interface PtMediaStorage {
  isConfigured(): boolean;
  /** Presigned POST: the size range and Content-Type are signed into the policy, S3 itself refuses anything else. */
  presignUpload(params: { key: string; contentType: string; maxBytes: number; expiresSec?: number }): Promise<{ url: string; fields: Record<string, string> }>;
  presignGet(params: { key: string; contentType?: string; expiresSec?: number }): Promise<string>;
  /** Metadata only; null when the object does not exist. */
  head(key: string): Promise<{ contentLength?: number; contentType?: string } | null>;
  /** The whole object. Throws {tooLarge:true} past maxBytes; null when it does not exist. */
  getObject(key: string, maxBytes: number): Promise<Buffer | null>;
  putObject(params: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Deleting a key that is not there is not an error. */
  deleteObject(key: string): Promise<void>;
}

interface S3Config {
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  bucket: string;
}

function readConfig(): S3Config {
  const accessKeyId = process.env.PT_MEDIA_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.PT_MEDIA_S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.PT_MEDIA_S3_ENDPOINT || undefined;
  return {
    endpoint,
    publicEndpoint: process.env.PT_MEDIA_S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.PT_MEDIA_S3_REGION || process.env.AWS_REGION || "us-east-1",
    forcePathStyle: process.env.PT_MEDIA_S3_FORCE_PATH_STYLE === "true",
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    bucket: process.env.PT_MEDIA_S3_BUCKET || "",
  };
}

function makeClient(cfg: S3Config, endpoint: string | undefined): S3Client {
  return new S3Client({ region: cfg.region, endpoint, forcePathStyle: cfg.forcePathStyle, credentials: cfg.credentials });
}

let cached: { key: string; internal: S3Client; signing: S3Client } | null = null;
function clients(cfg: S3Config) {
  const key = JSON.stringify([cfg.endpoint, cfg.publicEndpoint, cfg.region, cfg.forcePathStyle, cfg.credentials?.accessKeyId]);
  if (!cached || cached.key !== key) {
    cached = { key, internal: makeClient(cfg, cfg.endpoint), signing: makeClient(cfg, cfg.publicEndpoint) };
  }
  return cached;
}

function unavailable(): Error {
  return Object.assign(new Error("Tính năng tải ảnh chưa được cấu hình trên môi trường này"), {
    status: 503,
    code: "UPLOADS_UNAVAILABLE",
  });
}

async function readBody(body: any, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("object too large"), { tooLarge: true });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const s3PtMediaStorage: PtMediaStorage = {
  isConfigured: () => Boolean(readConfig().bucket),

  async presignUpload({ key, contentType, maxBytes, expiresSec }) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    const { url, fields } = await createPresignedPost(clients(cfg).signing, {
      Bucket: cfg.bucket,
      Key: key,
      Expires: expiresSec ?? 600,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["content-length-range", 1, maxBytes],
        ["eq", "$Content-Type", contentType],
      ],
    });
    return { url, fields };
  },

  async presignGet({ key, contentType, expiresSec }) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    return getSignedUrl(
      clients(cfg).signing,
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: "inline" }),
      { expiresIn: expiresSec ?? 600 },
    );
  },

  async head(key) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    try {
      const out = await clients(cfg).internal.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { contentLength: out.ContentLength, contentType: out.ContentType };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
      throw e;
    }
  },

  async getObject(key, maxBytes) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    try {
      const out = await clients(cfg).internal.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return await readBody(out.Body, maxBytes);
    } catch (e: any) {
      if (e?.tooLarge) throw e;
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey") return null;
      throw e;
    }
  },

  async putObject({ key, body, contentType }) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    await clients(cfg).internal.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  },

  async deleteObject(key) {
    const cfg = readConfig();
    if (!cfg.bucket) throw unavailable();
    await clients(cfg).internal.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  },
};

let active: PtMediaStorage = s3PtMediaStorage;

/** The storage every caller uses. */
export function ptMediaStorage(): PtMediaStorage {
  return active;
}

/** Test seam: swap the adapter (returns a function that restores the previous one). */
export function setPtMediaStorage(impl: PtMediaStorage): () => void {
  const previous = active;
  active = impl;
  return () => {
    active = previous;
  };
}
