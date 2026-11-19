import crypto from "node:crypto";

const TEST_EPHEMERAL_SECRET = crypto.randomBytes(32);

function isTestEnv(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.NODE_ENV === "test" ||
    process.env.GYMINI_TEST_ISOLATION === "1"
  );
}

function resolveKey(): Buffer {
  const raw =
    process.env.GYM_SEARCH_CURSOR_SECRET ||
    process.env.INTERNAL_SERVICE_SECRET ||
    "";
  if (raw.trim().length > 0) {
    return crypto.createHash("sha256").update(raw, "utf8").digest();
  }
  if (isTestEnv()) {
    return TEST_EPHEMERAL_SECRET;
  }
  const err = new Error(
    "Missing GYM_SEARCH_CURSOR_SECRET or INTERNAL_SERVICE_SECRET",
  ) as Error & { status?: number; code?: string };
  err.status = 503;
  err.code = "CURSOR_SECRET_UNAVAILABLE";
  throw err;
}

export function assertGymSearchCursorSecretConfigured(): void {
  resolveKey();
}

export type GymSearchCursorSort = "distance" | "rating" | "price" | "relevance";
export type GymSearchCursorScope = "near" | "province" | "national";

export interface GymsSearchCursorPayload {
  v: 1;
  kind: "gyms_search";
  sort: GymSearchCursorSort;
  scope: GymSearchCursorScope;
  filterHash: string;
  /** Primary keyset tie-breaker tuple for NULLS LAST keyset pagination. */
  distanceKm?: number | null;
  relevanceScore?: number | null;
  ratingAvg?: number | null;
  fromPrice?: number | null;
  reviewCount?: number | null;
  id: string;
}

export interface BrandOptionsCursorPayload {
  v: 1;
  kind: "brand_options";
  filterHash: string;
  sortNameLower: string;
  sortKey: string;
}

export type AnyGymCursorPayload =
  | GymsSearchCursorPayload
  | BrandOptionsCursorPayload;

export class GymCursorError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function computeGymSearchFilterHash(input: {
  scope: GymSearchCursorScope;
  sort: GymSearchCursorSort;
  radiusKm: number | null;
  areaProvince: number | null;
  areaWard: number | null;
  q: string | null;
  amenityIds: string[];
  priceMax: number | null;
  originKind: "GPS" | "WARD_CENTER" | null;
  originLat: number | null;
  originLng: number | null;
}): string {
  const normalized = {
    scope: input.scope,
    sort: input.sort,
    radiusKm: input.radiusKm,
    areaProvince: input.areaProvince,
    areaWard: input.areaWard,
    q: input.q,
    amenityIds: [...input.amenityIds].sort(),
    priceMax: input.priceMax,
    originKind: input.originKind,
    originLat:
      input.originLat != null ? Number(input.originLat.toFixed(3)) : null,
    originLng:
      input.originLng != null ? Number(input.originLng.toFixed(3)) : null,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("base64url")
    .slice(0, 16);
}

export function computeBrandOptionsFilterHash(input: {
  q: string | null;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ q: input.q ?? null }))
    .digest("base64url")
    .slice(0, 16);
}

export function encodeGymCursor(payload: AnyGymCursorPayload): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decodeGymCursor(
  token: string,
  expectedKind: "gyms_search",
  expectedFilterHash: string,
): GymsSearchCursorPayload;
export function decodeGymCursor(
  token: string,
  expectedKind: "brand_options",
  expectedFilterHash: string,
): BrandOptionsCursorPayload;
export function decodeGymCursor(
  token: string,
  expectedKind: AnyGymCursorPayload["kind"],
  expectedFilterHash: string,
): AnyGymCursorPayload {
  const key = resolveKey();
  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  if (raw.length < 12 + 16 + 2) {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  let decoded: unknown;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
    decoded = JSON.parse(plain);
  } catch {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }

  if (!decoded || typeof decoded !== "object") {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  const obj = decoded as Record<string, unknown>;
  if (obj.v !== 1 || obj.kind !== expectedKind) {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  if (
    expectedKind === "gyms_search" &&
    (typeof obj.id !== "string" || !obj.id)
  ) {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  if (
    expectedKind === "brand_options" &&
    (typeof obj.sortNameLower !== "string" || typeof obj.sortKey !== "string")
  ) {
    throw new GymCursorError(400, "INVALID_CURSOR", "Cursor không hợp lệ");
  }
  if (obj.filterHash !== expectedFilterHash) {
    throw new GymCursorError(
      409,
      "CURSOR_FILTER_MISMATCH",
      "Bộ lọc tìm kiếm đã thay đổi, vui lòng tìm lại từ đầu",
    );
  }
  return decoded as AnyGymCursorPayload;
}
