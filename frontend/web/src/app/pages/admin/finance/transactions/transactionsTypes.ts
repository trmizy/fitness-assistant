/**
 * B7 — "Tài chính › Giao dịch": response types of the two READ endpoints (contract ADMIN_FULL_BE1_B7, 10/11/2026).
 * Money is always a decimal STRING exactly as stored ("299999.84"); it is only ever shown through `formatMoneyExact`.
 * Nothing sensitive is in these types on purpose (no extraData / metadata / idempotency / payload / result).
 */

/** G-14 whitelist of one PaymentTransaction. */
export interface TxnSummary {
  id: string;
  purpose: string;
  status: string;
  provider: string;
  amount: string;
  currency: string;
  payerId: string;
  gymId: string | null;
  ptId: string | null;
  ptContractId: string | null;
  membershipId: string | null;
  providerTransactionId: string | null;
  paymentMethod: string | null;
  activationStatus: string;
  refundOfTransactionId: string | null;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
}

export interface TxnListResponse {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: TxnSummary[];
}

export interface LedgerEntryDto {
  id: string;
  walletId: string;
  walletOwnerType: string;
  walletOwnerId: string;
  entryType: string;
  bucket: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  description: string | null;
  createdAt: string;
}

export interface LedgerOperationDto {
  id: string;
  key: string;
  kind: string | null;
  createdAt: string;
}

export interface CommissionDto {
  id: string;
  partnerType: string;
  partnerId: string;
  grossAmount: string;
  platformFeeAmount: string;
  partnerPayoutAmount: string;
  commissionRate: string;
  status: string;
  settledAt: string | null;
  createdAt: string;
}

export interface ObligationDto {
  id: string;
  status: string;
  kind: string;
  party: string;
  contractRef: string | null;
  owed: string;
  paid: string;
  unpaid: string;
  verifiedPaid: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface HoldbackReviewDto {
  id: string;
  status: string;
  kind: string;
  reserve: string;
  verifiedAmount: string | null;
  releasedToPt: string | null;
  reviewBy: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface WebhookEventDto {
  id: string;
  provider: string;
  providerEventId: string;
  processedAt: string | null;
  retryCount: number;
  createdAt: string;
}

export interface TxnDetailResponse {
  transaction: TxnSummary;
  refundOf: TxnSummary | null;
  refunds: TxnSummary[];
  ledgerEntries: LedgerEntryDto[];
  ledgerOperations: LedgerOperationDto[];
  commissions: CommissionDto[];
  obligations: ObligationDto[];
  holdbackReviews: HoldbackReviewDto[];
  webhookEvents: WebhookEventDto[];
}

/** Values the server accepts (PaymentStatus / PaymentProviderType / PurposeType) — the filter lists. */
export const PAYMENT_STATUSES = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED", "REFUNDED"] as const;
export const PAYMENT_PROVIDERS = ["MOCK", "VNPAY", "MOMO", "ZALOPAY", "PAYOS", "STRIPE", "MANUAL_BANK_TRANSFER"] as const;
export const PAYMENT_PURPOSES = [
  "GYM_MEMBERSHIP",
  "PT_CONTRACT",
  "GYM_PT_COMBO",
  "WALLET_TOPUP",
  "REFUND",
  "TRAINING_PACKAGE_PURCHASE",
  "PERSONALIZED_SERVICE_PURCHASE",
  "WITHDRAWAL",
] as const;
