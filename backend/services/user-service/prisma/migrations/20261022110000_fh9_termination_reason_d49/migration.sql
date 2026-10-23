-- FH-9 / D49: the platform's own reason for ending a service (a permanent PT ban ...). Additive and ONLY the ALTER TYPE statement:
-- Postgres will not let a freshly added enum value be used in the transaction that added it. Precedent: 20261010170000_client_exit_termination_reason.
ALTER TYPE "TerminationReason" ADD VALUE IF NOT EXISTS 'SERVICE_DISCONTINUED_BY_PLATFORM';
