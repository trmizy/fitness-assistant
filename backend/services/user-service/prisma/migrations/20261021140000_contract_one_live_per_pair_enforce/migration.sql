-- BR-27 backstop, enforcement step: at most one live PT-client contract per (pt, client) pair.
--
-- WHY A NEW MIGRATION: 20261021130000_contract_one_live_per_pair is already applied on some databases and, when
-- it met duplicate live pairs, it SKIPPED the unique index with only a NOTICE - a deploy that "succeeds" with the
-- guard missing. An applied migration must not be edited (Prisma records its checksum), so this one finishes the job:
--
--   * index already installed            -> nothing to do (the normal case);
--   * index missing, no duplicate pairs  -> create it;
--   * index missing, duplicate pairs     -> RAISE EXCEPTION. The migration FAILS, `prisma migrate deploy` stops, and the
--                                          deploy is not allowed to go on without the guard. Nothing is changed or deleted.
--
-- A database that is already clean, or that already has the index, passes straight through.
--
-- If this migration fails on a database:
--   1. run   tsx src/scripts/contract-duplicate-pair-preflight.ts   (read-only; lists the duplicate pairs by contract id,
--      no personal data) and follow the remediation procedure in that script's header (owner approval per pair;
--      contracts and transactions are never deleted);
--   2. once the script exits 0, mark the failed attempt as rolled back:
--        prisma migrate resolve --rolled-back 20261021140000_contract_one_live_per_pair_enforce
--   3. run   prisma migrate deploy   again.
--
-- Lock note: CREATE UNIQUE INDEX (non-concurrent) holds a SHARE lock on "contracts" while it builds - writes to that
-- table wait for the duration (milliseconds on current data volumes). Run the deploy in a low-traffic moment.
DO $$
DECLARE
  dup_pairs integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'contracts_one_live_per_pair'
  ) THEN
    RAISE NOTICE 'contracts_one_live_per_pair already installed - nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) INTO dup_pairs FROM (
    SELECT 1
    FROM "contracts"
    WHERE "status" IN ('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')
      AND "source" <> 'MARKETPLACE'
    GROUP BY "pt_user_id", "client_user_id"
    HAVING count(*) > 1
  ) d;

  IF dup_pairs > 0 THEN
    RAISE EXCEPTION 'MIGRATION BLOCKED: % PT-client pair(s) have more than one live contract, so the unique index contracts_one_live_per_pair cannot be created. Nothing was changed. Run "tsx src/scripts/contract-duplicate-pair-preflight.ts" (read-only) to list them, resolve each pair with owner approval (never delete contracts or transactions - see the script header), then run "prisma migrate resolve --rolled-back 20261021140000_contract_one_live_per_pair_enforce" and "prisma migrate deploy" again.', dup_pairs
      USING ERRCODE = 'unique_violation';
  END IF;

  CREATE UNIQUE INDEX "contracts_one_live_per_pair"
    ON "contracts" ("pt_user_id", "client_user_id")
    WHERE "status" IN ('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')
      AND "source" <> 'MARKETPLACE';
END
$$;
