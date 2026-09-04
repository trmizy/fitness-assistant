-- P0 cluster C2/C3 — split into its own migration: Postgres will not let a newly-added enum
-- value be USED (e.g. as a column DEFAULT) in the same transaction that adds it.
ALTER TYPE "PersonalizedServiceOrderStatus" ADD VALUE 'PENDING_PAYMENT';
