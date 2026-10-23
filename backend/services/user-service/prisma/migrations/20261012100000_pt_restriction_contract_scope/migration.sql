-- PT restriction, CONTRACT scope (owner's decision D38, Phase 2.5A): a restriction can now apply to ONE
-- contract instead of the whole PT. The restriction table is extended (no second table): a `scope`
-- column + a nullable `contract_id`, and the "one active episode per PT" rule is split in two:
--   · one active ACCOUNT-scope episode (temporary suspension OR permanent ban) per PT, and
--   · one active CONTRACT-scope episode per contract.
-- Every existing row becomes ACCOUNT scope (the column default), so nothing already restricted changes meaning.
-- user_profiles.pt_suspended stays the mirror of ACCOUNT-scope episodes only (written by the service).
--
-- Additive except for swapping the one partial unique index. Hand-written, applied with
-- `prisma migrate deploy` only (never `migrate dev`: the Prisma schema DSL cannot express these indexes).

CREATE TYPE "PtRestrictionScope" AS ENUM ('ACCOUNT', 'CONTRACT');

ALTER TYPE "PtRestrictionEndKind" ADD VALUE IF NOT EXISTS 'SCOPE_RAISED';
ALTER TYPE "PtRestrictionEndKind" ADD VALUE IF NOT EXISTS 'SCOPE_NARROWED';
ALTER TYPE "PtRestrictionEndKind" ADD VALUE IF NOT EXISTS 'CONTRACT_ENDED';

ALTER TABLE "pt_restrictions"
    ADD COLUMN "scope" "PtRestrictionScope" NOT NULL DEFAULT 'ACCOUNT',
    ADD COLUMN "contract_id" TEXT,
    ADD COLUMN "supersedes_restriction_id" TEXT;

-- A CONTRACT-scope row names its contract; an ACCOUNT-scope row never does; a CONTRACT-scope row is always
-- a temporary suspension (a permanent ban is the account lock and has no contract-sized version).
ALTER TABLE "pt_restrictions"
    ADD CONSTRAINT "pt_restrictions_scope_contract_check"
    CHECK (("scope" = 'CONTRACT') = ("contract_id" IS NOT NULL)),
    ADD CONSTRAINT "pt_restrictions_contract_scope_is_temporary_check"
    CHECK ("scope" = 'ACCOUNT' OR "type" = 'TEMPORARY_SUSPENSION');

-- ON DELETE RESTRICT (not CASCADE): a restriction episode is audit history (who was suspended, why, for how long). Deleting a
-- contract must NOT silently erase it - it fails with a foreign-key violation instead, so the history has to be dealt with on purpose.
-- (SET NULL is not an option: the CHECK above says a CONTRACT-scope row always names its contract.) No product code deletes contracts.
ALTER TABLE "pt_restrictions"
    ADD CONSTRAINT "pt_restrictions_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "pt_restrictions_contract_id_idx" ON "pt_restrictions"("contract_id");

-- The invariant moves from "one active episode per PT" to the two rules above. A second concurrent INSERT
-- for the same PT (account scope) or the same contract (contract scope) fails with a unique violation.
DROP INDEX IF EXISTS "pt_restrictions_one_active_per_pt";
CREATE UNIQUE INDEX "pt_restrictions_one_active_account_per_pt"
    ON "pt_restrictions"("pt_user_id") WHERE "ended_at" IS NULL AND "scope" = 'ACCOUNT';
CREATE UNIQUE INDEX "pt_restrictions_one_active_per_contract"
    ON "pt_restrictions"("contract_id") WHERE "ended_at" IS NULL AND "scope" = 'CONTRACT';
