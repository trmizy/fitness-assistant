import { PrismaClient, PTApplicationStatus } from "../generated/prisma";
import { canonicalizePtDocumentUrl } from "../utils/ptDocumentUrl.util";
import { normalizeCertDate } from "../utils/ptCertDate.util";

const prisma = new PrismaClient();

// Whitelist of fields the applicant can write via saveDraft
const WRITABLE_FIELDS = new Set([
  "phoneNumber",
  "nationalIdNumber",
  "currentAddress",
  "idCardFrontUrl",
  "idCardBackUrl",
  "portraitPhotoUrl",
  "yearsOfExperience",
  "educationBackground",
  "previousWorkExperience",
  "professionalBio",
  "mainSpecialties",
  "targetClientGroups",
  "primaryTrainingGoals",
  "trainingMethodsApproach",
  "portfolioUrl",
  "linkedinUrl",
  "websiteUrl",
  "socialLinks",
  "availabilityNotes",
  "availableTimeSlots",
  "serviceMode",
  "operatingAreas",
  "desiredSessionPrice",
  "availableDays",
  "availableFrom",
  "availableUntil",
  "gymAffiliation",
  "packagePrice",
  "sessionsPerPackage",
  "monthlyProgramPrice",
  "additionalPricingNotes",
  "onlinePricePerSession",
  "offlinePricePerSession",
  "onlinePackagePrice",
  "offlinePackagePrice",
  "otherReferences",
  "availabilityBlocks",
  "sessionDurationMinutes",
  // Location fields
  "residenceProvinceCode",
  "residenceWardCode",
  "residenceAddressLine",
  "residenceLegacyDistrictName",
  "applicationTrainingLocations",
]);

const CERT_WRITABLE_FIELDS = new Set([
  "certificateName",
  "issuingOrganization",
  "isCurrentlyValid",
  "certificationStatus",
  "issueDate",
  "expirationDate",
  "certificateFileUrl",
]);

const MEDIA_WRITABLE_FIELDS = new Set(["groupType", "fileUrl", "label"]);

function pickFields(
  obj: Record<string, any>,
  allowed: Set<string>,
): Record<string, any> {
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
  // Prisma DateTime fields: "" → null, bare "YYYY-MM-DD" → Date (raw strings were rejected)
  if ("issueDate" in clean) clean.issueDate = normalizeCertDate(clean.issueDate, "Ngày cấp chứng chỉ");
  if ("expirationDate" in clean) clean.expirationDate = normalizeCertDate(clean.expirationDate, "Ngày hết hạn chứng chỉ");
  if (clean.certificateFileUrl) clean.certificateFileUrl = canonicalizePtDocumentUrl(clean.certificateFileUrl);
  return clean;
}

export type AdminListFilters = {
  status?: PTApplicationStatus;
  search?: string;
  /**
   * FIX5-ADMIN-PERF: applicant name / email search — what the admin list search box means. Every word typed must
   * match the first name, last name or email, case- and accent-insensitive ("nguyen minh" finds "Nguyễn Minh Khoa").
   */
  q?: string;
  /** "oldest": the review queue order (earliest submitted first); default newest first. */
  order?: "oldest";
};

/** Lower-case + strip Vietnamese diacritics (the form user_profiles.first_name_normalized / last_name_normalized store). */
function foldWord(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

function adminListWhere(filters: AdminListFilters) {
  const { status, search } = filters;
  const words = (typeof filters.q === "string" ? filters.q : "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return {
    ...(status && { status }),
    ...(words.length > 0 && {
      AND: words.map((w) => {
        const f = foldWord(w);
        return {
          userProfile: {
            OR: [
              { firstNameNormalized: { contains: f } },
              { lastNameNormalized: { contains: f } },
              { firstName: { contains: w, mode: "insensitive" as const } },
              { lastName: { contains: w, mode: "insensitive" as const } },
              { email: { contains: w, mode: "insensitive" as const } },
            ],
          },
        };
      }),
    }),
    ...(search && {
      OR: [
        { phoneNumber: { contains: search } },
        {
          professionalBio: {
            contains: search,
            mode: "insensitive" as const,
          },
        },
      ],
    }),
  };
}

export const ptApplicationRepository = {
  /** Q1: how many PT_APPLICATION_REJECTED audit rows this applicant has (entityType PT_PROFILE, entityId = userId). */
  countRejectionAudits: (userId: string, action: string) =>
    prisma.auditLog.count({ where: { entityType: "PT_PROFILE", entityId: userId, action } }),

  /** Q1: one durable row per rejection; throws on failure (the caller must not change the status then). */
  recordRejectionAudit: (a: {
    action: string;
    reviewerUserId: string;
    applicantUserId: string;
    applicationId: string;
    rejectionReason?: string;
  }) =>
    prisma.auditLog.create({
      data: {
        actorUserId: a.reviewerUserId,
        action: a.action,
        entityType: "PT_PROFILE",
        entityId: a.applicantUserId,
        metadata: { applicationId: a.applicationId, rejectionReason: a.rejectionReason ?? null },
      },
    }),

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

  /**
   * Reverse lookup for the authenticated document-serving endpoint: given a
   * stored document filename, find the application (and its owning auth
   * userId) that actually owns it — across every URL-holding field (id card
   * front/back, portrait, certificate files, other media). Returns null if
   * no application references this filename, which the caller must treat as
   * "not found" (never leak whether a filename exists to a non-owner).
   */
  findOwnerByDocumentFilename: async (filename: string) => {
    const url = `/uploads/pt-applications/${filename}`;
    return prisma.pTApplication.findFirst({
      where: {
        OR: [
          { idCardFrontUrl: url },
          { idCardBackUrl: url },
          { portraitPhotoUrl: url },
          { certificates: { some: { certificateFileUrl: url } } },
          { media: { some: { fileUrl: url } } },
        ],
      },
      include: { userProfile: true },
    });
  },

  upsertDraft: async (userProfileId: string, data: any) => {
    const { certificates, media, ...raw } = data;
    const baseData = pickFields(raw, WRITABLE_FIELDS);
    // Canonicalize before persisting — see canonicalizePtDocumentUrl's doc
    // comment: the client may echo back a signed (time-limited) document
    // link it received from a previous read; this must never be stored as-is.
    for (const field of ["idCardFrontUrl", "idCardBackUrl", "portraitPhotoUrl"] as const) {
      if (field in baseData) baseData[field] = canonicalizePtDocumentUrl(baseData[field]);
    }

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

      // Sync search fields to UserProfile
      const profileUpdate: any = {};
      if (baseData.mainSpecialties) {
        profileUpdate.specialties = baseData.mainSpecialties;
      }
      
      const locs = baseData.applicationTrainingLocations;
      if (locs && Array.isArray(locs) && locs.length > 0) {
        const primary = locs.find((l: any) => l.isPrimary) || locs[0];
        if (primary) {
          if (primary.provinceCode) profileUpdate.searchCity = primary.provinceCode.toString();
          if (primary.wardCode) profileUpdate.searchWard = primary.wardCode.toString();
          if (primary.legacyDistrictName) profileUpdate.searchDistrict = primary.legacyDistrictName;
          if (primary.gymId) profileUpdate.gymId = primary.gymId;
        }
      }

      if (Object.keys(profileUpdate).length > 0) {
        await tx.userProfile.update({
          where: { id: userProfileId },
          data: profileUpdate,
        });
      }

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
          .map((m: any) => (m.fileUrl ? { ...m, fileUrl: canonicalizePtDocumentUrl(m.fileUrl) } : m))
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

  updateStatus: async (
    id: string,
    status: PTApplicationStatus,
    extra: any = {},
  ) => {
    return prisma.pTApplication.update({
      where: { id },
      data: {
        status,
        ...extra,
        updatedAt: new Date(),
      },
    });
  },

  /**
   * `paging` is optional: without it every row comes back exactly as before. With it the same ordering is
   * sliced (skip/take), plus `id` as a tie-breaker so two rows with the same submittedAt (or none) cannot
   * swap between pages.
   */
  findAll: async (
    filters: AdminListFilters,
    paging?: { page: number; limit: number },
  ) => {
    return prisma.pTApplication.findMany({
      where: adminListWhere(filters),
      include: {
        userProfile: true,
        certificates: true,
        media: true,
      },
      orderBy:
        filters.order === "oldest"
          ? [{ submittedAt: "asc" as const }, { id: "asc" as const }]
          : paging
            ? [{ submittedAt: "desc" as const }, { id: "asc" as const }]
            : { submittedAt: "desc" as const },
      ...(paging ? { skip: (paging.page - 1) * paging.limit, take: paging.limit } : {}),
    });
  },

  /** Total rows matching the same filters as findAll (for the X-Total-Count header of a paged list). */
  countAll: async (filters: AdminListFilters) =>
    prisma.pTApplication.count({ where: adminListWhere(filters) }),
};
