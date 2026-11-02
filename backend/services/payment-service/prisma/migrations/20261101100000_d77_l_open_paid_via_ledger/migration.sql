-- D77 L OPEN settlement (phuong an A, Ngai 01/11/2026). ADDITIVE ONLY: two enum labels, no row changes meaning, nothing is back-filled.
-- PAID_VIA_LEDGER: the obligation was paid to the client by a real ledger entry inside the settlement transaction of the session (never by FH-8, never by hand).
-- SETTLE_VIA_LEDGER: the append-only event that records that payment (actor = the ledger operation key).
ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'PAID_VIA_LEDGER';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'SETTLE_VIA_LEDGER';
