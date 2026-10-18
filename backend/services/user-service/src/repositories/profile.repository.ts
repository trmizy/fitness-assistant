import { Prisma, PrismaClient } from "../generated/prisma";
import { computeStartingWeightPatch } from "./profile-starting-weight.util";
// Circular on purpose: pt-public-dto.ts needs `prisma` from here, this file needs the public-visibility rule from
// there. Both only use the other's exports inside functions (never at module load), so the cycle is safe.
import {
  PT_PUBLIC_PROFILE_SELECT,
  asPublishedPtSource,
  findPtUserIdsWithSessionPriceIn,
  ptPublicWhere,
  type PublishedPtSource,
} from "../services/pt-public-dto";

export const prisma = new PrismaClient();

export const profileRepository = {
  findByUserId: (userId: string) =>
    prisma.userProfile.findUnique({ where: { userId } }),

  findByUserIds: (userIds: string[]) =>
    prisma.userProfile.findMany({ where: { userId: { in: userIds } } }),

  findByReferralCode: (code: string) =>
    prisma.userProfile.findUnique({ where: { referralCode: code } }),

  /**
   * The single choke point every profile field write goes through (direct
   * PATCH /profile edits AND the InBody→profile currentWeight sync both call
   * this) — so the "journey start" rule lives here once, not duplicated per
   * caller: the first time ANY write ever sets a non-null `currentWeight`
   * for a profile that has no `startingWeight` yet, that same value is also
   * captured as the immutable `startingWeight`. Every write after that
   * leaves `startingWeight` untouched — it is a set-once field. `source`
   * lets each caller say whether it was set via onboarding/manual edit or
   * via an InBody sync, purely for audit/display; it does not change the
   * set-once behavior. See UserProfile.startingWeight in schema.prisma.
   *
   * `targetWeight` is never touched by this logic — it only ever changes
   * when a caller explicitly includes it in `data` (i.e. only on a real
   * user/PT-driven goal edit), which was already true before this change.
   */
  upsert: async (
    userId: string,
    data: Record<string, any>,
    options?: { source?: "ONBOARDING" | "INBODY" },
  ) => {
    const patch = { ...data };
    const existing = await prisma.userProfile.findUnique({
      where: { userId },
      select: { startingWeight: true },
    });
    const startingWeightPatch = computeStartingWeightPatch({
      existingStartingWeight: existing?.startingWeight,
      incomingCurrentWeight: patch.currentWeight,
      source: options?.source ?? "ONBOARDING",
    });
    if (startingWeightPatch) Object.assign(patch, startingWeightPatch);
    return prisma.userProfile.upsert({
      where: { userId },
      update: { ...patch, updatedAt: new Date() },
      create: { userId, ...patch },
    });
  },

  setIsPT: (userId: string, isPT: boolean) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { isPT },
      create: { userId, isPT },
    }),

  /** Fills the name columns ONLY while both are still empty — never overwrites what the user or
   * a seed already put there. See profileName.util.ts for why they matter (name search). */
  backfillNames: (
    userId: string,
    names: { firstName: string | null; lastName: string | null; firstNameNormalized: string | null; lastNameNormalized: string | null },
  ) =>
    prisma.userProfile.updateMany({
      where: { userId, firstName: null, lastName: null },
      data: names,
    }),

  setIsPTByUserId: (userId: string, isPT: boolean) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { isPT, updatedAt: new Date() },
      create: { userId, isPT },
    }),

  updateAcceptingClients: (userId: string, isAcceptingClients: boolean, notAcceptingReason?: string) =>
    prisma.userProfile.update({
      where: { userId },
      data: { isAcceptingClients, notAcceptingReason: isAcceptingClients ? null : notAcceptingReason },
    }),

  /**
   * List the PUBLICLY VISIBLE trainers (isPT + APPROVED application + not suspended + no ACCOUNT-scope
   * restriction - see ptPublicWhere) with optional filters.
   *
   * Reads through `select`, never `include`: only the columns in PT_PUBLIC_PROFILE_SELECT leave the
   * database, so a column added to UserProfile later cannot leak into discovery by accident. The rows are
   * `PublishedPtSource` - the only input toPublicPtDto accepts.
   *
   * The price filter is over the PER-SESSION price of the packages for sale (price / sessionCount): a trainer
   * matches when at least one package lies in the range (of the requested mode, when one is given). The legacy
   * ptApplication.*PricePerSession columns are registration history and play no part any more.
   */
  findPTs: async (
    filters: {
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
      page?: number;
      limit?: number;
    } = {},
  ): Promise<PublishedPtSource[]> => {
    const and: Prisma.UserProfileWhereInput[] = [await ptPublicWhere()];

    // sessionMode filter: the trainer's declared service mode (HYBRID trainers serve both).
    if (filters.sessionMode === "OFFLINE") {
      and.push({ ptApplication: { is: { serviceMode: { in: ["OFFLINE", "HYBRID"] } } } });
    } else if (filters.sessionMode === "ONLINE") {
      and.push({ ptApplication: { is: { serviceMode: { in: ["ONLINE", "HYBRID"] } } } });
    } else if (filters.sessionMode === "HYBRID") {
      and.push({ ptApplication: { is: { serviceMode: "HYBRID" } } });
    }

    // Price filter: >= 1 package for sale with a per-session price in range. Nobody without packages matches.
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const ids = await findPtUserIdsWithSessionPriceIn({
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        sessionMode: filters.sessionMode,
      });
      and.push({ userId: { in: ids } });
    }

    // q: search by firstName OR lastName or search fields
    if (filters.q) {
      // `q` reaches the trainer's name, and the gym/address they work at. Specialty is left
      // to the chips beside the box - see findPtUserIdsMatchingText. The extra ids are
      // resolved in one accent-insensitive SQL pass and folded into the same OR, so paging
      // stays correct.
      const textMatchIds = await findPtUserIdsMatchingText(filters.q);
      and.push({
        OR: [
          ...(textMatchIds.length > 0 ? [{ userId: { in: textMatchIds } }] : []),
          { firstName: { contains: filters.q, mode: "insensitive" as const } },
          { lastName: { contains: filters.q, mode: "insensitive" as const } },
          { firstNameNormalized: { contains: filters.q, mode: "insensitive" as const } },
          { lastNameNormalized: { contains: filters.q, mode: "insensitive" as const } },
        ],
      });
    }

    if (filters.searchCity) and.push({ searchCity: filters.searchCity });
    if (filters.searchDistrict) and.push({ searchDistrict: filters.searchDistrict });
    if (filters.gymId) and.push({ gymId: filters.gymId });
    if (filters.specialties && filters.specialties.length > 0) {
      and.push({ specialties: { hasSome: filters.specialties } });
    }

    // Location filter via trainingLocations relation
    if (filters.provinceCode || filters.wardCode) {
      const locWhere: Prisma.PTTrainingLocationWhereInput = { isActive: true };
      if (filters.provinceCode) locWhere.provinceCode = filters.provinceCode;
      if (filters.wardCode) locWhere.wardCode = filters.wardCode;
      and.push({ trainingLocations: { some: locWhere } });
    }

    // Sorting. Price and rating order cannot be expressed here (price is derived from the packages, the
    // rating is aggregated from session_reviews), so the controller sorts those in memory.
    const orderBy: Prisma.UserProfileOrderByWithRelationInput =
      filters.sortBy === "nameAsc" ? { firstName: "asc" } : { createdAt: "desc" };

    const take = filters.limit ?? 50;
    const skip = filters.page ? (filters.page - 1) * take : 0;

    const rows = await prisma.userProfile.findMany({
      where: { AND: and },
      orderBy,
      take,
      skip,
      select: PT_PUBLIC_PROFILE_SELECT,
    });
    return rows.map(asPublishedPtSource);
  },

  /** One publicly visible trainer, or null when the id is unknown OR the trainer is not visible (same rule as the list). */
  findPublicPtByUserId: async (userId: string): Promise<PublishedPtSource | null> => {
    const where = await ptPublicWhere();
    const row = await prisma.userProfile.findFirst({
      where: { AND: [where, { userId }] },
      select: PT_PUBLIC_PROFILE_SELECT,
    });
    return row ? asPublishedPtSource(row) : null;
  },

  findPTApplicationByUserId: (userId: string) =>
    prisma.pTApplication.findFirst({
      where: {
        userProfile: { userId },
      },
    }),

  findPtMarketplaceEligibilityByUserId: (userId: string) =>
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
        isPT: true,
        firstName: true,
        lastName: true,
        ptApplication: {
          select: {
            status: true,
            approvedAt: true,
            mainSpecialties: true,
            yearsOfExperience: true,
            professionalBio: true,
          },
        },
      },
    }),

  deleteByUserId: (userId: string) =>
    prisma.userProfile.delete({ where: { userId } }),
};

/**
 * userIds whose gym name or address matches a free-text query, ignoring Vietnamese diacritics.
 *
 * Deliberately NOT specialties, even though VĐ5.3 lists them: the discovery page puts a row
 * of specialty chips directly beside this box, so typing one is a slower way to do what a
 * click already does, and a search box that quietly matches on several fields makes its own
 * results hard to explain. Gym name and address stay because no filter covers them — "the
 * trainer at California Fitness" has nowhere else to be expressed.
 *
 * Done in SQL rather than in JS because pulling every trainer into memory to filter them is
 * exactly the mistake VĐ5.2 was raised to fix.
 *
 * `translate()` strips the accents. Postgres ships `unaccent` for this, but it is an
 * extension that has to be installed on every environment, and a missing extension here
 * would silently return nothing rather than fail loudly. translate() is built in.
 */
const VN_FROM = "áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ";
const VN_TO = "aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy";

export async function findPtUserIdsMatchingText(q: string): Promise<string[]> {
  const needle = `%${q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()}%`;

  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT p."userId"
    FROM user_profiles p
    LEFT JOIN pt_training_locations l ON l.pt_user_id = p."userId"
    WHERE
      translate(lower(COALESCE(l.gym_name, '')),    ${VN_FROM}, ${VN_TO}) LIKE ${needle}
      OR translate(lower(COALESCE(l.address_line, '')), ${VN_FROM}, ${VN_TO}) LIKE ${needle}`;

  return rows.map((r) => r.userId);
}
