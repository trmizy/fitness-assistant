-- Gate 6/12 of the exercise/anatomy/nutrition data-expansion roadmap.
-- ADDITIVE ONLY — one new nullable-defaulted column + a supporting index.
-- Rule #16 compliance ("không thay đổi kết quả lịch sử chỉ vì catalog
-- được cập nhật"): every one of the 883 pre-existing rows is explicitly
-- backfilled to 'PUBLISHED' below (identical to what DEFAULT would give
-- them anyway, but explicit rather than implied, per this migration's own
-- documentation-as-code convention) — this migration changes NOTHING
-- about which exercises are currently visible; it only gates FUTURE
-- imports (see Gate 5/6/7's importer changes in the same commit).

ALTER TABLE "exercises" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PUBLISHED';

UPDATE "exercises" SET "status" = 'PUBLISHED' WHERE "status" IS NULL OR "status" = '';

CREATE INDEX IF NOT EXISTS "exercises_status_idx" ON "exercises"("status");
