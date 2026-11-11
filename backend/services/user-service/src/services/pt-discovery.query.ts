import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import {
  computeDiscoveryFilterHash,
  CursorExpiredError,
  CursorFilterMismatchError,
  decodeDiscoveryCursor,
  encodeDiscoveryCursor,
  resolveDiscoveryCursorKey,
  type DiscoveryCursorPayload,
  type DiscoveryDistanceBasis,
  type DiscoveryMode,
  type DiscoveryScope,
  type DiscoverySortKey,
} from "./pt-discovery-cursor";

const VN_FROM = "áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ";
const VN_TO = "aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy";

export const PT_DISCOVERY_DEFAULT_LIMIT = 50;
export const PT_DISCOVERY_MAX_LIMIT = 50;
export const PT_SEARCH_DEFAULT_LIMIT = 20;
export const PT_SEARCH_DEFAULT_RADIUS_KM = 10;
export const PT_SEARCH_STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '2s'";

export interface PtDiscoveryQueryFilters {
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  sessionMode?: string;
  provinceCode?: number;
  wardCode?: number;
  searchCity?: string;
  searchDistrict?: string;
  gymId?: string;
  specialties?: string[];
  sortBy?: string;
  viewerGymIds?: string[];
  page?: number;
  limit?: number;
}

export interface PtDiscoveryPageIds {
  userIds: string[];
  hasMore: boolean;
}

export interface PtSearchQueryInput {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  areaProvince?: number;
  areaWard?: number;
  scope?: DiscoveryScope;
  mode?: DiscoveryMode;
  sortBy?: DiscoverySortKey;
  q?: string;
  specialties?: string[];
  minPrice?: number;
  maxPrice?: number;
  gymId?: string;
  viewerGymIds?: string[];
  cursor?: string;
  limit?: number;
}

export interface PtSearchPageItem {
  userId: string;
  distanceKm: number | null;
  distanceBasis: DiscoveryDistanceBasis;
  tier: number;
}

export interface PtSearchPageResult {
  items: PtSearchPageItem[];
  nextCursor: string | null;
  hasMore: boolean;
  appliedScope: DiscoveryScope;
  epoch: number;
}

export interface PtSearchQueryOptions {
  /** Test seam running inside the same transaction after SET LOCAL statement_timeout = '2s'. */
  onAfterTimeoutSetInTx?: (tx: Prisma.TransactionClient) => Promise<void>;
}

function foldVietnameseText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function escapeLikePattern(text: string): string {
  return text.replace(/[!%_]/g, "!$&");
}

function nameMatchSql(text: string): Prisma.Sql {
  const pattern = `%${escapeLikePattern(text)}%`;
  return Prisma.sql`(
    COALESCE(p."firstName", '') ILIKE ${pattern} ESCAPE '!'
    OR COALESCE(p."lastName", '') ILIKE ${pattern} ESCAPE '!'
    OR COALESCE(p.first_name_normalized, '') ILIKE ${pattern} ESCAPE '!'
    OR COALESCE(p.last_name_normalized, '') ILIKE ${pattern} ESCAPE '!'
  )`;
}

/**
 * Shared predicate for packages currently for sale (matches PT_FOR_SALE_PACKAGES_ARGS and
 * computeFromPrices in pt-public-dto.ts). Both mode filtering and price filtering/sorting
 * derive from this single predicate so they can never drift apart.
 */
function forSalePackagePredicates(packageMode?: "ONLINE" | "OFFLINE"): Prisma.Sql[] {
  const preds: Prisma.Sql[] = [
    Prisma.sql`pkg.is_active = true`,
    Prisma.sql`pkg.archived_at IS NULL`,
    Prisma.sql`pkg.session_count >= 1`,
    Prisma.sql`pkg.price > 0`,
  ];
  if (packageMode === "ONLINE" || packageMode === "OFFLINE") {
    preds.push(Prisma.sql`pkg.session_mode = ${packageMode}::"SessionMode"`);
  }
  return preds;
}

function ratingAggregateJoinSql(): Prisma.Sql {
  // Matches ptReviewRepository.aggregateForPts: session_reviews JOIN sessions, rounded to 1 decimal place.
  return Prisma.sql`
    LEFT JOIN (
      SELECT s.pt_user_id,
             ROUND(AVG(r.rating)::numeric, 1) AS avg_rating
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      GROUP BY s.pt_user_id
    ) rt ON rt.pt_user_id = p."userId"
  `;
}

function priceAggregateJoinSql(packageMode?: "ONLINE" | "OFFLINE"): Prisma.Sql {
  // Matches computeFromPricesByMode: floorTo1000(MIN(price / sessionCount)) over for-sale packages.
  return Prisma.sql`
    LEFT JOIN (
      SELECT pkg.pt_user_id,
             FLOOR(MIN(pkg.price / pkg.session_count) / 1000) * 1000 AS from_price_per_session
      FROM pt_service_packages pkg
      WHERE ${Prisma.join(forSalePackagePredicates(packageMode), " AND ")}
      GROUP BY pkg.pt_user_id
    ) pr ON pr.pt_user_id = p."userId"
  `;
}

function offlineEligibleSql(): Prisma.Sql {
  return Prisma.sql`(
    pa.service_mode IN ('OFFLINE'::"ServiceMode", 'HYBRID'::"ServiceMode")
    AND EXISTS (
      SELECT 1 FROM pt_training_locations tl
      WHERE tl.pt_user_id = p."userId" AND tl.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM pt_service_packages pkg
      WHERE pkg.pt_user_id = p."userId"
        AND ${Prisma.join(forSalePackagePredicates("OFFLINE"), " AND ")}
    )
  )`;
}

function onlineEligibleSql(): Prisma.Sql {
  return Prisma.sql`(
    pa.service_mode IN ('ONLINE'::"ServiceMode", 'HYBRID'::"ServiceMode")
    AND EXISTS (
      SELECT 1 FROM pt_service_packages pkg
      WHERE pkg.pt_user_id = p."userId"
        AND ${Prisma.join(forSalePackagePredicates("ONLINE"), " AND ")}
    )
  )`;
}

function anyModeEligibleSql(): Prisma.Sql {
  return Prisma.sql`(${offlineEligibleSql()} OR ${onlineEligibleSql()})`;
}

function currentStatsJoinSql(): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN pt_discovery_stats ds
      ON ds.pt_user_id = p."userId"
     AND ds.epoch = (
       SELECT e.epoch
       FROM pt_discovery_epochs e
       WHERE e.is_current = true
         AND e.status = 'READY'::"PtDiscoveryEpochStatus"
       LIMIT 1
     )
  `;
}

function statsEpochJoinSql(epoch: number): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN pt_discovery_stats ds
      ON ds.pt_user_id = p."userId"
     AND ds.epoch = ${epoch}::int4
  `;
}

function fromPriceColumnSql(mode?: "ONLINE" | "OFFLINE"): Prisma.Sql {
  if (mode === "ONLINE") return Prisma.sql`ds.from_price_online`;
  if (mode === "OFFLINE") return Prisma.sql`ds.from_price_offline`;
  return Prisma.sql`ds.from_price_overall`;
}

function resolveOrderSql(
  sortBy: string | undefined,
  packageMode?: "ONLINE" | "OFFLINE",
  viewerGymIds: string[] = [],
  currentReadyEpoch: number | null = null,
): { joinSql: Prisma.Sql; orderBySql: Prisma.Sql } {
  switch (sortBy) {
    case "nameAsc":
      return {
        joinSql: Prisma.empty,
        orderBySql: Prisma.sql`ORDER BY p."firstName" ASC NULLS LAST, p."userId" ASC`,
      };
    case "ratingDesc":
      if (currentReadyEpoch !== null) {
        return {
          joinSql: statsEpochJoinSql(currentReadyEpoch),
          orderBySql: Prisma.sql`ORDER BY ds.rating_avg DESC NULLS LAST, p."userId" ASC`,
        };
      }
      return {
        joinSql: ratingAggregateJoinSql(),
        orderBySql: Prisma.sql`ORDER BY rt.avg_rating DESC NULLS LAST, p."userId" ASC`,
      };
    case "ratingAsc":
      if (currentReadyEpoch !== null) {
        return {
          joinSql: statsEpochJoinSql(currentReadyEpoch),
          orderBySql: Prisma.sql`ORDER BY ds.rating_avg ASC NULLS LAST, p."userId" ASC`,
        };
      }
      return {
        joinSql: ratingAggregateJoinSql(),
        orderBySql: Prisma.sql`ORDER BY rt.avg_rating ASC NULLS LAST, p."userId" ASC`,
      };
    case "priceAsc":
      if (currentReadyEpoch !== null) {
        const priceCol = fromPriceColumnSql(packageMode);
        return {
          joinSql: statsEpochJoinSql(currentReadyEpoch),
          orderBySql: Prisma.sql`ORDER BY ${priceCol} ASC NULLS LAST, p."userId" ASC`,
        };
      }
      return {
        joinSql: priceAggregateJoinSql(packageMode),
        orderBySql: Prisma.sql`ORDER BY pr.from_price_per_session ASC NULLS LAST, p."userId" ASC`,
      };
    case "priceDesc":
      if (currentReadyEpoch !== null) {
        const priceCol = fromPriceColumnSql(packageMode);
        return {
          joinSql: statsEpochJoinSql(currentReadyEpoch),
          orderBySql: Prisma.sql`ORDER BY ${priceCol} DESC NULLS LAST, p."userId" ASC`,
        };
      }
      return {
        joinSql: priceAggregateJoinSql(packageMode),
        orderBySql: Prisma.sql`ORDER BY pr.from_price_per_session DESC NULLS LAST, p."userId" ASC`,
      };
    default: {
      const joinSql = currentStatsJoinSql();
      if (viewerGymIds.length > 0) {
        return {
          joinSql,
          orderBySql: Prisma.sql`ORDER BY
            p.is_accepting_clients DESC,
            EXISTS (
              SELECT 1 FROM pt_training_locations tl
              WHERE tl.pt_user_id = p."userId"
                AND tl.is_active = true
                AND tl.gym_id = ANY(${viewerGymIds}::text[])
            ) DESC,
            ds.quality DESC NULLS LAST,
            p."createdAt" DESC,
            p."userId" ASC`,
        };
      }
      return {
        joinSql,
        orderBySql: Prisma.sql`ORDER BY p.is_accepting_clients DESC, ds.quality DESC NULLS LAST, p."createdAt" DESC, p."userId" ASC`,
      };
    }
  }
}

function buildBaseVisibilityAndAttributeWhere(filters: {
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  packageMode?: "ONLINE" | "OFFLINE";
  provinceCode?: number;
  wardCode?: number;
  searchCity?: string;
  searchDistrict?: string;
  gymId?: string;
  specialties?: string[];
}): Prisma.Sql[] {
  // Public visibility rule (equivalent to ptPublicWhere in pt-public-dto.ts)
  const where: Prisma.Sql[] = [
    Prisma.sql`p."isPT" = true`,
    Prisma.sql`p.pt_suspended = false`,
    Prisma.sql`pa.status = 'APPROVED'::"PTApplicationStatus"`,
    Prisma.sql`NOT EXISTS (
      SELECT 1 FROM pt_restrictions r
      WHERE r.pt_user_id = p."userId"
        AND r.ended_at IS NULL
        AND r.scope = 'ACCOUNT'::"PtRestrictionScope"
    )`,
  ];

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceConds: Prisma.Sql[] = [
      Prisma.sql`pkg.pt_user_id = p."userId"`,
      ...forSalePackagePredicates(filters.packageMode),
    ];
    if (filters.minPrice !== undefined) {
      priceConds.push(Prisma.sql`(pkg.price / pkg.session_count) >= ${filters.minPrice}`);
    }
    if (filters.maxPrice !== undefined) {
      priceConds.push(Prisma.sql`(pkg.price / pkg.session_count) <= ${filters.maxPrice}`);
    }
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM pt_service_packages pkg
      WHERE ${Prisma.join(priceConds, " AND ")}
    )`);
  }

  const q = (filters.q ?? "").trim();
  if (q) {
    const foldedNeedle = `%${escapeLikePattern(foldVietnameseText(q))}%`;
    const locationTextMatch = Prisma.sql`EXISTS (
      SELECT 1 FROM pt_training_locations tlq
      WHERE tlq.pt_user_id = p."userId"
        AND tlq.is_active = true
        AND (
          translate(lower(COALESCE(tlq.gym_name, '')), ${VN_FROM}, ${VN_TO}) LIKE ${foldedNeedle} ESCAPE '!'
          OR translate(lower(COALESCE(tlq.address_line, '')), ${VN_FROM}, ${VN_TO}) LIKE ${foldedNeedle} ESCAPE '!'
        )
    )`;
    const tokens = q.split(/\s+/).filter(Boolean);
    const qOr: Prisma.Sql[] = [locationTextMatch, nameMatchSql(q)];
    if (tokens.length > 1) {
      qOr.push(Prisma.sql`(${Prisma.join(tokens.map((t) => nameMatchSql(t)), " AND ")})`);
    }
    where.push(Prisma.sql`(${Prisma.join(qOr, " OR ")})`);
  }

  if (filters.searchCity) {
    where.push(Prisma.sql`p.search_city = ${filters.searchCity}`);
  }
  if (filters.searchDistrict) {
    where.push(Prisma.sql`p.search_district = ${filters.searchDistrict}`);
  }
  if (filters.gymId) {
    where.push(Prisma.sql`p.gym_id = ${filters.gymId}`);
  }
  if (filters.specialties && filters.specialties.length > 0) {
    where.push(Prisma.sql`p.specialties && ${filters.specialties}::text[]`);
  }

  if (filters.provinceCode !== undefined || filters.wardCode !== undefined) {
    const locConds: Prisma.Sql[] = [
      Prisma.sql`tlf.pt_user_id = p."userId"`,
      Prisma.sql`tlf.is_active = true`,
    ];
    if (filters.provinceCode !== undefined) {
      locConds.push(Prisma.sql`tlf.province_code = ${filters.provinceCode}`);
    }
    if (filters.wardCode !== undefined) {
      locConds.push(Prisma.sql`tlf.ward_code = ${filters.wardCode}`);
    }
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM pt_training_locations tlf
      WHERE ${Prisma.join(locConds, " AND ")}
    )`);
  }

  return where;
}

/**
 * Global SQL query for public PT discovery (GET /profile/pts — D0a + D0b-1 + D0b-2 stats sort):
 * - Rating/price sorts use `pt_discovery_stats` when a current READY epoch exists and fall back
 *   to D0a live aggregates only when no READY epoch exists yet.
 */
export async function findDiscoveryPtPageIds(
  filters: PtDiscoveryQueryFilters = {},
): Promise<PtDiscoveryPageIds> {
  const limit = Math.min(Math.max(1, Math.trunc(filters.limit ?? PT_DISCOVERY_DEFAULT_LIMIT)), PT_DISCOVERY_MAX_LIMIT);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * limit;

  const packageMode =
    filters.sessionMode === "ONLINE" || filters.sessionMode === "OFFLINE"
      ? filters.sessionMode
      : undefined;

  const where = buildBaseVisibilityAndAttributeWhere({
    q: filters.q,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    packageMode,
    provinceCode: filters.provinceCode,
    wardCode: filters.wardCode,
    searchCity: filters.searchCity,
    searchDistrict: filters.searchDistrict,
    gymId: filters.gymId,
    specialties: filters.specialties,
  });

  if (filters.sessionMode === "OFFLINE") {
    where.push(offlineEligibleSql());
  } else if (filters.sessionMode === "ONLINE") {
    where.push(onlineEligibleSql());
  } else if (filters.sessionMode === "HYBRID") {
    where.push(Prisma.sql`pa.service_mode = 'HYBRID'::"ServiceMode"`);
    where.push(anyModeEligibleSql());
  } else {
    where.push(anyModeEligibleSql());
  }

  let currentReadyEpoch: number | null = null;
  if (
    filters.sortBy === "ratingDesc" ||
    filters.sortBy === "ratingAsc" ||
    filters.sortBy === "priceAsc" ||
    filters.sortBy === "priceDesc"
  ) {
    const epochRows = await prisma.$queryRaw<{ epoch: number }[]>(Prisma.sql`
      SELECT epoch
      FROM pt_discovery_epochs
      WHERE is_current = true
        AND status = 'READY'::"PtDiscoveryEpochStatus"
      LIMIT 1
    `);
    currentReadyEpoch = epochRows[0]?.epoch ?? null;
  }

  const viewerGymIds = (filters.viewerGymIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
  const { joinSql, orderBySql } = resolveOrderSql(filters.sortBy, packageMode, viewerGymIds, currentReadyEpoch);

  const rows = await prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`
    SELECT p."userId" AS "userId"
    FROM user_profiles p
    JOIN pt_applications pa ON pa.user_profile_id = p.id
    ${joinSql}
    WHERE ${Prisma.join(where, " AND ")}
    ${orderBySql}
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `);

  const hasMore = rows.length > limit;
  const userIds = (hasMore ? rows.slice(0, limit) : rows).map((r) => r.userId);
  return { userIds, hasMore };
}

type KeysetTerm =
  | { colSql: Prisma.Sql; dir: "ASC" | "DESC"; nullable: false; valueSql: Prisma.Sql }
  | { colSql: Prisma.Sql; dir: "ASC" | "DESC"; nullable: true; value: number | string | null; valueSql: Prisma.Sql };

/**
 * Builds strict lexicographic keyset condition (`row > cursor` in exact ORDER BY sequence),
 * handling PostgreSQL `NULLS LAST` boundaries so neither non-null nor NULL rows are dropped or repeated.
 */
function buildKeysetAfterSql(terms: KeysetTerm[], tailUserIdSql: Prisma.Sql, cursorUserId: string): Prisma.Sql {
  let acc: Prisma.Sql = Prisma.sql`${tailUserIdSql} > ${cursorUserId}::text`;
  for (let i = terms.length - 1; i >= 0; i--) {
    const t = terms[i];
    if (!t.nullable) {
      const cmp = t.dir === "ASC" ? Prisma.sql`${t.colSql} > ${t.valueSql}` : Prisma.sql`${t.colSql} < ${t.valueSql}`;
      acc = Prisma.sql`(${cmp} OR (${t.colSql} = ${t.valueSql} AND (${acc})))`;
    } else if (t.value === null) {
      acc = Prisma.sql`(${t.colSql} IS NULL AND (${acc}))`;
    } else {
      const cmp =
        t.dir === "ASC"
          ? Prisma.sql`(${t.colSql} IS NOT NULL AND ${t.colSql} > ${t.valueSql})`
          : Prisma.sql`(${t.colSql} IS NOT NULL AND ${t.colSql} < ${t.valueSql})`;
      acc = Prisma.sql`(${cmp} OR ${t.colSql} IS NULL OR (${t.colSql} = ${t.valueSql} AND (${acc})))`;
    }
  }
  return acc;
}

function buildSearchKeysetWhereSql(
  sortKind: DiscoverySortKey,
  cursor: DiscoveryCursorPayload,
  hasViewerGyms: boolean,
): Prisma.Sql {
  const terms: KeysetTerm[] = [
    { colSql: Prisma.sql`b.tier`, dir: "ASC", nullable: false, valueSql: Prisma.sql`${cursor.tier}::int4` },
  ];

  if (sortKind === "default") {
    terms.push(
      {
        colSql: Prisma.sql`b.is_accepting_clients::int4`,
        dir: "DESC",
        nullable: false,
        valueSql: Prisma.sql`${cursor.isAccepting ? 1 : 0}::int4`,
      },
      { colSql: Prisma.sql`b.bucket`, dir: "ASC", nullable: false, valueSql: Prisma.sql`${cursor.bucket}::int4` },
    );
    if (hasViewerGyms) {
      terms.push({
        colSql: Prisma.sql`b.same_gym::int4`,
        dir: "DESC",
        nullable: false,
        valueSql: Prisma.sql`${cursor.sameGym ? 1 : 0}::int4`,
      });
    }
    terms.push({
      colSql: Prisma.sql`b.sort_num`,
      dir: "DESC",
      nullable: true,
      value: cursor.sortNum,
      valueSql: Prisma.sql`${cursor.sortNum}::double precision`,
    });
  } else if (sortKind === "nameAsc") {
    terms.push({
      colSql: Prisma.sql`b.sort_str`,
      dir: "ASC",
      nullable: true,
      value: cursor.sortStr,
      valueSql: Prisma.sql`${cursor.sortStr}::text`,
    });
  } else {
    const dir = sortKind === "ratingDesc" || sortKind === "priceDesc" ? "DESC" : "ASC";
    terms.push({
      colSql: Prisma.sql`b.sort_num`,
      dir,
      nullable: true,
      value: cursor.sortNum,
      valueSql: Prisma.sql`${cursor.sortNum}::double precision`,
    });
  }

  return buildKeysetAfterSql(terms, Prisma.sql`b."userId"`, cursor.userId);
}

function buildSearchOrderBySql(sortKind: DiscoverySortKey, hasViewerGyms: boolean): Prisma.Sql {
  if (sortKind === "default") {
    return hasViewerGyms
      ? Prisma.sql`ORDER BY b.tier ASC, b.is_accepting_clients DESC, b.bucket ASC, b.same_gym DESC, b.sort_num DESC NULLS LAST, b."userId" ASC`
      : Prisma.sql`ORDER BY b.tier ASC, b.is_accepting_clients DESC, b.bucket ASC, b.sort_num DESC NULLS LAST, b."userId" ASC`;
  }
  if (sortKind === "nameAsc") {
    return Prisma.sql`ORDER BY b.tier ASC, b.sort_str ASC NULLS LAST, b."userId" ASC`;
  }
  if (sortKind === "ratingDesc" || sortKind === "priceDesc") {
    return Prisma.sql`ORDER BY b.tier ASC, b.sort_num DESC NULLS LAST, b."userId" ASC`;
  }
  return Prisma.sql`ORDER BY b.tier ASC, b.sort_num ASC NULLS LAST, b."userId" ASC`;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function roundDistanceKm(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Geographic / epoch-cursor PT search for `POST /profile/pts/search` (D0b-2).
 * Enforces `SET LOCAL statement_timeout = '2s'`, Haversine distance (with Q5 ward-centroid
 * fallback), scope filtering, tiered ordering, encrypted epoch-bound cursors, and live visibility.
 */
export async function searchDiscoveryPtPageIds(
  input: PtSearchQueryInput = {},
  options: PtSearchQueryOptions = {},
): Promise<PtSearchPageResult> {
  // Validate cursor encryption secret upfront even on page 1 so 503 fails closed consistently.
  resolveDiscoveryCursorKey();

  const decodedCursor = input.cursor !== undefined ? decodeDiscoveryCursor(input.cursor) : null;
  const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? PT_SEARCH_DEFAULT_LIMIT)), PT_DISCOVERY_MAX_LIMIT);
  const mode: DiscoveryMode = input.mode ?? "ANY";
  const sortKind: DiscoverySortKey = input.sortBy ?? "default";
  const areaProvince = input.areaProvince ?? null;
  const areaWard = input.areaWard ?? null;
  const radiusKm = input.radiusKm ?? PT_SEARCH_DEFAULT_RADIUS_KM;

  let pLat: number | null = null;
  let pLng: number | null = null;
  let distanceBasis: DiscoveryDistanceBasis = null;

  if (input.lat !== undefined && input.lng !== undefined) {
    pLat = round3(input.lat);
    pLng = round3(input.lng);
    distanceBasis = "GPS";
  } else if (areaWard !== null && areaProvince !== null) {
    const wardGeo = await prisma.$queryRaw<{ centroid_lat: number; centroid_lng: number }[]>(Prisma.sql`
      SELECT centroid_lat, centroid_lng
      FROM vietnam_ward_geo
      WHERE ward_code = ${areaWard}::int4
        AND province_code = ${areaProvince}::int4
      LIMIT 1
    `);
    if (wardGeo.length > 0) {
      pLat = wardGeo[0].centroid_lat;
      pLng = wardGeo[0].centroid_lng;
      distanceBasis = "WARD_CENTER";
    }
  }

  const hasViewerPoint = pLat !== null && pLng !== null;
  const requestedScope: DiscoveryScope =
    input.scope ?? (hasViewerPoint ? "near" : areaProvince !== null ? "province" : "national");
  const appliedScope: DiscoveryScope =
    requestedScope === "near" && !hasViewerPoint
      ? areaProvince !== null
        ? "province"
        : "national"
      : requestedScope;

  const qNormalized = input.q?.trim() ? input.q.trim() : null;
  const specialtiesNormalized =
    input.specialties && input.specialties.length > 0 ? [...new Set(input.specialties)].sort() : null;
  const viewerGymIds = (input.viewerGymIds ?? []).filter((id) => typeof id === "string" && id.length > 0);

  const filterHash = computeDiscoveryFilterHash({
    mode,
    appliedScope,
    sortBy: sortKind,
    areaProvince,
    areaWard,
    pLat,
    pLng,
    distanceBasis,
    radiusKm: appliedScope === "near" ? radiusKm : null,
    q: qNormalized,
    specialties: specialtiesNormalized,
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    gymId: input.gymId ?? null,
    viewerGymIds,
  });

  if (decodedCursor && decodedCursor.filterHash !== filterHash) {
    throw new CursorFilterMismatchError();
  }

  const packageMode = mode === "ONLINE" || mode === "OFFLINE" ? mode : undefined;
  const baseWhere = buildBaseVisibilityAndAttributeWhere({
    q: qNormalized ?? undefined,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    packageMode,
    gymId: input.gymId,
    specialties: specialtiesNormalized ?? undefined,
  });
  if (mode === "HYBRID") {
    baseWhere.push(Prisma.sql`pa.service_mode = 'HYBRID'::"ServiceMode"`);
  }

  const safeLat = pLat ?? 0;
  const safeLng = pLng ?? 0;
  const dLat = radiusKm / 110.574 + 0.02;
  const cosLat = Math.max(0.1, Math.cos((safeLat * Math.PI) / 180));
  const dLng = radiusKm / (111.32 * cosLat) + 0.02;
  const minLat = safeLat - dLat;
  const maxLat = safeLat + dLat;
  const minLng = safeLng - dLng;
  const maxLng = safeLng + dLng;

  const safeProvinceCode = areaProvince ?? -1;
  const hasViewerGyms = viewerGymIds.length > 0;
  const priceColSql = fromPriceColumnSql(packageMode);

  let sortNumExpr: Prisma.Sql = Prisma.sql`ds.quality::double precision`;
  let sortStrExpr: Prisma.Sql = Prisma.sql`NULL::text`;
  if (sortKind === "distance") {
    sortNumExpr = Prisma.sql`t.distance_km::double precision`;
  } else if (sortKind === "ratingDesc" || sortKind === "ratingAsc") {
    sortNumExpr = Prisma.sql`ds.rating_avg::double precision`;
  } else if (sortKind === "priceAsc" || sortKind === "priceDesc") {
    sortNumExpr = Prisma.sql`${priceColSql}::double precision`;
  } else if (sortKind === "nameAsc") {
    sortNumExpr = Prisma.sql`NULL::double precision`;
    sortStrExpr = Prisma.sql`t.first_name::text`;
  }

  const keysetWhere = decodedCursor
    ? buildSearchKeysetWhereSql(sortKind, decodedCursor, hasViewerGyms)
    : Prisma.sql`TRUE`;
  const orderBySql = buildSearchOrderBySql(sortKind, hasViewerGyms);

  type RawSearchRow = {
    userId: string;
    tier: number;
    is_accepting_clients: boolean;
    bucket: number;
    same_gym: boolean;
    distance_km: number | null;
    sort_num: number | null;
    sort_str: string | null;
  };

  const nearBboxFilterSql = Prisma.sql`(
    (tl.latitude BETWEEN ${minLat}::double precision AND ${maxLat}::double precision
     AND tl.longitude BETWEEN ${minLng}::double precision AND ${maxLng}::double precision)
    OR (tl.latitude IS NULL
        AND wg.centroid_lat BETWEEN ${minLat}::double precision AND ${maxLat}::double precision
        AND wg.centroid_lng BETWEEN ${minLng}::double precision AND ${maxLng}::double precision)
  )`;

  const existsNearBboxSql = Prisma.sql`EXISTS (
    SELECT 1
    FROM pt_training_locations tl
    LEFT JOIN vietnam_ward_geo wg ON wg.ward_code = tl.ward_code
    WHERE tl.pt_user_id = p."userId"
      AND tl.is_active = true
      AND ${nearBboxFilterSql}
  )`;

  const existsInProvinceSql = Prisma.sql`EXISTS (
    SELECT 1 FROM pt_training_locations tlp
    WHERE tlp.pt_user_id = p."userId"
      AND tlp.is_active = true
      AND tlp.province_code = ${safeProvinceCode}::int4
  )`;

  // Push mode & scope pre-filters into WHERE directly (avoid `$flag = false OR ...` generic-plan stalls).
  if (mode === "ONLINE") {
    baseWhere.push(onlineEligibleSql());
  } else if (mode === "OFFLINE") {
    baseWhere.push(offlineEligibleSql());
    if (appliedScope === "near") baseWhere.push(existsNearBboxSql);
    else if (appliedScope === "province") baseWhere.push(existsInProvinceSql);
  } else {
    baseWhere.push(anyModeEligibleSql());
    if (appliedScope === "near") {
      baseWhere.push(Prisma.sql`(${onlineEligibleSql()} OR ${existsNearBboxSql})`);
    } else if (appliedScope === "province") {
      baseWhere.push(Prisma.sql`(${onlineEligibleSql()} OR ${existsInProvinceSql})`);
    }
  }

  const offlineEligibleSelectSql =
    mode === "ONLINE"
      ? Prisma.sql`false`
      : Prisma.sql`(
          pa.service_mode IN ('OFFLINE'::"ServiceMode", 'HYBRID'::"ServiceMode")
          AND EXISTS (
            SELECT 1 FROM pt_training_locations tl
            WHERE tl.pt_user_id = p."userId" AND tl.is_active = true
          )
          AND EXISTS (
            SELECT 1 FROM pt_service_packages pkg
            WHERE pkg.pt_user_id = p."userId"
              AND ${Prisma.join(forSalePackagePredicates("OFFLINE"), " AND ")}
          )
        )`;

  const onlineEligibleSelectSql =
    mode === "OFFLINE"
      ? Prisma.sql`false`
      : Prisma.sql`(
          pa.service_mode IN ('ONLINE'::"ServiceMode", 'HYBRID'::"ServiceMode")
          AND EXISTS (
            SELECT 1 FROM pt_service_packages pkg
            WHERE pkg.pt_user_id = p."userId"
              AND ${Prisma.join(forSalePackagePredicates("ONLINE"), " AND ")}
          )
        )`;

  const inSelectedProvinceSelectSql =
    appliedScope === "province" && mode !== "ONLINE" ? existsInProvinceSql : Prisma.sql`false`;

  const lateralWhereParts: Prisma.Sql[] = [
    Prisma.sql`tl.pt_user_id = p."userId"`,
    Prisma.sql`tl.is_active = true`,
  ];
  if (appliedScope === "near") lateralWhereParts.push(nearBboxFilterSql);
  if (appliedScope === "province") lateralWhereParts.push(Prisma.sql`tl.province_code = ${safeProvinceCode}::int4`);

  const runLateral = hasViewerPoint && mode !== "ONLINE";
  const lateralJoinSql = runLateral
    ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT MIN(
            CASE
              WHEN COALESCE(tl.latitude, wg.centroid_lat) IS NULL
                OR COALESCE(tl.longitude, wg.centroid_lng) IS NULL
              THEN NULL::double precision
              ELSE 6371.0 * 2.0 * ASIN(SQRT(LEAST(1.0,
                POWER(SIN(RADIANS(COALESCE(tl.latitude, wg.centroid_lat) - ${safeLat}::double precision) / 2.0), 2)
                + COS(RADIANS(${safeLat}::double precision))
                  * COS(RADIANS(COALESCE(tl.latitude, wg.centroid_lat)))
                  * POWER(SIN(RADIANS(COALESCE(tl.longitude, wg.centroid_lng) - ${safeLng}::double precision) / 2.0), 2)
              )))
            END
          ) AS min_d_km
          FROM pt_training_locations tl
          LEFT JOIN vietnam_ward_geo wg ON wg.ward_code = tl.ward_code
          WHERE ${Prisma.join(lateralWhereParts, " AND ")}
        ) loc ON true
      `
    : Prisma.empty;
  const minDistSelectSql = runLateral ? Prisma.sql`loc.min_d_km` : Prisma.sql`NULL::double precision`;

  let offlineScopeMatchSql: Prisma.Sql = Prisma.sql`true`;
  if (appliedScope === "near") {
    offlineScopeMatchSql = Prisma.sql`(c.min_d_km IS NOT NULL AND c.min_d_km <= ${radiusKm}::double precision)`;
  } else if (appliedScope === "province") {
    offlineScopeMatchSql = Prisma.sql`c.in_selected_province`;
  }

  let tierExprSql: Prisma.Sql;
  let distExprSql: Prisma.Sql;
  if (mode === "ONLINE") {
    tierExprSql = Prisma.sql`CASE WHEN c.online_eligible THEN 1 ELSE NULL::int4 END`;
    distExprSql = Prisma.sql`NULL::double precision`;
  } else if (mode === "OFFLINE") {
    tierExprSql = Prisma.sql`CASE WHEN c.offline_eligible AND ${offlineScopeMatchSql} THEN 0 ELSE NULL::int4 END`;
    distExprSql = hasViewerPoint
      ? Prisma.sql`CASE WHEN c.offline_eligible AND ${offlineScopeMatchSql} THEN c.min_d_km ELSE NULL::double precision END`
      : Prisma.sql`NULL::double precision`;
  } else {
    tierExprSql = Prisma.sql`
      CASE
        WHEN c.offline_eligible AND ${offlineScopeMatchSql} THEN 0
        WHEN c.online_eligible THEN 1
        ELSE NULL::int4
      END
    `;
    distExprSql = hasViewerPoint
      ? Prisma.sql`CASE WHEN c.offline_eligible AND ${offlineScopeMatchSql} THEN c.min_d_km ELSE NULL::double precision END`
      : Prisma.sql`NULL::double precision`;
  }

  const { targetEpoch, rows } = await prisma.$transaction(async (tx) => {
    // Hằng cố định cho statement_timeout trong transaction; mọi tham số khác đi qua Prisma.sql parameterized.
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '2s'`);
    if (options.onAfterTimeoutSetInTx) {
      await options.onAfterTimeoutSetInTx(tx);
    }

    const currentRows = await tx.$queryRaw<{ epoch: number }[]>(Prisma.sql`
      SELECT epoch
      FROM pt_discovery_epochs
      WHERE is_current = true
        AND status = 'READY'::"PtDiscoveryEpochStatus"
      LIMIT 1
    `);
    const currentReadyEpoch = currentRows[0]?.epoch ?? null;

    let resolvedEpoch: number | null;
    if (decodedCursor) {
      if (decodedCursor.epoch > 0) {
        const cursorEpochRows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`
          SELECT status::text AS status
          FROM pt_discovery_epochs
          WHERE epoch = ${decodedCursor.epoch}::int4
          LIMIT 1
        `);
        if (cursorEpochRows.length === 0 || cursorEpochRows[0].status !== "READY") {
          throw new CursorExpiredError();
        }
        resolvedEpoch = decodedCursor.epoch;
      } else {
        if (currentReadyEpoch !== null) {
          throw new CursorExpiredError();
        }
        resolvedEpoch = null;
      }
    } else {
      resolvedEpoch = currentReadyEpoch;
    }

    const queryRows = await tx.$queryRaw<RawSearchRow[]>(Prisma.sql`
      WITH base_candidates AS (
        SELECT
          p."userId" AS pt_user_id,
          p."firstName" AS first_name,
          p.is_accepting_clients,
          ${
            hasViewerGyms
              ? Prisma.sql`EXISTS (
                  SELECT 1 FROM pt_training_locations tlg
                  WHERE tlg.pt_user_id = p."userId"
                    AND tlg.is_active = true
                    AND tlg.gym_id = ANY(${viewerGymIds}::text[])
                )`
              : Prisma.sql`false`
          } AS same_gym,
          ${offlineEligibleSelectSql} AS offline_eligible,
          ${onlineEligibleSelectSql} AS online_eligible,
          ${minDistSelectSql} AS min_d_km,
          ${inSelectedProvinceSelectSql} AS in_selected_province
        FROM user_profiles p
        JOIN pt_applications pa ON pa.user_profile_id = p.id
        ${lateralJoinSql}
        WHERE ${Prisma.join(baseWhere, " AND ")}
      ),
      tiered AS (
        SELECT
          c.pt_user_id AS "userId",
          c.first_name,
          c.is_accepting_clients,
          c.same_gym,
          ${tierExprSql} AS tier,
          ${distExprSql} AS distance_km
        FROM base_candidates c
      ),
      with_stats AS (
        SELECT
          t."userId",
          t.tier,
          t.is_accepting_clients,
          CASE
            WHEN t.tier = 0 AND t.distance_km IS NOT NULL
              THEN width_bucket(t.distance_km, ARRAY[0, 2, 5, 10, 20, 50, 100]::double precision[])
            ELSE 0
          END AS bucket,
          t.same_gym,
          t.distance_km,
          ${sortNumExpr} AS sort_num,
          ${sortStrExpr} AS sort_str
        FROM tiered t
        LEFT JOIN pt_discovery_stats ds
          ON ds.epoch = ${resolvedEpoch}::int4
         AND ds.pt_user_id = t."userId"
        WHERE t.tier IS NOT NULL
      ),
      bucketed AS (
        SELECT * FROM with_stats
      )
      SELECT
        b."userId",
        b.tier,
        b.is_accepting_clients,
        b.bucket,
        b.same_gym,
        b.distance_km,
        b.sort_num,
        b.sort_str
      FROM bucketed b
      WHERE ${keysetWhere}
      ${orderBySql}
      LIMIT ${limit + 1}
    `);

    return { targetEpoch: resolvedEpoch ?? 0, rows: queryRows };
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items: PtSearchPageItem[] = pageRows.map((row) => ({
    userId: row.userId,
    distanceKm: row.distance_km !== null ? roundDistanceKm(row.distance_km) : null,
    distanceBasis: row.distance_km !== null ? distanceBasis : null,
    tier: row.tier,
  }));

  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeDiscoveryCursor({
      v: 1,
      epoch: targetEpoch,
      filterHash,
      tier: last.tier,
      isAccepting: last.is_accepting_clients,
      bucket: last.bucket,
      sameGym: last.same_gym,
      sortKind,
      sortNum: last.sort_num,
      sortStr: last.sort_str,
      userId: last.userId,
    });
  }

  return {
    items,
    nextCursor,
    hasMore,
    appliedScope,
    epoch: targetEpoch,
  };
}


