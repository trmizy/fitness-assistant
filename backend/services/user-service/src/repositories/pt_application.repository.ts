import { PrismaClient, PTApplicationStatus } from '../generated/prisma';

const prisma = new PrismaClient();

// Whitelist of fields the applicant can write via saveDraft
const WRITABLE_FIELDS = new Set([
  'phoneNumber', 'nationalIdNumber', 'currentAddress',
  'idCardFrontUrl', 'idCardBackUrl', 'portraitPhotoUrl',
  'yearsOfExperience', 'educationBackground', 'previousWorkExperience', 'professionalBio',
  'mainSpecialties', 'targetClientGroups', 'primaryTrainingGoals', 'trainingMethodsApproach',
  'portfolioUrl', 'linkedinUrl', 'websiteUrl', 'socialLinks',
  'availabilityNotes', 'availableTimeSlots', 'serviceMode', 'operatingAreas',
  'desiredSessionPrice', 'availableDays', 'availableFrom', 'availableUntil',
  'gymAffiliation', 'packagePrice', 'monthlyProgramPrice', 'additionalPricingNotes',
  'otherReferences',
]);

const CERT_WRITABLE_FIELDS = new Set([
  'certificateName', 'issuingOrganization', 'isCurrentlyValid',
  'certificationStatus', 'issueDate', 'expirationDate', 'certificateFileUrl',
]);

const MEDIA_WRITABLE_FIELDS = new Set([
  'groupType', 'fileUrl', 'label',
]);

function pickFields(obj: Record<string, any>, allowed: Set<string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of allowed) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

function sanitizeCert(c: any): Record<string, any> {
  const clean = pickFields(c, CERT_WRITABLE_FIELDS);
  // Convert empty date strings to null for Prisma DateTime fields
  if (clean.issueDate === '') clean.issueDate = null;
  if (clean.expirationDate === '') clean.expirationDate = null;
  return clean;
}

export const ptApplicationRepository = {
  findByUserId: async (userId: string) => {
    return prisma.pTApplication.findFirst({
      where: { userProfile: { userId } },
      include: {
        certificates: true,
        media: true,
      },
    });
  },

  findById: async (id: string) => {
    return prisma.pTApplication.findUnique({
      where: { id },
      include: {
        certificates: true,
        media: true,
        userProfile: true,
      },
    });
  },

  upsertDraft: async (userProfileId: string, data: any) => {
    const { certificates, media, ...raw } = data;
    const baseData = pickFields(raw, WRITABLE_FIELDS);

    return prisma.$transaction(async (tx) => {
      const application = await tx.pTApplication.upsert({
        where: { userProfileId },
        update: {
          ...baseData,
          updatedAt: new Date(),
        },
        create: {
          userProfileId,
          ...baseData,
          status: PTApplicationStatus.DRAFT,
        },
      });

      // Handle certificates if provided
      if (certificates) {
        await tx.pTApplicationCertificate.deleteMany({
          where: { applicationId: application.id },
        });
        const validCerts = certificates
          .map(sanitizeCert)
          .filter((c: any) => c.certificateName); // skip empty rows
        if (validCerts.length > 0) {
          await tx.pTApplicationCertificate.createMany({
            data: validCerts.map((c: any) => ({
              ...c,
              applicationId: application.id,
            })),
          });
        }
      }

      // Handle media if provided
      if (media) {
        await tx.pTApplicationMedia.deleteMany({
          where: { applicationId: application.id },
        });
        const validMedia = media
          .map((m: any) => pickFields(m, MEDIA_WRITABLE_FIELDS))
          .filter((m: any) => m.fileUrl); // skip empty entries
        if (validMedia.length > 0) {
          await tx.pTApplicationMedia.createMany({
            data: validMedia.map((m: any) => ({
              ...m,
              applicationId: application.id,
            })),
          });
        }
      }

      return tx.pTApplication.findUnique({
        where: { id: application.id },
        include: { certificates: true, media: true },
      });
    });
  },

  updateStatus: async (id: string, status: PTApplicationStatus, extra: any = {}) => {
    return prisma.pTApplication.update({
      where: { id },
      data: {
        status,
        ...extra,
        updatedAt: new Date(),
      },
    });
  },

  findAll: async (filters: { status?: PTApplicationStatus; search?: string }) => {
    const { status, search } = filters;
    return prisma.pTApplication.findMany({
      where: {
        ...(status && { status }),
        ...(search && {
          OR: [
            { phoneNumber: { contains: search } },
            { professionalBio: { contains: search, mode: 'insensitive' as const } },
          ],
        }),
      },
      include: {
        userProfile: true,
        certificates: true,
        media: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  },
};
