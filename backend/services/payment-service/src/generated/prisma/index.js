
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/library.js')


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

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

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




  const path = require('path')

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
  PartnerReceivableEvent: 'PartnerReceivableEvent',
  ContractUnpaidObligationEvent: 'ContractUnpaidObligationEvent',
  ContractUnpaidObligationPayment: 'ContractUnpaidObligationPayment',
  PaymentWebhookEvent: 'PaymentWebhookEvent'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "D:\\FitnessAssistant\\backend\\services\\payment-service\\src\\generated\\prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "windows",
        "native": true
      },
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x"
      },
      {
        "fromEnvVar": null,
        "value": "rhel-openssl-3.0.x"
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "D:\\FitnessAssistant\\backend\\services\\payment-service\\prisma\\schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null
  },
  "relativePath": "../../../prisma",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "postinstall": false,
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\", \"rhel-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum PaymentStatus {\n  PENDING\n  PROCESSING\n  PAID\n  FAILED\n  CANCELLED\n  REFUNDED\n}\n\nenum PaymentProviderType {\n  MOCK\n  VNPAY\n  MOMO\n  ZALOPAY\n  PAYOS\n  STRIPE\n  MANUAL_BANK_TRANSFER\n}\n\nenum PartnerType {\n  GYM\n  PT\n  CLIENT\n}\n\nenum CommissionStatus {\n  PENDING\n  SETTLED\n  CANCELLED\n}\n\nenum PurposeType {\n  GYM_MEMBERSHIP\n  PT_CONTRACT\n  GYM_PT_COMBO\n  WALLET_TOPUP\n  REFUND\n  TRAINING_PACKAGE_PURCHASE\n  PERSONALIZED_SERVICE_PURCHASE\n  /// Money-flow plan 5.3: the dedicated PaymentTransaction row markPaid creates for a\n  /// WithdrawalRequest payout. Outbound money has no originating gateway PaymentTransaction\n  /// to reuse the way REFUND reuses the original purchase's — WalletLedgerEntry.transactionId\n  /// is a hard FK, so a payout needs a row of its own to point at.\n  WITHDRAWAL\n}\n\nenum WalletOwnerType {\n  CLIENT\n  PT\n  GYM\n  PLATFORM\n}\n\nenum WalletStatus {\n  ACTIVE\n  FROZEN\n  CLOSED\n}\n\nenum LedgerEntryType {\n  DEBIT\n  CREDIT\n}\n\n/// Which of a wallet's three balances an entry moved. Releasing money from PENDING to\n/// AVAILABLE is written as two entries sharing one transactionId: a PENDING debit and an\n/// AVAILABLE credit, so the ledger stays double-entry and the release is auditable.\n/// P0 cluster F: LOCKED added — a wallet's already-unused `lockedBalance` column finally gets\n/// a ledger-writing path. A withdrawal request approval moves AVAILABLE -> LOCKED (a hard\n/// reservation a later clawback/refund cannot reach, since those only ever debit AVAILABLE);\n/// the actual payout later debits LOCKED (+ ESCROW); a rejection after approval moves LOCKED\n/// back to AVAILABLE.\n///\n/// FH-9: HOLDBACK added - the PT's EARNED-but-not-yet-withdrawable money for the contracts that carry a PT financial holdback\n/// (10% of the PT's expected income on that contract, held until the contract has ended and is reconciled). It is a claim of the PT\n/// on ESCROW exactly like AVAILABLE, but nothing withdraws from it and no per-session / compensation path can reach it; it only\n/// leaves through the two doors in contract-ledger.service (the contract's own verified PT-fault compensation, and the release to AVAILABLE).\n/// Per contract the held amount is Σ HOLDBACK rows of that contract's payment transaction id.\nenum LedgerBucket {\n  PENDING\n  AVAILABLE\n  LOCKED\n  HOLDBACK\n}\n\nenum RelatedEntityType {\n  GYM_MEMBERSHIP\n  PT_CONTRACT\n  WALLET_TOPUP\n  TRAINING_PACKAGE_PURCHASE\n  PERSONALIZED_SERVICE_PURCHASE\n}\n\nenum ActivationStatus {\n  NOT_APPLICABLE\n  PENDING\n  ACTIVATED\n  ACTIVATION_FAILED\n}\n\n/// Two-bucket wallet.\n///\n/// `pendingBalance` is money already attributed to the owner but not yet earned — it backs\n/// the sessions of a contract that have not happened yet, and is exactly the pot a refund\n/// draws from. `availableBalance` is money the owner may withdraw.\n///\n/// Two PLATFORM wallets exist, distinguished by ownerId (see PLATFORM_ESCROW_ID /\n/// PLATFORM_REVENUE_ID): ESCROW holds every đồng the platform is custodian of, REVENUE\n/// holds commission the platform has actually earned. Keeping them apart is what makes the\n/// reconciliation invariant checkable — a single mixed wallet has no interpretable balance\n/// once several contracts run at once.\nmodel Wallet {\n  id               String          @id @default(uuid())\n  ownerType        WalletOwnerType @map(\"owner_type\")\n  ownerId          String          @map(\"owner_id\")\n  availableBalance Decimal         @default(0) @map(\"available_balance\") @db.Decimal(14, 2)\n  pendingBalance   Decimal         @default(0) @map(\"pending_balance\") @db.Decimal(14, 2)\n  lockedBalance    Decimal         @default(0) @map(\"locked_balance\") @db.Decimal(14, 2)\n  /// FH-9: earned PT money held back per contract (see LedgerBucket.HOLDBACK). Not withdrawable.\n  holdbackBalance  Decimal         @default(0) @map(\"holdback_balance\") @db.Decimal(14, 2)\n  status           WalletStatus    @default(ACTIVE)\n  createdAt        DateTime        @default(now()) @map(\"created_at\")\n  updatedAt        DateTime        @updatedAt @map(\"updated_at\")\n\n  ledgerEntries      WalletLedgerEntry[]\n  withdrawalRequests WithdrawalRequest[]\n\n  @@unique([ownerType, ownerId])\n  @@map(\"wallets\")\n}\n\nmodel WalletLedgerEntry {\n  id            String          @id @default(uuid())\n  walletId      String          @map(\"wallet_id\")\n  transactionId String          @map(\"transaction_id\")\n  entryType     LedgerEntryType @map(\"entry_type\")\n  /// Which balance moved. balanceBefore/balanceAfter are that bucket's running total, so a\n  /// wallet's two buckets each form their own unbroken chain.\n  bucket        LedgerBucket    @default(AVAILABLE)\n  amount        Decimal         @db.Decimal(14, 2)\n  balanceBefore Decimal         @map(\"balance_before\") @db.Decimal(14, 2)\n  balanceAfter  Decimal         @map(\"balance_after\") @db.Decimal(14, 2)\n  description   String?\n  createdAt     DateTime        @default(now()) @map(\"created_at\")\n\n  wallet      Wallet             @relation(fields: [walletId], references: [id])\n  transaction PaymentTransaction @relation(fields: [transactionId], references: [id])\n\n  @@index([walletId, createdAt])\n  @@index([walletId, bucket, createdAt])\n  @@index([transactionId])\n  @@map(\"wallet_ledger_entries\")\n}\n\nenum WithdrawalRequestStatus {\n  PENDING\n  APPROVED\n  PAID\n  REJECTED\n}\n\n/// Money-flow redesign plan 5.3 — \"luồng rút tiền bán thủ công\". Deliberately minimal: no\n/// payout-API integration (chi ra ngoài vẫn thủ công, §5.3's explicit constraint). The ledger\n/// debit only happens at `markPaid`, when an admin confirms a real bank/e-wallet transfer\n/// already happened outside this system — this row exists to track that transfer, not to\n/// trigger it.\nmodel WithdrawalRequest {\n  id              String                  @id @default(uuid())\n  walletId        String                  @map(\"wallet_id\")\n  ownerType       WalletOwnerType         @map(\"owner_type\")\n  ownerId         String                  @map(\"owner_id\")\n  amount          Decimal                 @db.Decimal(14, 2)\n  status          WithdrawalRequestStatus @default(PENDING)\n  /// Bank account / e-wallet details the requester provided — free text, no payout API to\n  /// validate a schema against.\n  payoutInfo      String                  @map(\"payout_info\")\n  /// Filled in by the admin at markPaid — the paper trail for the transfer that happened\n  /// manually, outside this system.\n  bankReference   String?                 @map(\"bank_reference\")\n  rejectionReason String?                 @map(\"rejection_reason\")\n  reviewedBy      String?                 @map(\"reviewed_by\")\n  reviewedAt      DateTime?               @map(\"reviewed_at\")\n  paidAt          DateTime?               @map(\"paid_at\")\n  createdAt       DateTime                @default(now()) @map(\"created_at\")\n  updatedAt       DateTime                @updatedAt @map(\"updated_at\")\n\n  wallet Wallet @relation(fields: [walletId], references: [id])\n\n  // The withdrawable-balance query (walletId, status) and the admin queue (status alone).\n  @@index([walletId, status])\n  @@index([status])\n  @@map(\"withdrawal_requests\")\n}\n\nmodel PaymentTransaction {\n  id                    String              @id @default(uuid())\n  payerId               String              @map(\"payer_id\")\n  purpose               PurposeType\n  gymId                 String?             @map(\"gym_id\")\n  ptId                  String?             @map(\"pt_id\")\n  membershipId          String?             @map(\"membership_id\")\n  ptContractId          String?             @map(\"pt_contract_id\")\n  amount                Decimal             @db.Decimal(12, 2)\n  currency              String              @default(\"VND\")\n  status                PaymentStatus       @default(PENDING)\n  provider              PaymentProviderType @default(MOCK)\n  providerTransactionId String?             @map(\"provider_transaction_id\")\n  paymentMethod         String?             @map(\"payment_method\")\n  idempotencyKey        String              @unique @map(\"idempotency_key\")\n  requestFingerprint    String?             @map(\"request_fingerprint\")\n  extraData             String?             @map(\"extra_data\")\n  paidAt                DateTime?           @map(\"paid_at\")\n  failedAt              DateTime?           @map(\"failed_at\")\n  refundedAt            DateTime?           @map(\"refunded_at\")\n  metadata              Json?\n\n  payerWalletId         String?            @map(\"payer_wallet_id\")\n  receiverWalletId      String?            @map(\"receiver_wallet_id\")\n  relatedEntityType     RelatedEntityType? @map(\"related_entity_type\")\n  relatedEntityId       String?            @map(\"related_entity_id\")\n  activationStatus      ActivationStatus   @default(NOT_APPLICABLE) @map(\"activation_status\")\n  // On REFUND-purpose rows, \"activation\" means \"the downstream cancel-after-refund succeeded\" —\n  // reusing this one status/retry pair for both flows avoids a near-duplicate set of columns.\n  activationRetryCount  Int                @default(0) @map(\"activation_retry_count\")\n  lastActivationRetryAt DateTime?          @map(\"last_activation_retry_at\")\n  initiatedBy           String?            @default(\"SYSTEM\") @map(\"initiated_by\")\n  sourceService         String?            @default(\"payment-service\") @map(\"source_service\")\n  refundOfTransactionId String?            @map(\"refund_of_transaction_id\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  commissions       PlatformCommission[]\n  ledgerEntries     WalletLedgerEntry[]\n  unpaidObligations ContractUnpaidObligation[]\n\n  @@index([payerId, status])\n  @@index([status])\n  @@index([providerTransactionId])\n  @@index([purpose, status, activationStatus])\n  @@index([refundOfTransactionId])\n  @@map(\"payment_transactions\")\n}\n\nmodel PlatformCommission {\n  id                   String           @id @default(uuid())\n  paymentTransactionId String           @map(\"payment_transaction_id\")\n  partnerType          PartnerType      @map(\"partner_type\")\n  partnerId            String           @map(\"partner_id\")\n  grossAmount          Decimal          @map(\"gross_amount\") @db.Decimal(12, 2)\n  platformFeeAmount    Decimal          @map(\"platform_fee_amount\") @db.Decimal(12, 2)\n  partnerPayoutAmount  Decimal          @map(\"partner_payout_amount\") @db.Decimal(12, 2)\n  commissionRate       Decimal          @map(\"commission_rate\") @db.Decimal(5, 4)\n  status               CommissionStatus @default(PENDING)\n  settledAt            DateTime?        @map(\"settled_at\")\n  createdAt            DateTime         @default(now()) @map(\"created_at\")\n\n  transaction PaymentTransaction @relation(fields: [paymentTransactionId], references: [id])\n\n  @@index([partnerType, partnerId, status])\n  @@index([paymentTransactionId])\n  @@map(\"platform_commissions\")\n}\n\n/// Money a partner owes back to the platform.\n///\n/// Raised when a client had to be made whole but the partner's buckets could not cover their\n/// share — a PT who missed enough sessions to exhaust their pending balance, typically. The\n/// platform fronts the cash so the client is never short-changed, and books the difference\n/// here. Without this row the shortfall would either push a wallet negative or silently break\n/// the reconciliation invariant; instead it stays visible and recoverable.\nmodel PartnerReceivable {\n  id               String      @id @default(uuid())\n  partnerType      PartnerType @map(\"partner_type\")\n  partnerId        String      @map(\"partner_id\")\n  amount           Decimal     @db.Decimal(14, 2)\n  /// Recovered so far, by withholding from the partner's later credits.\n  recovered        Decimal     @default(0) @db.Decimal(14, 2)\n  reason           String\n  contractId       String?     @map(\"contract_id\")\n  transactionId    String?     @map(\"transaction_id\")\n  settledAt        DateTime?   @map(\"settled_at\")\n  createdAt        DateTime    @default(now()) @map(\"created_at\")\n  updatedAt        DateTime    @updatedAt @map(\"updated_at\")\n  /// FH-8 (D62 C.4). Collection of THIS row is paused while suspendedAt is set. History is kept; nothing is\n  /// marked paid and `recovered` is never touched. Set/cleared only by the audited adjustment operation.\n  suspendedAt      DateTime?   @map(\"suspended_at\")\n  suspendedBy      String?     @map(\"suspended_by\")\n  suspensionReason String?     @map(\"suspension_reason\")\n  /// Approval / minute number the owner gave for the suspension.\n  suspensionRef    String?     @map(\"suspension_ref\")\n  /// FH-8. Part of `amount` the platform has agreed to bear (forgiven). Outstanding = amount - recovered - waived.\n  waived           Decimal     @default(0) @db.Decimal(14, 2)\n  waivedAt         DateTime?   @map(\"waived_at\")\n  waivedBy         String?     @map(\"waived_by\")\n  waiveReason      String?     @map(\"waive_reason\")\n  waiveRef         String?     @map(\"waive_ref\")\n\n  events PartnerReceivableEvent[]\n\n  @@index([partnerType, partnerId, settledAt])\n  @@map(\"partner_receivables\")\n}\n\n/// Business-key idempotency for financial ledger operations that are NOT a\n/// PaymentTransaction (money-flow redesign plan item 1.1) — release-session,\n/// no-show compensation, contract termination, membership referral settle/\n/// clawback, membership pending-release. Each is written inside the SAME DB\n/// transaction as the wallet movements it guards (see contract-ledger.service.ts's\n/// / membership-ledger.service.ts's `withIdempotentLedgerOp`), so a crash between\n/// \"money moved\" and \"this row committed\" is impossible: either both land or\n/// neither does. A retry with the same `key` finds this row and replays `result`\n/// instead of moving money again — the \"gọi lại cùng khoá phải là thao tác vô hại\"\n/// requirement.\n///\n/// `key` follows a fixed per-operation-type format so it is self-describing in an\n/// audit query, e.g. `SESSION_RELEASE:<sessionId>`, `CONTRACT_TERMINATE:<contractId>`,\n/// `MEMBERSHIP_RELEASE:<membershipId>` — see docs/money-flow.md for the full list.\nmodel LedgerOperation {\n  id                 String   @id @default(uuid())\n  key                String   @unique\n  result             Json\n  createdAt          DateTime @default(now()) @map(\"created_at\")\n  /// FH-2b. Hash of the IMMUTABLE fields of the request that claimed this key (kind, transaction,\n  /// price, session count, rates, parties, reason/outcome). NULL on rows written before the column\n  /// existed and on callers that do not fingerprint: those replay exactly as they always did.\n  requestFingerprint String?  @map(\"request_fingerprint\")\n  /// FH-2b. The payment transaction the operation moved money for; lets a later operation (and\n  /// the read-only lookup) find \"has this transaction been terminated\" without parsing keys.\n  transactionId      String?  @map(\"transaction_id\")\n  /// FH-2b. RELEASE_SESSION | NO_SHOW | LATE_ARRIVAL | TERMINATE | RESOLVE_UNRESOLVED | ...\n  kind               String?\n\n  @@index([transactionId])\n  @@map(\"ledger_operations\")\n}\n\nenum ContractUnpaidObligationKind {\n  NO_SHOW\n  LATE_ARRIVAL\n  REFUND_SHORT\n  OVER_RELEASED\n}\n\n/// OPEN = recorded; UNDER_REVIEW = an owner/operator is looking at it.\n/// Payment lifecycle (FH-8, owner decision: nothing is \"paid\" without VERIFIED evidence, by a second person):\n///   APPROVED_FOR_PAYMENT = an authorised approver approved paying an exact amount from a manual (outside-the-ledger) source;\n///   AWAITING_EVIDENCE    = the payment was made outside and evidence was recorded; waiting for a DIFFERENT person to verify it;\n///   PAID_VERIFIED        = the evidence was verified against the approval and the whole obligation is covered (terminal);\n///                          a PARTIAL verified payment returns the row to OPEN with a smaller `unpaid` and `verifiedPaid` > 0.\n/// WAIVED = the owner decided not to pursue (the client is NOT paid); RESOLVED_OTHER = settled by another method, reason mandatory.\n/// LEGACY: PAID_EXTERNALLY = \"evidence recorded, NOT verified\" (written by the FH-8 first cut before verification existed; never\n/// auto-upgraded, no new row can enter it); RESOLVED = legacy \"handled elsewhere\".\nenum ContractUnpaidObligationStatus {\n  OPEN\n  RESOLVED\n  WAIVED\n  UNDER_REVIEW\n  PAID_EXTERNALLY\n  APPROVED_FOR_PAYMENT\n  AWAITING_EVIDENCE\n  PAID_VERIFIED\n  RESOLVED_OTHER\n}\n\n/// FH-1 (D48 / N7). What a PT-fault step on ONE contract could not pay out of that contract's own\n/// pending money. It is an unpaid obligation TO THE CLIENT (or, for OVER_RELEASED, an incident for\n/// the admin) — never a PT debt: no PartnerReceivable is created, the platform does not front it and\n/// the PT's pooled balance is not touched. Written in the same DB transaction as the ledger rows,\n/// keyed by the idempotency key of the operation, so a retry can never create a second one.\nmodel ContractUnpaidObligation {\n  id             String                         @id @default(uuid())\n  /// Idempotency key of the operation (OVER_RELEASED rows add `#OVER_RELEASED:<party>`).\n  key            String                         @unique\n  transactionId  String                         @map(\"transaction_id\")\n  /// Contract reference the caller labelled the operation with (the ledger label).\n  contractRef    String?                        @map(\"contract_ref\")\n  kind           ContractUnpaidObligationKind\n  /// Who the obligation is owed to: CLIENT, or the over-released party (PT | GYM | PLATFORM).\n  party          String\n  owed           Decimal                        @db.Decimal(14, 2)\n  paid           Decimal                        @db.Decimal(14, 2)\n  unpaid         Decimal                        @db.Decimal(14, 2)\n  /// FH-8: total paid to the client OUTSIDE this ledger (evidence in the events). Never a wallet credit.\n  externallyPaid Decimal                        @default(0) @map(\"externally_paid\") @db.Decimal(14, 2)\n  /// FH-8: total paid outside the ledger AND VERIFIED by a second person (sum of VERIFIED payments). Only this reduces `unpaid`\n  /// in the current lifecycle; `externallyPaid` is the legacy, unverified figure and is never written any more.\n  verifiedPaid   Decimal                        @default(0) @map(\"verified_paid\") @db.Decimal(14, 2)\n  status         ContractUnpaidObligationStatus @default(OPEN)\n  createdAt      DateTime                       @default(now()) @map(\"created_at\")\n  resolvedAt     DateTime?                      @map(\"resolved_at\")\n  resolvedBy     String?                        @map(\"resolved_by\")\n  resolvedNote   String?                        @map(\"resolved_note\")\n  /// Why the obligation exists, in words (D77: set by the record-only late-arrival operation; null on the rows FH-1 wrote).\n  reason         String?\n\n  transaction PaymentTransaction                @relation(fields: [transactionId], references: [id])\n  events      ContractUnpaidObligationEvent[]\n  payments    ContractUnpaidObligationPayment[]\n\n  @@index([status])\n  @@index([transactionId])\n  @@map(\"contract_unpaid_obligations\")\n}\n\nenum PartnerReceivableEventAction {\n  SUSPEND\n  RESUME\n  WAIVE\n}\n\n/// FH-8. Append-only audit trail of every adjustment made to a PartnerReceivable. Rows are only ever inserted:\n/// the operation code never updates or deletes them. `idempotencyKey` makes a replayed operation a no-op.\nmodel PartnerReceivableEvent {\n  id             String                       @id @default(uuid())\n  receivableId   String                       @map(\"receivable_id\")\n  action         PartnerReceivableEventAction\n  /// Amount the action concerned (the waived amount for WAIVE; the row's amount for SUSPEND/RESUME).\n  amount         Decimal                      @db.Decimal(14, 2)\n  reason         String\n  approvedBy     String                       @map(\"approved_by\")\n  approvalRef    String                       @map(\"approval_ref\")\n  idempotencyKey String                       @unique @map(\"idempotency_key\")\n  beforeJson     Json                         @map(\"before_json\")\n  afterJson      Json                         @map(\"after_json\")\n  createdAt      DateTime                     @default(now()) @map(\"created_at\")\n\n  receivable PartnerReceivable @relation(fields: [receivableId], references: [id], onDelete: Restrict)\n\n  @@index([receivableId])\n  @@map(\"partner_receivable_events\")\n}\n\nenum ContractUnpaidObligationEventAction {\n  RESOLVE\n  WAIVE\n  REVIEW\n  RELEASE_REVIEW\n  PAY_EXTERNALLY\n  APPROVE_PAYMENT\n  SUBMIT_EVIDENCE\n  VERIFY_PAYMENT\n  CANCEL_APPROVAL\n  RESOLVE_OTHER\n}\n\n/// FH-8. Append-only audit trail of status changes on ContractUnpaidObligation. A status change records who and why;\n/// it moves no money.\nmodel ContractUnpaidObligationEvent {\n  id                String                              @id @default(uuid())\n  obligationId      String                              @map(\"obligation_id\")\n  action            ContractUnpaidObligationEventAction\n  note              String\n  actor             String\n  approvalRef       String                              @map(\"approval_ref\")\n  idempotencyKey    String                              @unique @map(\"idempotency_key\")\n  fromStatus        ContractUnpaidObligationStatus      @map(\"from_status\")\n  toStatus          ContractUnpaidObligationStatus      @map(\"to_status\")\n  /// Unpaid amount at the time of the change (the CAS value the owner approved).\n  unpaid            Decimal                             @db.Decimal(14, 2)\n  /// PAY_EXTERNALLY evidence (null for the other actions): what was paid, the bank/transfer reference, the date it was paid,\n  /// who approved it, and what stays unpaid afterwards.\n  paidAmount        Decimal?                            @map(\"paid_amount\") @db.Decimal(14, 2)\n  transferReference String?                             @map(\"transfer_reference\")\n  paidOn            DateTime?                           @map(\"paid_on\")\n  approvedBy        String?                             @map(\"approved_by\")\n  unpaidAfter       Decimal?                            @map(\"unpaid_after\") @db.Decimal(14, 2)\n  /// Payment lifecycle events (APPROVE_PAYMENT .. CANCEL_APPROVAL): the payment record, its manual source, the recipient\n  /// (taken from the ledger), the evidence pointers and who verified it.\n  paymentId         String?                             @map(\"payment_id\")\n  paymentSource     String?                             @map(\"payment_source\")\n  recipient         String?\n  evidenceRef       String?                             @map(\"evidence_ref\")\n  evidenceHash      String?                             @map(\"evidence_hash\")\n  bankStatementId   String?                             @map(\"bank_statement_id\")\n  verifiedBy        String?                             @map(\"verified_by\")\n  createdAt         DateTime                            @default(now()) @map(\"created_at\")\n\n  obligation ContractUnpaidObligation @relation(fields: [obligationId], references: [id], onDelete: Restrict)\n\n  @@index([obligationId])\n  @@map(\"contract_unpaid_obligation_events\")\n}\n\nenum ContractUnpaidObligationPaymentStatus {\n  APPROVED\n  EVIDENCE_SUBMITTED\n  VERIFIED\n  CANCELLED\n}\n\n/// FH-8. ONE manual (outside-the-ledger) payment of an unpaid obligation: approved -> evidence submitted -> verified (or cancelled).\n/// At most ONE open (APPROVED / EVIDENCE_SUBMITTED) row per obligation (partial unique index in the migration), so the sum of\n/// VERIFIED payments can never exceed what was owed. Recipient comes from the ledger (the obligation's party; for a CLIENT\n/// obligation the payer of the payment transaction), never from input. Moves no money: no wallet / ledger / receivable row.\n/// DELETE is rejected and the identity columns are immutable (trigger in the migration); the event table keeps the full history.\nmodel ContractUnpaidObligationPayment {\n  id                String                                @id @default(uuid())\n  obligationId      String                                @map(\"obligation_id\")\n  approvalRef       String                                @map(\"approval_ref\")\n  status            ContractUnpaidObligationPaymentStatus @default(APPROVED)\n  amount            Decimal                               @db.Decimal(14, 2)\n  paymentSource     String                                @map(\"payment_source\")\n  recipientParty    String                                @map(\"recipient_party\")\n  recipientId       String?                               @map(\"recipient_id\")\n  approvedBy        String                                @map(\"approved_by\")\n  approvedAt        DateTime                              @default(now()) @map(\"approved_at\")\n  /// Evidence (recorded by `recordedBy` AFTER the payment was made outside): what was paid, the transfer reference, the day,\n  /// and a pointer to the proof (file reference / sha256 / bank statement id). NOT proof by itself - `verifiedBy` must confirm it.\n  paidAmount        Decimal?                              @map(\"paid_amount\") @db.Decimal(14, 2)\n  transferReference String?                               @map(\"transfer_reference\")\n  paidOn            DateTime?                             @map(\"paid_on\")\n  evidenceRef       String?                               @map(\"evidence_ref\")\n  evidenceHash      String?                               @map(\"evidence_hash\")\n  bankStatementId   String?                               @map(\"bank_statement_id\")\n  recordedBy        String?                               @map(\"recorded_by\")\n  recordedAt        DateTime?                             @map(\"recorded_at\")\n  verifiedBy        String?                               @map(\"verified_by\")\n  verifiedAt        DateTime?                             @map(\"verified_at\")\n  cancelledBy       String?                               @map(\"cancelled_by\")\n  cancelledAt       DateTime?                             @map(\"cancelled_at\")\n  cancelReason      String?                               @map(\"cancel_reason\")\n\n  obligation ContractUnpaidObligation @relation(fields: [obligationId], references: [id], onDelete: Restrict)\n\n  @@unique([obligationId, approvalRef])\n  @@index([obligationId])\n  @@map(\"contract_unpaid_obligation_payments\")\n}\n\nmodel PaymentWebhookEvent {\n  id                    String              @id @default(uuid())\n  provider              PaymentProviderType\n  providerEventId       String              @map(\"provider_event_id\")\n  providerTransactionId String?             @map(\"provider_transaction_id\")\n  payload               Json\n  processedAt           DateTime?           @map(\"processed_at\")\n  retryCount            Int                 @default(0) @map(\"retry_count\")\n  lastRetryAt           DateTime?           @map(\"last_retry_at\")\n  createdAt             DateTime            @default(now()) @map(\"created_at\")\n\n  @@unique([provider, providerEventId])\n  @@index([processedAt, retryCount])\n  @@map(\"payment_webhook_events\")\n}\n",
  "inlineSchemaHash": "67a7a6ff19b8900744c88e29e1660f5183c1d637a6767f167517e18fe82454ba",
  "copyEngine": true
}

const fs = require('fs')

config.dirname = __dirname
if (!fs.existsSync(path.join(__dirname, 'schema.prisma'))) {
  const alternativePaths = [
    "src/generated/prisma",
    "generated/prisma",
  ]
  
  const alternativePath = alternativePaths.find((altPath) => {
    return fs.existsSync(path.join(process.cwd(), altPath, 'schema.prisma'))
  }) ?? alternativePaths[0]

  config.dirname = path.join(process.cwd(), alternativePath)
  config.isBundled = true
}

config.runtimeDataModel = JSON.parse("{\"models\":{\"Wallet\":{\"dbName\":\"wallets\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerType\",\"dbName\":\"owner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletOwnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableBalance\",\"dbName\":\"available_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"pendingBalance\",\"dbName\":\"pending_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lockedBalance\",\"dbName\":\"locked_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"holdbackBalance\",\"dbName\":\"holdback_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-9: earned PT money held back per contract (see LedgerBucket.HOLDBACK). Not withdrawable.\"},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"WalletStatus\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletLedgerEntry\",\"relationName\":\"WalletToWalletLedgerEntry\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"withdrawalRequests\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WithdrawalRequest\",\"relationName\":\"WalletToWithdrawalRequest\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"ownerType\",\"ownerId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"ownerType\",\"ownerId\"]}],\"isGenerated\":false,\"documentation\":\"Two-bucket wallet.\\\\n\\\\n`pendingBalance` is money already attributed to the owner but not yet earned — it backs\\\\nthe sessions of a contract that have not happened yet, and is exactly the pot a refund\\\\ndraws from. `availableBalance` is money the owner may withdraw.\\\\n\\\\nTwo PLATFORM wallets exist, distinguished by ownerId (see PLATFORM_ESCROW_ID /\\\\nPLATFORM_REVENUE_ID): ESCROW holds every đồng the platform is custodian of, REVENUE\\\\nholds commission the platform has actually earned. Keeping them apart is what makes the\\\\nreconciliation invariant checkable — a single mixed wallet has no interpretable balance\\\\nonce several contracts run at once.\"},\"WalletLedgerEntry\":{\"dbName\":\"wallet_ledger_entries\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"walletId\",\"dbName\":\"wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entryType\",\"dbName\":\"entry_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"LedgerEntryType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bucket\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"LedgerBucket\",\"default\":\"AVAILABLE\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Which balance moved. balanceBefore/balanceAfter are that bucket's running total, so a\\\\nwallet's two buckets each form their own unbroken chain.\"},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"balanceBefore\",\"dbName\":\"balance_before\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"balanceAfter\",\"dbName\":\"balance_after\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"wallet\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Wallet\",\"relationName\":\"WalletToWalletLedgerEntry\",\"relationFromFields\":[\"walletId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transaction\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentTransaction\",\"relationName\":\"PaymentTransactionToWalletLedgerEntry\",\"relationFromFields\":[\"transactionId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WithdrawalRequest\":{\"dbName\":\"withdrawal_requests\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"walletId\",\"dbName\":\"wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerType\",\"dbName\":\"owner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletOwnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"WithdrawalRequestStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payoutInfo\",\"dbName\":\"payout_info\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Bank account / e-wallet details the requester provided — free text, no payout API to\\\\nvalidate a schema against.\"},{\"name\":\"bankReference\",\"dbName\":\"bank_reference\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Filled in by the admin at markPaid — the paper trail for the transfer that happened\\\\nmanually, outside this system.\"},{\"name\":\"rejectionReason\",\"dbName\":\"rejection_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewedBy\",\"dbName\":\"reviewed_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewedAt\",\"dbName\":\"reviewed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidAt\",\"dbName\":\"paid_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"wallet\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Wallet\",\"relationName\":\"WalletToWithdrawalRequest\",\"relationFromFields\":[\"walletId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"Money-flow redesign plan 5.3 — \\\"luồng rút tiền bán thủ công\\\". Deliberately minimal: no\\\\npayout-API integration (chi ra ngoài vẫn thủ công, §5.3's explicit constraint). The ledger\\\\ndebit only happens at `markPaid`, when an admin confirms a real bank/e-wallet transfer\\\\nalready happened outside this system — this row exists to track that transfer, not to\\\\ntrigger it.\"},\"PaymentTransaction\":{\"dbName\":\"payment_transactions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payerId\",\"dbName\":\"payer_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"purpose\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PurposeType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptId\",\"dbName\":\"pt_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membershipId\",\"dbName\":\"membership_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptContractId\",\"dbName\":\"pt_contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"currency\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"VND\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PaymentStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"provider\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PaymentProviderType\",\"default\":\"MOCK\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerTransactionId\",\"dbName\":\"provider_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentMethod\",\"dbName\":\"payment_method\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idempotencyKey\",\"dbName\":\"idempotency_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requestFingerprint\",\"dbName\":\"request_fingerprint\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"extraData\",\"dbName\":\"extra_data\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidAt\",\"dbName\":\"paid_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"failedAt\",\"dbName\":\"failed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"refundedAt\",\"dbName\":\"refunded_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"metadata\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payerWalletId\",\"dbName\":\"payer_wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"receiverWalletId\",\"dbName\":\"receiver_wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relatedEntityType\",\"dbName\":\"related_entity_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"RelatedEntityType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relatedEntityId\",\"dbName\":\"related_entity_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"activationStatus\",\"dbName\":\"activation_status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ActivationStatus\",\"default\":\"NOT_APPLICABLE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"activationRetryCount\",\"dbName\":\"activation_retry_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastActivationRetryAt\",\"dbName\":\"last_activation_retry_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"initiatedBy\",\"dbName\":\"initiated_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"SYSTEM\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceService\",\"dbName\":\"source_service\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"payment-service\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"refundOfTransactionId\",\"dbName\":\"refund_of_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"commissions\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PlatformCommission\",\"relationName\":\"PaymentTransactionToPlatformCommission\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletLedgerEntry\",\"relationName\":\"PaymentTransactionToWalletLedgerEntry\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unpaidObligations\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligation\",\"relationName\":\"ContractUnpaidObligationToPaymentTransaction\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PlatformCommission\":{\"dbName\":\"platform_commissions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentTransactionId\",\"dbName\":\"payment_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerType\",\"dbName\":\"partner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerId\",\"dbName\":\"partner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"grossAmount\",\"dbName\":\"gross_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"platformFeeAmount\",\"dbName\":\"platform_fee_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerPayoutAmount\",\"dbName\":\"partner_payout_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"commissionRate\",\"dbName\":\"commission_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"CommissionStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"settledAt\",\"dbName\":\"settled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transaction\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentTransaction\",\"relationName\":\"PaymentTransactionToPlatformCommission\",\"relationFromFields\":[\"paymentTransactionId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PartnerReceivable\":{\"dbName\":\"partner_receivables\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerType\",\"dbName\":\"partner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerId\",\"dbName\":\"partner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recovered\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Recovered so far, by withholding from the partner's later credits.\"},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contractId\",\"dbName\":\"contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"settledAt\",\"dbName\":\"settled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"suspendedAt\",\"dbName\":\"suspended_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-8 (D62 C.4). Collection of THIS row is paused while suspendedAt is set. History is kept; nothing is\\\\nmarked paid and `recovered` is never touched. Set/cleared only by the audited adjustment operation.\"},{\"name\":\"suspendedBy\",\"dbName\":\"suspended_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"suspensionReason\",\"dbName\":\"suspension_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"suspensionRef\",\"dbName\":\"suspension_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Approval / minute number the owner gave for the suspension.\"},{\"name\":\"waived\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-8. Part of `amount` the platform has agreed to bear (forgiven). Outstanding = amount - recovered - waived.\"},{\"name\":\"waivedAt\",\"dbName\":\"waived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"waivedBy\",\"dbName\":\"waived_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"waiveReason\",\"dbName\":\"waive_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"waiveRef\",\"dbName\":\"waive_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"events\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerReceivableEvent\",\"relationName\":\"PartnerReceivableToPartnerReceivableEvent\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"Money a partner owes back to the platform.\\\\n\\\\nRaised when a client had to be made whole but the partner's buckets could not cover their\\\\nshare — a PT who missed enough sessions to exhaust their pending balance, typically. The\\\\nplatform fronts the cash so the client is never short-changed, and books the difference\\\\nhere. Without this row the shortfall would either push a wallet negative or silently break\\\\nthe reconciliation invariant; instead it stays visible and recoverable.\"},\"LedgerOperation\":{\"dbName\":\"ledger_operations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"result\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requestFingerprint\",\"dbName\":\"request_fingerprint\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-2b. Hash of the IMMUTABLE fields of the request that claimed this key (kind, transaction,\\\\nprice, session count, rates, parties, reason/outcome). NULL on rows written before the column\\\\nexisted and on callers that do not fingerprint: those replay exactly as they always did.\"},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-2b. The payment transaction the operation moved money for; lets a later operation (and\\\\nthe read-only lookup) find \\\"has this transaction been terminated\\\" without parsing keys.\"},{\"name\":\"kind\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-2b. RELEASE_SESSION | NO_SHOW | LATE_ARRIVAL | TERMINATE | RESOLVE_UNRESOLVED | ...\"}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"Business-key idempotency for financial ledger operations that are NOT a\\\\nPaymentTransaction (money-flow redesign plan item 1.1) — release-session,\\\\nno-show compensation, contract termination, membership referral settle/\\\\nclawback, membership pending-release. Each is written inside the SAME DB\\\\ntransaction as the wallet movements it guards (see contract-ledger.service.ts's\\\\n/ membership-ledger.service.ts's `withIdempotentLedgerOp`), so a crash between\\\\n\\\"money moved\\\" and \\\"this row committed\\\" is impossible: either both land or\\\\nneither does. A retry with the same `key` finds this row and replays `result`\\\\ninstead of moving money again — the \\\"gọi lại cùng khoá phải là thao tác vô hại\\\"\\\\nrequirement.\\\\n\\\\n`key` follows a fixed per-operation-type format so it is self-describing in an\\\\naudit query, e.g. `SESSION_RELEASE:<sessionId>`, `CONTRACT_TERMINATE:<contractId>`,\\\\n`MEMBERSHIP_RELEASE:<membershipId>` — see docs/money-flow.md for the full list.\"},\"ContractUnpaidObligation\":{\"dbName\":\"contract_unpaid_obligations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Idempotency key of the operation (OVER_RELEASED rows add `#OVER_RELEASED:<party>`).\"},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contractRef\",\"dbName\":\"contract_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Contract reference the caller labelled the operation with (the ledger label).\"},{\"name\":\"kind\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationKind\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"party\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Who the obligation is owed to: CLIENT, or the over-released party (PT | GYM | PLATFORM).\"},{\"name\":\"owed\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unpaid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"externallyPaid\",\"dbName\":\"externally_paid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-8: total paid to the client OUTSIDE this ledger (evidence in the events). Never a wallet credit.\"},{\"name\":\"verifiedPaid\",\"dbName\":\"verified_paid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"FH-8: total paid outside the ledger AND VERIFIED by a second person (sum of VERIFIED payments). Only this reduces `unpaid`\\\\nin the current lifecycle; `externallyPaid` is the legacy, unverified figure and is never written any more.\"},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ContractUnpaidObligationStatus\",\"default\":\"OPEN\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"resolvedAt\",\"dbName\":\"resolved_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"resolvedBy\",\"dbName\":\"resolved_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"resolvedNote\",\"dbName\":\"resolved_note\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Why the obligation exists, in words (D77: set by the record-only late-arrival operation; null on the rows FH-1 wrote).\"},{\"name\":\"transaction\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentTransaction\",\"relationName\":\"ContractUnpaidObligationToPaymentTransaction\",\"relationFromFields\":[\"transactionId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"events\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationEvent\",\"relationName\":\"ContractUnpaidObligationToContractUnpaidObligationEvent\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payments\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationPayment\",\"relationName\":\"ContractUnpaidObligationToContractUnpaidObligationPayment\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"FH-1 (D48 / N7). What a PT-fault step on ONE contract could not pay out of that contract's own\\\\npending money. It is an unpaid obligation TO THE CLIENT (or, for OVER_RELEASED, an incident for\\\\nthe admin) — never a PT debt: no PartnerReceivable is created, the platform does not front it and\\\\nthe PT's pooled balance is not touched. Written in the same DB transaction as the ledger rows,\\\\nkeyed by the idempotency key of the operation, so a retry can never create a second one.\"},\"PartnerReceivableEvent\":{\"dbName\":\"partner_receivable_events\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"receivableId\",\"dbName\":\"receivable_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"action\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerReceivableEventAction\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Amount the action concerned (the waived amount for WAIVE; the row's amount for SUSPEND/RESUME).\"},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvedBy\",\"dbName\":\"approved_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRef\",\"dbName\":\"approval_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idempotencyKey\",\"dbName\":\"idempotency_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"beforeJson\",\"dbName\":\"before_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"afterJson\",\"dbName\":\"after_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"receivable\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerReceivable\",\"relationName\":\"PartnerReceivableToPartnerReceivableEvent\",\"relationFromFields\":[\"receivableId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Restrict\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"FH-8. Append-only audit trail of every adjustment made to a PartnerReceivable. Rows are only ever inserted:\\\\nthe operation code never updates or deletes them. `idempotencyKey` makes a replayed operation a no-op.\"},\"ContractUnpaidObligationEvent\":{\"dbName\":\"contract_unpaid_obligation_events\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"obligationId\",\"dbName\":\"obligation_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"action\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationEventAction\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"note\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"actor\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRef\",\"dbName\":\"approval_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idempotencyKey\",\"dbName\":\"idempotency_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fromStatus\",\"dbName\":\"from_status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationStatus\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"toStatus\",\"dbName\":\"to_status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligationStatus\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unpaid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Unpaid amount at the time of the change (the CAS value the owner approved).\"},{\"name\":\"paidAmount\",\"dbName\":\"paid_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"PAY_EXTERNALLY evidence (null for the other actions): what was paid, the bank/transfer reference, the date it was paid,\\\\nwho approved it, and what stays unpaid afterwards.\"},{\"name\":\"transferReference\",\"dbName\":\"transfer_reference\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidOn\",\"dbName\":\"paid_on\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvedBy\",\"dbName\":\"approved_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unpaidAfter\",\"dbName\":\"unpaid_after\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentId\",\"dbName\":\"payment_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Payment lifecycle events (APPROVE_PAYMENT .. CANCEL_APPROVAL): the payment record, its manual source, the recipient\\\\n(taken from the ledger), the evidence pointers and who verified it.\"},{\"name\":\"paymentSource\",\"dbName\":\"payment_source\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recipient\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"evidenceRef\",\"dbName\":\"evidence_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"evidenceHash\",\"dbName\":\"evidence_hash\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bankStatementId\",\"dbName\":\"bank_statement_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"verifiedBy\",\"dbName\":\"verified_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"obligation\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligation\",\"relationName\":\"ContractUnpaidObligationToContractUnpaidObligationEvent\",\"relationFromFields\":[\"obligationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Restrict\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"FH-8. Append-only audit trail of status changes on ContractUnpaidObligation. A status change records who and why;\\\\nit moves no money.\"},\"ContractUnpaidObligationPayment\":{\"dbName\":\"contract_unpaid_obligation_payments\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"obligationId\",\"dbName\":\"obligation_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRef\",\"dbName\":\"approval_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ContractUnpaidObligationPaymentStatus\",\"default\":\"APPROVED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentSource\",\"dbName\":\"payment_source\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recipientParty\",\"dbName\":\"recipient_party\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recipientId\",\"dbName\":\"recipient_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvedBy\",\"dbName\":\"approved_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvedAt\",\"dbName\":\"approved_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidAmount\",\"dbName\":\"paid_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Evidence (recorded by `recordedBy` AFTER the payment was made outside): what was paid, the transfer reference, the day,\\\\nand a pointer to the proof (file reference / sha256 / bank statement id). NOT proof by itself - `verifiedBy` must confirm it.\"},{\"name\":\"transferReference\",\"dbName\":\"transfer_reference\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidOn\",\"dbName\":\"paid_on\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"evidenceRef\",\"dbName\":\"evidence_ref\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"evidenceHash\",\"dbName\":\"evidence_hash\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bankStatementId\",\"dbName\":\"bank_statement_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recordedBy\",\"dbName\":\"recorded_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recordedAt\",\"dbName\":\"recorded_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"verifiedBy\",\"dbName\":\"verified_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"verifiedAt\",\"dbName\":\"verified_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancelledBy\",\"dbName\":\"cancelled_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancelledAt\",\"dbName\":\"cancelled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancelReason\",\"dbName\":\"cancel_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"obligation\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ContractUnpaidObligation\",\"relationName\":\"ContractUnpaidObligationToContractUnpaidObligationPayment\",\"relationFromFields\":[\"obligationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Restrict\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"obligationId\",\"approvalRef\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"obligationId\",\"approvalRef\"]}],\"isGenerated\":false,\"documentation\":\"FH-8. ONE manual (outside-the-ledger) payment of an unpaid obligation: approved -> evidence submitted -> verified (or cancelled).\\\\nAt most ONE open (APPROVED / EVIDENCE_SUBMITTED) row per obligation (partial unique index in the migration), so the sum of\\\\nVERIFIED payments can never exceed what was owed. Recipient comes from the ledger (the obligation's party; for a CLIENT\\\\nobligation the payer of the payment transaction), never from input. Moves no money: no wallet / ledger / receivable row.\\\\nDELETE is rejected and the identity columns are immutable (trigger in the migration); the event table keeps the full history.\"},\"PaymentWebhookEvent\":{\"dbName\":\"payment_webhook_events\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"provider\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentProviderType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerEventId\",\"dbName\":\"provider_event_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerTransactionId\",\"dbName\":\"provider_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payload\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"processedAt\",\"dbName\":\"processed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"retryCount\",\"dbName\":\"retry_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastRetryAt\",\"dbName\":\"last_retry_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"provider\",\"providerEventId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"provider\",\"providerEventId\"]}],\"isGenerated\":false}},\"enums\":{\"PaymentStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"PROCESSING\",\"dbName\":null},{\"name\":\"PAID\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"REFUNDED\",\"dbName\":null}],\"dbName\":null},\"PaymentProviderType\":{\"values\":[{\"name\":\"MOCK\",\"dbName\":null},{\"name\":\"VNPAY\",\"dbName\":null},{\"name\":\"MOMO\",\"dbName\":null},{\"name\":\"ZALOPAY\",\"dbName\":null},{\"name\":\"PAYOS\",\"dbName\":null},{\"name\":\"STRIPE\",\"dbName\":null},{\"name\":\"MANUAL_BANK_TRANSFER\",\"dbName\":null}],\"dbName\":null},\"PartnerType\":{\"values\":[{\"name\":\"GYM\",\"dbName\":null},{\"name\":\"PT\",\"dbName\":null},{\"name\":\"CLIENT\",\"dbName\":null}],\"dbName\":null},\"CommissionStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"SETTLED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null}],\"dbName\":null},\"PurposeType\":{\"values\":[{\"name\":\"GYM_MEMBERSHIP\",\"dbName\":null},{\"name\":\"PT_CONTRACT\",\"dbName\":null},{\"name\":\"GYM_PT_COMBO\",\"dbName\":null},{\"name\":\"WALLET_TOPUP\",\"dbName\":null},{\"name\":\"REFUND\",\"dbName\":null},{\"name\":\"TRAINING_PACKAGE_PURCHASE\",\"dbName\":null},{\"name\":\"PERSONALIZED_SERVICE_PURCHASE\",\"dbName\":null},{\"name\":\"WITHDRAWAL\",\"dbName\":null,\"documentation\":\"Money-flow plan 5.3: the dedicated PaymentTransaction row markPaid creates for a\\\\nWithdrawalRequest payout. Outbound money has no originating gateway PaymentTransaction\\\\nto reuse the way REFUND reuses the original purchase's — WalletLedgerEntry.transactionId\\\\nis a hard FK, so a payout needs a row of its own to point at.\"}],\"dbName\":null},\"WalletOwnerType\":{\"values\":[{\"name\":\"CLIENT\",\"dbName\":null},{\"name\":\"PT\",\"dbName\":null},{\"name\":\"GYM\",\"dbName\":null},{\"name\":\"PLATFORM\",\"dbName\":null}],\"dbName\":null},\"WalletStatus\":{\"values\":[{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"FROZEN\",\"dbName\":null},{\"name\":\"CLOSED\",\"dbName\":null}],\"dbName\":null},\"LedgerEntryType\":{\"values\":[{\"name\":\"DEBIT\",\"dbName\":null},{\"name\":\"CREDIT\",\"dbName\":null}],\"dbName\":null},\"LedgerBucket\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"AVAILABLE\",\"dbName\":null},{\"name\":\"LOCKED\",\"dbName\":null},{\"name\":\"HOLDBACK\",\"dbName\":null}],\"dbName\":null,\"documentation\":\"Which of a wallet's three balances an entry moved. Releasing money from PENDING to\\\\nAVAILABLE is written as two entries sharing one transactionId: a PENDING debit and an\\\\nAVAILABLE credit, so the ledger stays double-entry and the release is auditable.\\\\nP0 cluster F: LOCKED added — a wallet's already-unused `lockedBalance` column finally gets\\\\na ledger-writing path. A withdrawal request approval moves AVAILABLE -> LOCKED (a hard\\\\nreservation a later clawback/refund cannot reach, since those only ever debit AVAILABLE);\\\\nthe actual payout later debits LOCKED (+ ESCROW); a rejection after approval moves LOCKED\\\\nback to AVAILABLE.\\\\n\\\\nFH-9: HOLDBACK added - the PT's EARNED-but-not-yet-withdrawable money for the contracts that carry a PT financial holdback\\\\n(10% of the PT's expected income on that contract, held until the contract has ended and is reconciled). It is a claim of the PT\\\\non ESCROW exactly like AVAILABLE, but nothing withdraws from it and no per-session / compensation path can reach it; it only\\\\nleaves through the two doors in contract-ledger.service (the contract's own verified PT-fault compensation, and the release to AVAILABLE).\\\\nPer contract the held amount is Σ HOLDBACK rows of that contract's payment transaction id.\"},\"RelatedEntityType\":{\"values\":[{\"name\":\"GYM_MEMBERSHIP\",\"dbName\":null},{\"name\":\"PT_CONTRACT\",\"dbName\":null},{\"name\":\"WALLET_TOPUP\",\"dbName\":null},{\"name\":\"TRAINING_PACKAGE_PURCHASE\",\"dbName\":null},{\"name\":\"PERSONALIZED_SERVICE_PURCHASE\",\"dbName\":null}],\"dbName\":null},\"ActivationStatus\":{\"values\":[{\"name\":\"NOT_APPLICABLE\",\"dbName\":null},{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"ACTIVATED\",\"dbName\":null},{\"name\":\"ACTIVATION_FAILED\",\"dbName\":null}],\"dbName\":null},\"WithdrawalRequestStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"PAID\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null}],\"dbName\":null},\"ContractUnpaidObligationKind\":{\"values\":[{\"name\":\"NO_SHOW\",\"dbName\":null},{\"name\":\"LATE_ARRIVAL\",\"dbName\":null},{\"name\":\"REFUND_SHORT\",\"dbName\":null},{\"name\":\"OVER_RELEASED\",\"dbName\":null}],\"dbName\":null},\"ContractUnpaidObligationStatus\":{\"values\":[{\"name\":\"OPEN\",\"dbName\":null},{\"name\":\"RESOLVED\",\"dbName\":null},{\"name\":\"WAIVED\",\"dbName\":null},{\"name\":\"UNDER_REVIEW\",\"dbName\":null},{\"name\":\"PAID_EXTERNALLY\",\"dbName\":null},{\"name\":\"APPROVED_FOR_PAYMENT\",\"dbName\":null},{\"name\":\"AWAITING_EVIDENCE\",\"dbName\":null},{\"name\":\"PAID_VERIFIED\",\"dbName\":null},{\"name\":\"RESOLVED_OTHER\",\"dbName\":null}],\"dbName\":null,\"documentation\":\"OPEN = recorded; UNDER_REVIEW = an owner/operator is looking at it.\\\\nPayment lifecycle (FH-8, owner decision: nothing is \\\"paid\\\" without VERIFIED evidence, by a second person):\\\\nAPPROVED_FOR_PAYMENT = an authorised approver approved paying an exact amount from a manual (outside-the-ledger) source;\\\\nAWAITING_EVIDENCE    = the payment was made outside and evidence was recorded; waiting for a DIFFERENT person to verify it;\\\\nPAID_VERIFIED        = the evidence was verified against the approval and the whole obligation is covered (terminal);\\\\na PARTIAL verified payment returns the row to OPEN with a smaller `unpaid` and `verifiedPaid` > 0.\\\\nWAIVED = the owner decided not to pursue (the client is NOT paid); RESOLVED_OTHER = settled by another method, reason mandatory.\\\\nLEGACY: PAID_EXTERNALLY = \\\"evidence recorded, NOT verified\\\" (written by the FH-8 first cut before verification existed; never\\\\nauto-upgraded, no new row can enter it); RESOLVED = legacy \\\"handled elsewhere\\\".\"},\"PartnerReceivableEventAction\":{\"values\":[{\"name\":\"SUSPEND\",\"dbName\":null},{\"name\":\"RESUME\",\"dbName\":null},{\"name\":\"WAIVE\",\"dbName\":null}],\"dbName\":null},\"ContractUnpaidObligationEventAction\":{\"values\":[{\"name\":\"RESOLVE\",\"dbName\":null},{\"name\":\"WAIVE\",\"dbName\":null},{\"name\":\"REVIEW\",\"dbName\":null},{\"name\":\"RELEASE_REVIEW\",\"dbName\":null},{\"name\":\"PAY_EXTERNALLY\",\"dbName\":null},{\"name\":\"APPROVE_PAYMENT\",\"dbName\":null},{\"name\":\"SUBMIT_EVIDENCE\",\"dbName\":null},{\"name\":\"VERIFY_PAYMENT\",\"dbName\":null},{\"name\":\"CANCEL_APPROVAL\",\"dbName\":null},{\"name\":\"RESOLVE_OTHER\",\"dbName\":null}],\"dbName\":null},\"ContractUnpaidObligationPaymentStatus\":{\"values\":[{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"EVIDENCE_SUBMITTED\",\"dbName\":null},{\"name\":\"VERIFIED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = undefined


const { warnEnvConflicts } = require('./runtime/library.js')

warnEnvConflicts({
    rootEnvPath: config.relativeEnvPaths.rootEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.rootEnvPath),
    schemaEnvPath: config.relativeEnvPaths.schemaEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.schemaEnvPath)
})

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

// file annotations for bundling tools to include these files
path.join(__dirname, "query_engine-windows.dll.node");
path.join(process.cwd(), "src/generated/prisma/query_engine-windows.dll.node")

// file annotations for bundling tools to include these files
path.join(__dirname, "libquery_engine-linux-musl-openssl-3.0.x.so.node");
path.join(process.cwd(), "src/generated/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node")

// file annotations for bundling tools to include these files
path.join(__dirname, "libquery_engine-rhel-openssl-3.0.x.so.node");
path.join(process.cwd(), "src/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node")
// file annotations for bundling tools to include these files
path.join(__dirname, "schema.prisma");
path.join(process.cwd(), "src/generated/prisma/schema.prisma")
