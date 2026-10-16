-- PT-suspension slice 4: the two notices a temporary suspension owes the PT and the PT's clients —
-- "your contract is paused" and "your contract is running again". Additive only, ALTER TYPE
-- statements only (a new enum value cannot be used in the transaction that adds it).

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CONTRACT_PAUSED_PT_SUSPENDED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CONTRACT_RESUMED_PT_REINSTATED';
