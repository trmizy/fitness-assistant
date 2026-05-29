import { PrismaClient } from '../generated/prisma';

export const prisma = new PrismaClient();

export const profileRepository = {
  findByUserId: (userId: string) =>
    prisma.userProfile.findUnique({ where: { userId } }),

  findByUserIds: (userIds: string[]) =>
    prisma.userProfile.findMany({ where: { userId: { in: userIds } } }),

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

  /** List approved PTs with optional filters */
  findPTs: (filters: {
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    sessionMode?: string;
    provinceCode?: number;
    wardCode?: number;
    sortBy?: string;
    page?: number;
    limit?: number;
  } = {}) => {
    // Compose ptApplication filter — always require APPROVED status
    const ptApplicationWhere: any = { status: 'APPROVED' };

    // sessionMode filter
    if (filters.sessionMode === 'OFFLINE') {
      ptApplicationWhere.serviceMode = { in: ['OFFLINE', 'HYBRID'] };
    } else if (filters.sessionMode === 'ONLINE') {
      ptApplicationWhere.serviceMode = { in: ['ONLINE', 'HYBRID'] };
    } else if (filters.sessionMode === 'HYBRID') {
      ptApplicationWhere.serviceMode = 'HYBRID';
    }

    // Price filter — depends on sessionMode to avoid matching wrong price type
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceRange: any = {};
      if (filters.minPrice !== undefined) priceRange.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) priceRange.lte = filters.maxPrice;

      if (filters.sessionMode === 'ONLINE') {
        ptApplicationWhere.onlinePricePerSession = priceRange;
      } else if (filters.sessionMode === 'OFFLINE') {
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
    const profileWhere: any = {
      isPT: true,
      ptApplication: { is: ptApplicationWhere },
    };

    // q: search by firstName OR lastName
    if (filters.q) {
      profileWhere.OR = [
        { firstName: { contains: filters.q, mode: 'insensitive' } },
        { lastName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    // Location filter via trainingLocations relation
    if (filters.provinceCode || filters.wardCode || filters.sessionMode === 'OFFLINE' || filters.sessionMode === 'HYBRID') {
      const locWhere: any = { isActive: true };
      if (filters.provinceCode) locWhere.provinceCode = filters.provinceCode;
      if (filters.wardCode) locWhere.wardCode = filters.wardCode;
      profileWhere.trainingLocations = { some: locWhere };
    }

    // Sorting — sort price by relevant price type
    let orderBy: any = { createdAt: 'desc' };
    if (filters.sortBy === 'priceAsc') {
      orderBy = filters.sessionMode === 'OFFLINE'
        ? { ptApplication: { offlinePricePerSession: 'asc' } }
        : { ptApplication: { onlinePricePerSession: 'asc' } }; // MVP: sort by onlinePrice when mode not specified
    } else if (filters.sortBy === 'priceDesc') {
      orderBy = filters.sessionMode === 'OFFLINE'
        ? { ptApplication: { offlinePricePerSession: 'desc' } }
        : { ptApplication: { onlinePricePerSession: 'desc' } };
    } else if (filters.sortBy === 'nameAsc') {
      orderBy = { firstName: 'asc' };
    }

    const take = filters.limit ?? 50;
    const skip = filters.page ? (filters.page - 1) * take : 0;

    return prisma.userProfile.findMany({
      where: profileWhere,
      orderBy,
      take,
      skip,
      include: {
        trainingLocations: {
          where: { isActive: true },
          include: {
            province: { select: { name: true } },
            ward: { select: { name: true } },
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        ptApplication: {
          select: {
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
          },
        },
      },
    });
  },

  findPTApplicationByUserId: (userId: string) =>
    prisma.pTApplication.findFirst({
      where: {
        userProfile: { userId }
      }
    }),

  deleteByUserId: (userId: string) =>
    prisma.userProfile.delete({ where: { userId } }),
};
