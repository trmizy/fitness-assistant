-- PT-suspension slice 4: the client's no-penalty exit from a contract whose PT is restricted.
-- Additive only, and ONLY the ALTER TYPE statement: Postgres will not let a freshly added enum
-- value be used in the transaction that added it, so nothing here (no UPDATE, no default, no
-- index) may refer to it. The value is first written by application code after this migration.

-- AlterEnum
ALTER TYPE "TerminationReason" ADD VALUE IF NOT EXISTS 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION';
