-- Dispute V2.1 backend completion (track core). ADDITIVE only.
-- 1) Case lifecycle notices: one new event type + one new entity type (PostgreSQL >= 12 allows ADD VALUE inside the migration transaction as long as the
--    new values are not used in the same transaction; same pattern as 20261023120000_gym_partner_application_rejected_notification).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'DISPUTE_CASE_UPDATED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'DISPUTE_CASE';

-- 2) Why a case was closed without a decision (status stays REJECTED_INTAKE, which every existing "open case" filter and the one-open-case-per-session
--    index already treat as terminal). Nullable text, no default: existing rows are untouched.
ALTER TABLE "dispute_cases" ADD COLUMN "close_reason" TEXT;
