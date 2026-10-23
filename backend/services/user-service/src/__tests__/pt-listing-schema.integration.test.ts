/**
 * PT listing management, phase C1 - what migration 20261017173131_pt_listing_revisions guarantees at the DATABASE level.
 *
 * Evidence label: BACKEND INTEGRATION against an isolated `*_test` database that was built by `prisma migrate deploy`
 * (so these constraints are the ones the migration SQL really creates, not ones Prisma's schema DSL describes).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *     npx tsx --test src/__tests__/pt-listing-schema.integration.test.ts
 *
 * Covers: one open revision per PT, the immutable-history trigger, one published cover / no duplicate file per PT, the
 * new columns and enum values, and the migration's own backfill statement (executed against seeded rows).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";

const MIGRATION = path.join(__dirname, "..", "..", "prisma", "migrations", "20261017173131_pt_listing_revisions", "migration.sql");
const profiles: string[] = [];

test.after(async () => {
  // photos / intents go with the profile (ON DELETE CASCADE); closed revisions are immutable and stay (random pt_user_id)
  await prisma.ptListingRevision.deleteMany({ where: { ptUserId: { in: profiles }, status: { in: ["DRAFT", "PENDING"] } } }).catch(() => {});
  await prisma.pTApplication.deleteMany({ where: { userProfile: { userId: { in: profiles } } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: profiles } } }).catch(() => {});
});

const newPt = () => {
  const id = randomUUID();
  profiles.push(id);
  return id;
};
const rev = (ptUserId: string, over: Record<string, unknown> = {}) =>
  prisma.ptListingRevision.create({ data: { ptUserId, baseVersion: 1, payload: { profile: {}, packages: [], photoIds: [] }, ...over } as any });

// ── revisions ─────────────────────────────────────────────────────────────────────────────────

test("at most ONE open (DRAFT or PENDING) revision per PT; a closed one frees the slot; other PTs are independent", async () => {
  const pt = newPt();
  const other = newPt();
  const a = await rev(pt);
  assert.equal(a.status, "DRAFT");
  assert.equal(a.source, "OWNER");
  assert.equal(a.draftVersion, 1);
  assert.deepEqual(a.systemAdjustments, []);

  await assert.rejects(() => rev(pt), (e: any) => e.code === "P2002", "a second DRAFT is refused");
  await prisma.ptListingRevision.update({ where: { id: a.id }, data: { status: "PENDING", submittedAt: new Date(), submittedBy: pt } });
  await assert.rejects(() => rev(pt), (e: any) => e.code === "P2002", "a PENDING one still occupies the slot");
  await rev(other); // another PT is unaffected

  await prisma.ptListingRevision.update({ where: { id: a.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: "admin-1" } });
  const b = await rev(pt, { parentRevisionId: a.id });
  assert.equal(b.status, "DRAFT");
  // an open revision may be edited and withdrawn freely
  await prisma.ptListingRevision.update({ where: { id: b.id }, data: { payload: { changed: true }, draftVersion: { increment: 1 } } });
  await prisma.ptListingRevision.update({ where: { id: b.id }, data: { status: "WITHDRAWN" } });
  await rev(pt); // slot free again
});

test("immutable history: a closed revision cannot be deleted or edited (except system_adjustments); the transition that closes it is allowed", async () => {
  const pt = newPt();
  const open = await rev(pt, { payload: { v: 1 } });
  await prisma.ptListingRevision.update({ where: { id: open.id }, data: { status: "PENDING" } });
  // PENDING -> APPROVED is the closing transition: allowed, and it may set previous_snapshot / review fields in the same UPDATE
  const closed = await prisma.ptListingRevision.update({
    where: { id: open.id },
    data: { status: "APPROVED", previousSnapshot: { was: "old" }, reviewedBy: "admin-1", reviewedAt: new Date(), reviewNote: "ok" },
  });
  assert.equal(closed.status, "APPROVED");

  const refused = /immutable|cannot be deleted/;
  for (const data of [
    { payload: { v: 2 } },
    { reviewNote: "rewritten" },
    { status: "DRAFT" },
    { status: "REJECTED" },
    { previousSnapshot: { was: "forged" } },
    { adminReason: "x" },
    { draftVersion: 99 },
  ] as Array<Record<string, unknown>>) {
    await assert.rejects(() => prisma.ptListingRevision.update({ where: { id: open.id }, data: data as any }), refused, `update ${JSON.stringify(data)} must be refused`);
  }
  await assert.rejects(() => prisma.ptListingRevision.delete({ where: { id: open.id } }), refused);
  await assert.rejects(() => prisma.ptListingRevision.deleteMany({ where: { id: open.id } }), refused);

  // the one exception: system_adjustments (a housekeeping job noting what it did)
  const adj = [{ kind: "PHOTO_DROPPED", photoId: "p1" }];
  const noted = await prisma.ptListingRevision.update({ where: { id: open.id }, data: { systemAdjustments: adj } });
  assert.deepEqual(noted.systemAdjustments, adj);
  const after = await prisma.ptListingRevision.findUniqueOrThrow({ where: { id: open.id } });
  assert.deepEqual(after.payload, { v: 1 });
  assert.equal(after.reviewNote, "ok");

  // every closed status is protected, not only APPROVED (rows inserted directly in each state)
  for (const status of ["REJECTED", "WITHDRAWN", "CHANGES_REQUESTED", "STALE"] as const) {
    const other = newPt();
    const row = await rev(other, { status });
    await assert.rejects(() => prisma.ptListingRevision.update({ where: { id: row.id }, data: { payload: { x: 1 } } }), refused, `${status} update`);
    await assert.rejects(() => prisma.ptListingRevision.update({ where: { id: row.id }, data: { status: "DRAFT" } }), refused, `${status} reopen`);
    await assert.rejects(() => prisma.ptListingRevision.delete({ where: { id: row.id } }), refused, `${status} delete`);
  }
  // open rows can be deleted ("bỏ nháp" when never submitted is a status change, but nothing forbids housekeeping on DRAFT)
  const draft = await rev(newPt());
  await prisma.ptListingRevision.delete({ where: { id: draft.id } });
});

// ── photos ────────────────────────────────────────────────────────────────────────────────────

test("physique photos: one PUBLISHED cover per PT; the same file (hash) cannot be STAGED/PUBLISHED twice; NULL hashes and retired rows are exempt", async () => {
  const pt = newPt();
  const other = newPt();
  await prisma.userProfile.createMany({ data: [{ userId: pt }, { userId: other }] });
  const photo = (ptUserId: string, over: Record<string, unknown> = {}) =>
    prisma.ptPhysiquePhoto.create({
      data: { ptUserId, storageKey: `k/${randomUUID()}`, mime: "image/jpeg", bytes: 10, uploadedBy: ptUserId, ...over } as any,
    });

  const cover = await photo(pt, { status: "PUBLISHED", isCover: true });
  await assert.rejects(() => photo(pt, { status: "PUBLISHED", isCover: true }), (e: any) => e.code === "P2002", "second published cover");
  await photo(pt, { status: "PUBLISHED", isCover: false });
  await photo(pt, { status: "STAGED", isCover: true }); // a staged "cover" is only a draft intention, not constrained
  await photo(pt, { status: "RETIRED", isCover: true }); // history
  await photo(other, { status: "PUBLISHED", isCover: true }); // another PT is independent
  // moving the cover = clear the old flag first (what the apply transaction does), then set the new one
  await prisma.ptPhysiquePhoto.update({ where: { id: cover.id }, data: { isCover: false } });
  await photo(pt, { status: "PUBLISHED", isCover: true });

  const h = "a".repeat(64);
  const first = await photo(pt, { status: "STAGED", contentHash: h });
  await assert.rejects(() => photo(pt, { status: "STAGED", contentHash: h }), (e: any) => e.code === "P2002", "duplicate staged file");
  await assert.rejects(() => photo(pt, { status: "PUBLISHED", contentHash: h }), (e: any) => e.code === "P2002", "duplicate published file");
  await photo(other, { status: "STAGED", contentHash: h }); // another PT may hold the same bytes
  await photo(pt, { status: "STAGED", contentHash: null });
  await photo(pt, { status: "STAGED", contentHash: null });
  await prisma.ptPhysiquePhoto.update({ where: { id: first.id }, data: { status: "RETIRED", retiredAt: new Date() } });
  await photo(pt, { status: "STAGED", contentHash: h }); // the retired row no longer blocks re-adding the file
  await photo(pt, { status: "DISCARDED", contentHash: h }); // nor does a discarded one

  // deleting the profile removes its photos and upload intents
  await prisma.ptMediaUploadIntent.create({ data: { ptUserId: pt, objectKey: `intent/${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.userProfile.delete({ where: { userId: pt } });
  assert.equal(await prisma.ptPhysiquePhoto.count({ where: { ptUserId: pt } }), 0);
  assert.equal(await prisma.ptMediaUploadIntent.count({ where: { ptUserId: pt } }), 0);
});

// ── columns, enums, small tables ─────────────────────────────────────────────────────────────

test("new columns, enum values and tables exist with the specified defaults", async () => {
  const pt = newPt();
  await prisma.userProfile.create({ data: { userId: pt } });
  const p = await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } });
  assert.equal(p.listingVersion, 0);
  assert.equal(p.listingPublishedAt, null);
  const pkg = await prisma.pTServicePackage.create({ data: { ptUserId: pt, name: "n", sessionCount: 1, price: 1, sessionMode: "ONLINE" } });
  assert.equal(pkg.version, 1);

  const labels = await prisma.$queryRaw<{ t: string; v: string }[]>`
    SELECT t.typname AS t, e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname IN ('AuditEntityType', 'NotificationEventType', 'NotificationEntityType', 'PtListingRevisionStatus', 'PtListingRevisionSource', 'PtPhysiquePhotoStatus', 'PtMediaUploadIntentStatus')`;
  const has = (t: string, v: string) => labels.some((l) => l.t === t && l.v === v);
  assert.ok(has("AuditEntityType", "PT_LISTING"));
  for (const v of ["PT_LISTING_APPROVED", "PT_LISTING_REJECTED", "PT_LISTING_CHANGES_REQUESTED", "PT_LISTING_INVALIDATED"]) assert.ok(has("NotificationEventType", v), v);
  assert.ok(has("NotificationEntityType", "PT_LISTING"));
  for (const v of ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "WITHDRAWN", "STALE"]) assert.ok(has("PtListingRevisionStatus", v), v);
  for (const v of ["OWNER", "ADMIN_DIRECT"]) assert.ok(has("PtListingRevisionSource", v), v);
  for (const v of ["STAGED", "PUBLISHED", "RETIRED", "DISCARDED"]) assert.ok(has("PtPhysiquePhotoStatus", v), v);
  for (const v of ["PENDING", "CONFIRMING", "CONFIRMED", "REJECTED"]) assert.ok(has("PtMediaUploadIntentStatus", v), v);

  // the new enum values are usable by the application (the values were committed, not just declared)
  const actor = randomUUID();
  const audit = await prisma.auditLog.create({ data: { actorUserId: actor, action: "PT_LISTING_TEST", entityType: "PT_LISTING", entityId: pt } });
  const note = await prisma.notification.create({
    data: { userId: pt, text: "t", eventType: "PT_LISTING_APPROVED", entityType: "PT_LISTING", entityId: pt, link: "/pt/listing" } as any,
  });
  await prisma.notification.delete({ where: { id: note.id } });
  await prisma.auditLog.delete({ where: { id: audit.id } });

  const ev = await prisma.clientCompatEvent.create({ data: { route: "POST /x", outcome: "LEGACY_ACCEPTED" } });
  assert.equal(ev.actorUserId, null);
  assert.equal(ev.clientHeader, null);
  await prisma.clientCompatEvent.delete({ where: { id: ev.id } });

  const idx = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('pt_listing_revisions', 'pt_physique_photos')`;
  const def = (n: string) => idx.find((i) => i.indexname === n)?.indexdef ?? "";
  assert.match(def("pt_listing_revisions_one_open_per_pt"), /UNIQUE.*WHERE .*DRAFT.*PENDING/s);
  assert.match(def("pt_physique_photos_one_cover"), /UNIQUE.*WHERE .*is_cover.*PUBLISHED/s);
  assert.match(def("pt_physique_photos_unique_hash"), /UNIQUE.*content_hash.*WHERE .*STAGED.*PUBLISHED.*content_hash IS NOT NULL/s);
  await prisma.userProfile.delete({ where: { userId: pt } });
});

// ── backfill ─────────────────────────────────────────────────────────────────────────────────

test("backfill (the migration's own UPDATE, run on seeded rows): version 1 + published_at = approved_at only for isPT with an APPROVED application", async () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const stmt = sql.match(/UPDATE "user_profiles" AS up[\s\S]*?;/)?.[0];
  assert.ok(stmt, "the backfill statement is in the migration file");

  const approvedAt = new Date("2026-03-04T05:06:07.000Z");
  const seed = async (isPT: boolean, status: "APPROVED" | "SUBMITTED" | "NONE") => {
    const userId = newPt();
    const profile = await prisma.userProfile.create({ data: { userId, isPT } });
    if (status !== "NONE") await prisma.pTApplication.create({ data: { userProfileId: profile.id, status, approvedAt: status === "APPROVED" ? approvedAt : null } });
    return userId;
  };
  const approvedPt = await seed(true, "APPROVED");
  const submittedPt = await seed(true, "SUBMITTED");
  const approvedNotPt = await seed(false, "APPROVED");
  const noApp = await seed(true, "NONE");
  // freshly created rows carry the column defaults
  for (const id of [approvedPt, submittedPt, approvedNotPt, noApp]) {
    const p = await prisma.userProfile.findUniqueOrThrow({ where: { userId: id } });
    assert.deepEqual([p.listingVersion, p.listingPublishedAt], [0, null]);
  }

  await prisma.$executeRawUnsafe(stmt);

  const get = (id: string) => prisma.userProfile.findUniqueOrThrow({ where: { userId: id } });
  const a = await get(approvedPt);
  assert.equal(a.listingVersion, 1);
  assert.equal(a.listingPublishedAt?.getTime(), approvedAt.getTime(), "published_at is approved_at, as the same instant");
  for (const id of [submittedPt, approvedNotPt, noApp]) {
    const p = await get(id);
    assert.deepEqual([p.listingVersion, p.listingPublishedAt], [0, null], `profile ${id} stays at 0`);
  }
  // idempotent
  await prisma.$executeRawUnsafe(stmt);
  assert.equal((await get(approvedPt)).listingVersion, 1);
});
