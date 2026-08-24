-- Rollback for 20260819030000_add_import_batch_tracking.
-- Safe by construction at the time this is written: these tables only
-- ever hold import-run AUDIT data (not user data) — dropping them loses
-- the history of past import runs, never any user-facing data. If real
-- imports have run since, back up import_batches/import_records first if
-- that audit trail matters to keep.
DROP TABLE IF EXISTS "import_records";
DROP TABLE IF EXISTS "import_batches";
