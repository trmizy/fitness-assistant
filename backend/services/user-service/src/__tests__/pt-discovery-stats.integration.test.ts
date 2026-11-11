/**
 * D0b-1 integration suite: `pt_discovery_stats` epoch builder, quality score formula,
 * epoch lifecycle (atomic swap, concurrency guard, mid-build rollback, 30m pruning),
 * live visibility + accepting-clients overlay, 0-package exclusion on list (detail 200),
 * and D0a fallback when no READY current epoch exists.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + real PostgreSQL *_test DB;
 * auth-service identity lookup uses TEST FIXTURE token map).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { availabilityService } from "../services/availability.service";
import { findDiscoveryPtPageIds } from "../services/pt-discovery.query";
import {
  buildDiscoveryStatsEpoch,
  isPtDiscoveryStatsJobEnabled,
  runPtDiscoveryStatsJobOnce,
  startPtDiscoveryStatsJob,
} from "../services/pt-discovery-stats.service";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

const TOTAL_PTS = 550;
const VISIBLE_WITH_PKG = 500;
const VISIBLE_ZERO_PKG = 10;
const VISIBLE_TOTAL = VISIBLE_WITH_PKG + VISIBLE_ZERO_PKG; // > 500 so default batchSize=500 crosses 2 batches
const PAGE_LIMIT = 50;

const tag = randomUUID().replace(/-/g, "").slice(0, 6);
const prefix = `d0b1_${tag}_`;
const gymX = `gymx_${tag}`;
const PROV_CODE = 990201;
const WARD_CODE = 99020101;
const viewerId = `${prefix}viewer`;
const clientReviewerId = `${prefix}client`;

type SimPackage = {
  id: string;
  ptUserId: string;
  name: string;
  sessionCount: number;
  price: number;
  sessionMode: "ONLINE" | "OFFLINE";
  sessionDurationMinutes: number;
  isActive: boolean;
  archivedAt: Date | null;
};

type SimPt = {
  idx: number;
  userId: string;
  profileId: string;
  applicationId: string | null;
  firstName: string;
  isPT: boolean;
  ptSuspended: boolean;
  isAcceptingClients: boolean;
  appStatus: "APPROVED" | "SUBMITTED";
  serviceMode: "ONLINE" | "OFFLINE" | "HYBRID";
  specialties: string[];
  mainSpecialties: string[];
  bio: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  hasCert: boolean;
  photoStatus: "NONE" | "STAGED" | "RETIRED" | "PUBLISHED";
  hasActiveAvailBlock: boolean;
  hasInactiveAvailOnly: boolean;
  hasBlockedExceptionTomorrow: boolean;
  hasBookedSessionDayAfterTomorrow: boolean;
  hasCancelledSessionDay3: boolean;
  availHoursPerDay: number; // e.g., 2 or 4
  activeLocGymIds: Array<string | null>;
  inactiveLocGymIds: Array<string | null>;
  packages: SimPackage[];
  ratings: number[];
  hasOpenAccountRestriction: boolean;
  expectedHours7d?: number;
};

const fixedNow = new Date();
fixedNow.setHours(12, 0, 0, 0);

const simPts: SimPt[] = [];
const simByUserId = new Map<string, SimPt>();
const trackedEpochIds = new Set<number>();
let app: App;
let viewerToken: string;
const suiteStartedAt = new Date(Date.now() - 5000);

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function addLocalDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

function buildDataset(): void {
  const baseCreated = fixedNow.getTime() - 10_000_000;
  // Indices with explicit roles:
  //   0: Bayes 5★(1)   (identical other fields to idx 1)
  //   1: Bayes 4.7★(80) (identical other fields to idx 0 -> proves 5★(1) < 4.7★(80))
  //   2: mainSpecialties=['YOGA'] while user_profiles.specialties=[] -> completeness MUST NOT count specialty
  //   3: bio length = 49 trimmed ("x".repeat(49) + "   ") -> completeness bio = 0
  //   4: bio length = 50 trimmed ("x".repeat(50)) -> completeness bio = 1
  //   5: HYBRID with ONLY ONLINE pkg (no active location)
  //   6: HYBRID with ONLY OFFLINE pkg + active location
  //   7: Heavy availability (4h/day * 7 = 28h) + 1 blocked day + 1 booked 1h session + 1 cancelled 1h -> 23h -> saturates â=1
  //   8: Accepting=false high rating (always in non-accepting tail)
  //   9, 10: Active gymX accepting PTs (different quality to test SAME_GYM + quality tie/order)
  //   11: gymX non-accepting PT
  //   500..509: zero-package visible PTs
  //   510..549: hidden PTs (suspended, SUBMITTED, isPT=false, ACCOUNT restriction)

  for (let idx = 0; idx < TOTAL_PTS; idx++) {
    const pad = String(idx).padStart(4, "0");
    const userId = `${prefix}${pad}`;
    const profileId = `${prefix}p${pad}`;
    const applicationId = `${prefix}a${pad}`;
    const firstName = `${tag}PT${pad}`;
    const createdAt = new Date(baseCreated - idx * 1000);

    let isPT = true;
    let ptSuspended = false;
    let appStatus: "APPROVED" | "SUBMITTED" = "APPROVED";
    let hasOpenAccountRestriction = false;
    if (idx >= VISIBLE_TOTAL) {
      if (idx < 520) ptSuspended = true;
      else if (idx < 530) appStatus = "SUBMITTED";
      else if (idx < 540) isPT = false;
      else hasOpenAccountRestriction = true;
    }

    let isAcceptingClients = idx !== 8 && idx !== 11 && idx < VISIBLE_WITH_PKG ? idx % 13 !== 0 : idx % 13 !== 0;
    if (idx === 0 || idx === 1 || idx === 9 || idx === 10 || idx === 500) isAcceptingClients = true;
    if (idx === 8 || idx === 11) isAcceptingClients = false;

    let serviceMode: "ONLINE" | "OFFLINE" | "HYBRID" =
      idx % 3 === 0 ? "OFFLINE" : idx % 3 === 1 ? "HYBRID" : "ONLINE";
    if (idx === 0 || idx === 1) serviceMode = "OFFLINE";
    if (idx === 5 || idx === 6) serviceMode = "HYBRID";

    let bio: string | null = "x".repeat(60);
    if (idx === 0 || idx === 1) bio = "short";
    else if (idx === 3) bio = `${"a".repeat(49)}   `;
    else if (idx === 4) bio = "a".repeat(50);
    else if (idx % 5 === 0) bio = "short bio";

    let specialties: string[] = idx % 4 === 0 ? [] : ["STRENGTH"];
    let mainSpecialties: string[] = ["STRENGTH"];
    if (idx === 0 || idx === 1) specialties = [];
    if (idx === 2) {
      specialties = [];
      mainSpecialties = ["YOGA"];
    }

    let approvedAt: Date | null = new Date(fixedNow.getTime() - ((idx % 90) * 86_400_000));
    if (idx === 0 || idx === 1) approvedAt = new Date(fixedNow.getTime() - 120 * 86_400_000);
    else if (idx % 19 === 0) approvedAt = null;
    else if (idx === 9) approvedAt = new Date(fixedNow.getTime() - 5 * 86_400_000);
    else if (idx === 10) approvedAt = new Date(fixedNow.getTime() - 45 * 86_400_000);

    const hasCert = idx === 0 || idx === 1 ? false : idx % 2 === 0;
    let photoStatus: SimPt["photoStatus"] = idx % 3 === 0 ? "PUBLISHED" : idx % 3 === 1 ? "STAGED" : "RETIRED";
    if (idx === 0 || idx === 1) photoStatus = "NONE";
    if (idx === 9) photoStatus = "PUBLISHED";

    let hasActiveAvailBlock = idx % 2 === 0 && idx > 1;
    let hasInactiveAvailOnly = idx % 2 === 1 && idx > 1 && idx % 6 === 1;
    let availHoursPerDay = idx === 7 ? 4 : 2;
    let hasBlockedExceptionTomorrow = idx === 7 || (hasActiveAvailBlock && idx % 10 === 0);
    let hasBookedSessionDayAfterTomorrow = idx === 7 || (hasActiveAvailBlock && idx % 12 === 0);
    let hasCancelledSessionDay3 = idx === 7;
    if (idx === 0 || idx === 1) {
      hasActiveAvailBlock = false;
      hasInactiveAvailOnly = false;
      hasBlockedExceptionTomorrow = false;
      hasBookedSessionDayAfterTomorrow = false;
      hasCancelledSessionDay3 = false;
    } else if (idx === 7 || idx === 9) {
      hasActiveAvailBlock = true;
      hasInactiveAvailOnly = false;
    }

    const activeLocGymIds: Array<string | null> = [];
    const inactiveLocGymIds: Array<string | null> = [];
    if (idx === 9 || idx === 10 || idx === 11) {
      activeLocGymIds.push(gymX);
    } else if (idx === 5) {
      // HYBRID with ONLINE pkg only (only inactive location)
      inactiveLocGymIds.push(null);
    } else if (serviceMode === "OFFLINE" || serviceMode === "HYBRID") {
      activeLocGymIds.push(null);
    }

    const packages: SimPackage[] = [];
    const addPkg = (suffix: string, mode: "ONLINE" | "OFFLINE", count: number, price: number, extra: { isActive?: boolean; archivedAt?: Date | null } = {}) => {
      packages.push({
        id: `${prefix}pkg_${pad}_${suffix}`,
        ptUserId: userId,
        name: `Pkg ${suffix}`,
        sessionCount: count,
        price,
        sessionMode: mode,
        sessionDurationMinutes: 60,
        isActive: extra.isActive ?? true,
        archivedAt: extra.archivedAt ?? null,
      });
    };

    if (idx >= VISIBLE_WITH_PKG && idx < VISIBLE_TOTAL) {
      // Visible PTs with 0 for-sale packages (idx 500 gets 0 rows, idx 501 gets inactive/archived only)
      if (idx === 501) {
        addPkg("arch", "OFFLINE", 1, 100_000, { archivedAt: new Date() });
        addPkg("inact", "ONLINE", 1, 120_000, { isActive: false });
      }
    } else if (idx === 5) {
      addPkg("on", "ONLINE", 4, 400_000 * 4);
    } else if (idx === 6) {
      addPkg("off", "OFFLINE", 10, 250_000 * 10);
    } else {
      const basePrice = 150_000 + ((idx * 17) % 30) * 10_000;
      if (serviceMode === "OFFLINE") addPkg("a", "OFFLINE", 5, basePrice * 5);
      else if (serviceMode === "ONLINE") addPkg("a", "ONLINE", 4, (basePrice + 30_000) * 4);
      else {
        addPkg("a", "OFFLINE", 10, basePrice * 10);
        addPkg("b", "ONLINE", 4, (basePrice + 50_000) * 4);
      }
      // Noise archived pkg that must be ignored in from_price_*
      if (idx % 7 === 0) addPkg("noise", "OFFLINE", 1, 10_000, { archivedAt: new Date() });
    }

    const ratings: number[] = [];
    if (idx === 0) {
      ratings.push(5); // 5★ (1 review)
    } else if (idx === 1) {
      // 80 reviews averaging exactly 4.7 (56*5 + 24*4 = 376, 376/80 = 4.7)
      for (let k = 0; k < 56; k++) ratings.push(5);
      for (let k = 0; k < 24; k++) ratings.push(4);
    } else if (idx === 8 || idx === 9) {
      ratings.push(5, 5, 5, 5, 5, 5);
    } else if (idx % 4 === 0 && idx < VISIBLE_WITH_PKG) {
      const patterns = [[5, 4, 5], [4, 4, 5], [3, 4], [5, 5, 4], [2, 3]];
      ratings.push(...patterns[(idx / 4) % patterns.length]);
    }

    const pt: SimPt = {
      idx,
      userId,
      profileId,
      applicationId,
      firstName,
      isPT,
      ptSuspended,
      isAcceptingClients,
      appStatus,
      serviceMode,
      specialties,
      mainSpecialties,
      bio,
      approvedAt,
      createdAt,
      hasCert,
      photoStatus,
      hasActiveAvailBlock,
      hasInactiveAvailOnly,
      hasBlockedExceptionTomorrow,
      hasBookedSessionDayAfterTomorrow,
      hasCancelledSessionDay3,
      availHoursPerDay,
      activeLocGymIds,
      inactiveLocGymIds,
      packages,
      ratings,
      hasOpenAccountRestriction,
    };
    simPts.push(pt);
    simByUserId.set(userId, pt);
  }
}

function refHasForSale(pt: SimPt, mode?: "ONLINE" | "OFFLINE"): boolean {
  return pt.packages.some(
    (p) => p.isActive && p.archivedAt === null && p.sessionCount >= 1 && p.price > 0 && (!mode || p.sessionMode === mode),
  );
}

function refIsVisible(pt: SimPt): boolean {
  return pt.isPT && !pt.ptSuspended && pt.appStatus === "APPROVED" && !pt.hasOpenAccountRestriction;
}

function refIsDiscoverable(pt: SimPt): boolean {
  if (!refIsVisible(pt)) return false;
  const off = (pt.serviceMode === "OFFLINE" || pt.serviceMode === "HYBRID") && pt.activeLocGymIds.length > 0 && refHasForSale(pt, "OFFLINE");
  const on = (pt.serviceMode === "ONLINE" || pt.serviceMode === "HYBRID") && refHasForSale(pt, "ONLINE");
  return off || on;
}

function refComputeStat(pt: SimPt, hours7d: number, now: Date) {
  const n = pt.ratings.length;
  const sum = pt.ratings.reduce((a, b) => a + b, 0);
  const ratingAvg = n > 0 ? Math.round((sum / n) * 10) / 10 : null;
  const bayesRating = (10 * 4.2 + sum) / (10 + n);
  const rHat = Math.min(1, Math.max(0, (bayesRating - 1) / 4));

  const cItems =
    ((pt.bio ?? "").trim().length >= 50 ? 1 : 0) +
    (pt.specialties.length >= 1 ? 1 : 0) +
    (pt.hasCert ? 1 : 0) +
    (pt.photoStatus === "PUBLISHED" ? 1 : 0) +
    (refHasForSale(pt) ? 1 : 0) +
    (pt.hasActiveAvailBlock ? 1 : 0);
  const completeness = cItems / 6;

  const aHat = Math.min(hours7d / 20, 1);
  const acc = pt.isAcceptingClients ? 1 : 0;
  const nw = pt.approvedAt ? Math.min(1, Math.max(0, 1 - Math.max(0, (now.getTime() - pt.approvedAt.getTime()) / 86_400_000) / 60)) : 0;
  const quality = Math.min(1, Math.max(0, 0.45 * rHat + 0.2 * completeness + 0.15 * aHat + 0.1 * acc + 0.1 * nw));

  const minPrice = (mode?: "ONLINE" | "OFFLINE") => {
    const matching = pt.packages.filter(
      (p) => p.isActive && p.archivedAt === null && p.sessionCount >= 1 && p.price > 0 && (!mode || p.sessionMode === mode),
    );
    if (matching.length === 0) return null;
    return Math.floor(Math.min(...matching.map((p) => p.price / p.sessionCount)) / 1000) * 1000;
  };

  return {
    ratingAvg,
    ratingCount: n,
    bayesRating,
    completeness,
    availableHours7d: hours7d,
    accepting: pt.isAcceptingClients,
    approvedAt: pt.approvedAt,
    fromPriceOverall: minPrice(),
    fromPriceOnline: minPrice("ONLINE"),
    fromPriceOffline: minPrice("OFFLINE"),
    quality,
  };
}

async function cleanupFixture(): Promise<void> {
  if (trackedEpochIds.size > 0) {
    await prisma.ptDiscoveryEpoch.deleteMany({ where: { epoch: { in: [...trackedEpochIds] } } }).catch(() => {});
  }
  await prisma.ptDiscoveryEpoch.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } }).catch(() => {});
  await prisma.sessionReview.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTScheduleException.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTAvailability.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.ptPhysiquePhoto.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTApplicationCertificate.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.ptRestriction.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contract.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTTrainingLocation.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTApplication.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: prefix } } });
}

test.before(async () => {
  buildDataset();
  await cleanupFixture();

  // Isolated test DB must start with no current READY epoch so Test 1 verifies D0a fallback cleanly.
  const preCurrent = await prisma.ptDiscoveryEpoch.count({ where: { isCurrent: true } });
  assert.equal(preCurrent, 0, "test DB starts without an active pt_discovery_epochs row");

  await prisma.vietnamProvince.upsert({
    where: { code: PROV_CODE },
    update: {},
    create: { code: PROV_CODE, name: "Tỉnh D0b1", nameNormalized: "tinh d0b1" },
  });
  await prisma.vietnamWard.upsert({
    where: { code: WARD_CODE },
    update: {},
    create: { code: WARD_CODE, provinceCode: PROV_CODE, name: "Phường D0b1", nameNormalized: "phuong d0b1" },
  });

  const profileRows = [
    ...simPts.map((pt) => ({
      id: pt.profileId,
      userId: pt.userId,
      email: `${pt.userId}@d0b1.test.local`,
      firstName: pt.firstName,
      lastName: "Coach",
      firstNameNormalized: pt.firstName.toLowerCase(),
      lastNameNormalized: "coach",
      isPT: pt.isPT,
      ptSuspended: pt.ptSuspended,
      isAcceptingClients: pt.isAcceptingClients,
      specialties: pt.specialties,
      createdAt: pt.createdAt,
      updatedAt: pt.createdAt,
    })),
    { id: `${prefix}viewer_p`, userId: viewerId, email: `${viewerId}@d0b1.test.local` },
    { id: `${prefix}client_p`, userId: clientReviewerId, email: `${clientReviewerId}@d0b1.test.local` },
  ];
  for (const batch of chunkArray(profileRows, 500)) await prisma.userProfile.createMany({ data: batch });

  const appRows = simPts.map((pt) => ({
    id: pt.applicationId!,
    userProfileId: pt.profileId,
    status: pt.appStatus,
    serviceMode: pt.serviceMode,
    professionalBio: pt.bio,
    mainSpecialties: pt.mainSpecialties,
    approvedAt: pt.approvedAt,
  }));
  for (const batch of chunkArray(appRows, 500)) await prisma.pTApplication.createMany({ data: batch });

  const locRows: any[] = [];
  for (const pt of simPts) {
    pt.activeLocGymIds.forEach((gid, j) =>
      locRows.push({
        id: `${prefix}loc_${pt.idx}_a${j}`,
        ptUserId: pt.userId,
        provinceCode: PROV_CODE,
        wardCode: WARD_CODE,
        gymId: gid,
        gymName: `Gym ${pt.idx}`,
        isPrimary: j === 0,
        isActive: true,
      }),
    );
    pt.inactiveLocGymIds.forEach((gid, j) =>
      locRows.push({
        id: `${prefix}loc_${pt.idx}_i${j}`,
        ptUserId: pt.userId,
        provinceCode: PROV_CODE,
        wardCode: WARD_CODE,
        gymId: gid,
        gymName: `Inactive Gym ${pt.idx}`,
        isPrimary: false,
        isActive: false,
      }),
    );
  }
  for (const batch of chunkArray(locRows, 500)) await prisma.pTTrainingLocation.createMany({ data: batch });

  const pkgRows = simPts.flatMap((pt) => pt.packages);
  for (const batch of chunkArray(pkgRows, 500)) await prisma.pTServicePackage.createMany({ data: batch });

  const certRows = simPts
    .filter((pt) => pt.hasCert)
    .map((pt) => ({
      id: `${prefix}cert_${pt.idx}`,
      applicationId: pt.applicationId!,
      certificateName: "CPT Cert",
      issuingOrganization: "Org",
      isCurrentlyValid: true,
    }));
  for (const batch of chunkArray(certRows, 500)) await prisma.pTApplicationCertificate.createMany({ data: batch });

  const photoRows = simPts
    .filter((pt) => pt.photoStatus !== "NONE")
    .map((pt) => ({
      id: `${prefix}pho_${pt.idx}`,
      ptUserId: pt.userId,
      storageKey: `pt-physique/${pt.userId}/${pt.idx}.jpg`,
      status: pt.photoStatus as "STAGED" | "RETIRED" | "PUBLISHED",
      mime: "image/jpeg",
      bytes: 1024,
      uploadedBy: pt.userId,
    }));
  for (const batch of chunkArray(photoRows, 500)) await prisma.ptPhysiquePhoto.createMany({ data: batch });

  const availRows: any[] = [];
  const exceptionRows: any[] = [];
  const contractRows: any[] = [];
  const sessionRows: any[] = [];
  const reviewRows: any[] = [];
  const restrictionRows: any[] = [];

  const day1 = addLocalDays(fixedNow, 1); // tomorrow
  const day2 = addLocalDays(fixedNow, 2); // +2d
  const day3 = addLocalDays(fixedNow, 3); // +3d
  day1.setHours(10, 0, 0, 0);
  day2.setHours(9, 0, 0, 0);
  day3.setHours(9, 0, 0, 0);

  for (const pt of simPts) {
    if (pt.hasActiveAvailBlock) {
      for (const day of DAY_NAMES) {
        availRows.push({
          id: `${prefix}av_${pt.idx}_${day}`,
          ptUserId: pt.userId,
          dayOfWeek: day,
          startTime: "09:00",
          endTime: pt.availHoursPerDay === 4 ? "13:00" : "11:00",
          isActive: true,
        });
      }
    } else if (pt.hasInactiveAvailOnly) {
      availRows.push({
        id: `${prefix}av_${pt.idx}_inact`,
        ptUserId: pt.userId,
        dayOfWeek: "MONDAY",
        startTime: "09:00",
        endTime: "12:00",
        isActive: false,
      });
    }

    if (pt.hasBlockedExceptionTomorrow) {
      exceptionRows.push({
        id: `${prefix}ex_${pt.idx}`,
        ptUserId: pt.userId,
        date: day1,
        reason: "Off tomorrow",
      });
    }

    const needsContract = pt.ratings.length > 0 || pt.hasBookedSessionDayAfterTomorrow || pt.hasCancelledSessionDay3;
    if (needsContract) {
      const contractId = `${prefix}c_${pt.idx}`;
      contractRows.push({
        id: contractId,
        ptUserId: pt.userId,
        clientUserId: clientReviewerId,
        status: pt.hasBookedSessionDayAfterTomorrow ? "ACTIVE" : "COMPLETED",
        packageName: "D0b1 Contract",
        totalSessions: Math.max(1, pt.ratings.length + 2),
      });

      if (pt.hasBookedSessionDayAfterTomorrow) {
        const end2 = new Date(day2.getTime() + 60 * 60 * 1000);
        sessionRows.push({
          id: `${prefix}sb_${pt.idx}`,
          contractId,
          clientUserId: clientReviewerId,
          ptUserId: pt.userId,
          status: "CONFIRMED",
          scheduledStartAt: day2,
          scheduledEndAt: end2,
        });
      }
      if (pt.hasCancelledSessionDay3) {
        const end3 = new Date(day3.getTime() + 60 * 60 * 1000);
        sessionRows.push({
          id: `${prefix}sc_${pt.idx}`,
          contractId,
          clientUserId: clientReviewerId,
          ptUserId: pt.userId,
          status: "CANCELLED",
          scheduledStartAt: day3,
          scheduledEndAt: end3,
        });
      }

      pt.ratings.forEach((rating, rIdx) => {
        const sid = `${prefix}sr_${pt.idx}_${rIdx}`;
        const start = new Date("2026-08-01T10:00:00.000Z");
        sessionRows.push({
          id: sid,
          contractId,
          clientUserId: clientReviewerId,
          ptUserId: pt.userId,
          status: "COMPLETED",
          scheduledStartAt: start,
          scheduledEndAt: new Date(start.getTime() + 60 * 60 * 1000),
        });
        reviewRows.push({
          id: `${prefix}rev_${pt.idx}_${rIdx}`,
          sessionId: sid,
          contractId,
          clientUserId: clientReviewerId,
          rating,
        });
      });
    }

    if (pt.hasOpenAccountRestriction) {
      restrictionRows.push({
        id: `${prefix}rst_${pt.idx}`,
        ptUserId: pt.userId,
        type: "TEMPORARY_SUSPENSION",
        imposedBy: "admin-d0b1",
        scope: "ACCOUNT",
      });
    }
  }

  for (const batch of chunkArray(availRows, 500)) await prisma.pTAvailability.createMany({ data: batch });
  for (const batch of chunkArray(exceptionRows, 500)) await prisma.pTScheduleException.createMany({ data: batch });
  for (const batch of chunkArray(contractRows, 500)) await prisma.contract.createMany({ data: batch });
  for (const batch of chunkArray(sessionRows, 500)) await prisma.session.createMany({ data: batch });
  for (const batch of chunkArray(reviewRows, 500)) await prisma.sessionReview.createMany({ data: batch });
  for (const batch of chunkArray(restrictionRows, 500)) await prisma.ptRestriction.createMany({ data: batch });

  // Verify independent expected 7-day hours via availabilityService
  for (const pt of simPts) {
    if (!pt.hasActiveAvailBlock) pt.expectedHours7d = 0;
    else {
      let h = 7 * pt.availHoursPerDay;
      if (pt.hasBlockedExceptionTomorrow) h -= pt.availHoursPerDay;
      if (pt.hasBookedSessionDayAfterTomorrow) h -= 1;
      pt.expectedHours7d = h;
    }
  }

  app = await startApp();
  viewerToken = tokenFor(viewerId, "CUSTOMER");
});

test.after(async () => {
  if (app) await app.close();
  await cleanupFixture();
});

async function fetchAllPages(query: string): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (true) {
    const r = await app.call("GET", `/profile/pts?${query}&limit=${PAGE_LIMIT}&page=${page}`, viewerToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const p of r.body.pts as any[]) ids.push(p.userId);
    if (!r.body.hasMore) break;
    page++;
  }
  return ids;
}

test("1. No READY current epoch -> default discovery order falls back to D0a order (createdAt DESC)", async () => {
  const discoverable = simPts.filter(refIsDiscoverable);
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const expectedD0aOrder = [...discoverable]
    .sort((a, b) => {
      if (a.isAcceptingClients !== b.isAcceptingClients) return a.isAcceptingClients ? -1 : 1;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      return dt !== 0 ? dt : cmpStr(a.userId, b.userId);
    })
    .map((p) => p.userId);

  const actualIds = await fetchAllPages(`q=${encodeURIComponent(tag)}`);
  assert.deepEqual(actualIds, expectedD0aOrder, "fallback order without epoch equals exact D0a order");

  // SAME_GYM fallback without epoch
  const gymPage = await findDiscoveryPtPageIds({ q: tag, viewerGymIds: [gymX], page: 1, limit: PAGE_LIMIT });
  const gymSet = new Set([gymX]);
  const expectedWithGym = [...discoverable]
    .sort((a, b) => {
      if (a.isAcceptingClients !== b.isAcceptingClients) return a.isAcceptingClients ? -1 : 1;
      const ga = a.activeLocGymIds.includes(gymX);
      const gb = b.activeLocGymIds.includes(gymX);
      if (ga !== gb) return ga ? -1 : 1;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      return dt !== 0 ? dt : cmpStr(a.userId, b.userId);
    })
    .map((p) => p.userId);
  assert.ok(gymSet.has(gymX));
  assert.deepEqual(gymPage.userIds, expectedWithGym.slice(0, PAGE_LIMIT));
});

test("2. buildDiscoveryStatsEpoch computes accurate stats across >=300 PTs (<=1e-9), Bayes 5*(1) < 4.7*(80), single is_current", async () => {
  const result = await buildDiscoveryStatsEpoch({ now: () => fixedNow });
  assert.equal(result.built, true);
  assert.ok(result.epoch !== null && result.epoch > 0);
  trackedEpochIds.add(result.epoch);
  assert.ok(result.ptCount >= VISIBLE_TOTAL, `built >= ${VISIBLE_TOTAL} PTs`);

  const epochs = await prisma.ptDiscoveryEpoch.findMany({ where: { epoch: result.epoch } });
  assert.equal(epochs.length, 1);
  assert.equal(epochs[0].status, "READY");
  assert.equal(epochs[0].isCurrent, true);
  assert.ok(epochs[0].readyAt !== null);

  const currentCount = await prisma.ptDiscoveryEpoch.count({ where: { isCurrent: true } });
  assert.equal(currentCount, 1, "at most one current epoch");

  const storedRows = await prisma.ptDiscoveryStat.findMany({
    where: { epoch: result.epoch, ptUserId: { startsWith: prefix } },
  });
  const byPt = new Map(storedRows.map((r) => [r.ptUserId, r]));

  // Hidden PTs are excluded; visible 0-pkg PTs ARE included in stats
  for (const pt of simPts) {
    if (refIsVisible(pt)) {
      assert.ok(byPt.has(pt.userId), `visible pt ${pt.idx} has stats row`);
    } else {
      assert.ok(!byPt.has(pt.userId), `hidden pt ${pt.idx} is absent from stats`);
    }
  }

  // Exact match against independent formula (tolerance <= 1e-9)
  for (const pt of simPts.filter(refIsVisible)) {
    const got = byPt.get(pt.userId)!;
    const ref = refComputeStat(pt, pt.expectedHours7d!, fixedNow);

    assert.equal(got.ratingCount, ref.ratingCount);
    if (ref.ratingAvg === null) assert.equal(got.ratingAvg, null);
    else assert.ok(Math.abs(got.ratingAvg! - ref.ratingAvg) <= 1e-9, `ratingAvg pt ${pt.idx}`);

    assert.ok(Math.abs(got.bayesRating - ref.bayesRating) <= 1e-9, `bayesRating pt ${pt.idx}`);
    assert.ok(Math.abs(got.completeness - ref.completeness) <= 1e-9, `completeness pt ${pt.idx}`);
    assert.equal(got.availableHours7d, ref.availableHours7d, `availableHours7d pt ${pt.idx}`);
    assert.equal(got.accepting, ref.accepting);
    assert.equal(got.fromPriceOverall !== null ? Number(got.fromPriceOverall) : null, ref.fromPriceOverall);
    assert.equal(got.fromPriceOnline !== null ? Number(got.fromPriceOnline) : null, ref.fromPriceOnline);
    assert.equal(got.fromPriceOffline !== null ? Number(got.fromPriceOffline) : null, ref.fromPriceOffline);
    assert.ok(Math.abs(got.quality - ref.quality) <= 1e-9, `quality pt ${pt.idx}: ${got.quality} vs ${ref.quality}`);
  }

  // Verify 7d hours explicitly against availabilityService.countAvailableSlotsForPT(..., 60, 7) on sample idx 7
  const pt7Avail = await availabilityService.countAvailableSlotsForPT(simPts[7].userId, 60, 7);
  assert.equal(byPt.get(simPts[7].userId)!.availableHours7d, pt7Avail);
  assert.equal(pt7Avail, 23, "7*4 - 4(blocked tomorrow) - 1(booked +2d) = 23h");

  // Bayes rule: 5★(1) < 4.7★(80) when everything else is equal; rating_avg is rounded 1dp while bayes uses raw sum/count
  const sLow = byPt.get(simPts[0].userId)!;
  const sHigh = byPt.get(simPts[1].userId)!;
  assert.ok(sLow.bayesRating < sHigh.bayesRating, `5★(1) ${sLow.bayesRating} < 4.7★(80) ${sHigh.bayesRating}`);
  assert.ok(sLow.quality < sHigh.quality, "5★(1) < 4.7★(80) in final quality too");

  const sRound = byPt.get(simPts[20].userId)!; // [5, 4, 5] => sum=14, n=3 -> 4.6667 rounded to 4.7
  assert.equal(sRound.ratingAvg, 4.7, "rating_avg is rounded to 1 decimal place like D0a");
  assert.ok(Math.abs(sRound.bayesRating - (10 * 4.2 + 14) / (10 + 3)) <= 1e-9, "bayes_rating still uses raw sum/count");

  // Specialty completeness reads user_profiles.specialties only (not mainSpecialties); bio trimmed length 49 vs 50
  assert.ok(Math.abs(byPt.get(simPts[2].userId)!.completeness - 4 / 6) <= 1e-9, "idx 2: mainSpecialties alone counts 0 (4/6)");
  assert.ok(Math.abs(byPt.get(simPts[3].userId)!.completeness - 3 / 6) <= 1e-9, "idx 3: trimmed bio len 49 counts 0 (3/6)");
  assert.ok(Math.abs(byPt.get(simPts[4].userId)!.completeness - 4 / 6) <= 1e-9, "idx 4: trimmed bio len 50 counts 1 (4/6)");
});

test("3. Default GET /profile/pts uses stats quality DESC + accepting + SAME_GYM; 0-pkg excluded from list/HYBRID yet detail returns 200", async () => {
  const discoverable = simPts.filter(refIsDiscoverable);
  const rows = await prisma.ptDiscoveryStat.findMany({
    where: { epoch: (await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true } })).epoch, ptUserId: { startsWith: prefix } },
  });
  const qualityMap = new Map(rows.map((r) => [r.ptUserId, r.quality]));
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const expectedOrder = [...discoverable]
    .sort((a, b) => {
      if (a.isAcceptingClients !== b.isAcceptingClients) return a.isAcceptingClients ? -1 : 1;
      const qa = qualityMap.get(a.userId) ?? -1;
      const qb = qualityMap.get(b.userId) ?? -1;
      if (qa !== qb) return qb - qa;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      return dt !== 0 ? dt : cmpStr(a.userId, b.userId);
    })
    .map((p) => p.userId);

  const actualIds = await fetchAllPages(`q=${encodeURIComponent(tag)}`);
  assert.equal(new Set(actualIds).size, actualIds.length, "0 duplicates across pages");
  assert.deepEqual(actualIds, expectedOrder, "default discovery order matches quality DESC inside accepting groups");

  // SAME_GYM + quality
  const withGym = await findDiscoveryPtPageIds({ q: tag, viewerGymIds: [gymX], page: 1, limit: PAGE_LIMIT });
  const expectedGymOrder = [...discoverable]
    .sort((a, b) => {
      if (a.isAcceptingClients !== b.isAcceptingClients) return a.isAcceptingClients ? -1 : 1;
      const ga = a.activeLocGymIds.includes(gymX);
      const gb = b.activeLocGymIds.includes(gymX);
      if (ga !== gb) return ga ? -1 : 1;
      const qa = qualityMap.get(a.userId) ?? -1;
      const qb = qualityMap.get(b.userId) ?? -1;
      if (qa !== qb) return qb - qa;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      return dt !== 0 ? dt : cmpStr(a.userId, b.userId);
    })
    .map((p) => p.userId);
  assert.deepEqual(withGym.userIds, expectedGymOrder.slice(0, PAGE_LIMIT));

  // sessionMode=HYBRID keeps HYBRID with ONLINE-only (idx 5) & OFFLINE-only (idx 6) while excluding 0-pkg
  const hybridIds = await fetchAllPages(`q=${encodeURIComponent(tag)}&sessionMode=HYBRID`);
  const expectedHybrid = new Set(discoverable.filter((p) => p.serviceMode === "HYBRID").map((p) => p.userId));
  assert.deepEqual(new Set(hybridIds), expectedHybrid);
  assert.ok(expectedHybrid.has(simPts[5].userId), "HYBRID with ONLINE pkg included");
  assert.ok(expectedHybrid.has(simPts[6].userId), "HYBRID with OFFLINE pkg + location included");

  // 0-package PTs (500..509) are excluded from list yet detail returns 200 (Supplement a)
  for (const idx of [500, 501]) {
    assert.ok(!actualIds.includes(simPts[idx].userId), `0-pkg idx ${idx} excluded from list`);
    const detail = await app.call("GET", `/profile/pts/${simPts[idx].userId}`, viewerToken);
    assert.equal(detail.status, 200, `0-pkg idx ${idx} detail still 200`);
  }
});

test("4. Live visibility & is_accepting_clients take effect immediately even before stats epoch rebuilds", async () => {
  const suspendedPt = simPts[9];
  const restrictedPt = simPts[10];
  const toggledOffPt = simPts[4];

  await prisma.userProfile.update({ where: { userId: suspendedPt.userId }, data: { ptSuspended: true } });
  await prisma.ptRestriction.create({
    data: { id: `${prefix}live_rst`, ptUserId: restrictedPt.userId, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-live", scope: "ACCOUNT" },
  });
  await prisma.userProfile.update({ where: { userId: toggledOffPt.userId }, data: { isAcceptingClients: false } });

  try {
    const ids = await fetchAllPages(`q=${encodeURIComponent(tag)}`);
    assert.ok(!ids.includes(suspendedPt.userId), "live suspension immediately hides PT from list");
    assert.ok(!ids.includes(restrictedPt.userId), "live ACCOUNT restriction immediately hides PT from list");

    // toggledOffPt must sit in the non-accepting tail immediately
    const toggledPos = ids.indexOf(toggledOffPt.userId);
    assert.ok(toggledPos > 0);
    const acceptingOther = ids.indexOf(simPts[1].userId);
    assert.ok(acceptingOther < toggledPos, "live is_accepting_clients=false moves PT below accepting PTs");
  } finally {
    await prisma.userProfile.update({ where: { userId: suspendedPt.userId }, data: { ptSuspended: false } });
    await prisma.ptRestriction.delete({ where: { id: `${prefix}live_rst` } });
    await prisma.userProfile.update({ where: { userId: toggledOffPt.userId }, data: { isAcceptingClients: toggledOffPt.isAcceptingClients } });
  }
});

test("5. Concurrent rebuild calls maintain at most one is_current epoch without failing", async () => {
  const results = await Promise.all([
    buildDiscoveryStatsEpoch(),
    buildDiscoveryStatsEpoch(),
    buildDiscoveryStatsEpoch(),
  ]);
  for (const r of results) {
    if (r.epoch !== null) trackedEpochIds.add(r.epoch);
  }
  const builtCount = results.filter((r) => r.built).length;
  assert.ok(builtCount >= 1 && builtCount <= 3);
  const currentEpochs = await prisma.ptDiscoveryEpoch.findMany({ where: { isCurrent: true } });
  assert.equal(currentEpochs.length, 1, "strictly one current epoch after concurrent runs");
  assert.equal(currentEpochs[0].status, "READY");
});

test("6. Mid-build batch failure deletes failed BUILDING epoch & keeps previous current epoch intact (Supplement c)", async () => {
  const beforeCurrent = await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true } });
  const beforeRowCount = await prisma.ptDiscoveryStat.count({ where: { epoch: beforeCurrent.epoch } });

  let seenBatches = 0;
  await assert.rejects(
    () =>
      buildDiscoveryStatsEpoch({
        batchSize: 200,
        onBatchBeforeInsert: ({ batchIndex }) => {
          seenBatches += 1;
          if (batchIndex === 1) throw new Error("SIMULATED_BATCH_FAILURE");
        },
      }),
    /SIMULATED_BATCH_FAILURE/,
  );
  assert.ok(seenBatches >= 2, "failure triggered on 2nd batch after 1st batch already inserted rows");

  const stuckBuilding = await prisma.ptDiscoveryEpoch.count({ where: { status: "BUILDING" } });
  assert.equal(stuckBuilding, 0, "failed BUILDING epoch is deleted");

  const afterCurrent = await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true } });
  assert.equal(afterCurrent.epoch, beforeCurrent.epoch, "previous current epoch stays active");
  const afterRowCount = await prisma.ptDiscoveryStat.count({ where: { epoch: beforeCurrent.epoch } });
  assert.equal(afterRowCount, beforeRowCount, "previous current epoch stats remain untouched");

  // Subsequent normal rebuild succeeds cleanly
  const recovered = await buildDiscoveryStatsEpoch();
  assert.equal(recovered.built, true);
  if (recovered.epoch) trackedEpochIds.add(recovered.epoch);
});

test("7. Pruning deletes READY non-current ready_at > 30m (incl. NULL fallback) & stuck BUILDING > 30m, keeps recent READY; job flags & log safe", async () => {
  const eOldReady = await buildDiscoveryStatsEpoch();
  assert.equal(eOldReady.built, true);
  trackedEpochIds.add(eOldReady.epoch!);

  const eRecentReady = await buildDiscoveryStatsEpoch();
  assert.equal(eRecentReady.built, true);
  trackedEpochIds.add(eRecentReady.epoch!);

  // Null ready_at + old created_at READY non-current + stuck BUILDING > 30m
  const [eNullOldReady] = await prisma.$queryRaw<{ epoch: number }[]>`
    INSERT INTO pt_discovery_epochs (status, is_current, created_at, ready_at)
    VALUES ('READY'::"PtDiscoveryEpochStatus", false, NOW() - INTERVAL '35 minutes', NULL)
    RETURNING epoch
  `;
  const [eStuckBuilding] = await prisma.$queryRaw<{ epoch: number }[]>`
    INSERT INTO pt_discovery_epochs (status, is_current, created_at)
    VALUES ('BUILDING'::"PtDiscoveryEpochStatus", false, NOW() - INTERVAL '35 minutes')
    RETURNING epoch
  `;
  trackedEpochIds.add(eNullOldReady.epoch);
  trackedEpochIds.add(eStuckBuilding.epoch);

  // Build another epoch so both eOldReady & eRecentReady become non-current, then age eOldReady.ready_at back 35m
  await prisma.$executeRaw`
    UPDATE pt_discovery_epochs SET is_current = false, ready_at = NOW() - INTERVAL '35 minutes' WHERE epoch = ${eOldReady.epoch!}
  `;
  // Trigger next build (note: if eRecentReady is still current when we run buildDiscoveryStatsEpoch, step C swaps it to non-current then step D prunes!)
  const eNewest = await buildDiscoveryStatsEpoch();
  assert.equal(eNewest.built, true);
  trackedEpochIds.add(eNewest.epoch!);

  assert.equal(await prisma.ptDiscoveryEpoch.findUnique({ where: { epoch: eOldReady.epoch! } }), null, "old non-current READY ready_at >30m deleted");
  assert.equal(await prisma.ptDiscoveryStat.count({ where: { epoch: eOldReady.epoch! } }), 0, "stats cascaded");
  assert.equal(await prisma.ptDiscoveryEpoch.findUnique({ where: { epoch: eNullOldReady.epoch } }), null, "null ready_at fallback to created_at >30m deleted");
  assert.equal(await prisma.ptDiscoveryEpoch.findUnique({ where: { epoch: eStuckBuilding.epoch } }), null, "stuck BUILDING >30m deleted");
  assert.ok(await prisma.ptDiscoveryEpoch.findUnique({ where: { epoch: eRecentReady.epoch! } }), "recent non-current READY <=30m kept");

  // Job env gate: disabled under GYMINI_TEST_ISOLATION=1 by default
  assert.equal(isPtDiscoveryStatsJobEnabled({ GYMINI_TEST_ISOLATION: "1" } as any), false);
  assert.equal(isPtDiscoveryStatsJobEnabled({ NODE_ENV: "test" } as any), false);
  assert.equal(isPtDiscoveryStatsJobEnabled({ NODE_ENV: "test", PT_DISCOVERY_STATS_JOB_ENABLED: "false" } as any), false);
  assert.equal(isPtDiscoveryStatsJobEnabled({ NODE_ENV: "test", PT_DISCOVERY_STATS_JOB_ENABLED: "true" } as any), true);
  assert.equal(isPtDiscoveryStatsJobEnabled({ NODE_ENV: "production" } as any), true);

  // Stop function returned by disabled startPtDiscoveryStatsJob is a safe no-op
  const stopNoop = startPtDiscoveryStatsJob();
  stopNoop();

  // Log 1 line with epoch/ptCount/durationMs and zero PII
  const logged: string[] = [];
  const jobRes = await runPtDiscoveryStatsJobOnce({
    log: {
      info: (msg: string) => {
        logged.push(msg);
      },
    },
  });
  assert.ok(jobRes && jobRes.built);
  if (jobRes.epoch) trackedEpochIds.add(jobRes.epoch);
  const buildLogs = logged.filter((line) => line.includes("[PtDiscoveryStats] built"));
  assert.equal(buildLogs.length, 1, "logs exactly one summary line per build");
  assert.match(buildLogs[0], /epoch=\d+\s+ptCount=\d+\s+durationMs=\d+/);
  assert.ok(!buildLogs[0].includes("@") && !buildLogs[0].includes(prefix), "no PII or user IDs in log line");
});
