
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

exports.Prisma.GymBrandScalarFieldEnum = {
  id: 'id',
  ownerId: 'ownerId',
  name: 'name',
  description: 'description',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymScalarFieldEnum = {
  id: 'id',
  ownerId: 'ownerId',
  brandId: 'brandId',
  name: 'name',
  description: 'description',
  address: 'address',
  city: 'city',
  phone: 'phone',
  email: 'email',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymMembershipPlanScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  name: 'name',
  description: 'description',
  price: 'price',
  durationDays: 'durationDays',
  visitLimit: 'visitLimit',
  status: 'status',
  saleStartAt: 'saleStartAt',
  saleEndAt: 'saleEndAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymMembershipContractScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  planId: 'planId',
  clientId: 'clientId',
  status: 'status',
  paymentTxnId: 'paymentTxnId',
  startDate: 'startDate',
  endDate: 'endDate',
  priceAtPurchase: 'priceAtPurchase',
  durationDaysSnapshot: 'durationDaysSnapshot',
  totalVisits: 'totalVisits',
  usedVisits: 'usedVisits',
  payoutReleasedAt: 'payoutReleasedAt',
  multiGymWarned: 'multiGymWarned',
  refundClawbackDone: 'refundClawbackDone',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymTrainerAffiliationScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  ptId: 'ptId',
  status: 'status',
  employmentType: 'employmentType',
  visibility: 'visibility',
  commissionRate: 'commissionRate',
  invitedBy: 'invitedBy',
  joinedAt: 'joinedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymCheckInScalarFieldEnum = {
  id: 'id',
  membershipId: 'membershipId',
  gymId: 'gymId',
  clientId: 'clientId',
  checkedInBy: 'checkedInBy',
  createdAt: 'createdAt'
};

exports.Prisma.GymReviewScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  clientId: 'clientId',
  rating: 'rating',
  comment: 'comment',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymPtCollaborationScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  ptUserId: 'ptUserId',
  proposedPtRate: 'proposedPtRate',
  proposedGymRate: 'proposedGymRate',
  platformRate: 'platformRate',
  status: 'status',
  proposedBy: 'proposedBy',
  round: 'round',
  expiresAt: 'expiresAt',
  acceptedAt: 'acceptedAt',
  terminatedAt: 'terminatedAt',
  terminatedBy: 'terminatedBy',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymMembershipReferralScalarFieldEnum = {
  id: 'id',
  membershipContractId: 'membershipContractId',
  gymId: 'gymId',
  referrerPtUserId: 'referrerPtUserId',
  rate: 'rate',
  amount: 'amount',
  clawedBack: 'clawedBack',
  status: 'status',
  releasedAt: 'releasedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};
exports.GymStatus = exports.$Enums.GymStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

exports.GymMembershipPlanStatus = exports.$Enums.GymMembershipPlanStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.GymMembershipContractStatus = exports.$Enums.GymMembershipContractStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  PENDING_ISSUE: 'PENDING_ISSUE'
};

exports.AffiliationStatus = exports.$Enums.AffiliationStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

exports.AffiliationEmployment = exports.$Enums.AffiliationEmployment = {
  IN_HOUSE: 'IN_HOUSE',
  FREELANCE: 'FREELANCE',
  PARTNER: 'PARTNER'
};

exports.GymTrainerVisibility = exports.$Enums.GymTrainerVisibility = {
  PUBLIC: 'PUBLIC',
  INTERNAL_ONLY: 'INTERNAL_ONLY'
};

exports.CollaborationStatus = exports.$Enums.CollaborationStatus = {
  PENDING: 'PENDING',
  COUNTERED: 'COUNTERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED'
};

exports.CollaborationParty = exports.$Enums.CollaborationParty = {
  PT: 'PT',
  GYM: 'GYM'
};

exports.Prisma.ModelName = {
  GymBrand: 'GymBrand',
  Gym: 'Gym',
  GymMembershipPlan: 'GymMembershipPlan',
  GymMembershipContract: 'GymMembershipContract',
  GymTrainerAffiliation: 'GymTrainerAffiliation',
  GymCheckIn: 'GymCheckIn',
  GymReview: 'GymReview',
  GymPtCollaboration: 'GymPtCollaboration',
  GymMembershipReferral: 'GymMembershipReferral'
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
      "value": "D:\\FitnessAssistant\\backend\\services\\gym-service\\src\\generated\\prisma",
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
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "D:\\FitnessAssistant\\backend\\services\\gym-service\\prisma\\schema.prisma",
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
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum GymStatus {\n  PENDING_REVIEW\n  APPROVED\n  REJECTED\n  SUSPENDED\n}\n\nenum GymMembershipPlanStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum GymMembershipContractStatus {\n  PENDING_PAYMENT\n  ACTIVE\n  EXPIRED\n  CANCELLED\n  /// P0 cluster E2 — the gym was suspended/closed/removed between checkout and the payment\n  /// webhook: money already settled into escrow + gym/platform pending, but activating a\n  /// membership at a gym no longer allowed to operate would be wrong. An auto-refund is\n  /// attempted immediately (see membershipService.resolvePendingIssue); if that itself fails\n  /// (payment-service unreachable), the row stays here as an admin queue until manually\n  /// resolved — never silently dropped.\n  PENDING_ISSUE\n}\n\nenum AffiliationStatus {\n  PENDING\n  ACTIVE\n  REJECTED\n  SUSPENDED\n}\n\nenum AffiliationEmployment {\n  IN_HOUSE\n  FREELANCE\n  PARTNER\n}\n\nenum GymTrainerVisibility {\n  PUBLIC\n  INTERNAL_ONLY\n}\n\n/// A chain: one owner, one name, many physical locations (Gym rows below). Optional —\n/// a gym created without ever choosing a brand stays exactly as it always has, a single\n/// standalone location with `brandId = null`. Client search groups branches under their\n/// brand's card; a gym with no brand is just its own card, same as before this feature.\nmodel GymBrand {\n  id          String   @id @default(uuid())\n  ownerId     String   @map(\"owner_id\")\n  name        String\n  description String?\n  createdAt   DateTime @default(now()) @map(\"created_at\")\n  updatedAt   DateTime @updatedAt @map(\"updated_at\")\n\n  branches Gym[]\n\n  @@index([ownerId])\n  @@map(\"gym_brands\")\n}\n\nmodel Gym {\n  id          String    @id @default(uuid())\n  ownerId     String    @map(\"owner_id\")\n  /// Which brand this location belongs to, if any. A branch's own plans, wallet, checkins,\n  /// and reviews stay keyed to this row exactly as for a standalone gym — brand is purely\n  /// a grouping label for search and owner navigation, not a second source of truth.\n  brandId     String?   @map(\"brand_id\")\n  name        String\n  description String?\n  address     String\n  city        String?\n  phone       String?\n  email       String?\n  status      GymStatus @default(PENDING_REVIEW)\n  createdAt   DateTime  @default(now()) @map(\"created_at\")\n  updatedAt   DateTime  @updatedAt @map(\"updated_at\")\n\n  brand          GymBrand?               @relation(fields: [brandId], references: [id])\n  plans          GymMembershipPlan[]\n  memberships    GymMembershipContract[]\n  affiliations   GymTrainerAffiliation[]\n  reviews        GymReview[]\n  collaborations GymPtCollaboration[]\n\n  @@index([status])\n  @@index([ownerId])\n  @@index([brandId])\n  @@map(\"gyms\")\n}\n\nmodel GymMembershipPlan {\n  id           String                  @id @default(uuid())\n  gymId        String                  @map(\"gym_id\")\n  name         String\n  description  String?\n  price        Decimal                 @db.Decimal(12, 2)\n  durationDays Int                     @map(\"duration_days\")\n  visitLimit   Int?                    @map(\"visit_limit\")\n  status       GymMembershipPlanStatus @default(ACTIVE)\n  /// Optional marketing window: the plan can only be PURCHASED while now is inside\n  /// [saleStartAt, saleEndAt]. Distinct from durationDays, which is how long a membership\n  /// lasts once bought — the sale window closing never shortens a membership already sold.\n  /// Both null (the common case) means always on sale while status is ACTIVE.\n  saleStartAt  DateTime?               @map(\"sale_start_at\")\n  saleEndAt    DateTime?               @map(\"sale_end_at\")\n  createdAt    DateTime                @default(now()) @map(\"created_at\")\n  updatedAt    DateTime                @updatedAt @map(\"updated_at\")\n\n  gym         Gym                     @relation(fields: [gymId], references: [id])\n  memberships GymMembershipContract[]\n\n  @@index([gymId, status])\n  @@map(\"gym_membership_plans\")\n}\n\nmodel GymMembershipContract {\n  id                   String                      @id @default(uuid())\n  gymId                String                      @map(\"gym_id\")\n  planId               String                      @map(\"plan_id\")\n  clientId             String                      @map(\"client_id\")\n  status               GymMembershipContractStatus @default(PENDING_PAYMENT)\n  paymentTxnId         String?                     @map(\"payment_txn_id\")\n  startDate            DateTime?                   @map(\"start_date\")\n  endDate              DateTime?                   @map(\"end_date\")\n  priceAtPurchase      Decimal                     @map(\"price_at_purchase\") @db.Decimal(12, 2)\n  durationDaysSnapshot Int                         @map(\"duration_days_snapshot\")\n  totalVisits          Int?                        @map(\"total_visits\")\n  usedVisits           Int                         @default(0) @map(\"used_visits\")\n  /// Stamped once the pending-bucket payout (gym + platform + any un-clawed referral\n  /// commission) has been released to AVAILABLE. Set by the payout sweep on natural\n  /// expiry, or immediately on client self-cancel / admin refund — see docs/money-flow.md.\n  /// Guards membership-release against double-releasing the same membership.\n  payoutReleasedAt     DateTime?                   @map(\"payout_released_at\")\n  /// True when the client confirmed purchase after being shown a warning that they already\n  /// hold an active membership at a different gym — evidence against \"I didn't know I still\n  /// had one elsewhere\" disputes.\n  multiGymWarned       Boolean                     @default(false) @map(\"multi_gym_warned\")\n  /// Money-flow plan 1.7: set right after `refundByAdmin`'s referral-clawback step commits\n  /// its LOCAL bookkeeping (`GymMembershipReferral.clawedBack`). That local increment is not\n  /// itself idempotent — payment-service's own idempotency guard (plan 1.1) means a retried\n  /// `clawbackReferral` call just returns the FIRST attempt's cached amount rather than\n  /// re-debiting anything, but gym-service would still add that cached amount onto\n  /// `clawedBack` a second time if it re-entered the branch. `refundByAdmin` is one-shot per\n  /// membership (blocked once status flips to CANCELLED), so this flag only ever needs to\n  /// answer one question: did THIS refund's clawback step already run.\n  refundClawbackDone   Boolean                     @default(false) @map(\"refund_clawback_done\")\n  createdAt            DateTime                    @default(now()) @map(\"created_at\")\n  updatedAt            DateTime                    @updatedAt @map(\"updated_at\")\n\n  gym      Gym                    @relation(fields: [gymId], references: [id])\n  plan     GymMembershipPlan      @relation(fields: [planId], references: [id])\n  checkIns GymCheckIn[]\n  referral GymMembershipReferral?\n\n  @@index([clientId, status])\n  @@index([gymId, status])\n  @@map(\"gym_membership_contracts\")\n}\n\nmodel GymTrainerAffiliation {\n  id             String                @id @default(uuid())\n  gymId          String                @map(\"gym_id\")\n  ptId           String                @map(\"pt_id\")\n  status         AffiliationStatus     @default(PENDING)\n  employmentType AffiliationEmployment @default(FREELANCE) @map(\"employment_type\")\n  visibility     GymTrainerVisibility  @default(PUBLIC)\n  commissionRate Decimal?              @map(\"commission_rate\") @db.Decimal(5, 4)\n  invitedBy      String?               @map(\"invited_by\")\n  joinedAt       DateTime?             @map(\"joined_at\")\n  createdAt      DateTime              @default(now()) @map(\"created_at\")\n  updatedAt      DateTime              @updatedAt @map(\"updated_at\")\n\n  gym Gym @relation(fields: [gymId], references: [id])\n\n  @@unique([gymId, ptId])\n  @@index([ptId, status])\n  @@index([gymId, status])\n  @@map(\"gym_trainer_affiliations\")\n}\n\n// ─── Gym Check-in (member scans in at the gym) ────────────────────────\nmodel GymCheckIn {\n  id           String   @id @default(uuid())\n  membershipId String   @map(\"membership_id\")\n  gymId        String   @map(\"gym_id\")\n  clientId     String   @map(\"client_id\")\n  checkedInBy  String   @map(\"checked_in_by\") // owner userId who scanned\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n\n  membership GymMembershipContract @relation(fields: [membershipId], references: [id])\n\n  @@index([gymId, createdAt])\n  @@index([membershipId, createdAt])\n  @@map(\"gym_check_ins\")\n}\n\n// ─── Gym Review / Rating (one per member per gym) ─────────────────────\nmodel GymReview {\n  id        String   @id @default(uuid())\n  gymId     String   @map(\"gym_id\")\n  clientId  String   @map(\"client_id\")\n  rating    Int // 1–5\n  comment   String?\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  gym Gym @relation(fields: [gymId], references: [id])\n\n  @@unique([gymId, clientId])\n  @@index([gymId])\n  @@map(\"gym_reviews\")\n}\n\n// ─── PT ↔ gym collaboration (revenue-share negotiation) ───────────────\n\nenum CollaborationStatus {\n  PENDING // waiting on the other side's first answer\n  COUNTERED // the other side proposed different rates; the ball is back\n  ACCEPTED // terms agreed and locked\n  REJECTED // turned down outright\n  EXPIRED // ran out of time or out of negotiating rounds\n  TERMINATED // the partnership was ended after it had been accepted\n}\n\nenum CollaborationParty {\n  PT\n  GYM\n}\n\n/// A revenue-share agreement between a trainer and a gym.\n///\n/// A PT affiliated with a gym trains clients on the gym's floor and checks in free; in return\n/// the gym takes a cut of the contracts that PT signs there. Both sides have to agree on the\n/// split, so this row carries the negotiation as well as the outcome — each counter-offer\n/// overwrites the proposed rates and flips `proposedBy`, so whose turn it is is never\n/// ambiguous.\n///\n/// The rates here are a TEMPLATE, not the source of truth for any contract. When a contract is\n/// signed it copies them onto itself (see docs/money-flow.md §12); renegotiating afterwards\n/// leaves existing contracts on the terms their parties actually agreed to.\nmodel GymPtCollaboration {\n  id       String @id @default(uuid())\n  gymId    String @map(\"gym_id\")\n  ptUserId String @map(\"pt_user_id\")\n\n  /// Currently on the table. Must satisfy proposedPtRate + proposedGymRate + platformRate = 1.\n  proposedPtRate  Decimal @map(\"proposed_pt_rate\") @db.Decimal(6, 4)\n  proposedGymRate Decimal @map(\"proposed_gym_rate\") @db.Decimal(6, 4)\n  /// Stored so the accepted row is a complete snapshot rather than half a rate table.\n  platformRate    Decimal @default(\"0.10\") @map(\"platform_rate\") @db.Decimal(6, 4)\n\n  status     CollaborationStatus @default(PENDING)\n  /// Who made the offer currently on the table — i.e. whose turn it is NOT.\n  proposedBy CollaborationParty  @map(\"proposed_by\")\n  /// Counter-offers so far. Capped so a negotiation cannot run forever.\n  round      Int                 @default(1)\n  expiresAt  DateTime            @map(\"expires_at\")\n\n  acceptedAt   DateTime? @map(\"accepted_at\")\n  terminatedAt DateTime? @map(\"terminated_at\")\n  terminatedBy String?   @map(\"terminated_by\")\n  note         String?\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  gym Gym @relation(fields: [gymId], references: [id])\n\n  @@index([gymId, status])\n  @@index([ptUserId, status])\n  @@map(\"gym_pt_collaborations\")\n}\n\n/// Commission owed to a PT for introducing a client who bought a gym membership.\n///\n/// Paid out of the GYM's share, never the platform's — the platform did no introducing. The\n/// `clawedBack` column exists because a refunded membership must reverse the commission in\n/// proportion; a referral system that pays on purchase but forgets to reclaim on refund leaks\n/// money on every cancellation.\nmodel GymMembershipReferral {\n  id                   String    @id @default(uuid())\n  membershipContractId String    @unique @map(\"membership_contract_id\")\n  gymId                String    @map(\"gym_id\")\n  referrerPtUserId     String    @map(\"referrer_pt_user_id\")\n  rate                 Decimal   @db.Decimal(6, 4)\n  /// Gross commission earned at purchase time.\n  amount               Decimal   @db.Decimal(14, 2)\n  /// Reversed so far, following partial refunds of the membership.\n  clawedBack           Decimal   @default(0) @map(\"clawed_back\") @db.Decimal(14, 2)\n  status               String    @default(\"PENDING\")\n  releasedAt           DateTime? @map(\"released_at\")\n  createdAt            DateTime  @default(now()) @map(\"created_at\")\n  updatedAt            DateTime  @updatedAt @map(\"updated_at\")\n\n  membershipContract GymMembershipContract @relation(fields: [membershipContractId], references: [id])\n\n  @@index([referrerPtUserId, status])\n  @@index([gymId])\n  @@map(\"gym_membership_referrals\")\n}\n",
  "inlineSchemaHash": "26b13c3ffcdeea6f6cb6b35a0684d35a1958b5e7c491baa624086dc1e3c228a0",
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

config.runtimeDataModel = JSON.parse("{\"models\":{\"GymBrand\":{\"dbName\":\"gym_brands\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"branches\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymBrand\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"A chain: one owner, one name, many physical locations (Gym rows below). Optional —\\\\na gym created without ever choosing a brand stays exactly as it always has, a single\\\\nstandalone location with `brandId = null`. Client search groups branches under their\\\\nbrand's card; a gym with no brand is just its own card, same as before this feature.\"},\"Gym\":{\"dbName\":\"gyms\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"brandId\",\"dbName\":\"brand_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Which brand this location belongs to, if any. A branch's own plans, wallet, checkins,\\\\nand reviews stay keyed to this row exactly as for a standalone gym — brand is purely\\\\na grouping label for search and owner navigation, not a second source of truth.\"},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"address\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"city\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"phone\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"email\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymStatus\",\"default\":\"PENDING_REVIEW\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"brand\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymBrand\",\"relationName\":\"GymToGymBrand\",\"relationFromFields\":[\"brandId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"plans\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipPlan\",\"relationName\":\"GymToGymMembershipPlan\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"memberships\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymToGymMembershipContract\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"affiliations\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymTrainerAffiliation\",\"relationName\":\"GymToGymTrainerAffiliation\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviews\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymReview\",\"relationName\":\"GymToGymReview\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"collaborations\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymPtCollaboration\",\"relationName\":\"GymToGymPtCollaboration\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymMembershipPlan\":{\"dbName\":\"gym_membership_plans\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationDays\",\"dbName\":\"duration_days\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"visitLimit\",\"dbName\":\"visit_limit\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymMembershipPlanStatus\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"saleStartAt\",\"dbName\":\"sale_start_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Optional marketing window: the plan can only be PURCHASED while now is inside\\\\n[saleStartAt, saleEndAt]. Distinct from durationDays, which is how long a membership\\\\nlasts once bought — the sale window closing never shortens a membership already sold.\\\\nBoth null (the common case) means always on sale while status is ACTIVE.\"},{\"name\":\"saleEndAt\",\"dbName\":\"sale_end_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymMembershipPlan\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"memberships\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymMembershipContractToGymMembershipPlan\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymMembershipContract\":{\"dbName\":\"gym_membership_contracts\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"planId\",\"dbName\":\"plan_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymMembershipContractStatus\",\"default\":\"PENDING_PAYMENT\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentTxnId\",\"dbName\":\"payment_txn_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startDate\",\"dbName\":\"start_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endDate\",\"dbName\":\"end_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"priceAtPurchase\",\"dbName\":\"price_at_purchase\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationDaysSnapshot\",\"dbName\":\"duration_days_snapshot\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalVisits\",\"dbName\":\"total_visits\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"usedVisits\",\"dbName\":\"used_visits\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"payoutReleasedAt\",\"dbName\":\"payout_released_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Stamped once the pending-bucket payout (gym + platform + any un-clawed referral\\\\ncommission) has been released to AVAILABLE. Set by the payout sweep on natural\\\\nexpiry, or immediately on client self-cancel / admin refund — see docs/money-flow.md.\\\\nGuards membership-release against double-releasing the same membership.\"},{\"name\":\"multiGymWarned\",\"dbName\":\"multi_gym_warned\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"True when the client confirmed purchase after being shown a warning that they already\\\\nhold an active membership at a different gym — evidence against \\\"I didn't know I still\\\\nhad one elsewhere\\\" disputes.\"},{\"name\":\"refundClawbackDone\",\"dbName\":\"refund_clawback_done\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Money-flow plan 1.7: set right after `refundByAdmin`'s referral-clawback step commits\\\\nits LOCAL bookkeeping (`GymMembershipReferral.clawedBack`). That local increment is not\\\\nitself idempotent — payment-service's own idempotency guard (plan 1.1) means a retried\\\\n`clawbackReferral` call just returns the FIRST attempt's cached amount rather than\\\\nre-debiting anything, but gym-service would still add that cached amount onto\\\\n`clawedBack` a second time if it re-entered the branch. `refundByAdmin` is one-shot per\\\\nmembership (blocked once status flips to CANCELLED), so this flag only ever needs to\\\\nanswer one question: did THIS refund's clawback step already run.\"},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymMembershipContract\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"plan\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipPlan\",\"relationName\":\"GymMembershipContractToGymMembershipPlan\",\"relationFromFields\":[\"planId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"checkIns\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymCheckIn\",\"relationName\":\"GymCheckInToGymMembershipContract\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"referral\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipReferral\",\"relationName\":\"GymMembershipContractToGymMembershipReferral\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymTrainerAffiliation\":{\"dbName\":\"gym_trainer_affiliations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptId\",\"dbName\":\"pt_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"AffiliationStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"employmentType\",\"dbName\":\"employment_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"AffiliationEmployment\",\"default\":\"FREELANCE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"visibility\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymTrainerVisibility\",\"default\":\"PUBLIC\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"commissionRate\",\"dbName\":\"commission_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"invitedBy\",\"dbName\":\"invited_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"joinedAt\",\"dbName\":\"joined_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymTrainerAffiliation\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"gymId\",\"ptId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"gymId\",\"ptId\"]}],\"isGenerated\":false},\"GymCheckIn\":{\"dbName\":\"gym_check_ins\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membershipId\",\"dbName\":\"membership_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"checkedInBy\",\"dbName\":\"checked_in_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membership\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymCheckInToGymMembershipContract\",\"relationFromFields\":[\"membershipId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymReview\":{\"dbName\":\"gym_reviews\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rating\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"comment\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymReview\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"gymId\",\"clientId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"gymId\",\"clientId\"]}],\"isGenerated\":false},\"GymPtCollaboration\":{\"dbName\":\"gym_pt_collaborations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proposedPtRate\",\"dbName\":\"proposed_pt_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Currently on the table. Must satisfy proposedPtRate + proposedGymRate + platformRate = 1.\"},{\"name\":\"proposedGymRate\",\"dbName\":\"proposed_gym_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"platformRate\",\"dbName\":\"platform_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0.1,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Stored so the accepted row is a complete snapshot rather than half a rate table.\"},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"CollaborationStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proposedBy\",\"dbName\":\"proposed_by\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"CollaborationParty\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Who made the offer currently on the table — i.e. whose turn it is NOT.\"},{\"name\":\"round\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":1,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Counter-offers so far. Capped so a negotiation cannot run forever.\"},{\"name\":\"expiresAt\",\"dbName\":\"expires_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"acceptedAt\",\"dbName\":\"accepted_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"terminatedAt\",\"dbName\":\"terminated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"terminatedBy\",\"dbName\":\"terminated_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"note\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymPtCollaboration\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"A revenue-share agreement between a trainer and a gym.\\\\n\\\\nA PT affiliated with a gym trains clients on the gym's floor and checks in free; in return\\\\nthe gym takes a cut of the contracts that PT signs there. Both sides have to agree on the\\\\nsplit, so this row carries the negotiation as well as the outcome — each counter-offer\\\\noverwrites the proposed rates and flips `proposedBy`, so whose turn it is is never\\\\nambiguous.\\\\n\\\\nThe rates here are a TEMPLATE, not the source of truth for any contract. When a contract is\\\\nsigned it copies them onto itself (see docs/money-flow.md §12); renegotiating afterwards\\\\nleaves existing contracts on the terms their parties actually agreed to.\"},\"GymMembershipReferral\":{\"dbName\":\"gym_membership_referrals\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membershipContractId\",\"dbName\":\"membership_contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"referrerPtUserId\",\"dbName\":\"referrer_pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"amount\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Gross commission earned at purchase time.\"},{\"name\":\"clawedBack\",\"dbName\":\"clawed_back\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Decimal\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Reversed so far, following partial refunds of the membership.\"},{\"name\":\"status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"releasedAt\",\"dbName\":\"released_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"membershipContract\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymMembershipContractToGymMembershipReferral\",\"relationFromFields\":[\"membershipContractId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false,\"documentation\":\"Commission owed to a PT for introducing a client who bought a gym membership.\\\\n\\\\nPaid out of the GYM's share, never the platform's — the platform did no introducing. The\\\\n`clawedBack` column exists because a refunded membership must reverse the commission in\\\\nproportion; a referral system that pays on purchase but forgets to reclaim on refund leaks\\\\nmoney on every cancellation.\"}},\"enums\":{\"GymStatus\":{\"values\":[{\"name\":\"PENDING_REVIEW\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"SUSPENDED\",\"dbName\":null}],\"dbName\":null},\"GymMembershipPlanStatus\":{\"values\":[{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"INACTIVE\",\"dbName\":null}],\"dbName\":null},\"GymMembershipContractStatus\":{\"values\":[{\"name\":\"PENDING_PAYMENT\",\"dbName\":null},{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"EXPIRED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"PENDING_ISSUE\",\"dbName\":null,\"documentation\":\"P0 cluster E2 — the gym was suspended/closed/removed between checkout and the payment\\\\nwebhook: money already settled into escrow + gym/platform pending, but activating a\\\\nmembership at a gym no longer allowed to operate would be wrong. An auto-refund is\\\\nattempted immediately (see membershipService.resolvePendingIssue); if that itself fails\\\\n(payment-service unreachable), the row stays here as an admin queue until manually\\\\nresolved — never silently dropped.\"}],\"dbName\":null},\"AffiliationStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"SUSPENDED\",\"dbName\":null}],\"dbName\":null},\"AffiliationEmployment\":{\"values\":[{\"name\":\"IN_HOUSE\",\"dbName\":null},{\"name\":\"FREELANCE\",\"dbName\":null},{\"name\":\"PARTNER\",\"dbName\":null}],\"dbName\":null},\"GymTrainerVisibility\":{\"values\":[{\"name\":\"PUBLIC\",\"dbName\":null},{\"name\":\"INTERNAL_ONLY\",\"dbName\":null}],\"dbName\":null},\"CollaborationStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"COUNTERED\",\"dbName\":null},{\"name\":\"ACCEPTED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"EXPIRED\",\"dbName\":null},{\"name\":\"TERMINATED\",\"dbName\":null}],\"dbName\":null},\"CollaborationParty\":{\"values\":[{\"name\":\"PT\",\"dbName\":null},{\"name\":\"GYM\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
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
path.join(__dirname, "schema.prisma");
path.join(process.cwd(), "src/generated/prisma/schema.prisma")
