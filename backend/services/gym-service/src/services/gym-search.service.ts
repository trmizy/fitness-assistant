import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { planRepository } from '../repositories/plan.repository';
import { userClient } from '../clients/user.client';
import { gymPublicRepository, toPublicGymDto } from './gym-public';
import {
  assertGymSearchCursorSecretConfigured,
  computeBrandOptionsFilterHash,
  computeGymSearchFilterHash,
  decodeGymCursor,
  encodeGymCursor,
  type BrandOptionsCursorPayload,
  type GymSearchCursorScope,
  type GymSearchCursorSort,
  type GymsSearchCursorPayload,
} from './gym-search-cursor';

export const GYM_SEARCH_DEFAULT_LIMIT = 20;
export const GYM_SEARCH_MAX_LIMIT = 50;
export const GYM_SEARCH_DEFAULT_RADIUS_KM = 10;

const VN_LAT_MIN = 8;
const VN_LAT_MAX = 24;
const VN_LNG_MIN = 102;
const VN_LNG_MAX = 110;

const VALID_SCOPES = new Set<GymSearchCursorScope>(['near', 'province', 'national']);
const VALID_SORTS = new Set<GymSearchCursorSort>(['distance', 'rating', 'price', 'relevance']);

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function isPositivePgInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 2_147_483_647;
}

function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, '!$&');
}

function normalizeFold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function tokenizeQuery(q: string | null): string[] {
  if (!q) return [];
  const folded = normalizeFold(q);
  if (!folded) return [];
  return [...new Set(folded.split(/\s+/).filter(Boolean))].slice(0, 8);
}

function sqlFoldExpr(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`translate(lower(${expr}), 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')`;
}

/** Exact SQL equivalent of `gymPublicWhere()` (APPROVED + OPEN + owner not hidden by SUSPENDED/TERMINATED partner). */
function sqlPublicVisibleGymWhere(): Prisma.Sql {
  return Prisma.sql`
    g.status = 'APPROVED'
    AND g.operational_status = 'OPEN'
    AND NOT EXISTS (
      SELECT 1
      FROM gym_partner_accounts gpa
      JOIN gym_partners gp ON gp.id = gpa.partner_id
      WHERE gpa.user_id = g.owner_id
        AND gpa.role = 'OWNER'
        AND gpa.status = 'ACTIVE'
        AND gp.status IN ('SUSPENDED', 'TERMINATED')
    )
  `;
}

type KeysetTerm =
  | { col: Prisma.Sql; dir: 'ASC' | 'DESC'; nullable: false; val: Prisma.Sql }
  | { col: Prisma.Sql; dir: 'ASC' | 'DESC'; nullable: true; val: Prisma.Sql | null };

function buildKeysetAfterSql(terms: KeysetTerm[]): Prisma.Sql {
  if (terms.length === 0) return Prisma.sql`FALSE`;
  let acc: Prisma.Sql = Prisma.sql`FALSE`;
  for (let i = terms.length - 1; i >= 0; i--) {
    const t = terms[i]!;
    if (!t.nullable) {
      const cmp = t.dir === 'ASC' ? Prisma.sql`${t.col} > ${t.val}` : Prisma.sql`${t.col} < ${t.val}`;
      acc = i === terms.length - 1
        ? cmp
        : Prisma.sql`(${cmp} OR (${t.col} = ${t.val} AND (${acc})))`;
    } else if (t.val === null) {
      acc = i === terms.length - 1
        ? Prisma.sql`FALSE`
        : Prisma.sql`(${t.col} IS NULL AND (${acc}))`;
    } else {
      // NULLS LAST: any non-null comes before NULL; after a non-null row comes more extreme values OR NULL.
      const cmp = t.dir === 'ASC' ? Prisma.sql`${t.col} > ${t.val}` : Prisma.sql`${t.col} < ${t.val}`;
      acc = i === terms.length - 1
        ? Prisma.sql`(${cmp} OR ${t.col} IS NULL)`
        : Prisma.sql`(${cmp} OR ${t.col} IS NULL OR (${t.col} = ${t.val} AND (${acc})))`;
    }
  }
  return acc;
}

export class GymSearchValidationError extends Error {
  status = 400;
  code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
  }
}

export interface ParsedGymSearchInput {
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  scope?: GymSearchCursorScope;
  areaProvince: number | null;
  areaWard: number | null;
  q: string | null;
  amenityIds: string[];
  priceMax: number | null;
  sort: GymSearchCursorSort;
  cursor: string | null;
  limit: number;
}

export function parseGymSearchBody(raw: unknown): ParsedGymSearchInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GymSearchValidationError('Body tìm kiếm phải là JSON object');
  }
  const b = raw as Record<string, unknown>;

  let lat: number | null = null;
  let lng: number | null = null;
  if (b.lat != null || b.lng != null) {
    if (
      typeof b.lat !== 'number' ||
      !Number.isFinite(b.lat) ||
      typeof b.lng !== 'number' ||
      !Number.isFinite(b.lng)
    ) {
      throw new GymSearchValidationError('lat và lng phải đi cùng nhau và là số hợp lệ');
    }
    if (b.lat < VN_LAT_MIN || b.lat > VN_LAT_MAX || b.lng < VN_LNG_MIN || b.lng > VN_LNG_MAX) {
      throw new GymSearchValidationError('Tọa độ ngoài phạm vi Việt Nam (lat 8-24, lng 102-110)');
    }
    lat = round6(b.lat);
    lng = round6(b.lng);
  }

  let radiusKm = GYM_SEARCH_DEFAULT_RADIUS_KM;
  if (b.radiusKm != null) {
    if (typeof b.radiusKm !== 'number' || !Number.isFinite(b.radiusKm) || b.radiusKm < 1 || b.radiusKm > 100) {
      throw new GymSearchValidationError('radiusKm phải nằm trong khoảng 1-100');
    }
    radiusKm = b.radiusKm;
  }

  let limit = GYM_SEARCH_DEFAULT_LIMIT;
  if (b.limit != null) {
    if (typeof b.limit !== 'number' || !Number.isSafeInteger(b.limit) || b.limit < 1 || b.limit > GYM_SEARCH_MAX_LIMIT) {
      throw new GymSearchValidationError(`limit phải là số nguyên trong khoảng 1-${GYM_SEARCH_MAX_LIMIT}`);
    }
    limit = b.limit;
  }

  let areaProvince: number | null = null;
  if (b.areaProvince != null) {
    if (!isPositivePgInt(b.areaProvince)) {
      throw new GymSearchValidationError('areaProvince phải là số nguyên dương');
    }
    areaProvince = b.areaProvince;
  }

  let areaWard: number | null = null;
  if (b.areaWard != null) {
    if (!isPositivePgInt(b.areaWard)) {
      throw new GymSearchValidationError('areaWard phải là số nguyên dương');
    }
    if (areaProvince === null) {
      throw new GymSearchValidationError('areaWard phải đi kèm areaProvince');
    }
    areaWard = b.areaWard;
  }

  let scope: GymSearchCursorScope | undefined;
  if (b.scope != null) {
    if (typeof b.scope !== 'string' || !VALID_SCOPES.has(b.scope as GymSearchCursorScope)) {
      throw new GymSearchValidationError('scope phải là near, province hoặc national');
    }
    scope = b.scope as GymSearchCursorScope;
    if (scope === 'near' && lat === null && areaWard === null) {
      throw new GymSearchValidationError("scope='near' cần tọa độ lat/lng hoặc areaWard");
    }
    if (scope === 'province' && areaProvince === null) {
      throw new GymSearchValidationError("scope='province' cần areaProvince");
    }
  }

  let q: string | null = null;
  if (b.q != null) {
    if (typeof b.q !== 'string') {
      throw new GymSearchValidationError('q phải là chuỗi');
    }
    const trimmed = b.q.trim();
    if (trimmed.length > 200) {
      throw new GymSearchValidationError('q tối đa 200 ký tự');
    }
    if (trimmed.length > 0) q = trimmed;
  }

  let amenityIds: string[] = [];
  if (b.amenityIds != null) {
    if (!Array.isArray(b.amenityIds) || b.amenityIds.length > 50) {
      throw new GymSearchValidationError('amenityIds phải là mảng tối đa 50 phần tử');
    }
    const seen = new Set<string>();
    for (const item of b.amenityIds) {
      if (typeof item !== 'string' || !item.trim() || item.trim().length > 100) {
        throw new GymSearchValidationError('Mỗi phần tử trong amenityIds phải là chuỗi không rỗng');
      }
      seen.add(item.trim());
    }
    amenityIds = [...seen];
  }

  let priceMax: number | null = null;
  if (b.priceMax != null) {
    if (typeof b.priceMax !== 'number' || !Number.isFinite(b.priceMax) || b.priceMax < 0) {
      throw new GymSearchValidationError('priceMax phải là số không âm');
    }
    priceMax = b.priceMax;
  }

  let sort: GymSearchCursorSort = 'relevance';
  if (b.sort != null) {
    if (typeof b.sort !== 'string' || !VALID_SORTS.has(b.sort as GymSearchCursorSort)) {
      throw new GymSearchValidationError('sort phải là distance, rating, price hoặc relevance');
    }
    sort = b.sort as GymSearchCursorSort;
  }

  let cursor: string | null = null;
  if (b.cursor != null) {
    if (typeof b.cursor !== 'string' || !b.cursor.trim()) {
      throw new GymSearchValidationError('cursor phải là chuỗi không rỗng');
    }
    cursor = b.cursor.trim();
  }

  return { lat, lng, radiusKm, scope, areaProvince, areaWard, q, amenityIds, priceMax, sort, cursor, limit };
}

export function isStatementTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, any>;
  if (e.code === '57014' || e.meta?.code === '57014') return true;
  const msg = String(e.meta?.message ?? e.message ?? '');
  return /statement timeout/i.test(msg);
}

interface SearchScoredRow {
  id: string;
  distance_km: number | null;
  rating_avg: number;
  review_count: number;
  from_price: number | null;
  relevance_score: number;
}

export interface BrandOptionBranchDto {
  id: string;
  name: string;
  city: string | null;
  closed: boolean;
}

export interface BrandOptionDto {
  scope: 'BRAND' | 'BRANCH';
  brandId: string;
  brandName: string;
  branches: BrandOptionBranchDto[];
  proposeBranchId: string;
}

export const gymSearchService = {
  async searchPublicGyms(
    rawBody: unknown,
    opts?: { onAfterTimeoutSetInTx?: (tx: Prisma.TransactionClient) => Promise<void> },
  ) {
    assertGymSearchCursorSecretConfigured();
    const input = parseGymSearchBody(rawBody);

    let originKind: 'GPS' | 'WARD_CENTER' | null = null;
    let originLat: number | null = null;
    let originLng: number | null = null;

    if (input.lat !== null && input.lng !== null) {
      originKind = 'GPS';
      originLat = input.lat;
      originLng = input.lng;
    } else if (input.areaWard !== null && input.scope !== 'national' && input.scope !== 'province') {
      const wardGeo = await userClient.getWardGeoFailSoft(input.areaWard);
      const c = wardGeo?.centroid;
      if (
        wardGeo &&
        wardGeo.provinceCode === input.areaProvince &&
        c &&
        c.lat >= VN_LAT_MIN &&
        c.lat <= VN_LAT_MAX &&
        c.lng >= VN_LNG_MIN &&
        c.lng <= VN_LNG_MAX
      ) {
        originKind = 'WARD_CENTER';
        originLat = round6(c.lat);
        originLng = round6(c.lng);
      }
    }

    let appliedScope: GymSearchCursorScope;
    if (input.scope === 'near') {
      // If caller asked for 'near' using areaWard (no GPS) and centroid resolution failed, fall back fail-soft to province.
      appliedScope = originLat !== null ? 'near' : 'province';
    } else if (input.scope) {
      appliedScope = input.scope;
    } else if (originLat !== null) {
      appliedScope = 'near';
    } else if (input.areaProvince !== null) {
      appliedScope = 'province';
    } else {
      appliedScope = 'national';
    }

    const filterHash = computeGymSearchFilterHash({
      scope: appliedScope,
      sort: input.sort,
      radiusKm: appliedScope === 'near' ? input.radiusKm : null,
      areaProvince: input.areaProvince,
      areaWard: input.areaWard,
      q: input.q,
      amenityIds: input.amenityIds,
      priceMax: input.priceMax,
      originKind,
      originLat,
      originLng,
    });

    let decodedCursor: GymsSearchCursorPayload | null = null;
    if (input.cursor) {
      decodedCursor = decodeGymCursor(input.cursor, 'gyms_search', filterHash);
    }

    const qTokens = tokenizeQuery(input.q);
    const qNorm = input.q ? normalizeFold(input.q) : '';
    const now = new Date();

    const whereParts: Prisma.Sql[] = [sqlPublicVisibleGymWhere()];

    if (appliedScope === 'near' && originLat !== null && originLng !== null) {
      const deltaLat = input.radiusKm / 111.045;
      const cosLat = Math.max(0.1, Math.cos((originLat * Math.PI) / 180));
      const deltaLng = input.radiusKm / (111.045 * cosLat);
      const minLat = round6(originLat - deltaLat);
      const maxLat = round6(originLat + deltaLat);
      const minLng = round6(originLng - deltaLng);
      const maxLng = round6(originLng + deltaLng);
      whereParts.push(Prisma.sql`g.latitude IS NOT NULL AND g.longitude IS NOT NULL`);
      whereParts.push(Prisma.sql`g.latitude BETWEEN ${minLat} AND ${maxLat}`);
      whereParts.push(Prisma.sql`g.longitude BETWEEN ${minLng} AND ${maxLng}`);
    } else if (appliedScope === 'province' && input.areaProvince !== null) {
      whereParts.push(Prisma.sql`g.province_code = ${input.areaProvince}`);
    }

    if (qTokens.length > 0) {
      const haystackExpr = sqlFoldExpr(
        Prisma.sql`COALESCE(g.approved_name, g.name, '') || ' ' || COALESCE(b.approved_name, b.name, '') || ' ' || COALESCE(g.approved_address, g.address, '') || ' ' || COALESCE(g.city, '')`,
      );
      for (const tok of qTokens) {
        const pattern = `%${escapeLike(tok)}%`;
        whereParts.push(Prisma.sql`${haystackExpr} LIKE ${pattern} ESCAPE '!'`);
      }
    }

    if (input.amenityIds.length > 0) {
      whereParts.push(Prisma.sql`
        (
          SELECT COUNT(DISTINCT req.tok)
          FROM unnest(${input.amenityIds}::text[]) AS req(tok)
          WHERE EXISTS (
            SELECT 1
            FROM gym_amenities ga
            JOIN amenities a ON a.id = ga.amenity_id
            WHERE ga.gym_id = g.id
              AND a.status = 'ACTIVE'
              AND (a.id = req.tok OR a.slug = req.tok)
          )
        ) = ${input.amenityIds.length}
      `);
    }

    const baseWhereSql = Prisma.join(whereParts, ' AND ');

    const hasCenter = originLat !== null && originLng !== null;
    const rawDistExpr = hasCenter
      ? Prisma.sql`(2.0 * 6371.0088 * ASIN(SQRT(LEAST(1.0, POWER(SIN(RADIANS(g.latitude - ${originLat}) / 2.0), 2) + COS(RADIANS(${originLat})) * COS(RADIANS(g.latitude)) * POWER(SIN(RADIANS(g.longitude - ${originLng}) / 2.0), 2)))))`
      : Prisma.sql`NULL::double precision`;

    const nameFoldExpr = sqlFoldExpr(Prisma.sql`COALESCE(g.approved_name, g.name, '')`);
    const brandFoldExpr = sqlFoldExpr(Prisma.sql`COALESCE(b.approved_name, b.name, '')`);
    const textBoostExpr = qNorm
      ? Prisma.sql`CASE WHEN ${nameFoldExpr} LIKE ${escapeLike(qNorm) + '%'} ESCAPE '!' OR ${brandFoldExpr} LIKE ${escapeLike(qNorm) + '%'} ESCAPE '!' THEN 15.0 ELSE 0.0 END`
      : Prisma.sql`0.0`;

    // Pure distance + quality + text relevance (zero same-province bias so closer out-of-province gyms are never penalized).
    const relevanceExpr = hasCenter
      ? Prisma.sql`ROUND((CASE WHEN gf.distance_km IS NULL THEN 0.0 ELSE 100.0 / (1.0 + gf.distance_km) END + COALESCE(rv.rating_avg, 0.0) * 4.0 + LEAST(COALESCE(rv.review_count, 0), 50) * 0.1 + gf.text_boost)::numeric, 6)::double precision`
      : Prisma.sql`ROUND((COALESCE(rv.rating_avg, 0.0) * 10.0 + LEAST(COALESCE(rv.review_count, 0), 50) * 0.2 + gf.text_boost)::numeric, 6)::double precision`;

    let orderBySql: Prisma.Sql;
    let keysetAfterSql: Prisma.Sql = Prisma.sql`TRUE`;

    if (input.sort === 'distance') {
      orderBySql = Prisma.sql`s.distance_km ASC NULLS LAST, s.rating_avg DESC, s.review_count DESC, s.id ASC`;
      if (decodedCursor) {
        keysetAfterSql = buildKeysetAfterSql([
          { col: Prisma.sql`s.distance_km`, dir: 'ASC', nullable: true, val: decodedCursor.distanceKm != null ? Prisma.sql`${decodedCursor.distanceKm}::double precision` : null },
          { col: Prisma.sql`s.rating_avg`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.ratingAvg ?? 0}::double precision` },
          { col: Prisma.sql`s.review_count`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.reviewCount ?? 0}::int` },
          { col: Prisma.sql`s.id`, dir: 'ASC', nullable: false, val: Prisma.sql`${decodedCursor.id}` },
        ]);
      }
    } else if (input.sort === 'rating') {
      orderBySql = Prisma.sql`s.rating_avg DESC, s.review_count DESC, s.distance_km ASC NULLS LAST, s.id ASC`;
      if (decodedCursor) {
        keysetAfterSql = buildKeysetAfterSql([
          { col: Prisma.sql`s.rating_avg`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.ratingAvg ?? 0}::double precision` },
          { col: Prisma.sql`s.review_count`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.reviewCount ?? 0}::int` },
          { col: Prisma.sql`s.distance_km`, dir: 'ASC', nullable: true, val: decodedCursor.distanceKm != null ? Prisma.sql`${decodedCursor.distanceKm}::double precision` : null },
          { col: Prisma.sql`s.id`, dir: 'ASC', nullable: false, val: Prisma.sql`${decodedCursor.id}` },
        ]);
      }
    } else if (input.sort === 'price') {
      orderBySql = Prisma.sql`s.from_price ASC NULLS LAST, s.distance_km ASC NULLS LAST, s.rating_avg DESC, s.id ASC`;
      if (decodedCursor) {
        keysetAfterSql = buildKeysetAfterSql([
          { col: Prisma.sql`s.from_price`, dir: 'ASC', nullable: true, val: decodedCursor.fromPrice != null ? Prisma.sql`${decodedCursor.fromPrice}::double precision` : null },
          { col: Prisma.sql`s.distance_km`, dir: 'ASC', nullable: true, val: decodedCursor.distanceKm != null ? Prisma.sql`${decodedCursor.distanceKm}::double precision` : null },
          { col: Prisma.sql`s.rating_avg`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.ratingAvg ?? 0}::double precision` },
          { col: Prisma.sql`s.id`, dir: 'ASC', nullable: false, val: Prisma.sql`${decodedCursor.id}` },
        ]);
      }
    } else {
      orderBySql = Prisma.sql`s.relevance_score DESC, s.distance_km ASC NULLS LAST, s.id ASC`;
      if (decodedCursor) {
        keysetAfterSql = buildKeysetAfterSql([
          { col: Prisma.sql`s.relevance_score`, dir: 'DESC', nullable: false, val: Prisma.sql`${decodedCursor.relevanceScore ?? 0}::double precision` },
          { col: Prisma.sql`s.distance_km`, dir: 'ASC', nullable: true, val: decodedCursor.distanceKm != null ? Prisma.sql`${decodedCursor.distanceKm}::double precision` : null },
          { col: Prisma.sql`s.id`, dir: 'ASC', nullable: false, val: Prisma.sql`${decodedCursor.id}` },
        ]);
      }
    }

    const takeLimit = input.limit + 1;
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '2s'`);
      if (opts?.onAfterTimeoutSetInTx) {
        await opts.onAfterTimeoutSetInTx(tx);
      }
      return tx.$queryRaw<SearchScoredRow[]>(Prisma.sql`
        WITH filtered AS MATERIALIZED (
          SELECT
            g.id,
            g.brand_id,
            CASE
              WHEN g.latitude IS NOT NULL AND g.longitude IS NOT NULL
              THEN ${rawDistExpr}
              ELSE NULL::double precision
            END AS raw_dist,
            ${textBoostExpr}::double precision AS text_boost
          FROM gyms g
          LEFT JOIN gym_brands b ON b.id = g.brand_id
          WHERE ${baseWhereSql}
        ),
        geo_filtered AS MATERIALIZED (
          SELECT
            f.id,
            f.brand_id,
            CASE
              WHEN f.raw_dist IS NULL THEN NULL::double precision
              ELSE ROUND(f.raw_dist::numeric, 6)::double precision
            END AS distance_km,
            f.text_boost
          FROM filtered f
          WHERE ${appliedScope === 'near' ? Prisma.sql`f.raw_dist IS NOT NULL AND f.raw_dist <= ${input.radiusKm}` : Prisma.sql`TRUE`}
        ),
        review_stats AS MATERIALIZED (
          SELECT
            r.gym_id,
            ROUND(AVG(r.rating)::numeric, 2)::double precision AS rating_avg,
            COUNT(*)::int AS review_count
          FROM gym_reviews r
          WHERE r.gym_id IN (SELECT id FROM geo_filtered)
          GROUP BY r.gym_id
        ),
        brand_prices AS MATERIALIZED (
          SELECT
            p.brand_id,
            ROUND(MIN(p.price)::numeric, 2)::double precision AS min_price
          FROM gym_membership_plans p
          WHERE p.brand_id IN (SELECT DISTINCT brand_id FROM geo_filtered WHERE brand_id IS NOT NULL)
            AND p.status = 'ACTIVE'
            AND (p.sale_start_at IS NULL OR p.sale_start_at <= ${now})
            AND (p.sale_end_at IS NULL OR p.sale_end_at >= ${now})
          GROUP BY p.brand_id
        ),
        scored AS MATERIALIZED (
          SELECT
            gf.id,
            gf.distance_km,
            COALESCE(rv.rating_avg, 0.0)::double precision AS rating_avg,
            COALESCE(rv.review_count, 0)::int AS review_count,
            bp.min_price AS from_price,
            ${relevanceExpr} AS relevance_score
          FROM geo_filtered gf
          LEFT JOIN review_stats rv ON rv.gym_id = gf.id
          LEFT JOIN brand_prices bp ON bp.brand_id = gf.brand_id
          WHERE ${input.priceMax !== null ? Prisma.sql`bp.min_price IS NOT NULL AND bp.min_price <= ${input.priceMax}` : Prisma.sql`TRUE`}
        )
        SELECT s.id, s.distance_km, s.rating_avg, s.review_count, s.from_price, s.relevance_score
        FROM scored s
        WHERE ${keysetAfterSql}
        ORDER BY ${orderBySql}
        LIMIT ${takeLimit}
      `);
    });

    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const ids = pageRows.map((r) => r.id);
    const scoreById = new Map(pageRows.map((r) => [r.id, r]));

    const publishedGyms = await gymPublicRepository.findPublishedByIds(ids);
    const brandIds = [...new Set(publishedGyms.map((g) => g.brandId).filter((id): id is string => !!id))];
    const cheapestByBrand = await planRepository.findCheapestActiveByBrands(brandIds);

    const gyms = publishedGyms.map((g) => {
      const s = scoreById.get(g.id);
      const distanceKm = s?.distance_km != null ? round1(s.distance_km) : null;
      return {
        ...toPublicGymDto(g),
        averageRating: round2(s?.rating_avg ?? 0),
        reviewCount: s?.review_count ?? 0,
        fromPrice: g.brandId ? (cheapestByBrand.get(g.brandId) ?? null) : null,
        distanceKm,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeGymCursor({
        v: 1,
        kind: 'gyms_search',
        sort: input.sort,
        scope: appliedScope,
        filterHash,
        distanceKm: last.distance_km,
        relevanceScore: last.relevance_score,
        ratingAvg: last.rating_avg,
        fromPrice: last.from_price,
        reviewCount: last.review_count,
        id: last.id,
      });
    }

    return { gyms, nextCursor, hasMore, appliedScope };
  },

  async listBrandOptions(rawQuery: { q?: unknown; cursor?: unknown; limit?: unknown }) {
    assertGymSearchCursorSecretConfigured();

    let q: string | null = null;
    if (rawQuery.q !== undefined && rawQuery.q !== null && rawQuery.q !== '') {
      if (typeof rawQuery.q !== 'string') {
        throw new GymSearchValidationError('q phải là chuỗi');
      }
      const trimmed = rawQuery.q.trim();
      if (trimmed.length > 200) {
        throw new GymSearchValidationError('q tối đa 200 ký tự');
      }
      if (trimmed.length > 0) q = trimmed;
    }

    let limit = GYM_SEARCH_DEFAULT_LIMIT;
    if (rawQuery.limit !== undefined && rawQuery.limit !== null && rawQuery.limit !== '') {
      const rawLim = typeof rawQuery.limit === 'string' ? rawQuery.limit.trim() : rawQuery.limit;
      const n = typeof rawLim === 'number' ? rawLim : /^\d{1,4}$/.test(String(rawLim)) ? Number(rawLim) : NaN;
      if (!Number.isSafeInteger(n) || n < 1 || n > GYM_SEARCH_MAX_LIMIT) {
        throw new GymSearchValidationError(`limit phải là số nguyên trong khoảng 1-${GYM_SEARCH_MAX_LIMIT}`);
      }
      limit = n;
    }

    let cursorToken: string | null = null;
    if (rawQuery.cursor !== undefined && rawQuery.cursor !== null && rawQuery.cursor !== '') {
      if (typeof rawQuery.cursor !== 'string') {
        throw new GymSearchValidationError('cursor không hợp lệ');
      }
      cursorToken = rawQuery.cursor.trim();
    }

    const filterHash = computeBrandOptionsFilterHash({ q });
    let decoded: BrandOptionsCursorPayload | null = null;
    if (cursorToken) {
      decoded = decodeGymCursor(cursorToken, 'brand_options', filterHash);
    }

    const qTokens = tokenizeQuery(q);
    const tokenFilters: Prisma.Sql[] = [];
    for (const tok of qTokens) {
      tokenFilters.push(Prisma.sql`o.search_blob LIKE ${'%' + escapeLike(tok) + '%'} ESCAPE '!'`);
    }
    const qWhereSql = tokenFilters.length > 0 ? Prisma.join(tokenFilters, ' AND ') : Prisma.sql`TRUE`;

    const keysetSql = decoded
      ? Prisma.sql`(o.sort_name_lower > ${decoded.sortNameLower} OR (o.sort_name_lower = ${decoded.sortNameLower} AND o.sort_key > ${decoded.sortKey}))`
      : Prisma.sql`TRUE`;

    interface OptionSqlRow {
      scope: 'BRAND' | 'BRANCH';
      brand_id: string;
      brand_name: string;
      branches: BrandOptionBranchDto[];
      propose_branch_id: string;
      sort_name_lower: string;
      sort_key: string;
    }

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '2s'`);
      return tx.$queryRaw<OptionSqlRow[]>(Prisma.sql`
        WITH visible_gyms AS MATERIALIZED (
          SELECT
            g.id,
            g.brand_id,
            COALESCE(NULLIF(TRIM(COALESCE(g.approved_name, g.name)), ''), 'Phòng tập') AS branch_name,
            NULLIF(TRIM(COALESCE(g.city, '')), '') AS city,
            COALESCE(g.approved_address, g.address, '') AS branch_address,
            COALESCE(NULLIF(TRIM(COALESCE(b.approved_name, b.name)), ''), 'Thương hiệu') AS brand_display_name
          FROM gyms g
          LEFT JOIN gym_brands b ON b.id = g.brand_id
          WHERE ${sqlPublicVisibleGymWhere()}
        ),
        brand_groups AS (
          SELECT
            'BRAND'::text AS scope,
            vg.brand_id AS brand_id,
            MIN(vg.brand_display_name) AS brand_name,
            json_agg(
              json_build_object(
                'id', vg.id,
                'name', vg.branch_name,
                'city', vg.city,
                'closed', FALSE
              )
              ORDER BY vg.branch_name ASC, vg.id ASC
            ) AS branches,
            (ARRAY_AGG(vg.id ORDER BY vg.branch_name ASC, vg.id ASC))[1] AS propose_branch_id,
            lower(MIN(vg.brand_display_name)) AS sort_name_lower,
            'B:' || vg.brand_id AS sort_key,
            ${sqlFoldExpr(
              Prisma.sql`MIN(vg.brand_display_name) || ' ' || string_agg(vg.branch_name || ' ' || COALESCE(vg.city, '') || ' ' || vg.branch_address, ' ')`,
            )} AS search_blob
          FROM visible_gyms vg
          WHERE vg.brand_id IS NOT NULL
          GROUP BY vg.brand_id
        ),
        standalone_groups AS (
          SELECT
            'BRANCH'::text AS scope,
            'branch:' || vg.id AS brand_id,
            vg.branch_name AS brand_name,
            json_build_array(
              json_build_object(
                'id', vg.id,
                'name', vg.branch_name,
                'city', vg.city,
                'closed', FALSE
              )
            ) AS branches,
            vg.id AS propose_branch_id,
            lower(vg.branch_name) AS sort_name_lower,
            'S:' || vg.id AS sort_key,
            ${sqlFoldExpr(
              Prisma.sql`vg.branch_name || ' ' || COALESCE(vg.city, '') || ' ' || vg.branch_address`,
            )} AS search_blob
          FROM visible_gyms vg
          WHERE vg.brand_id IS NULL
        ),
        all_options AS (
          SELECT * FROM brand_groups
          UNION ALL
          SELECT * FROM standalone_groups
        )
        SELECT o.scope, o.brand_id, o.brand_name, o.branches, o.propose_branch_id, o.sort_name_lower, o.sort_key
        FROM all_options o
        WHERE ${qWhereSql} AND ${keysetSql}
        ORDER BY o.sort_name_lower ASC, o.sort_key ASC
        LIMIT ${limit + 1}
      `);
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const options: BrandOptionDto[] = pageRows.map((r) => ({
      scope: r.scope,
      brandId: r.brand_id,
      brandName: r.brand_name,
      branches: Array.isArray(r.branches) ? r.branches : [],
      proposeBranchId: r.propose_branch_id,
    }));

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeGymCursor({
        v: 1,
        kind: 'brand_options',
        filterHash,
        sortNameLower: last.sort_name_lower,
        sortKey: last.sort_key,
      });
    }

    return { options, nextCursor, hasMore };
  },
};
