-- Covering & partial discovery indexes for scale gym search (eliminates full-table gym_reviews heap fetches).
-- Additive only: preserves all existing rows, member_code generated column, and complaint-case partial indexes.

CREATE INDEX IF NOT EXISTS "gym_reviews_gym_id_rating_idx"
  ON "gym_reviews"("gym_id", "rating");

CREATE INDEX IF NOT EXISTS "gyms_public_open_geo_idx"
  ON "gyms"("latitude", "longitude") INCLUDE ("id", "brand_id", "owner_id")
  WHERE "status" = 'APPROVED'::"GymStatus" AND "operational_status" = 'OPEN'::"GymOperationalStatus";

CREATE INDEX IF NOT EXISTS "gyms_public_open_province_idx"
  ON "gyms"("province_code") INCLUDE ("id", "brand_id", "owner_id")
  WHERE "status" = 'APPROVED'::"GymStatus" AND "operational_status" = 'OPEN'::"GymOperationalStatus";

CREATE INDEX IF NOT EXISTS "gym_membership_plans_active_brand_price_idx"
  ON "gym_membership_plans"("brand_id", "price") INCLUDE ("sale_start_at", "sale_end_at")
  WHERE "status" = 'ACTIVE'::"GymMembershipPlanStatus";

CREATE INDEX IF NOT EXISTS "gym_photos_published_lookup_idx"
  ON "gym_photos"("gym_id", "is_cover" DESC, "sort_order" ASC, "created_at" ASC, "id" ASC)
  WHERE "status" = 'PUBLISHED'::"GymPhotoStatus";
