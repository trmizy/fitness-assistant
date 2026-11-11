-- Partial & covering discovery indexes for scale PT search (eliminates repeated heap fetches and subplan seq-scans).
-- Additive only: preserves all existing data, constraints, and partial unique indexes.

CREATE INDEX IF NOT EXISTS "user_profiles_active_pt_lookup_idx"
  ON "user_profiles"("userId") INCLUDE ("id", "is_accepting_clients", "firstName")
  WHERE "isPT" = true AND "pt_suspended" = false;

CREATE INDEX IF NOT EXISTS "pt_applications_approved_profile_mode_idx"
  ON "pt_applications"("user_profile_id", "service_mode")
  WHERE "status" = 'APPROVED'::"PTApplicationStatus";

CREATE INDEX IF NOT EXISTS "pt_service_packages_for_sale_pt_mode_idx"
  ON "pt_service_packages"("pt_user_id", "session_mode")
  WHERE "is_active" = true AND "archived_at" IS NULL AND "session_count" >= 1 AND "price" > 0;

CREATE INDEX IF NOT EXISTS "pt_training_locations_active_pt_prov_idx"
  ON "pt_training_locations"("pt_user_id", "province_code")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "pt_training_locations_active_prov_pt_idx"
  ON "pt_training_locations"("province_code", "pt_user_id")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "pt_training_locations_active_lat_lng_idx"
  ON "pt_training_locations"("latitude", "longitude") INCLUDE ("pt_user_id", "ward_code")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "pt_discovery_stats_epoch_pt_cover_idx"
  ON "pt_discovery_stats"("epoch", "pt_user_id")
  INCLUDE ("quality", "rating_avg", "from_price_overall", "from_price_online", "from_price_offline");
