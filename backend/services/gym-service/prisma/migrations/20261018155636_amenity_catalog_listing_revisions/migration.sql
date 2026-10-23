-- Listing management, phase B1 (gym-service foundation). Everything below runs in ONE transaction
-- (Prisma applies a migration file as a single implicit transaction): if any statement - including the
-- verification DO blocks - fails, nothing here is applied. PostgreSQL >= 12 is required for
-- ALTER TYPE ... ADD VALUE inside a transaction; the new enum values are only ADDED here, never USED, which is the
-- one thing PostgreSQL still forbids in that case. No CREATE INDEX CONCURRENTLY.
--
--   1. enum additions (partner audit actions, partner review issue category)
--   2. new enums
--   3. amenities (catalogue) + amenity_proposals + gym_amenities, seed of the 18 SYSTEM rows, backfill from gyms.facilities
--   4. gyms / gym_partners new columns + backfill
--   5. gym_photos lifecycle columns, backfill, sort_order renumbering, cover repair, partial unique indexes
--   6. gym_listing_revisions (+ one-open-revision-per-gym partial unique index, immutable-history trigger)
--   7. legacy_compat_events, compat_writer_heartbeats, client_compat_events, amenity_audit_logs
--   8. verification: amenities <-> GymFacility, gym_amenities <-> gyms.facilities (two-way pair comparison)
--   9. compat-writer triggers on gyms / gym_partners (LAST, so the backfill above never logs events)

-- ── 1. Enum additions ───────────────────────────────────────────────────────────────────────
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'LISTING_SUBMITTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'LISTING_APPROVED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'LISTING_REJECTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'LISTING_CHANGES_REQUESTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'LISTING_ADMIN_EDITED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'AMENITY_PROPOSED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'AMENITY_PROPOSAL_APPROVED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'AMENITY_PROPOSAL_REJECTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'AMENITY_PROPOSAL_MERGED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'GYM_ADMIN_STATUS_CHANGED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'GYM_ADMIN_RENAME_APPROVED';
ALTER TYPE "PartnerAuditAction" ADD VALUE IF NOT EXISTS 'GYM_ADMIN_UPDATED';
-- GymPartnerReviewIssue.category (issues on a self-service partner application). BranchReviewCategory already has
-- FACILITIES for the branch wizard's own issues, so it is untouched.
ALTER TYPE "PartnerReviewCategory" ADD VALUE IF NOT EXISTS 'AMENITIES';

-- ── 2. New enums ────────────────────────────────────────────────────────────────────────────
CREATE TYPE "AmenityCategory" AS ENUM ('FACILITY', 'TRAINING_ZONE', 'SERVICE', 'RECOVERY');
CREATE TYPE "AmenitySource" AS ENUM ('SYSTEM', 'CUSTOM');
CREATE TYPE "AmenityStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AmenityProposalKind" AS ENUM ('NEW', 'REENABLE');
CREATE TYPE "AmenityProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED', 'CANCELLED');
CREATE TYPE "GymListingRevisionStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'WITHDRAWN', 'STALE');
CREATE TYPE "GymListingRevisionSource" AS ENUM ('OWNER', 'ADMIN_DIRECT');
CREATE TYPE "GymPhotoStatus" AS ENUM ('STAGED', 'PUBLISHED', 'RETIRED', 'DISCARDED');
CREATE TYPE "LegacyCompatOutcome" AS ENUM ('ACCEPTED', 'REJECTED_422', 'REJECTED_OTHER', 'WRITER_ABSENT', 'NON_CLIENT');
CREATE TYPE "LegacyCompatEntityType" AS ENUM ('GYM_PARTNER', 'GYM');

-- ── 3. Amenity catalogue ────────────────────────────────────────────────────────────────────
-- The catalogue has two states only (ACTIVE | DISABLED); proposals live in their own table. name_normalized is
-- unique: "Phòng boxing" and "phong BOXING" are the same amenity (normalisation = amenity-catalog.ts).
CREATE TABLE "amenities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "category" "AmenityCategory" NOT NULL,
    "icon_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" "AmenitySource" NOT NULL DEFAULT 'CUSTOM',
    "status" "AmenityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_from_proposal_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "amenities_slug_key" ON "amenities"("slug");
CREATE UNIQUE INDEX "amenities_name_normalized_key" ON "amenities"("name_normalized");
CREATE INDEX "amenities_status_category_sort_order_idx" ON "amenities"("status", "category", "sort_order");

-- A proposal is what an owner asks for; the catalogue only ever receives what an admin approved. REENABLE asks to
-- switch a DISABLED catalogue row back on (target_amenity_id); NEW asks for a name that is not in the catalogue.
CREATE TABLE "amenity_proposals" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "kind" "AmenityProposalKind" NOT NULL DEFAULT 'NEW',
    "target_amenity_id" TEXT,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "suggested_category" "AmenityCategory" NOT NULL,
    "note" TEXT,
    "status" "AmenityProposalStatus" NOT NULL DEFAULT 'PENDING',
    "resulting_amenity_id" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenity_proposals_pkey" PRIMARY KEY ("id"),
    -- APPROVED / MERGED always point at the catalogue row they produced or joined; REJECTED / CANCELLED never do.
    CONSTRAINT "amenity_proposals_resulting_amenity_chk" CHECK (
        (("status" IN ('APPROVED', 'MERGED')) AND "resulting_amenity_id" IS NOT NULL)
        OR (("status" IN ('REJECTED', 'CANCELLED')) AND "resulting_amenity_id" IS NULL)
        OR ("status" = 'PENDING')
    )
);

CREATE INDEX "amenity_proposals_status_kind_name_normalized_idx" ON "amenity_proposals"("status", "kind", "name_normalized");
CREATE INDEX "amenity_proposals_owner_user_id_status_idx" ON "amenity_proposals"("owner_user_id", "status");
CREATE INDEX "amenity_proposals_gym_id_idx" ON "amenity_proposals"("gym_id");

-- One PENDING proposal per (owner, branch, normalised name): the INSERT ... ON CONFLICT DO NOTHING target (never catch P2002).
-- The same owner may propose the same name for each of their branches (Ngài, Phase B3); the admin queue still groups them.
CREATE UNIQUE INDEX "amenity_proposals_one_pending_per_owner_gym_name"
    ON "amenity_proposals"("owner_user_id", "gym_id", "name_normalized")
    WHERE "status" = 'PENDING';

ALTER TABLE "amenities"
    ADD CONSTRAINT "amenities_created_from_proposal_id_fkey" FOREIGN KEY ("created_from_proposal_id") REFERENCES "amenity_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "amenity_proposals"
    ADD CONSTRAINT "amenity_proposals_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "amenity_proposals_target_amenity_id_fkey" FOREIGN KEY ("target_amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "amenity_proposals_resulting_amenity_id_fkey" FOREIGN KEY ("resulting_amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- gym_amenities is the canonical set of a branch's amenities; gyms.facilities becomes a mirror of it (see
-- syncFacilitiesMirrorTx). Catalogue rows are never deleted, hence RESTRICT.
CREATE TABLE "gym_amenities" (
    "gym_id" TEXT NOT NULL,
    "amenity_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_amenities_pkey" PRIMARY KEY ("gym_id", "amenity_id")
);

CREATE INDEX "gym_amenities_amenity_id_idx" ON "gym_amenities"("amenity_id");

ALTER TABLE "gym_amenities"
    ADD CONSTRAINT "gym_amenities_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "gym_amenities_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly the 18 GymFacility enum values: slug = the enum label verbatim, Vietnamese name = FACILITY_LABEL on web and
-- mobile, name_normalized = normalizeAmenityName(name). category / icon_key / sort_order: see amenity-catalog.ts.
INSERT INTO "amenities" ("id", "slug", "name", "name_normalized", "category", "icon_key", "sort_order", "source", "status") VALUES
    ('amenity-sys-free-weights', 'FREE_WEIGHTS', 'Tạ tự do', 'ta tu do', 'TRAINING_ZONE', 'dumbbell', 10, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-cardio-machines', 'CARDIO_MACHINES', 'Máy cardio', 'may cardio', 'TRAINING_ZONE', 'heart-pulse', 20, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-functional-training-area', 'FUNCTIONAL_TRAINING_AREA', 'Khu tập functional', 'khu tap functional', 'TRAINING_ZONE', 'activity', 30, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-group-classes', 'GROUP_CLASSES', 'Lớp tập nhóm', 'lop tap nhom', 'SERVICE', 'users', 40, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-yoga-studio', 'YOGA_STUDIO', 'Phòng Yoga', 'phong yoga', 'TRAINING_ZONE', 'flower', 50, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-swimming-pool', 'SWIMMING_POOL', 'Hồ bơi', 'ho boi', 'TRAINING_ZONE', 'waves', 60, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-personal-trainer', 'PERSONAL_TRAINER', 'Huấn luyện viên cá nhân', 'huan luyen vien ca nhan', 'SERVICE', 'user-check', 70, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-inbody-scan', 'INBODY_SCAN', 'Máy đo InBody', 'may do inbody', 'SERVICE', 'scan-line', 80, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-locker-room', 'LOCKER_ROOM', 'Phòng thay đồ / tủ khoá', 'phong thay do / tu khoa', 'FACILITY', 'lock', 90, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-shower', 'SHOWER', 'Phòng tắm', 'phong tam', 'FACILITY', 'shower-head', 100, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-sauna', 'SAUNA', 'Xông hơi', 'xong hoi', 'RECOVERY', 'flame', 110, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-towel-service', 'TOWEL_SERVICE', 'Dịch vụ khăn tắm', 'dich vu khan tam', 'SERVICE', 'shirt', 120, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-parking', 'PARKING', 'Bãi đỗ xe', 'bai do xe', 'FACILITY', 'car', 130, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-wifi', 'WIFI', 'Wifi miễn phí', 'wifi mien phi', 'FACILITY', 'wifi', 140, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-air-conditioning', 'AIR_CONDITIONING', 'Máy lạnh', 'may lanh', 'FACILITY', 'snowflake', 150, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-drinking-water', 'DRINKING_WATER', 'Nước uống miễn phí', 'nuoc uong mien phi', 'FACILITY', 'droplets', 160, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-kids-area', 'KIDS_AREA', 'Khu vui chơi trẻ em', 'khu vui choi tre em', 'FACILITY', 'baby', 170, 'SYSTEM', 'ACTIVE'),
    ('amenity-sys-vending-machine', 'VENDING_MACHINE', 'Máy bán hàng tự động', 'may ban hang tu dong', 'SERVICE', 'cup-soda', 180, 'SYSTEM', 'ACTIVE');

-- gyms.facilities -> gym_amenities. unnest(empty array) yields no rows, DISTINCT collapses duplicated array entries.
INSERT INTO "gym_amenities" ("gym_id", "amenity_id")
SELECT DISTINCT g."id", a."id"
  FROM "gyms" g
  CROSS JOIN LATERAL unnest(g."facilities") AS f
  JOIN "amenities" a ON a."slug" = f::text;

-- ── 4. gyms / gym_partners ──────────────────────────────────────────────────────────────────
-- listing_version: a gym that is (or ever was) public already HAS a listing - that approval is version 1.
-- listing_published_at stays NULL for legacy rows ("public before the listing system existed"); only applying a
-- revision sets it. created_flow_version / application_flow_version stay NULL for every pre-existing row (legacy).
-- legacy_client_at is TIMESTAMPTZ(6) on purpose: it must be EQUAL to legacy_compat_events.occurred_at (same now()).
ALTER TABLE "gyms"
    ADD COLUMN "listing_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "listing_published_at" TIMESTAMPTZ(3),
    ADD COLUMN "created_flow_version" INTEGER,
    ADD COLUMN "legacy_no_amenities" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "legacy_client_at" TIMESTAMPTZ(6);

UPDATE "gyms"
   SET "listing_version" = 1
 WHERE "status" IN ('APPROVED', 'SUSPENDED') OR "approved_name" IS NOT NULL;

ALTER TABLE "gym_partners"
    ADD COLUMN "application_flow_version" INTEGER,
    ADD COLUMN "legacy_no_amenities" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "legacy_client_at" TIMESTAMPTZ(6);

-- ── 5. gym_photos lifecycle ─────────────────────────────────────────────────────────────────
-- Every existing row first becomes PUBLISHED (the old behaviour: shown to clients once the gym was approved), then
-- the photos of gyms that were never public become STAGED, and only then does the DEFAULT flip to STAGED so every
-- photo created from now on starts out unpublished.
ALTER TABLE "gym_photos"
    ADD COLUMN "status" "GymPhotoStatus" NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN "content_hash" TEXT,
    ADD COLUMN "retired_at" TIMESTAMPTZ(3),
    ADD COLUMN "uploaded_by" TEXT;

UPDATE "gym_photos"
   SET "status" = 'STAGED'
 WHERE "gym_id" IN (SELECT "id" FROM "gyms" WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'REJECTED'));

ALTER TABLE "gym_photos" ALTER COLUMN "status" SET DEFAULT 'STAGED';

-- sort_order -> gap-free 0..n-1 per gym, keeping the order clients saw: (sort_order, created_at, id).
WITH ranked AS (
    SELECT "id", (row_number() OVER (PARTITION BY "gym_id" ORDER BY "sort_order", "created_at", "id") - 1)::int AS rn
      FROM "gym_photos"
)
UPDATE "gym_photos" p
   SET "sort_order" = r.rn
  FROM ranked r
 WHERE p."id" = r."id" AND p."sort_order" <> r.rn;

-- Cover repair, so CREATE UNIQUE INDEX below can never fail without a diagnosis:
--   1. report how many gyms have more than one PUBLISHED cover (count over the FULL set; the id list is capped at 50);
--   2. keep the flag only on the first flagged photo by (sort_order, created_at, id), NOTICE every photo that loses it;
--      a gym with PUBLISHED photos but no cover gets its first PUBLISHED photo as cover;
--   3. re-check and RAISE EXCEPTION (whole migration rolls back) if any gym still has more than one.
DO $$
DECLARE
    v_multi_n bigint;
    v_multi_s text;
    v_left_n  bigint;
    v_left_s  text;
    r         record;
BEGIN
    SELECT count(*) INTO v_multi_n
      FROM (SELECT "gym_id" FROM "gym_photos" WHERE "is_cover" AND "status" = 'PUBLISHED' GROUP BY "gym_id" HAVING count(*) > 1) m;
    SELECT string_agg("gym_id", ', ' ORDER BY "gym_id") INTO v_multi_s
      FROM (SELECT "gym_id" FROM "gym_photos" WHERE "is_cover" AND "status" = 'PUBLISHED' GROUP BY "gym_id" HAVING count(*) > 1 ORDER BY "gym_id" LIMIT 50) m;
    RAISE NOTICE 'gym_photos: % gym có hơn 1 ảnh bìa PUBLISHED (tối đa 50 gym_id): %', v_multi_n, coalesce(v_multi_s, '-');

    FOR r IN
        SELECT c."id", c."gym_id"
          FROM (SELECT "id", "gym_id", row_number() OVER (PARTITION BY "gym_id" ORDER BY "sort_order", "created_at", "id") AS rn
                  FROM "gym_photos" WHERE "is_cover" AND "status" = 'PUBLISHED') c
         WHERE c.rn > 1
         ORDER BY c."gym_id", c."id"
    LOOP
        RAISE NOTICE 'gym %: bỏ cờ ảnh bìa của ảnh %', r."gym_id", r."id";
        UPDATE "gym_photos" SET "is_cover" = false WHERE "id" = r."id";
    END LOOP;

    FOR r IN
        SELECT DISTINCT ON (p."gym_id") p."gym_id", p."id"
          FROM "gym_photos" p
         WHERE p."status" = 'PUBLISHED'
           AND NOT EXISTS (SELECT 1 FROM "gym_photos" c WHERE c."gym_id" = p."gym_id" AND c."status" = 'PUBLISHED' AND c."is_cover")
         ORDER BY p."gym_id", p."sort_order", p."created_at", p."id"
    LOOP
        RAISE NOTICE 'gym %: chưa có ảnh bìa, đặt ảnh % làm bìa', r."gym_id", r."id";
        UPDATE "gym_photos" SET "is_cover" = true WHERE "id" = r."id";
    END LOOP;

    SELECT count(*) INTO v_left_n
      FROM (SELECT "gym_id" FROM "gym_photos" WHERE "is_cover" AND "status" = 'PUBLISHED' GROUP BY "gym_id" HAVING count(*) > 1) m;
    SELECT string_agg("gym_id" || ' (' || n || ' ảnh bìa)', ', ' ORDER BY "gym_id") INTO v_left_s
      FROM (SELECT "gym_id", count(*) AS n FROM "gym_photos" WHERE "is_cover" AND "status" = 'PUBLISHED' GROUP BY "gym_id" HAVING count(*) > 1 ORDER BY "gym_id" LIMIT 50) m;
    IF v_left_n > 0 THEN
        RAISE EXCEPTION 'gym_photos: còn % gym có hơn 1 ảnh bìa PUBLISHED sau khi sửa (vd: %)', v_left_n, v_left_s;
    END IF;
END $$;

CREATE INDEX "gym_photos_gym_id_status_sort_order_idx" ON "gym_photos"("gym_id", "status", "sort_order");

-- At most ONE published cover per gym: the final guard against two concurrent "set cover" writes.
CREATE UNIQUE INDEX "gym_photos_one_cover"
    ON "gym_photos"("gym_id")
    WHERE "is_cover" AND "status" = 'PUBLISHED';

-- The same file (sha256) cannot be staged/published twice for one gym; NULL hashes (legacy rows) are ignored.
CREATE UNIQUE INDEX "gym_photos_unique_hash"
    ON "gym_photos"("gym_id", "content_hash")
    WHERE "status" IN ('STAGED', 'PUBLISHED') AND "content_hash" IS NOT NULL;

-- ── 6. gym_listing_revisions ────────────────────────────────────────────────────────────────
CREATE TABLE "gym_listing_revisions" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "status" "GymListingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "GymListingRevisionSource" NOT NULL DEFAULT 'OWNER',
    "parent_revision_id" TEXT,
    "base_version" INTEGER NOT NULL,
    "draft_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "previous_snapshot" JSONB,
    "system_adjustments" JSONB NOT NULL DEFAULT '[]',
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "owner_note" TEXT,
    "admin_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gym_listing_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gym_listing_revisions_gym_id_created_at_idx" ON "gym_listing_revisions"("gym_id", "created_at");
CREATE INDEX "gym_listing_revisions_status_submitted_at_idx" ON "gym_listing_revisions"("status", "submitted_at");

-- At most ONE open (DRAFT or PENDING) revision per gym. Every state change is a conditional UPDATE, and this index is
-- what makes "two drafts at once" impossible even if two requests race.
CREATE UNIQUE INDEX "gym_listing_revisions_one_open_per_gym"
    ON "gym_listing_revisions"("gym_id")
    WHERE "status" IN ('DRAFT', 'PENDING');

ALTER TABLE "gym_listing_revisions"
    ADD CONSTRAINT "gym_listing_revisions_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- History is immutable: a closed revision can never be deleted, and the only thing that may still change on it is
-- system_adjustments (a housekeeping job notes what it did) - plus updated_at, which the ORM bumps on every write.
-- The check looks at the OLD status, so the transition that CLOSES a revision (PENDING -> APPROVED, DRAFT ->
-- WITHDRAWN, ...) is of course allowed. (Deleting a gym that has closed revisions is therefore refused too.)
CREATE FUNCTION "gym_listing_revisions_guard_closed"() RETURNS trigger AS $$
BEGIN
    IF OLD."status" IN ('APPROVED', 'REJECTED', 'WITHDRAWN', 'CHANGES_REQUESTED', 'STALE') THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'gym_listing_revisions: closed revision % (status %) cannot be deleted', OLD."id", OLD."status"
                USING ERRCODE = '23001';
        END IF;
        IF (to_jsonb(NEW) - 'system_adjustments' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'system_adjustments' - 'updated_at') THEN
            RAISE EXCEPTION 'gym_listing_revisions: closed revision % (status %) is immutable', OLD."id", OLD."status"
                USING ERRCODE = '23001';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gym_listing_revisions_immutable"
    BEFORE UPDATE OR DELETE ON "gym_listing_revisions"
    FOR EACH ROW EXECUTE FUNCTION "gym_listing_revisions_guard_closed"();

-- ── 7. Compatibility telemetry + catalogue audit ────────────────────────────────────────────
-- Primary evidence for switching the legacy-client flag off (plan 12.14 item 4, 12.15 items 3-4). occurred_at is
-- TIMESTAMPTZ(6) and legacy_client_at on the entity is too: both are written from the same now(), so the "same instant"
-- reconciliation query can compare them with =.
CREATE TABLE "legacy_compat_events" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "outcome" "LegacyCompatOutcome" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" "LegacyCompatEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "flow_header" TEXT,
    "client_header" TEXT,

    CONSTRAINT "legacy_compat_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "legacy_compat_events_occurred_at_idx" ON "legacy_compat_events"("occurred_at");
CREATE INDEX "legacy_compat_events_outcome_occurred_at_idx" ON "legacy_compat_events"("outcome", "occurred_at");
CREATE INDEX "legacy_compat_events_entity_type_entity_id_idx" ON "legacy_compat_events"("entity_type", "entity_id");

CREATE TABLE "compat_writer_heartbeats" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "git_sha" TEXT,
    "writer_version" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compat_writer_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compat_writer_heartbeats_writer_version_seen_at_idx" ON "compat_writer_heartbeats"("writer_version", "seen_at");
CREATE INDEX "compat_writer_heartbeats_instance_id_seen_at_idx" ON "compat_writer_heartbeats"("instance_id", "seen_at");

-- Same shape as user-service's client_compat_events (best-effort telemetry of old-client traffic on retired routes).
CREATE TABLE "client_compat_events" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "client_header" TEXT,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_compat_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_compat_events_created_at_idx" ON "client_compat_events"("created_at");
CREATE INDEX "client_compat_events_outcome_created_at_idx" ON "client_compat_events"("outcome", "created_at");

-- Audit of catalogue operations (no partner_id exists for them, so PartnerAuditLog does not fit). No foreign keys on
-- purpose: an audit row outlives whatever it describes.
CREATE TABLE "amenity_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amenity_id" TEXT,
    "proposal_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenity_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "amenity_audit_logs_amenity_id_created_at_idx" ON "amenity_audit_logs"("amenity_id", "created_at");
CREATE INDEX "amenity_audit_logs_actor_user_id_created_at_idx" ON "amenity_audit_logs"("actor_user_id", "created_at");

-- ── 8. Verification (plan 12.15 item 5) ─────────────────────────────────────────────────────
-- Any failure aborts the whole migration; the ON COMMIT DROP temp tables vanish with the transaction.
DO $$
DECLARE
  v_missing   text;
  v_missing_n bigint; v_missing_s text;
  v_extra_n   bigint; v_extra_s   text;
BEGIN
  -- (1) Mỗi giá trị enum có đúng một dòng amenities cùng slug
  SELECT string_agg(e::text, ', ' ORDER BY e::text) INTO v_missing
    FROM unnest(enum_range(NULL::"GymFacility")) AS e
   WHERE (SELECT count(*) FROM amenities a WHERE a.slug = e::text) <> 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'GymFacility chưa có đúng 1 amenity tương ứng: %', v_missing;
  END IF;

  -- (2) So HAI CHIỀU tập cặp (gym_id, amenity_id) mong đợi với thực tế — không chỉ so số lượng
  CREATE TEMP TABLE _expected_pairs ON COMMIT DROP AS
    SELECT DISTINCT g.id AS gym_id, a.id AS amenity_id
      FROM gyms g
      CROSS JOIN LATERAL unnest(g.facilities) AS f
      JOIN amenities a ON a.slug = f::text;

  CREATE TEMP TABLE _missing_pairs ON COMMIT DROP AS
    SELECT gym_id, amenity_id FROM _expected_pairs
    EXCEPT SELECT gym_id, amenity_id FROM gym_amenities;  -- thiếu
  CREATE TEMP TABLE _extra_pairs ON COMMIT DROP AS
    SELECT gym_id, amenity_id FROM gym_amenities
    EXCEPT SELECT gym_id, amenity_id FROM _expected_pairs; -- thừa

  -- Số lượng: đếm trên TOÀN BỘ tập (không giới hạn)
  SELECT count(*) INTO v_missing_n FROM _missing_pairs;
  SELECT count(*) INTO v_extra_n   FROM _extra_pairs;
  -- Ví dụ: lấy riêng, tối đa 20, chỉ để in ra
  SELECT string_agg(gym_id || ':' || amenity_id, ', ') INTO v_missing_s
    FROM (SELECT * FROM _missing_pairs ORDER BY 1, 2 LIMIT 20) s;
  SELECT string_agg(gym_id || ':' || amenity_id, ', ') INTO v_extra_s
    FROM (SELECT * FROM _extra_pairs ORDER BY 1, 2 LIMIT 20) s;
  IF v_missing_n > 0 OR v_extra_n > 0 THEN
    RAISE EXCEPTION 'gym_amenities lệch facilities — thiếu % (vd: %), thừa % (vd: %)',
      v_missing_n, v_missing_s, v_extra_n, v_extra_s;
  END IF;
END $$;

-- ── 9. Compat-writer triggers (created LAST: the backfill above must not log events) ────────
-- Code that writes gyms / gym_partners runs `SET LOCAL gymini.compat_writer = 'v1'` inside the same transaction
-- (withCompatWriter). Anything else leaves a trace written by the database itself:
--   'v1'                          -> nothing
--   'seed' | 'maintenance'        -> NON_CLIENT (not an old client)
--   empty / unset / anything else -> WRITER_ABSENT (old code, a not-yet-updated instance, a hand-run script)
CREATE FUNCTION "legacy_compat_writer_guard"() RETURNS trigger AS $$
DECLARE
    v_writer  text := coalesce(current_setting('gymini.compat_writer', true), '');
    v_outcome "LegacyCompatOutcome";
BEGIN
    IF v_writer = 'v1' THEN
        RETURN NULL;
    END IF;
    IF v_writer IN ('seed', 'maintenance') THEN
        v_outcome := 'NON_CLIENT';
    ELSE
        v_outcome := 'WRITER_ABSENT';
    END IF;
    INSERT INTO "legacy_compat_events" ("id", "outcome", "action", "entity_type", "entity_id")
    VALUES (
        gen_random_uuid()::text,
        v_outcome,
        TG_OP,
        CASE TG_TABLE_NAME WHEN 'gyms' THEN 'GYM'::"LegacyCompatEntityType" ELSE 'GYM_PARTNER'::"LegacyCompatEntityType" END,
        NEW."id"
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gyms_compat_writer_guard"
    AFTER INSERT OR UPDATE ON "gyms"
    FOR EACH ROW EXECUTE FUNCTION "legacy_compat_writer_guard"();

CREATE TRIGGER "gym_partners_compat_writer_guard"
    AFTER INSERT OR UPDATE ON "gym_partners"
    FOR EACH ROW EXECUTE FUNCTION "legacy_compat_writer_guard"();
