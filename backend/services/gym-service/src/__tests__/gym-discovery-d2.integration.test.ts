/**
 * D2 integration suite (gym-service):
 *   - POST /gyms/search across >= 2,500 simulated gyms: radius bbox + Haversine, q (diacritic-insensitive),
 *     amenityIds (all active), priceMax (active sale window), sort (distance/rating/price/relevance),
 *     full AES-256-GCM cursor pagination (0 dup, 0 omit), 409 filter mismatch, 400 invalid cursor,
 *     503 fail-closed secret outside test, 400 bounds & validation.
 *   - Cross-province rule: closer gym across province border beats farther gym in same province.
 *   - Visibility parity with gymPublicWhere() (APPROVED + OPEN + owner not SUSPENDED/TERMINATED).
 *   - Fail-soft areaWard -> user-service GET /locations/wards/:code (centroid -> near; missing/down -> province).
 *   - SET LOCAL statement_timeout = '2s' aborts pg_sleep(2.4) cleanly without poisoning pool.
 *   - GET /gyms/brand-options (BrandOption shape, q filter, keyset cursor pagination, public visibility).
 *   - GET /me/gym-memberships & /:id carry gymName without extra gym relation leak.
 *   - GET /gyms & GET /gyms/:id unchanged DTO/ordering + LEGACY_GET_GYMS_READ telemetry in client_compat_events.
 *   - Route ordering: /gyms/search & /gyms/brand-options precede /gyms/:id.
 *   - Privacy: real pino stdout/stderr logs emit ZERO GPS coords across 200 / 400 / malformed JSON.
 *
 * Evidence label: BACKEND INTEGRATION (real gym-service Express app + isolated *_test PG;
 * auth-service & user-service endpoints run as local HTTP TEST FIXTURE servers).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { guardedTest as test, skip } from './test-db-guard';
import { prisma } from '../repositories/prisma';
import { gymSearchService } from '../services/gym-search.service';

const tag = randomUUID().replace(/-/g, '').slice(0, 6);
const TOTAL_SIM_GYMS = 2500;
const PROV_A = 79001 + (parseInt(tag.slice(0, 3), 16) % 100);
const PROV_B = PROV_A + 1;
const PROV_C = PROV_A + 2;
const WARD_A1 = PROV_A * 100 + 1;

// Origin at Ben Thanh area (HCMC)
const ORIGIN_LAT = 10.775;
const ORIGIN_LNG = 106.700;

const createdPartnerIds: string[] = [];
const createdBrandIds: string[] = [];
const createdGymIds: string[] = [];
const createdAmenityIds: string[] = [];
const createdMembershipIds: string[] = [];
const clientCompatMarkers: string[] = [];

const USERS: Record<string, { id: string; role: string; email: string }> = {};
const clientUserId = `d2client-${tag}`;
const ownerActiveUserId = `d2owner-ok-${tag}`;
const ownerSuspendedUserId = `d2owner-susp-${tag}`;
const ownerTerminatedUserId = `d2owner-term-${tag}`;
const clientToken = `tok-client-${tag}`;

let authServer: http.Server;
let userServiceServer: http.Server;
let appServer: http.Server;
let baseUrl = '';
let userServicePort = 0;
let userWardMode: 'CENTROID' | 'NULL_CENTROID' | 'ERROR' = 'CENTROID';

// Named special gyms for targeted assertions
let gymCloseOtherProvId = '';
let gymFarSameProvId = '';
let gymPriceCheapId = '';
let gymPriceExpensiveId = '';
let gymSearchTargetId = '';
let gymMembershipTargetId = '';
let standaloneGymId = '';
const hiddenGymIds: Record<string, string> = {};
let visibleCountInCluster = 0;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.min(1, a)));
}

async function callApi(
  method: string,
  reqPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

test.before(async () => {
  if (skip) return;

  USERS[clientToken] = { id: clientUserId, role: 'CUSTOMER', email: `${clientUserId}@test.local` };

  authServer = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    if (req.method === 'POST' && req.url === '/auth/verify') {
      const u = USERS[token];
      res.writeHead(u ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(u ? { user: u } : { error: 'Unauthorized' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  const authPort = (authServer.address() as { port: number }).port;
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${authPort}`;

  userServiceServer = http.createServer((req, res) => {
    const m = /^\/locations\/wards\/(\d+)$/.exec(req.url || '');
    if (req.method === 'GET' && m) {
      const code = Number(m[1]);
      if (userWardMode === 'ERROR') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'simulated failure' }));
        return;
      }
      if (code === WARD_A1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: WARD_A1,
            provinceCode: PROV_A,
            name: `Phuong Test ${tag}`,
            centroid: userWardMode === 'CENTROID' ? { lat: ORIGIN_LAT, lng: ORIGIN_LNG } : null,
            bbox: null,
          }),
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => userServiceServer.listen(0, '127.0.0.1', r));
  userServicePort = (userServiceServer.address() as { port: number }).port;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${userServicePort}`;

  const { default: app } = await import('../app');
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;

  // Seed partners & brands & 2,500 simulated gyms inside compat-writer transaction
  const partnerActiveId = randomUUID();
  const partnerSuspId = randomUUID();
  const partnerTermId = randomUUID();
  createdPartnerIds.push(partnerActiveId, partnerSuspId, partnerTermId);

  const brandSpecs = Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(),
    ownerId: i === 0 ? ownerActiveUserId : `d2brand-owner-${i}-${tag}`,
    name: `D2Brand_${tag}_${String(i).padStart(2, '0')}`,
    approvedName: `D2 Thương Hiệu ${tag} ${String(i).padStart(2, '0')}`,
  }));
  brandSpecs.forEach((b) => createdBrandIds.push(b.id));

  const amWifiId = randomUUID();
  const amPoolId = randomUUID();
  const amSaunaDisabledId = randomUUID();
  createdAmenityIds.push(amWifiId, amPoolId, amSaunaDisabledId);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'v1'`);

    await tx.gymPartner.createMany({
      data: [
        { id: partnerActiveId, legalName: `Active Co ${tag}`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
        { id: partnerSuspId, legalName: `Susp Co ${tag}`, status: 'SUSPENDED', verificationStatus: 'VERIFIED' },
        { id: partnerTermId, legalName: `Term Co ${tag}`, status: 'TERMINATED', verificationStatus: 'VERIFIED' },
      ],
    });
    await tx.gymPartnerAccount.createMany({
      data: [
        { id: randomUUID(), partnerId: partnerActiveId, userId: ownerActiveUserId, role: 'OWNER', status: 'ACTIVE' },
        { id: randomUUID(), partnerId: partnerSuspId, userId: ownerSuspendedUserId, role: 'OWNER', status: 'ACTIVE' },
        { id: randomUUID(), partnerId: partnerTermId, userId: ownerTerminatedUserId, role: 'OWNER', status: 'ACTIVE' },
      ],
    });

    await tx.gymBrand.createMany({ data: brandSpecs });

    await tx.amenity.createMany({
      data: [
        { id: amWifiId, slug: `d2wifi_${tag}`, name: `Wifi ${tag}`, nameNormalized: `wifi ${tag}`, category: 'SERVICE', iconKey: 'wifi', status: 'ACTIVE' },
        { id: amPoolId, slug: `d2pool_${tag}`, name: `Pool ${tag}`, nameNormalized: `pool ${tag}`, category: 'RECOVERY', iconKey: 'pool', status: 'ACTIVE' },
        { id: amSaunaDisabledId, slug: `d2sauna_${tag}`, name: `SaunaDis ${tag}`, nameNormalized: `saunadis ${tag}`, category: 'RECOVERY', iconKey: 'flame', status: 'DISABLED' },
      ],
    });

    // Plans on brands: brand[0] cheap (300k), brand[1] expensive (950k), others medium (500k), plus expired & inactive plans
    const planRows: any[] = brandSpecs.map((b, i) => ({
      id: randomUUID(),
      brandId: b.id,
      name: `Plan ${i}`,
      price: i === 0 ? 300000 : i === 1 ? 950000 : 500000 + i * 10000,
      durationDays: 30,
      status: 'ACTIVE',
    }));
    // Brand[2] also has a super-cheap expired sale plan (must NOT affect priceMax!)
    planRows.push({
      id: randomUUID(),
      brandId: brandSpecs[2].id,
      name: 'Expired Promo',
      price: 50000,
      durationDays: 30,
      status: 'ACTIVE',
      saleEndAt: new Date(Date.now() - 86_400_000),
    });
    // Brand[1] has an INACTIVE cheap plan (must NOT affect priceMax!)
    planRows.push({
      id: randomUUID(),
      brandId: brandSpecs[1].id,
      name: 'Inactive Cheap',
      price: 100000,
      durationDays: 30,
      status: 'INACTIVE',
    });
    await tx.gymMembershipPlan.createMany({ data: planRows });

    const baseTime = new Date('2026-10-15T00:00:00.000Z').getTime();
    const gymsData: any[] = [];
    const amenityLinks: Array<{ gymId: string; amenityId: string }> = [];
    const reviewRows: any[] = [];

    for (let i = 0; i < TOTAL_SIM_GYMS; i++) {
      const id = randomUUID();
      createdGymIds.push(id);

      let ownerId = ownerActiveUserId;
      let brandId: string | null = brandSpecs[i % brandSpecs.length].id;
      let status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' = 'APPROVED';
      let operationalStatus: 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED' = 'OPEN';
      let prov = i % 3 === 0 ? PROV_A : i % 3 === 1 ? PROV_B : PROV_C;
      let ward: number | null = prov === PROV_A ? WARD_A1 : null;
      let lat: number | null = 11.2 + (i % 50) * 0.03; // outside default 10km cluster unless set below
      let lng: number | null = 107.1 + Math.floor(i / 50) * 0.02;
      let name = `D2 Gym ${tag} #${String(i).padStart(4, '0')}`;
      let approvedName: string | null = `Phòng Tập Đỉnh ${tag} #${String(i).padStart(4, '0')}`;
      let city = prov === PROV_A ? 'Ho Chi Minh' : prov === PROV_B ? 'Binh Duong' : 'Dong Nai';

      if (i === 0) {
        // Hidden DRAFT
        status = 'DRAFT';
        hiddenGymIds.DRAFT = id;
        lat = ORIGIN_LAT + 0.005;
        lng = ORIGIN_LNG + 0.005;
      } else if (i === 1) {
        status = 'PENDING_REVIEW';
        hiddenGymIds.PENDING_REVIEW = id;
        lat = ORIGIN_LAT + 0.006;
        lng = ORIGIN_LNG + 0.006;
      } else if (i === 2) {
        operationalStatus = 'TEMPORARILY_CLOSED';
        hiddenGymIds.TEMPORARILY_CLOSED = id;
        lat = ORIGIN_LAT + 0.007;
        lng = ORIGIN_LNG + 0.007;
      } else if (i === 3) {
        operationalStatus = 'PERMANENTLY_CLOSED';
        hiddenGymIds.PERMANENTLY_CLOSED = id;
        lat = ORIGIN_LAT + 0.008;
        lng = ORIGIN_LNG + 0.008;
      } else if (i === 4) {
        ownerId = ownerSuspendedUserId;
        brandId = null;
        hiddenGymIds.PARTNER_SUSPENDED = id;
        lat = ORIGIN_LAT + 0.009;
        lng = ORIGIN_LNG + 0.009;
      } else if (i === 5) {
        ownerId = ownerTerminatedUserId;
        brandId = null;
        hiddenGymIds.PARTNER_TERMINATED = id;
        lat = ORIGIN_LAT + 0.01;
        lng = ORIGIN_LNG + 0.01;
      } else if (i === 10) {
        // Close across border in PROV_B (~1.2 km)
        gymCloseOtherProvId = id;
        prov = PROV_B;
        ward = null;
        lat = ORIGIN_LAT + 0.0108;
        lng = ORIGIN_LNG;
        city = 'Binh Duong';
        approvedName = `D2 CrossBorder Close ${tag}`;
        visibleCountInCluster++;
      } else if (i === 11) {
        // Farther inside same PROV_A (~4.8 km)
        gymFarSameProvId = id;
        prov = PROV_A;
        ward = WARD_A1;
        lat = ORIGIN_LAT + 0.043;
        lng = ORIGIN_LNG;
        city = 'Ho Chi Minh';
        approvedName = `D2 SameProv Far ${tag}`;
        visibleCountInCluster++;
      } else if (i === 12) {
        // Cheap brand[0] (300k), in cluster + has both active amenities
        gymPriceCheapId = id;
        brandId = brandSpecs[0].id;
        prov = PROV_A;
        ward = WARD_A1;
        lat = ORIGIN_LAT + 0.015;
        lng = ORIGIN_LNG + 0.004;
        amenityLinks.push({ gymId: id, amenityId: amWifiId }, { gymId: id, amenityId: amPoolId });
        visibleCountInCluster++;
      } else if (i === 13) {
        // Expensive brand[1] (950k), in cluster + has wifi only
        gymPriceExpensiveId = id;
        brandId = brandSpecs[1].id;
        prov = PROV_A;
        ward = WARD_A1;
        lat = ORIGIN_LAT + 0.018;
        lng = ORIGIN_LNG + 0.004;
        amenityLinks.push({ gymId: id, amenityId: amWifiId });
        visibleCountInCluster++;
      } else if (i === 14) {
        // Diacritic search target
        gymSearchTargetId = id;
        brandId = brandSpecs[3].id;
        prov = PROV_A;
        ward = WARD_A1;
        lat = ORIGIN_LAT + 0.02;
        lng = ORIGIN_LNG + 0.005;
        name = `D2 RawAlpha ${tag}`;
        approvedName = `CLB Thể Hình Đặc Biệt Quận Nhất ${tag}`;
        amenityLinks.push({ gymId: id, amenityId: amWifiId }, { gymId: id, amenityId: amPoolId });
        visibleCountInCluster++;
      } else if (i === 15) {
        // Standalone gym (brandId = null) for BrandOption scope='BRANCH' & membership gymName test
        standaloneGymId = id;
        gymMembershipTargetId = id;
        brandId = null;
        prov = PROV_A;
        ward = WARD_A1;
        lat = ORIGIN_LAT + 0.022;
        lng = ORIGIN_LNG + 0.006;
        name = `Raw Standalone ${tag}`;
        approvedName = `Phòng Tập Độc Lập ${tag}`;
        visibleCountInCluster++;
      } else if (i >= 20 && i < 160) {
        // 140 gyms deterministically spread inside 1..9 km around ORIGIN for rich pagination (pages = 6 at limit 25)
        const angle = (i * 0.43) % (Math.PI * 2);
        const rDeg = 0.008 + ((i - 20) % 70) * 0.001; // ~0.9 km .. ~8.6 km
        lat = Number((ORIGIN_LAT + Math.cos(angle) * rDeg).toFixed(6));
        lng = Number((ORIGIN_LNG + Math.sin(angle) * rDeg).toFixed(6));
        prov = PROV_A;
        ward = WARD_A1;
        if (haversineKm(ORIGIN_LAT, ORIGIN_LNG, lat, lng) <= 10) {
          visibleCountInCluster++;
        }
        if (i % 4 === 0) {
          amenityLinks.push({ gymId: id, amenityId: amWifiId });
          if (i % 8 === 0) amenityLinks.push({ gymId: id, amenityId: amPoolId });
        }
      }

      gymsData.push({
        id,
        ownerId,
        brandId,
        name,
        approvedName,
        address: `${10 + i} Duong Test ${tag}`,
        approvedAddress: `${10 + i} Đường Thử Nghiệm Quận 1 ${tag}`,
        city,
        provinceCode: prov,
        wardCode: ward,
        latitude: lat,
        longitude: lng,
        status,
        operationalStatus,
        createdAt: new Date(baseTime + i * 1000),
      });

      if (i >= 10 && i < 90) {
        reviewRows.push({
          id: randomUUID(),
          gymId: id,
          clientId: `rev-${tag}-${i}`,
          rating: ((i % 5) + 1),
          comment: `Review ${i}`,
        });
      }
    }

    for (let offset = 0; offset < gymsData.length; offset += 500) {
      await tx.gym.createMany({ data: gymsData.slice(offset, offset + 500) });
    }
    if (amenityLinks.length > 0) {
      await tx.gymAmenity.createMany({ data: amenityLinks });
    }
    if (reviewRows.length > 0) {
      await tx.gymReview.createMany({ data: reviewRows });
    }

    // Create one membership at standaloneGymId to test GET /me/gym-memberships & /:id gymName
    const memId = randomUUID();
    createdMembershipIds.push(memId);
    await tx.gymMembershipContract.create({
      data: {
        id: memId,
        gymId: gymMembershipTargetId,
        planId: planRows[0].id,
        clientId: clientUserId,
        status: 'ACTIVE',
        priceAtPurchase: 300000,
        durationDaysSnapshot: 30,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 29 * 86_400_000),
      },
    });
  });

  await prisma.$executeRawUnsafe(
    'ANALYZE gyms, gym_brands, gym_membership_plans, gym_reviews, amenities, gym_amenities, gym_partner_accounts, gym_partners',
  );
});

test.after(async () => {
  if (skip) return;
  if (clientCompatMarkers.length > 0) {
    await prisma.clientCompatEvent.deleteMany({
      where: { clientHeader: { in: clientCompatMarkers } },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'v1'`);
    if (createdMembershipIds.length > 0) {
      await tx.gymMembershipContract.deleteMany({ where: { id: { in: createdMembershipIds } } });
    }
    if (createdGymIds.length > 0) {
      await tx.gymAmenity.deleteMany({ where: { gymId: { in: createdGymIds } } });
      await tx.gymReview.deleteMany({ where: { gymId: { in: createdGymIds } } });
      await tx.legacyCompatEvent.deleteMany({ where: { entityId: { in: createdGymIds } } });
    }
    if (createdBrandIds.length > 0) {
      await tx.gymMembershipPlan.deleteMany({ where: { brandId: { in: createdBrandIds } } });
    }
    if (createdGymIds.length > 0) {
      await tx.gym.deleteMany({ where: { id: { in: createdGymIds } } });
    }
    if (createdPartnerIds.length > 0) {
      await tx.legacyCompatEvent.deleteMany({ where: { entityId: { in: createdPartnerIds } } });
      await tx.gymPartner.deleteMany({ where: { id: { in: createdPartnerIds } } });
    }
    if (createdBrandIds.length > 0) {
      await tx.gymBrand.deleteMany({ where: { id: { in: createdBrandIds } } });
    }
    if (createdAmenityIds.length > 0) {
      await tx.amenity.deleteMany({ where: { id: { in: createdAmenityIds } } });
    }
  });
  await prisma.$disconnect();
  for (const s of [appServer, userServiceServer, authServer]) {
    if (s) {
      (s as any).closeAllConnections?.();
      await new Promise<void>((r) => s.close(() => r()));
    }
  }
});

test('1. POST /gyms/search: >=2500 gyms near cluster, q accent-insensitive, amenityIds, priceMax, all sorts, and lossless cursor pagination', async () => {
  // Full cursor pagination across the 10km cluster with sort='distance', limit=25
  const seenIds: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let prevDist = -1;
  do {
    pages++;
    const res = await callApi('POST', '/gyms/search', {
      lat: ORIGIN_LAT,
      lng: ORIGIN_LNG,
      radiusKm: 10,
      sort: 'distance',
      limit: 25,
      ...(cursor ? { cursor } : {}),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.appliedScope, 'near');
    for (const g of res.body.data.gyms as any[]) {
      assert.ok(typeof g.distanceKm === 'number' && g.distanceKm <= 10);
      assert.ok(g.distanceKm >= prevDist - 0.1, `distance should not regress sharply (${prevDist} -> ${g.distanceKm})`);
      prevDist = g.distanceKm;
      seenIds.push(g.id);
    }
    cursor = res.body.data.nextCursor ?? undefined;
    assert.ok(pages < 20, 'pagination loop guard');
    if (res.body.data.hasMore) assert.ok(cursor);
    else assert.equal(cursor, undefined);
  } while (cursor);

  assert.equal(new Set(seenIds).size, seenIds.length, '0 duplicates across paginated pages');
  assert.equal(seenIds.length, visibleCountInCluster, '0 omissions across all visible cluster gyms');

  // Accent-insensitive q match without Vietnamese accents
  const qRes = await callApi('POST', '/gyms/search', {
    scope: 'national',
    q: `dac biet quan nhat ${tag}`,
    limit: 20,
  });
  assert.equal(qRes.status, 200);
  assert.equal(qRes.body.data.gyms.length, 1);
  assert.equal(qRes.body.data.gyms[0].id, gymSearchTargetId);

  // amenityIds all-match (using both slug & id) + priceMax
  const filteredRes = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 10,
    amenityIds: [`d2wifi_${tag}`, createdAmenityIds[1]],
    priceMax: 450000,
    sort: 'price',
    limit: 50,
  });
  assert.equal(filteredRes.status, 200);
  const filteredIds = (filteredRes.body.data.gyms as any[]).map((g) => g.id);
  assert.ok(filteredIds.includes(gymPriceCheapId));
  assert.equal(filteredIds.includes(gymPriceExpensiveId), false, 'expensive brand hidden above priceMax');
  assert.equal(filteredIds.includes(gymSearchTargetId), false, 'brand[3] (530k) excluded by priceMax 450k');

  // sort='rating' check across pages
  const rate1 = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 10,
    sort: 'rating',
    limit: 10,
  });
  assert.equal(rate1.status, 200);
  assert.equal(rate1.body.data.gyms.length, 10);
  assert.ok(rate1.body.data.gyms[0].averageRating >= rate1.body.data.gyms[9].averageRating);
});

test('2. Cross-province edge: closer gym in adjacent province beats farther gym in same areaProvince', async () => {
  for (const sort of ['distance', 'relevance'] as const) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await callApi('POST', '/gyms/search', {
        lat: ORIGIN_LAT,
        lng: ORIGIN_LNG,
        radiusKm: 10,
        areaProvince: PROV_A,
        sort,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(res.status, 200);
      for (const g of res.body.data.gyms as any[]) ids.push(g.id);
      cursor = res.body.data.nextCursor ?? undefined;
    } while (cursor);
    const idxCloseOther = ids.indexOf(gymCloseOtherProvId);
    const idxFarSame = ids.indexOf(gymFarSameProvId);
    assert.ok(idxCloseOther >= 0, `closer out-of-province gym present (sort=${sort})`);
    assert.ok(idxFarSame >= 0, `farther same-province gym present (sort=${sort})`);
    assert.ok(
      idxCloseOther < idxFarSame,
      `expected cross-province closer gym (${idxCloseOther}) before same-province farther gym (${idxFarSame}) under sort=${sort}`,
    );
  }
});

test('3. Visibility parity: DRAFT / PENDING_REVIEW / closed / suspended partner / terminated partner never leak in search, brand-options, or GET /gyms', async () => {
  const hiddenSet = new Set(Object.values(hiddenGymIds));

  const searchRes = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 15,
    limit: 50,
  });
  assert.equal(searchRes.status, 200);
  for (const g of searchRes.body.data.gyms as any[]) {
    assert.equal(hiddenSet.has(g.id), false, `hidden gym ${g.id} leaked into POST /gyms/search`);
  }

  const brandRes = await callApi('GET', `/gyms/brand-options?q=${tag}&limit=50`);
  assert.equal(brandRes.status, 200);
  for (const opt of brandRes.body.data.options as any[]) {
    for (const br of opt.branches as any[]) {
      assert.equal(hiddenSet.has(br.id), false, `hidden branch ${br.id} leaked into brand-options`);
    }
  }
});

test('4. areaWard centroid lookup via user-service GET /locations/wards/:code and fail-soft fallback to province', async () => {
  // 4a. Centroid available -> appliedScope='near', computes distanceKm
  userWardMode = 'CENTROID';
  const rNear = await callApi('POST', '/gyms/search', {
    areaProvince: PROV_A,
    areaWard: WARD_A1,
    radiusKm: 10,
    limit: 20,
  });
  assert.equal(rNear.status, 200);
  assert.equal(rNear.body.data.appliedScope, 'near');
  assert.ok(rNear.body.data.gyms.length > 0);
  assert.ok(typeof rNear.body.data.gyms[0].distanceKm === 'number');

  // 4b. Ward centroid is null -> degrades gracefully to province
  userWardMode = 'NULL_CENTROID';
  const rNull = await callApi('POST', '/gyms/search', {
    areaProvince: PROV_A,
    areaWard: WARD_A1,
    limit: 20,
  });
  assert.equal(rNull.status, 200);
  assert.equal(rNull.body.data.appliedScope, 'province');
  assert.equal(rNull.body.data.gyms[0].distanceKm, null);

  // 4c. user-service unreachable -> fails soft to province
  userWardMode = 'CENTROID';
  const savedUrl = process.env.USER_SERVICE_URL;
  process.env.USER_SERVICE_URL = 'http://127.0.0.1:9';
  try {
    const rDown = await callApi('POST', '/gyms/search', {
      areaProvince: PROV_A,
      areaWard: WARD_A1,
      limit: 20,
    });
    assert.equal(rDown.status, 200);
    assert.equal(rDown.body.data.appliedScope, 'province');
  } finally {
    process.env.USER_SERVICE_URL = savedUrl;
  }
});

test('5. Validation (400), cursor tamper/mismatch (400/409), and fail-closed secret (503 CURSOR_SECRET_UNAVAILABLE)', async () => {
  // Bad bounds & validation -> 400
  const badLat = await callApi('POST', '/gyms/search', { lat: 29.5, lng: 106.7 });
  assert.equal(badLat.status, 400);
  const badPair = await callApi('POST', '/gyms/search', { lat: 10.77 });
  assert.equal(badPair.status, 400);
  const badWard = await callApi('POST', '/gyms/search', { areaWard: WARD_A1 });
  assert.equal(badWard.status, 400);
  const badJson = await callApi('POST', '/gyms/search', '{"lat": 10.77, BAD}', {
    'content-type': 'application/json',
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, 'INVALID_JSON');

  // Get valid page 1 cursor then mutate filter -> 409 CURSOR_FILTER_MISMATCH
  const p1 = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 10,
    sort: 'distance',
    limit: 5,
  });
  assert.equal(p1.status, 200);
  assert.ok(p1.body.data.nextCursor);

  const mismatch = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 20,
    sort: 'distance',
    limit: 5,
    cursor: p1.body.data.nextCursor,
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, 'CURSOR_FILTER_MISMATCH');

  const tampered = await callApi('POST', '/gyms/search', {
    lat: ORIGIN_LAT,
    lng: ORIGIN_LNG,
    radiusKm: 10,
    cursor: 'not-a-valid-cursor-token',
  });
  assert.equal(tampered.status, 400);
  assert.equal(tampered.body.error.code, 'INVALID_CURSOR');

  // Fail-closed 503 when NODE_ENV != 'test' and no cursor secret configured
  const prevEnv = process.env.NODE_ENV;
  const prevGymSec = process.env.GYM_SEARCH_CURSOR_SECRET;
  const prevIntSec = process.env.INTERNAL_SERVICE_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.GYM_SEARCH_CURSOR_SECRET;
  delete process.env.INTERNAL_SERVICE_SECRET;
  try {
    const r503Search = await callApi('POST', '/gyms/search', { scope: 'national', limit: 5 });
    assert.equal(r503Search.status, 503);
    assert.equal(r503Search.body.error.code, 'CURSOR_SECRET_UNAVAILABLE');

    const r503Brand = await callApi('GET', '/gyms/brand-options?limit=5');
    assert.equal(r503Brand.status, 503);
    assert.equal(r503Brand.body.error.code, 'CURSOR_SECRET_UNAVAILABLE');

    // Also fail-closed under staging/non-test NODE_ENV when GYMINI_TEST_ISOLATION is unset
    const prevIso = process.env.GYMINI_TEST_ISOLATION;
    process.env.NODE_ENV = 'staging';
    delete process.env.GYMINI_TEST_ISOLATION;
    try {
      const r503Staging = await callApi('POST', '/gyms/search', { scope: 'national', limit: 5 });
      assert.equal(r503Staging.status, 503);
      assert.equal(r503Staging.body.error.code, 'CURSOR_SECRET_UNAVAILABLE');
    } finally {
      if (prevIso !== undefined) process.env.GYMINI_TEST_ISOLATION = prevIso;
    }
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevGymSec !== undefined) process.env.GYM_SEARCH_CURSOR_SECRET = prevGymSec;
    else delete process.env.GYM_SEARCH_CURSOR_SECRET;
    if (prevIntSec !== undefined) process.env.INTERNAL_SERVICE_SECRET = prevIntSec;
    else delete process.env.INTERNAL_SERVICE_SECRET;
  }
});

test("6. SET LOCAL statement_timeout = '2s' aborts slow tx cleanly without poisoning pooled connection", async () => {
  await assert.rejects(
    () =>
      gymSearchService.searchPublicGyms(
        { scope: 'national', q: tag, limit: 5 },
        {
          onAfterTimeoutSetInTx: async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(2.4)`;
          },
        },
      ),
    (err: any) => err?.code === '57014' || err?.meta?.code === '57014' || /statement timeout/i.test(String(err?.message ?? '')),
  );

  // Subsequent normal query works without lingering timeout
  const ok = await gymSearchService.searchPublicGyms({ scope: 'national', q: tag, limit: 5 });
  assert.ok(ok.gyms.length > 0);
});

test('7. GET /gyms/brand-options returns BrandOption shape, supports q search and cursor pagination', async () => {
  // Verify standalone branch option appears with 'branch:<id>' prefix & closed=false
  const standaloneQ = await callApi('GET', `/gyms/brand-options?q=${encodeURIComponent(`Doc Lap ${tag}`)}&limit=10`);
  assert.equal(standaloneQ.status, 200);
  const soloOpt = (standaloneQ.body.data.options as any[]).find((o) => o.proposeBranchId === standaloneGymId);
  assert.ok(soloOpt, 'standalone branch should appear in brand-options');
  assert.equal(soloOpt.scope, 'BRANCH');
  assert.equal(soloOpt.brandId, `branch:${standaloneGymId}`);
  assert.equal(soloOpt.branches.length, 1);
  assert.equal(soloOpt.branches[0].closed, false);

  // Full cursor pagination across matching brands + standalone for this tag (limit=4)
  const collectedKeys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await callApi(
      'GET',
      `/gyms/brand-options?q=${encodeURIComponent(tag)}&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    assert.equal(res.status, 200);
    for (const opt of res.body.data.options as any[]) {
      assert.ok(opt.scope === 'BRAND' || opt.scope === 'BRANCH');
      assert.ok(typeof opt.brandId === 'string' && opt.brandId.length > 0);
      assert.ok(Array.isArray(opt.branches) && opt.branches.length >= 1);
      assert.equal(opt.proposeBranchId, opt.branches[0].id);
      collectedKeys.push(`${opt.scope}:${opt.brandId}`);
    }
    cursor = res.body.data.nextCursor ?? undefined;
  } while (cursor);

  assert.equal(new Set(collectedKeys).size, collectedKeys.length, '0 duplicate brand options across pages');
  assert.equal(collectedKeys.length, 13, '12 brands + 1 standalone visible gym for tag');
});

test('8. GET /me/gym-memberships and /:id include gymName (approvedName ?? name)', async () => {
  const listRes = await callApi('GET', '/me/gym-memberships', undefined, {
    authorization: `Bearer ${clientToken}`,
  });
  assert.equal(listRes.status, 200);
  const found = (listRes.body.data as any[]).find((m) => m.id === createdMembershipIds[0]);
  assert.ok(found);
  assert.equal(found.gymName, `Phòng Tập Độc Lập ${tag}`);
  assert.equal('gym' in found, false, 'should not leak nested gym object');

  const detailRes = await callApi('GET', `/me/gym-memberships/${createdMembershipIds[0]}`, undefined, {
    authorization: `Bearer ${clientToken}`,
  });
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.data.gymName, `Phòng Tập Độc Lập ${tag}`);
  assert.equal('gym' in detailRes.body.data, false);
});

test('9. GET /gyms & GET /gyms/:id preserve DTO/order and log LEGACY_GET_GYMS_READ telemetry in client_compat_events', async () => {
  const markerHeader = `web/d2-${tag}`;
  clientCompatMarkers.push(markerHeader);

  const listRes = await callApi('GET', '/gyms', undefined, { 'x-gymini-client': markerHeader });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  assert.ok(Array.isArray(listRes.body.data) && listRes.body.data.length >= 2000);

  // Verify default createdAt DESC ordering preserved
  const gyms = listRes.body.data as any[];
  const t0 = new Date(gyms[0].createdAt).getTime();
  const t1 = new Date(gyms[1].createdAt).getTime();
  assert.ok(t0 >= t1);
  // Distance field should NOT be injected onto legacy GET /gyms
  assert.equal('distanceKm' in gyms[0], false);

  const compatEvent = await prisma.clientCompatEvent.findFirst({
    where: { route: 'GET /gyms', clientHeader: markerHeader, outcome: 'LEGACY_GET_GYMS_READ' },
  });
  assert.ok(compatEvent, 'GET /gyms recorded LEGACY_GET_GYMS_READ event');

  // Detail & route precedence: GET /gyms/:id still serves valid UUID and doesn't swallow /gyms/search
  const detailRes = await callApi('GET', `/gyms/${gymPriceCheapId}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.data.id, gymPriceCheapId);
});

test('10. Privacy: real gym-service pino stdout/stderr logs emit zero GPS coordinates across 200, 400 validation, and malformed JSON', () => {
  const gymServiceRoot = path.resolve(__dirname, '../..');
  const childCode = `
    import { createServer } from "node:http";
    process.env.NODE_ENV = "test";
    const appMod = await import("./src/app.ts");
    const gymApp = appMod.default?.default ?? appMod.default;
    const s = createServer(gymApp);
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + s.address().port + "/gyms/search";
    const r200 = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 16.43912, lng: 107.58923, radiusKm: 10, q: "${tag}" }),
    });
    if (r200.status !== 200) throw new Error("expected 200 got " + r200.status);
    const r400a = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 29.99912, lng: 107.58923, radiusKm: 10 }),
    });
    if (r400a.status !== 400) throw new Error("expected 400a got " + r400a.status);
    const r400b = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"lat": 16.43912, "lng": BAD}',
    });
    if (r400b.status !== 400) throw new Error("expected 400b got " + r400b.status);
    const repoMod = await import("./src/repositories/prisma.ts");
    const repoPrisma = repoMod.prisma ?? repoMod.default?.prisma;
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
    if (repoPrisma) await repoPrisma.$disconnect();
    await new Promise((r) => setTimeout(r, 80));
    setTimeout(() => process.exit(0), 500).unref();
  `;

  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--import', './src/__tests__/setup/db-isolation.ts', '--input-type=module'],
    {
      cwd: gymServiceRoot,
      env: { ...process.env },
      input: childCode,
      encoding: 'utf8',
    },
  );
  assert.equal(res.status, 0, `child probe failed: ${res.stderr}`);
  const combinedLogs = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  for (const needle of ['16.43912', '107.58923', '29.99912']) {
    assert.equal(combinedLogs.includes(needle), false, `GPS coordinate ${needle} leaked in gym-service logs!`);
  }
});
