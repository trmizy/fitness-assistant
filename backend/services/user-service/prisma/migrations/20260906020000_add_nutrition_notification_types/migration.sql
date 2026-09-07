-- AI Nutrition Cycle Engine (Gymini) — new notification types for nutrition
-- plan readiness (spec §XXIV). Additive enum values only.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'NUTRITION_PLAN_READY';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'NUTRITION_PROGRAM';
