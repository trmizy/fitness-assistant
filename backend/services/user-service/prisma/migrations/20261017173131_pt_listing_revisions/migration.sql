-- Listing management, phase C1 (user-service foundation). Everything below runs in ONE transaction
-- (Prisma applies a migration file as a single implicit transaction): if any statement fails, nothing here
-- is applied. PostgreSQL >= 12 is required for ALTER TYPE ... ADD VALUE inside a transaction - the new
-- enum values are only ADDED here, never USED, which is the one thing PostgreSQL still forbids in that case.
-- (Existing migrations such as 20261012100000_pt_restriction_contract_scope rely on the same thing.)
--
--   1. enum additions (audit entity, notification event + entity types)
--   2. user_profiles.listing_version / listing_published_at, pt_service_packages.version + backfill
--   3. pt_listing_revisions  (+ one-open-revision-per-PT partial unique index, immutable-history trigger)
--   4. pt_physique_photos    (+ one-published-cover and no-duplicate-file partial unique indexes)
--   5. pt_media_upload_intents, client_compat_events

-- ── 1. Enum additions ───────────────────────────────────────────────────────────────────────
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'PT_LISTING';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_LISTING_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_LISTING_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_LISTING_CHANGES_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_LISTING_INVALIDATED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'PT_LISTING';

-- ── 2. Version columns + backfill ───────────────────────────────────────────────────────────
ALTER TABLE "user_profiles"
    ADD COLUMN "listing_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "listing_published_at" TIMESTAMPTZ(3);

ALTER TABLE "pt_service_packages"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- A PT whose application is APPROVED already HAS a public listing: that approval is listing version 1, published
-- when the application was approved (pt_applications.approved_at is a UTC timestamp without zone). Everyone else
-- stays at 0. Packages keep the default version 1 set above.
UPDATE "user_profiles" AS up
SET "listing_version" = 1,
    "listing_published_at" = pa."approved_at" AT TIME ZONE 'UTC'
FROM "pt_applications" AS pa
WHERE pa."user_profile_id" = up."id"
  AND pa."status" = 'APPROVED'
  AND up."isPT" = true;

-- ── 3. pt_listing_revisions ─────────────────────────────────────────────────────────────────
CREATE TYPE "PtListingRevisionStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'WITHDRAWN', 'STALE');
CREATE TYPE "PtListingRevisionSource" AS ENUM ('OWNER', 'ADMIN_DIRECT');

CREATE TABLE "pt_listing_revisions" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "status" "PtListingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "PtListingRevisionSource" NOT NULL DEFAULT 'OWNER',
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

    CONSTRAINT "pt_listing_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_listing_revisions_pt_user_id_created_at_idx" ON "pt_listing_revisions"("pt_user_id", "created_at");
CREATE INDEX "pt_listing_revisions_status_submitted_at_idx" ON "pt_listing_revisions"("status", "submitted_at");

-- At most ONE open (DRAFT or PENDING) revision per PT. Every state change is a conditional UPDATE, and this index is
-- what makes "two drafts at once" impossible even if two requests race.
CREATE UNIQUE INDEX "pt_listing_revisions_one_open_per_pt"
    ON "pt_listing_revisions"("pt_user_id")
    WHERE "status" IN ('DRAFT', 'PENDING');

-- History is immutable: a closed revision can never be deleted, and the only thing that may still change on it is
-- system_adjustments (a housekeeping job notes what it did) - plus updated_at, which the ORM bumps on every write.
-- Every other column of a closed row must stay exactly what it was. The check looks at the OLD status, so the
-- transition that CLOSES a revision (PENDING -> APPROVED, DRAFT -> WITHDRAWN, ...) is of course allowed.
CREATE FUNCTION "pt_listing_revisions_guard_closed"() RETURNS trigger AS $$
BEGIN
    IF OLD."status" IN ('APPROVED', 'REJECTED', 'WITHDRAWN', 'CHANGES_REQUESTED', 'STALE') THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'pt_listing_revisions: closed revision % (status %) cannot be deleted', OLD."id", OLD."status"
                USING ERRCODE = '23001';
        END IF;
        IF (to_jsonb(NEW) - 'system_adjustments' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'system_adjustments' - 'updated_at') THEN
            RAISE EXCEPTION 'pt_listing_revisions: closed revision % (status %) is immutable', OLD."id", OLD."status"
                USING ERRCODE = '23001';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pt_listing_revisions_immutable"
    BEFORE UPDATE OR DELETE ON "pt_listing_revisions"
    FOR EACH ROW EXECUTE FUNCTION "pt_listing_revisions_guard_closed"();

-- ── 4. pt_physique_photos ───────────────────────────────────────────────────────────────────
CREATE TYPE "PtPhysiquePhotoStatus" AS ENUM ('STAGED', 'PUBLISHED', 'RETIRED', 'DISCARDED');

CREATE TABLE "pt_physique_photos" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "PtPhysiquePhotoStatus" NOT NULL DEFAULT 'STAGED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "content_hash" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pt_physique_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_physique_photos_pt_user_id_status_sort_order_idx" ON "pt_physique_photos"("pt_user_id", "status", "sort_order");

-- At most one PUBLISHED cover per PT: the final guard against two concurrent "set cover" writes.
CREATE UNIQUE INDEX "pt_physique_photos_one_cover"
    ON "pt_physique_photos"("pt_user_id")
    WHERE "is_cover" AND "status" = 'PUBLISHED';

-- The same file (sha256) cannot be staged/published twice for one PT; NULL hashes (legacy rows) are ignored.
CREATE UNIQUE INDEX "pt_physique_photos_unique_hash"
    ON "pt_physique_photos"("pt_user_id", "content_hash")
    WHERE "status" IN ('STAGED', 'PUBLISHED') AND "content_hash" IS NOT NULL;

ALTER TABLE "pt_physique_photos"
    ADD CONSTRAINT "pt_physique_photos_pt_user_id_fkey" FOREIGN KEY ("pt_user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. pt_media_upload_intents, client_compat_events ───────────────────────────────────────
CREATE TYPE "PtMediaUploadIntentStatus" AS ENUM ('PENDING', 'CONFIRMING', 'CONFIRMED', 'REJECTED');

CREATE TABLE "pt_media_upload_intents" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "status" "PtMediaUploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pt_media_upload_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pt_media_upload_intents_object_key_key" ON "pt_media_upload_intents"("object_key");
CREATE INDEX "pt_media_upload_intents_status_expires_at_idx" ON "pt_media_upload_intents"("status", "expires_at");
CREATE INDEX "pt_media_upload_intents_pt_user_id_status_idx" ON "pt_media_upload_intents"("pt_user_id", "status");

ALTER TABLE "pt_media_upload_intents"
    ADD CONSTRAINT "pt_media_upload_intents_pt_user_id_fkey" FOREIGN KEY ("pt_user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

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
