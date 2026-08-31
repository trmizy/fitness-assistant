import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return s3Client;
}

export const UPLOAD_BUCKET_ENV = "USER_UPLOAD_BUCKET";
export const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;
export const PROFILE_PHOTO_PREFIX = "profile-photos";
export const PT_APPLICATION_PREFIX = "pt-applications";
export const CONTRACT_PREFIX = "contracts";

const ALLOWED_PROFILE_PHOTO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_PT_DOCUMENT_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export interface PresignedUploadTarget {
  uploadUrl: string;
  key: string;
  url: string;
  previewUrl: string;
  expiresInSeconds: number;
  maxBytes?: number;
}

export interface ProfilePhotoUploadTarget {
  uploadUrl: string;
  key: string;
  photoUrl: string;
  previewUrl: string;
  expiresInSeconds: number;
  maxBytes: number;
}

function getUploadBucket(): string {
  const bucket = process.env[UPLOAD_BUCKET_ENV];
  if (!bucket) {
    throw { status: 500, message: `${UPLOAD_BUCKET_ENV} is not configured` };
  }
  return bucket;
}

export function assertSafeS3Key(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw { status: 400, message: "Invalid S3 object key" };
  }
}

export function s3RefForKey(key: string): string {
  assertSafeS3Key(key);
  return `s3://${key}`;
}

export function isS3Ref(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("s3://");
}

export function keyFromS3Ref(ref: string): string {
  if (!isS3Ref(ref)) {
    throw { status: 400, message: "Invalid S3 reference" };
  }
  const key = ref.slice("s3://".length);
  assertSafeS3Key(key);
  return key;
}

export function isKeyWithinPrefix(key: string, prefix: string): boolean {
  try {
    assertSafeS3Key(key);
    return key.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

export async function createPresignedPutObject(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  assertSafeS3Key(params.key);
  const command = new PutObjectCommand({
    Bucket: getUploadBucket(),
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getS3Client(), command, {
    expiresIn: params.expiresInSeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS,
  });
}

export async function createPresignedGetObject(params: {
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  assertSafeS3Key(params.key);
  const command = new GetObjectCommand({
    Bucket: getUploadBucket(),
    Key: params.key,
  });
  return getSignedUrl(getS3Client(), command, {
    expiresIn: params.expiresInSeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS,
  });
}

export async function putPrivateObject(params: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
}): Promise<string> {
  assertSafeS3Key(params.key);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getUploadBucket(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
  return s3RefForKey(params.key);
}

export async function deletePrivateObject(key: string): Promise<void> {
  assertSafeS3Key(key);
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getUploadBucket(),
      Key: key,
    }),
  );
}

export async function createProfilePhotoUploadUrl(
  userId: string,
  contentType: string,
): Promise<ProfilePhotoUploadTarget> {
  if (!ALLOWED_PROFILE_PHOTO_CONTENT_TYPES.has(contentType)) {
    throw {
      status: 400,
      message: "contentType must be one of: image/jpeg, image/png, image/webp",
    };
  }

  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  const key = `${PROFILE_PHOTO_PREFIX}/${userId}/${randomUUID()}.${extension}`;
  const [uploadUrl, previewUrl] = await Promise.all([
    createPresignedPutObject({ key, contentType }),
    createPresignedGetObject({ key }),
  ]);

  return {
    uploadUrl,
    key,
    photoUrl: s3RefForKey(key),
    previewUrl,
    expiresInSeconds: DEFAULT_PRESIGN_EXPIRY_SECONDS,
    maxBytes: 5 * 1024 * 1024,
  };
}

export function isOwnProfilePhotoKey(userId: string, key: string): boolean {
  return isKeyWithinPrefix(key, `${PROFILE_PHOTO_PREFIX}/${userId}`);
}

export function profilePhotoUrlForKey(key: string): string {
  return s3RefForKey(key);
}

export async function toSignedProfilePhotoUrl(
  photoUrl: string | null | undefined,
): Promise<string | null> {
  if (!photoUrl) return photoUrl ?? null;
  if (!isS3Ref(photoUrl)) return photoUrl;
  const key = keyFromS3Ref(photoUrl);
  if (!isKeyWithinPrefix(key, PROFILE_PHOTO_PREFIX)) return photoUrl;
  return createPresignedGetObject({ key });
}

export async function createPtApplicationDocumentUploadUrl(
  userId: string,
  contentType: string,
): Promise<PresignedUploadTarget> {
  if (!ALLOWED_PT_DOCUMENT_CONTENT_TYPES.has(contentType)) {
    throw {
      status: 400,
      message: "contentType must be one of: image/jpeg, image/png, application/pdf",
    };
  }

  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  const key = `${PT_APPLICATION_PREFIX}/${userId}/${randomUUID()}.${extension}`;
  const [uploadUrl, previewUrl] = await Promise.all([
    createPresignedPutObject({ key, contentType }),
    createPresignedGetObject({ key }),
  ]);

  return {
    uploadUrl,
    key,
    url: s3RefForKey(key),
    previewUrl,
    expiresInSeconds: DEFAULT_PRESIGN_EXPIRY_SECONDS,
    maxBytes: 10 * 1024 * 1024,
  };
}

export function isOwnPtApplicationDocumentKey(
  userId: string,
  key: string,
): boolean {
  return isKeyWithinPrefix(key, `${PT_APPLICATION_PREFIX}/${userId}`);
}

export function ptApplicationDocumentUrlForKey(key: string): string {
  if (!isKeyWithinPrefix(key, PT_APPLICATION_PREFIX)) {
    throw { status: 400, message: "Invalid PT application document key" };
  }
  return s3RefForKey(key);
}

export function contractPdfKey(contractId: string): string {
  return `${CONTRACT_PREFIX}/${contractId}/contract.pdf`;
}
