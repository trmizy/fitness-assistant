-- Money-flow redesign plan 4.3: client reports a PT no-show. Reuses disputeReason/disputedAt/
-- ptNotes (already added for the client-confirmation flow) — no new columns needed.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'PT_NO_SHOW_REPORTED';
