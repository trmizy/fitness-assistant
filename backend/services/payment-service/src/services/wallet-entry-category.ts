/**
 * What a wallet-history row IS, as a stable machine code the apps turn into plain words.
 *
 * The ledger stores only a free-form English `description` ("PERSONALIZED_SERVICE_PURCHASE <uuid> — refund
 * (contract could not be activated)"); the rows carry no structured kind. Rather than make every client re-parse
 * that text (and leak ids and enum names when it fails), the wallet history response adds this derived, additive
 * `category`. It is READ-ONLY presentation data: nothing in the ledger, the idempotency keys or the withdrawal
 * rules reads it, and the descriptions those rules match on ("refund", "compensation") are untouched.
 *
 * Anything not recognised is OTHER_CREDIT / OTHER_DEBIT so an unknown row is still labelled by direction, never
 * by its raw text.
 */

export type WalletEntryCategory =
  // money the client gets back
  | 'REFUND_UNACTIVATED_PERSONALIZED_SERVICE'
  | 'REFUND_UNACTIVATED_MEMBERSHIP'
  | 'REFUND_UNACTIVATED_PT_CONTRACT'
  | 'REFUND_UNACTIVATED_OTHER'
  | 'REFUND_PT_CONTRACT'
  | 'REFUND_PT_SESSION_NOT_DELIVERED'
  | 'REFUND_MEMBERSHIP'
  | 'REFUND_PERSONALIZED_SERVICE'
  | 'REFUND_OTHER'
  | 'COMPENSATION_PT_NO_SHOW'
  | 'COMPENSATION_PT_LATE_ARRIVAL'
  | 'COMPENSATION_PT_FAULT'
  | 'TOPUP'
  // withdrawals
  | 'WITHDRAWAL_LOCKED'
  | 'WITHDRAWAL_RESTORED'
  | 'WITHDRAWAL_PAID'
  // partner (PT) earnings
  | 'EARNING_HELD'
  | 'EARNING_RELEASED'
  | 'EARNING_MOVED_TO_AVAILABLE'
  | 'PT_CHARGE_NO_SHOW'
  | 'PT_CHARGE_LATE_ARRIVAL'
  | 'HOLDBACK_KEPT'
  | 'HOLDBACK_RELEASED'
  | 'CLAWBACK'
  | 'REFERRAL_COMMISSION'
  | 'REFERRAL_CLAWBACK'
  | 'DEBT_WITHHELD'
  | 'PENDING_REVERSED'
  | 'OTHER_CREDIT'
  | 'OTHER_DEBIT';

export interface ClassifiableEntry {
  description: string | null;
  entryType: 'DEBIT' | 'CREDIT';
}

/** The owning transaction's purpose, used only when the description's own label does not name the product. */
export interface ClassifiableTransaction {
  purpose?: string | null;
  relatedEntityType?: string | null;
}

type Product = 'PERSONALIZED_SERVICE' | 'MEMBERSHIP' | 'PT_CONTRACT' | null;

function productOf(description: string, txn: ClassifiableTransaction | null | undefined): Product {
  const label = description.split(' — ')[0];
  if (/^PERSONALIZED_SERVICE_PURCHASE\b/.test(label)) return 'PERSONALIZED_SERVICE';
  if (/^(GYM_MEMBERSHIP|Membership)\b/.test(label)) return 'MEMBERSHIP';
  if (/^(PT_CONTRACT|Contract)\b/.test(label)) return 'PT_CONTRACT';
  const t = txn?.relatedEntityType ?? txn?.purpose ?? null;
  if (t === 'PERSONALIZED_SERVICE_PURCHASE') return 'PERSONALIZED_SERVICE';
  if (t === 'GYM_MEMBERSHIP') return 'MEMBERSHIP';
  if (t === 'PT_CONTRACT') return 'PT_CONTRACT';
  return null;
}

export function classifyWalletEntry(
  entry: ClassifiableEntry,
  txn?: ClassifiableTransaction | null,
): WalletEntryCategory {
  const d = entry.description ?? '';
  const credit = entry.entryType === 'CREDIT';

  if (d === 'Wallet top-up') return 'TOPUP';

  // Withdrawals: "Withdrawal <id> approved — locked for payout" / "rejected — restored from lock" / "paid — ref X"
  // (the platform-side "paid out" leg is not on a client/PT wallet).
  if (/^Withdrawal \S+ approved — locked for payout/.test(d)) return 'WITHDRAWAL_LOCKED';
  if (/^Withdrawal \S+ rejected — restored from lock/.test(d)) return 'WITHDRAWAL_RESTORED';
  if (/^Withdrawal \S+ paid\b/.test(d)) return 'WITHDRAWAL_PAID';

  const product = productOf(d, txn);

  // --- what the client receives ---
  if (credit) {
    if (d.includes('— refund (contract could not be activated)')) {
      if (product === 'PERSONALIZED_SERVICE') return 'REFUND_UNACTIVATED_PERSONALIZED_SERVICE';
      if (product === 'MEMBERSHIP') return 'REFUND_UNACTIVATED_MEMBERSHIP';
      if (product === 'PT_CONTRACT') return 'REFUND_UNACTIVATED_PT_CONTRACT';
      return 'REFUND_UNACTIVATED_OTHER';
    }
    if (d.includes('— refund (unresolved session not delivered)')) return 'REFUND_PT_SESSION_NOT_DELIVERED';
    if (d.includes('— compensation for a missed session')) return 'COMPENSATION_PT_NO_SHOW';
    if (d.includes("— compensation for the PT's late arrival")) return 'COMPENSATION_PT_LATE_ARRIVAL';
    if (/— compensation for .*\(from the PT's held-back earnings\)$/.test(d)) return 'COMPENSATION_PT_FAULT';
    // Contract termination ("— refund (CLIENT_CANCELLED)") and the plain "— refund" of memberships / orders.
    if (/— refund( \(|$)/.test(d)) {
      if (product === 'PT_CONTRACT') return 'REFUND_PT_CONTRACT';
      if (product === 'MEMBERSHIP') return 'REFUND_MEMBERSHIP';
      if (product === 'PERSONALIZED_SERVICE') return 'REFUND_PERSONALIZED_SERVICE';
      return 'REFUND_OTHER';
    }
  }

  // --- partner earnings and their movements ---
  if (d.includes('— PT no-show charge')) return 'PT_CHARGE_NO_SHOW';
  if (d.includes('— PT late-arrival charge')) return 'PT_CHARGE_LATE_ARRIVAL';
  if (d.includes('— referral commission')) return 'REFERRAL_COMMISSION';
  if (d.includes('— referral clawback')) return 'REFERRAL_CLAWBACK';
  if (d.includes('— withheld against outstanding debt')) return 'DEBT_WITHHELD';
  if (d.includes('— pending reversed (payment refunded)')) return 'PENDING_REVERSED';
  if (d.includes('— over-released, clawed back') || d.includes('— refund clawed back from available')) return 'CLAWBACK';
  if (/— (PT share|gym share|platform share)$/.test(d)) return 'EARNING_HELD';
  if (/— (session earned|order accepted|released|unresolved session delivered \(release to available\))$/.test(d)) {
    return 'EARNING_RELEASED';
  }
  if (/— (release to available|final settlement|pending released on termination|pending drained)$/.test(d)) {
    return credit ? 'EARNING_RELEASED' : 'EARNING_MOVED_TO_AVAILABLE';
  }
  if (d.includes('PT holdback retained')) return 'HOLDBACK_KEPT';
  if (d.includes('PT holdback released') || d.includes('PT holdback settled')) return 'HOLDBACK_RELEASED';

  return credit ? 'OTHER_CREDIT' : 'OTHER_DEBIT';
}
