-- Add missing columns to contracts
ALTER TABLE "contracts" ADD COLUMN "package_quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contracts" ADD COLUMN "extra_sessions" INTEGER NOT NULL DEFAULT 0;

-- Add missing columns to user_profiles
ALTER TABLE "user_profiles" ADD COLUMN "session_duration_minutes" INTEGER NOT NULL DEFAULT 60;

-- Add missing columns to pt_applications
ALTER TABLE "pt_applications" ADD COLUMN "sessions_per_package" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "pt_applications" ADD COLUMN "session_duration_minutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "pt_applications" ADD COLUMN "availability_blocks" JSONB;
