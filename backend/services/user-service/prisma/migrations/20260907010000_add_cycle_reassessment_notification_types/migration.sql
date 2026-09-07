-- AI Nutrition Cycle Engine (Gymini) Phase 3 — InBody-triggered
-- reassessment notification. Additive enum values only.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CYCLE_REASSESSMENT_READY';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'TRAINING_CYCLE';
