import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";

const VN_FROM = "áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ";
const VN_TO = "aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy";

export const PT_DISCOVERY_DEFAULT_LIMIT = 50;
export const PT_DISCOVERY_MAX_LIMIT = 50;

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

function resolveOrderSql(
  sortBy: string | undefined,
  packageMode?: "ONLINE" | "OFFLINE",
  viewerGymIds: string[] = [],
): { joinSql: Prisma.Sql; orderBySql: Prisma.Sql } {
  switch (sortBy) {
    case "nameAsc":
      return {
        joinSql: Prisma.empty,
        orderBySql: Prisma.sql`ORDER BY p."firstName" ASC NULLS LAST, p."userId" ASC`,
      };
    case "ratingDesc":
      return {
        joinSql: ratingAggregateJoinSql(),
        orderBySql: Prisma.sql`ORDER BY rt.avg_rating DESC NULLS LAST, p."userId" ASC`,
      };
    case "ratingAsc":
      return {
        joinSql: ratingAggregateJoinSql(),
        orderBySql: Prisma.sql`ORDER BY rt.avg_rating ASC NULLS LAST, p."userId" ASC`,
      };
    case "priceAsc":
      return {
        joinSql: priceAggregateJoinSql(packageMode),
        orderBySql: Prisma.sql`ORDER BY pr.from_price_per_session ASC NULLS LAST, p."userId" ASC`,
      };
    case "priceDesc":
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

/**
 * Global SQL query for public PT discovery (D0a + D0b-1):
 * - Visibility is equivalent to `ptPublicWhere` (pt-public-dto.ts:38).
 * - Mode, package-eligibility (ANY = OFFLINE-eligible OR ONLINE-eligible), price, specialty,
 *   location, and text filters run in SQL (one row per PT).
 * - Default ordering reads `pt_discovery_stats.quality` from the current READY epoch inline
 *   and naturally falls back to D0a order (`createdAt DESC`) when no current epoch exists.
 * - Uses `limit + 1` to compute `hasMore` without a separate COUNT(*) round trip.
 */
export async function findDiscoveryPtPageIds(
  filters: PtDiscoveryQueryFilters = {},
): Promise<PtDiscoveryPageIds> {
  const limit = Math.min(Math.max(1, Math.trunc(filters.limit ?? PT_DISCOVERY_DEFAULT_LIMIT)), PT_DISCOVERY_MAX_LIMIT);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * limit;

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

  const packageMode =
    filters.sessionMode === "ONLINE" || filters.sessionMode === "OFFLINE"
      ? filters.sessionMode
      : undefined;

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

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceConds: Prisma.Sql[] = [
      Prisma.sql`pkg.pt_user_id = p."userId"`,
      ...forSalePackagePredicates(packageMode),
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

  const viewerGymIds = (filters.viewerGymIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
  const { joinSql, orderBySql } = resolveOrderSql(filters.sortBy, packageMode, viewerGymIds);

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

