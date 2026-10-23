-- Phase 2 / P2.2 (PT QR check-in, D16/D17/D70). Additive: one new table, nothing existing is touched.
-- One row per (branch, PT, local day in Asia/Ho_Chi_Minh); the UNIQUE key is what makes re-scans,
-- concurrent scans and network retries collapse into a single row (INSERT ... ON CONFLICT DO UPDATE).
CREATE TABLE "gym_pt_check_ins" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "pt_user_id" TEXT NOT NULL,
    "local_date" DATE NOT NULL,
    "first_scan_at" TIMESTAMP(3) NOT NULL,
    "last_scan_at" TIMESTAMP(3) NOT NULL,
    "scan_count" INTEGER NOT NULL DEFAULT 1,
    "qualifying_session_ids" TEXT[],
    "contract_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_pt_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gym_pt_check_ins_gym_pt_date_key" ON "gym_pt_check_ins"("gym_id", "pt_user_id", "local_date");
CREATE INDEX "gym_pt_check_ins_gym_date_idx" ON "gym_pt_check_ins"("gym_id", "local_date");
CREATE INDEX "gym_pt_check_ins_pt_date_idx" ON "gym_pt_check_ins"("pt_user_id", "local_date");
