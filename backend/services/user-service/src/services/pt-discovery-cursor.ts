import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const CURSOR_VERSION = "v1";
const TEST_ONLY_CURSOR_SECRET = "gymini-test-only-discovery-cursor-key-v1";

export type DiscoveryDistanceBasis = "GPS" | "WARD_CENTER" | null;
export type DiscoveryScope = "near" | "province" | "national";
export type DiscoveryMode = "ANY" | "ONLINE" | "OFFLINE" | "HYBRID";
export type DiscoverySortKey =
  | "default"
  | "distance"
  | "ratingDesc"
  | "ratingAsc"
  | "priceAsc"
  | "priceDesc"
  | "nameAsc";

export interface DiscoveryFilterFingerprintInput {
  mode: DiscoveryMode;
  appliedScope: DiscoveryScope;
  sortBy: DiscoverySortKey;
  areaProvince: number | null;
  areaWard: number | null;
  pLat: number | null;
  pLng: number | null;
  distanceBasis: DiscoveryDistanceBasis;
  radiusKm: number | null;
  q: string | null;
  specialties: string[] | null;
  minPrice: number | null;
  maxPrice: number | null;
  gymId: string | null;
  viewerGymIds: string[];
}

export interface DiscoveryCursorPayload {
  v: 1;
  epoch: number;
  filterHash: string;
  tier: number;
  isAccepting: boolean;
  bucket: number;
  sameGym: boolean;
  sortKind: DiscoverySortKey;
  sortNum: number | null;
  sortStr: string | null;
  userId: string;
}

export class CursorSecretUnavailableError extends Error {
  readonly status = 503;
  readonly code = "CURSOR_SECRET_UNAVAILABLE";
  constructor() {
    super("PT discovery cursor secret is not configured");
  }
}

export class InvalidCursorError extends Error {
  readonly status = 400;
  readonly code = "INVALID_CURSOR";
  constructor(message = "Con trỏ phân trang không hợp lệ") {
    super(message);
  }
}

export class CursorExpiredError extends Error {
  readonly status = 409;
  readonly code = "CURSOR_EXPIRED";
  constructor(message = "Danh sách đã cập nhật") {
    super(message);
  }
}

export class CursorFilterMismatchError extends Error {
  readonly status = 409;
  readonly code = "CURSOR_FILTER_MISMATCH";
  constructor(message = "Bộ lọc tìm kiếm đã thay đổi, vui lòng tải lại từ đầu") {
    super(message);
  }
}

/**
 * Derives the 256-bit AES-GCM key from PT_DISCOVERY_CURSOR_SECRET (preferred) or
 * INTERNAL_SERVICE_SECRET. Never uses a hardcoded secret outside NODE_ENV === "test".
 */
export function resolveDiscoveryCursorKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.PT_DISCOVERY_CURSOR_SECRET || env.INTERNAL_SERVICE_SECRET;
  if (configured && configured.trim().length > 0) {
    return createHash("sha256").update(configured, "utf8").digest();
  }
  if (env.NODE_ENV === "test") {
    return createHash("sha256").update(TEST_ONLY_CURSOR_SECRET, "utf8").digest();
  }
  throw new CursorSecretUnavailableError();
}

/**
 * One-way fingerprint of all query inputs affecting page membership and order.
 * Raw viewer coordinates are folded into SHA-256 and never stored in clear inside the cursor.
 */
export function computeDiscoveryFilterHash(input: DiscoveryFilterFingerprintInput): string {
  const normalized = {
    mode: input.mode,
    appliedScope: input.appliedScope,
    sortBy: input.sortBy,
    areaProvince: input.areaProvince,
    areaWard: input.areaWard,
    pLat: input.pLat,
    pLng: input.pLng,
    distanceBasis: input.distanceBasis,
    radiusKm: input.appliedScope === "near" ? input.radiusKm : null,
    q: input.q,
    specialties: input.specialties ? [...new Set(input.specialties)].sort() : null,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    gymId: input.gymId,
    viewerGymIds: input.sortBy === "default" ? [...new Set(input.viewerGymIds)].sort() : [],
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function encodeDiscoveryCursor(
  payload: DiscoveryCursorPayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = resolveDiscoveryCursorKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURSOR_VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decodeDiscoveryCursor(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): DiscoveryCursorPayload {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new InvalidCursorError();
  }
  const key = resolveDiscoveryCursorKey(env);
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== CURSOR_VERSION) {
    throw new InvalidCursorError();
  }

  let parsed: unknown;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new InvalidCursorError();
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    parsed = JSON.parse(decrypted.toString("utf8"));
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err;
    throw new InvalidCursorError();
  }

  if (!isValidCursorPayload(parsed)) {
    throw new InvalidCursorError();
  }
  return parsed;
}

const VALID_SORT_KEYS = new Set<string>([
  "default",
  "distance",
  "ratingDesc",
  "ratingAsc",
  "priceAsc",
  "priceDesc",
  "nameAsc",
]);

function isValidCursorPayload(val: unknown): val is DiscoveryCursorPayload {
  if (!val || typeof val !== "object") return false;
  const p = val as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.epoch === "number" &&
    Number.isInteger(p.epoch) &&
    p.epoch >= 0 &&
    typeof p.filterHash === "string" &&
    /^[0-9a-f]{64}$/.test(p.filterHash) &&
    typeof p.tier === "number" &&
    (p.tier === 0 || p.tier === 1) &&
    typeof p.isAccepting === "boolean" &&
    typeof p.bucket === "number" &&
    Number.isInteger(p.bucket) &&
    p.bucket >= 0 &&
    p.bucket <= 7 &&
    typeof p.sameGym === "boolean" &&
    typeof p.sortKind === "string" &&
    VALID_SORT_KEYS.has(p.sortKind) &&
    (p.sortNum === null || (typeof p.sortNum === "number" && Number.isFinite(p.sortNum))) &&
    (p.sortStr === null || typeof p.sortStr === "string") &&
    typeof p.userId === "string" &&
    p.userId.length > 0
  );
}

