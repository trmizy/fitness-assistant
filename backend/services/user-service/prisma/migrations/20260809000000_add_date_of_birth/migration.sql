-- Migration: add date_of_birth column to user_profiles
-- age column is retained for AI-service compatibility and will be derived from date_of_birth
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;
