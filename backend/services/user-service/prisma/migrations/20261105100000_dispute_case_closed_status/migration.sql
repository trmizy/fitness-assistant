-- A5 (Ngai 05/11/2026): a real CLOSED status. Own migration: PostgreSQL cannot USE a new enum value in the transaction that adds it (the next migration uses it).
ALTER TYPE "DisputeCaseStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
