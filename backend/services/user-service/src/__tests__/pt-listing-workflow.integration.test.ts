/**
 * PT listing management, phase C2 - the revision WORKFLOW (state machine, apply-on-approve, admin actions,
 * swap/authorization, cache headers, preview isolation, the public media route).
 *
 * Evidence label: BACKEND INTEGRATION - the real user-service Express app on a random port against an isolated
 * `*_test` database; auth-service is not running (token -> identity table = TEST FIXTURE); object storage is the
 * in-memory adapter behind the storage port (TEST FIXTURE); the notification push and the admin broadcast are stubbed
 * (the notification ROWS are real).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/pt-listing-workflow.integration.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { setPtMediaStorage } from "../services/pt-media-s3.service";
import { makeContract } from "./pt-restriction.test-helpers";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";
import { cleanupListingPts } from "./pt-listing.test-helpers";
import { InMemoryPtMediaStorage, makeApprovedPt, makePackage, seedPhoto, startRawServer, stubSideEffects } from "./pt-listing-c2.test-helpers";

let app: App;
let raw: { base: string; close: () => Promise<void> };
const storage = new InMemoryPtMediaStorage();
const effects = stubSideEffects();
let restoreStorage: () => void;
const pts: string[] = [];
const others: string[] = [];
const contracts: string[] = [];
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
  await cleanupListingPts(pts, contracts, others);
  await prisma.userProfile.deleteMany({ where: { userId: { in: others } } }).catch(() => {});
});

async function newPt(marker?: string) {
  const pt = await makeApprovedPt(marker);
  pts.push(pt.userId);
  return { ...pt, tok: tokenFor(pt.userId, "PT") };
}
async function newCustomer() {
  const userId = randomUUID();
  await prisma.userProfile.create({ data: { userId, isPT: false } });
  others.push(userId);
  return { userId, tok: tokenFor(userId, "CUSTOMER") };
}
const listing = async (pt: { tok: string }) => (await app.call("GET", "/profile/me/listing", pt.tok)).body;
const createDraft = async (pt: { tok: string }, body: unknown = {}) => app.call("POST", "/profile/me/listing/draft", pt.tok, body);

/** draft -> edit (bio) -> returns the saved revision (still DRAFT). */
async function draftWith(pt: { tok: string }, edit: (payload: any, state: any) => void) {
  const created = await createDraft(pt);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const state = await listing(pt);
  const payload = JSON.parse(JSON.stringify(state.openRevision.payload));
  edit(payload, state);
  const saved = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: state.openRevision.draftVersion, payload });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return saved.body.revision;
}
async function submit(pt: { tok: string }, rev: { draftVersion: number }) {
  return app.call("POST", "/profile/me/listing/submit", pt.tok, { expectedDraftVersion: rev.draftVersion });
}
const approve = (rid: string, note?: string) => app.call("POST", `/admin/listings/pts/revisions/${rid}/approve`, adminTok(), note ? { note } : {});
const dbRev = (id: string) => prisma.ptListingRevision.findUniqueOrThrow({ where: { id } });
const profileOf = (userId: string) => prisma.userProfile.findUniqueOrThrow({ where: { userId } });

// ── 1. authorization ──────────────────────────────────────────────────────────────────────────

test("authorization: CUSTOMER -> 403 on every PT listing route, anonymous -> 401, PT-only identity comes from the token", async () => {
  const customer = await newCustomer();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/profile/me/listing"],
    ["POST", "/profile/me/listing/draft", {}],
    ["PUT", "/profile/me/listing/draft", { expectedDraftVersion: 1, payload: {} }],
    ["POST", "/profile/me/listing/submit", { expectedDraftVersion: 1 }],
    ["POST", "/profile/me/listing/withdraw", {}],
    ["POST", "/profile/me/listing/discard", {}],
    ["POST", "/profile/me/listing/rebase", {}],
    ["GET", "/profile/me/listing/preview"],
    ["POST", "/profile/me/listing/physique/presign", { contentType: "image/png" }],
    ["POST", "/profile/me/listing/physique/confirm", { uploadId: randomUUID() }],
    ["DELETE", `/profile/me/listing/physique/${randomUUID()}`],
  ];
  for (const [m, p, b] of routes) {
    const res = await app.call(m, p, customer.tok, b);
    assert.equal(res.status, 403, `${m} ${p} as CUSTOMER -> ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, "NOT_A_PT");
    assert.equal((await app.call(m, p, null, b)).status, 401, `${m} ${p} anonymous`);
  }
  // a PT whose application is not approved has no listing yet
  const unapproved = await makeApprovedPt();
  pts.push(unapproved.userId);
  await prisma.pTApplication.updateMany({ where: { userProfileId: unapproved.profileId }, data: { status: "SUBMITTED" } });
  const r = await app.call("GET", "/profile/me/listing", tokenFor(unapproved.userId, "PT"));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "PT_NOT_APPROVED");
});

test("authorization: non-admin -> 403 on every /admin/listings/pts route, anonymous -> 401", async () => {
  const pt = await newPt();
  const customer = await newCustomer();
  const rid = randomUUID();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/admin/listings/pts"],
    ["GET", `/admin/listings/pts/revisions/${rid}`],
    ["GET", `/admin/listings/pts/revisions/${rid}/preview`],
    ["POST", `/admin/listings/pts/revisions/${rid}/approve`, {}],
    ["POST", `/admin/listings/pts/revisions/${rid}/reject`, { note: "x" }],
    ["POST", `/admin/listings/pts/revisions/${rid}/request-changes`, { note: "x" }],
    ["POST", `/admin/listings/pts/${pt.userId}/direct-edit`, { reason: "0123456789", expectedListingVersion: 1 }],
    ["POST", `/admin/listings/pts/${pt.userId}/physique/${randomUUID()}/retire`, { reason: "0123456789" }],
    ["GET", `/admin/listings/pts/${pt.userId}/history`],
  ];
  for (const tok of [pt.tok, customer.tok, tokenFor(randomUUID(), "GYM_OWNER")]) {
    for (const [m, p, b] of routes) {
      assert.equal((await app.call(m, p, tok, b)).status, 403, `${m} ${p}`);
    }
  }
  for (const [m, p, b] of routes) assert.equal((await app.call(m, p, null, b)).status, 401, `${m} ${p} anonymous`);
  // there is no admin upload route for physique photos
  assert.equal((await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/presign`, adminTok(), { contentType: "image/png" })).status, 404);
  assert.equal((await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/confirm`, adminTok(), {})).status, 404);
});

// ── 2. the owner state machine ────────────────────────────────────────────────────────────────

test("state machine: draft -> save (optimistic) -> submit -> PENDING locks edits; DRAFT_STALE, NO_CHANGES, REVISION_UNDER_REVIEW", async () => {
  const pt = await newPt();
  const before = await listing(pt);
  assert.equal(before.listingVersion, 1);
  assert.equal(before.openRevision, null);
  assert.equal(before.published.payload.profile.professionalBio, "Huấn luyện viên sức mạnh");

  const created = await createDraft(pt);
  assert.equal(created.status, 201);
  assert.equal(created.body.revision.status, "DRAFT");
  assert.equal(created.body.revision.baseVersion, 1);
  assert.equal(created.body.revision.draftVersion, 1);
  assert.deepEqual(created.body.revision.payload, before.published.payload, "a first draft is a copy of the published listing");
  assert.equal(created.body.revision.stale, false);

  // a second draft: refused, with the open one in the body
  const again = await createDraft(pt);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "OPEN_REVISION_EXISTS");
  assert.equal(again.body.revision.id, created.body.revision.id);

  // submit without changes
  const noChange = await submit(pt, { draftVersion: 1 });
  assert.equal(noChange.status, 422);
  assert.equal(noChange.body.error.code, "NO_CHANGES");

  // save with the right version, then with the stale one
  const payload = JSON.parse(JSON.stringify(created.body.revision.payload));
  payload.profile.professionalBio = "Bản mới của huấn luyện viên";
  const saved = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 1, payload });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision.draftVersion, 2);
  const stale = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 1, payload });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "DRAFT_STALE");
  assert.equal(stale.body.revision.draftVersion, 2, "the 409 carries the current draft so the client can reload");
  assert.equal(stale.body.revision.payload.profile.professionalBio, "Bản mới của huấn luyện viên");

  // unknown keys are a 400 (strict schemas)
  const withExtra = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 2, payload: { ...payload, evil: 1 } });
  assert.equal(withExtra.status, 400);
  const extraInProfile = await app.call("PUT", "/profile/me/listing/draft", pt.tok, {
    expectedDraftVersion: 2,
    payload: { ...payload, profile: { ...payload.profile, nationalIdNumber: "x" } },
  });
  assert.equal(extraInProfile.status, 400);
  const extraTop = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 2, payload, listingVersion: 99 });
  assert.equal(extraTop.status, 400);
  assert.equal((await dbRev(created.body.revision.id)).draftVersion, 2, "rejected writes changed nothing");

  // submit with a stale draft version
  assert.equal((await submit(pt, { draftVersion: 1 })).body.error.code, "DRAFT_STALE");

  const ok = await submit(pt, { draftVersion: 2 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.revision.status, "PENDING");
  assert.ok(ok.body.revision.submittedAt);
  assert.equal(effects.adminBroadcasts.some((b) => b.ptUserId === pt.userId), true, "admins are told in real time");

  // PENDING: no edit, no second submit, no discard, no rebase
  const locked = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 2, payload });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, "REVISION_UNDER_REVIEW");
  assert.equal((await submit(pt, { draftVersion: 2 })).body.error.code, "REVISION_UNDER_REVIEW");
  assert.equal((await app.call("POST", "/profile/me/listing/discard", pt.tok, {})).body.error.code, "REVISION_UNDER_REVIEW");
  assert.equal((await app.call("POST", "/profile/me/listing/rebase", pt.tok, {})).body.error.code, "REVISION_UNDER_REVIEW");
  assert.equal((await createDraft(pt)).body.error.code, "OPEN_REVISION_EXISTS");
  // the public listing is untouched while it waits
  assert.equal((await listing(pt)).published.payload.profile.professionalBio, "Huấn luyện viên sức mạnh");
});

test("state machine: double submit (Promise.all) -> exactly one winner", async () => {
  const pt = await newPt();
  const rev = await draftWith(pt, (p) => (p.profile.professionalBio = "x".repeat(30)));
  const [a, b] = await Promise.all([submit(pt, rev), submit(pt, rev)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], `got ${a.status}/${b.status}`);
  assert.equal((await prisma.ptListingRevision.count({ where: { ptUserId: pt.userId, status: "PENDING" } })), 1);
});

test("state machine: withdraw = WITHDRAWN + a new DRAFT copy with parent; discard = DRAFT -> WITHDRAWN; withdraw on a DRAFT is refused", async () => {
  const pt = await newPt();
  const rev = await draftWith(pt, (p) => (p.profile.languages = ["vi", "en", "fr"]));
  assert.equal((await app.call("POST", "/profile/me/listing/withdraw", pt.tok, {})).body.error.code, "REVISION_NOT_PENDING");
  assert.equal((await submit(pt, rev)).status, 200);

  const w = await app.call("POST", "/profile/me/listing/withdraw", pt.tok, {});
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.withdrawnRevisionId, rev.id);
  assert.equal(w.body.revision.status, "DRAFT");
  assert.equal(w.body.revision.parentRevisionId, rev.id);
  assert.deepEqual(w.body.revision.payload.profile.languages, ["vi", "en", "fr"], "the work is kept");
  assert.equal((await dbRev(rev.id)).status, "WITHDRAWN");
  assert.equal((await dbRev(rev.id)).submittedAt !== null, true, "the earlier submission stays in the history");

  // discard the new draft: closed, and a fresh draft can start
  const d = await app.call("POST", "/profile/me/listing/discard", pt.tok, {});
  assert.equal(d.status, 200);
  assert.equal((await dbRev(w.body.revision.id)).status, "WITHDRAWN");
  assert.equal((await dbRev(w.body.revision.id)).submittedAt, null, "a discarded draft was never submitted");
  assert.equal((await createDraft(pt)).status, 201);
  const hist = (await listing(pt)).history;
  assert.equal(hist.filter((h: any) => h.status === "WITHDRAWN").length, 2);
});

// ── 3. admin decisions + apply ────────────────────────────────────────────────────────────────

test("approve: public columns written, specialties synced, version + published_at bumped, snapshot + audit + notice; closed row immutable; double approve -> 1 winner", async () => {
  const pt = await newPt();
  const rev = await draftWith(pt, (p) => {
    p.profile.professionalBio = "Giới thiệu mới sau khi duyệt";
    p.profile.mainSpecialties = ["YOGA", "MOBILITY"];
    p.profile.trainingMethodsApproach = "Cá nhân hóa";
    p.profile.targetClientGroups = ["SENIOR"];
    p.profile.primaryTrainingGoals = ["FLEXIBILITY"];
    p.profile.languages = ["vi", "ja"];
    p.profile.websiteUrl = "https://new.example/site";
    p.profile.linkedinUrl = null;
  });
  assert.equal((await submit(pt, rev)).status, 200);

  const appBefore = await prisma.pTApplication.findUniqueOrThrow({ where: { id: pt.applicationId! } });
  const [a, b] = await Promise.all([approve(rev.id, "ok"), approve(rev.id, "ok")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}: ${JSON.stringify([a.body, b.body])}`);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, "ALREADY_DECIDED");

  const appAfter = await prisma.pTApplication.findUniqueOrThrow({ where: { id: pt.applicationId! } });
  assert.equal(appAfter.professionalBio, "Giới thiệu mới sau khi duyệt");
  assert.deepEqual(appAfter.mainSpecialties, ["YOGA", "MOBILITY"]);
  assert.equal(appAfter.trainingMethodsApproach, "Cá nhân hóa");
  assert.deepEqual(appAfter.targetClientGroups, ["SENIOR"]);
  assert.deepEqual(appAfter.languages, ["vi", "ja"]);
  assert.equal(appAfter.websiteUrl, "https://new.example/site");
  assert.equal(appAfter.linkedinUrl, null);
  // nothing outside the allowlist moved
  for (const k of ["phoneNumber", "nationalIdNumber", "adminNote", "status", "yearsOfExperience", "serviceMode", "onlinePricePerSession", "desiredSessionPrice"] as const) {
    assert.deepEqual((appAfter as any)[k], (appBefore as any)[k], `PTApplication.${k} untouched`);
  }
  const prof = await profileOf(pt.userId);
  assert.deepEqual(prof.specialties, ["YOGA", "MOBILITY"], "UserProfile.specialties = mainSpecialties");
  assert.equal(prof.listingVersion, 2, "exactly one apply happened");
  assert.ok(prof.listingPublishedAt);

  const closed = await dbRev(rev.id);
  assert.equal(closed.status, "APPROVED");
  assert.equal(closed.reviewedBy, ADMIN);
  assert.equal((closed.previousSnapshot as any).listingVersion, 1);
  assert.equal((closed.previousSnapshot as any).payload.profile.professionalBio, "Huấn luyện viên sức mạnh");

  const audit = await prisma.auditLog.findMany({ where: { entityType: "PT_LISTING", entityId: pt.userId, action: "PT_LISTING_APPROVED" } });
  assert.equal(audit.length, 1);
  assert.ok((audit[0].metadata as any).changes.some((c: any) => c.path === "profile.professionalBio"));
  assert.equal((audit[0].metadata as any).toVersion, 2);
  const notes = await prisma.notification.findMany({ where: { userId: pt.userId, eventType: "PT_LISTING_APPROVED" } });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].entityType, "PT_LISTING");

  // history is immutable: a closed revision cannot be edited or deleted
  await assert.rejects(prisma.ptListingRevision.update({ where: { id: rev.id }, data: { payload: { x: 1 } } }), /immutable/);
  await assert.rejects(prisma.ptListingRevision.delete({ where: { id: rev.id } }), /cannot be deleted/);
  assert.equal((await approve(rev.id)).body.error.code, "ALREADY_DECIDED", "a later approve of a closed revision is a 409 too");

  // the public detail now shows the new content
  const viewer = tokenFor(randomUUID(), "CUSTOMER");
  const detail = await app.call("GET", `/profile/pts/${pt.userId}`, viewer);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.ptApplication.professionalBio, "Giới thiệu mới sau khi duyệt");
  assert.deepEqual(detail.body.specialties, ["YOGA", "MOBILITY"]);
});

test("reject / request-changes: note is required (400), public listing untouched, closed state, child DRAFT carries the note, notices", async () => {
  const pt = await newPt();
  const rev1 = await draftWith(pt, (p) => (p.profile.professionalBio = "bản bị từ chối"));
  assert.equal((await submit(pt, rev1)).status, 200);
  assert.equal((await app.call("POST", `/admin/listings/pts/revisions/${rev1.id}/reject`, adminTok(), {})).status, 400);
  assert.equal((await app.call("POST", `/admin/listings/pts/revisions/${rev1.id}/reject`, adminTok(), { note: "   " })).status, 400);
  assert.equal((await app.call("POST", `/admin/listings/pts/revisions/${rev1.id}/request-changes`, adminTok(), {})).status, 400);
  const rej = await app.call("POST", `/admin/listings/pts/revisions/${rev1.id}/reject`, adminTok(), { note: "Nội dung chưa phù hợp" });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal((await dbRev(rev1.id)).status, "REJECTED");
  assert.equal((await dbRev(rev1.id)).reviewNote, "Nội dung chưa phù hợp");
  assert.equal((await profileOf(pt.userId)).listingVersion, 1, "a rejection does not touch the public listing");
  assert.equal((await prisma.pTApplication.findUniqueOrThrow({ where: { id: pt.applicationId! } })).professionalBio, "Huấn luyện viên sức mạnh");
  assert.equal((await app.call("POST", `/admin/listings/pts/revisions/${rev1.id}/reject`, adminTok(), { note: "lần hai" })).status, 409);
  assert.equal(await prisma.notification.count({ where: { userId: pt.userId, eventType: "PT_LISTING_REJECTED" } }), 1);
  // no open revision left: the PT can start a new draft, copying the rejected one
  const copy = await createDraft(pt, { copyFromRevisionId: rev1.id });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.equal(copy.body.revision.parentRevisionId, rev1.id);
  assert.equal(copy.body.revision.payload.profile.professionalBio, "bản bị từ chối");
  await app.call("POST", "/profile/me/listing/discard", pt.tok, {});

  const rev2 = await draftWith(pt, (p) => (p.profile.professionalBio = "cần sửa thêm"));
  assert.equal((await submit(pt, rev2)).status, 200);
  const rc = await app.call("POST", `/admin/listings/pts/revisions/${rev2.id}/request-changes`, adminTok(), { note: "Bổ sung chứng chỉ" });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal((await dbRev(rev2.id)).status, "CHANGES_REQUESTED");
  const child = await dbRev(rc.body.draftRevisionId);
  assert.equal(child.status, "DRAFT");
  assert.equal(child.parentRevisionId, rev2.id);
  assert.equal(child.reviewNote, "Bổ sung chứng chỉ");
  assert.equal((child.payload as any).profile.professionalBio, "cần sửa thêm");
  const state = await listing(pt);
  assert.equal(state.openRevision.reviewNote, "Bổ sung chứng chỉ", "the owner sees the admin's note on the new draft");
  assert.equal(await prisma.notification.count({ where: { userId: pt.userId, eventType: "PT_LISTING_CHANGES_REQUESTED" } }), 1);
  assert.equal((await profileOf(pt.userId)).listingVersion, 1);
});

// ── 4. packages ───────────────────────────────────────────────────────────────────────────────

test("packages: create / update / archive on approve with the version rules; an unchanged package keeps its version; signed contracts keep their snapshot", async () => {
  const pt = await newPt();
  const A = await makePackage(pt.userId, { name: "Gói 10 buổi", price: 2_000_000, sessionCount: 10 });
  const B = await makePackage(pt.userId, { name: "Gói 5 buổi", price: 1_250_000, sessionCount: 5 });
  const C = await makePackage(pt.userId, { name: "Gói không đổi", price: 500_000, sessionCount: 2 });
  const contract = await makeContract(pt.userId, { packageId: A.id, packageName: A.name, price: 2_000_000, totalSessions: 10 });
  contracts.push(contract.id);
  const contractBefore = JSON.stringify(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } }));

  const rev = await draftWith(pt, (p) => {
    const a = p.packages.find((x: any) => x.id === A.id);
    a.price = 2_500_000; // price rise
    p.packages = p.packages.filter((x: any) => x.id !== B.id); // B dropped -> archived
    p.packages.push({ name: "Gói mới", description: "mô tả", price: 900_000, sessionCount: 3, sessionMode: "ONLINE", sessionDurationMinutes: 45, validityDays: 30, isActive: false });
  });
  assert.equal((await submit(pt, rev)).status, 200);
  assert.equal((await approve(rev.id)).status, 200);

  const a = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: A.id } });
  assert.equal(Number(a.price), 2_500_000);
  assert.equal(a.version, 2, "a price change bumps the version");
  const b = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: B.id } });
  assert.ok(b.archivedAt, "dropped from the revision -> archived");
  assert.equal(b.isActive, false);
  assert.equal(b.version, 2, "archiving bumps the version");
  const c = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: C.id } });
  assert.equal(c.version, 1, "an unchanged package keeps version 1 (no false PACKAGE_CHANGED)");
  assert.equal(c.archivedAt, null);
  const created = await prisma.pTServicePackage.findFirstOrThrow({ where: { ptUserId: pt.userId, name: "Gói mới" } });
  assert.equal(created.version, 1);
  assert.equal(created.isActive, false, "the payload's isActive is honoured on create");
  assert.equal(created.sessionMode, "ONLINE");
  assert.equal(created.sessionDurationMinutes, 45);

  assert.equal(JSON.stringify(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })), contractBefore, "the signed contract is byte-for-byte unchanged");

  // a later approval that touches only the bio leaves every package version alone
  const rev2 = await draftWith(pt, (p) => (p.profile.professionalBio = "Chỉ đổi giới thiệu"));
  assert.equal((await submit(pt, rev2)).status, 200);
  assert.equal((await approve(rev2.id)).status, 200);
  const versions = (await prisma.pTServicePackage.findMany({ where: { ptUserId: pt.userId }, orderBy: { name: "asc" } })).map((p) => [p.name, p.version]);
  assert.deepEqual(versions, [["Gói 10 buổi", 2], ["Gói 5 buổi", 2], ["Gói không đổi", 1], ["Gói mới", 1]]);
  assert.equal((await profileOf(pt.userId)).listingVersion, 3);

  // limits: > 10 packages that stay -> PACKAGE_LIMIT on save
  const many = await createDraft(pt);
  assert.equal(many.status, 201);
  const state = await listing(pt);
  const payload = JSON.parse(JSON.stringify(state.openRevision.payload));
  for (let i = 0; i < 9; i++) {
    payload.packages.push({ name: `Gói ${i}`, price: 100000 + i, sessionCount: 1, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true });
  }
  const tooMany = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 1, payload });
  assert.equal(tooMany.status, 422);
  assert.equal(tooMany.body.error.code, "PACKAGE_LIMIT");
  // invalid package fields are 400
  const bad = JSON.parse(JSON.stringify(state.openRevision.payload));
  bad.packages[0].price = 0;
  assert.equal((await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 1, payload: bad })).status, 400);
  bad.packages[0].price = 100;
  bad.packages[0].sessionMode = "HYBRID";
  assert.equal((await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: 1, payload: bad })).status, 400);
});

// ── 5. photos ─────────────────────────────────────────────────────────────────────────────────

test("photos: 0..5 are accepted, the 6th is PHOTO_LIMIT on draft save AND on submit; order is deterministic; exactly one cover; unlisted public photos are RETIRED", async () => {
  const pt = await newPt();
  const photos = [] as Awaited<ReturnType<typeof seedPhoto>>[];
  for (let i = 0; i < 6; i++) photos.push(await seedPhoto(storage, pt.userId, "STAGED"));

  await createDraft(pt);
  let version = 1;
  for (let n = 0; n <= 5; n++) {
    const state = await listing(pt);
    const payload = JSON.parse(JSON.stringify(state.openRevision.payload));
    payload.photoIds = photos.slice(0, n).map((p) => p.id);
    payload.coverPhotoId = null;
    const res = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: state.openRevision.draftVersion, payload });
    assert.equal(res.status, 200, `${n} photos: ${JSON.stringify(res.body)}`);
    version = res.body.revision.draftVersion;
    assert.equal(res.body.revision.payload.coverPhotoId, n === 0 ? null : photos[0].id, "cover defaults to the first photo, null with none");
  }
  const state6 = await listing(pt);
  const six = JSON.parse(JSON.stringify(state6.openRevision.payload));
  six.photoIds = photos.map((p) => p.id);
  const over = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: version, payload: six });
  assert.equal(over.status, 422);
  assert.equal(over.body.error.code, "PHOTO_LIMIT");
  assert.equal((await dbRev(state6.openRevision.id)).draftVersion, version, "the over-limit save changed nothing");

  // the limit is checked again at submit (a draft that somehow holds 6 photos - written straight to the table)
  await prisma.$executeRaw`UPDATE pt_listing_revisions SET payload = jsonb_set(payload, '{photoIds}', ${JSON.stringify(photos.map((p) => p.id))}::jsonb) WHERE id = ${state6.openRevision.id}`;
  const overSubmit = await submit(pt, { draftVersion: version });
  assert.equal(overSubmit.status, 422);
  assert.equal(overSubmit.body.error.code, "PHOTO_LIMIT");
  assert.equal((await dbRev(state6.openRevision.id)).status, "DRAFT");

  // reorder + cover, then approve
  const [p0, p1, p2, p3] = photos;
  const ordered = [p2.id, p0.id, p1.id];
  const ok = JSON.parse(JSON.stringify(state6.openRevision.payload));
  ok.photoIds = ordered;
  ok.coverPhotoId = p1.id;
  const saved = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: version, payload: ok });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await submit(pt, saved.body.revision)).status, 200);
  assert.equal((await approve(saved.body.revision.id)).status, 200);

  const pub = await prisma.ptPhysiquePhoto.findMany({ where: { ptUserId: pt.userId, status: "PUBLISHED" }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(pub.map((p) => [p.id, p.sortOrder]), [[p2.id, 0], [p0.id, 1], [p1.id, 2]], "sort_order 0..n-1 in payload order");
  assert.deepEqual(pub.filter((p) => p.isCover).map((p) => p.id), [p1.id], "exactly one cover");
  const rest = await prisma.ptPhysiquePhoto.findMany({ where: { id: { in: [p3.id, photos[4].id, photos[5].id] } } });
  assert.ok(rest.every((p) => p.status === "STAGED"), "STAGED photos outside the payload stay STAGED");

  // public detail: stable order, stable URLs, cover url
  const viewer = tokenFor(randomUUID(), "CUSTOMER");
  const detail = await app.call("GET", `/profile/pts/${pt.userId}`, viewer);
  assert.deepEqual(detail.body.physiquePhotos.map((p: any) => p.id), ordered);
  assert.equal(detail.body.coverPhotoUrl, `/media/pt-physique/${p1.id}`);

  // next revision: new order, new cover, one photo dropped -> RETIRED
  await createDraft(pt);
  const st = await listing(pt);
  const next = JSON.parse(JSON.stringify(st.openRevision.payload));
  next.photoIds = [p0.id, p3.id];
  next.coverPhotoId = p3.id;
  const sv = await app.call("PUT", "/profile/me/listing/draft", pt.tok, { expectedDraftVersion: st.openRevision.draftVersion, payload: next });
  assert.equal((await submit(pt, sv.body.revision)).status, 200);
  assert.equal((await approve(sv.body.revision.id)).status, 200);
  const rows = await prisma.ptPhysiquePhoto.findMany({ where: { ptUserId: pt.userId, id: { in: [p0.id, p1.id, p2.id, p3.id] } } });
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get(p0.id)!.status, "PUBLISHED");
  assert.equal(by.get(p0.id)!.sortOrder, 0);
  assert.equal(by.get(p3.id)!.status, "PUBLISHED");
  assert.equal(by.get(p3.id)!.sortOrder, 1);
  assert.equal(by.get(p3.id)!.isCover, true);
  assert.equal(by.get(p0.id)!.isCover, false, "the old cover flag was cleared before the new one was set");
  for (const gone of [p1, p2]) {
    assert.equal(by.get(gone.id)!.status, "RETIRED");
    assert.ok(by.get(gone.id)!.retiredAt);
    assert.equal(by.get(gone.id)!.isCover, false);
  }
  assert.equal(await prisma.ptPhysiquePhoto.count({ where: { ptUserId: pt.userId, status: "PUBLISHED", isCover: true } }), 1);
  // a retired photo is no longer served
  assert.equal((await rawGet(`/media/pt-physique/${p1.id}`, null, { redirect: "manual" })).status, 404);
});

// ── 6. swap tests ─────────────────────────────────────────────────────────────────────────────

test("swap: PT A cannot use PT B's photo / package / revision; nothing of B changes", async () => {
  const A = await newPt();
  const B = await newPt();
  const bPhoto = await seedPhoto(storage, B.userId, "STAGED");
  const bPublished = await seedPhoto(storage, B.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  const bPkg = await makePackage(B.userId, { name: "Gói của B" });
  const bRev = await draftWith(B, (p) => (p.profile.professionalBio = "bản nháp của B"));
  assert.equal((await submit(B, bRev)).status, 200);
  const bRevAfterSubmit = JSON.stringify(await dbRev(bRev.id));
  await app.call("POST", `/admin/listings/pts/revisions/${bRev.id}/reject`, adminTok(), { note: "đóng để thử chép" });

  const aState = await (async () => {
    await createDraft(A);
    return listing(A);
  })();
  const base = () => JSON.parse(JSON.stringify(aState.openRevision.payload));
  const put = (payload: unknown) => app.call("PUT", "/profile/me/listing/draft", A.tok, { expectedDraftVersion: 1, payload });

  const withPhoto = base();
  withPhoto.photoIds = [bPhoto.id];
  let res = await put(withPhoto);
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, "PHOTO_NOT_OWNED");
  withPhoto.photoIds = [bPublished.id];
  assert.equal((await put(withPhoto)).body.error.code, "PHOTO_NOT_OWNED");
  withPhoto.photoIds = [randomUUID()];
  assert.equal((await put(withPhoto)).body.error.code, "PHOTO_NOT_OWNED", "a foreign and a non-existent id answer the same way");

  const withPkg = base();
  withPkg.packages.push({ id: bPkg.id, name: "chiếm gói", price: 1, sessionCount: 1, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true });
  res = await put(withPkg);
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, "PACKAGE_NOT_OWNED");

  // copy from B's closed revision -> 404 (the revision is not A's)
  await app.call("POST", "/profile/me/listing/discard", A.tok, {});
  const copy = await createDraft(A, { copyFromRevisionId: bRev.id });
  assert.equal(copy.status, 404);
  assert.equal(copy.body.error.code, "REVISION_NOT_FOUND");

  // A's calls act on A's revision only: B's rows are as they were
  assert.equal(JSON.stringify(await dbRev(bRev.id)).includes("REJECTED"), true);
  assert.equal(bRevAfterSubmit.includes("PENDING"), true);
  const bPkgNow = await prisma.pTServicePackage.findUniqueOrThrow({ where: { id: bPkg.id } });
  assert.equal(bPkgNow.name, "Gói của B");
  assert.equal(bPkgNow.version, 1);
  assert.equal((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: bPhoto.id } })).status, "STAGED");
  // and A cannot delete B's staged photo through the physique route
  assert.equal((await app.call("DELETE", `/profile/me/listing/physique/${bPhoto.id}`, A.tok)).status, 404);
  assert.equal((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: bPhoto.id } })).status, "STAGED");
});

// ── 7. admin direct edit, invalidation, rebase ────────────────────────────────────────────────

test("admin direct-edit: reason >= 10 chars, version guard, ADMIN_DIRECT revision + audit, PENDING -> STALE + rebased child + notice; open DRAFT -> LISTING_STALE -> rebase", async () => {
  const A = await newPt();
  const draftOnly = await newPt();
  const photo1 = await seedPhoto(storage, A.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  const photo2 = await seedPhoto(storage, A.userId, "PUBLISHED", { sortOrder: 1 });
  const staged = await seedPhoto(storage, A.userId, "STAGED");

  // A has a PENDING revision; draftOnly has a DRAFT
  const pending = await draftWith(A, (p) => (p.profile.professionalBio = "bản của PT đang chờ"));
  assert.equal((await submit(A, pending)).status, 200);
  const openDraft = await draftWith(draftOnly, (p) => (p.profile.languages = ["vi", "de"]));

  const url = `/admin/listings/pts/${A.userId}/direct-edit`;
  const edit = { profile: { languages: ["vi", "en", "th"] }, reason: "Chỉnh theo yêu cầu của PT qua email", expectedListingVersion: 1 };
  assert.equal((await app.call("POST", url, adminTok(), { ...edit, reason: "ngắn" })).status, 400, "reason too short");
  assert.equal((await app.call("POST", url, adminTok(), { ...edit, reason: undefined })).status, 400, "reason required");
  assert.equal((await app.call("POST", url, adminTok(), { ...edit, expectedListingVersion: undefined })).status, 400);
  assert.equal((await app.call("POST", url, adminTok(), { ...edit, unknownField: 1 })).status, 400, "strict");
  const staleVersion = await app.call("POST", url, adminTok(), { ...edit, expectedListingVersion: 7 });
  assert.equal(staleVersion.status, 409);
  assert.equal(staleVersion.body.error.code, "LISTING_STALE");
  assert.equal((await app.call("POST", url, adminTok(), { reason: "không đổi gì cả cả", expectedListingVersion: 1 })).body.error.code, "NO_CHANGES");
  // an admin cannot bring a STAGED (private) photo live, only reorder/cover/retire the public ones
  const addPhoto = await app.call("POST", url, adminTok(), { photoIds: [photo1.id, photo2.id, staged.id], reason: "thử thêm ảnh chưa công khai", expectedListingVersion: 1 });
  assert.equal(addPhoto.status, 422);
  assert.equal(addPhoto.body.error.code, "PHOTO_NOT_PUBLISHED");
  assert.equal((await profileOf(A.userId)).listingVersion, 1, "failed attempts changed nothing");

  const ok = await app.call("POST", url, adminTok(), { ...edit, photoIds: [photo2.id, photo1.id], coverPhotoId: photo2.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.listingVersion, 2);
  const direct = await dbRev(ok.body.revisionId);
  assert.equal(direct.status, "APPROVED");
  assert.equal(direct.source, "ADMIN_DIRECT");
  assert.equal(direct.adminReason, "Chỉnh theo yêu cầu của PT qua email");
  assert.equal(direct.reviewedBy, ADMIN);
  assert.equal((direct.previousSnapshot as any).listingVersion, 1);
  const pubAfter = await prisma.ptPhysiquePhoto.findMany({ where: { ptUserId: A.userId, status: "PUBLISHED" }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(pubAfter.map((p) => p.id), [photo2.id, photo1.id]);
  assert.equal(pubAfter.find((p) => p.isCover)!.id, photo2.id);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "PT_LISTING", entityId: A.userId, action: "PT_LISTING_ADMIN_EDITED" } });
  assert.equal(audit.actorUserId, ADMIN);
  assert.equal((audit.metadata as any).reason, "Chỉnh theo yêu cầu của PT qua email");
  const changed = (audit.metadata as any).changes.map((c: any) => c.path);
  assert.ok(changed.includes("profile.languages") && changed.includes("photoIds") && changed.includes("coverPhotoId"));

  // the PENDING revision is invalidated: STALE (closed) + a rebased DRAFT child + a notice
  assert.equal((await dbRev(pending.id)).status, "STALE");
  assert.equal(ok.body.invalidatedRevisionId, pending.id);
  const child = await dbRev(ok.body.rebasedDraftRevisionId);
  assert.equal(child.status, "DRAFT");
  assert.equal(child.parentRevisionId, pending.id);
  assert.equal(child.baseVersion, 2, "rebased onto the new public version");
  assert.equal((child.payload as any).profile.professionalBio, "bản của PT đang chờ", "the owner's work is kept");
  assert.equal(await prisma.notification.count({ where: { userId: A.userId, eventType: "PT_LISTING_INVALIDATED" } }), 1);
  const aState = await listing(A);
  assert.equal(aState.openRevision.id, child.id);
  assert.equal(aState.openRevision.stale, false);
  assert.equal((await submit(A, aState.openRevision)).status, 200, "the rebased draft can be submitted as it is");

  // an open DRAFT is NOT invalidated by an admin edit of someone else... edit draftOnly's listing too
  const e2 = await app.call("POST", `/admin/listings/pts/${draftOnly.userId}/direct-edit`, adminTok(), {
    profile: { professionalBio: "Admin đã sửa phần giới thiệu" },
    reason: "Sửa lỗi chính tả trong phần giới thiệu",
    expectedListingVersion: 1,
  });
  assert.equal(e2.status, 200, JSON.stringify(e2.body));
  assert.equal(e2.body.invalidatedRevisionId, null);
  assert.equal((await dbRev(openDraft.id)).status, "DRAFT", "a DRAFT is not invalidated");
  const dState = await listing(draftOnly);
  assert.equal(dState.openRevision.stale, true);
  const staleSubmit = await submit(draftOnly, dState.openRevision);
  assert.equal(staleSubmit.status, 409);
  assert.equal(staleSubmit.body.error.code, "LISTING_STALE");
  const reb = await app.call("POST", "/profile/me/listing/rebase", draftOnly.tok, {});
  assert.equal(reb.status, 200, JSON.stringify(reb.body));
  assert.equal(reb.body.revision.baseVersion, 2);
  assert.equal(reb.body.revision.stale, false);
  assert.deepEqual(reb.body.revision.payload.profile.languages, ["vi", "de"], "rebase keeps the owner's edits");
  assert.equal((await submit(draftOnly, reb.body.revision)).status, 200);
  assert.equal((await approve(openDraft.id)).status, 200);
  const merged = await prisma.pTApplication.findUniqueOrThrow({ where: { id: draftOnly.applicationId! } });
  assert.deepEqual(merged.languages, ["vi", "de"]);
});

test("approve of a revision whose base moved (net under the eager STALE): 409 LISTING_STALE, revision -> STALE + rebased child", async () => {
  const pt = await newPt();
  const rev = await draftWith(pt, (p) => (p.profile.professionalBio = "chờ duyệt nhưng nền đã đổi"));
  assert.equal((await submit(pt, rev)).status, 200);
  // simulate a listing_version bump that did not go through the admin-edit path
  await prisma.userProfile.update({ where: { userId: pt.userId }, data: { listingVersion: { increment: 1 } } });
  const res = await approve(rev.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "LISTING_STALE");
  assert.equal((await dbRev(rev.id)).status, "STALE");
  const open = await prisma.ptListingRevision.findFirstOrThrow({ where: { ptUserId: pt.userId, status: "DRAFT" } });
  assert.equal(open.parentRevisionId, rev.id);
  assert.equal(open.baseVersion, 2);
});

test("admin retire: ADMIN_DIRECT revision, photo RETIRED and 404 on /media at once; purge also deletes the file; a retire invalidates a PENDING revision", async () => {
  const pt = await newPt();
  const keep = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  const gone = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 1 });
  const gone2 = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 2 });
  const pending = await draftWith(pt, (p) => (p.profile.professionalBio = "đang chờ duyệt khi admin gỡ ảnh"));
  assert.equal((await submit(pt, pending)).status, 200);

  assert.equal((await rawGet(`/media/pt-physique/${gone.id}`, null, { redirect: "manual" })).status, 302, "public before");
  const short = await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/${gone.id}/retire`, adminTok(), { reason: "ngắn" });
  assert.equal(short.status, 400);
  const res = await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/${gone.id}/retire`, adminTok(), { reason: "Ảnh vi phạm quy định cộng đồng" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.purged, false);
  assert.equal((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: gone.id } })).status, "RETIRED");
  assert.equal((await rawGet(`/media/pt-physique/${gone.id}`, null, { redirect: "manual" })).status, 404, "404 at once");
  assert.ok(storage.objects.has((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: gone.id } })).storageKey), "the file stays for the history window");
  assert.equal((await dbRev(pending.id)).status, "STALE");
  assert.equal((await dbRev(res.body.revisionId)).source, "ADMIN_DIRECT");
  assert.equal((await profileOf(pt.userId)).listingVersion, 2);
  // retiring a photo that is not public -> 404
  assert.equal((await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/${gone.id}/retire`, adminTok(), { reason: "đã gỡ rồi mà gỡ nữa" })).status, 404);

  const key2 = (await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: gone2.id } })).storageKey;
  assert.ok(storage.objects.has(key2));
  const purge = await app.call("POST", `/admin/listings/pts/${pt.userId}/physique/${gone2.id}/retire`, adminTok(), { reason: "Ảnh nhạy cảm cần xóa ngay", purge: true });
  assert.equal(purge.status, 200);
  assert.equal(purge.body.purged, true);
  assert.equal(storage.objects.has(key2), false, "purge deletes the object immediately");
  assert.equal((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: gone2.id } })).status, "RETIRED", "the row stays as history");
  assert.equal((await prisma.ptPhysiquePhoto.findUniqueOrThrow({ where: { id: keep.id } })).isCover, true);
});

// ── 8. copy from a closed revision ────────────────────────────────────────────────────────────

test("copy-from: <= 30 days only; a photo that no longer exists is dropped with PHOTO_NO_LONGER_AVAILABLE and the cover moves; open revisions cannot be copied", async () => {
  const pt = await newPt();
  const alive = await seedPhoto(storage, pt.userId, "STAGED");
  const dead = await seedPhoto(storage, pt.userId, "DISCARDED");
  const payload = (await listing(pt)).published.payload;
  const day = 24 * 3600 * 1000;
  const mk = (daysAgo: number, photoIds: string[], cover: string | null) =>
    prisma.ptListingRevision.create({
      data: {
        ptUserId: pt.userId,
        status: "REJECTED",
        baseVersion: 1,
        payload: { ...payload, photoIds, coverPhotoId: cover, profile: { ...payload.profile, professionalBio: `bản ${daysAgo} ngày trước` } },
        reviewedBy: ADMIN,
        reviewedAt: new Date(Date.now() - daysAgo * day),
        reviewNote: "x",
      },
    });
  const old = await mk(31, [alive.id], alive.id);
  const recent = await mk(20, [dead.id, alive.id], dead.id);

  const tooOld = await createDraft(pt, { copyFromRevisionId: old.id });
  assert.equal(tooOld.status, 409);
  assert.equal(tooOld.body.error.code, "REVISION_TOO_OLD_TO_COPY");

  const ok = await createDraft(pt, { copyFromRevisionId: recent.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.revision.payload.photoIds, [alive.id], "the dead photo is gone");
  assert.equal(ok.body.revision.payload.coverPhotoId, alive.id, "the cover moved to the first remaining photo");
  assert.deepEqual(ok.body.revision.systemAdjustments, [{ type: "PHOTO_NO_LONGER_AVAILABLE", photoId: dead.id }]);
  assert.equal(ok.body.revision.payload.profile.professionalBio, "bản 20 ngày trước");
  assert.equal(ok.body.revision.parentRevisionId, recent.id);

  // an open revision is not a copy source
  assert.equal((await app.call("POST", "/profile/me/listing/discard", pt.tok, {})).status, 200);
  const open = await draftWith(pt, (p) => (p.profile.professionalBio = "đang mở"));
  await app.call("POST", "/profile/me/listing/discard", pt.tok, {});
  assert.equal((await createDraft(pt, { copyFromRevisionId: open.id })).status, 201, "a discarded (closed) draft can be copied");
  await app.call("POST", "/profile/me/listing/discard", pt.tok, {});
  await createDraft(pt);
  const openNow = (await listing(pt)).openRevision;
  const refused = await createDraft(pt, { copyFromRevisionId: openNow.id });
  assert.equal(refused.status, 409, "an OPEN revision cannot be copied (and a second draft is refused anyway)");
  await app.call("POST", "/profile/me/listing/discard", pt.tok, {});
});

// ── 9. headers, preview isolation, public media ───────────────────────────────────────────────

test("Cache-Control: owner / admin / preview responses are no-store, private; public trainer JSON is no-cache; the media redirect is private, max-age=300", async () => {
  const pt = await newPt();
  const published = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  await makePackage(pt.userId);
  const rev = await draftWith(pt, (p) => (p.profile.professionalBio = "xem trước"));

  // startApp's call() hides response headers, so these go through a second listener on the same app (rawGet)
  const raw = await rawGet(`/profile/me/listing`, pt.tok);
  assert.equal(raw.headers.get("cache-control"), "no-store, private");
  assert.equal(raw.headers.get("vary")?.toLowerCase().includes("authorization"), true);
  assert.equal((await rawGet(`/profile/me/listing/preview`, pt.tok)).headers.get("cache-control"), "no-store, private");
  assert.equal((await rawGet(`/admin/listings/pts?status=DRAFT`, adminTok())).headers.get("cache-control"), "no-store, private");
  assert.equal((await rawGet(`/admin/listings/pts/revisions/${rev.id}`, adminTok())).headers.get("cache-control"), "no-store, private");
  assert.equal((await rawGet(`/admin/listings/pts/revisions/${rev.id}/preview`, adminTok())).headers.get("cache-control"), "no-store, private");
  assert.equal((await rawGet(`/admin/listings/pts/${pt.userId}/history`, adminTok())).headers.get("cache-control"), "no-store, private");
  const viewer = tokenFor(randomUUID(), "CUSTOMER");
  assert.equal((await rawGet(`/profile/pts?q=zzz`, viewer)).headers.get("cache-control"), "no-cache");
  assert.equal((await rawGet(`/profile/pts/${pt.userId}`, viewer)).headers.get("cache-control"), "no-cache");
  assert.equal((await rawGet(`/profile/pts/${pt.userId}/service-packages`, viewer)).headers.get("cache-control"), "no-cache");
  const media = await rawGet(`/media/pt-physique/${published.id}`, null, { redirect: "manual" });
  assert.equal(media.status, 302);
  assert.equal(media.headers.get("cache-control"), "private, max-age=300");
  const location = media.headers.get("location")!;
  assert.ok(location.startsWith("https://memory.test/get/pt-physique/"), location);
  const exp = Number(new URL(location).searchParams.get("exp"));
  assert.ok(exp > Date.now() + 9 * 60_000 && exp <= Date.now() + 10 * 60_000 + 5000, "presigned for ~10 minutes");
});

test("preview: owner/admin only, STAGED photo URLs are presigned (15 min) with expiresAt, never reachable through the public routes; media 404 for STAGED / unknown / hidden trainer", async () => {
  const pt = await newPt();
  const staged = await seedPhoto(storage, pt.userId, "STAGED");
  await makePackage(pt.userId, { price: 1_000_000, sessionCount: 10, name: "Gói thường" });
  const rev = await draftWith(pt, (p) => {
    p.photoIds = [staged.id];
    p.coverPhotoId = staged.id;
    p.packages.push({ name: "Gói mới trong bản nháp", price: 300_000, sessionCount: 3, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true });
  });
  const owner = await app.call("GET", "/profile/me/listing/preview", pt.tok);
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.equal(owner.body.isPreview, true);
  assert.equal(owner.body.revisionStatus, "DRAFT");
  assert.equal(owner.body.viewer, "OWNER");
  assert.equal(owner.body.physiquePhotos.length, 1);
  const url = owner.body.physiquePhotos[0].url as string;
  assert.ok(url.startsWith("https://memory.test/get/"), "a presigned URL, not a /media URL");
  assert.ok(owner.body.physiquePhotos[0].expiresAt);
  assert.ok(owner.body.photoUrlsExpireAt);
  const ttl = new Date(owner.body.physiquePhotos[0].expiresAt).getTime() - Date.now();
  assert.ok(ttl > 14 * 60_000 && ttl <= 15 * 60_000 + 2000, `15 minutes, got ${ttl}`);
  assert.equal(owner.body.fromPricePerSession, 100000, "min(1,000,000/10, 300,000/3) = 100,000: the draft package counts in the preview");

  const admin = await app.call("GET", `/admin/listings/pts/revisions/${rev.id}/preview`, adminTok());
  assert.equal(admin.status, 200);
  assert.equal(admin.body.viewer, "ADMIN");
  assert.equal(admin.body.isPreview, true);

  // nothing of the draft is public
  const viewer = tokenFor(randomUUID(), "CUSTOMER");
  const detail = await app.call("GET", `/profile/pts/${pt.userId}`, viewer);
  const text = JSON.stringify(detail.body);
  for (const forbidden of ["isPreview", "revisionStatus", "systemAdjustments", "memory.test", staged.id, "Gói mới trong bản nháp"]) {
    assert.equal(text.includes(forbidden), false, `public detail must not contain ${forbidden}`);
  }
  assert.deepEqual(detail.body.physiquePhotos, []);
  const list = JSON.stringify((await app.call("GET", `/profile/pts?q=${encodeURIComponent(pt.marker)}`, viewer)).body);
  assert.equal(list.includes(staged.id) || list.includes("isPreview"), false);

  // media: STAGED / RETIRED / unknown / hidden trainer -> 404, anonymous
  assert.equal((await rawGet(`/media/pt-physique/${staged.id}`, null, { redirect: "manual" })).status, 404);
  assert.equal((await rawGet(`/media/pt-physique/${randomUUID()}`, null, { redirect: "manual" })).status, 404);
  assert.equal((await rawGet(`/media/pt-physique/not-a-uuid`, null, { redirect: "manual" })).status, 404);
  const pubPhoto = await seedPhoto(storage, pt.userId, "PUBLISHED", { sortOrder: 0, isCover: true });
  assert.equal((await rawGet(`/media/pt-physique/${pubPhoto.id}`, null, { redirect: "manual" })).status, 302);
  await prisma.userProfile.update({ where: { userId: pt.userId }, data: { ptSuspended: true } });
  assert.equal((await rawGet(`/media/pt-physique/${pubPhoto.id}`, null, { redirect: "manual" })).status, 404, "a suspended trainer's photos are not served");
  await prisma.userProfile.update({ where: { userId: pt.userId }, data: { ptSuspended: false } });
  await prisma.ptRestriction.create({ data: { ptUserId: pt.userId, type: "TEMPORARY_SUSPENSION", imposedBy: "admin-1", scope: "ACCOUNT" } });
  assert.equal((await rawGet(`/media/pt-physique/${pubPhoto.id}`, null, { redirect: "manual" })).status, 404, "an ACCOUNT-scope restriction hides the photos too");
  await prisma.ptRestriction.deleteMany({ where: { ptUserId: pt.userId } });
  await prisma.ptPhysiquePhoto.update({ where: { id: pubPhoto.id }, data: { status: "RETIRED" } });
  assert.equal((await rawGet(`/media/pt-physique/${pubPhoto.id}`, null, { redirect: "manual" })).status, 404);
  // only GET exists on the service as well
  assert.equal((await app.call("POST", `/media/pt-physique/${pubPhoto.id}`, null, {})).status, 404);
});

test("architecture: the preview mapper is imported by the owner/admin side only; the public DTO never takes a revision", () => {
  const src = path.resolve(__dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(src, rel), "utf8");
  const files = (dir: string): string[] =>
    fs.readdirSync(path.join(src, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const importers = files(".").filter((f) => f.endsWith(".ts") && !f.includes("__tests__") && !f.includes("generated")).filter((f) => /toListingPreviewDto|pt-listing-preview/.test(read(f)));
  assert.deepEqual(importers.map((f) => f.replace(/\\/g, "/")).sort(), ["services/pt-listing-apply.service.ts", "services/pt-listing-preview.ts"]);
  // the public DTO module and the public routes/controllers never mention it
  for (const f of ["services/pt-public-dto.ts", "routes/profile.routes.ts", "routes/media.routes.ts", "controllers/profile.controller.ts", "repositories/profile.repository.ts"]) {
    assert.equal(/toListingPreviewDto|pt-listing-preview|buildPreview/.test(read(f)), false, `${f} must not reach the preview mapper`);
  }
  assert.equal(/PtListingRevision|ptListingRevision/.test(read("services/pt-public-dto.ts")), false, "toPublicPtDto cannot see a revision");
  // the preview endpoints are only mounted on authenticated routers
  assert.ok(read("routes/pt-listing.routes.ts").includes("authMiddleware"));
  assert.ok(read("routes/admin.routes.ts").includes('roleMiddleware(["ADMIN"])'));
});

// ── helpers that need response headers ────────────────────────────────────────────────────────

async function rawGet(p: string, token: string | null, init: { redirect?: "manual" | "follow" } = {}) {
  return fetch(raw.base + p, { redirect: init.redirect ?? "follow", headers: token ? { authorization: `Bearer ${token}` } : {} });
}
