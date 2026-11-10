-- Migration D2 (gym-service): gym discovery indexes and DataOrigin tagging on memberships & reviews.
-- Additive only: preserves member_code generated column and all complaint-case partial unique indexes.
-- Note: gym_reviews_gym_id_idx already exists from 20260718000001_add_gym_checkins_and_reviews.

CREATE TYPE "DataOrigin" AS ENUM ('REAL', 'SYNTHETIC');

ALTER TABLE "gym_membership_contracts"
  ADD COLUMN "data_origin" "DataOrigin" NOT NULL DEFAULT 'REAL';

ALTER TABLE "gym_reviews"
  ADD COLUMN "data_origin" "DataOrigin" NOT NULL DEFAULT 'REAL';

CREATE INDEX "gym_membership_contracts_data_origin_status_idx"
  ON "gym_membership_contracts"("data_origin", "status");

CREATE INDEX "gyms_status_operational_status_idx"
  ON "gyms"("status", "operational_status");

CREATE INDEX "gyms_latitude_longitude_idx"
  ON "gyms"("latitude", "longitude");

CREATE INDEX "gyms_province_code_ward_code_idx"
  ON "gyms"("province_code", "ward_code");

