/**
 * D1 integration suite (user-service):
 *   - D1.1 PUT / GET /profile/me searchProvinceCode / searchWardCode (null = Toàn quốc, ward requires province)
 *   - D1.2 GET /locations/wards/:code (centroid + bbox from vietnam_ward_geo, null when missing, 404/400)
 *   - D1.3 pt_training_locations & pt_application optional VN coords (paired, [8..24]x[102..110], 6-decimal rounding, clear, promote)
 *   - D1.4 GET /profile/pts/:userId full discovery parity (availableSlotsNext28Days, matchReason, ptApplication, prices, no private leaks)
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + isolated *_test DB;
 * auth-service & push notification outbound clients stubbed via TEST FIXTURE patches).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { notificationService } from "../services/notification.service";
import { DayOfWeek, PTApplicationStatus, ServiceMode } from "../generated/prisma";
import { patch } from "./pt-restriction.test-helpers";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

const tag = randomUUID().replace(/-/g, "").slice(0, 6);
const baseCode = 90000 + (parseInt(tag.slice(0, 4), 16) % 8000);
const PROV_1 = baseCode * 10 + 1;
const PROV_2 = baseCode * 10 + 2;
const WARD_1A = PROV_1 * 100 + 1;
const WARD_1B_NO_GEO = PROV_1 * 100 + 2;
const WARD_2A = PROV_2 * 100 + 1;

const customerId = `d1cust-${tag}`;
const approvedPtId = `d1pt-${tag}`;
const applicantId = `d1app-${tag}`;
const hiddenPtId = `d1hid-${tag}`;
const adminId = `d1adm-${tag}`;

const createdUserIds = [customerId, approvedPtId, applicantId, hiddenPtId, adminId];

let app: App;
let customerToken: string;
let ptToken: string;
let applicantToken: string;
let adminToken: string;
const restores: Array<() => void> = [];

test.before(async () => {
  restores.push(
    patch(authServiceClient, "internalPatch", async () => ({ status: 200, data: { ok: true } })),
    patch(authServiceClient, "internalGet", async (path: string) => {
      const m = /\/auth\/internal\/users\/([^/]+)/.exec(path);
      return {
        status: 200,
        data: { user: { id: m?.[1] ?? applicantId, firstName: "Lan", lastName: "Nguyen", email: "lan@test.local" } },
      };
    }),
    patch(notificationService, "create", async () => ({ id: randomUUID() })),
    patch(notificationService, "broadcastToAdmins", async () => undefined),
  );

  app = await startApp();
  customerToken = tokenFor(customerId, "CUSTOMER");
  ptToken = tokenFor(approvedPtId, "PT");
  applicantToken = tokenFor(applicantId, "CUSTOMER");
  adminToken = tokenFor(adminId, "ADMIN");

  // Seed test provinces + wards + one vietnam_ward_geo row
  await prisma.vietnamProvince.createMany({
    data: [
      { code: PROV_1, name: `Test Tinh 1 ${tag}`, nameNormalized: `test tinh 1 ${tag}` },
      { code: PROV_2, name: `Test Tinh 2 ${tag}`, nameNormalized: `test tinh 2 ${tag}` },
    ],
  });
  await prisma.vietnamWard.createMany({
    data: [
      { code: WARD_1A, provinceCode: PROV_1, name: `Test Phuong 1A ${tag}`, nameNormalized: `test phuong 1a ${tag}` },
      { code: WARD_1B_NO_GEO, provinceCode: PROV_1, name: `Test Phuong 1B ${tag}`, nameNormalized: `test phuong 1b ${tag}` },
      { code: WARD_2A, provinceCode: PROV_2, name: `Test Phuong 2A ${tag}`, nameNormalized: `test phuong 2a ${tag}` },
    ],
  });
  await prisma.vietnamWardGeo.create({
    data: {
      wardCode: WARD_1A,
      provinceCode: PROV_1,
      centroidLat: 10.776889,
      centroidLng: 106.700806,
      minLat: 10.76,
      maxLat: 10.79,
      minLng: 106.68,
      maxLng: 106.72,
    },
  });

  // Seed customer profile
  await prisma.userProfile.create({
    data: { userId: customerId, firstName: "Khach", lastName: "Mot" },
  });

  // Seed approved public PT with availability in next 28d and a training location in WARD_1A
  const ptProf = await prisma.userProfile.create({
    data: {
      userId: approvedPtId,
      firstName: "Huan",
      lastName: "Luyen",
      isPT: true,
      ptSuspended: false,
      isAcceptingClients: true,
      specialties: ["Gym", "Strength"],
      ptApplication: {
        create: {
          status: PTApplicationStatus.APPROVED,
          approvedAt: new Date(),
          serviceMode: ServiceMode.HYBRID,
          mainSpecialties: ["Gym", "Strength"],
          yearsOfExperience: "5",
          onlinePricePerSession: 250000,
          offlinePricePerSession: 400000,
        },
      },
    },
  });
  assert.ok(ptProf.id);

  await prisma.pTTrainingLocation.create({
    data: {
      ptUserId: approvedPtId,
      provinceCode: PROV_1,
      wardCode: WARD_1A,
      gymName: "Gym D1 Test",
      addressLine: "10 Le Loi",
      isPrimary: true,
      isActive: true,
    },
  });

  await prisma.pTAvailability.createMany({
    data: [
      { ptUserId: approvedPtId, dayOfWeek: DayOfWeek.MONDAY, startTime: "08:00", endTime: "12:00", isActive: true },
      { ptUserId: approvedPtId, dayOfWeek: DayOfWeek.WEDNESDAY, startTime: "08:00", endTime: "12:00", isActive: true },
      { ptUserId: approvedPtId, dayOfWeek: DayOfWeek.FRIDAY, startTime: "08:00", endTime: "12:00", isActive: true },
    ],
  });

  await prisma.pTServicePackage.create({
    data: {
      ptUserId: approvedPtId,
      name: "D1 Offline Pack",
      sessionCount: 5,
      price: 1800000,
      sessionMode: ServiceMode.OFFLINE,
      sessionDurationMinutes: 60,
      isActive: true,
    },
  });

  // Seed hidden (suspended) PT
  await prisma.userProfile.create({
    data: {
      userId: hiddenPtId,
      firstName: "Hidden",
      lastName: "Trainer",
      isPT: true,
      ptSuspended: true,
      isAcceptingClients: true,
      specialties: ["Gym"],
      ptApplication: {
        create: {
          status: PTApplicationStatus.APPROVED,
          approvedAt: new Date(),
          serviceMode: ServiceMode.ONLINE,
          mainSpecialties: ["Gym"],
          yearsOfExperience: "2",
        },
      },
    },
  });
});

test.after(async () => {
  for (const r of restores.reverse()) r();
  await app.close();

  await prisma.pTTrainingLocation.deleteMany({ where: { ptUserId: { in: createdUserIds } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { in: createdUserIds } } });
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { in: createdUserIds } } });
  const profs = await prisma.userProfile.findMany({
    where: { userId: { in: createdUserIds } },
    select: { id: true },
  });
  await prisma.pTApplication.deleteMany({
    where: { userProfileId: { in: profs.map((p) => p.id) } },
  });
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.vietnamWardGeo.deleteMany({ where: { wardCode: { in: [WARD_1A, WARD_1B_NO_GEO, WARD_2A] } } });
  await prisma.vietnamWard.deleteMany({ where: { code: { in: [WARD_1A, WARD_1B_NO_GEO, WARD_2A] } } });
  await prisma.vietnamProvince.deleteMany({ where: { code: { in: [PROV_1, PROV_2] } } });
  await prisma.$disconnect();
});

test("D1.1 PUT & GET /profile/me searchProvinceCode / searchWardCode validation and national null clear", async () => {
  // Valid province + matching ward
  const ok = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: PROV_1,
    searchWardCode: WARD_1A,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.searchProvinceCode, PROV_1);
  assert.equal(ok.body.profile.searchWardCode, WARD_1A);
  assert.equal("latitude" in ok.body.profile, false);
  assert.equal("longitude" in ok.body.profile, false);

  const me1 = await app.call("GET", "/profile/me", customerToken);
  assert.equal(me1.status, 200);
  assert.equal(me1.body.profile.searchProvinceCode, PROV_1);
  assert.equal(me1.body.profile.searchWardCode, WARD_1A);

  // Ward from different province -> 400
  const mismatch = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: PROV_1,
    searchWardCode: WARD_2A,
  });
  assert.equal(mismatch.status, 400);

  // Unknown province -> 400
  const badProv = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: 999999999,
    searchWardCode: null,
  });
  assert.equal(badProv.status, 400);

  // Ward without province -> 400
  const wardOnly = await app.call("PUT", "/profile/me", customerToken, {
    searchWardCode: WARD_1A,
  });
  assert.equal(wardOnly.status, 400);

  const wardWithNullProv = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: null,
    searchWardCode: WARD_1A,
  });
  assert.equal(wardWithNullProv.status, 400);

  // Switch province without passing ward -> stale ward cleared to null
  const switchProv = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: PROV_2,
  });
  assert.equal(switchProv.status, 200);
  assert.equal(switchProv.body.profile.searchProvinceCode, PROV_2);
  assert.equal(switchProv.body.profile.searchWardCode, null);

  // National ("Toàn quốc"): searchProvinceCode: null clears both
  const clearNat = await app.call("PUT", "/profile/me", customerToken, {
    searchProvinceCode: null,
  });
  assert.equal(clearNat.status, 200);
  assert.equal(clearNat.body.profile.searchProvinceCode, null);
  assert.equal(clearNat.body.profile.searchWardCode, null);
});

test("D1.2 GET /locations/wards/:code returns centroid/bbox when present, nulls when absent, 404/400 on invalid", async () => {
  const withGeo = await app.call("GET", `/locations/wards/${WARD_1A}`, null);
  assert.equal(withGeo.status, 200);
  assert.equal(withGeo.body.code, WARD_1A);
  assert.equal(withGeo.body.provinceCode, PROV_1);
  assert.equal(withGeo.body.name, `Test Phuong 1A ${tag}`);
  assert.deepEqual(withGeo.body.centroid, { lat: 10.776889, lng: 106.700806 });
  assert.deepEqual(withGeo.body.bbox, {
    minLat: 10.76,
    maxLat: 10.79,
    minLng: 106.68,
    maxLng: 106.72,
  });

  const withoutGeo = await app.call("GET", `/locations/wards/${WARD_1B_NO_GEO}`, null);
  assert.equal(withoutGeo.status, 200);
  assert.equal(withoutGeo.body.code, WARD_1B_NO_GEO);
  assert.equal(withoutGeo.body.centroid, null);
  assert.equal(withoutGeo.body.bbox, null);

  const missing = await app.call("GET", `/locations/wards/${baseCode * 1000 + 99}`, null);
  assert.equal(missing.status, 404);

  const badStr = await app.call("GET", "/locations/wards/not-a-code", null);
  assert.equal(badStr.status, 400);
  const badZero = await app.call("GET", "/locations/wards/0", null);
  assert.equal(badZero.status, 400);
});

test("D1.3 pt_training_locations & pt_application validate VN coords, round to 6 decimals, clear on null, and promote on approve", async () => {
  // Unpaired -> 400
  const unpaired = await app.call("POST", "/pt/training-locations/me", ptToken, {
    provinceCode: PROV_1,
    wardCode: WARD_1A,
    latitude: 10.77,
  });
  assert.equal(unpaired.status, 400);

  // Out of VN bounds -> 400
  const outLat = await app.call("POST", "/pt/training-locations/me", ptToken, {
    provinceCode: PROV_1,
    latitude: 7.9,
    longitude: 106.7,
  });
  assert.equal(outLat.status, 400);

  const outLng = await app.call("POST", "/pt/training-locations/me", ptToken, {
    provinceCode: PROV_1,
    latitude: 10.7,
    longitude: 110.2,
  });
  assert.equal(outLng.status, 400);

  // Valid create with >6 decimals -> rounded to 6 decimals
  const created = await app.call("POST", "/pt/training-locations/me", ptToken, {
    provinceCode: PROV_1,
    wardCode: WARD_1A,
    gymName: "Gym Coords",
    latitude: 10.7768894,
    longitude: 106.7008066,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.latitude, 10.776889);
  assert.equal(created.body.longitude, 106.700807);
  const locId = created.body.id;

  // PATCH unpaired -> 400
  const patchBad = await app.call("PATCH", `/pt/training-locations/me/${locId}`, ptToken, {
    longitude: 106.71,
  });
  assert.equal(patchBad.status, 400);

  // PATCH valid rounded -> 200
  const patchOk = await app.call("PATCH", `/pt/training-locations/me/${locId}`, ptToken, {
    latitude: 10.78123456,
    longitude: 106.71123456,
  });
  assert.equal(patchOk.status, 200);
  assert.equal(patchOk.body.latitude, 10.781235);
  assert.equal(patchOk.body.longitude, 106.711235);

  // PATCH null, null clears coords
  const patchClear = await app.call("PATCH", `/pt/training-locations/me/${locId}`, ptToken, {
    latitude: null,
    longitude: null,
  });
  assert.equal(patchClear.status, 200);
  assert.equal(patchClear.body.latitude, null);
  assert.equal(patchClear.body.longitude, null);

  // PT Application draft rejects out-of-bounds coords in applicationTrainingLocations
  const badDraft = await app.call("POST", "/pt-applications/me/draft", applicantToken, {
    phoneNumber: "0909123456",
    serviceMode: "OFFLINE",
    mainSpecialties: ["Gym"],
    offlinePricePerSession: 300000,
    applicationTrainingLocations: [
      { provinceCode: PROV_1, wardCode: WARD_1A, gymName: "Draft Bad", latitude: 25.1, longitude: 106.7 },
    ],
  });
  assert.equal(badDraft.status, 400);

  // Valid draft -> submit -> admin approve -> promotes 6-decimal coords to PTTrainingLocation
  const goodDraft = await app.call("POST", "/pt-applications/me/draft", applicantToken, {
    phoneNumber: "0909123456",
    nationalIdNumber: "079099001122",
    currentAddress: "123 Nguyen Hue",
    idCardFrontUrl: "https://example.com/front.jpg",
    idCardBackUrl: "https://example.com/back.jpg",
    portraitPhotoUrl: "https://example.com/portrait.jpg",
    yearsOfExperience: "3",
    serviceMode: "OFFLINE",
    mainSpecialties: ["Gym"],
    offlinePricePerSession: 300000,
    applicationTrainingLocations: [
      {
        provinceCode: PROV_1,
        wardCode: WARD_1A,
        gymName: "Draft Gym Valid",
        latitude: 10.7712349,
        longitude: 106.6912341,
        isPrimary: true,
      },
    ],
  });
  assert.equal(goodDraft.status, 200);
  const appId = goodDraft.body.id;

  // Move draft directly to SUBMITTED to exercise reviewApplication promotion cleanly
  await prisma.pTApplication.update({
    where: { id: appId },
    data: { status: PTApplicationStatus.SUBMITTED },
  });

  const approved = await app.call("POST", `/pt-applications/admin/${appId}/review/APPROVE`, adminToken, {});
  assert.equal(approved.status, 200);

  const promotedLocs = await prisma.pTTrainingLocation.findMany({
    where: { ptUserId: applicantId },
  });
  assert.equal(promotedLocs.length, 1);
  assert.equal(promotedLocs[0].gymName, "Draft Gym Valid");
  assert.equal(promotedLocs[0].latitude, 10.771235);
  assert.equal(promotedLocs[0].longitude, 106.691234);
});

test("D1.4 GET /profile/pts/:userId includes full discovery fields matching listPTs and leaks zero private fields", async () => {
  const detail = await app.call(
    "GET",
    `/profile/pts/${approvedPtId}?areaProvince=${PROV_1}&areaWard=${WARD_1A}`,
    customerToken,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.userId, approvedPtId);
  assert.ok(typeof detail.body.availableSlotsNext28Days === "number" && detail.body.availableSlotsNext28Days > 0);
  assert.equal(detail.body.matchReason, "SAME_WARD");
  // Parity check against list endpoint GET /profile/pts
  const listed = await app.call(
    "GET",
    `/profile/pts?areaProvince=${PROV_1}&areaWard=${WARD_1A}&q=Huan`,
    customerToken,
  );
  assert.equal(listed.status, 200);
  const foundInList = (listed.body.pts as any[]).find((p) => p.userId === approvedPtId);
  assert.ok(foundInList);
  assert.equal(detail.body.matchReason, foundInList.matchReason);
  assert.equal(detail.body.availableSlotsNext28Days, foundInList.availableSlotsNext28Days);
  assert.equal(detail.body.ptApplication?.onlinePricePerSession, null);
  assert.equal(detail.body.ptApplication?.offlinePricePerSession, 360000);
  // Every key returned by GET /profile/pts is present on GET /profile/pts/:userId
  for (const k of Object.keys(foundInList)) {
    assert.ok(k in detail.body, `detail missing list key: ${k}`);
  }
  assert.ok(detail.body.ptApplication);
  assert.ok(Array.isArray(detail.body.recentReviews));
  assert.ok(detail.body.ratingDistribution);
  assert.ok(Array.isArray(detail.body.trainingLocations) && detail.body.trainingLocations.length >= 1);

  // Zero private fields leaked
  for (const forbidden of [
    "email",
    "phoneNumber",
    "nationalIdNumber",
    "searchProvinceCode",
    "searchWardCode",
    "idCardFrontUrl",
    "idCardBackUrl",
  ]) {
    assert.equal(forbidden in detail.body, false, `private key leaked: ${forbidden}`);
  }

  // areaWard without areaProvince -> 400
  const badArea = await app.call("GET", `/profile/pts/${approvedPtId}?areaWard=${WARD_1A}`, customerToken);
  assert.equal(badArea.status, 400);

  // Hidden/suspended PT -> 404
  const hidden = await app.call("GET", `/profile/pts/${hiddenPtId}`, customerToken);
  assert.equal(hidden.status, 404);
});
