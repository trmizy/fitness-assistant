-- Migration X (gym-service): mark whether a gym branch is REAL or SYNTHETIC (seed scale).
-- Enum "DataOrigin" already exists from migration 20261111100000_gym_search_indexes_and_data_origin.

ALTER TABLE "gyms"
  ADD COLUMN "data_origin" "DataOrigin" NOT NULL DEFAULT 'REAL';
