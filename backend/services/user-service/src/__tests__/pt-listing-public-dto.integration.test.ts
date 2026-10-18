/**
 * PT listing management, phase C1 - the PUBLIC trainer surface (plan §1 B2, §12.7, §12.13 item 1).
 *
 * Evidence label: BACKEND INTEGRATION. The real user-service Express app runs on a random port against an isolated
 * `*_test` database; auth-service is not running (token -> identity table = TEST FIXTURE).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *     npx tsx --test src/__tests__/pt-listing-public-dto.integration.test.ts
 *
 * Covers: one visibility rule for list + detail + service-packages (suspended / PT-scope restricted / not approved
 * hidden, CONTRACT-scope restricted still visible), an allowlisted DTO that leaks nothing private, the derived
 * "from" prices + legacy price fields (never written back) + the per-session price filter and sort, PUBLISHED-only
 * physique photos, and the photoUrl ownership check on PUT /profile/me.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { makeContract } from "./pt-restriction.test-helpers";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";
import { PRIVATE_MARKERS, cleanupListingPts, makePackage, makePublicPt } from "./pt-listing.test-helpers";

let app: App;
const created: string[] = [];
const contracts: string[] = [];
const others: string[] = [];
const envBackup: Record<string, string | undefined> = {};

test.before(async () => {
  for (const k of ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "USER_UPLOAD_BUCKET"]) envBackup[k] = process.env[k];
  // Fake-but-well-formed credentials: SigV4 presigning is a local computation (no network), see profile-photo-presign.test.ts.
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKEFAKE";
  process.env.AWS_SECRET_ACCESS_KEY = "fakefakefakefakefakefakefakefakefakefake";
  process.env.USER_UPLOAD_BUCKET = "fitness-assistant-uploads-test";
  app = await startApp();
});

test.after(async () => {
  await app.close();
  await cleanupListingPts(created, contracts, others);
  await prisma.userProfile.deleteMany({ where: { userId: { in: others } } }).catch(() => {});
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const viewer = () => {
  const id = randomUUID();
  others.push(id);
  return tokenFor(id, "CUSTOMER");
};

const listIds = async (query: string, token = viewer()): Promise<string[]> => {
  const r = await app.call("GET", `/profile/pts?${query}`, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body.pts as any[]).map((p) => p.userId);
};

// ── 1. one visibility rule ────────────────────────────────────────────────────────────────────

test("visibility: suspended / PT-scope restricted / not approved are hidden in list, detail AND service-packages; a CONTRACT-scope restriction does not hide", async () => {
  const shared = `Vis${randomUUID().slice(0, 6)}`;
  const mk = async (letter: string, opts: Parameters<typeof makePublicPt>[0] = {}) => {
    const pt = await makePublicPt({ marker: `${shared}${letter}`, ...opts });
    created.push(pt.userId);
    await makePackage(pt.userId, { name: `Gói ${letter}` });
    return pt;
  };
  const A = await mk("A"); // plain visible control
  const B = await mk("B", { ptSuspended: true }); // the profile flag
  const C = await mk("C"); // open ACCOUNT-scope TEMPORARY_SUSPENSION record, flag NOT set
  const D = await mk("D", { application: "NONE" }); // no application at all
  const E = await mk("E", { application: "SUBMITTED" }); // application not approved
  const F = await mk("F", { isPT: false }); // approved application but not a PT
  const G = await mk("G"); // CONTRACT-scope restriction only -> still visible
  const H = await mk("H"); // open ACCOUNT-scope PERMANENT_BAN record

  await prisma.ptRestriction.create({ data: { ptUserId: C.userId, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "ACCOUNT" } });
  await prisma.ptRestriction.create({ data: { ptUserId: H.userId, type: "PERMANENT_BAN", imposedBy: "admin-1", scope: "ACCOUNT" } });
  const contract = await makeContract(G.userId, {});
  contracts.push(contract.id);
  await prisma.ptRestriction.create({
    data: { ptUserId: G.userId, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "CONTRACT", contractId: contract.id },
  });
  assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: C.userId } })).ptSuspended, false, "fixture: C is hidden by the RECORD alone");

  const tok = viewer();
  const visible = [A, G];
  const hidden = [B, C, D, E, F, H];

  // list
  const ids = await listIds(`q=${shared}&limit=100`, tok);
  assert.deepEqual(new Set(ids), new Set(visible.map((p) => p.userId)), "list shows exactly A and G");

  // detail + service-packages
  for (const pt of visible) {
    const d = await app.call("GET", `/profile/pts/${pt.userId}`, tok);
    assert.equal(d.status, 200, `detail ${pt.marker}: ${JSON.stringify(d.body)}`);
    assert.equal(d.body.userId, pt.userId);
    const p = await app.call("GET", `/profile/pts/${pt.userId}/service-packages`, tok);
    assert.equal(p.status, 200);
    assert.equal(p.body.packages.length, 1);
    assert.equal(p.body.packages[0].version, 1, "each package carries its version");
  }
  for (const pt of hidden) {
    const d = await app.call("GET", `/profile/pts/${pt.userId}`, tok);
    assert.equal(d.status, 404, `detail of hidden ${pt.marker} must be 404, got ${d.status}`);
    const p = await app.call("GET", `/profile/pts/${pt.userId}/service-packages`, tok);
    assert.equal(p.status, 404, `service-packages of hidden ${pt.marker} must be 404, got ${p.status}`);
  }
  assert.equal((await app.call("GET", `/profile/pts/${randomUUID()}`, tok)).status, 404, "unknown id");
  assert.equal((await app.call("GET", `/profile/pts/${randomUUID()}/service-packages`, tok)).status, 404, "unknown id");

  // lifting the PT-scope restriction brings C back (the rule reads the live record, nothing is cached)
  await prisma.ptRestriction.updateMany({ where: { ptUserId: C.userId }, data: { endedAt: new Date(), endKind: "LIFTED" } });
  assert.ok((await listIds(`q=${shared}&limit=100`, tok)).includes(C.userId), "C visible after the restriction ended");
});

// ── 2. the DTO is an allowlist ───────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = [
  "email", "dateOfBirth", "age", "gender", "heightCm", "currentWeight", "targetWeight", "startingWeight", "startingWeightSource",
  "goal", "goalIntent", "activityLevel", "experienceLevel", "competesInSport", "safetyScreeningStatus", "safetyScreeningFlags",
  "injuries", "availableEquipment", "preferredTrainingDays", "preferredSplit", "dietaryPreference", "region", "ptBudgetVnd",
  "referralCode", "ptLockSeq", "dataOrigin", "unitSystem", "energyUnit", "hasCompletedOnboarding", "nutritionBudgetLevel",
  "firstNameNormalized", "lastNameNormalized", "listingVersion", "listingPublishedAt", "createdAt", "updatedAt", "id",
  "status", "portfolioUrl", "socialLinks", "phoneNumber", "nationalIdNumber", "currentAddress", "adminNote", "rejectionReason",
  "reviewedByUserId", "idCardFrontUrl", "idCardBackUrl", "portraitPhotoUrl", "certificationNumber", "certificateFileUrl",
  "verificationStatus", "note", "gymNameNormalized", "residenceAddressLine", "residenceProvinceCode", "applicationTrainingLocations",
  "userProfileId", "otherReferences", "availabilityNotes", "availableTimeSlots", "media",
];
const ALLOWED_TOP = new Set([
  "userId", "firstName", "lastName", "photoUrl", "specialties", "isAcceptingClients", "notAcceptingReason", "searchCity",
  "searchDistrict", "searchWard", "ptSuspended", "ptApplication", "trainingLocations", "servicePackages", "fromPricePerSession",
  "fromPackagePrice", "physiquePhotos", "coverPhotoUrl", "avgRating", "ratingCount", "availableSlotsNext28Days", "matchReason",
  "recentReviews", "ratingDistribution",
]);
const ALLOWED_APP = new Set([
  "serviceMode", "operatingAreas", "gymAffiliation", "professionalBio", "yearsOfExperience", "educationBackground",
  "previousWorkExperience", "trainingMethodsApproach", "targetClientGroups", "primaryTrainingGoals", "availableDays",
  "availableFrom", "availableUntil", "availabilityBlocks", "websiteUrl", "linkedinUrl", "mainSpecialties", "languages",
  "certificates", "desiredSessionPrice", "onlinePricePerSession", "offlinePricePerSession", "onlinePackagePrice",
  "offlinePackagePrice", "monthlyProgramPrice", "packagePrice", "sessionsPerPackage", "additionalPricingNotes",
  "fromPricePerSession", "fromPackagePrice",
]);

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

test("DTO: list and detail carry only allowlisted fields - no private profile / application / location data, no email, nothing that breaks JSON", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  await makePackage(pt.userId, { name: "Gói 10 buổi", sessionCount: 10, price: 2_000_000 });
  const tok = viewer();

  const list = await app.call("GET", `/profile/pts?q=${pt.marker}`, tok);
  assert.equal(list.status, 200, `a BigInt ptLockSeq must not turn the list into a 500: ${JSON.stringify(list.body)}`);
  const detail = await app.call("GET", `/profile/pts/${pt.userId}`, tok);
  assert.equal(detail.status, 200);
  const fromList = (list.body.pts as any[]).find((p) => p.userId === pt.userId);
  assert.ok(fromList, "the PT is in the list");

  for (const [label, dto] of [["list", fromList], ["detail", detail.body]] as const) {
    // every top-level / ptApplication key is on the allowlist
    for (const k of Object.keys(dto)) assert.ok(ALLOWED_TOP.has(k), `${label}: unexpected top-level key "${k}"`);
    for (const k of Object.keys(dto.ptApplication)) assert.ok(ALLOWED_APP.has(k), `${label}: unexpected ptApplication key "${k}"`);
    // and none of the private names appears at ANY depth, except `id` which public packages / locations legitimately have
    const keys = allKeys(dto);
    for (const bad of FORBIDDEN_KEYS.filter((k) => k !== "id")) assert.ok(!keys.has(bad), `${label}: leaks "${bad}"`);
    assert.ok(!Object.keys(dto).includes("gymId"), `${label}: top-level gymId is internal`);
    assert.ok(!Object.keys(dto).includes("id"), `${label}: profile row id is not public`);
    assert.equal(dto.ptSuspended, false);
    // the private VALUES never appear either (catches a field renamed on the way out)
    const text = JSON.stringify(dto);
    for (const secret of [...Object.values(PRIVATE_MARKERS), pt.email, pt.referralCode, "gym-private-1", "PRIVATE_GOAL_INTENT"]) {
      assert.ok(!text.includes(secret), `${label}: value "${secret}" leaked`);
    }
    // what IS public is there
    assert.equal(dto.firstName, pt.marker);
    assert.deepEqual(dto.specialties, ["STRENGTH", "YOGA"]);
    assert.deepEqual(dto.ptApplication.languages, ["vi", "en"]);
    assert.equal(dto.ptApplication.websiteUrl, "https://public-site.example");
    assert.equal(dto.ptApplication.status, undefined, "application status is meaningless to a client (always APPROVED)");
    assert.deepEqual(Object.keys(dto.ptApplication.certificates[0]).sort(), [
      "certificateName", "certificationStatus", "expirationDate", "isCurrentlyValid", "issueDate", "issuingOrganization",
    ]);
    assert.equal(dto.trainingLocations.length, 1);
    assert.deepEqual(Object.keys(dto.trainingLocations[0]).sort(), [
      "addressLine", "gymId", "gymName", "id", "isPrimary", "province", "provinceCode", "ward", "wardCode",
    ]);
    assert.equal(dto.trainingLocations[0].province.name, "Tỉnh Thử Nghiệm");
  }
  assert.ok("recentReviews" in detail.body && "ratingDistribution" in detail.body, "detail keeps its rating / review data");
  assert.ok("availableSlotsNext28Days" in fromList && "matchReason" in fromList, "list keeps its discovery ranking fields");
});

// ── 3. derived prices, filters, sorting ──────────────────────────────────────────────────────

test("prices: fromPricePerSession / fromPackagePrice and the legacy price fields are DERIVED from the packages for sale (never stored); price filter and sort work per session", async () => {
  const shared = `Prc${randomUUID().slice(0, 6)}`;
  const P1 = await makePublicPt({ marker: `${shared}1` });
  const P2 = await makePublicPt({ marker: `${shared}2` }); // no packages at all
  const P3 = await makePublicPt({ marker: `${shared}3` });
  created.push(P1.userId, P2.userId, P3.userId);

  // the plan's example: 10 x 2,000,000 (200k/session), 5 x 1,250,000 (250k/session), 1 x 300,000 (300k/session)
  await makePackage(P1.userId, { name: "10", sessionCount: 10, price: 2_000_000 });
  await makePackage(P1.userId, { name: "5", sessionCount: 5, price: 1_250_000 });
  await makePackage(P1.userId, { name: "1", sessionCount: 1, price: 300_000 });
  // P3: one ONLINE package at 500k/session; plus an ARCHIVED (100k) and an INACTIVE (120k) one that must be ignored everywhere
  await makePackage(P3.userId, { name: "online", sessionCount: 1, price: 500_000, sessionMode: "ONLINE" });
  await makePackage(P3.userId, { name: "archived", sessionCount: 1, price: 100_000, archivedAt: new Date(), isActive: false });
  await makePackage(P3.userId, { name: "inactive", sessionCount: 1, price: 120_000, isActive: false });

  const tok = viewer();
  const all = await app.call("GET", `/profile/pts?q=${shared}&limit=100`, tok);
  assert.equal(all.status, 200);
  const byId = new Map<string, any>((all.body.pts as any[]).map((p) => [p.userId, p]));
  assert.equal(byId.size, 3, "a visible trainer with no packages is still listed");

  const a1 = byId.get(P1.userId).ptApplication;
  assert.equal(byId.get(P1.userId).fromPricePerSession, 200_000);
  assert.equal(byId.get(P1.userId).fromPackagePrice, 300_000);
  assert.equal(a1.fromPricePerSession, 200_000);
  assert.equal(a1.fromPackagePrice, 300_000);
  // legacy fields: derived (OFFLINE only here), the stale registration values are gone from the response
  assert.deepEqual(
    [a1.desiredSessionPrice, a1.offlinePricePerSession, a1.onlinePricePerSession, a1.offlinePackagePrice, a1.onlinePackagePrice],
    [200_000, 200_000, null, 300_000, null],
  );
  assert.deepEqual([a1.monthlyProgramPrice, a1.packagePrice, a1.sessionsPerPackage, a1.additionalPricingNotes], [null, null, null, null]);
  assert.equal(byId.get(P1.userId).servicePackages.length, 3);
  assert.ok(byId.get(P1.userId).servicePackages.every((p: any) => p.version === 1));

  assert.equal(byId.get(P2.userId).fromPricePerSession, null);
  assert.equal(byId.get(P2.userId).fromPackagePrice, null);
  assert.deepEqual(byId.get(P2.userId).servicePackages, []);

  const a3 = byId.get(P3.userId).ptApplication;
  assert.deepEqual([a3.fromPricePerSession, a3.fromPackagePrice, a3.onlinePricePerSession, a3.offlinePricePerSession, a3.desiredSessionPrice], [500_000, 500_000, 500_000, null, 500_000]);
  assert.equal(byId.get(P3.userId).servicePackages.length, 1, "archived / inactive packages are not for sale");

  // "never written to DB": the application keeps what the trainer typed at registration
  const stored = await prisma.pTApplication.findUniqueOrThrow({ where: { id: P1.applicationId! } });
  assert.deepEqual(
    [stored.onlinePricePerSession, stored.offlinePricePerSession, stored.desiredSessionPrice, stored.packagePrice, stored.sessionsPerPackage],
    [111_111, 222_222, 333_333, 999_999, 7],
  );

  // detail agrees with the list
  const d = await app.call("GET", `/profile/pts/${P1.userId}`, tok);
  assert.equal(d.body.ptApplication.offlinePricePerSession, 200_000);
  assert.equal(d.body.fromPackagePrice, 300_000);

  // filters (>= 1 package for sale whose price/sessionCount is in range)
  const f = (q: string) => listIds(`q=${shared}&limit=100&${q}`, tok);
  assert.deepEqual(await f("minPrice=150000&maxPrice=220000"), [P1.userId], "150k-220k matches the 200k/session package");
  // NOTE (plan inconsistency, see the C1 report): the 5-session package is exactly 250,000 per session, so a 250k-280k
  // range DOES match it under the stated rule ">= 1 package in range"; 260k-280k is the genuine no-match range.
  assert.deepEqual(await f("minPrice=250000&maxPrice=280000"), [P1.userId], "250k-280k contains the 5-session package (250,000/session)");
  assert.deepEqual(await f("minPrice=260000&maxPrice=280000"), [], "260k-280k matches nothing");
  assert.deepEqual(await f("minPrice=100000&maxPrice=150000"), [], "archived (100k) and inactive (120k) packages never match");
  assert.deepEqual(await f("minPrice=400000"), [P3.userId]);
  assert.deepEqual(new Set(await f("minPrice=0")), new Set([P1.userId, P3.userId]), "a trainer with no packages matches no price filter");
  assert.ok(!(await f("maxPrice=999999999")).includes(P2.userId), "…not even an open-ended one");
  // session mode: only packages of that mode count
  assert.deepEqual(await f("minPrice=150000&maxPrice=220000&sessionMode=OFFLINE"), [P1.userId]);
  assert.deepEqual(await f("minPrice=150000&maxPrice=220000&sessionMode=ONLINE"), [], "P1 has no ONLINE package");
  assert.deepEqual(await f("minPrice=400000&maxPrice=600000&sessionMode=ONLINE"), [P3.userId]);
  assert.deepEqual(await f("minPrice=400000&maxPrice=600000&sessionMode=OFFLINE"), []);

  // sorting is by the derived per-session price; a trainer with nothing for sale sinks either way
  assert.deepEqual(await f("sortBy=priceAsc"), [P1.userId, P3.userId, P2.userId]);
  assert.deepEqual(await f("sortBy=priceDesc"), [P3.userId, P1.userId, P2.userId]);
});

// ── 4. physique photos: PUBLISHED only ───────────────────────────────────────────────────────

test("physiquePhotos: only PUBLISHED rows are exposed, in sort order, with the cover url; STAGED / RETIRED / DISCARDED never appear", async () => {
  const pt = await makePublicPt();
  created.push(pt.userId);
  const mk = (over: Record<string, unknown>) =>
    prisma.ptPhysiquePhoto.create({
      data: { ptUserId: pt.userId, storageKey: `pt-physique/${pt.userId}/${randomUUID()}.jpg`, mime: "image/jpeg", bytes: 1000, uploadedBy: pt.userId, ...over } as any,
    });
  const second = await mk({ status: "PUBLISHED", sortOrder: 1 });
  const cover = await mk({ status: "PUBLISHED", sortOrder: 0, isCover: true });
  const staged = await mk({ status: "STAGED", sortOrder: 2 });
  const retired = await mk({ status: "RETIRED", sortOrder: 3, retiredAt: new Date() });
  const discarded = await mk({ status: "DISCARDED", sortOrder: 4 });

  const tok = viewer();
  const d = await app.call("GET", `/profile/pts/${pt.userId}`, tok);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.physiquePhotos.map((p: any) => p.id), [cover.id, second.id]);
  assert.deepEqual(d.body.physiquePhotos.map((p: any) => p.isCover), [true, false]);
  assert.equal(d.body.coverPhotoUrl, `/media/pt-physique/${cover.id}`);
  assert.deepEqual(Object.keys(d.body.physiquePhotos[0]).sort(), ["id", "isCover", "sortOrder", "url"]);
  const text = JSON.stringify(d.body);
  for (const hidden of [staged, retired, discarded]) assert.ok(!text.includes(hidden.id), "non-published photo id leaked");
  assert.ok(!text.includes("storageKey") && !text.includes("pt-physique/" + pt.userId), "storage keys are never exposed");

  const list = await app.call("GET", `/profile/pts?q=${pt.marker}`, tok);
  assert.equal(list.body.pts[0].physiquePhotos.length, 2);
});

// ── 5. photoUrl is a storage reference, not free text ────────────────────────────────────────

test("PUT /profile/me photoUrl: another user's s3 ref -> 400; own ref, an unchanged value and \"\" are accepted; arbitrary URLs and unsafe keys -> 400", async () => {
  const u1 = randomUUID();
  const u2 = randomUUID();
  others.push(u1, u2);
  await prisma.userProfile.create({ data: { userId: u1 } });
  const tok = tokenFor(u1, "CUSTOMER");
  const put = (photoUrl: unknown) => app.call("PUT", "/profile/me", tok, { photoUrl });
  const stored = async () => (await prisma.userProfile.findUniqueOrThrow({ where: { userId: u1 } })).photoUrl;

  let r = await put(`s3://profile-photos/${u2}/stolen.jpg`);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "PHOTO_URL_NOT_OWNED");
  assert.equal(await stored(), null, "nothing was written");

  for (const bad of ["http://evil.example/x.png", "/uploads/profile-photos/someone-else.jpg", `s3://profile-photos/${u1}/../${u2}/x.jpg`, `s3://other-prefix/${u1}/x.jpg`, `s3://profile-photos/${u1}x/x.jpg`]) {
    r = await put(bad);
    assert.equal(r.status, 400, `${bad} must be refused (got ${r.status} ${JSON.stringify(r.body)})`);
  }
  assert.equal(await stored(), null);

  const own = `s3://profile-photos/${u1}/mine.jpg`;
  r = await put(own);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await stored(), own);
  assert.match(r.body.profile.photoUrl, /^https:\/\//, "the response carries a signed url, the DB keeps the ref");

  r = await put(own); // unchanged re-save
  assert.equal(r.status, 200);
  r = await put(`s3://profile-photos/${u2}/stolen.jpg`);
  assert.equal(r.status, 400, "still refused after the user has a photo");
  assert.equal(await stored(), own);

  // a legacy (non-s3) value that is ALREADY stored may be re-saved unchanged, but not swapped for another
  await prisma.userProfile.update({ where: { userId: u1 }, data: { photoUrl: "/uploads/profile-photos/legacy.jpg" } });
  assert.equal((await put("/uploads/profile-photos/legacy.jpg")).status, 200);
  assert.equal((await put("/uploads/profile-photos/other.jpg")).status, 400);
  assert.equal(await stored(), "/uploads/profile-photos/legacy.jpg");

  r = await put("");
  assert.equal(r.status, 200, "an empty string clears the photo");
  // and a PUT that does not mention photoUrl is unaffected by the check
  r = await app.call("PUT", "/profile/me", tok, { heightCm: 170 });
  assert.equal(r.status, 200);
});
