/**
 * Fixtures for the PT listing-management foundation suites (pt-listing-*.integration.test.ts).
 *
 * Evidence label of every suite that uses this: BACKEND INTEGRATION against an isolated `*_test` database
 * (pass DATABASE_URL explicitly - user-service's .env points at dev; the guard in test-db-guard.ts skips anything else).
 * auth-service is NOT running: the token -> identity table in pt-contract-scope.test-helpers.ts is a TEST FIXTURE.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";

export const PRIVATE_MARKERS = {
  injury: "PRIVATE_KNEE_INJURY",
  equipment: "private-equipment-xyz",
  diet: "PRIVATE_DIET_xyz",
  phone: "0900PRIVATE",
  nationalId: "PRIVATE-NATIONAL-ID-123",
  address: "PRIVATE-HOME-ADDRESS-9",
  adminNote: "PRIVATE-ADMIN-NOTE-abc",
  rejection: "PRIVATE-REJECTION-abc",
  portfolio: "https://private-portfolio.example/xyz",
  social: "private-instagram-handle",
  pricingNotes: "PRIVATE-PRICING-NOTES",
  certNo: "PRIVATE-CERT-NO-77",
  certFile: "s3://private/cert-file.pdf",
  locationNote: "PRIVATE-LOCATION-NOTE",
};

export interface PublicPtOpts {
  marker?: string;
  serviceMode?: "ONLINE" | "OFFLINE" | "HYBRID";
  /** Application status; "NONE" = no application row at all. Default APPROVED. */
  application?: "APPROVED" | "SUBMITTED" | "NONE";
  isPT?: boolean;
  ptSuspended?: boolean;
}

/** A trainer with a FULL set of private data around the public bits, so a leak shows up as a failing assertion. */
export async function makePublicPt(opts: PublicPtOpts = {}) {
  const userId = randomUUID();
  const marker = opts.marker ?? `LM${randomUUID().slice(0, 8)}`;
  const email = `${userId}@private-mail.example`;
  const referralCode = `RC${randomUUID().slice(0, 8).toUpperCase()}`;
  const profile = await prisma.userProfile.create({
    data: {
      userId,
      isPT: opts.isPT ?? true,
      ptSuspended: opts.ptSuspended ?? false,
      firstName: marker,
      lastName: "Coach",
      firstNameNormalized: marker.toLowerCase(),
      lastNameNormalized: "coach",
      email,
      dateOfBirth: new Date("1990-01-02"),
      age: 36,
      gender: "MALE",
      heightCm: 181.5,
      currentWeight: 81.25,
      targetWeight: 77.5,
      startingWeight: 90.5,
      goal: "MUSCLE_GAIN",
      goalIntent: { secret: "PRIVATE_GOAL_INTENT" },
      activityLevel: "VERY_ACTIVE",
      experienceLevel: "ADVANCED",
      safetyScreeningFlags: ["private_flag"],
      injuries: [PRIVATE_MARKERS.injury],
      availableEquipment: [PRIVATE_MARKERS.equipment],
      dietaryPreference: PRIVATE_MARKERS.diet,
      region: "BAC",
      ptBudgetVnd: 777_777,
      referralCode,
      ptLockSeq: BigInt(5),
      gymId: "gym-private-1",
      specialties: ["STRENGTH", "YOGA"],
      searchCity: "Hà Nội",
      searchDistrict: "Cầu Giấy",
      searchWard: "Dịch Vọng",
      listingVersion: opts.application === "NONE" ? 0 : 1,
    },
  });

  let applicationId: string | null = null;
  if ((opts.application ?? "APPROVED") !== "NONE") {
    const app = await prisma.pTApplication.create({
      data: {
        userProfileId: profile.id,
        status: (opts.application ?? "APPROVED") as "APPROVED" | "SUBMITTED",
        approvedAt: new Date(),
        professionalBio: "Huấn luyện viên sức mạnh",
        mainSpecialties: ["STRENGTH"],
        languages: ["vi", "en"],
        serviceMode: opts.serviceMode ?? "HYBRID",
        operatingAreas: ["Cầu Giấy"],
        trainingMethodsApproach: "Progressive overload",
        targetClientGroups: ["BEGINNER"],
        primaryTrainingGoals: ["MUSCLE_GAIN"],
        yearsOfExperience: "5",
        phoneNumber: PRIVATE_MARKERS.phone,
        nationalIdNumber: PRIVATE_MARKERS.nationalId,
        currentAddress: PRIVATE_MARKERS.address,
        adminNote: PRIVATE_MARKERS.adminNote,
        rejectionReason: PRIVATE_MARKERS.rejection,
        reviewedByUserId: "admin-private-reviewer",
        portfolioUrl: PRIVATE_MARKERS.portfolio,
        socialLinks: { instagram: PRIVATE_MARKERS.social },
        websiteUrl: "https://public-site.example",
        linkedinUrl: "https://linkedin.example/in/coach",
        additionalPricingNotes: PRIVATE_MARKERS.pricingNotes,
        // Deliberately STALE registration-time prices: the DTO must replace them with values derived from packages.
        onlinePricePerSession: 111_111,
        offlinePricePerSession: 222_222,
        desiredSessionPrice: 333_333,
        onlinePackagePrice: 444_444,
        offlinePackagePrice: 555_555,
        monthlyProgramPrice: 666_666,
        packagePrice: 999_999,
        sessionsPerPackage: 7,
        residenceAddressLine: "PRIVATE-RESIDENCE-LINE",
        certificates: {
          create: [
            {
              certificateName: "NASM CPT",
              issuingOrganization: "NASM",
              isCurrentlyValid: true,
              certificationStatus: "Valid",
              certificationNumber: PRIVATE_MARKERS.certNo,
              certificateFileUrl: PRIVATE_MARKERS.certFile,
            },
          ],
        },
      },
    });
    applicationId = app.id;
  }

  // One active training location with a private note.
  // (a fixture province: the empty test database has no reference data; harmless to leave behind)
  const province = await prisma.vietnamProvince.upsert({
    where: { code: 990001 },
    update: {},
    create: { code: 990001, name: "Tỉnh Thử Nghiệm", nameNormalized: "tinh thu nghiem" },
  });
  await prisma.pTTrainingLocation.create({
    data: {
      ptUserId: userId,
      provinceCode: province.code,
      gymName: "Gym Công Khai",
      gymNameNormalized: "gym cong khai",
      addressLine: "1 Đường Công Khai",
      isPrimary: true,
      note: PRIVATE_MARKERS.locationNote,
    },
  });

  return { userId, marker, email, referralCode, profileId: profile.id, applicationId };
}

export async function makePackage(
  ptUserId: string,
  over: Partial<{
    name: string;
    sessionCount: number;
    price: number;
    sessionMode: "ONLINE" | "OFFLINE";
    sessionDurationMinutes: number;
    validityDays: number | null;
    isActive: boolean;
    archivedAt: Date | null;
    version: number;
  }> = {},
) {
  return prisma.pTServicePackage.create({
    data: {
      ptUserId,
      name: over.name ?? "Gói test",
      sessionCount: over.sessionCount ?? 10,
      price: over.price ?? 2_000_000,
      sessionMode: over.sessionMode ?? "OFFLINE",
      sessionDurationMinutes: over.sessionDurationMinutes ?? 60,
      validityDays: over.validityDays === undefined ? 90 : over.validityDays,
      isActive: over.isActive ?? true,
      archivedAt: over.archivedAt ?? null,
      version: over.version ?? 1,
    },
  });
}

/**
 * Removes what the listing suites create. Open (DRAFT/PENDING) revisions are deleted; CLOSED revisions are immutable
 * by design (the trigger refuses their deletion), so a suite that closes one simply leaves it behind under its own
 * random pt_user_id - harmless in a test database.
 */
export async function cleanupListingPts(ptUserIds: string[], contractIds: string[] = [], otherActorIds: string[] = []) {
  const { cleanup } = await import("./pt-restriction.test-helpers");
  await prisma.pTServicePackage.updateMany({ where: { ptUserId: { in: ptUserIds } }, data: { archivedAt: null } }).catch(() => {});
  await prisma.ptListingRevision.deleteMany({ where: { ptUserId: { in: ptUserIds }, status: { in: ["DRAFT", "PENDING"] } } }).catch(() => {});
  await prisma.clientCompatEvent.deleteMany({ where: { actorUserId: { in: [...ptUserIds, ...otherActorIds] } } }).catch(() => {});
  await prisma.pTTrainingLocation.deleteMany({ where: { ptUserId: { in: ptUserIds } } }).catch(() => {});
  await cleanup(ptUserIds, contractIds);
}
