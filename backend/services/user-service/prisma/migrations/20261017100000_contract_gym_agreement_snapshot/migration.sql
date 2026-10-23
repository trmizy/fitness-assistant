-- Phase 3, slice P3.2 (decision D66): snapshot which PT-gym agreement a contract's revenue split came from.
-- Four NULLABLE columns on "contracts", exactly like the three rate columns they sit beside: written once when the
-- contract is requested, never refreshed. Purely additive: no backfill (existing contracts stay NULL = "not
-- recorded"), no default, no constraint, no index, no foreign key (the ids point into gym-service's database).
-- Safe to apply to a table with rows; every existing contract behaves exactly as before.
--
--   gym_brand_id          brand of gym_id at request time          (gym-service GymBrand.id)
--   gym_agreement_id      the agreement that produced the rates    (gym-service agreement id)
--   gym_agreement_scope   'BRAND' | 'BRANCH'                       (vocabulary owned by gym-service)
--   gym_membership_id     reserved for the Membership check (P3.3); stays NULL until that slice ships
ALTER TABLE "contracts"
    ADD COLUMN "gym_brand_id" TEXT,
    ADD COLUMN "gym_agreement_id" TEXT,
    ADD COLUMN "gym_agreement_scope" TEXT,
    ADD COLUMN "gym_membership_id" TEXT;
