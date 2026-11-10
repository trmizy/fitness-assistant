/**
 * D0a integration suite: global SQL PT discovery, pagination, filters, and visibility equivalence
 * across 5,000 simulated PTs on an isolated `*_test` database.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + real PostgreSQL *_test DB;
 * auth-service identity lookup uses TEST FIXTURE token map).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { findDiscoveryPtPageIds } from "../services/pt-discovery.query";
import { ptPublicWhere } from "../services/pt-public-dto";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

const TOTAL_PTS = 5000;
const VISIBLE_PTS = 4700;
const PAGE_LIMIT = 50;

const tag = randomUUID().replace(/-/g, "").slice(0, 6);
const prefix = `d0a${tag}u`;
const uniqueSpecialty = `SPEC_${tag}`;
const gymFilterId = `gym-${tag}`;
const gymX = `gymx-${tag}`;
const PROV_A = 990101;
const PROV_B = 990102;
const WARD_A1 = 99010101;
const WARD_A2 = 99010102;
const WARD_B1 = 99010201;

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
  firstName: string;
  createdAt: Date;
  isPT: boolean;
  ptSuspended: boolean;
  isAcceptingClients: boolean;
  appStatus: "APPROVED" | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "NEEDS_MORE_INFO" | "REJECTED" | "NONE";
  serviceMode: "ONLINE" | "OFFLINE" | "HYBRID";
  gymId: string | null;
  specialties: string[];
  hasOpenAccountRestriction: boolean;
  hasContractRestriction: boolean;
  hasEndedAccountRestriction: boolean;
  activeLocations: Array<{ provinceCode: number; wardCode: number; gymId?: string }>;
  inactiveLocations: Array<{ provinceCode: number; wardCode: number; gymId?: string }>;
  packages: SimPackage[];
  ratings: number[];
};

const simPts: SimPt[] = [];
const simByUserId = new Map<string, SimPt>();
let app: App;
let viewerToken: string;
const viewerId = `${prefix}viewer`;
const clientReviewerId = `${prefix}client`;
const startedAtMs = Date.now();

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildDataset(): void {
  const baseTime = new Date("2026-10-01T00:00:00.000Z").getTime();
  const hiddenStatuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "REJECTED"] as const;

  for (let idx = 0; idx < TOTAL_PTS; idx++) {
    const pad = String(idx).padStart(4, "0");
    const userId = `${prefix}${pad}`;
    const profileId = `${prefix}p${pad}`;
    const nameRank = (idx * 7919) % 4500;
    const firstName = `${tag}N${String(nameRank).padStart(4, "0")}`;

    // Explicit createdAt ties at idx 20, 21, 22 to verify deterministic userId tie-break
    const timeStep = idx === 21 || idx === 22 ? 20 : idx;
    const createdAt = new Date(baseTime - timeStep * 1000);

    let isPT = true;
    let ptSuspended = false;
    // idx 0 & 1 have the NEWEST createdAt yet isAcceptingClients=false; idx 21 tests tied createdAt;
    // idx 2502 tests isAcceptingClients=false even with active gymX location; ~275 PTs scattered throughout.
    const isAcceptingClients =
      idx === 0 || idx === 1 || idx === 21 || idx === 2502 || (idx > 0 && idx < VISIBLE_PTS && idx % 17 === 0)
        ? false
        : true;
    let appStatus: SimPt["appStatus"] = "APPROVED";
    let hasOpenAccountRestriction = false;
    const hasEndedAccountRestriction = idx === 10;
    const hasContractRestriction = idx === 20;

    if (idx >= VISIBLE_PTS) {
      if (idx < 4760) ptSuspended = true;
      else if (idx < 4820) isPT = false;
      else if (idx < 4880) appStatus = hiddenStatuses[idx % hiddenStatuses.length];
      else if (idx < 4940) appStatus = "NONE";
      else hasOpenAccountRestriction = true;
    }

    let serviceMode: "ONLINE" | "OFFLINE" | "HYBRID" =
      idx % 20 < 9 ? "OFFLINE" : idx % 20 < 16 ? "HYBRID" : "ONLINE";
    if (idx === 1100 || idx === 1102 || idx === 3500) serviceMode = "HYBRID";
    if (idx === 1 || idx === 5 || idx === 1101 || idx === 2500 || idx === 2501 || idx === 2502 || idx === 3501 || idx === 3502) {
      serviceMode = "OFFLINE";
    }
    if (idx === 1103) serviceMode = "ONLINE";

    const specialties: string[] = [];
    if (idx % 3 === 0) specialties.push("STRENGTH");
    if (idx % 5 === 0) specialties.push("YOGA");
    if (idx % 7 === 0) specialties.push("BOXING");
    if (idx % 11 === 0) specialties.push("CARDIO");
    if (idx === 1500) specialties.push(uniqueSpecialty);

    const gymId = idx === 1200 || idx === 2400 ? gymFilterId : null;

    const activeLocations: Array<{ provinceCode: number; wardCode: number; gymId?: string }> = [];
    const inactiveLocations: Array<{ provinceCode: number; wardCode: number; gymId?: string }> = [];
    if (idx === 1100) {
      inactiveLocations.push({ provinceCode: PROV_A, wardCode: WARD_A1 });
    } else if (idx === 5) {
      // Newer createdAt PT with INACTIVE gymX location (must NOT be prioritized by SAME_GYM)
      activeLocations.push({ provinceCode: PROV_B, wardCode: WARD_B1 });
      inactiveLocations.push({ provinceCode: PROV_A, wardCode: WARD_A1, gymId: gymX });
    } else if (idx === 2500 || idx === 2502) {
      // Older createdAt PTs with ACTIVE gymX location (2500 accepting, 2502 non-accepting)
      activeLocations.push({ provinceCode: PROV_A, wardCode: WARD_A1, gymId: gymX });
    } else if (idx === 2501) {
      // Multi-location PT with active gymX (must appear once & be prioritized)
      activeLocations.push({ provinceCode: PROV_A, wardCode: WARD_A1, gymId: gymX });
      activeLocations.push({ provinceCode: PROV_B, wardCode: WARD_B1 });
    } else if (serviceMode === "OFFLINE" || serviceMode === "HYBRID") {
      if (idx % 9 === 0) {
        // Multi-location PT (same province + cross-province): must never duplicate in results
        activeLocations.push({ provinceCode: PROV_A, wardCode: WARD_A1 });
        activeLocations.push({ provinceCode: PROV_A, wardCode: WARD_A2 });
        activeLocations.push({ provinceCode: PROV_B, wardCode: WARD_B1 });
      } else if (idx % 2 === 0) {
        activeLocations.push({ provinceCode: PROV_A, wardCode: idx % 4 === 0 ? WARD_A1 : WARD_A2 });
      } else {
        activeLocations.push({ provinceCode: PROV_B, wardCode: WARD_B1 });
      }
    }

    const packages: SimPackage[] = [];
    const addPkg = (
      suffix: string,
      sessionMode: "ONLINE" | "OFFLINE",
      sessionCount: number,
      price: number,
      opts: { isActive?: boolean; archivedAt?: Date | null } = {},
    ) => {
      packages.push({
        id: `${prefix}pkg${pad}${suffix}`,
        ptUserId: userId,
        name: `Pkg ${suffix}`,
        sessionCount,
        price,
        sessionMode,
        sessionDurationMinutes: 60,
        isActive: opts.isActive ?? true,
        archivedAt: opts.archivedAt ?? null,
      });
    };

    if (idx === 1) {
      // isAcceptingClients=false PT with 2nd cheapest price (60k) to verify priceAsc does NOT sink it
      addPkg("a", "OFFLINE", 1, 60_000);
    } else if (idx === 3500) {
      // Beyond pos 1000 in default order: cheapest overall & OFFLINE & ONLINE
      addPkg("a", "OFFLINE", 10, 500_000); // 50,000/session
      addPkg("b", "ONLINE", 5, 400_000); // 80,000/session
    } else if (idx === 3501) {
      // Beyond pos 1000 in default order: highest price overall
      addPkg("a", "OFFLINE", 1, 5_000_000); // 5,000,000/session
    } else if (idx === 3502) {
      // Beyond pos 1000 in default order: non-integer per-session price (333,333.33 -> 333,000) + 5.0★ rating
      addPkg("a", "OFFLINE", 3, 1_000_000);
    } else if (idx === 1100) {
      // HYBRID PT with only inactive location, has both OFFLINE and ONLINE packages
      addPkg("a", "OFFLINE", 10, 200_000 * 10);
      addPkg("b", "ONLINE", 4, 250_000 * 4);
    } else if (idx === 1101) {
      // OFFLINE PT with only archived & inactive packages (0 for-sale packages)
      addPkg("a", "OFFLINE", 1, 100_000, { isActive: true, archivedAt: new Date() });
      addPkg("b", "OFFLINE", 1, 120_000, { isActive: false, archivedAt: null });
    } else if (idx === 1102) {
      // HYBRID PT with active location, ONLY ONLINE package (no OFFLINE package)
      addPkg("a", "ONLINE", 1, 300_000);
    } else if (idx === 1103) {
      // ONLINE PT with ONLY OFFLINE package (no ONLINE package)
      addPkg("a", "OFFLINE", 1, 250_000);
    } else if (idx >= VISIBLE_PTS && idx < 4710) {
      // Hidden PTs with ultra-low price to catch any visibility leak immediately
      addPkg("a", "OFFLINE", 1, 40_000);
    } else if (idx % 25 !== 0) {
      const baseSessionPrice = 100_000 + ((idx * 37) % 85) * 10_000;
      if (serviceMode === "OFFLINE") {
        addPkg("a", "OFFLINE", 10, baseSessionPrice * 10);
      } else if (serviceMode === "ONLINE") {
        addPkg("a", "ONLINE", 5, (baseSessionPrice + 20_000) * 5);
      } else {
        addPkg("a", "OFFLINE", 10, baseSessionPrice * 10);
        addPkg("b", "ONLINE", 4, (baseSessionPrice + 50_000) * 4);
      }
    }

    const ratings: number[] = [];
    if (idx === 3502) {
      ratings.push(5, 5, 5, 5); // avg 5.0 (strictly unique top visible rating, past index 1000)
    } else if (idx >= VISIBLE_PTS && idx < 4710) {
      ratings.push(5, 5); // hidden PTs with 5.0 to catch any visibility leak
    } else if (idx % 6 === 0 && idx < VISIBLE_PTS) {
      // Max visible avg here <= 4.8 so idx 3502 (5.0) is uniquely #1
      const patterns = [
        [5, 4, 5], // 4.7
        [4, 4, 5], // 4.3
        [3, 4, 4], // 3.7
        [5, 4], // 4.5
        [2, 3, 4], // 3.0
        [1, 2], // 1.5
        [4, 5, 5, 5], // 4.8
        [2, 2, 3], // 2.3
      ];
      ratings.push(...patterns[(idx / 6) % patterns.length]);
    }

    const pt: SimPt = {
      idx,
      userId,
      profileId,
      firstName,
      createdAt,
      isPT,
      ptSuspended,
      isAcceptingClients,
      appStatus,
      serviceMode,
      gymId,
      specialties,
      hasOpenAccountRestriction,
      hasContractRestriction,
      hasEndedAccountRestriction,
      activeLocations,
      inactiveLocations,
      packages,
      ratings,
    };
    simPts.push(pt);
    simByUserId.set(userId, pt);
  }
}

async function cleanupFixture() {
  await prisma.sessionReview.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
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

  await prisma.vietnamProvince.upsert({
    where: { code: PROV_A },
    update: {},
    create: { code: PROV_A, name: "Tỉnh Test A", nameNormalized: "tinh test a" },
  });
  await prisma.vietnamProvince.upsert({
    where: { code: PROV_B },
    update: {},
    create: { code: PROV_B, name: "Tỉnh Test B", nameNormalized: "tinh test b" },
  });
  await prisma.vietnamWard.upsert({
    where: { code: WARD_A1 },
    update: {},
    create: { code: WARD_A1, provinceCode: PROV_A, name: "Phường Test A1", nameNormalized: "phuong test a1" },
  });
  await prisma.vietnamWard.upsert({
    where: { code: WARD_A2 },
    update: {},
    create: { code: WARD_A2, provinceCode: PROV_A, name: "Phường Test A2", nameNormalized: "phuong test a2" },
  });
  await prisma.vietnamWard.upsert({
    where: { code: WARD_B1 },
    update: {},
    create: { code: WARD_B1, provinceCode: PROV_B, name: "Phường Test B1", nameNormalized: "phuong test b1" },
  });

  // Batch insert 5,000 profiles + viewer + reviewer client
  const profileRows = [
    ...simPts.map((pt) => ({
      id: pt.profileId,
      userId: pt.userId,
      email: `${pt.userId}@d0a.test.local`,
      firstName: pt.firstName,
      lastName: "Coach",
      firstNameNormalized: pt.firstName.toLowerCase(),
      lastNameNormalized: "coach",
      isPT: pt.isPT,
      ptSuspended: pt.ptSuspended,
      isAcceptingClients: pt.isAcceptingClients,
      gymId: pt.gymId,
      specialties: pt.specialties,
      createdAt: pt.createdAt,
      updatedAt: pt.createdAt,
    })),
    { id: `${prefix}viewer_p`, userId: viewerId, email: `${viewerId}@d0a.test.local` },
    { id: `${prefix}client_p`, userId: clientReviewerId, email: `${clientReviewerId}@d0a.test.local` },
  ];
  for (const batch of chunkArray(profileRows, 1000)) {
    await prisma.userProfile.createMany({ data: batch });
  }

  const appRows = simPts
    .filter((pt) => pt.appStatus !== "NONE")
    .map((pt) => ({
      id: `${prefix}app${String(pt.idx).padStart(4, "0")}`,
      userProfileId: pt.profileId,
      status: pt.appStatus as Exclude<SimPt["appStatus"], "NONE">,
      serviceMode: pt.serviceMode,
      approvedAt: pt.appStatus === "APPROVED" ? pt.createdAt : null,
    }));
  for (const batch of chunkArray(appRows, 1000)) {
    await prisma.pTApplication.createMany({ data: batch });
  }

  const locRows: any[] = [];
  for (const pt of simPts) {
    pt.activeLocations.forEach((loc, j) => {
      locRows.push({
        id: `${prefix}loc${String(pt.idx).padStart(4, "0")}a${j}`,
        ptUserId: pt.userId,
        provinceCode: loc.provinceCode,
        wardCode: loc.wardCode,
        gymId: loc.gymId ?? null,
        gymName: `Gym ${pt.idx}-${j}`,
        isPrimary: j === 0,
        isActive: true,
      });
    });
    pt.inactiveLocations.forEach((loc, j) => {
      locRows.push({
        id: `${prefix}loc${String(pt.idx).padStart(4, "0")}i${j}`,
        ptUserId: pt.userId,
        provinceCode: loc.provinceCode,
        wardCode: loc.wardCode,
        gymId: loc.gymId ?? null,
        gymName: `Inactive Gym ${pt.idx}-${j}`,
        isPrimary: false,
        isActive: false,
      });
    });
  }
  for (const batch of chunkArray(locRows, 1000)) {
    await prisma.pTTrainingLocation.createMany({ data: batch });
  }

  const pkgRows = simPts.flatMap((pt) => pt.packages);
  for (const batch of chunkArray(pkgRows, 1000)) {
    await prisma.pTServicePackage.createMany({ data: batch });
  }

  const contractRows: any[] = [];
  const sessionRows: any[] = [];
  const reviewRows: any[] = [];
  const restrictionRows: any[] = [];

  for (const pt of simPts) {
    if (pt.ratings.length > 0 || pt.hasContractRestriction) {
      const contractId = `${prefix}c${String(pt.idx).padStart(4, "0")}`;
      contractRows.push({
        id: contractId,
        ptUserId: pt.userId,
        clientUserId: clientReviewerId,
        status: pt.hasContractRestriction ? "ACTIVE" : "COMPLETED",
        packageName: "D0a Rating Contract",
        totalSessions: Math.max(1, pt.ratings.length),
      });

      if (pt.hasContractRestriction) {
        restrictionRows.push({
          id: `${prefix}rst${String(pt.idx).padStart(4, "0")}`,
          ptUserId: pt.userId,
          type: "TEMPORARY_SUSPENSION",
          imposedBy: "admin-d0a",
          scope: "CONTRACT",
          contractId,
        });
      }

      pt.ratings.forEach((rating, rIdx) => {
        const sessionId = `${prefix}s${String(pt.idx).padStart(4, "0")}_${rIdx}`;
        const start = new Date("2026-09-01T10:00:00.000Z");
        const end = new Date("2026-09-01T11:00:00.000Z");
        sessionRows.push({
          id: sessionId,
          contractId,
          clientUserId: clientReviewerId,
          ptUserId: pt.userId,
          status: "COMPLETED",
          scheduledStartAt: start,
          scheduledEndAt: end,
        });
        reviewRows.push({
          id: `${prefix}rev${String(pt.idx).padStart(4, "0")}_${rIdx}`,
          sessionId,
          contractId,
          clientUserId: clientReviewerId,
          rating,
        });
      });
    }

    if (pt.hasOpenAccountRestriction) {
      restrictionRows.push({
        id: `${prefix}rst${String(pt.idx).padStart(4, "0")}`,
        ptUserId: pt.userId,
        type: pt.idx % 2 === 0 ? "TEMPORARY_SUSPENSION" : "PERMANENT_BAN",
        imposedBy: "admin-d0a",
        scope: "ACCOUNT",
      });
    }
    if (pt.hasEndedAccountRestriction) {
      restrictionRows.push({
        id: `${prefix}rst${String(pt.idx).padStart(4, "0")}`,
        ptUserId: pt.userId,
        type: "TEMPORARY_SUSPENSION",
        imposedBy: "admin-d0a",
        scope: "ACCOUNT",
        endedAt: new Date("2026-09-15T00:00:00.000Z"),
        endKind: "LIFTED",
      });
    }
  }

  for (const batch of chunkArray(contractRows, 1000)) {
    await prisma.contract.createMany({ data: batch });
  }
  for (const batch of chunkArray(sessionRows, 1000)) {
    await prisma.session.createMany({ data: batch });
  }
  for (const batch of chunkArray(reviewRows, 1000)) {
    await prisma.sessionReview.createMany({ data: batch });
  }
  for (const batch of chunkArray(restrictionRows, 1000)) {
    await prisma.ptRestriction.createMany({ data: batch });
  }

  app = await startApp();
  viewerToken = tokenFor(viewerId, "CUSTOMER");
});

test.after(async () => {
  if (app) await app.close();
  await cleanupFixture();
  console.info(`[pt-discovery-d0a] completed in ${Date.now() - startedAtMs} ms`);
});

// ── Independent reference computations (never import pt-discovery.query.ts) ───────────────────

function refIsVisible(pt: SimPt): boolean {
  return pt.isPT && !pt.ptSuspended && pt.appStatus === "APPROVED" && !pt.hasOpenAccountRestriction;
}

function refFromPrice(pt: SimPt, sessionMode?: string): number | null {
  const usable = pt.packages.filter((p) => {
    if (!p.isActive || p.archivedAt !== null || p.sessionCount < 1 || p.price <= 0) return false;
    if (sessionMode === "ONLINE" || sessionMode === "OFFLINE") return p.sessionMode === sessionMode;
    return true;
  });
  if (usable.length === 0) return null;
  const minPerSession = Math.min(...usable.map((p) => p.price / p.sessionCount));
  return Math.floor(minPerSession / 1000) * 1000;
}

function refAvgRating(pt: SimPt): number | null {
  if (pt.ratings.length === 0) return null;
  const avg = pt.ratings.reduce((a, b) => a + b, 0) / pt.ratings.length;
  return Math.round(avg * 10) / 10;
}

function refSortIds(
  pts: SimPt[],
  sortBy: string | undefined,
  sessionMode?: string,
  viewerGymIds: string[] = [],
): string[] {
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const gymSet = new Set(viewerGymIds);
  const hasActiveGym = (pt: SimPt) =>
    gymSet.size > 0 && pt.activeLocations.some((l) => l.gymId && gymSet.has(l.gymId));
  const copy = [...pts];
  copy.sort((a, b) => {
    if (sortBy === "nameAsc") {
      const c = cmpStr(a.firstName, b.firstName);
      return c !== 0 ? c : cmpStr(a.userId, b.userId);
    }
    if (sortBy === "priceAsc" || sortBy === "priceDesc") {
      const pa = refFromPrice(a, sessionMode);
      const pb = refFromPrice(b, sessionMode);
      if (pa === null && pb === null) return cmpStr(a.userId, b.userId);
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return sortBy === "priceAsc" ? pa - pb : pb - pa;
      return cmpStr(a.userId, b.userId);
    }
    if (sortBy === "ratingDesc" || sortBy === "ratingAsc") {
      const ra = refAvgRating(a);
      const rb = refAvgRating(b);
      if (ra === null && rb === null) return cmpStr(a.userId, b.userId);
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (ra !== rb) return sortBy === "ratingAsc" ? ra - rb : rb - ra;
      return cmpStr(a.userId, b.userId);
    }
    if (a.isAcceptingClients !== b.isAcceptingClients) {
      return a.isAcceptingClients ? -1 : 1;
    }
    if (gymSet.size > 0) {
      const ga = hasActiveGym(a);
      const gb = hasActiveGym(b);
      if (ga !== gb) return ga ? -1 : 1;
    }
    const dt = b.createdAt.getTime() - a.createdAt.getTime();
    return dt !== 0 ? dt : cmpStr(a.userId, b.userId);
  });
  return copy.map((p) => p.userId);
}

async function fetchAllPages(queryBase: string): Promise<{ ids: string[]; pages: any[][] }> {
  const ids: string[] = [];
  const pages: any[][] = [];
  let page = 1;
  while (true) {
    const r = await app.call("GET", `/profile/pts?${queryBase}&limit=${PAGE_LIMIT}&page=${page}`, viewerToken);
    assert.equal(r.status, 200, `page ${page} failed: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.pts), "response preserves { pts } array");
    assert.equal(typeof r.body.hasMore, "boolean", "response includes boolean hasMore");
    assert.ok(r.body.pts.length <= PAGE_LIMIT, `page ${page} length <= ${PAGE_LIMIT}`);
    pages.push(r.body.pts);
    for (const pt of r.body.pts) ids.push(pt.userId);
    if (!r.body.hasMore) break;
    page++;
    assert.ok(page <= 150, "pagination safety guard exceeded");
  }
  const pastEnd = await app.call("GET", `/profile/pts?${queryBase}&limit=${PAGE_LIMIT}&page=${page + 1}`, viewerToken);
  assert.equal(pastEnd.status, 200);
  assert.deepEqual(pastEnd.body.pts, []);
  assert.equal(pastEnd.body.hasMore, false);
  return { ids, pages };
}

// ── 1. Visibility equivalence & 404 detail check ──────────────────────────────────────────────

test("D0a visibility: SQL candidate set equals ptPublicWhere exactly; hidden PTs return 404 on detail", async () => {
  const expectedViaPrisma = (
    await prisma.userProfile.findMany({
      where: { AND: [await ptPublicWhere(), { userId: { startsWith: prefix } }] },
      select: { userId: true },
    })
  ).map((r) => r.userId);

  const expectedVisible = simPts.filter(refIsVisible).map((p) => p.userId);
  assert.equal(expectedVisible.length, VISIBLE_PTS);
  assert.deepEqual(new Set(expectedViaPrisma), new Set(expectedVisible), "fixture matches ptPublicWhere");

  const { ids } = await fetchAllPages(`q=${encodeURIComponent(tag)}`);
  assert.equal(new Set(ids).size, ids.length, "no duplicate PT IDs across all pages");
  assert.deepEqual(new Set(ids), new Set(expectedViaPrisma), "endpoint candidate set matches ptPublicWhere");

  // Sample hidden PTs from every category must return 404 on detail
  for (const hiddenIdx of [4700, 4760, 4820, 4880, 4940, 4941]) {
    const d = await app.call("GET", `/profile/pts/${simPts[hiddenIdx].userId}`, viewerToken);
    assert.equal(d.status, 404, `hidden PT idx=${hiddenIdx} must return 404`);
  }
  // Visible edge cases (lifted ACCOUNT restriction + open CONTRACT restriction) return 200
  for (const visibleIdx of [10, 20]) {
    const d = await app.call("GET", `/profile/pts/${simPts[visibleIdx].userId}`, viewerToken);
    assert.equal(d.status, 200, `visible PT idx=${visibleIdx} must return 200`);
  }
});

// ── 2. Exhaustive multi-page pagination across all sort modes ─────────────────────────────────

for (const sortMode of [undefined, "nameAsc", "priceAsc", "priceDesc", "ratingDesc", "ratingAsc"] as const) {
  test(`D0a global sort & full pagination (${sortMode ?? "newest/default"}): 0 duplicates, 0 omissions, matches independent reference across 4,700 visible PTs`, async () => {
    const visiblePts = simPts.filter(refIsVisible);
    const expectedOrder = refSortIds(visiblePts, sortMode);

    const qs = `q=${encodeURIComponent(tag)}${sortMode ? `&sortBy=${sortMode}` : ""}`;
    const { ids, pages } = await fetchAllPages(qs);

    assert.equal(ids.length, VISIBLE_PTS, "total returned count equals expected visible count");
    assert.equal(new Set(ids).size, VISIBLE_PTS, "zero duplicates across all pages");
    assert.deepEqual(ids, expectedOrder, `exact global order for ${sortMode ?? "default"}`);
    assert.equal(pages[0].length, PAGE_LIMIT);

    // Verify PTs well beyond position 1,000 in default order reach their true global position
    if (sortMode === undefined) {
      // Every non-accepting PT (including idx 0 & 1 with newest createdAt) must appear AFTER every accepting PT
      const firstNonAcceptingIdx = ids.findIndex((id) => !simByUserId.get(id)!.isAcceptingClients);
      assert.ok(firstNonAcceptingIdx > 0, "accepting PTs appear before non-accepting PTs");
      for (let k = firstNonAcceptingIdx; k < ids.length; k++) {
        assert.equal(simByUserId.get(ids[k])!.isAcceptingClients, false, "all non-accepting PTs stay at the tail");
      }
      assert.equal(ids[firstNonAcceptingIdx], simPts[0].userId, "newest non-accepting idx 0 sits at start of tail");
      assert.equal(ids[firstNonAcceptingIdx + 1], simPts[1].userId, "newest non-accepting idx 1 sits right after idx 0");
    } else if (sortMode === "priceAsc") {
      assert.equal(ids[0], simPts[3500].userId, "idx 3500 (>1000) cheapest PT lands at #1");
      assert.equal(ids[1], simPts[1].userId, "when sortBy=priceAsc is set, non-accepting PT (60k) is NOT sunk to bottom");
    } else if (sortMode === "priceDesc") {
      assert.equal(ids[0], simPts[3501].userId, "idx 3501 (>1000) priciest PT lands at #1");
    } else if (sortMode === "ratingDesc") {
      assert.equal(ids[0], simPts[3502].userId, "idx 3502 (>1000) 5.0★ PT lands at #1");
    }

    // NULLS LAST invariant for both directions of rating and price
    if (sortMode === "ratingDesc" || sortMode === "ratingAsc") {
      const firstUnratedIdx = ids.findIndex((id) => refAvgRating(simByUserId.get(id)!) === null);
      assert.ok(firstUnratedIdx > 0, "rated PTs appear first");
      for (let k = firstUnratedIdx; k < ids.length; k++) {
        assert.equal(refAvgRating(simByUserId.get(ids[k])!), null, "all unrated PTs stay at the tail");
      }
    }
    if (sortMode === "priceAsc" || sortMode === "priceDesc") {
      const firstNoPriceIdx = ids.findIndex((id) => refFromPrice(simByUserId.get(id)!) === null);
      assert.ok(firstNoPriceIdx > 0, "priced PTs appear first");
      for (let k = firstNoPriceIdx; k < ids.length; k++) {
        assert.equal(refFromPrice(simByUserId.get(ids[k])!), null, "all zero-package PTs stay at the tail");
      }
    }
  });
}

// ── 3. Unfiltered global query (no `q`) matches independent SQL reference ──────────────────────

test("D0a unfiltered global GET /profile/pts (without q) matches independent SQL reference on page 1", async () => {
  for (const [sortBy, orderExpr] of [
    ["priceAsc", "from_price ASC NULLS LAST"],
    ["ratingDesc", "avg_rating DESC NULLS LAST"],
  ] as const) {
    const r = await app.call("GET", `/profile/pts?sortBy=${sortBy}&limit=50&page=1`, viewerToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.pts.length, 50);
    assert.equal(r.body.hasMore, true);

    const refRows = await prisma.$queryRawUnsafe<{ userId: string }[]>(`
      SELECT p."userId"
      FROM user_profiles p
      JOIN pt_applications pa ON pa.user_profile_id = p.id
      LEFT JOIN (
        SELECT pt_user_id, FLOOR(MIN(price / session_count) / 1000) * 1000 AS from_price
        FROM pt_service_packages
        WHERE is_active = true AND archived_at IS NULL AND session_count >= 1 AND price > 0
        GROUP BY pt_user_id
      ) pr ON pr.pt_user_id = p."userId"
      LEFT JOIN (
        SELECT s.pt_user_id, ROUND(AVG(r.rating)::numeric, 1) AS avg_rating
        FROM session_reviews r
        JOIN sessions s ON s.id = r.session_id
        GROUP BY s.pt_user_id
      ) rt ON rt.pt_user_id = p."userId"
      WHERE p."isPT" = true
        AND p.pt_suspended = false
        AND pa.status = 'APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM pt_restrictions r
          WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT'
        )
      ORDER BY ${orderExpr}, p."userId" ASC
      LIMIT 50
    `);
    assert.deepEqual(
      (r.body.pts as any[]).map((x) => x.userId),
      refRows.map((x) => x.userId),
      `unfiltered page 1 for ${sortBy} matches independent SQL reference`,
    );
  }
});

// ── 4. Mode, price, specialty, location, gymId filters & areaProvince/areaWard badges ─────────

test("D0a filters: sessionMode + price consistency, specialties, province/ward, gymId, and area matchReason", async () => {
  // OFFLINE: serviceMode in {OFFLINE, HYBRID} AND >= 1 active location AND >= 1 for-sale OFFLINE package
  const expectedOffline = simPts.filter(
    (p) =>
      refIsVisible(p) &&
      (p.serviceMode === "OFFLINE" || p.serviceMode === "HYBRID") &&
      p.activeLocations.length > 0 &&
      p.packages.some((pkg) => pkg.isActive && pkg.archivedAt === null && pkg.sessionCount >= 1 && pkg.price > 0 && pkg.sessionMode === "OFFLINE"),
  );
  const offlineRes = await fetchAllPages(`q=${encodeURIComponent(tag)}&sessionMode=OFFLINE&sortBy=priceAsc`);
  assert.deepEqual(offlineRes.ids, refSortIds(expectedOffline, "priceAsc", "OFFLINE"));
  assert.ok(!offlineRes.ids.includes(simPts[1100].userId), "HYBRID with only inactive location excluded from OFFLINE");
  assert.ok(!offlineRes.ids.includes(simPts[1101].userId), "OFFLINE with only archived/inactive pkg excluded");
  assert.ok(!offlineRes.ids.includes(simPts[1102].userId), "HYBRID with only ONLINE pkg excluded from OFFLINE");

  // ONLINE: serviceMode in {ONLINE, HYBRID} AND >= 1 for-sale ONLINE package
  const expectedOnline = simPts.filter(
    (p) =>
      refIsVisible(p) &&
      (p.serviceMode === "ONLINE" || p.serviceMode === "HYBRID") &&
      p.packages.some((pkg) => pkg.isActive && pkg.archivedAt === null && pkg.sessionCount >= 1 && pkg.price > 0 && pkg.sessionMode === "ONLINE"),
  );
  const onlineRes = await fetchAllPages(`q=${encodeURIComponent(tag)}&sessionMode=ONLINE&sortBy=priceAsc`);
  assert.deepEqual(onlineRes.ids, refSortIds(expectedOnline, "priceAsc", "ONLINE"));
  assert.ok(onlineRes.ids.includes(simPts[1100].userId), "HYBRID without active location still matches ONLINE");
  assert.ok(onlineRes.ids.includes(simPts[1102].userId), "HYBRID with ONLINE pkg matches ONLINE");
  assert.ok(!onlineRes.ids.includes(simPts[1103].userId), "ONLINE without ONLINE pkg excluded from ONLINE");

  // HYBRID: preserves existing behavior (serviceMode='HYBRID')
  const expectedHybrid = simPts.filter((p) => refIsVisible(p) && p.serviceMode === "HYBRID");
  const hybridRes = await fetchAllPages(`q=${encodeURIComponent(tag)}&sessionMode=HYBRID`);
  assert.deepEqual(new Set(hybridRes.ids), new Set(expectedHybrid.map((p) => p.userId)));

  // Zero-package visible PT (idx 25): listed when no sessionMode/price filter, excluded when price filter set
  const zeroPkgPt = simPts[25];
  assert.equal(zeroPkgPt.packages.length, 0);
  const noFilterPage = await app.call("GET", `/profile/pts?q=${encodeURIComponent(zeroPkgPt.firstName)}&limit=50`, viewerToken);
  assert.equal(noFilterPage.status, 200);
  assert.ok((noFilterPage.body.pts as any[]).some((p) => p.userId === zeroPkgPt.userId), "0-package PT listed without mode/price filter");
  const minPriceZero = await app.call("GET", `/profile/pts?q=${encodeURIComponent(zeroPkgPt.firstName)}&minPrice=0&limit=50`, viewerToken);
  assert.equal(minPriceZero.status, 200);
  assert.ok(!(minPriceZero.body.pts as any[]).some((p) => p.userId === zeroPkgPt.userId), "0-package PT excluded by minPrice=0");

  // Mode + price consistency (minPrice=45000&maxPrice=90000): idx 3500 has OFFLINE 50k & ONLINE 80k
  const priceOffline = await app.call(
    "GET",
    `/profile/pts?q=${encodeURIComponent(tag)}&sessionMode=OFFLINE&minPrice=70000&maxPrice=90000&limit=50`,
    viewerToken,
  );
  assert.equal(priceOffline.status, 200);
  assert.ok(
    !(priceOffline.body.pts as any[]).some((p) => p.userId === simPts[3500].userId),
    "idx 3500's 80k ONLINE package must not match OFFLINE price filter",
  );
  const priceOnline = await app.call(
    "GET",
    `/profile/pts?q=${encodeURIComponent(tag)}&sessionMode=ONLINE&minPrice=70000&maxPrice=90000&limit=50`,
    viewerToken,
  );
  assert.equal(priceOnline.status, 200);
  assert.ok(
    (priceOnline.body.pts as any[]).some((p) => p.userId === simPts[3500].userId),
    "idx 3500's 80k ONLINE package matches ONLINE price filter",
  );

  // Server-side specialties filter (standalone & combined)
  const specOnly = await app.call("GET", `/profile/pts?specialties=${encodeURIComponent(uniqueSpecialty)}&limit=50`, viewerToken);
  assert.equal(specOnly.status, 200);
  assert.deepEqual((specOnly.body.pts as any[]).map((p) => p.userId), [simPts[1500].userId]);
  assert.equal(specOnly.body.hasMore, false);

  const expectedYogaOrBoxing = simPts.filter(
    (p) => refIsVisible(p) && (p.specialties.includes("YOGA") || p.specialties.includes("BOXING")),
  );
  const specMulti = await fetchAllPages(`q=${encodeURIComponent(tag)}&specialties=YOGA,BOXING`);
  assert.deepEqual(new Set(specMulti.ids), new Set(expectedYogaOrBoxing.map((p) => p.userId)));

  // provinceCode / wardCode filter: multi-location PT appears once; inactive location does not match
  const expectedProvA = simPts.filter(
    (p) => refIsVisible(p) && p.activeLocations.some((l) => l.provinceCode === PROV_A),
  );
  const provARes = await fetchAllPages(`q=${encodeURIComponent(tag)}&provinceCode=${PROV_A}`);
  assert.equal(new Set(provARes.ids).size, provARes.ids.length, "multi-location PT in same province appears once");
  assert.deepEqual(new Set(provARes.ids), new Set(expectedProvA.map((p) => p.userId)));
  assert.ok(!provARes.ids.includes(simPts[1100].userId), "inactive location does not match provinceCode");

  // gymId filter matches findPTs behavior
  const gymRes = await app.call("GET", `/profile/pts?q=${encodeURIComponent(tag)}&gymId=${encodeURIComponent(gymFilterId)}&limit=50`, viewerToken);
  assert.equal(gymRes.status, 200);
  assert.deepEqual(
    new Set((gymRes.body.pts as any[]).map((p) => p.userId)),
    new Set([simPts[1200].userId, simPts[2400].userId]),
  );

  // areaProvince & areaWard compute matchReason without changing SQL sort order
  const baseline = await app.call("GET", `/profile/pts?q=${encodeURIComponent(tag)}&sortBy=nameAsc&limit=50&page=1`, viewerToken);
  const withArea = await app.call(
    "GET",
    `/profile/pts?q=${encodeURIComponent(tag)}&sortBy=nameAsc&limit=50&page=1&areaProvince=${PROV_A}&areaWard=${WARD_A1}`,
    viewerToken,
  );
  assert.equal(withArea.status, 200);
  assert.deepEqual(
    (withArea.body.pts as any[]).map((p) => p.userId),
    (baseline.body.pts as any[]).map((p) => p.userId),
    "areaProvince/areaWard never alters SQL order in D0a",
  );
  for (const pt of withArea.body.pts as any[]) {
    const locs = pt.trainingLocations as any[];
    const hasWard = locs.some((l) => l.provinceCode === PROV_A && l.wardCode === WARD_A1);
    const hasProv = locs.some((l) => l.provinceCode === PROV_A);
    const expectedReason = hasWard ? "SAME_WARD" : hasProv ? "SAME_PROVINCE" : null;
    assert.equal(pt.matchReason, expectedReason);
  }
});

// ── 5. Pagination bounds & invalid input 400 checks ───────────────────────────────────────────

test("D0a validation: limit=100 clamps to 50; invalid limit/page/areaProvince/areaWard return 400", async () => {
  const clamped = await app.call("GET", `/profile/pts?q=${encodeURIComponent(tag)}&limit=100`, viewerToken);
  assert.equal(clamped.status, 200);
  assert.equal(clamped.body.pts.length, 50, "limit=100 is clamped to 50");
  assert.equal(clamped.body.hasMore, true);

  const badPaths = [
    "/profile/pts?limit=0",
    "/profile/pts?limit=-5",
    "/profile/pts?limit=abc",
    "/profile/pts?limit=1.5",
    "/profile/pts?limit=",
    "/profile/pts?page=0",
    "/profile/pts?page=-1",
    "/profile/pts?page=NaN",
    "/profile/pts?page=2.5",
    "/profile/pts?page=",
    "/profile/pts?areaProvince=abc",
    "/profile/pts?areaProvince=1.5",
    `/profile/pts?areaWard=${WARD_A1}`,
    `/profile/pts?areaProvince=${PROV_A}&areaWard=xyz`,
    "/profile/pts?provinceCode=abc",
    `/profile/pts?wardCode=${WARD_A1}`,
    "/profile/pts?minPrice=-1",
    "/profile/pts?minPrice=abc",
    "/profile/pts?minPrice=500&maxPrice=100",
  ];
  for (const path of badPaths) {
    const res = await app.call("GET", path, viewerToken);
    assert.equal(res.status, 400, `${path} must return 400, got ${res.status}`);
  }
});

// ── 6. SAME_GYM default ranking at function level (BACKEND INTEGRATION, no outbound gym-service) ──

test("D0a default order SAME_GYM via findDiscoveryPtPageIds: active gymX prioritized, inactive gymX ignored, non-accepting still last, sortBy unaffected", async () => {
  const visiblePts = simPts.filter(refIsVisible);

  // With viewerGymIds=[gymX]: active gymX accepting PTs (2500, 2501) jump to top in createdAt DESC order,
  // inactive gymX (idx 5) is NOT promoted, non-accepting active gymX (idx 2502) stays in non-accepting tail.
  const withGym = await findDiscoveryPtPageIds({
    q: tag,
    viewerGymIds: [gymX],
    page: 1,
    limit: PAGE_LIMIT,
  });
  const expectedWithGym = refSortIds(visiblePts, undefined, undefined, [gymX]);
  assert.deepEqual(withGym.userIds, expectedWithGym.slice(0, PAGE_LIMIT));
  assert.equal(withGym.userIds[0], simPts[2500].userId);
  assert.equal(withGym.userIds[1], simPts[2501].userId);
  assert.equal(withGym.userIds.filter((id) => id === simPts[2501].userId).length, 1, "multi-location gymX PT appears once");
  assert.ok(!withGym.userIds.includes(simPts[2502].userId), "non-accepting gymX PT stays after accepting PTs");
  assert.ok(withGym.userIds.indexOf(simPts[5].userId) > 1, "inactive gymX PT is not promoted ahead of active gymX");

  // Empty viewerGymIds preserves the exact default HTTP order (createdAt DESC inside accepting group)
  const emptyGym = await findDiscoveryPtPageIds({
    q: tag,
    viewerGymIds: [],
    page: 1,
    limit: PAGE_LIMIT,
  });
  assert.deepEqual(emptyGym.userIds, refSortIds(visiblePts, undefined, undefined, []).slice(0, PAGE_LIMIT));
  assert.equal(emptyGym.userIds[0], simPts[2].userId);

  // Explicit sortBy ignores viewerGymIds and is_accepting_clients
  const priceWithGym = await findDiscoveryPtPageIds({
    q: tag,
    sortBy: "priceAsc",
    viewerGymIds: [gymX],
    page: 1,
    limit: PAGE_LIMIT,
  });
  assert.deepEqual(priceWithGym.userIds, refSortIds(visiblePts, "priceAsc").slice(0, PAGE_LIMIT));
  assert.equal(priceWithGym.userIds[0], simPts[3500].userId);
  assert.equal(priceWithGym.userIds[1], simPts[1].userId);
});

