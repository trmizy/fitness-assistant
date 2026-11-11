import { PrismaClient } from "../generated/prisma";
import { computeStartingWeightPatch } from "./profile-starting-weight.util";
// Circular on purpose: pt-public-dto.ts and pt-discovery.query.ts need `prisma` from here,
// this file uses their functions at call time (never at module load), so the cycle is safe.
import {
  PT_PUBLIC_PROFILE_SELECT,
  asPublishedPtSource,
  ptPublicWhere,
  type PublishedPtSource,
} from "../services/pt-public-dto";
import {
  findDiscoveryPtPageIds,
  searchDiscoveryPtPageIds,
  type PtDiscoveryQueryFilters,
  type PtSearchPageItem,
  type PtSearchQueryInput,
  type PtSearchQueryOptions,
} from "../services/pt-discovery.query";
import type { DiscoveryScope } from "../services/pt-discovery-cursor";

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
   * restriction - see ptPublicWhere) with global SQL filtering, global SQL sorting, and pagination.
   *
   * Reads through `select`, never `include`: only the columns in PT_PUBLIC_PROFILE_SELECT leave the
   * database, so a column added to UserProfile later cannot leak into discovery by accident. The rows are
   * `PublishedPtSource` - the only input toPublicPtDto accepts.
   */
  /** Hydrates public PT rows in the exact ID order produced by discovery SQL. */
  hydratePublicPtsByIds: async (userIds: string[]): Promise<PublishedPtSource[]> => {
    if (userIds.length === 0) return [];
    const rows = await prisma.userProfile.findMany({
      where: { userId: { in: userIds } },
      select: PT_PUBLIC_PROFILE_SELECT,
    });
    const byUserId = new Map(rows.map((r) => [r.userId, asPublishedPtSource(r)]));
    return userIds
      .map((id) => byUserId.get(id))
      .filter((r): r is PublishedPtSource => r !== undefined);
  },

  findPTsPaged: async (
    filters: PtDiscoveryQueryFilters = {},
  ): Promise<{ pts: PublishedPtSource[]; hasMore: boolean }> => {
    const { userIds, hasMore } = await findDiscoveryPtPageIds(filters);
    const pts = await profileRepository.hydratePublicPtsByIds(userIds);
    return { pts, hasMore };
  },

  searchPTsCursor: async (
    input: PtSearchQueryInput = {},
    options: PtSearchQueryOptions = {},
  ): Promise<{
    pts: PublishedPtSource[];
    metaByUserId: Map<string, PtSearchPageItem>;
    nextCursor: string | null;
    hasMore: boolean;
    appliedScope: DiscoveryScope;
  }> => {
    const result = await searchDiscoveryPtPageIds(input, options);
    const pts = await profileRepository.hydratePublicPtsByIds(result.items.map((item) => item.userId));
    const metaByUserId = new Map(result.items.map((item) => [item.userId, item]));
    return { pts, metaByUserId, nextCursor: result.nextCursor, hasMore: result.hasMore, appliedScope: result.appliedScope };
  },

  findPTs: async (filters: PtDiscoveryQueryFilters = {}): Promise<PublishedPtSource[]> => {
    const { pts } = await profileRepository.findPTsPaged(filters);
    return pts;
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
