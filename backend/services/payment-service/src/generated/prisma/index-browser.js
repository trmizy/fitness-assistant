
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.WalletScalarFieldEnum = {
  id: 'id',
  ownerType: 'ownerType',
  ownerId: 'ownerId',
  availableBalance: 'availableBalance',
  pendingBalance: 'pendingBalance',
  lockedBalance: 'lockedBalance',
  holdbackBalance: 'holdbackBalance',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WalletLedgerEntryScalarFieldEnum = {
  id: 'id',
  walletId: 'walletId',
  transactionId: 'transactionId',
  entryType: 'entryType',
  bucket: 'bucket',
  amount: 'amount',
  balanceBefore: 'balanceBefore',
  balanceAfter: 'balanceAfter',
  description: 'description',
  createdAt: 'createdAt'
};

exports.Prisma.WithdrawalRequestScalarFieldEnum = {
  id: 'id',
  walletId: 'walletId',
  ownerType: 'ownerType',
  ownerId: 'ownerId',
  amount: 'amount',
  status: 'status',
  payoutInfo: 'payoutInfo',
  bankReference: 'bankReference',
  rejectionReason: 'rejectionReason',
  reviewedBy: 'reviewedBy',
  reviewedAt: 'reviewedAt',
  paidAt: 'paidAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentTransactionScalarFieldEnum = {
  id: 'id',
  payerId: 'payerId',
  purpose: 'purpose',
  gymId: 'gymId',
  ptId: 'ptId',
  membershipId: 'membershipId',
  ptContractId: 'ptContractId',
  amount: 'amount',
  currency: 'currency',
  status: 'status',
  provider: 'provider',
  providerTransactionId: 'providerTransactionId',
  paymentMethod: 'paymentMethod',
  idempotencyKey: 'idempotencyKey',
  requestFingerprint: 'requestFingerprint',
  extraData: 'extraData',
  paidAt: 'paidAt',
  failedAt: 'failedAt',
  refundedAt: 'refundedAt',
  metadata: 'metadata',
  payerWalletId: 'payerWalletId',
  receiverWalletId: 'receiverWalletId',
  relatedEntityType: 'relatedEntityType',
  relatedEntityId: 'relatedEntityId',
  activationStatus: 'activationStatus',
  activationRetryCount: 'activationRetryCount',
  lastActivationRetryAt: 'lastActivationRetryAt',
  initiatedBy: 'initiatedBy',
  sourceService: 'sourceService',
  refundOfTransactionId: 'refundOfTransactionId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PlatformCommissionScalarFieldEnum = {
  id: 'id',
  paymentTransactionId: 'paymentTransactionId',
  partnerType: 'partnerType',
  partnerId: 'partnerId',
  grossAmount: 'grossAmount',
  platformFeeAmount: 'platformFeeAmount',
  partnerPayoutAmount: 'partnerPayoutAmount',
  commissionRate: 'commissionRate',
  status: 'status',
  settledAt: 'settledAt',
  createdAt: 'createdAt'
};

exports.Prisma.PartnerReceivableScalarFieldEnum = {
  id: 'id',
  partnerType: 'partnerType',
  partnerId: 'partnerId',
  amount: 'amount',
  recovered: 'recovered',
  reason: 'reason',
  contractId: 'contractId',
  transactionId: 'transactionId',
  settledAt: 'settledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  suspendedAt: 'suspendedAt',
  suspendedBy: 'suspendedBy',
  suspensionReason: 'suspensionReason',
  suspensionRef: 'suspensionRef',
  waived: 'waived',
  waivedAt: 'waivedAt',
  waivedBy: 'waivedBy',
  waiveReason: 'waiveReason',
  waiveRef: 'waiveRef'
};

exports.Prisma.LedgerOperationScalarFieldEnum = {
  id: 'id',
  key: 'key',
  result: 'result',
  createdAt: 'createdAt',
  requestFingerprint: 'requestFingerprint',
  transactionId: 'transactionId',
  kind: 'kind'
};

exports.Prisma.ContractUnpaidObligationScalarFieldEnum = {
  id: 'id',
  key: 'key',
  transactionId: 'transactionId',
  contractRef: 'contractRef',
  kind: 'kind',
  party: 'party',
  owed: 'owed',
  paid: 'paid',
  unpaid: 'unpaid',
  externallyPaid: 'externallyPaid',
  verifiedPaid: 'verifiedPaid',
  status: 'status',
  createdAt: 'createdAt',
  resolvedAt: 'resolvedAt',
  resolvedBy: 'resolvedBy',
  resolvedNote: 'resolvedNote',
  reason: 'reason'
};

exports.Prisma.PtHoldbackReviewScalarFieldEnum = {
  id: 'id',
  key: 'key',
  transactionId: 'transactionId',
  kind: 'kind',
  status: 'status',
  reserve: 'reserve',
  reason: 'reason',
  relatedRef: 'relatedRef',
  handler: 'handler',
  reviewBy: 'reviewBy',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  decidedAt: 'decidedAt',
  decidedBy: 'decidedBy',
  approvedBy: 'approvedBy',
  approvalRef: 'approvalRef',
  verifiedAmount: 'verifiedAmount',
  releasedToPt: 'releasedToPt',
  note: 'note'
};

exports.Prisma.PtHoldbackReviewEventScalarFieldEnum = {
  id: 'id',
  reviewId: 'reviewId',
  action: 'action',
  actor: 'actor',
  approvedBy: 'approvedBy',
  approvalRef: 'approvalRef',
  idempotencyKey: 'idempotencyKey',
  fromStatus: 'fromStatus',
  toStatus: 'toStatus',
  reserve: 'reserve',
  verifiedAmount: 'verifiedAmount',
  releasedToPt: 'releasedToPt',
  note: 'note',
  createdAt: 'createdAt'
};

exports.Prisma.PartnerReceivableEventScalarFieldEnum = {
  id: 'id',
  receivableId: 'receivableId',
  action: 'action',
  amount: 'amount',
  reason: 'reason',
  approvedBy: 'approvedBy',
  approvalRef: 'approvalRef',
  idempotencyKey: 'idempotencyKey',
  beforeJson: 'beforeJson',
  afterJson: 'afterJson',
  createdAt: 'createdAt'
};

exports.Prisma.ContractUnpaidObligationEventScalarFieldEnum = {
  id: 'id',
  obligationId: 'obligationId',
  action: 'action',
  note: 'note',
  actor: 'actor',
  approvalRef: 'approvalRef',
  idempotencyKey: 'idempotencyKey',
  fromStatus: 'fromStatus',
  toStatus: 'toStatus',
  unpaid: 'unpaid',
  paidAmount: 'paidAmount',
  transferReference: 'transferReference',
  paidOn: 'paidOn',
  approvedBy: 'approvedBy',
  unpaidAfter: 'unpaidAfter',
  paymentId: 'paymentId',
  paymentSource: 'paymentSource',
  recipient: 'recipient',
  evidenceRef: 'evidenceRef',
  evidenceHash: 'evidenceHash',
  bankStatementId: 'bankStatementId',
  verifiedBy: 'verifiedBy',
  createdAt: 'createdAt'
};

exports.Prisma.ContractUnpaidObligationPaymentScalarFieldEnum = {
  id: 'id',
  obligationId: 'obligationId',
  approvalRef: 'approvalRef',
  status: 'status',
  amount: 'amount',
  paymentSource: 'paymentSource',
  recipientParty: 'recipientParty',
  recipientId: 'recipientId',
  approvedBy: 'approvedBy',
  approvedAt: 'approvedAt',
  paidAmount: 'paidAmount',
  transferReference: 'transferReference',
  paidOn: 'paidOn',
  evidenceRef: 'evidenceRef',
  evidenceHash: 'evidenceHash',
  bankStatementId: 'bankStatementId',
  recordedBy: 'recordedBy',
  recordedAt: 'recordedAt',
  verifiedBy: 'verifiedBy',
  verifiedAt: 'verifiedAt',
  cancelledBy: 'cancelledBy',
  cancelledAt: 'cancelledAt',
  cancelReason: 'cancelReason'
};

exports.Prisma.PaymentWebhookEventScalarFieldEnum = {
  id: 'id',
  provider: 'provider',
  providerEventId: 'providerEventId',
  providerTransactionId: 'providerTransactionId',
  payload: 'payload',
  processedAt: 'processedAt',
  retryCount: 'retryCount',
  lastRetryAt: 'lastRetryAt',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.WalletOwnerType = exports.$Enums.WalletOwnerType = {
  CLIENT: 'CLIENT',
  PT: 'PT',
  GYM: 'GYM',
  PLATFORM: 'PLATFORM'
};

exports.WalletStatus = exports.$Enums.WalletStatus = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  CLOSED: 'CLOSED'
};

exports.LedgerEntryType = exports.$Enums.LedgerEntryType = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT'
};

exports.LedgerBucket = exports.$Enums.LedgerBucket = {
  PENDING: 'PENDING',
  AVAILABLE: 'AVAILABLE',
  LOCKED: 'LOCKED',
  HOLDBACK: 'HOLDBACK'
};

exports.WithdrawalRequestStatus = exports.$Enums.WithdrawalRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  REJECTED: 'REJECTED'
};

exports.PurposeType = exports.$Enums.PurposeType = {
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  GYM_PT_COMBO: 'GYM_PT_COMBO',
  WALLET_TOPUP: 'WALLET_TOPUP',
  REFUND: 'REFUND',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE',
  PERSONALIZED_SERVICE_PURCHASE: 'PERSONALIZED_SERVICE_PURCHASE',
  WITHDRAWAL: 'WITHDRAWAL'
};

exports.PaymentStatus = exports.$Enums.PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
};

exports.PaymentProviderType = exports.$Enums.PaymentProviderType = {
  MOCK: 'MOCK',
  VNPAY: 'VNPAY',
  MOMO: 'MOMO',
  ZALOPAY: 'ZALOPAY',
  PAYOS: 'PAYOS',
  STRIPE: 'STRIPE',
  MANUAL_BANK_TRANSFER: 'MANUAL_BANK_TRANSFER'
};

exports.RelatedEntityType = exports.$Enums.RelatedEntityType = {
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  WALLET_TOPUP: 'WALLET_TOPUP',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE',
  PERSONALIZED_SERVICE_PURCHASE: 'PERSONALIZED_SERVICE_PURCHASE'
};

exports.ActivationStatus = exports.$Enums.ActivationStatus = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING: 'PENDING',
  ACTIVATED: 'ACTIVATED',
  ACTIVATION_FAILED: 'ACTIVATION_FAILED'
};

exports.PartnerType = exports.$Enums.PartnerType = {
  GYM: 'GYM',
  PT: 'PT',
  CLIENT: 'CLIENT'
};

exports.CommissionStatus = exports.$Enums.CommissionStatus = {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED'
};

exports.ContractUnpaidObligationKind = exports.$Enums.ContractUnpaidObligationKind = {
  NO_SHOW: 'NO_SHOW',
  LATE_ARRIVAL: 'LATE_ARRIVAL',
  REFUND_SHORT: 'REFUND_SHORT',
  OVER_RELEASED: 'OVER_RELEASED'
};

exports.ContractUnpaidObligationStatus = exports.$Enums.ContractUnpaidObligationStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  WAIVED: 'WAIVED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PAID_EXTERNALLY: 'PAID_EXTERNALLY',
  APPROVED_FOR_PAYMENT: 'APPROVED_FOR_PAYMENT',
  AWAITING_EVIDENCE: 'AWAITING_EVIDENCE',
  PAID_VERIFIED: 'PAID_VERIFIED',
  RESOLVED_OTHER: 'RESOLVED_OTHER'
};

exports.PtHoldbackReviewKind = exports.$Enums.PtHoldbackReviewKind = {
  OPEN_OBLIGATION: 'OPEN_OBLIGATION',
  UNSECURED_DISPUTE: 'UNSECURED_DISPUTE',
  UNCOMPUTABLE: 'UNCOMPUTABLE'
};

exports.PtHoldbackReviewStatus = exports.$Enums.PtHoldbackReviewStatus = {
  OPEN: 'OPEN',
  SETTLED_VERIFIED: 'SETTLED_VERIFIED',
  SETTLED_PARTIAL: 'SETTLED_PARTIAL',
  NOT_VERIFIED: 'NOT_VERIFIED',
  RELEASED_AUTO: 'RELEASED_AUTO'
};

exports.PartnerReceivableEventAction = exports.$Enums.PartnerReceivableEventAction = {
  SUSPEND: 'SUSPEND',
  RESUME: 'RESUME',
  WAIVE: 'WAIVE'
};

exports.ContractUnpaidObligationEventAction = exports.$Enums.ContractUnpaidObligationEventAction = {
  RESOLVE: 'RESOLVE',
  WAIVE: 'WAIVE',
  REVIEW: 'REVIEW',
  RELEASE_REVIEW: 'RELEASE_REVIEW',
  PAY_EXTERNALLY: 'PAY_EXTERNALLY',
  APPROVE_PAYMENT: 'APPROVE_PAYMENT',
  SUBMIT_EVIDENCE: 'SUBMIT_EVIDENCE',
  VERIFY_PAYMENT: 'VERIFY_PAYMENT',
  CANCEL_APPROVAL: 'CANCEL_APPROVAL',
  RESOLVE_OTHER: 'RESOLVE_OTHER'
};

exports.ContractUnpaidObligationPaymentStatus = exports.$Enums.ContractUnpaidObligationPaymentStatus = {
  APPROVED: 'APPROVED',
  EVIDENCE_SUBMITTED: 'EVIDENCE_SUBMITTED',
  VERIFIED: 'VERIFIED',
  CANCELLED: 'CANCELLED'
};

exports.Prisma.ModelName = {
  Wallet: 'Wallet',
  WalletLedgerEntry: 'WalletLedgerEntry',
  WithdrawalRequest: 'WithdrawalRequest',
  PaymentTransaction: 'PaymentTransaction',
  PlatformCommission: 'PlatformCommission',
  PartnerReceivable: 'PartnerReceivable',
  LedgerOperation: 'LedgerOperation',
  ContractUnpaidObligation: 'ContractUnpaidObligation',
  PtHoldbackReview: 'PtHoldbackReview',
  PtHoldbackReviewEvent: 'PtHoldbackReviewEvent',
  PartnerReceivableEvent: 'PartnerReceivableEvent',
  ContractUnpaidObligationEvent: 'ContractUnpaidObligationEvent',
  ContractUnpaidObligationPayment: 'ContractUnpaidObligationPayment',
  PaymentWebhookEvent: 'PaymentWebhookEvent'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
