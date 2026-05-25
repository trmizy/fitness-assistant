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

  /** List users where isPT = true, including approved PT application data */
  findPTs: () =>
    prisma.userProfile.findMany({
      where: { isPT: true },
      include: {
        ptApplication: {
          select: {
            // Service info
            serviceMode: true,
            operatingAreas: true,
            gymAffiliation: true,
            // Pricing (legacy + new ONLINE/OFFLINE)
            desiredSessionPrice: true,
            packagePrice: true,
            sessionsPerPackage: true,
            monthlyProgramPrice: true,
            additionalPricingNotes: true,
            onlinePricePerSession: true,
            offlinePricePerSession: true,
            onlinePackagePrice: true,
            offlinePackagePrice: true,
            // Professional profile (public)
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
          },
        },
      },
    }),

  findPTApplicationByUserId: (userId: string) =>
    prisma.pTApplication.findFirst({
      where: {
        userProfile: { userId }
      }
    }),

  deleteByUserId: (userId: string) =>
    prisma.userProfile.delete({ where: { userId } }),
};
