-- D13: remembers that a checkout already extended the payment deadline (nullable, additive; no backfill).
-- Read only when CHECKOUT_EXTENSION_ONCE=true; written by the first extension that really moves payment_due_at.
ALTER TABLE "contracts" ADD COLUMN "payment_deadline_extended_at" TIMESTAMP(3);
