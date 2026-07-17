-- Add ZALOPAY and PAYOS to the payment provider enum (multi-gateway support).
-- PG 12+ allows ALTER TYPE ... ADD VALUE inside a transaction; the new labels are
-- only referenced by later migrations/runtime, never within this one.
ALTER TYPE "PaymentProviderType" ADD VALUE IF NOT EXISTS 'ZALOPAY';
ALTER TYPE "PaymentProviderType" ADD VALUE IF NOT EXISTS 'PAYOS';
