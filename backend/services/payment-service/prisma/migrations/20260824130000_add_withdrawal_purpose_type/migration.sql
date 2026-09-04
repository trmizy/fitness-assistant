-- Money-flow redesign plan 5.3: markPaid needs a real PaymentTransaction row to satisfy
-- WalletLedgerEntry.transactionId's FK for a withdrawal payout (outbound money has no
-- originating gateway PaymentTransaction to reuse the way REFUND reuses the purchase's).
ALTER TYPE "PurposeType" ADD VALUE 'WITHDRAWAL';
