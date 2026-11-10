-- N09C-01 (additive, no row changes). gym-service's complaint-case layer sends in-app notices through POST /internal/notifications with
-- these types, but the enums only had GYM_COMPLAINT_RESOLVED / GYM_COMPLAINT, so every insert was rejected: the MORE_INFO notice never
-- counted as delivered (DEADLINE_NOT_STARTED) and the SLA / appeal-window / resolution notices were never stored.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_OPENED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_MORE_INFO';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_SLA_WARNING';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_SLA_OVERDUE';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_APPEAL_FILED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE_RESOLVED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_CASE';
