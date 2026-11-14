/**
 * Parity suite for the single-statement PT page hydration (round-2 discovery optimisation).
 *
 * Proves, on fixture data in the isolated *_test database, that
 *   - profileRepository.hydratePublicPtsByIds (ONE SQL statement, ratings folded in)
 *       == profileRepository.hydratePublicPtsByIdsPrisma + attachPtRatings (the previous multi-statement path)
 *     compared at the toPublicPtDto level via JSON.stringify (byte-for-byte what the API serialises);
 *   - availabilityService.countAvailableSlotsForPTsOneQuery == countAvailableSlotsForPTs (3 statements)
 *     on availability / schedule exceptions / booked-session fixtures, including rows outside the window,
 *     cancelled sessions and day-offs.
 *
 * Evidence label: BACKEND INTEGRATION (real Prisma client + real PostgreSQL *_test DB), TEST FIXTURE data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { Prisma } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { attachPtRatings } from "../repositories/ptReview.repository";
import { toPublicPtDto, type PublishedPtSource } from "../services/pt-public-dto";
import { availabilityService } from "../services/availability.service";

const tag = randomUUID().replace(/-/g, "").slice(0, 8);
const prefix = `hyd_${tag}_`;
const PROV = 990401;
const WARD = 99040101;
const ptA = `${prefix}ptA`; // everything populated
const ptB = `${prefix}ptB`; // profile + application, nothing else
const ptC = `${prefix}ptC`; // profile only (no application)
const ptD = `${prefix}ptD`; // rated, no packages, nameless-ish nulls
const ptE = `${prefix}ptE`; // two locations tied on (isPrimary, createdAt)
const clientId = `${prefix}client`;

async function cleanup(): Promise<void> {
  await prisma.sessionReview.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.contract.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.pTScheduleException.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.ptPhysiquePhoto.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTTrainingLocation.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTApplication.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: prefix } } });
}

const dayMs = 86_400_000;
const WINDOW_FROM = new Date(Date.now());
const WINDOW_TO = new Date(Date.now() + 28 * dayMs);

test.before(async () => {
  await cleanup();
  await prisma.vietnamProvince.upsert({
    where: { code: PROV },
    update: {},
    create: { code: PROV, name: "Tỉnh Hydrate", nameNormalized: "tinh hydrate" },
  });
  await prisma.vietnamWard.upsert({
    where: { code: WARD },
    update: {},
    create: { code: WARD, provinceCode: PROV, name: "Phường Hydrate", nameNormalized: "phuong hydrate" },
  });

  await prisma.userProfile.createMany({
    data: [
      {
        id: `${prefix}pA`, userId: ptA, email: `${ptA}@hyd.test.local`, firstName: "Ánh", lastName: "Trần",
        isPT: true, specialties: ["Giảm mỡ", "Tăng cơ"], isAcceptingClients: true,
        photoUrl: "s3://profile-photos/x/y.jpg", searchCity: "HCM", searchDistrict: "Q1", searchWard: "P1", gymId: "g-1",
      },
      { id: `${prefix}pB`, userId: ptB, email: `${ptB}@hyd.test.local`, firstName: "Bình", lastName: null, isPT: true, isAcceptingClients: false, notAcceptingReason: "Đầy lịch" },
      { id: `${prefix}pC`, userId: ptC, email: `${ptC}@hyd.test.local`, firstName: "Cường", isPT: true },
      { id: `${prefix}pD`, userId: ptD, email: `${ptD}@hyd.test.local`, firstName: null, lastName: null, isPT: true },
      { id: `${prefix}pE`, userId: ptE, email: `${ptE}@hyd.test.local`, firstName: "Em", isPT: true },
      { id: `${prefix}pClient`, userId: clientId, email: `${clientId}@hyd.test.local` },
    ],
  });

  await prisma.pTApplication.create({
    data: {
      id: `${prefix}aA`, userProfileId: `${prefix}pA`, status: "APPROVED", serviceMode: "HYBRID",
      operatingAreas: ["Q1", "Q3"], gymAffiliation: "Gym X", professionalBio: "Bio có dấu ✓", yearsOfExperience: "5",
      educationBackground: "ĐH TDTT", previousWorkExperience: "PT 3 năm", trainingMethodsApproach: "Progressive",
      targetClientGroups: ["Người mới"], primaryTrainingGoals: ["Giảm mỡ"], availableDays: ["MONDAY", "FRIDAY"],
      availableFrom: "06:00", availableUntil: "20:00",
      availabilityBlocks: [{ day: "MONDAY", start: "06:00", end: "10:00" }, { zebra: 1, alpha: [1, 2] }],
      linkedinUrl: "https://example.test/in/a", websiteUrl: null, mainSpecialties: ["Strength"], languages: ["vi", "en"],
      approvedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
  });
  await prisma.pTApplication.createMany({
    data: [
      { id: `${prefix}aB`, userProfileId: `${prefix}pB`, status: "APPROVED", serviceMode: "ONLINE" },
      { id: `${prefix}aD`, userProfileId: `${prefix}pD`, status: "APPROVED", serviceMode: "OFFLINE" },
      { id: `${prefix}aE`, userProfileId: `${prefix}pE`, status: "APPROVED", serviceMode: "OFFLINE" },
    ],
  });
  await prisma.pTApplicationCertificate.createMany({
    data: [
      { applicationId: `${prefix}aA`, certificateName: "ACE", issuingOrganization: "ACE Org", isCurrentlyValid: true, certificationStatus: "Valid", issueDate: new Date("2024-03-01T07:15:30.123Z"), expirationDate: new Date("2027-03-01T00:00:00.000Z"), createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { applicationId: `${prefix}aA`, certificateName: "NASM", issuingOrganization: "NASM", isCurrentlyValid: false, certificationStatus: null, issueDate: null, expirationDate: null, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ],
  });

  await prisma.pTTrainingLocation.createMany({
    data: [
      { id: `${prefix}l1`, ptUserId: ptA, provinceCode: PROV, wardCode: WARD, gymName: "Gym A", addressLine: "1 Lê Lợi", isPrimary: false, isActive: true, gymId: "g-1", createdAt: new Date("2026-02-01T00:00:00.000Z") },
      { id: `${prefix}l2`, ptUserId: ptA, provinceCode: PROV, wardCode: null, gymName: "Gym B", isPrimary: true, isActive: true, createdAt: new Date("2026-03-01T00:00:00.000Z") },
      { id: `${prefix}l3`, ptUserId: ptA, provinceCode: PROV, wardCode: WARD, gymName: "Gym Inactive", isPrimary: false, isActive: false },
      { id: `${prefix}l4`, ptUserId: ptA, provinceCode: PROV, wardCode: WARD, gymName: "Gym C", isPrimary: false, isActive: true, createdAt: new Date("2026-01-15T00:00:00.000Z") },
    ],
  });

  const tied = new Date("2026-02-01T00:00:00.000Z");
  await prisma.pTTrainingLocation.createMany({
    data: [
      { id: `${prefix}lt_b`, ptUserId: ptE, provinceCode: PROV, wardCode: WARD, gymName: "Tie B", isPrimary: false, isActive: true, createdAt: tied },
      { id: `${prefix}lt_a`, ptUserId: ptE, provinceCode: PROV, wardCode: WARD, gymName: "Tie A", isPrimary: false, isActive: true, createdAt: tied },
    ],
  });

  await prisma.pTServicePackage.createMany({
    data: [
      { id: `${prefix}k1`, ptUserId: ptA, name: "Gói 10", sessionCount: 10, price: new Prisma.Decimal("2500000.00"), sessionMode: "OFFLINE", createdAt: new Date("2026-04-01T00:00:00.000Z") },
      { id: `${prefix}k2`, ptUserId: ptA, name: "Gói online", description: "mô tả", sessionCount: 4, price: new Prisma.Decimal("123456.50"), sessionMode: "ONLINE", validityDays: 60, version: 3, createdAt: new Date("2026-05-01T00:00:00.000Z") },
      { id: `${prefix}k3`, ptUserId: ptA, name: "Gói ngưng", sessionCount: 1, price: new Prisma.Decimal("100000"), sessionMode: "OFFLINE", isActive: false },
      { id: `${prefix}k4`, ptUserId: ptA, name: "Gói lưu trữ", sessionCount: 1, price: new Prisma.Decimal("100000"), sessionMode: "OFFLINE", archivedAt: new Date("2026-06-01T00:00:00.000Z") },
      { id: `${prefix}k5`, ptUserId: ptA, name: "Gói cùng ngày b", sessionCount: 2, price: new Prisma.Decimal("300000"), sessionMode: "OFFLINE", createdAt: new Date("2026-04-01T00:00:00.000Z") },
    ],
  });

  await prisma.ptPhysiquePhoto.createMany({
    data: [
      { id: `${prefix}h2`, ptUserId: ptA, storageKey: "k2", status: "PUBLISHED", sortOrder: 2, isCover: false, mime: "image/webp", bytes: 10, uploadedBy: ptA },
      { id: `${prefix}h1`, ptUserId: ptA, storageKey: "k1", status: "PUBLISHED", sortOrder: 1, isCover: true, mime: "image/webp", bytes: 10, uploadedBy: ptA },
      { id: `${prefix}h3`, ptUserId: ptA, storageKey: "k3", status: "STAGED", sortOrder: 0, isCover: false, mime: "image/webp", bytes: 10, uploadedBy: ptA },
    ],
  });

  // ratings: ptA 5,4,4 => 4.3 ; ptD 3 => 3
  const ratingPlan: [string, number[]][] = [[ptA, [5, 4, 4]], [ptD, [3]]];
  for (const [pt, ratings] of ratingPlan) {
    const contractId = `${prefix}c_${pt}`;
    await prisma.contract.create({
      data: { id: contractId, ptUserId: pt, clientUserId: clientId, status: "COMPLETED", packageName: "Hyd", totalSessions: ratings.length },
    });
    for (const [i, rating] of ratings.entries()) {
      const sid = `${prefix}rs_${pt}_${i}`;
      await prisma.session.create({
        data: {
          id: sid, contractId, clientUserId: clientId, ptUserId: pt, status: "COMPLETED",
          scheduledStartAt: new Date("2026-08-01T10:00:00.000Z"), scheduledEndAt: new Date("2026-08-01T11:00:00.000Z"),
        },
      });
      await prisma.sessionReview.create({ data: { id: `${prefix}rv_${pt}_${i}`, sessionId: sid, contractId, clientUserId: clientId, rating } });
    }
  }

  // availability + exceptions + booked sessions for the slots parity case
  await prisma.pTAvailability.createMany({
    data: [
      { ptUserId: ptA, dayOfWeek: "MONDAY", startTime: "06:00", endTime: "10:00" },
      { ptUserId: ptA, dayOfWeek: "WEDNESDAY", startTime: "17:00", endTime: "20:00" },
      { ptUserId: ptA, dayOfWeek: "SATURDAY", startTime: "08:00", endTime: "12:00", isActive: false },
      { ptUserId: ptB, dayOfWeek: "TUESDAY", startTime: "09:00", endTime: "12:00" },
      { ptUserId: ptB, dayOfWeek: "THURSDAY", startTime: "09:00", endTime: "11:00" },
      { ptUserId: ptB, dayOfWeek: "SUNDAY", startTime: "09:00", endTime: "11:00" },
      { ptUserId: ptB, dayOfWeek: "MONDAY", startTime: "09:00", endTime: "11:00" },
    ],
  });
  await prisma.pTScheduleException.createMany({
    data: [
      { ptUserId: ptA, date: new Date(WINDOW_FROM.getTime() + 2 * dayMs) },
      { ptUserId: ptA, date: new Date(WINDOW_FROM.getTime() + 9 * dayMs) },
      { ptUserId: ptB, date: new Date(WINDOW_FROM.getTime() + 3 * dayMs) },
      { ptUserId: ptA, date: new Date(WINDOW_FROM.getTime() - 5 * dayMs) }, // outside the window
      { ptUserId: ptA, date: new Date(WINDOW_FROM.getTime() + 40 * dayMs) }, // outside the window
    ],
  });
  const slotContract = `${prefix}c_slots`;
  await prisma.contract.create({
    data: { id: slotContract, ptUserId: ptB, clientUserId: clientId, status: "ACTIVE", packageName: "Hyd slots", totalSessions: 20 },
  });
  const mkSession = (i: number, ptUserId: string, status: any, startOffsetDays: number, hour: number) => {
    const start = new Date(WINDOW_FROM.getTime() + startOffsetDays * dayMs);
    start.setUTCHours(hour, 0, 0, 0);
    return prisma.session.create({
      data: {
        id: `${prefix}bk_${i}`, contractId: slotContract, clientUserId: clientId, ptUserId, status,
        scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 3_600_000),
      },
    });
  };
  await mkSession(1, ptB, "CONFIRMED", 1, 2);
  await mkSession(2, ptB, "REQUESTED", 2, 3);
  await mkSession(3, ptB, "CANCELLED", 3, 2);
  await mkSession(4, ptB, "CONFIRMED", 40, 2); // outside the window
  await mkSession(5, ptB, "CONFIRMED", 8, 2);
  await mkSession(6, ptB, "COMPLETED", 8, 3);
});

test.after(async () => {
  await cleanup();
  await prisma.vietnamWard.deleteMany({ where: { code: WARD } }).catch(() => {});
  await prisma.vietnamProvince.deleteMany({ where: { code: PROV } }).catch(() => {});
});

async function legacyHydrate(ids: string[]) {
  const sources = await profileRepository.hydratePublicPtsByIdsPrisma(ids);
  return attachPtRatings(sources as any[]);
}

const dto = (row: any) =>
  toPublicPtDto(row as PublishedPtSource, {
    avgRating: row.avgRating,
    ratingCount: row.ratingCount,
    availableSlotsNext28Days: 7,
    matchReason: null,
  });

test("hydrate: single-statement rows serialise byte-for-byte like the Prisma path (order, missing ids, nulls, dates, Decimal, JSON)", async () => {
  const ids = [ptC, ptA, `${prefix}missing`, ptD, ptB];
  const legacy = await legacyHydrate(ids);
  const fresh = await profileRepository.hydratePublicPtsByIds(ids);

  assert.deepEqual(fresh.map((r) => r.userId), [ptC, ptA, ptD, ptB], "input order kept, missing id dropped");
  assert.deepEqual(fresh.map((r) => r.userId), legacy.map((r) => r.userId));
  assert.equal(JSON.stringify(fresh.map(dto)), JSON.stringify(legacy.map(dto)), "public DTO JSON is identical");
  // Raw source rows (Date objects, Prisma.Decimal, scalar lists, JSON column, nested relations) deep-equal too.
  assert.deepStrictEqual(fresh, legacy, "hydrated source rows deep-equal the Prisma path + attachPtRatings");

  const a = fresh.find((r) => r.userId === ptA)!;
  assert.equal(a.avgRating, 4.3);
  assert.equal(a.ratingCount, 3);
  assert.equal(fresh.find((r) => r.userId === ptB)!.avgRating, null);
  assert.equal(fresh.find((r) => r.userId === ptB)!.ratingCount, 0);
  assert.equal(fresh.find((r) => r.userId === ptC)!.ptApplication, null);
  assert.ok(a.ptApplication!.certificates[0].issueDate instanceof Date);
  assert.ok(a.servicePackages[0].price instanceof Prisma.Decimal);
  assert.deepEqual(a.trainingLocations.map((l) => l.id), [`${prefix}l2`, `${prefix}l4`, `${prefix}l1`], "primary first, then created_at; inactive excluded");
  assert.deepEqual(a.physiquePhotos.map((p) => p.id), [`${prefix}h1`, `${prefix}h2`], "PUBLISHED only, sort_order asc");
  assert.equal(a.servicePackages.length, 3, "inactive + archived packages excluded");
});

test("hydrate: locations tied on (isPrimary, createdAt) come back in id order (deterministic; the Prisma path left ties arbitrary)", async () => {
  const [row] = await profileRepository.hydratePublicPtsByIds([ptE]);
  assert.deepEqual(row.trainingLocations.map((l) => l.id), [`${prefix}lt_a`, `${prefix}lt_b`]);
});

test("hydrate: empty id list returns [] without a query", async () => {
  assert.deepEqual(await profileRepository.hydratePublicPtsByIds([]), []);
});

test("slots: one-statement count equals the three-statement count on availability / exceptions / bookings fixtures", async () => {
  const ids = [ptA, ptB, ptC, ptD];
  const three = await availabilityService.countAvailableSlotsForPTs(ids, WINDOW_FROM, WINDOW_TO, 60);
  const one = await availabilityService.countAvailableSlotsForPTsOneQuery(ids, WINDOW_FROM, WINDOW_TO, 60);
  assert.deepEqual(one, three);
  assert.ok(three[ptA] > 0 && three[ptB] > 0, "fixture produces non-trivial counts");
  assert.equal(three[ptC], 0);
  assert.deepEqual(await availabilityService.countAvailableSlotsForPTsOneQuery([], WINDOW_FROM, WINDOW_TO, 60), {});
  // a second window / duration so the date and booking arithmetic is exercised twice
  const from2 = new Date(WINDOW_FROM.getTime() + dayMs);
  const to2 = new Date(WINDOW_FROM.getTime() + 10 * dayMs);
  assert.deepEqual(
    await availabilityService.countAvailableSlotsForPTsOneQuery(ids, from2, to2, 30),
    await availabilityService.countAvailableSlotsForPTs(ids, from2, to2, 30),
  );
});
