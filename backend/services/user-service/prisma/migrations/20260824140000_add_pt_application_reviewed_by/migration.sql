-- Money-flow plan 5.5: record WHO reviewed/approved/rejected a PT application, not just when.
ALTER TABLE "pt_applications" ADD COLUMN "reviewed_by_user_id" TEXT;
