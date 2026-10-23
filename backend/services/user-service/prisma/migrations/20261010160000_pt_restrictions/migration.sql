-- PT-suspension slices 2-3: the restriction HISTORY (one row per episode) plus the record of what a
-- lifted episode added to each contract's end date. Purely additive: two enums + two new tables +
-- one new enum for end kinds; no existing column is changed. See PtRestriction in schema.prisma.
--
-- Hand-written, applied with `prisma migrate deploy` only (never `migrate dev`, which would try to
-- drop the partial unique index below because the Prisma schema DSL cannot express it).

CREATE TYPE "PtRestrictionType" AS ENUM ('TEMPORARY_SUSPENSION', 'PERMANENT_BAN');

CREATE TYPE "PtRestrictionReasonCategory" AS ENUM (
    'COMPLAINT_REVIEW',
    'CONDUCT_REVIEW',
    'PAYMENT_REVIEW',
    'DOCUMENT_VERIFICATION',
    'ACCOUNT_SECURITY',
    'OTHER',
    'UNSPECIFIED'
);

CREATE TYPE "PtRestrictionEndKind" AS ENUM ('LIFTED', 'CONVERTED_TO_PERMANENT');

CREATE TABLE "pt_restrictions" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "type" "PtRestrictionType" NOT NULL,
    "reason_category" "PtRestrictionReasonCategory" NOT NULL DEFAULT 'UNSPECIFIED',
    "reason_text" TEXT,
    "public_reason" TEXT,
    "imposed_by" TEXT NOT NULL,
    "lock_seq" BIGINT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_kind" "PtRestrictionEndKind",
    "lifted_by" TEXT,
    "lift_reason" TEXT,
    "last_justified_at" TIMESTAMP(3),
    "last_justified_by" TEXT,
    "last_justification" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pt_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_restrictions_pt_user_id_started_at_idx" ON "pt_restrictions"("pt_user_id", "started_at");

-- At most ONE active episode per PT: the invariant every "impose" / "lift" / "convert" relies on.
-- A second concurrent INSERT for the same PT fails with a unique violation instead of producing two
-- active episodes; the service turns that into the idempotent no-op / conflict answer.
CREATE UNIQUE INDEX "pt_restrictions_one_active_per_pt" ON "pt_restrictions"("pt_user_id") WHERE "ended_at" IS NULL;

CREATE TABLE "pt_restriction_contract_extensions" (
    "id" TEXT NOT NULL,
    "restriction_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "blocked_ms" BIGINT NOT NULL,
    "previous_end_date" TIMESTAMP(3) NOT NULL,
    "new_end_date" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pt_restriction_contract_extensions_pkey" PRIMARY KEY ("id")
);

-- Idempotency guard: one extension per (episode, contract), so a repeated lift can never extend twice.
-- Explicit SHORT name (schema: @@unique(..., map: "pt_restriction_ext_restriction_contract_key")): the Prisma default name would be
-- 65 characters, Postgres silently truncates identifiers to 63, and `prisma migrate diff` would then report a phantom RenameIndex.
CREATE UNIQUE INDEX "pt_restriction_ext_restriction_contract_key"
    ON "pt_restriction_contract_extensions"("restriction_id", "contract_id");

CREATE INDEX "pt_restriction_contract_extensions_contract_id_idx" ON "pt_restriction_contract_extensions"("contract_id");

ALTER TABLE "pt_restriction_contract_extensions"
    ADD CONSTRAINT "pt_restriction_contract_extensions_restriction_id_fkey"
    FOREIGN KEY ("restriction_id") REFERENCES "pt_restrictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a PT locked before this migration has pt_suspended = true but no episode. Give each one a
-- PERMANENT_BAN episode so the history is complete and the flag and the record agree from the start
-- (the lock flow before this migration was always, in effect, the permanent ban). started_at is the
-- profile's last update (user_profiles keeps its camelCase "userId"/"updatedAt" columns — the table predates the snake_case @map convention) — the best available approximation of when the lock happened.
INSERT INTO "pt_restrictions" ("id", "pt_user_id", "type", "reason_category", "reason_text", "imposed_by", "started_at", "updated_at")
SELECT gen_random_uuid()::text, "userId", 'PERMANENT_BAN', 'UNSPECIFIED', 'Backfilled: locked before restriction history existed', 'SYSTEM', "updatedAt", CURRENT_TIMESTAMP
FROM "user_profiles"
WHERE "pt_suspended" = true;
