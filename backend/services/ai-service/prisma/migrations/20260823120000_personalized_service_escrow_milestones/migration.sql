-- P1-FIN-001/002: milestone-release audit/idempotency-guard fields.
-- Purely additive (nullable), no data migration needed.
ALTER TABLE "personalized_service_orders" ADD COLUMN     "milestone_intake_released_at" TIMESTAMP(3),
ADD COLUMN     "milestone_draft_released_at" TIMESTAMP(3),
ADD COLUMN     "milestone_accepted_released_at" TIMESTAMP(3),
ADD COLUMN     "milestone_completed_released_at" TIMESTAMP(3);
