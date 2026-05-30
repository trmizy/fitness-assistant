-- BR-07 enforcement: at most one InBody entry per user per calendar day.
-- Step 1: add the `date_only` column (initially nullable so we can backfill).
ALTER TABLE "inbody_entries" ADD COLUMN "date_only" DATE;

-- Step 2: backfill from the existing timestamp column.
UPDATE "inbody_entries" SET "date_only" = "date"::date;

-- Step 3: clean up legacy duplicates (test-data, prior to BR-07). Keep the row
-- with the LATEST created_at per (user_id, date_only). Without this, the unique
-- index creation would fail.
DELETE FROM "inbody_entries" a
USING   "inbody_entries" b
WHERE   a.user_id   = b.user_id
  AND   a.date_only = b.date_only
  AND   a.created_at < b.created_at;

-- Step 4: enforce NOT NULL now that all rows are backfilled.
ALTER TABLE "inbody_entries" ALTER COLUMN "date_only" SET NOT NULL;

-- Step 5: the unique key.
CREATE UNIQUE INDEX "inbody_entries_user_id_date_only_key"
ON "inbody_entries" ("user_id", "date_only");
