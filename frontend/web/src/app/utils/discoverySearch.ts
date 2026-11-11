/**
 * U1 Discovery — pure search request builders, GPS privacy helpers (3-decimal rounding, never on URL),
 * distance/online badge formatters, cursor 409 detection, and user-isolated React Query key factories.
 *
 * Pure module (zero React / DOM / axios imports) so `npx tsx --test` runs it directly.
 */

export type SearchScope = "near" | "province" | "national";
export type PtServiceMode = "ANY" | "ONLINE" | "OFFLINE" | "HYBRID";
export type PtSortBy = "default" | "distance" | "ratingDesc" | "ratingAsc" | "priceAsc" | "priceDesc" | "nameAsc";
export type GymSortBy = "relevance" | "distance" | "rating" | "price";
export type DistanceBasis = "GPS" | "WARD_CENTER" | null;

export const RADIUS_STEPS = [10, 20, 50] as const;
export const DEFAULT_RADIUS_KM = 10;
export const VN_LAT_RANGE = [8, 24] as const;
export const VN_LNG_RANGE = [102, 110] as const;

export interface Coords {
  lat: number;
  lng: number;
}

/** Rounds a coordinate to 3 decimal places (~110 m precision) before any API transmission. */
export function roundCoord3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Validates Vietnam bounding box and returns 3-decimal rounded coordinates, or null if invalid. */
export function normalizeVnCoords(raw?: { lat?: number | null; lng?: number | null } | null): Coords | null {
  if (!raw || typeof raw.lat !== "number" || typeof raw.lng !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
  const lat = roundCoord3(raw.lat);
  const lng = roundCoord3(raw.lng);
  if (lat < VN_LAT_RANGE[0] || lat > VN_LAT_RANGE[1]) return null;
  if (lng < VN_LNG_RANGE[0] || lng > VN_LNG_RANGE[1]) return null;
  return { lat, lng };
}

/** Next step for the "Mở rộng bán kính" CTA: 10 -> 20 -> 50 -> null. */
export function nextRadiusStep(currentRadius?: number | null): number | null {
  const r = typeof currentRadius === "number" && Number.isFinite(currentRadius) ? currentRadius : DEFAULT_RADIUS_KM;
  if (r < 10) return 10;
  if (r < 20) return 20;
  if (r < 50) return 50;
  return null;
}

export function formatKmVi(km: number): string {
  return (Math.round(km * 10) / 10).toFixed(1).replace(".", ",");
}

export interface DistanceBadgeView {
  kind: "GPS" | "WARD_CENTER" | "ONLINE" | "NONE";
  text: string | null;
}

/**
 * Formats a PT result badge according to `distanceBasis` and `distanceKm` from `POST /profile/pts/search`:
 *  - GPS          -> "~3,2 km (đường chim bay)"
 *  - WARD_CENTER  -> "~x km từ trung tâm <phường>"
 *  - Online tier  -> "Dạy online"
 *  - Otherwise    -> NONE (province-only / national offline)
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
    if (basis === "GPS") {
      return { kind: "GPS", text: `~${kmText} km (đường chim bay)` };
    }
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
 * Derives GymsPage distance badge from user's active location choice + `POST /gyms/search` `appliedScope`:
 *  - Active GPS + distanceKm != null                               -> "~x km (đường chim bay)"
 *  - No GPS + areaWard selected + appliedScope==="near" + km != null -> "~x km từ trung tâm <phường>"
 *  - Otherwise                                                      -> NONE
 */
export function formatGymDistanceBadge(params: {
  distanceKm?: number | null;
  appliedScope?: SearchScope | null;
  hasGps: boolean;
  selectedWardName?: string | null;
}): DistanceBadgeView {
  const { distanceKm, appliedScope, hasGps, selectedWardName } = params;
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) {
    return { kind: "NONE", text: null };
  }
  const kmText = formatKmVi(distanceKm);
  if (hasGps) {
    return { kind: "GPS", text: `~${kmText} km (đường chim bay)` };
  }
  if (selectedWardName?.trim() && appliedScope === "near") {
    return { kind: "WARD_CENTER", text: `~${kmText} km từ trung tâm ${selectedWardName.trim()}` };
  }
  return { kind: "NONE", text: null };
}

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

export function buildPtSearchBody(input: PtSearchBuildInput): PtSearchBody {
  const national = !!input.national;
  const coords = national ? null : normalizeVnCoords(input.gpsCoords);
  const prov = !national && typeof input.provinceCode === "number" && input.provinceCode > 0 ? input.provinceCode : null;
  const ward = !national && prov && typeof input.wardCode === "number" && input.wardCode > 0 ? input.wardCode : null;
  const scope = resolveEffectiveScope({
    national,
    hasGps: !!coords,
    provinceCode: prov,
    wardCode: ward,
  });

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

  const limit = Math.min(50, Math.max(1, Math.round(input.limit ?? 20)));
  const radiusKm = Math.min(100, Math.max(1, Math.round(input.radiusKm ?? DEFAULT_RADIUS_KM)));

  const body: PtSearchBody = {
    scope,
    mode: (input.mode || "ANY") as PtServiceMode,
    sortBy: input.sortBy || "default",
    limit,
  };

  if (coords) {
    body.lat = coords.lat;
    body.lng = coords.lng;
  }
  if (scope === "near") {
    body.radiusKm = radiusKm;
  }
  if (prov) {
    body.areaProvince = prov;
    if (ward) body.areaWard = ward;
  }
  if (Object.keys(filters).length > 0) {
    body.filters = filters;
  }
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

export function buildGymSearchBody(input: GymSearchBuildInput): GymSearchBody {
  const national = !!input.national;
  const coords = national ? null : normalizeVnCoords(input.gpsCoords);
  const prov = !national && typeof input.provinceCode === "number" && input.provinceCode > 0 ? input.provinceCode : null;
  const ward = !national && prov && typeof input.wardCode === "number" && input.wardCode > 0 ? input.wardCode : null;
  const scope = resolveEffectiveScope({
    national,
    hasGps: !!coords,
    provinceCode: prov,
    wardCode: ward,
  });

  const limit = Math.min(50, Math.max(1, Math.round(input.limit ?? 20)));
  const radiusKm = Math.min(100, Math.max(1, Math.round(input.radiusKm ?? DEFAULT_RADIUS_KM)));
  const body: GymSearchBody = {
    scope,
    sort: input.sort || "relevance",
    limit,
  };

  if (coords) {
    body.lat = coords.lat;
    body.lng = coords.lng;
  }
  if (scope === "near") {
    body.radiusKm = radiusKm;
  }
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

export type CursorResetCode = "CURSOR_EXPIRED" | "CURSOR_FILTER_MISMATCH";

/** Recognizes 409 cursor drift errors returned by POST /profile/pts/search and POST /gyms/search. */
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
 * User-isolated React Query keys (second lock alongside AppContext's queryClient.clear()).
 * Previous user's region / search / detail entries can never leak into the next account's view.
 */
export function ptDiscoveryKeys(userId?: string | null) {
  const uid = userId || "anon";
  const base = ["pt-discovery", uid] as const;
  return {
    all: base,
    profileRegion: () => [...base, "profile-region"] as const,
    search: (body: PtSearchBody, resetSeq = 0) => [...base, "search", body, resetSeq] as const,
    detail: (ptUserId: string | null, region?: { areaProvince?: number | null; areaWard?: number | null }) =>
      [...base, "detail", ptUserId, region?.areaProvince ?? null, region?.areaWard ?? null] as const,
    packages: (ptUserId: string | null) => [...base, "packages", ptUserId] as const,
    gymOptions: (ptUserId: string | null, pkgId: string | null) =>
      [...base, "gym-options", ptUserId, pkgId] as const,
  };
}

export function gymDiscoveryKeys(userId?: string | null) {
  const uid = userId || "guest";
  const base = ["gym-discovery", uid] as const;
  return {
    all: base,
    search: (body: GymSearchBody, resetSeq = 0) => [...base, "search", body, resetSeq] as const,
    detail: (gymId: string) => [...base, "detail", gymId] as const,
    plans: (gymId: string) => [...base, "plans", gymId] as const,
    warnings: (gymId: string) => [...base, "warnings", gymId] as const,
  };
}

export function collabQueryKeys(userId?: string | null, viewer = "PT") {
  const uid = userId || "anon";
  const base = ["collab", uid, viewer] as const;
  return {
    list: base,
    ptDisplayName: (id: string) => ["collab", uid, "pt-display-name", id] as const,
    ptSearch: (q: string) => ["collab", uid, "pt-search", q] as const,
    brandOptions: (q: string) => ["collab", uid, "brand-options", q] as const,
  };
}

