/**
 * D0b-2 integration suite: `POST /profile/pts/search`, Haversine distance (LATERAL), Q5 ward-centroid
 * fallback (and empty `vietnam_ward_geo` behavior), scope filtering (`near` | `province` | `national`),
 * tiered ordering, encrypted epoch-bound keyset pagination (incl. NULLS LAST boundaries),
 * 409 CURSOR_EXPIRED / CURSOR_FILTER_MISMATCH, 400 param bounds, 503 secret fail-closed,
 * `SET LOCAL statement_timeout = '2s'`, privacy log guarantee, and `GET /profile/pts` stats-backed sort.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + real PostgreSQL *_test DB;
 * auth-service identity lookup uses TEST FIXTURE token map).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { buildDiscoveryStatsEpoch } from "../services/pt-discovery-stats.service";
import { searchDiscoveryPtPageIds } from "../services/pt-discovery.query";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

const TOTAL_PTS = 5000;
const PAGE_LIMIT = 50;

const tag = randomUUID().replace(/-/g, "").slice(0, 6);
const prefix = `d0b2_${tag}_`;
const focusedTag = `foc${tag}`;
const nullSliceTag = `nul${tag}`;
const gymX = `gymx_${tag}`;
const gymFilterId = `gymf_${tag}`;
const viewerId = `${prefix}viewer`;
const clientReviewerId = `${prefix}client`;

// Unique mock provinces & wards (no collision with D0a/D0b-1 codes)
const PROV_A = 990301; // e.g., Ho Chi Minh-like anchor around (10.776, 106.701)
const PROV_B = 990302; // adjacent province across border around (10.790, 106.720) — ~2.6 km from viewer
const WARD_A1 = 99030101; // (10.776, 106.701)
const WARD_A2 = 99030102; // (10.785, 106.710) — used for Q5 missing-coord location fallback
const WARD_A_NOGEO = 99030103; // deliberately has NO row in vietnam_ward_geo
const WARD_B1 = 99030201; // (10.791, 106.721)

// Viewer point just inside PROV_A border, ~2.7 km from WARD_B1 in PROV_B
const VIEWER_LAT = 10.776;
const VIEWER_LNG = 106.701;

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

type SimLocation = {
  provinceCode: number;
  wardCode: number;
  latitude: number | null;
  longitude: number | null;
  gymId?: string | null;
  isActive: boolean;
};

type SimPt = {
  idx: number;
  userId: string;
  profileId: string;
  applicationId: string;
  firstName: string;
  isPT: boolean;
  ptSuspended: boolean;
  isAcceptingClients: boolean;
  serviceMode: "ONLINE" | "OFFLINE" | "HYBRID";
  locations: SimLocation[];
  packages: SimPackage[];
  ratings: number[];
  specialties: string[];
  createdAt: Date;
};

const simPts: SimPt[] = [];
const simByUserId = new Map<string, SimPt>();
const trackedEpochIds = new Set<number>();
const suiteStartedAt = new Date(Date.now() - 5000);
let app: App;
let viewerToken: string;

const WARD_CENTROIDS = new Map<number, { lat: number; lng: number }>([
  [WARD_A1, { lat: 10.776, lng: 106.701 }],
  [WARD_A2, { lat: 10.785, lng: 106.71 }],
  [WARD_B1, { lat: 10.791, lng: 106.721 }],
]);

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371.0 * 2.0 * Math.asin(Math.sqrt(Math.min(1.0, a)));
}

function widthBucket(d: number): number {
  const edges = [0, 2, 5, 10, 20, 50, 100];
  if (d < edges[0]) return 0;
  for (let i = 0; i < edges.length - 1; i++) {
    if (d >= edges[i] && d < edges[i + 1]) return i + 1;
  }
  return edges.length;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildDataset(): void {
  const baseTime = new Date("2026-10-15T12:00:00.000Z").getTime();

  // Named focused test cohorts inside the 5,000 PTs:
  //   idx 0: PROV_A, 30 km away (~11.045, 106.701) -> bucket 5, same province yet FAR
  //   idx 1: PROV_B across border, 2.7 km away (10.791, 106.721) -> bucket 2, NEAR (must beat idx 0!)
  //   idx 2: PROV_A, 1.1 km away (10.786, 106.701) -> bucket 1
  //   idx 3: HYBRID with gym 50 km away (~11.225, 106.701) AND ONLINE pkg -> tier 1 in mode=ANY, scope=near
  //   idx 4: HYBRID with gym 50 km away and ONLY OFFLINE pkg -> excluded in mode=ANY, scope=near
  //   idx 5: Pure ONLINE PT -> tier 1 in mode=ANY, scope=near (distanceKm: null)
  //   idx 6: Q5 missing coords (latitude=null, longitude=null, wardCode=WARD_A2) -> ~1.4 km via centroid
  //   idx 7: Multi-province PT: gym in PROV_A at ~12 km (10.884, 106.701) & gym in PROV_B at ~1.5 km (10.789, 106.701)
  //          -> tests scope=province for PROV_A picks ~12 km, NOT 1.5 km!
  //   idx 8..13 (nullSliceTag): 6 PTs testing NULLS LAST pagination cuts cleanly (rated & unrated, priced)
  //   idx 14..4999: spread across coordinates (0.2 km to 95 km), modes, ratings, prices, accepting/suspended

  for (let idx = 0; idx < TOTAL_PTS; idx++) {
    const pad = String(idx).padStart(4, "0");
    const userId = `${prefix}${pad}`;
    const profileId = `${prefix}p${pad}`;
    const applicationId = `${prefix}a${pad}`;

    let firstName = `${tag}B${pad}`;
    if (idx >= 0 && idx <= 7) firstName = `${focusedTag}_${idx}`;
    if (idx >= 8 && idx <= 13) firstName = `${nullSliceTag}_${idx}`;

    const createdAt = new Date(baseTime - idx * 1000);
    const isPT = idx < 4950;
    const ptSuspended = idx >= 4950 && idx < 4980;
    const isAcceptingClients = idx === 8 || idx === 9 || idx === 10 || idx === 11 || idx === 12 || idx === 13 ? true : idx % 15 !== 0;

    let serviceMode: SimPt["serviceMode"] = idx % 10 < 5 ? "OFFLINE" : idx % 10 < 8 ? "HYBRID" : "ONLINE";
    if (idx === 0 || idx === 1 || idx === 2 || idx === 6 || idx === 7) serviceMode = "OFFLINE";
    if (idx === 3 || idx === 4) serviceMode = "HYBRID";
    if (idx === 5) serviceMode = "ONLINE";
    if (idx >= 8 && idx <= 13) serviceMode = "OFFLINE";

    const locations: SimLocation[] = [];
    if (idx === 0) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A1, latitude: 11.046, longitude: 106.701, isActive: true });
    } else if (idx === 1) {
      locations.push({ provinceCode: PROV_B, wardCode: WARD_B1, latitude: 10.791, longitude: 106.721, isActive: true });
    } else if (idx === 2) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A1, latitude: 10.786, longitude: 106.701, isActive: true });
    } else if (idx === 3 || idx === 4) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A1, latitude: 11.225, longitude: 106.701, isActive: true });
    } else if (idx === 6) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A2, latitude: null, longitude: null, isActive: true });
    } else if (idx === 7) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A1, latitude: 10.884, longitude: 106.701, isActive: true });
      locations.push({ provinceCode: PROV_B, wardCode: WARD_B1, latitude: 10.789, longitude: 106.701, isActive: true });
    } else if (idx >= 8 && idx <= 13) {
      locations.push({ provinceCode: PROV_A, wardCode: WARD_A1, latitude: 10.78 + (idx - 8) * 0.001, longitude: 106.701, isActive: true });
    } else if (serviceMode !== "ONLINE") {
      // Deterministic grid from ~0.3 km to ~80 km around (VIEWER_LAT, VIEWER_LNG)
      const angle = ((idx * 137.5) % 360) * (Math.PI / 180);
      const radiusDeg = 0.003 + ((idx * 19) % 75) * 0.01;
      const lat = Math.min(23.5, Math.max(8.5, VIEWER_LAT + radiusDeg * Math.cos(angle)));
      const lng = Math.min(109.5, Math.max(102.5, VIEWER_LNG + radiusDeg * Math.sin(angle)));
      const prov = idx % 3 === 0 ? PROV_B : PROV_A;
      const ward = prov === PROV_A ? WARD_A1 : WARD_B1;
      locations.push({
        provinceCode: prov,
        wardCode: ward,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        gymId: idx % 200 === 0 ? gymX : null,
        isActive: true,
      });
    }

    const packages: SimPackage[] = [];
    const addPkg = (suffix: string, mode: "ONLINE" | "OFFLINE", count: number, price: number) => {
      packages.push({
        id: `${prefix}pkg_${pad}_${suffix}`,
        ptUserId: userId,
        name: `Pkg ${suffix}`,
        sessionCount: count,
        price,
        sessionMode: mode,
        sessionDurationMinutes: 60,
        isActive: true,
        archivedAt: null,
      });
    };

    if (idx === 4) {
      addPkg("off", "OFFLINE", 5, 250_000 * 5);
    } else if (idx === 3) {
      addPkg("off", "OFFLINE", 5, 250_000 * 5);
      addPkg("on", "ONLINE", 4, 200_000 * 4);
    } else if (serviceMode === "ONLINE") {
      addPkg("on", "ONLINE", 5, (180_000 + (idx % 12) * 20_000) * 5);
    } else if (serviceMode === "OFFLINE") {
      addPkg("off", "OFFLINE", 5, (150_000 + (idx % 15) * 20_000) * 5);
    } else {
      addPkg("off", "OFFLINE", 5, (150_000 + (idx % 15) * 20_000) * 5);
      addPkg("on", "ONLINE", 4, (190_000 + (idx % 10) * 20_000) * 4);
    }

    const ratings: number[] = [];
    if (idx === 0) ratings.push(5, 5, 5, 5, 5); // 5.0 high rating even though far!
    else if (idx === 8) ratings.push(5, 5);
    else if (idx === 9) ratings.push(4, 5); // 4.5
    else if (idx === 10) ratings.push(3, 4); // 3.5
    // idx 11, 12, 13 deliberately have NO ratings (NULL in rating_avg) to test NULLS LAST pagination!
    else if (idx > 13 && idx % 5 === 0) {
      const patterns = [[5, 4, 5], [4, 4, 5], [3, 4], [5, 5], [2, 3]];
      ratings.push(...patterns[(idx / 5) % patterns.length]);
    }

    simPts.push({
      idx,
      userId,
      profileId,
      applicationId,
      firstName,
      isPT,
      ptSuspended,
      isAcceptingClients,
      serviceMode,
      locations,
      packages,
      ratings,
      specialties: idx % 2 === 0 ? ["STRENGTH"] : ["YOGA"],
      createdAt,
    });
    simByUserId.set(userId, simPts[simPts.length - 1]);
  }
}

async function cleanupFixture(): Promise<void> {
  if (trackedEpochIds.size > 0) {
    await prisma.ptDiscoveryEpoch.deleteMany({ where: { epoch: { in: [...trackedEpochIds] } } }).catch(() => {});
  }
  await prisma.ptDiscoveryEpoch.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } }).catch(() => {});
  await prisma.sessionReview.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.ptRestriction.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contract.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTTrainingLocation.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTApplication.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: prefix } } });
  await prisma.vietnamWardGeo
    .deleteMany({ where: { wardCode: { in: [WARD_A1, WARD_A2, WARD_B1] } } })
    .catch(() => {});
}

test.before(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PT_DISCOVERY_CURSOR_SECRET = process.env.PT_DISCOVERY_CURSOR_SECRET || "d0b2-test-cursor-secret-32chars!!";

  buildDataset();
  await cleanupFixture();

  await prisma.vietnamProvince.upsert({
    where: { code: PROV_A },
    update: {},
    create: { code: PROV_A, name: "Tỉnh Border A", nameNormalized: "tinh border a" },
  });
  await prisma.vietnamProvince.upsert({
    where: { code: PROV_B },
    update: {},
    create: { code: PROV_B, name: "Tỉnh Border B", nameNormalized: "tinh border b" },
  });
  for (const [code, prov, name] of [
    [WARD_A1, PROV_A, "Phường A1"],
    [WARD_A2, PROV_A, "Phường A2"],
    [WARD_A_NOGEO, PROV_A, "Phường A Không Geo"],
    [WARD_B1, PROV_B, "Phường B1"],
  ] as const) {
    await prisma.vietnamWard.upsert({
      where: { code },
      update: {},
      create: { code, provinceCode: prov, name, nameNormalized: name.toLowerCase() },
    });
  }
  // Insert simulated ward centroids (table is empty otherwise until S0-load)
  for (const [wardCode, { lat, lng }] of WARD_CENTROIDS.entries()) {
    const provCode = wardCode === WARD_B1 ? PROV_B : PROV_A;
    await prisma.vietnamWardGeo.upsert({
      where: { wardCode },
      update: { centroidLat: lat, centroidLng: lng, minLat: lat - 0.01, maxLat: lat + 0.01, minLng: lng - 0.01, maxLng: lng + 0.01 },
      create: {
        wardCode,
        provinceCode: provCode,
        centroidLat: lat,
        centroidLng: lng,
        minLat: lat - 0.01,
        maxLat: lat + 0.01,
        minLng: lng - 0.01,
        maxLng: lng + 0.01,
      },
    });
  }

  const profiles = [
    ...simPts.map((pt) => ({
      id: pt.profileId,
      userId: pt.userId,
      email: `${pt.userId}@d0b2.test.local`,
      firstName: pt.firstName,
      lastName: "Coach",
      firstNameNormalized: pt.firstName.toLowerCase(),
      lastNameNormalized: "coach",
      isPT: pt.isPT,
      ptSuspended: pt.ptSuspended,
      isAcceptingClients: pt.isAcceptingClients,
      specialties: pt.specialties,
      gymId: pt.idx === 7 ? gymFilterId : null,
      createdAt: pt.createdAt,
      updatedAt: pt.createdAt,
    })),
    { id: `${prefix}viewer_p`, userId: viewerId, email: `${viewerId}@d0b2.test.local` },
    { id: `${prefix}client_p`, userId: clientReviewerId, email: `${clientReviewerId}@d0b2.test.local` },
  ];
  for (const b of chunkArray(profiles, 1000)) await prisma.userProfile.createMany({ data: b });

  const apps = simPts.map((pt) => ({
    id: pt.applicationId,
    userProfileId: pt.profileId,
    status: "APPROVED" as const,
    serviceMode: pt.serviceMode,
    approvedAt: pt.createdAt,
  }));
  for (const b of chunkArray(apps, 1000)) await prisma.pTApplication.createMany({ data: b });

  const locs = simPts.flatMap((pt) =>
    pt.locations.map((l, j) => ({
      id: `${prefix}loc_${pt.idx}_${j}`,
      ptUserId: pt.userId,
      provinceCode: l.provinceCode,
      wardCode: l.wardCode,
      latitude: l.latitude,
      longitude: l.longitude,
      gymId: l.gymId ?? null,
      gymName: `Gym ${pt.idx}-${j}`,
      isPrimary: j === 0,
      isActive: l.isActive,
    })),
  );
  for (const b of chunkArray(locs, 1000)) await prisma.pTTrainingLocation.createMany({ data: b });

  for (const b of chunkArray(simPts.flatMap((p) => p.packages), 1000)) {
    await prisma.pTServicePackage.createMany({ data: b });
  }

  const contracts: any[] = [];
  const sessions: any[] = [];
  const reviews: any[] = [];
  for (const pt of simPts) {
    if (pt.ratings.length === 0) continue;
    const contractId = `${prefix}c_${pt.idx}`;
    contracts.push({
      id: contractId,
      ptUserId: pt.userId,
      clientUserId: clientReviewerId,
      status: "COMPLETED",
      packageName: "D0b2 Rating Contract",
      totalSessions: pt.ratings.length,
    });
    pt.ratings.forEach((rating, rIdx) => {
      const sid = `${prefix}s_${pt.idx}_${rIdx}`;
      sessions.push({
        id: sid,
        contractId,
        clientUserId: clientReviewerId,
        ptUserId: pt.userId,
        status: "COMPLETED",
        scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"),
        scheduledEndAt: new Date("2026-08-01T11:00:00.000Z"),
      });
      reviews.push({
        id: `${prefix}r_${pt.idx}_${rIdx}`,
        sessionId: sid,
        contractId,
        clientUserId: clientReviewerId,
        rating,
      });
    });
  }
  for (const b of chunkArray(contracts, 1000)) await prisma.contract.createMany({ data: b });
  for (const b of chunkArray(sessions, 1000)) await prisma.session.createMany({ data: b });
  for (const b of chunkArray(reviews, 1000)) await prisma.sessionReview.createMany({ data: b });

  app = await startApp();
  viewerToken = tokenFor(viewerId, "CUSTOMER");
});

test.after(async () => {
  if (app) await app.close();
  await cleanupFixture();
});

async function postSearch(body: unknown, token: string | null = viewerToken) {
  return app.call("POST", "/profile/pts/search", token, body);
}

test("1. Before any READY epoch: POST /profile/pts/search works (epoch=0), then 409 CURSOR_EXPIRED once READY epoch exists; GET rating/price falls back to D0a", async () => {
  assert.equal(await prisma.ptDiscoveryEpoch.count({ where: { isCurrent: true } }), 0, "clean DB starts with 0 READY epochs");

  const r1 = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 40,
    scope: "near",
    mode: "ANY",
    filters: { q: focusedTag },
    limit: 2,
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.hasMore, true);
  assert.ok(typeof r1.body.nextCursor === "string" && r1.body.nextCursor.startsWith("v1."));
  // Cursor must NEVER contain raw coordinates in clear
  assert.equal(r1.body.nextCursor.includes("10.776"), false);
  assert.equal(r1.body.nextCursor.includes("106.701"), false);

  // GET /profile/pts?sortBy=ratingDesc fallback to D0a when no epoch exists (idx 0 has 5.0★)
  const gPre = await app.call("GET", `/profile/pts?q=${encodeURIComponent(focusedTag)}&sortBy=ratingDesc&limit=10`, viewerToken);
  assert.equal(gPre.status, 200);
  assert.equal(gPre.body.pts[0].userId, simPts[0].userId, "fallback ratingDesc picks 5.0★ idx 0");

  // Build initial READY epoch across all 5,000 PTs
  const built = await buildDiscoveryStatsEpoch();
  assert.equal(built.built, true);
  trackedEpochIds.add(built.epoch!);

  // Reusing epoch=0 cursor now returns 409 CURSOR_EXPIRED (Answer #3)
  const rExpired = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 40,
    scope: "near",
    mode: "ANY",
    filters: { q: focusedTag },
    cursor: r1.body.nextCursor,
    limit: 2,
  });
  assert.equal(rExpired.status, 409);
  assert.equal(rExpired.body.code, "CURSOR_EXPIRED");
});

test("2. Full cursor pagination across 5,000 PTs with coordinates: 0 duplicates, 0 omissions, stable across epoch swap; SAME-PROVINCE far never beats closer PT", async () => {
  // Expected dataset matching q=tag, scope="national", mode="ANY"
  const currentEpoch = await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true } });
  const statRows = await prisma.ptDiscoveryStat.findMany({
    where: { epoch: currentEpoch.epoch, ptUserId: { startsWith: prefix } },
  });
  const qualityById = new Map(statRows.map((s) => [s.ptUserId, s.quality]));

  const visibleWithPkg = simPts.filter((p) => p.isPT && !p.ptSuspended && p.packages.length > 0);
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const expectedOrdered = visibleWithPkg
    .map((pt) => {
      const offline = pt.serviceMode !== "ONLINE" && pt.locations.some((l) => l.isActive);
      const tier = offline ? 0 : 1;
      let minDist: number | null = null;
      if (tier === 0) {
        for (const loc of pt.locations.filter((l) => l.isActive)) {
          const lat = loc.latitude ?? WARD_CENTROIDS.get(loc.wardCode)?.lat ?? null;
          const lng = loc.longitude ?? WARD_CENTROIDS.get(loc.wardCode)?.lng ?? null;
          if (lat !== null && lng !== null) {
            const d = haversineKm(VIEWER_LAT, VIEWER_LNG, lat, lng);
            if (minDist === null || d < minDist) minDist = d;
          }
        }
      }
      const bucket = tier === 0 && minDist !== null ? widthBucket(minDist) : 0;
      return {
        userId: pt.userId,
        tier,
        isAccepting: pt.isAcceptingClients,
        bucket,
        quality: qualityById.get(pt.userId) ?? null,
      };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.isAccepting !== b.isAccepting) return a.isAccepting ? -1 : 1;
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.quality !== b.quality) {
        if (a.quality === null) return 1;
        if (b.quality === null) return -1;
        return b.quality - a.quality;
      }
      return cmpStr(a.userId, b.userId);
    })
    .map((x) => x.userId);

  const seenIds: string[] = [];
  let cursor: string | null = null;
  let pageCount = 0;

  while (true) {
    const res = await postSearch({
      lat: VIEWER_LAT,
      lng: VIEWER_LNG,
      scope: "national",
      mode: "ANY",
      filters: { q: tag },
      cursor,
      limit: PAGE_LIMIT,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.appliedScope, "national");
    for (const pt of res.body.pts as any[]) seenIds.push(pt.userId);
    pageCount += 1;

    // Mid-pagination: build a brand new epoch after page 3 (old epoch remains READY <= 30m!)
    if (pageCount === 3) {
      const midEpoch = await buildDiscoveryStatsEpoch();
      assert.equal(midEpoch.built, true);
      trackedEpochIds.add(midEpoch.epoch!);
    }

    if (!res.body.hasMore) {
      assert.equal(res.body.nextCursor, null);
      break;
    }
    assert.ok(typeof res.body.nextCursor === "string");
    cursor = res.body.nextCursor;
    assert.ok(pageCount <= 120, "pagination safety guard");
  }

  assert.equal(seenIds.length, expectedOrdered.length, "0 omissions across all 5,000 PTs");
  assert.equal(new Set(seenIds).size, expectedOrdered.length, "0 duplicates across all pages even after mid-flight epoch rebuild");
  assert.deepEqual(seenIds, expectedOrdered, "exact global tiered/bucketed/quality order across 5,000 PTs");

  // Border + distance bucket rule check on focusedTag (areaProvince=PROV_A):
  // idx 1 (PROV_B, ~2.7 km) & idx 2 (PROV_A, ~1.1 km) MUST precede idx 0 (PROV_A, ~30 km)
  const nearRes = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 35,
    areaProvince: PROV_A,
    scope: "near",
    mode: "ANY",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(nearRes.status, 200);
  const nearIds = (nearRes.body.pts as any[]).map((p) => p.userId);
  assert.ok(nearIds.includes(simPts[1].userId), "border PT in adjacent PROV_B appears in scope=near");
  assert.ok(nearIds.indexOf(simPts[1].userId) < nearIds.indexOf(simPts[0].userId), "2.7km PROV_B beats 30km PROV_A despite same province");
  assert.ok(nearIds.indexOf(simPts[2].userId) < nearIds.indexOf(simPts[1].userId), "1.1km bucket 1 beats 2.7km bucket 2");
  const pt1Dto = (nearRes.body.pts as any[]).find((p) => p.userId === simPts[1].userId);
  assert.equal(pt1Dto.distanceBasis, "GPS");
  assert.ok(pt1Dto.distanceKm >= 2.0 && pt1Dto.distanceKm <= 3.5);
});

test("3. Scope, HYBRID outside radiusKm -> tier 1 (Answer #1), Q5 ward centroid fallback, province-scoped distanceKm (Answer #4), empty geo fallback", async () => {
  // a) mode=ANY, scope=near, radiusKm=10:
  //    idx 3 (HYBRID 50km + ONLINE pkg) -> tier 1 (distanceKm: null, distanceBasis: null)
  //    idx 4 (HYBRID 50km, OFFLINE only) -> excluded
  //    idx 5 (pure ONLINE) -> tier 1 (distanceKm: null, distanceBasis: null)
  //    idx 6 (Q5 null coords, wardCode=WARD_A2 ~1.4km) -> tier 0 (WARD_A2 centroid fallback!)
  const anyNear = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 10,
    scope: "near",
    mode: "ANY",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(anyNear.status, 200);
  const byId = new Map<string, any>((anyNear.body.pts as any[]).map((p) => [p.userId, p]));
  assert.ok(byId.has(simPts[2].userId), "tier 0 near PT (1.1km)");
  assert.ok(byId.has(simPts[6].userId), "Q5 ward-centroid fallback matches within 10km");
  assert.equal(byId.get(simPts[6].userId).distanceBasis, "GPS");
  assert.ok(byId.get(simPts[6].userId).distanceKm >= 1.0 && byId.get(simPts[6].userId).distanceKm <= 2.0);
  assert.ok(byId.has(simPts[3].userId), "HYBRID outside radiusKm with ONLINE pkg falls into tier 1");
  assert.equal(byId.get(simPts[3].userId).distanceKm, null);
  assert.equal(byId.get(simPts[3].userId).distanceBasis, null);
  assert.ok(byId.has(simPts[5].userId), "pure ONLINE appears in tier 1 even in scope=near");
  assert.equal(byId.get(simPts[5].userId).distanceKm, null);
  assert.ok(!byId.has(simPts[4].userId), "HYBRID outside radiusKm without ONLINE pkg excluded");
  assert.ok(!byId.has(simPts[0].userId), "30km OFFLINE PT excluded by radiusKm=10");

  // Confirm tier ordering: every tier 0 (idx 2, 1, 6) appears BEFORE tier 1 (idx 3, 5)
  const listOrder = (anyNear.body.pts as any[]).map((p) => p.userId);
  assert.ok(listOrder.indexOf(simPts[6].userId) < listOrder.indexOf(simPts[3].userId));

  // b) mode=HYBRID, scope=near, radiusKm=10 retains idx 3 (tier 1) while rejecting non-HYBRID PTs
  const hybridOnly = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 10,
    scope: "near",
    mode: "HYBRID",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(hybridOnly.status, 200);
  assert.deepEqual((hybridOnly.body.pts as any[]).map((p) => p.userId), [simPts[3].userId]);

  // c) mode=OFFLINE excludes idx 3 & 5, retains idx 2, 1, 6, 7 (idx 7 PROV_B loc ~1.5 km)
  const offlineNear = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 10,
    scope: "near",
    mode: "OFFLINE",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(offlineNear.status, 200);
  const offIds = new Set((offlineNear.body.pts as any[]).map((p) => p.userId));
  assert.equal(offIds.has(simPts[3].userId), false);
  assert.equal(offIds.has(simPts[5].userId), false);
  assert.equal(offIds.has(simPts[6].userId), true);

  // d) scope=province with GPS: idx 7 has PROV_A (12 km) and PROV_B (1.5 km) -> distanceKm MUST use PROV_A (~12 km), NOT 1.5 km!
  const provGps = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    areaProvince: PROV_A,
    scope: "province",
    mode: "OFFLINE",
    filters: { q: focusedTag, gymId: gymFilterId },
    limit: 10,
  });
  assert.equal(provGps.status, 200);
  assert.equal(provGps.body.pts.length, 1);
  assert.equal(provGps.body.pts[0].userId, simPts[7].userId);
  assert.ok(provGps.body.pts[0].distanceKm >= 11.5 && provGps.body.pts[0].distanceKm <= 12.5, "province scope computes MIN inside selected province");
  assert.equal(provGps.body.pts[0].distanceBasis, "GPS");

  // e) areaWard present in vietnam_ward_geo (no GPS) -> distanceBasis="WARD_CENTER"
  const wardCenter = await postSearch({
    areaProvince: PROV_A,
    areaWard: WARD_A1,
    radiusKm: 10,
    scope: "near",
    mode: "OFFLINE",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(wardCenter.status, 200);
  assert.equal(wardCenter.body.appliedScope, "near");
  assert.equal(wardCenter.body.pts[0].distanceBasis, "WARD_CENTER");

  // f) Missing centroid in vietnam_ward_geo + scope="near" -> falls back to appliedScope="province", distanceKm=null, distanceBasis=null
  const noGeoFallbackProv = await postSearch({
    areaProvince: PROV_A,
    areaWard: WARD_A_NOGEO,
    scope: "near",
    mode: "OFFLINE",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(noGeoFallbackProv.status, 200);
  assert.equal(noGeoFallbackProv.body.appliedScope, "province");
  for (const pt of noGeoFallbackProv.body.pts as any[]) {
    assert.equal(pt.distanceKm, null);
    assert.equal(pt.distanceBasis, null);
  }

  // g) No GPS, no areaProvince + scope="near" -> appliedScope="national", distanceKm=null
  const noPointNational = await postSearch({
    scope: "near",
    mode: "ANY",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(noPointNational.status, 200);
  assert.equal(noPointNational.body.appliedScope, "national");
  for (const pt of noPointNational.body.pts as any[]) {
    assert.equal(pt.distanceKm, null);
    assert.equal(pt.distanceBasis, null);
  }
});

test("4. Keyset pagination cuts cleanly between non-NULL and NULL values (NULLS LAST) + active sortBy (tier, sortKey, userId) ignores bucket/accepting", async () => {
  // nullSliceTag PTs: idx 8 (5.0★), idx 9 (4.5★), idx 10 (3.5★), idx 11/12/13 (unrated -> rating_avg = NULL)
  // Cut page size = 2:
  //   Page 1: [8 (5.0), 9 (4.5)]
  //   Page 2: [10 (3.5), NULL_first] -> cuts right across value->NULL boundary!
  //   Page 3: [NULL_second, NULL_third] -> cuts inside NULL group!
  const collected: string[] = [];
  let cursor: string | null = null;
  for (let p = 0; p < 3; p++) {
    const r = await postSearch({
      lat: VIEWER_LAT,
      lng: VIEWER_LNG,
      radiusKm: 50,
      scope: "near",
      mode: "OFFLINE",
      sortBy: "ratingDesc",
      filters: { q: nullSliceTag },
      cursor,
      limit: 2,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.pts.length, 2);
    for (const item of r.body.pts as any[]) collected.push(item.userId);
    cursor = r.body.nextCursor;
    assert.equal(r.body.hasMore, p < 2);
  }

  const nullGroupSortedById = [simPts[11].userId, simPts[12].userId, simPts[13].userId].sort();
  assert.deepEqual(collected, [simPts[8].userId, simPts[9].userId, simPts[10].userId, ...nullGroupSortedById]);

  // Also test cut right AFTER last non-null value (limit=3 -> exact non-null/NULL split -> Page 2 sees all 3 NULLs!)
  const split1 = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 50,
    scope: "near",
    mode: "OFFLINE",
    sortBy: "ratingDesc",
    filters: { q: nullSliceTag },
    limit: 3,
  });
  assert.equal(split1.status, 200);
  assert.deepEqual((split1.body.pts as any[]).map((x) => x.userId), [simPts[8].userId, simPts[9].userId, simPts[10].userId]);
  const split2 = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 50,
    scope: "near",
    mode: "OFFLINE",
    sortBy: "ratingDesc",
    filters: { q: nullSliceTag },
    cursor: split1.body.nextCursor,
    limit: 3,
  });
  assert.equal(split2.status, 200);
  assert.deepEqual((split2.body.pts as any[]).map((x) => x.userId), nullGroupSortedById);
  assert.equal(split2.body.hasMore, false);

  // Active sortBy=distance skips bucket & accepting; tier 0 -> tier 1 still holds
  const distSort = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 50,
    scope: "near",
    mode: "ANY",
    sortBy: "distance",
    filters: { q: focusedTag },
    limit: 50,
  });
  assert.equal(distSort.status, 200);
  const dPts = distSort.body.pts as any[];
  const tier0Dists = dPts.filter((p) => p.distanceKm !== null).map((p) => p.distanceKm);
  for (let i = 1; i < tier0Dists.length; i++) {
    assert.ok(tier0Dists[i - 1] <= tier0Dists[i], "distance sort is monotonic non-decreasing");
  }
});

test("5. 409 CURSOR_FILTER_MISMATCH, 409 CURSOR_EXPIRED (when epoch pruned), and 400 INVALID_CURSOR", async () => {
  const page1 = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 40,
    scope: "near",
    mode: "ANY",
    filters: { q: tag },
    limit: 2,
  });
  assert.equal(page1.status, 200);
  const cur = page1.body.nextCursor as string;

  // Tampered cursor -> 400
  const tampered = cur.slice(0, -4) + (cur.endsWith("aaaa") ? "bbbb" : "aaaa");
  const rTamper = await postSearch({ lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", filters: { q: tag }, cursor: tampered, limit: 2 });
  assert.equal(rTamper.status, 400);
  assert.equal(rTamper.body.code, "INVALID_CURSOR");

  // Filter / sort / mode / scope / coord change -> 409 CURSOR_FILTER_MISMATCH
  for (const mutated of [
    { lat: VIEWER_LAT + 0.01, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", filters: { q: tag } },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 20, scope: "near", mode: "ANY", filters: { q: tag } },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "national", mode: "ANY", filters: { q: tag } },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "OFFLINE", filters: { q: tag } },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", sortBy: "distance", filters: { q: tag } },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", filters: { q: focusedTag } },
  ]) {
    const r = await postSearch({ ...mutated, cursor: cur, limit: 2 });
    assert.equal(r.status, 409, `expected 409 for mutated=${JSON.stringify(mutated)}, got ${r.status}`);
    assert.equal(r.body.code, "CURSOR_FILTER_MISMATCH");
  }

  // GPS rounding stability: 10.7761 rounds to 10.776 (matches 10.776!), does NOT mismatch
  const roundedSame = await postSearch({
    lat: 10.7761,
    lng: 106.7014,
    radiusKm: 40,
    scope: "near",
    mode: "ANY",
    filters: { q: tag },
    cursor: cur,
    limit: 2,
  });
  assert.equal(roundedSame.status, 200);

  // Epoch expired -> 409 CURSOR_EXPIRED (create new epoch, age old current epoch > 30m so prune deletes it on next build)
  const fresh = await buildDiscoveryStatsEpoch();
  assert.equal(fresh.built, true);
  trackedEpochIds.add(fresh.epoch!);
  const freshP1 = await postSearch({ lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", filters: { q: tag }, limit: 2 });
  assert.equal(freshP1.status, 200, JSON.stringify(freshP1.body));
  assert.ok(typeof freshP1.body.nextCursor === "string");
  await prisma.$executeRaw`UPDATE pt_discovery_epochs SET ready_at = NOW() - INTERVAL '35 minutes' WHERE epoch = ${fresh.epoch!}`;
  const newer = await buildDiscoveryStatsEpoch();
  assert.equal(newer.built, true);
  trackedEpochIds.add(newer.epoch!);

  const rExp = await postSearch({ lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 40, scope: "near", mode: "ANY", filters: { q: tag }, cursor: freshP1.body.nextCursor, limit: 2 });
  assert.equal(rExp.status, 409);
  assert.equal(rExp.body.code, "CURSOR_EXPIRED");
});

test("6. Live visibility & accepting changes apply mid-pagination across pages", async () => {
  const p1 = await postSearch({
    lat: VIEWER_LAT,
    lng: VIEWER_LNG,
    radiusKm: 50,
    scope: "near",
    mode: "OFFLINE",
    sortBy: "ratingDesc",
    filters: { q: nullSliceTag },
    limit: 1,
  });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.pts[0].userId, simPts[8].userId);

  // Suspend idx 9 before requesting page 2 -> idx 9 disappears live on page 2
  await prisma.userProfile.update({ where: { userId: simPts[9].userId }, data: { ptSuspended: true } });
  try {
    const p2 = await postSearch({
      lat: VIEWER_LAT,
      lng: VIEWER_LNG,
      radiusKm: 50,
      scope: "near",
      mode: "OFFLINE",
      sortBy: "ratingDesc",
      filters: { q: nullSliceTag },
      cursor: p1.body.nextCursor,
      limit: 2,
    });
    assert.equal(p2.status, 200);
    assert.ok(!(p2.body.pts as any[]).some((x) => x.userId === simPts[9].userId));
    assert.equal(p2.body.pts[0].userId, simPts[10].userId);
  } finally {
    await prisma.userProfile.update({ where: { userId: simPts[9].userId }, data: { ptSuspended: false } });
  }
});

test("7. Validation (400 bounds), 503 when cursor secret missing outside NODE_ENV=test, and GET /profile/pts uses stats when epoch present", async () => {
  for (const badBody of [
    { lat: 7.9, lng: 106.7 },
    { lat: 24.1, lng: 106.7 },
    { lat: 10.7, lng: 101.9 },
    { lat: 10.7, lng: 110.1 },
    { lat: 10.7 },
    { lng: 106.7 },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 0.5 },
    { lat: VIEWER_LAT, lng: VIEWER_LNG, radiusKm: 101 },
    { limit: 0 },
    { limit: 51 },
    { limit: 2.5 },
    { areaWard: WARD_A1 },
    { scope: "province" },
    { scope: "invalid_scope" },
    { mode: "BAD_MODE" },
    { sortBy: "invalid_sort" },
    { filters: { minPrice: 500, maxPrice: 100 } },
    "not-an-object",
  ]) {
    const res = await postSearch(badBody);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(badBody)}, got ${res.status}`);
  }

  // 503 when NODE_ENV != test and both PT_DISCOVERY_CURSOR_SECRET & INTERNAL_SERVICE_SECRET are missing
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCursorSecret = process.env.PT_DISCOVERY_CURSOR_SECRET;
  const savedInternalSecret = process.env.INTERNAL_SERVICE_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PT_DISCOVERY_CURSOR_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;
    const unconf = await postSearch({ scope: "national", limit: 10 });
    assert.equal(unconf.status, 503);
    assert.equal(unconf.body.code, "CURSOR_SECRET_UNAVAILABLE");
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedCursorSecret !== undefined) process.env.PT_DISCOVERY_CURSOR_SECRET = savedCursorSecret;
    else delete process.env.PT_DISCOVERY_CURSOR_SECRET;
    if (savedInternalSecret !== undefined) process.env.INTERNAL_SERVICE_SECRET = savedInternalSecret;
    else delete process.env.INTERNAL_SERVICE_SECRET;
  }

  // Prove GET /profile/pts?sortBy=ratingDesc reads pt_discovery_stats of current epoch (mutating idx 10 rating_avg to 5.0 ONLY in stats!)
  const curEpoch = await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true } });
  const origStat = await prisma.ptDiscoveryStat.findUniqueOrThrow({
    where: { epoch_ptUserId: { epoch: curEpoch.epoch, ptUserId: simPts[10].userId } },
  });
  await prisma.ptDiscoveryStat.update({
    where: { epoch_ptUserId: { epoch: curEpoch.epoch, ptUserId: simPts[10].userId } },
    data: { ratingAvg: 5.0 },
  });
  try {
    const getSorted = await app.call("GET", `/profile/pts?q=${encodeURIComponent(nullSliceTag)}&sortBy=ratingDesc&limit=10`, viewerToken);
    assert.equal(getSorted.status, 200);
    // Notice idx 8 & idx 10 both have 5.0 in stats (idx 10 raw was 3.5!) -> sorted by stats then userId ASC
    const top2 = (getSorted.body.pts as any[]).slice(0, 2).map((p) => p.userId).sort();
    assert.deepEqual(top2, [simPts[8].userId, simPts[10].userId].sort(), "GET /profile/pts sortBy=ratingDesc reads pt_discovery_stats when READY epoch exists");
  } finally {
    await prisma.ptDiscoveryStat.update({
      where: { epoch_ptUserId: { epoch: curEpoch.epoch, ptUserId: simPts[10].userId } },
      data: { ratingAvg: origStat.ratingAvg },
    });
  }
});

test("8. SET LOCAL statement_timeout = '2s' aborts runaway query inside tx without leaving timeout on pooled connection", async () => {
  await assert.rejects(
    () =>
      searchDiscoveryPtPageIds(
        { scope: "national", q: focusedTag, limit: 5 },
        {
          onAfterTimeoutSetInTx: async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(2.4)`;
          },
        },
      ),
    (err: any) => err?.code === "57014" || err?.meta?.code === "57014" || /statement timeout/i.test(String(err?.message ?? "")),
  );

  // Subsequent normal query succeeds without residual timeout
  const ok = await searchDiscoveryPtPageIds({ scope: "national", q: focusedTag, limit: 5 });
  assert.ok(ok.items.length > 0);
});

test("9. Privacy: real user-service pino stdout/stderr logs emit zero GPS coordinates across 200, 400 validation, and malformed JSON", () => {
  const userServiceRoot = path.resolve(__dirname, "../..");
  const childCode = `
    import { createServer } from "node:http";
    const appMod = await import("./src/app.ts");
    const userApp = appMod.default?.default ?? appMod.default;
    const helperMod = await import("./src/__tests__/pt-contract-scope.test-helpers.ts");
    const tokenFor = helperMod.tokenFor ?? helperMod.default?.tokenFor;
    process.env.NODE_ENV = "test";
    const s = createServer(userApp);
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + s.address().port + "/profile/pts/search";
    const tok = tokenFor("${viewerId}", "CUSTOMER");
    await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 16.43912, lng: 107.58923, radiusKm: 10, filters: { q: "${focusedTag}" } }),
    });
    await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 29.99912, lng: 107.58923, radiusKm: 10 }),
    });
    await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: '{"lat": 16.43912, "lng": BAD}',
    });
    await new Promise((r) => s.close(r));
    setTimeout(() => process.exit(0), 50);
  `;

  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/__tests__/setup/db-isolation.ts", "--input-type=module"],
    {
      cwd: userServiceRoot,
      env: { ...process.env },
      input: childCode,
      encoding: "utf8",
    },
  );
  assert.equal(res.status, 0, `user-service log probe failed: status=${res.status} err=${res.stderr}`);
  const combined = `${res.stdout}\n${res.stderr}`;
  assert.ok(combined.includes("/profile/pts/search"), "sanity: pinoHttp logged route");
  assert.equal(combined.includes("16.439"), false, "valid/malformed lat must never appear in logs");
  assert.equal(combined.includes("29.999"), false, "invalid lat must never appear in logs");
  assert.equal(combined.includes("107.589"), false, "lng must never appear in logs");
});
