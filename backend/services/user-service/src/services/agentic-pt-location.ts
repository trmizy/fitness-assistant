import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { trainingLocationHaversineKmSql } from "./pt-discovery.query";

/**
 * Location support for the AI Coach PT search (agentic-fitness.service.ts::candidates).
 *
 * Reference point priority: (i) a place the client NAMED in the message (`wardCode` / free-text `placeText`),
 * (ii) the client's profile search region (UserProfile.searchProvinceCode / searchWardCode), (iii) none.
 * Distance is measured exactly like PT discovery (same SQL helper: location lat/lng, else ward centroid).
 */

export interface ReferencePoint {
  lat: number | null;
  lng: number | null;
  provinceCode: number | null;
  source: "PLACE" | "PROFILE";
  label: string | null;
}

export interface PtLocationInfo {
  /** Nearest active training location (ward/district label) and its distance in km (null: no reference point / no coordinates). */
  nearest: { label: string; distanceKm: number | null; provinceCode: number } | null;
  provinceCodes: number[];
}

export interface LocationRow { ptUserId: string; provinceCode: number; label: string | null; distanceKm: number | null }

/** Accent-insensitive lowercase, same convention as the admin tables' `name_normalized`. */
export function normalizePlaceText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** "Phường Gò Vấp" / "quan go vap" / "tp. ho chi minh" -> the bare name ("go vap", "ho chi minh"). */
export function stripAdminPrefix(normalized: string): string {
  return normalized.replace(/^(?:thanh pho|tp|tinh|quan|q|huyen|thi xa|thi tran|phuong|p|xa)\s+(?=\S)/, "").trim();
}

/** Nearest location per PT: smallest known distance wins; with no distances at all the first row (deterministic order) wins. */
export function pickNearestPerPt(rows: LocationRow[]): Map<string, PtLocationInfo> {
  const out = new Map<string, PtLocationInfo>();
  for (const row of rows) {
    const current = out.get(row.ptUserId) ?? { nearest: null, provinceCodes: [] };
    if (!current.provinceCodes.includes(row.provinceCode)) current.provinceCodes.push(row.provinceCode);
    const candidate = { label: row.label ?? "", distanceKm: row.distanceKm, provinceCode: row.provinceCode };
    const best = current.nearest;
    const better = !best
      || (candidate.distanceKm !== null && (best.distanceKm === null || candidate.distanceKm < best.distanceKm));
    if (better) current.nearest = candidate;
    out.set(row.ptUserId, current);
  }
  return out;
}

async function wardCentroid(wardCode: number): Promise<{ lat: number; lng: number; provinceCode: number; name: string | null } | null> {
  const rows = await prisma.$queryRaw<{ centroid_lat: number; centroid_lng: number; province_code: number; name: string | null }[]>(Prisma.sql`
    SELECT wg.centroid_lat, wg.centroid_lng, wg.province_code, w.name
    FROM vietnam_ward_geo wg
    LEFT JOIN vietnam_wards w ON w.code = wg.ward_code
    WHERE wg.ward_code = ${wardCode}::int4
    LIMIT 1`);
  return rows[0] ? { lat: rows[0].centroid_lat, lng: rows[0].centroid_lng, provinceCode: rows[0].province_code, name: rows[0].name } : null;
}

/** Resolve a free-text place against admin wards, then provinces, then the legacy district names PTs typed on their locations. */
async function resolvePlaceText(placeText: string, preferredProvince: number | null): Promise<ReferencePoint | null> {
  const raw = normalizePlaceText(placeText);
  const bare = stripAdminPrefix(raw);
  if (!bare) return null;
  // "Quan 7" -> bare "7": numeric districts only exist as legacy district names, never as ward/province names.
  const numeric = /^[0-9]+$/.test(bare);

  // 1) Ward by name. Exact bare-name match first, then "contains"; the client's own province and provinces with more PT
  //    locations win ties (a ward name such as "Tan Phu" exists in several provinces).
  const containsSql = bare.length >= 4 ? Prisma.sql`OR w.name_normalized LIKE ${"%" + bare + "%"}` : Prisma.empty;
  const wards = numeric ? [] : await prisma.$queryRaw<{ code: number; province_code: number; name: string; lat: number; lng: number; exact: boolean }[]>(Prisma.sql`
    SELECT w.code, w.province_code, w.name, wg.centroid_lat AS lat, wg.centroid_lng AS lng,
           (regexp_replace(w.name_normalized, '^(phuong|xa|thi tran|dac khu)\\s+', '') = ${bare}) AS exact
    FROM vietnam_wards w
    JOIN vietnam_ward_geo wg ON wg.ward_code = w.code
    WHERE w.name_normalized = ${raw}
       OR regexp_replace(w.name_normalized, '^(phuong|xa|thi tran|dac khu)\\s+', '') = ${bare}
       ${containsSql}
    ORDER BY exact DESC,
             (w.province_code = ${preferredProvince ?? -1}::int4) DESC,
             (SELECT COUNT(*) FROM pt_training_locations t WHERE t.province_code = w.province_code AND t.is_active = true) DESC,
             w.code ASC
    LIMIT 1`);
  if (wards[0]) return { lat: wards[0].lat, lng: wards[0].lng, provinceCode: wards[0].province_code, source: "PLACE", label: wards[0].name };

  // 2) Legacy district a PT wrote on a training location ("Quận Gò Vấp"): centroid of the matching locations.
  const districts = await prisma.$queryRaw<{ legacy_district_name: string; province_code: number }[]>(Prisma.sql`
    SELECT DISTINCT legacy_district_name, province_code FROM pt_training_locations
    WHERE is_active = true AND legacy_district_name IS NOT NULL LIMIT 3000`);
  const district = districts
    .filter(d => stripAdminPrefix(normalizePlaceText(d.legacy_district_name)) === bare)
    .sort((a, b) => Number(b.province_code === preferredProvince) - Number(a.province_code === preferredProvince) || a.province_code - b.province_code)[0];
  if (district) {
    const centre = await prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>(Prisma.sql`
      SELECT AVG(COALESCE(tl.latitude, wg.centroid_lat)) AS lat, AVG(COALESCE(tl.longitude, wg.centroid_lng)) AS lng
      FROM pt_training_locations tl
      LEFT JOIN vietnam_ward_geo wg ON (tl.latitude IS NULL OR tl.longitude IS NULL) AND wg.ward_code = tl.ward_code
      WHERE tl.is_active = true AND tl.legacy_district_name = ${district.legacy_district_name} AND tl.province_code = ${district.province_code}::int4`);
    return { lat: centre[0]?.lat ?? null, lng: centre[0]?.lng ?? null, provinceCode: district.province_code, source: "PLACE", label: district.legacy_district_name };
  }

  // 3) A province ("Ha Noi", "Da Nang"): no point, only a province restriction.
  const provinces = numeric ? [] : await prisma.$queryRaw<{ code: number; name: string }[]>(Prisma.sql`
    SELECT code, name FROM vietnam_provinces
    WHERE name_normalized = ${raw}
       OR regexp_replace(name_normalized, '^(thanh pho|tinh)\\s+', '') = ${bare}
    ORDER BY code ASC LIMIT 1`);
  if (provinces[0]) return { lat: null, lng: null, provinceCode: provinces[0].code, source: "PLACE", label: provinces[0].name };
  return null;
}

export async function resolveReferencePoint(
  profile: { searchProvinceCode: number | null; searchWardCode: number | null },
  prefs: { wardCode?: number; placeText?: string },
): Promise<ReferencePoint | null> {
  if (prefs.wardCode) {
    const ward = await wardCentroid(prefs.wardCode);
    if (ward) return { lat: ward.lat, lng: ward.lng, provinceCode: ward.provinceCode, source: "PLACE", label: ward.name };
  }
  if (prefs.placeText) {
    const place = await resolvePlaceText(prefs.placeText, profile.searchProvinceCode);
    if (place) return place;
  }
  if (profile.searchWardCode) {
    const ward = await wardCentroid(profile.searchWardCode);
    if (ward) return { lat: ward.lat, lng: ward.lng, provinceCode: ward.provinceCode, source: "PROFILE", label: ward.name };
  }
  if (profile.searchProvinceCode) return { lat: null, lng: null, provinceCode: profile.searchProvinceCode, source: "PROFILE", label: null };
  return null;
}

/** Every active training location of the given PTs with its distance from the reference point (null without one). */
export async function loadTrainingLocations(ptIds: string[], ref: ReferencePoint | null): Promise<Map<string, PtLocationInfo>> {
  if (!ptIds.length) return new Map();
  const hasPoint = ref !== null && ref.lat !== null && ref.lng !== null;
  const distanceSql = hasPoint ? trainingLocationHaversineKmSql(ref!.lat!, ref!.lng!) : Prisma.sql`NULL::double precision`;
  const rows = await prisma.$queryRaw<{ ptUserId: string; provinceCode: number; label: string | null; distanceKm: number | null }[]>(Prisma.sql`
    SELECT tl.pt_user_id AS "ptUserId", tl.province_code AS "provinceCode",
           COALESCE(tl.legacy_district_name, w.name, p.name) AS label,
           ${distanceSql} AS "distanceKm"
    FROM pt_training_locations tl
    LEFT JOIN vietnam_ward_geo wg ON (tl.latitude IS NULL OR tl.longitude IS NULL) AND wg.ward_code = tl.ward_code
    LEFT JOIN vietnam_wards w ON w.code = tl.ward_code
    LEFT JOIN vietnam_provinces p ON p.code = tl.province_code
    WHERE tl.is_active = true AND tl.pt_user_id = ANY(${ptIds}::text[])
    ORDER BY tl.is_primary DESC, tl.created_at ASC`);
  return pickNearestPerPt(rows.map(r => ({ ...r, distanceKm: r.distanceKm === null ? null : Math.round(Number(r.distanceKm) * 10) / 10 })));
}
