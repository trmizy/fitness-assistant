-- Vòng 4 / Phase E2 — the client's own right to terminate a contract after a 3rd confirmed PT
-- no-show (full refund of remaining value, same formula as PT_BANNED/MUTUAL).
ALTER TYPE "TerminationReason" ADD VALUE 'PT_REPEATED_NO_SHOW';
