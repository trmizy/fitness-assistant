-- Adds MARKETPLACE as a valid ContractSource — a Contract created from a
-- Marketplace Personalized PT Service purchase (see ContractSource's schema
-- comment). Additive only: existing INDEPENDENT/GYM contracts are untouched.
ALTER TYPE "ContractSource" ADD VALUE 'MARKETPLACE';
