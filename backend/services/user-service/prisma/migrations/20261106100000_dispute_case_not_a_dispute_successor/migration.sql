-- E2 (06/11/2026). ADDITIVE ONLY: one nullable column and one partial unique index. A session whose Case was CLOSED as NOT_A_DISPUTE (the session stays DISPUTED, its money stands still) may get
-- ONE new Case through the normal open-case path. `previous_case_id` is the audited link from the new case to the case it follows; the unique index lets a closed case have at most ONE successor
-- (no loop). Which closures allow a successor, and that only ONE is allowed per session, is the open-case rule in dispute-case.service.ts.
ALTER TABLE "dispute_cases" ADD COLUMN "previous_case_id" UUID;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_previous_case_fkey" FOREIGN KEY ("previous_case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_previous_not_self" CHECK ("previous_case_id" IS NULL OR "previous_case_id" <> "id");
CREATE UNIQUE INDEX "dispute_cases_one_successor" ON "dispute_cases"("previous_case_id") WHERE "previous_case_id" IS NOT NULL;
