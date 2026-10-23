/**
 * The ONE place that decides (a) whether a trainer may be shown to the public at all and (b) exactly which
 * fields of a visible trainer leave this service.
 *
 * Listing-management plan §1 B2, §12.7, §12.13 item 1:
 *
 *  - Visibility (`ptPublicWhere` / `isPtPubliclyVisible`) is used by the list, the detail, the service-packages
 *    read and the price derivation, so a trainer id typed into the URL cannot get past a filter the list applies.
 *    A trainer is visible only when ALL hold: isPT, an APPROVED application, not ptSuspended, and no open
 *    ACCOUNT-scope restriction. A restriction on ONE contract (CONTRACT scope) does not hide the trainer.
 *
 *  - `toPublicPtDto` is an explicit allowlist. It reads a `PublishedPtSource`, which can only be produced by the
 *    public finders in profile.repository.ts (they apply the visibility rule and the PUBLISHED-only photo filter),
 *    so a draft revision can never be handed to it. Nothing is spread: a column added to UserProfile or
 *    PTApplication tomorrow stays private until somebody adds it HERE.
 *
 *  - The legacy price fields on `ptApplication` (what the registration form once collected) are DERIVED from the
 *    live packages and never written back: the application keeps what the trainer said at registration, the
 *    packages are what is actually for sale.
 */
import { Prisma, PtRestrictionScope, SessionMode } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";

type Db = Pick<typeof prisma, "ptRestriction" | "userProfile">;

// ── visibility ────────────────────────────────────────────────────────────────────────────────

/** userIds with an open ACCOUNT-scope restriction (temporary suspension or ban). Small by nature. */
async function accountRestrictedPtIds(db: Db): Promise<string[]> {
  const rows = await db.ptRestriction.findMany({
    where: { endedAt: null, scope: PtRestrictionScope.ACCOUNT },
    select: { ptUserId: true },
  });
  return rows.map((r) => r.ptUserId);
}

/** The Prisma `where` every public trainer read starts from. */
export async function ptPublicWhere(db: Db = prisma): Promise<Prisma.UserProfileWhereInput> {
  const restricted = await accountRestrictedPtIds(db);
  return {
    isPT: true,
    ptSuspended: false,
    ptApplication: { is: { status: "APPROVED" } },
    ...(restricted.length > 0 ? { userId: { notIn: restricted } } : {}),
  };
}

/** True when this trainer id may be shown to the public (same rule as {@link ptPublicWhere}). */
export async function isPtPubliclyVisible(ptUserId: string, db: Db = prisma): Promise<boolean> {
  if (!ptUserId) return false;
  const where = await ptPublicWhere(db);
  const row = await db.userProfile.findFirst({ where: { AND: [where, { userId: ptUserId }] }, select: { userId: true } });
  return row !== null;
}

// ── what the public finders select ────────────────────────────────────────────────────────────

export const PT_PUBLIC_PACKAGE_SELECT = {
  id: true,
  ptUserId: true,
  name: true,
  description: true,
  sessionCount: true,
  price: true,
  sessionMode: true,
  sessionDurationMinutes: true,
  validityDays: true,
  isActive: true,
  archivedAt: true,
  version: true,
} satisfies Prisma.PTServicePackageSelect;

/** Packages that are for sale: active, not archived. */
export const PT_FOR_SALE_PACKAGES_ARGS = {
  where: { isActive: true, archivedAt: null },
  select: PT_PUBLIC_PACKAGE_SELECT,
  orderBy: [{ createdAt: "desc" }, { id: "asc" }],
} satisfies Prisma.UserProfile$servicePackagesArgs;

export const PT_PUBLIC_PROFILE_SELECT = {
  userId: true,
  firstName: true,
  lastName: true,
  photoUrl: true,
  specialties: true,
  isAcceptingClients: true,
  notAcceptingReason: true,
  searchCity: true,
  searchDistrict: true,
  searchWard: true,
  // Internal only (list ordering by "same gym"); the DTO does not emit it.
  gymId: true,
  ptApplication: {
    select: {
      serviceMode: true,
      operatingAreas: true,
      gymAffiliation: true,
      professionalBio: true,
      yearsOfExperience: true,
      educationBackground: true,
      previousWorkExperience: true,
      trainingMethodsApproach: true,
      targetClientGroups: true,
      primaryTrainingGoals: true,
      availableDays: true,
      availableFrom: true,
      availableUntil: true,
      // availableDays/From/Until are the legacy shape; availabilityBlocks is what the current form writes.
      availabilityBlocks: true,
      linkedinUrl: true,
      websiteUrl: true,
      mainSpecialties: true,
      languages: true,
      certificates: {
        select: {
          certificateName: true,
          issuingOrganization: true,
          isCurrentlyValid: true,
          certificationStatus: true,
          issueDate: true,
          expirationDate: true,
        },
      },
    },
  },
  trainingLocations: {
    where: { isActive: true },
    select: {
      id: true,
      gymName: true,
      addressLine: true,
      isPrimary: true,
      gymId: true,
      provinceCode: true,
      wardCode: true,
      province: { select: { name: true } },
      ward: { select: { name: true } },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  servicePackages: PT_FOR_SALE_PACKAGES_ARGS,
  physiquePhotos: {
    where: { status: "PUBLISHED" },
    select: { id: true, isCover: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.UserProfileSelect;

export type PtPublicRow = Prisma.UserProfileGetPayload<{ select: typeof PT_PUBLIC_PROFILE_SELECT }>;

declare const publishedBrand: unique symbol;
/**
 * A trainer row that came out of the public finders (visibility rule applied, PUBLISHED photos only).
 * The brand makes it a compile error to hand `toPublicPtDto` a raw `findUnique` row or a revision payload.
 */
export type PublishedPtSource = PtPublicRow & { readonly [publishedBrand]: true };

export function asPublishedPtSource(row: PtPublicRow): PublishedPtSource {
  return row as PublishedPtSource;
}

// ── price derivation (§12.13 item 1) ──────────────────────────────────────────────────────────

type PricedPackage = { price: Prisma.Decimal | number | string; sessionCount: number; sessionMode: SessionMode | string };

/** Per-session price rounded DOWN to 1,000 dong ("from X per session"). */
function floorTo1000(v: number): number {
  return Math.floor(v / 1000) * 1000;
}

export interface FromPrices {
  fromPricePerSession: number | null;
  fromPackagePrice: number | null;
}

/** min per-session price and min package price over a list of packages (null when the list is empty). */
export function computeFromPrices(packages: PricedPackage[]): FromPrices {
  const usable = packages.filter((p) => Number(p.price) > 0 && p.sessionCount >= 1);
  if (usable.length === 0) return { fromPricePerSession: null, fromPackagePrice: null };
  return {
    fromPricePerSession: floorTo1000(Math.min(...usable.map((p) => Number(p.price) / p.sessionCount))),
    fromPackagePrice: Math.min(...usable.map((p) => Number(p.price))),
  };
}

export function computeFromPricesByMode(packages: PricedPackage[]) {
  return {
    overall: computeFromPrices(packages),
    online: computeFromPrices(packages.filter((p) => p.sessionMode === SessionMode.ONLINE)),
    offline: computeFromPrices(packages.filter((p) => p.sessionMode === SessionMode.OFFLINE)),
  };
}

// ── the DTO ────────────────────────────────────────────────────────────────────────────────────

/** Extra, already-public numbers the controller attaches (ratings, discovery ranking). Allowlisted below. */
export interface PtPublicExtras {
  avgRating?: number | null;
  ratingCount?: number;
  availableSlotsNext28Days?: number;
  matchReason?: string | null;
}

export function toPublicPtPackageDto(p: {
  id: string;
  ptUserId: string;
  name: string;
  description: string | null;
  sessionCount: number;
  price: Prisma.Decimal | number | string;
  sessionMode: string;
  sessionDurationMinutes: number;
  validityDays: number | null;
  isActive: boolean;
  archivedAt: Date | null;
  version: number;
}) {
  return {
    id: p.id,
    ptUserId: p.ptUserId,
    name: p.name,
    description: p.description,
    sessionCount: p.sessionCount,
    price: p.price,
    sessionMode: p.sessionMode,
    sessionDurationMinutes: p.sessionDurationMinutes,
    validityDays: p.validityDays,
    isActive: p.isActive,
    archivedAt: p.archivedAt,
    version: p.version,
  };
}

export function toPublicPtDto(source: PublishedPtSource, extras: PtPublicExtras = {}) {
  const app = source.ptApplication;
  const packages = source.servicePackages;
  const prices = computeFromPricesByMode(packages);

  const photos = source.physiquePhotos.map((ph) => ({
    id: ph.id,
    url: `/media/pt-physique/${ph.id}`,
    isCover: ph.isCover,
    sortOrder: ph.sortOrder,
  }));
  const cover = photos.find((ph) => ph.isCover) ?? null;

  return {
    userId: source.userId,
    firstName: source.firstName,
    lastName: source.lastName,
    photoUrl: source.photoUrl,
    specialties: source.specialties,
    isAcceptingClients: source.isAcceptingClients,
    notAcceptingReason: source.notAcceptingReason,
    searchCity: source.searchCity,
    searchDistrict: source.searchDistrict,
    searchWard: source.searchWard,
    // Always false here: a suspended trainer is never in this DTO. Kept so old clients that read it keep working.
    ptSuspended: false,

    ptApplication: app
      ? {
          serviceMode: app.serviceMode,
          operatingAreas: app.operatingAreas,
          gymAffiliation: app.gymAffiliation,
          professionalBio: app.professionalBio,
          yearsOfExperience: app.yearsOfExperience,
          educationBackground: app.educationBackground,
          previousWorkExperience: app.previousWorkExperience,
          trainingMethodsApproach: app.trainingMethodsApproach,
          targetClientGroups: app.targetClientGroups,
          primaryTrainingGoals: app.primaryTrainingGoals,
          availableDays: app.availableDays,
          availableFrom: app.availableFrom,
          availableUntil: app.availableUntil,
          availabilityBlocks: app.availabilityBlocks,
          websiteUrl: app.websiteUrl,
          linkedinUrl: app.linkedinUrl,
          mainSpecialties: app.mainSpecialties,
          languages: app.languages,
          certificates: app.certificates.map((c) => ({
            certificateName: c.certificateName,
            issuingOrganization: c.issuingOrganization,
            isCurrentlyValid: c.isCurrentlyValid,
            certificationStatus: c.certificationStatus,
            issueDate: c.issueDate,
            expirationDate: c.expirationDate,
          })),
          // DEPRECATED price fields, kept so installed apps keep rendering a price. DERIVED from the live
          // packages (never stored): see the table in plan §12.13 item 1.
          desiredSessionPrice: prices.overall.fromPricePerSession,
          onlinePricePerSession: prices.online.fromPricePerSession,
          offlinePricePerSession: prices.offline.fromPricePerSession,
          onlinePackagePrice: prices.online.fromPackagePrice,
          offlinePackagePrice: prices.offline.fromPackagePrice,
          monthlyProgramPrice: null,
          packagePrice: null,
          sessionsPerPackage: null,
          additionalPricingNotes: null,
          fromPricePerSession: prices.overall.fromPricePerSession,
          fromPackagePrice: prices.overall.fromPackagePrice,
        }
      : null,

    trainingLocations: source.trainingLocations.map((l) => ({
      id: l.id,
      gymName: l.gymName,
      addressLine: l.addressLine,
      isPrimary: l.isPrimary,
      gymId: l.gymId,
      provinceCode: l.provinceCode,
      wardCode: l.wardCode,
      province: l.province ? { name: l.province.name } : null,
      ward: l.ward ? { name: l.ward.name } : null,
    })),

    servicePackages: packages.map(toPublicPtPackageDto),
    fromPricePerSession: prices.overall.fromPricePerSession,
    fromPackagePrice: prices.overall.fromPackagePrice,

    physiquePhotos: photos,
    coverPhotoUrl: cover ? cover.url : null,

    // Ratings / discovery ranking, attached by the controller.
    avgRating: extras.avgRating ?? null,
    ratingCount: extras.ratingCount ?? 0,
    ...(extras.availableSlotsNext28Days !== undefined ? { availableSlotsNext28Days: extras.availableSlotsNext28Days } : {}),
    ...(extras.matchReason !== undefined ? { matchReason: extras.matchReason } : {}),
  };
}

export type PublicPtDto = ReturnType<typeof toPublicPtDto>;

// ── price filter (list) ────────────────────────────────────────────────────────────────────────

/**
 * userIds with at least one package for sale whose PER-SESSION price (price / sessionCount) lies in
 * [minPrice, maxPrice]. With `sessionMode` ONLINE or OFFLINE only packages of that mode count; with HYBRID or
 * none any package does. A PT with no packages for sale matches no price filter.
 */
export async function findPtUserIdsWithSessionPriceIn(opts: {
  minPrice?: number;
  maxPrice?: number;
  sessionMode?: string;
}): Promise<string[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.is_active = true`, Prisma.sql`p.archived_at IS NULL`, Prisma.sql`p.session_count >= 1`];
  if (opts.minPrice !== undefined) conditions.push(Prisma.sql`(p.price / p.session_count) >= ${opts.minPrice}`);
  if (opts.maxPrice !== undefined) conditions.push(Prisma.sql`(p.price / p.session_count) <= ${opts.maxPrice}`);
  if (opts.sessionMode === "ONLINE" || opts.sessionMode === "OFFLINE") {
    conditions.push(Prisma.sql`p.session_mode = ${opts.sessionMode}::"SessionMode"`);
  }
  const rows = await prisma.$queryRaw<{ ptUserId: string }[]>(
    Prisma.sql`SELECT DISTINCT p.pt_user_id AS "ptUserId" FROM pt_service_packages p WHERE ${Prisma.join(conditions, " AND ")}`,
  );
  return rows.map((r) => r.ptUserId);
}
