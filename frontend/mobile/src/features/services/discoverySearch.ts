/**
 * U2 Discovery — pure search logic for the mobile PT / gym discovery screens. Mirrors web's
 * `frontend/web/src/app/utils/discoverySearch.ts` + `ptPaging.ts` (U1) so both clients speak the same
 * contract (`_warroom/gemini-A/API_CONTRACT.md`), with the same Vietnamese copy.
 *
 * Privacy rules this module enforces (plan v2.2.5, "Vị trí và quyền riêng tư"):
 *  - a GPS fix is rounded to 3 decimals before it is used for anything;
 *  - coordinates only ever exist in a POST body (`buildPtSearchBody` / `buildGymSearchBody`) — there is no
 *    helper here that puts them in a URL or a query string, and nothing here logs or persists them;
 *  - only AREA CODES (province / ward) are ever saved, via `PUT /profile/me` (`regionPayload`).
 *
 * Pure: no React Native, no Expo, no axios import — runs under `tsx --test`.
 */

export type SearchScope = "near" | "province" | "national";
export type PtServiceMode = "ANY" | "ONLINE" | "OFFLINE" | "HYBRID";
export type PtSortBy = "default" | "distance" | "ratingDesc" | "ratingAsc" | "priceAsc" | "priceDesc" | "nameAsc";
export type GymSortBy = "relevance" | "distance" | "rating" | "price";
export type DistanceBasis = "GPS" | "WARD_CENTER" | null;

/** "Mở rộng bán kính": 10 → 20 → 50 km. */
export const RADIUS_STEPS = [10, 20, 50] as const;
export const DEFAULT_RADIUS_KM = 10;
export const VN_LAT_RANGE = [8, 24] as const;
export const VN_LNG_RANGE = [102, 110] as const;

export const LIST_UPDATED_NOTICE = "Danh sách đã cập nhật";
export const LIST_UPDATED_BANNER = "Danh sách đã cập nhật — đã tải lại từ đầu.";

export interface Coords {
  lat: number;
  lng: number;
}

/** Rounds a coordinate to 3 decimal places (~110 m) before any API transmission. */
export function roundCoord3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Validates the Vietnam bounding box and returns 3-decimal rounded coordinates, or null if invalid. */
export function normalizeVnCoords(raw?: { lat?: number | null; lng?: number | null } | null): Coords | null {
  if (!raw || typeof raw.lat !== "number" || typeof raw.lng !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
  const lat = roundCoord3(raw.lat);
  const lng = roundCoord3(raw.lng);
  if (lat < VN_LAT_RANGE[0] || lat > VN_LAT_RANGE[1]) return null;
  if (lng < VN_LNG_RANGE[0] || lng > VN_LNG_RANGE[1]) return null;
  return { lat, lng };
}

/** Next step for the "Mở rộng bán kính" button: 10 → 20 → 50 → null. */
export function nextRadiusStep(currentRadius?: number | null): number | null {
  const r = typeof currentRadius === "number" && Number.isFinite(currentRadius) ? currentRadius : DEFAULT_RADIUS_KM;
  if (r < 10) return 10;
  if (r < 20) return 20;
  if (r < 50) return 50;
  return null;
}

/** "3,2" — Vietnamese decimal comma, one digit. */
export function formatKmVi(km: number): string {
  return (Math.round(km * 10) / 10).toFixed(1).replace(".", ",");
}

// ── Distance labels (plan v2.2.5) ───────────────────────────────────────────────────────────────

export interface DistanceBadgeView {
  kind: "GPS" | "WARD_CENTER" | "ONLINE" | "NONE";
  text: string | null;
}

/**
 * A PT result's badge, from `distanceBasis` / `distanceKm` of `POST /profile/pts/search`:
 *  - GPS          → "~3,2 km (đường chim bay)"
 *  - WARD_CENTER  → "~x km từ trung tâm <phường>"
 *  - online tier  → "Dạy online"
 *  - province only / national (no distance) → NONE: no distance is ever invented.
 */
export function formatPtDistanceBadge(
  pt: {
    distanceKm?: number | null;
    distanceBasis?: DistanceBasis;
    ptApplication?: { serviceMode?: string | null } | null;
  },
  ctx?: {
    selectedWardName?: string | null;
    appliedScope?: SearchScope | null;
    requestedMode?: PtServiceMode | null;
  },
): DistanceBadgeView {
  const km = pt?.distanceKm;
  const basis = pt?.distanceBasis ?? null;

  if (typeof km === "number" && Number.isFinite(km)) {
    const kmText = formatKmVi(km);
    if (basis === "GPS") return { kind: "GPS", text: `~${kmText} km (đường chim bay)` };
    if (basis === "WARD_CENTER") {
      const ward = ctx?.selectedWardName?.trim();
      return {
        kind: "WARD_CENTER",
        text: ward ? `~${kmText} km từ trung tâm ${ward}` : `~${kmText} km từ trung tâm phường`,
      };
    }
  }

  const ptMode = String(pt?.ptApplication?.serviceMode ?? "").toUpperCase();
  const reqMode = String(ctx?.requestedMode ?? "ANY").toUpperCase();
  const inNearOnlineFallback = ctx?.appliedScope === "near" && (ptMode === "ONLINE" || ptMode === "HYBRID");
  if (reqMode === "ONLINE" || ptMode === "ONLINE" || inNearOnlineFallback) {
    return { kind: "ONLINE", text: "Dạy online" };
  }
  return { kind: "NONE", text: null };
}

/**
 * A gym result's badge, from the user's active location choice + `appliedScope` of `POST /gyms/search`:
 *  - GPS active and distanceKm present                          → "~x km (đường chim bay)"
 *  - no GPS, a ward chosen, appliedScope "near", distanceKm set  → "~x km từ trung tâm <phường>"
 *  - otherwise (province only / national / server fell back)     → NONE
 */
export function formatGymDistanceBadge(params: {
  distanceKm?: number | null;
  appliedScope?: SearchScope | null;
  hasGps: boolean;
  selectedWardName?: string | null;
}): DistanceBadgeView {
  const { distanceKm, appliedScope, hasGps, selectedWardName } = params;
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return { kind: "NONE", text: null };
  const kmText = formatKmVi(distanceKm);
  if (hasGps) return { kind: "GPS", text: `~${kmText} km (đường chim bay)` };
  if (selectedWardName?.trim() && appliedScope === "near") {
    return { kind: "WARD_CENTER", text: `~${kmText} km từ trung tâm ${selectedWardName.trim()}` };
  }
  return { kind: "NONE", text: null };
}

// ── Request bodies ──────────────────────────────────────────────────────────────────────────────

export function resolveEffectiveScope(opts: {
  national: boolean;
  hasGps: boolean;
  provinceCode?: number | null;
  wardCode?: number | null;
}): SearchScope {
  if (opts.national) return "national";
  if (opts.hasGps) return "near";
  if (opts.provinceCode && opts.wardCode) return "near";
  if (opts.provinceCode) return "province";
  return "national";
}

export interface PtSearchBuildInput {
  gpsCoords?: { lat?: number | null; lng?: number | null } | null;
  provinceCode?: number | null;
  wardCode?: number | null;
  national?: boolean;
  radiusKm?: number;
  mode?: PtServiceMode | "";
  sortBy?: PtSortBy;
  q?: string;
  specialties?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  gymId?: string | null;
  limit?: number;
}

export interface PtSearchBody {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  areaProvince?: number;
  areaWard?: number;
  scope: SearchScope;
  mode: PtServiceMode;
  sortBy: PtSortBy;
  filters?: {
    q?: string;
    specialties?: string[];
    minPrice?: number;
    maxPrice?: number;
    gymId?: string;
  };
  limit: number;
}

function resolveArea(input: {
  gpsCoords?: { lat?: number | null; lng?: number | null } | null;
  provinceCode?: number | null;
  wardCode?: number | null;
  national?: boolean;
}) {
  const national = !!input.national;
  const coords = national ? null : normalizeVnCoords(input.gpsCoords);
  const prov = !national && typeof input.provinceCode === "number" && input.provinceCode > 0 ? input.provinceCode : null;
  const ward = !national && prov && typeof input.wardCode === "number" && input.wardCode > 0 ? input.wardCode : null;
  const scope = resolveEffectiveScope({ national, hasGps: !!coords, provinceCode: prov, wardCode: ward });
  return { coords, prov, ward, scope };
}

const clampLimit = (n: number | undefined) => Math.min(50, Math.max(1, Math.round(n ?? 20)));
const clampRadius = (n: number | undefined) => Math.min(100, Math.max(1, Math.round(n ?? DEFAULT_RADIUS_KM)));

/** Body of `POST /profile/pts/search` (page 1; the cursor is added by `withCursor`). Coordinates: 3 decimals, body only. */
export function buildPtSearchBody(input: PtSearchBuildInput): PtSearchBody {
  const { coords, prov, ward, scope } = resolveArea(input);

  const filters: NonNullable<PtSearchBody["filters"]> = {};
  const q = input.q?.trim();
  if (q) filters.q = q;
  const specs = (input.specialties ?? []).map((s) => s.trim()).filter(Boolean);
  if (specs.length > 0) filters.specialties = specs;
  if (typeof input.minPrice === "number" && Number.isFinite(input.minPrice) && input.minPrice >= 0) {
    filters.minPrice = input.minPrice;
  }
  if (typeof input.maxPrice === "number" && Number.isFinite(input.maxPrice) && input.maxPrice > 0) {
    filters.maxPrice = input.maxPrice;
  }
  if (input.gymId?.trim()) filters.gymId = input.gymId.trim();

  const body: PtSearchBody = {
    scope,
    mode: (input.mode || "ANY") as PtServiceMode,
    sortBy: input.sortBy || "default",
    limit: clampLimit(input.limit),
  };
  if (coords) {
    body.lat = coords.lat;
    body.lng = coords.lng;
  }
  if (scope === "near") body.radiusKm = clampRadius(input.radiusKm);
  if (prov) {
    body.areaProvince = prov;
    if (ward) body.areaWard = ward;
  }
  if (Object.keys(filters).length > 0) body.filters = filters;
  return body;
}

export interface GymSearchBuildInput {
  gpsCoords?: { lat?: number | null; lng?: number | null } | null;
  provinceCode?: number | null;
  wardCode?: number | null;
  national?: boolean;
  radiusKm?: number;
  q?: string;
  amenityIds?: string[];
  priceMax?: number | null;
  sort?: GymSortBy;
  limit?: number;
}

export interface GymSearchBody {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  scope: SearchScope;
  areaProvince?: number;
  areaWard?: number;
  q?: string;
  amenityIds?: string[];
  priceMax?: number;
  sort: GymSortBy;
  limit: number;
}

/** Body of `POST /gyms/search` (page 1). */
export function buildGymSearchBody(input: GymSearchBuildInput): GymSearchBody {
  const { coords, prov, ward, scope } = resolveArea(input);
  const body: GymSearchBody = { scope, sort: input.sort || "relevance", limit: clampLimit(input.limit) };
  if (coords) {
    body.lat = coords.lat;
    body.lng = coords.lng;
  }
  if (scope === "near") body.radiusKm = clampRadius(input.radiusKm);
  if (prov) {
    body.areaProvince = prov;
    if (ward) body.areaWard = ward;
  }
  const q = input.q?.trim();
  if (q) body.q = q;
  const amenities = (input.amenityIds ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (amenities.length > 0) body.amenityIds = amenities;
  if (typeof input.priceMax === "number" && Number.isFinite(input.priceMax) && input.priceMax >= 0) {
    body.priceMax = input.priceMax;
  }
  return body;
}

/** A body + the opaque cursor of the previous page. Page 1 (no cursor) leaves the body untouched. */
export function withCursor<T extends object>(body: T, cursor: string | null | undefined): T & { cursor?: string } {
  return cursor ? { ...body, cursor } : { ...body };
}

/** Query for `GET /profile/pts/:id` — only AREA codes (for `matchReason`), never coordinates. */
export function ptDetailParams(region?: { provinceCode?: number | null; wardCode?: number | null } | null) {
  if (!region?.provinceCode) return undefined;
  return { areaProvince: region.provinceCode, ...(region.wardCode ? { areaWard: region.wardCode } : {}) };
}

/**
 * Body of `PUT /profile/me` for the saved search area. Only the two area codes: "Toàn quốc" is
 * `searchProvinceCode: null` (the server then clears the ward as well). A GPS fix has no place here.
 */
export function regionPayload(region: { provinceCode: number | null; wardCode: number | null }) {
  const province = region.provinceCode && region.provinceCode > 0 ? region.provinceCode : null;
  const ward = province && region.wardCode && region.wardCode > 0 ? region.wardCode : null;
  return { searchProvinceCode: province, searchWardCode: ward };
}

// ── Cursor paging ───────────────────────────────────────────────────────────────────────────────

export type CursorResetCode = "CURSOR_EXPIRED" | "CURSOR_FILTER_MISMATCH";

/** Recognises the 409 cursor-drift errors of `POST /profile/pts/search` and `POST /gyms/search`. */
export function isCursorResetError(error: unknown): CursorResetCode | null {
  const e: any = (error as any)?.original ?? error;
  if (e?.response?.status !== 409) return null;
  const data = e?.response?.data;
  const code =
    (typeof data?.error?.code === "string" && data.error.code) ||
    (typeof data?.code === "string" && data.code) ||
    null;
  if (code === "CURSOR_EXPIRED" || code === "CURSOR_FILTER_MISMATCH") return code;
  return null;
}

/**
 * Whether a query state means "reload from page 1 and tell the user": a cursor 409 on the FIRST page (`isError`)
 * or on a later one (`isFetchNextPageError`). Anything else — a network error, a 5xx — is not a reset.
 */
export function shouldResetCursor(
  error: unknown,
  flags: { isError: boolean; isFetchNextPageError: boolean },
): CursorResetCode | null {
  if (!flags.isError && !flags.isFetchNextPageError) return null;
  return isCursorResetError(error);
}

/** getNextPageParam for the cursor endpoints: the next cursor only while the server says there is more. */
export function nextCursorParam(lastPage: { hasMore?: boolean; nextCursor?: string | null } | undefined): string | undefined {
  if (!lastPage || lastPage.hasMore !== true) return undefined;
  return typeof lastPage.nextCursor === "string" && lastPage.nextCursor.length > 0 ? lastPage.nextCursor : undefined;
}

/** Merges cursor pages, first occurrence wins — a row that shifts between two pages must not appear twice. */
export function mergeUniquePages<Page, Item>(
  pages: Page[] | undefined,
  getItems: (page: Page) => Item[] | undefined,
  getKey: (item: Item) => string,
): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const page of pages ?? []) {
    for (const item of getItems(page) ?? []) {
      const key = getKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// ── Location (GPS) — only ever read when the user taps "Dùng vị trí hiện tại" ───────────────────

export type GpsStatus = "idle" | "locating" | "granted" | "denied" | "unavailable" | "outside";

export type GpsReading =
  | { status: "granted"; coords: Coords }
  | { status: "denied" | "unavailable" | "outside" };

export const GPS_TIMEOUT_MS = 10_000;

/**
 * One GPS reading, with the device calls injected so the privacy contract is testable without a phone:
 * the permission is asked, a fix is read (with a hard time limit — `getCurrentPositionAsync` can wait forever
 * indoors), and the fix is rounded to 3 decimals and checked against Vietnam. The raw fix never leaves this
 * function; callers only receive the rounded `Coords`.
 */
export async function readGpsOnce(deps: {
  requestPermission: () => Promise<boolean>;
  getPosition: () => Promise<{ latitude: number; longitude: number } | null>;
  timeoutMs?: number;
}): Promise<GpsReading> {
  let allowed = false;
  try {
    allowed = await deps.requestPermission();
  } catch {
    return { status: "unavailable" };
  }
  if (!allowed) return { status: "denied" };

  let pos: { latitude: number; longitude: number } | null = null;
  try {
    pos = await Promise.race([
      deps.getPosition(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.timeoutMs ?? GPS_TIMEOUT_MS)),
    ]);
  } catch {
    return { status: "unavailable" };
  }
  if (!pos) return { status: "unavailable" };
  const coords = normalizeVnCoords({ lat: pos.latitude, lng: pos.longitude });
  return coords ? { status: "granted", coords } : { status: "outside" };
}

/** The line under the area card for a GPS outcome that is not "granted". */
export function gpsProblemText(status: GpsStatus): string | null {
  if (status === "denied") {
    return "Chưa được cấp quyền vị trí. Bạn vẫn có thể chọn Tỉnh/Phường ở trên hoặc xem Toàn quốc.";
  }
  if (status === "unavailable") {
    return "Chưa bắt được vị trí lúc này. Bạn vẫn có thể chọn Tỉnh/Phường ở trên hoặc xem Toàn quốc.";
  }
  if (status === "outside") {
    return "Tọa độ hiện tại nằm ngoài phạm vi hỗ trợ tại Việt Nam. Hãy chọn Tỉnh/Phường ở trên.";
  }
  return null;
}

/** "Toàn quốc" / "Vị trí hiện tại (bán kính 10 km)" / "Phường X, Tỉnh Y" / "Tỉnh Y". */
export function regionSummaryText(opts: {
  national: boolean;
  gpsActive: boolean;
  radiusKm: number;
  provinceName?: string | null;
  wardName?: string | null;
}): string {
  if (opts.national) return "Toàn quốc";
  if (opts.gpsActive) return `Vị trí hiện tại (bán kính ${opts.radiusKm} km)`;
  if (opts.wardName) return `${opts.wardName}${opts.provinceName ? `, ${opts.provinceName}` : ""}`;
  if (opts.provinceName) return opts.provinceName;
  return "Toàn quốc";
}

/** Empty-state headline: "Không tìm thấy huấn luyện viên trong bán kính 10 km" when the search is a radius one. */
export function emptyResultTitle(subject: "pt" | "gym", scope: SearchScope, radiusKm: number): string {
  const noun = subject === "pt" ? "huấn luyện viên" : "phòng gym";
  return scope === "near"
    ? `Không tìm thấy ${noun} trong bán kính ${radiusKm} km`
    : subject === "pt"
      ? "Không tìm thấy PT phù hợp với bộ lọc hiện tại."
      : "Không tìm thấy phòng gym phù hợp với bộ lọc hiện tại.";
}

// ── Query keys (identity-scoped; the whole cache is also cleared on logout/login by AppContext) ──

export function ptDiscoveryKeys(userId?: string | null) {
  const uid = userId || "anon";
  const base = ["pt-discovery", uid] as const;
  return {
    all: base,
    profileRegion: () => [...base, "profile-region"] as const,
    search: (body: PtSearchBody, resetSeq = 0) => [...base, "search", body, resetSeq] as const,
  };
}

export function gymDiscoveryKeys(userId?: string | null) {
  const uid = userId || "guest";
  const base = ["gym-discovery", uid] as const;
  return {
    all: base,
    search: (body: GymSearchBody, resetSeq = 0) => [...base, "search", body, resetSeq] as const,
  };
}

export function collabBrandOptionsKey(userId: string | null | undefined, q: string, resetSeq = 0) {
  return ["pt-collaborations", userId || "guest", "brand-options", q, resetSeq] as const;
}

// ── Brand options (GET /gyms/brand-options) ─────────────────────────────────────────────────────

export type BrandOptionPage = {
  options?: { brandId: string }[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

/** Brand/standalone options across the loaded pages, de-duplicated by `brandId`. */
export function mergeBrandOptionPages<T extends { brandId: string }>(pages: { options?: T[] }[] | undefined): T[] {
  return mergeUniquePages(pages, (p) => p.options, (o) => o.brandId);
}

/** Query for `GET /gyms/brand-options` — empty values are dropped (the server validates what it receives). */
export function brandOptionsParams(opts: { q?: string; cursor?: string | null; limit?: number }) {
  const q = opts.q?.trim();
  return {
    ...(q ? { q } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.limit ? { limit: Math.min(50, Math.max(1, Math.round(opts.limit))) } : {}),
  };
}

// ── Photo attribution ───────────────────────────────────────────────────────────────────────────

/**
 * The listing APIs do not expose a per-photo author (checked against API_CONTRACT.md and the web client on
 * 2026-11-12), so the line is the same generic one web shows under a gallery. When a photo author is ever
 * exposed, `photoAttributionLine` is the single place that turns it into "Ảnh: Pexels / <tác giả>".
 */
export const PHOTO_ATTRIBUTION_TEXT = "Ảnh minh hoạ";
export const PHOTO_ATTRIBUTION_LINK = "Nguồn ảnh & giấy phép";

export function photoAttributionLine(photographer?: string | null): string {
  const who = photographer?.trim();
  return who ? `Ảnh: Pexels / ${who}` : PHOTO_ATTRIBUTION_TEXT;
}

export const PHOTO_SOURCES: { title: string; detail: string }[] = [
  {
    title: "Ảnh phòng gym & huấn luyện viên — Pexels",
    detail: "Ảnh minh hoạ được sưu tầm từ Pexels (Pexels License) cho môi trường minh hoạ của đồ án/khoá luận.",
  },
  {
    title: "Ảnh đại diện tổng hợp — DiceBear",
    detail: "Ảnh đại diện của tài khoản minh hoạ do DiceBear tạo tự động (CC0 1.0), không dùng chân dung người thật.",
  },
  {
    title: "Bản đồ & địa giới — OpenStreetMap",
    detail: "Bản đồ chi nhánh dùng dữ liệu OpenStreetMap contributors (ODbL); danh mục 34 tỉnh/thành và 3.321 phường/xã theo bộ dữ liệu MIT.",
  },
];
