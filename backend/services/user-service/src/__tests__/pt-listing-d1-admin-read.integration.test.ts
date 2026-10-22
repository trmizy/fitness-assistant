/**
 * Listing Management D1 follow-up - GET /admin/listings/pts/:ptUserId (the current published listing of a trainer,
 * with or without any revision).
 *
 * Evidence label: BACKEND INTEGRATION - the real user-service Express app against an isolated `*_test` database;
 * auth-service (token -> identity table) and object storage (in-memory adapter) are TEST FIXTURES.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/pt-listing-d1-admin-read.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { setPtMediaStorage } from "../services/pt-media-s3.service";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";
import { PRIVATE_MARKERS, cleanupListingPts, makePublicPt } from "./pt-listing.test-helpers";
import { InMemoryPtMediaStorage, makePackage, seedPhoto, startRawServer, stubSideEffects } from "./pt-listing-c2.test-helpers";

let app: App;
let raw: { base: string; close: () => Promise<void> };
const storage = new InMemoryPtMediaStorage();
const effects = stubSideEffects();
let restoreStorage: () => void;
const pts: string[] = [];
const others: string[] = [];
const ADMIN = `admin-${randomUUID()}`;
const adminTok = () => tokenFor(ADMIN, "ADMIN");

test.before(async () => {
  restoreStorage = setPtMediaStorage(storage);
  app = await startApp();
  raw = await startRawServer();
});
test.after(async () => {
  await raw.close();
  await app.close();
  restoreStorage();
  effects.restore();
  await cleanupListingPts(pts, [], others);
  await prisma.userProfile.deleteMany({ where: { userId: { in: others } } }).catch(() => {});
});

async function newPt(opts: Parameters<typeof makePublicPt>[0] = {}) {
  const pt = await makePublicPt(opts);
  pts.push(pt.userId);
  return pt;
}
const read = (ptUserId: string, tok: string | null = adminTok()) => app.call("GET", `/admin/listings/pts/${ptUserId}`, tok);

test("admin 200: shape, ALL non-archived packages (inactive included), PUBLISHED photos only, no revision needed", async () => {
  const pt = await newPt();
  const active = await makePackage(pt.userId, { name: "Gói đang bán", price: 2_000_000, sessionCount: 10 });
  const inactive = await makePackage(pt.userId, { name: "Gói tạm ngưng", isActive: false, price: 900_000, sessionCount: 3 });
  const archived = await makePackage(pt.userId, { name: "Gói đã lưu trữ", archivedAt: new Date() });
  const p1 = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  const p2 = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 1 });
  await seedPhoto(storage, pt.userId, "STAGED");
  await seedPhoto(storage, pt.userId, "RETIRED", { retiredAt: new Date() });
  assert.equal(await prisma.ptListingRevision.count({ where: { ptUserId: pt.userId } }), 0, "the fixture has no revision");

  const r = await read(pt.userId);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rawRes = await fetch(raw.base + `/admin/listings/pts/${pt.userId}`, { headers: { authorization: `Bearer ${adminTok()}` } });
  assert.equal(rawRes.status, 200);
  assert.equal(rawRes.headers.get("cache-control"), "no-store, private");
  assert.deepEqual(Object.keys(r.body).sort(), ["openRevision", "photos", "pt", "published"]);
  assert.deepEqual(Object.keys(r.body.pt).sort(), ["firstName", "lastName", "listingPublishedAt", "listingVersion", "userId"]);
  assert.equal(r.body.pt.userId, pt.userId);
  assert.equal(r.body.pt.listingVersion, 1);
  assert.deepEqual(Object.keys(r.body.published).sort(), ["coverPhotoId", "packages", "photoIds", "profile"]);
  assert.equal(r.body.published.profile.professionalBio, "Huấn luyện viên sức mạnh");
  assert.deepEqual(r.body.published.profile.languages, ["vi", "en"]);
  const names = r.body.published.packages.map((p: any) => p.name).sort();
  assert.deepEqual(names, ["Gói tạm ngưng", "Gói đang bán"].sort());
  assert.ok(!names.includes("Gói đã lưu trữ"));
  const inactiveRow = r.body.published.packages.find((p: any) => p.id === inactive.id);
  assert.equal(inactiveRow.isActive, false);
  assert.ok(r.body.published.packages.some((p: any) => p.id === active.id));
  assert.ok(archived.id);
  assert.deepEqual(r.body.published.photoIds, [p1.id, p2.id]);
  assert.equal(r.body.published.coverPhotoId, p1.id);
  assert.deepEqual(r.body.photos.map((p: any) => p.id), [p1.id, p2.id]);
  assert.ok(r.body.photos.every((p: any) => p.status === "PUBLISHED" && String(p.url).startsWith("/media/pt-physique/")));
  assert.equal(r.body.openRevision, null);
});

test("openRevision: the open DRAFT is reported as {id, status}", async () => {
  const pt = await newPt();
  const created = await app.call("POST", "/profile/me/listing/draft", tokenFor(pt.userId, "PT"), {});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const r = await read(pt.userId);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.openRevision, { id: created.body.revision.id, status: "DRAFT" });
});

test("no PII: names only - none of the private markers, email, phone, national id, admin notes", async () => {
  const pt = await newPt();
  await makePackage(pt.userId);
  const r = await read(pt.userId);
  assert.equal(r.status, 200);
  const body = JSON.stringify(r.body);
  for (const value of Object.values(PRIVATE_MARKERS)) assert.ok(!body.includes(String(value)), `private marker leaked: ${value}`);
  for (const banned of ["email", "private-mail", "phoneNumber", "nationalId", "adminNote", "rejectionReason", "referralCode", "dateOfBirth", "injuries", "storageKey", "contentHash", "ipAddress", "userAgent"]) {
    assert.ok(!body.includes(banned), `"${banned}" leaked`);
  }
});

test("authorization: non-admin (PT itself, customer) -> 403, anonymous -> 401", async () => {
  const pt = await newPt();
  const customer = randomUUID();
  await prisma.userProfile.create({ data: { userId: customer, isPT: false } });
  others.push(customer);
  assert.equal((await read(pt.userId, tokenFor(pt.userId, "PT"))).status, 403);
  assert.equal((await read(pt.userId, tokenFor(customer, "CUSTOMER"))).status, 403);
  assert.equal((await read(pt.userId, null)).status, 401);
});

test("eligibility: unknown id, not a PT, no application, application not APPROVED -> 404 PT_NOT_FOUND (one answer, nothing to probe)", async () => {
  const notPt = await newPt({ isPT: false });
  const noApp = await newPt({ application: "NONE" });
  const submitted = await newPt({ application: "SUBMITTED" });
  for (const id of [randomUUID(), notPt.userId, noApp.userId, submitted.userId]) {
    const r = await read(id);
    assert.equal(r.status, 404, `${id} -> ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error.code, "PT_NOT_FOUND");
  }
});

test("the version it returns is the one a direct edit must quote: a wrong one is 409 LISTING_STALE, nothing changes", async () => {
  const pt = await newPt();
  const p1 = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  const p2 = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 1 });
  const d = (await read(pt.userId)).body;
  const stale = await app.call("POST", `/admin/listings/pts/${pt.userId}/direct-edit`, adminTok(), {
    photoIds: [p2.id, p1.id],
    reason: "Sắp xếp lại ảnh theo yêu cầu",
    expectedListingVersion: d.pt.listingVersion + 5,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "LISTING_STALE");
  assert.equal(stale.body.listingVersion, d.pt.listingVersion, "the 409 itself quotes the same version this endpoint returns");
  assert.deepEqual((await read(pt.userId)).body.published.photoIds, [p1.id, p2.id]);
});
