-- Gate 5 of the exercise/anatomy/nutrition data-expansion roadmap.
-- ADDITIVE ONLY — two brand-new tables, no existing table touched.

CREATE TABLE IF NOT EXISTS "import_batches" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "source_version" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "review_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "checksum" TEXT,
  CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_batches_source_started_at_idx" ON "import_batches"("source", "started_at");

CREATE TABLE IF NOT EXISTS "import_records" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "external_ref" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "target_table" TEXT,
  "target_id" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_records_batch_id_idx" ON "import_records"("batch_id");
CREATE INDEX IF NOT EXISTS "import_records_batch_id_decision_idx" ON "import_records"("batch_id", "decision");

DO $$ BEGIN
  ALTER TABLE "import_records" ADD CONSTRAINT "import_records_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
