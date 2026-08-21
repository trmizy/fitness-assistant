
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
} = require('./runtime/edge.js')


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

exports.PurposeType = exports.$Enums.PurposeType = {
  GYM_MEMBERSHIP: 'GYM_MEMBERSHIP',
  PT_CONTRACT: 'PT_CONTRACT',
  GYM_PT_COMBO: 'GYM_PT_COMBO',
  WALLET_TOPUP: 'WALLET_TOPUP',
  REFUND: 'REFUND',
  TRAINING_PACKAGE_PURCHASE: 'TRAINING_PACKAGE_PURCHASE',
  PERSONALIZED_SERVICE_PURCHASE: 'PERSONALIZED_SERVICE_PURCHASE'
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

exports.Prisma.ModelName = {
  Wallet: 'Wallet',
  WalletLedgerEntry: 'WalletLedgerEntry',
  PaymentTransaction: 'PaymentTransaction',
  PlatformCommission: 'PlatformCommission',
  PartnerReceivable: 'PartnerReceivable',
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
      "value": "/app/backend/services/payment-service/src/generated/prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x",
        "native": true
      },
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x"
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "/app/backend/services/payment-service/prisma/schema.prisma",
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
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum PaymentStatus {\n  PENDING\n  PROCESSING\n  PAID\n  FAILED\n  CANCELLED\n  REFUNDED\n}\n\nenum PaymentProviderType {\n  MOCK\n  VNPAY\n  MOMO\n  ZALOPAY\n  PAYOS\n  STRIPE\n  MANUAL_BANK_TRANSFER\n}\n\nenum PartnerType {\n  GYM\n  PT\n  CLIENT\n}\n\nenum CommissionStatus {\n  PENDING\n  SETTLED\n  CANCELLED\n}\n\nenum PurposeType {\n  GYM_MEMBERSHIP\n  PT_CONTRACT\n  GYM_PT_COMBO\n  WALLET_TOPUP\n  REFUND\n  TRAINING_PACKAGE_PURCHASE\n  PERSONALIZED_SERVICE_PURCHASE\n}\n\nenum WalletOwnerType {\n  CLIENT\n  PT\n  GYM\n  PLATFORM\n}\n\nenum WalletStatus {\n  ACTIVE\n  FROZEN\n  CLOSED\n}\n\nenum LedgerEntryType {\n  DEBIT\n  CREDIT\n}\n\n/// Which of a wallet's two balances an entry moved. Releasing money from PENDING to\n/// AVAILABLE is written as two entries sharing one transactionId: a PENDING debit and an\n/// AVAILABLE credit, so the ledger stays double-entry and the release is auditable.\nenum LedgerBucket {\n  PENDING\n  AVAILABLE\n}\n\nenum RelatedEntityType {\n  GYM_MEMBERSHIP\n  PT_CONTRACT\n  WALLET_TOPUP\n  TRAINING_PACKAGE_PURCHASE\n  PERSONALIZED_SERVICE_PURCHASE\n}\n\nenum ActivationStatus {\n  NOT_APPLICABLE\n  PENDING\n  ACTIVATED\n  ACTIVATION_FAILED\n}\n\n/// Two-bucket wallet.\n///\n/// `pendingBalance` is money already attributed to the owner but not yet earned — it backs\n/// the sessions of a contract that have not happened yet, and is exactly the pot a refund\n/// draws from. `availableBalance` is money the owner may withdraw.\n///\n/// Two PLATFORM wallets exist, distinguished by ownerId (see PLATFORM_ESCROW_ID /\n/// PLATFORM_REVENUE_ID): ESCROW holds every đồng the platform is custodian of, REVENUE\n/// holds commission the platform has actually earned. Keeping them apart is what makes the\n/// reconciliation invariant checkable — a single mixed wallet has no interpretable balance\n/// once several contracts run at once.\nmodel Wallet {\n  id               String          @id @default(uuid())\n  ownerType        WalletOwnerType @map(\"owner_type\")\n  ownerId          String          @map(\"owner_id\")\n  availableBalance Decimal         @default(0) @map(\"available_balance\") @db.Decimal(14, 2)\n  pendingBalance   Decimal         @default(0) @map(\"pending_balance\") @db.Decimal(14, 2)\n  lockedBalance    Decimal         @default(0) @map(\"locked_balance\") @db.Decimal(14, 2)\n  status           WalletStatus    @default(ACTIVE)\n  createdAt        DateTime        @default(now()) @map(\"created_at\")\n  updatedAt        DateTime        @updatedAt @map(\"updated_at\")\n\n  ledgerEntries WalletLedgerEntry[]\n\n  @@unique([ownerType, ownerId])\n  @@map(\"wallets\")\n}\n\nmodel WalletLedgerEntry {\n  id            String          @id @default(uuid())\n  walletId      String          @map(\"wallet_id\")\n  transactionId String          @map(\"transaction_id\")\n  entryType     LedgerEntryType @map(\"entry_type\")\n  /// Which balance moved. balanceBefore/balanceAfter are that bucket's running total, so a\n  /// wallet's two buckets each form their own unbroken chain.\n  bucket        LedgerBucket    @default(AVAILABLE)\n  amount        Decimal         @db.Decimal(14, 2)\n  balanceBefore Decimal         @map(\"balance_before\") @db.Decimal(14, 2)\n  balanceAfter  Decimal         @map(\"balance_after\") @db.Decimal(14, 2)\n  description   String?\n  createdAt     DateTime        @default(now()) @map(\"created_at\")\n\n  wallet      Wallet             @relation(fields: [walletId], references: [id])\n  transaction PaymentTransaction @relation(fields: [transactionId], references: [id])\n\n  @@index([walletId, createdAt])\n  @@index([walletId, bucket, createdAt])\n  @@index([transactionId])\n  @@map(\"wallet_ledger_entries\")\n}\n\nmodel PaymentTransaction {\n  id                    String              @id @default(uuid())\n  payerId               String              @map(\"payer_id\")\n  purpose               PurposeType\n  gymId                 String?             @map(\"gym_id\")\n  ptId                  String?             @map(\"pt_id\")\n  membershipId          String?             @map(\"membership_id\")\n  ptContractId          String?             @map(\"pt_contract_id\")\n  amount                Decimal             @db.Decimal(12, 2)\n  currency              String              @default(\"VND\")\n  status                PaymentStatus       @default(PENDING)\n  provider              PaymentProviderType @default(MOCK)\n  providerTransactionId String?             @map(\"provider_transaction_id\")\n  paymentMethod         String?             @map(\"payment_method\")\n  idempotencyKey        String              @unique @map(\"idempotency_key\")\n  requestFingerprint    String?             @map(\"request_fingerprint\")\n  extraData             String?             @map(\"extra_data\")\n  paidAt                DateTime?           @map(\"paid_at\")\n  failedAt              DateTime?           @map(\"failed_at\")\n  refundedAt            DateTime?           @map(\"refunded_at\")\n  metadata              Json?\n\n  payerWalletId         String?            @map(\"payer_wallet_id\")\n  receiverWalletId      String?            @map(\"receiver_wallet_id\")\n  relatedEntityType     RelatedEntityType? @map(\"related_entity_type\")\n  relatedEntityId       String?            @map(\"related_entity_id\")\n  activationStatus      ActivationStatus   @default(NOT_APPLICABLE) @map(\"activation_status\")\n  // On REFUND-purpose rows, \"activation\" means \"the downstream cancel-after-refund succeeded\" —\n  // reusing this one status/retry pair for both flows avoids a near-duplicate set of columns.\n  activationRetryCount  Int                @default(0) @map(\"activation_retry_count\")\n  lastActivationRetryAt DateTime?          @map(\"last_activation_retry_at\")\n  initiatedBy           String?            @default(\"SYSTEM\") @map(\"initiated_by\")\n  sourceService         String?            @default(\"payment-service\") @map(\"source_service\")\n  refundOfTransactionId String?            @map(\"refund_of_transaction_id\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  commissions   PlatformCommission[]\n  ledgerEntries WalletLedgerEntry[]\n\n  @@index([payerId, status])\n  @@index([status])\n  @@index([providerTransactionId])\n  @@index([purpose, status, activationStatus])\n  @@index([refundOfTransactionId])\n  @@map(\"payment_transactions\")\n}\n\nmodel PlatformCommission {\n  id                   String           @id @default(uuid())\n  paymentTransactionId String           @map(\"payment_transaction_id\")\n  partnerType          PartnerType      @map(\"partner_type\")\n  partnerId            String           @map(\"partner_id\")\n  grossAmount          Decimal          @map(\"gross_amount\") @db.Decimal(12, 2)\n  platformFeeAmount    Decimal          @map(\"platform_fee_amount\") @db.Decimal(12, 2)\n  partnerPayoutAmount  Decimal          @map(\"partner_payout_amount\") @db.Decimal(12, 2)\n  commissionRate       Decimal          @map(\"commission_rate\") @db.Decimal(5, 4)\n  status               CommissionStatus @default(PENDING)\n  settledAt            DateTime?        @map(\"settled_at\")\n  createdAt            DateTime         @default(now()) @map(\"created_at\")\n\n  transaction PaymentTransaction @relation(fields: [paymentTransactionId], references: [id])\n\n  @@index([partnerType, partnerId, status])\n  @@index([paymentTransactionId])\n  @@map(\"platform_commissions\")\n}\n\n/// Money a partner owes back to the platform.\n///\n/// Raised when a client had to be made whole but the partner's buckets could not cover their\n/// share — a PT who missed enough sessions to exhaust their pending balance, typically. The\n/// platform fronts the cash so the client is never short-changed, and books the difference\n/// here. Without this row the shortfall would either push a wallet negative or silently break\n/// the reconciliation invariant; instead it stays visible and recoverable.\nmodel PartnerReceivable {\n  id            String      @id @default(uuid())\n  partnerType   PartnerType @map(\"partner_type\")\n  partnerId     String      @map(\"partner_id\")\n  amount        Decimal     @db.Decimal(14, 2)\n  /// Recovered so far, by withholding from the partner's later credits.\n  recovered     Decimal     @default(0) @db.Decimal(14, 2)\n  reason        String\n  contractId    String?     @map(\"contract_id\")\n  transactionId String?     @map(\"transaction_id\")\n  settledAt     DateTime?   @map(\"settled_at\")\n  createdAt     DateTime    @default(now()) @map(\"created_at\")\n  updatedAt     DateTime    @updatedAt @map(\"updated_at\")\n\n  @@index([partnerType, partnerId, settledAt])\n  @@map(\"partner_receivables\")\n}\n\nmodel PaymentWebhookEvent {\n  id                    String              @id @default(uuid())\n  provider              PaymentProviderType\n  providerEventId       String              @map(\"provider_event_id\")\n  providerTransactionId String?             @map(\"provider_transaction_id\")\n  payload               Json\n  processedAt           DateTime?           @map(\"processed_at\")\n  retryCount            Int                 @default(0) @map(\"retry_count\")\n  lastRetryAt           DateTime?           @map(\"last_retry_at\")\n  createdAt             DateTime            @default(now()) @map(\"created_at\")\n\n  @@unique([provider, providerEventId])\n  @@index([processedAt, retryCount])\n  @@map(\"payment_webhook_events\")\n}\n",
  "inlineSchemaHash": "f9005978b0d770f7c47b85e6819be4bde97e59e54e927ac5587bc12262c30f01",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Wallet\":{\"dbName\":\"wallets\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerType\",\"dbName\":\"owner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletOwnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableBalance\",\"dbName\":\"available_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"pendingBalance\",\"dbName\":\"pending_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lockedBalance\",\"dbName\":\"locked_balance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"WalletStatus\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletLedgerEntry\",\"relationName\":\"WalletToWalletLedgerEntry\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"ownerType\",\"ownerId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"ownerType\",\"ownerId\"]}],\"isGenerated\":false,\"documentation\":\"Two-bucket wallet.\\\\n\\\\n`pendingBalance` is money already attributed to the owner but not yet earned — it backs\\\\nthe sessions of a contract that have not happened yet, and is exactly the pot a refund\\\\ndraws from. `availableBalance` is money the owner may withdraw.\\\\n\\\\nTwo PLATFORM wallets exist, distinguished by ownerId (see PLATFORM_ESCROW_ID /\\\\nPLATFORM_REVENUE_ID): ESCROW holds every đồng the platform is custodian of, REVENUE\\\\nholds commission the platform has actually earned. Keeping them apart is what makes the\\\\nreconciliation invariant checkable — a single mixed wallet has no interpretable balance\\\\nonce several contracts run at once.\"},\"WalletLedgerEntry\":{\"dbName\":\"wallet_ledger_entries\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"walletId\",\"dbName\":\"wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entryType\",\"dbName\":\"entry_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"LedgerEntryType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bucket\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"LedgerBucket\",\"default\":\"AVAILABLE\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Which balance moved. balanceBefore/balanceAfter are that bucket's running total, so a\\\\nwallet's two buckets each form their own unbroken chain.\"},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"balanceBefore\",\"dbName\":\"balance_before\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"balanceAfter\",\"dbName\":\"balance_after\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"wallet\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Wallet\",\"relationName\":\"WalletToWalletLedgerEntry\",\"relationFromFields\":[\"walletId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transaction\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentTransaction\",\"relationName\":\"PaymentTransactionToWalletLedgerEntry\",\"relationFromFields\":[\"transactionId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PaymentTransaction\":{\"dbName\":\"payment_transactions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payerId\",\"dbName\":\"payer_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"purpose\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PurposeType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptId\",\"dbName\":\"pt_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membershipId\",\"dbName\":\"membership_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptContractId\",\"dbName\":\"pt_contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"currency\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"VND\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PaymentStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"provider\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PaymentProviderType\",\"default\":\"MOCK\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerTransactionId\",\"dbName\":\"provider_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentMethod\",\"dbName\":\"payment_method\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idempotencyKey\",\"dbName\":\"idempotency_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requestFingerprint\",\"dbName\":\"request_fingerprint\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"extraData\",\"dbName\":\"extra_data\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paidAt\",\"dbName\":\"paid_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"failedAt\",\"dbName\":\"failed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"refundedAt\",\"dbName\":\"refunded_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"metadata\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payerWalletId\",\"dbName\":\"payer_wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"receiverWalletId\",\"dbName\":\"receiver_wallet_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relatedEntityType\",\"dbName\":\"related_entity_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"RelatedEntityType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relatedEntityId\",\"dbName\":\"related_entity_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"activationStatus\",\"dbName\":\"activation_status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ActivationStatus\",\"default\":\"NOT_APPLICABLE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"activationRetryCount\",\"dbName\":\"activation_retry_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastActivationRetryAt\",\"dbName\":\"last_activation_retry_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"initiatedBy\",\"dbName\":\"initiated_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"SYSTEM\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceService\",\"dbName\":\"source_service\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"payment-service\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"refundOfTransactionId\",\"dbName\":\"refund_of_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"commissions\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PlatformCommission\",\"relationName\":\"PaymentTransactionToPlatformCommission\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ledgerEntries\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WalletLedgerEntry\",\"relationName\":\"PaymentTransactionToWalletLedgerEntry\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PlatformCommission\":{\"dbName\":\"platform_commissions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentTransactionId\",\"dbName\":\"payment_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerType\",\"dbName\":\"partner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerId\",\"dbName\":\"partner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"grossAmount\",\"dbName\":\"gross_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"platformFeeAmount\",\"dbName\":\"platform_fee_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerPayoutAmount\",\"dbName\":\"partner_payout_amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"commissionRate\",\"dbName\":\"commission_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"CommissionStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"settledAt\",\"dbName\":\"settled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transaction\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentTransaction\",\"relationName\":\"PaymentTransactionToPlatformCommission\",\"relationFromFields\":[\"paymentTransactionId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PartnerReceivable\":{\"dbName\":\"partner_receivables\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerType\",\"dbName\":\"partner_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PartnerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"partnerId\",\"dbName\":\"partner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"recovered\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Recovered so far, by withholding from the partner's later credits.\"},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contractId\",\"dbName\":\"contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"transactionId\",\"dbName\":\"transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"settledAt\",\"dbName\":\"settled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"Money a partner owes back to the platform.\\\\n\\\\nRaised when a client had to be made whole but the partner's buckets could not cover their\\\\nshare — a PT who missed enough sessions to exhaust their pending balance, typically. The\\\\nplatform fronts the cash so the client is never short-changed, and books the difference\\\\nhere. Without this row the shortfall would either push a wallet negative or silently break\\\\nthe reconciliation invariant; instead it stays visible and recoverable.\"},\"PaymentWebhookEvent\":{\"dbName\":\"payment_webhook_events\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"provider\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PaymentProviderType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerEventId\",\"dbName\":\"provider_event_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"providerTransactionId\",\"dbName\":\"provider_transaction_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payload\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"processedAt\",\"dbName\":\"processed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"retryCount\",\"dbName\":\"retry_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastRetryAt\",\"dbName\":\"last_retry_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"provider\",\"providerEventId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"provider\",\"providerEventId\"]}],\"isGenerated\":false}},\"enums\":{\"PaymentStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"PROCESSING\",\"dbName\":null},{\"name\":\"PAID\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"REFUNDED\",\"dbName\":null}],\"dbName\":null},\"PaymentProviderType\":{\"values\":[{\"name\":\"MOCK\",\"dbName\":null},{\"name\":\"VNPAY\",\"dbName\":null},{\"name\":\"MOMO\",\"dbName\":null},{\"name\":\"ZALOPAY\",\"dbName\":null},{\"name\":\"PAYOS\",\"dbName\":null},{\"name\":\"STRIPE\",\"dbName\":null},{\"name\":\"MANUAL_BANK_TRANSFER\",\"dbName\":null}],\"dbName\":null},\"PartnerType\":{\"values\":[{\"name\":\"GYM\",\"dbName\":null},{\"name\":\"PT\",\"dbName\":null},{\"name\":\"CLIENT\",\"dbName\":null}],\"dbName\":null},\"CommissionStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"SETTLED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null}],\"dbName\":null},\"PurposeType\":{\"values\":[{\"name\":\"GYM_MEMBERSHIP\",\"dbName\":null},{\"name\":\"PT_CONTRACT\",\"dbName\":null},{\"name\":\"GYM_PT_COMBO\",\"dbName\":null},{\"name\":\"WALLET_TOPUP\",\"dbName\":null},{\"name\":\"REFUND\",\"dbName\":null},{\"name\":\"TRAINING_PACKAGE_PURCHASE\",\"dbName\":null},{\"name\":\"PERSONALIZED_SERVICE_PURCHASE\",\"dbName\":null}],\"dbName\":null},\"WalletOwnerType\":{\"values\":[{\"name\":\"CLIENT\",\"dbName\":null},{\"name\":\"PT\",\"dbName\":null},{\"name\":\"GYM\",\"dbName\":null},{\"name\":\"PLATFORM\",\"dbName\":null}],\"dbName\":null},\"WalletStatus\":{\"values\":[{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"FROZEN\",\"dbName\":null},{\"name\":\"CLOSED\",\"dbName\":null}],\"dbName\":null},\"LedgerEntryType\":{\"values\":[{\"name\":\"DEBIT\",\"dbName\":null},{\"name\":\"CREDIT\",\"dbName\":null}],\"dbName\":null},\"LedgerBucket\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"AVAILABLE\",\"dbName\":null}],\"dbName\":null,\"documentation\":\"Which of a wallet's two balances an entry moved. Releasing money from PENDING to\\\\nAVAILABLE is written as two entries sharing one transactionId: a PENDING debit and an\\\\nAVAILABLE credit, so the ledger stays double-entry and the release is auditable.\"},\"RelatedEntityType\":{\"values\":[{\"name\":\"GYM_MEMBERSHIP\",\"dbName\":null},{\"name\":\"PT_CONTRACT\",\"dbName\":null},{\"name\":\"WALLET_TOPUP\",\"dbName\":null},{\"name\":\"TRAINING_PACKAGE_PURCHASE\",\"dbName\":null},{\"name\":\"PERSONALIZED_SERVICE_PURCHASE\",\"dbName\":null}],\"dbName\":null},\"ActivationStatus\":{\"values\":[{\"name\":\"NOT_APPLICABLE\",\"dbName\":null},{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"ACTIVATED\",\"dbName\":null},{\"name\":\"ACTIVATION_FAILED\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = undefined

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

