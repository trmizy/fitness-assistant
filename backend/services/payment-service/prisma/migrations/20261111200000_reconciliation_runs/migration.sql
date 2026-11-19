-- G-06 (11/11/2026). ADDITIVE ONLY: one new table, one index. No existing table, column, enum or row is touched.
-- reconciliation_runs: append-only history of the wallet invariant check (ESCROW = sum of claims).
--   trigger        ADMIN (an admin opened the balance view) | JOB (the 5-minute reconciliation job)
--   triggered_by   the admin user id for ADMIN runs, NULL for JOB
--   status         BALANCED | DRIFT | ERROR (ERROR rows carry error_code and NULL amounts)
--   summary        whitelisted figures only (breakdown strings, counts); no PII, no raw rows
CREATE TABLE "reconciliation_runs" (
    "id"             TEXT NOT NULL,
    "started_at"     TIMESTAMP(3) NOT NULL,
    "finished_at"    TIMESTAMP(3),
    "trigger"        TEXT NOT NULL,
    "triggered_by"   TEXT,
    "status"         TEXT NOT NULL,
    "escrow_balance" DECIMAL(14,2),
    "claims_total"   DECIMAL(14,2),
    "drift"          DECIMAL(14,2),
    "summary"        JSONB NOT NULL,
    "error_code"     TEXT,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");
