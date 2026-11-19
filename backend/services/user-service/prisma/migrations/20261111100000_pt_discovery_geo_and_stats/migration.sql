-- Migration D1 (user-service): PT discovery search region, training-location lat/lng,
-- vietnam_ward_geo (no polygons), pt_discovery_epochs/pt_discovery_stats, and discovery indexes.
-- Additive only: preserves all existing rows, contracts_one_live_per_pair, and dispute-case indexes.

-- 1. UserProfile search region columns (nullable Integer, app-validated, no FK)
ALTER TABLE "user_profiles"
  ADD COLUMN "search_province_code" INTEGER,
  ADD COLUMN "search_ward_code" INTEGER;

-- 2. PTTrainingLocation coordinates + missing discovery indexes
ALTER TABLE "pt_training_locations"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE INDEX "pt_training_locations_latitude_longitude_idx"
  ON "pt_training_locations"("latitude", "longitude");

CREATE INDEX "pt_training_locations_province_code_ward_code_is_active_idx"
  ON "pt_training_locations"("province_code", "ward_code", "is_active");

-- 3. Ward centroids & bounding boxes (never stores polygons)
CREATE TABLE "vietnam_ward_geo" (
    "ward_code" INTEGER NOT NULL,
    "province_code" INTEGER NOT NULL,
    "centroid_lat" DOUBLE PRECISION NOT NULL,
    "centroid_lng" DOUBLE PRECISION NOT NULL,
    "min_lat" DOUBLE PRECISION NOT NULL,
    "max_lat" DOUBLE PRECISION NOT NULL,
    "min_lng" DOUBLE PRECISION NOT NULL,
    "max_lng" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'vietnamese-provinces-db-v5.2.0',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vietnam_ward_geo_pkey" PRIMARY KEY ("ward_code")
);

CREATE INDEX "vietnam_ward_geo_province_code_idx" ON "vietnam_ward_geo"("province_code");

ALTER TABLE "vietnam_ward_geo"
  ADD CONSTRAINT "vietnam_ward_geo_ward_code_fkey"
  FOREIGN KEY ("ward_code") REFERENCES "vietnam_wards"("code") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vietnam_ward_geo"
  ADD CONSTRAINT "vietnam_ward_geo_province_code_fkey"
  FOREIGN KEY ("province_code") REFERENCES "vietnam_provinces"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Epoch-versioned PT discovery stats
CREATE TYPE "PtDiscoveryEpochStatus" AS ENUM ('BUILDING', 'READY');

CREATE TABLE "pt_discovery_epochs" (
    "epoch" SERIAL NOT NULL,
    "status" "PtDiscoveryEpochStatus" NOT NULL DEFAULT 'BUILDING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "pt_discovery_epochs_pkey" PRIMARY KEY ("epoch")
);

-- At most one current epoch at any instant (supports atomic swap).
CREATE UNIQUE INDEX "pt_discovery_epochs_one_current_key"
  ON "pt_discovery_epochs"("is_current") WHERE "is_current" = true;

-- Supports time-based pruning (keep current + READY within 30m, purge stuck BUILDING > 30m).
CREATE INDEX "pt_discovery_epochs_is_current_status_created_at_idx"
  ON "pt_discovery_epochs"("is_current", "status", "created_at");

CREATE TABLE "pt_discovery_stats" (
    "epoch" INTEGER NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "rating_avg" DOUBLE PRECISION,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "bayes_rating" DOUBLE PRECISION NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL,
    "available_hours_7d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accepting" BOOLEAN NOT NULL DEFAULT true,
    "approved_at" TIMESTAMPTZ(3),
    "from_price_overall" DECIMAL(14,2),
    "from_price_online" DECIMAL(14,2),
    "from_price_offline" DECIMAL(14,2),
    "quality" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pt_discovery_stats_pkey" PRIMARY KEY ("epoch","pt_user_id"),
    CONSTRAINT "pt_discovery_stats_completeness_chk" CHECK ("completeness" >= 0 AND "completeness" <= 1),
    CONSTRAINT "pt_discovery_stats_quality_chk" CHECK ("quality" >= 0 AND "quality" <= 1)
);

CREATE INDEX "pt_discovery_stats_epoch_quality_pt_user_id_idx"
  ON "pt_discovery_stats"("epoch", "quality" DESC, "pt_user_id" ASC);

CREATE INDEX "pt_discovery_stats_epoch_bayes_rating_pt_user_id_idx"
  ON "pt_discovery_stats"("epoch", "bayes_rating" DESC, "pt_user_id" ASC);

CREATE INDEX "pt_discovery_stats_epoch_rating_desc_idx"
  ON "pt_discovery_stats"("epoch", "rating_avg" DESC NULLS LAST, "pt_user_id" ASC);

CREATE INDEX "pt_discovery_stats_epoch_from_price_overall_pt_user_id_idx"
  ON "pt_discovery_stats"("epoch", "from_price_overall" ASC, "pt_user_id" ASC);

CREATE INDEX "pt_discovery_stats_epoch_from_price_online_pt_user_id_idx"
  ON "pt_discovery_stats"("epoch", "from_price_online" ASC, "pt_user_id" ASC);

CREATE INDEX "pt_discovery_stats_epoch_from_price_offline_pt_user_id_idx"
  ON "pt_discovery_stats"("epoch", "from_price_offline" ASC, "pt_user_id" ASC);

ALTER TABLE "pt_discovery_stats"
  ADD CONSTRAINT "pt_discovery_stats_epoch_fkey"
  FOREIGN KEY ("epoch") REFERENCES "pt_discovery_epochs"("epoch") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pt_discovery_stats"
  ADD CONSTRAINT "pt_discovery_stats_pt_user_id_fkey"
  FOREIGN KEY ("pt_user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Missing discovery indexes on user_profiles, pt_applications, and pt_service_packages
CREATE INDEX "user_profiles_active_pt_idx"
  ON "user_profiles"("is_accepting_clients" DESC, "createdAt" DESC, "userId" ASC)
  WHERE "isPT" = true AND "pt_suspended" = false;

CREATE INDEX "user_profiles_specialties_gin_idx"
  ON "user_profiles" USING GIN ("specialties");

CREATE INDEX "pt_applications_status_service_mode_idx"
  ON "pt_applications"("status", "service_mode");

CREATE INDEX "pt_service_packages_pt_user_id_session_mode_is_active_idx"
  ON "pt_service_packages"("pt_user_id", "session_mode", "is_active");

