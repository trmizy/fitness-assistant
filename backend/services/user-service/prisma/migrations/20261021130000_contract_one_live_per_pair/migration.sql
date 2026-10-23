-- BR-27 backstop: at most one live PT-client contract per (pt, client) pair.
--
-- The application serialises contract creation per pair (advisory lock + re-check in the create transaction,
-- contract.service.ts requestContract). This index is the last-resort guarantee if some other writer ever skips that.
--
-- Additive and safe on a database that already holds data:
--   * partial: only the live statuses count (PENDING_REVIEW, PENDING_SIGNATURE, PENDING_PAYMENT, ACTIVE), so
--     COMPLETED / EXPIRED / CANCELLED / REJECTED history never conflicts;
--   * MARKETPLACE contracts are exempt (a client may buy more than one personalized service from one PT, and each
--     order owns a contract; ai-service checks for a standing PT contract before the checkout instead);
--   * if the table already contains duplicate live pairs (created before this guard existed) the index is NOT
--     created and the migration still succeeds - it raises a NOTICE listing how many pairs need an admin's attention.
--     Nothing is deleted or changed. Once they are resolved, re-running the CREATE statement below installs the index.
DO $$
DECLARE
  dup_pairs integer;
BEGIN
  SELECT count(*) INTO dup_pairs FROM (
    SELECT 1
    FROM "contracts"
    WHERE "status" IN ('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')
      AND "source" <> 'MARKETPLACE'
    GROUP BY "pt_user_id", "client_user_id"
    HAVING count(*) > 1
  ) d;

  IF dup_pairs > 0 THEN
    RAISE NOTICE 'contracts_one_live_per_pair NOT created: % PT-client pair(s) already have more than one live contract. Resolve them, then run the CREATE UNIQUE INDEX statement from this migration.', dup_pairs;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "contracts_one_live_per_pair"
      ON "contracts" ("pt_user_id", "client_user_id")
      WHERE "status" IN ('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')
        AND "source" <> 'MARKETPLACE';
  END IF;
END
$$;
