import { PrismaClient } from "../generated/prisma";

export const prisma = new PrismaClient();

export const profileRepository = {
  findByUserId: (userId: string) =>
    prisma.userProfile.findUnique({ where: { userId } }),

  findByUserIds: (userIds: string[]) =>
    prisma.userProfile.findMany({ where: { userId: { in: userIds } } }),

  findByReferralCode: (code: string) =>
    prisma.userProfile.findUnique({ where: { referralCode: code } }),

  upsert: (userId: string, data: Record<string, any>) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { ...data, updatedAt: new Date() },
      create: { userId, ...data },
    }),

  setIsPT: (userId: string, isPT: boolean) =>
    prisma.userProfile.upsert({
      where: { userId },
      update: { isPT },
      create: { userId, isPT },
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

  /** List approved PTs with optional filters */
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
  ) => {
    // Compose ptApplication filter — always require APPROVED status
    const ptApplicationWhere: any = { status: "APPROVED" };

    // sessionMode filter
    if (filters.sessionMode === "OFFLINE") {
      ptApplicationWhere.serviceMode = { in: ["OFFLINE", "HYBRID"] };
    } else if (filters.sessionMode === "ONLINE") {
      ptApplicationWhere.serviceMode = { in: ["ONLINE", "HYBRID"] };
    } else if (filters.sessionMode === "HYBRID") {
      ptApplicationWhere.serviceMode = "HYBRID";
    }

    // Price filter — depends on sessionMode to avoid matching wrong price type
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceRange: any = {};
      if (filters.minPrice !== undefined) priceRange.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) priceRange.lte = filters.maxPrice;

      if (filters.sessionMode === "ONLINE") {
        ptApplicationWhere.onlinePricePerSession = priceRange;
      } else if (filters.sessionMode === "OFFLINE") {
        ptApplicationWhere.offlinePricePerSession = priceRange;
      } else {
        // No sessionMode (or HYBRID): match if any price fits
        ptApplicationWhere.OR = [
          { onlinePricePerSession: priceRange },
          { offlinePricePerSession: priceRange },
        ];
      }
    }

    // Compose UserProfile where
    //
    // `isPT` is the approval marker — it is set when an admin approves the application, and
    // it is what every other part of the system checks. Discovery used to ALSO require an
    // APPROVED PTApplication row to exist, which is an inner join on paperwork rather than on
    // status: lose those rows and every trainer vanishes from search while still looking
    // perfectly approved everywhere else. That is exactly what happened on 2026-08-11.
    //
    // The application filters below still apply when they narrow something (service mode,
    // price band), but as an OPTIONAL relation — a trainer without the paperwork row is
    // discoverable, a trainer whose paperwork contradicts the filter is not.
    const profileWhere: any = {
      isPT: true,
      // A suspended trainer (account disabled by an admin) must not be discoverable —
      // their contracts have already been unwound and refunded.
      ptSuspended: false,
    };

    // Only constrain on the application when the caller actually asked for something it
    // holds; `{ status: 'APPROVED' }` alone is not a narrowing filter, it is the join.
    const hasApplicationFilter = Object.keys(ptApplicationWhere).length > 1;
    if (hasApplicationFilter) {
      profileWhere.ptApplication = { is: ptApplicationWhere };
    }

    // q: search by firstName OR lastName or search fields
    if (filters.q) {
      // `q` reaches the trainer's name, and the gym/address they work at. Specialty is left
      // to the chips beside the box — see findPtUserIdsMatchingText. The extra ids are
      // resolved in one accent-insensitive SQL pass and folded into the same OR, so paging
      // stays correct.
      const textMatchIds = await findPtUserIdsMatchingText(filters.q);
      profileWhere.OR = [
        ...(textMatchIds.length > 0 ? [{ userId: { in: textMatchIds } }] : []),
        { firstName: { contains: filters.q, mode: "insensitive" } },
        { lastName: { contains: filters.q, mode: "insensitive" } },
        { firstNameNormalized: { contains: filters.q, mode: "insensitive" } },
        { lastNameNormalized: { contains: filters.q, mode: "insensitive" } },
      ];
    }

    if (filters.searchCity) {
      profileWhere.searchCity = filters.searchCity;
    }
    if (filters.searchDistrict) {
      profileWhere.searchDistrict = filters.searchDistrict;
    }
    if (filters.gymId) {
      profileWhere.gymId = filters.gymId;
    }
    if (filters.specialties && filters.specialties.length > 0) {
      profileWhere.specialties = { hasSome: filters.specialties };
    }

    // Location filter via trainingLocations relation
    if (filters.provinceCode || filters.wardCode) {
      const locWhere: any = { isActive: true };
      if (filters.provinceCode) locWhere.provinceCode = filters.provinceCode;
      if (filters.wardCode) locWhere.wardCode = filters.wardCode;
      profileWhere.trainingLocations = { some: locWhere };
    }

    // Sorting — sort price by relevant price type
    let orderBy: any = { createdAt: "desc" };
    if (filters.sortBy === "priceAsc") {
      orderBy =
        filters.sessionMode === "OFFLINE"
          ? { ptApplication: { offlinePricePerSession: "asc" } }
          : { ptApplication: { onlinePricePerSession: "asc" } }; // MVP: sort by onlinePrice when mode not specified
    } else if (filters.sortBy === "priceDesc") {
      orderBy =
        filters.sessionMode === "OFFLINE"
          ? { ptApplication: { offlinePricePerSession: "desc" } }
          : { ptApplication: { onlinePricePerSession: "desc" } };
    } else if (filters.sortBy === "nameAsc") {
      orderBy = { firstName: "asc" };
    }

    const take = filters.limit ?? 50;
    const skip = filters.page ? (filters.page - 1) * take : 0;

    const ptApplicationSelect = {
      status: true,
      serviceMode: true,
      operatingAreas: true,
      gymAffiliation: true,
      desiredSessionPrice: true,
      packagePrice: true,
      sessionsPerPackage: true,
      monthlyProgramPrice: true,
      additionalPricingNotes: true,
      onlinePricePerSession: true,
      offlinePricePerSession: true,
      onlinePackagePrice: true,
      offlinePackagePrice: true,
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
      portfolioUrl: true,
      linkedinUrl: true,
      websiteUrl: true,
      socialLinks: true,
      mainSpecialties: true,
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
      // NOT included: residenceAddressLine, residenceProvinceCode, residenceWardCode, applicationTrainingLocations
    };

    const baseArgs = {
      where: profileWhere,
      orderBy,
      take,
      skip,
    };

    try {
      return await prisma.userProfile.findMany({
        ...baseArgs,
        include: {
          trainingLocations: {
            where: { isActive: true },
            include: {
              province: { select: { name: true } },
              ward: { select: { name: true } },
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
          ptApplication: { select: ptApplicationSelect },
        },
      });
    } catch (error: any) {
      const message = String(error?.message || "");
      const trainingLocationMismatch =
        message.includes("trainingLocations") ||
        message.includes("pt_training_locations") ||
        message.includes("Unknown field") ||
        message.includes("Unknown argument") ||
        message.includes("does not exist");

      if (!trainingLocationMismatch) {
        throw error;
      }

      const fallbackWhere: any = { ...profileWhere };
      delete fallbackWhere.trainingLocations;

      return prisma.userProfile.findMany({
        ...baseArgs,
        where: fallbackWhere,
        include: {
          ptApplication: { select: ptApplicationSelect },
        },
      });
    }
  },

  findPTApplicationByUserId: (userId: string) =>
    prisma.pTApplication.findFirst({
      where: {
        userProfile: { userId },
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
