/**
 * ONE-statement hydration of a page of public PT rows (discovery list / search page).
 *
 * Why this exists: `prisma.userProfile.findMany({ select: PT_PUBLIC_PROFILE_SELECT })` costs one SQL
 * statement per relation (profile, application, certificates, locations, provinces, wards,
 * packages, photos = 8) and `attachPtRatings` one more. At scale benchmark concurrency those
 * round trips queue on the Prisma pool. This function returns exactly the same `PtPublicRow`
 * shape (the allowlist is still PT_PUBLIC_PROFILE_SELECT's shape) from a single statement, with the
 * rating aggregate folded in so the caller does not need `attachPtRatings`.
 *
 * NULL scalar-list columns come back as [] (Prisma semantics), hence the COALESCE on every text[] column.
 *
 * Contract kept byte-for-byte with the Prisma path (proved by pt-public-hydrate.integration.test.ts):
 *   - rows come back in the order of `userIds`; ids with no profile row are dropped
 *   - trainingLocations: active only, ORDER BY is_primary DESC, created_at ASC (ties broken by id: the Prisma path left ties in arbitrary plan order, and seeds insert in batches so created_at ties are common)
 *   - servicePackages: for sale only (is_active, not archived), ORDER BY created_at DESC, id ASC; price is a Prisma.Decimal
 *   - physiquePhotos: PUBLISHED only, ORDER BY sort_order, created_at, id
 *   - certificates: no ORDER BY in the Prisma path -> physical row order (ctid) here; issue/expiration dates are Date objects
 *   - avgRating = round1(AVG(rating)) or null when never rated, ratingCount = COUNT(*) (same maths as aggregateForPts)
 *
 * Nothing here selects a column outside the public allowlist.
 */
import { Prisma } from "../generated/prisma";
// Circular on purpose (same pattern as pt-discovery.query.ts): `prisma` is only used at call time.
import { prisma } from "../repositories/profile.repository";
import { asPublishedPtSource, type PtPublicRow, type PublishedPtSource } from "./pt-public-dto";

export type PublishedPtSourceWithRating = PublishedPtSource & {
  avgRating: number | null;
  ratingCount: number;
};

interface HydrateRow {
  doc: any;
  avg: number | null;
  cnt: number | null;
}

/** timestamp (UTC wall clock, Prisma's storage convention) -> ISO-8601 with Z, parsed back to Date below. */
const ISO = (col: string) => Prisma.raw(`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const toDate = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

export async function hydratePublicPtsByIdsSingleQuery(userIds: string[]): Promise<PublishedPtSourceWithRating[]> {
  if (userIds.length === 0) return [];

  const rows = await prisma.$queryRaw<HydrateRow[]>(Prisma.sql`
    WITH ids AS (
      SELECT t.uid, t.ord FROM unnest(${userIds}::text[]) WITH ORDINALITY AS t(uid, ord)
    ),
    -- certificates are pre-aggregated once for the page's applications: pt_application_certificates has no index on
    -- application_id, so a correlated per-row subquery would seq-scan the whole table once per PT (measured: 20 scans, ~60% of the statement).
    certs AS MATERIALIZED (
      SELECT c.application_id,
             json_agg(json_build_object(
               'certificateName', c.certificate_name,
               'issuingOrganization', c.issuing_organization,
               'isCurrentlyValid', c.is_currently_valid,
               'certificationStatus', c.certification_status,
               'issueDate', ${ISO("c.issue_date")},
               'expirationDate', ${ISO("c.expiration_date")}
             ) ORDER BY c.ctid) AS arr
      FROM pt_application_certificates c
      WHERE c.application_id IN (
        SELECT a.id FROM pt_applications a JOIN user_profiles up ON up.id = a.user_profile_id WHERE up."userId" = ANY(${userIds}::text[])
      )
      GROUP BY c.application_id
    ),
    rt AS (
      SELECT s.pt_user_id AS uid, AVG(r.rating)::float AS avg, COUNT(*)::int AS cnt
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.pt_user_id = ANY(${userIds}::text[])
      GROUP BY s.pt_user_id
    )
    SELECT
      json_build_object(
        'userId', p."userId",
        'firstName', p."firstName",
        'lastName', p."lastName",
        'photoUrl', p.photo_url,
        'specialties', COALESCE(p.specialties, ARRAY[]::text[]),
        'isAcceptingClients', p.is_accepting_clients,
        'notAcceptingReason', p.not_accepting_reason,
        'searchCity', p.search_city,
        'searchDistrict', p.search_district,
        'searchWard', p.search_ward,
        'gymId', p.gym_id,
        'ptApplication', CASE WHEN pa.id IS NULL THEN NULL ELSE json_build_object(
          'serviceMode', pa.service_mode,
          'operatingAreas', COALESCE(pa.operating_areas, ARRAY[]::text[]),
          'gymAffiliation', pa.gym_affiliation,
          'professionalBio', pa.professional_bio,
          'yearsOfExperience', pa.years_of_experience,
          'educationBackground', pa.education_background,
          'previousWorkExperience', pa.previous_work_experience,
          'trainingMethodsApproach', pa.training_methods_approach,
          'targetClientGroups', COALESCE(pa.target_client_groups, ARRAY[]::text[]),
          'primaryTrainingGoals', COALESCE(pa.primary_training_goals, ARRAY[]::text[]),
          'availableDays', COALESCE(pa.available_days, ARRAY[]::text[]),
          'availableFrom', pa.available_from,
          'availableUntil', pa.available_until,
          'availabilityBlocks', pa.availability_blocks,
          'linkedinUrl', pa.linkedin_url,
          'websiteUrl', pa.website_url,
          'mainSpecialties', COALESCE(pa.main_specialties, ARRAY[]::text[]),
          'languages', COALESCE(pa.languages, ARRAY[]::text[]),
          'certificates', COALESCE(certs.arr, '[]'::json)
        ) END,
        'trainingLocations', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', l.id,
            'gymName', l.gym_name,
            'addressLine', l.address_line,
            'isPrimary', l.is_primary,
            'gymId', l.gym_id,
            'provinceCode', l.province_code,
            'wardCode', l.ward_code,
            'province', json_build_object('name', pr.name),
            'ward', CASE WHEN w.code IS NULL THEN NULL ELSE json_build_object('name', w.name) END
          ) ORDER BY l.is_primary DESC, l.created_at ASC, l.id ASC), '[]'::json)
          FROM pt_training_locations l
          JOIN vietnam_provinces pr ON pr.code = l.province_code
          LEFT JOIN vietnam_wards w ON w.code = l.ward_code
          WHERE l.pt_user_id = p."userId" AND l.is_active = true
        ),
        'servicePackages', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', sp.id,
            'ptUserId', sp.pt_user_id,
            'name', sp.name,
            'description', sp.description,
            'sessionCount', sp.session_count,
            'price', sp.price::text,
            'sessionMode', sp.session_mode::text,
            'sessionDurationMinutes', sp.session_duration_minutes,
            'validityDays', sp.validity_days,
            'isActive', sp.is_active,
            'archivedAt', ${ISO("sp.archived_at")},
            'version', sp.version
          ) ORDER BY sp.created_at DESC, sp.id ASC), '[]'::json)
          FROM pt_service_packages sp
          WHERE sp.pt_user_id = p."userId" AND sp.is_active = true AND sp.archived_at IS NULL
        ),
        'physiquePhotos', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', ph.id,
            'isCover', ph.is_cover,
            'sortOrder', ph.sort_order
          ) ORDER BY ph.sort_order ASC, ph.created_at ASC, ph.id ASC), '[]'::json)
          FROM pt_physique_photos ph
          WHERE ph.pt_user_id = p."userId" AND ph.status = 'PUBLISHED'::"PtPhysiquePhotoStatus"
        )
      ) AS doc,
      rt.avg AS avg,
      rt.cnt AS cnt
    FROM ids
    JOIN user_profiles p ON p."userId" = ids.uid
    LEFT JOIN pt_applications pa ON pa.user_profile_id = p.id
    LEFT JOIN certs ON certs.application_id = pa.id
    LEFT JOIN rt ON rt.uid = p."userId"
    ORDER BY ids.ord
  `);

  return rows.map((row) => {
    const doc = row.doc;
    if (doc.ptApplication) {
      doc.ptApplication.certificates = doc.ptApplication.certificates.map((c: any) => ({
        ...c,
        issueDate: toDate(c.issueDate),
        expirationDate: toDate(c.expirationDate),
      }));
    }
    doc.servicePackages = doc.servicePackages.map((sp: any) => ({
      ...sp,
      price: new Prisma.Decimal(sp.price),
      archivedAt: toDate(sp.archivedAt),
    }));
    const count = row.cnt === null ? 0 : Number(row.cnt);
    const base = asPublishedPtSource(doc as PtPublicRow);
    return Object.assign(base, {
      avgRating: row.avg === null ? null : Math.round(Number(row.avg) * 10) / 10,
      ratingCount: count,
    }) as PublishedPtSourceWithRating;
  });
}
