
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
  updatedAt: 'updatedAt'
};

exports.Prisma.LedgerOperationScalarFieldEnum = {
  id: 'id',
  key: 'key',
  result: 'result',
  createdAt: 'createdAt'
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
  AVAILABLE: 'AVAILABLE'
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
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE'
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

exports.Prisma.ModelName = {
  Wallet: 'Wallet',
  WalletLedgerEntry: 'WalletLedgerEntry',
  WithdrawalRequest: 'WithdrawalRequest',
  PaymentTransaction: 'PaymentTransaction',
  PlatformCommission: 'PlatformCommission',
  PartnerReceivable: 'PartnerReceivable',
  LedgerOperation: 'LedgerOperation',
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
