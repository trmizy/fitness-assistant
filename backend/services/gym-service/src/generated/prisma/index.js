
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

exports.Prisma.GymScalarFieldEnum = {
  id: 'id',
  ownerId: 'ownerId',
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
  CANCELLED: 'CANCELLED'
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

exports.Prisma.ModelName = {
  Gym: 'Gym',
  GymMembershipPlan: 'GymMembershipPlan',
  GymMembershipContract: 'GymMembershipContract',
  GymTrainerAffiliation: 'GymTrainerAffiliation',
  GymCheckIn: 'GymCheckIn',
  GymReview: 'GymReview'
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
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum GymStatus {\n  PENDING_REVIEW\n  APPROVED\n  REJECTED\n  SUSPENDED\n}\n\nenum GymMembershipPlanStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum GymMembershipContractStatus {\n  PENDING_PAYMENT\n  ACTIVE\n  EXPIRED\n  CANCELLED\n}\n\nenum AffiliationStatus {\n  PENDING\n  ACTIVE\n  REJECTED\n  SUSPENDED\n}\n\nenum AffiliationEmployment {\n  IN_HOUSE\n  FREELANCE\n  PARTNER\n}\n\nenum GymTrainerVisibility {\n  PUBLIC\n  INTERNAL_ONLY\n}\n\nmodel Gym {\n  id          String    @id @default(uuid())\n  ownerId     String    @map(\"owner_id\")\n  name        String\n  description String?\n  address     String\n  city        String?\n  phone       String?\n  email       String?\n  status      GymStatus @default(PENDING_REVIEW)\n  createdAt   DateTime  @default(now()) @map(\"created_at\")\n  updatedAt   DateTime  @updatedAt @map(\"updated_at\")\n\n  plans        GymMembershipPlan[]\n  memberships  GymMembershipContract[]\n  affiliations GymTrainerAffiliation[]\n  reviews      GymReview[]\n\n  @@index([status])\n  @@index([ownerId])\n  @@map(\"gyms\")\n}\n\nmodel GymMembershipPlan {\n  id           String                  @id @default(uuid())\n  gymId        String                  @map(\"gym_id\")\n  name         String\n  description  String?\n  price        Decimal                 @db.Decimal(12, 2)\n  durationDays Int                     @map(\"duration_days\")\n  visitLimit   Int?                    @map(\"visit_limit\")\n  status       GymMembershipPlanStatus @default(ACTIVE)\n  createdAt    DateTime                @default(now()) @map(\"created_at\")\n  updatedAt    DateTime                @updatedAt @map(\"updated_at\")\n\n  gym         Gym                     @relation(fields: [gymId], references: [id])\n  memberships GymMembershipContract[]\n\n  @@index([gymId, status])\n  @@map(\"gym_membership_plans\")\n}\n\nmodel GymMembershipContract {\n  id                   String                      @id @default(uuid())\n  gymId                String                      @map(\"gym_id\")\n  planId               String                      @map(\"plan_id\")\n  clientId             String                      @map(\"client_id\")\n  status               GymMembershipContractStatus @default(PENDING_PAYMENT)\n  paymentTxnId         String?                     @map(\"payment_txn_id\")\n  startDate            DateTime?                   @map(\"start_date\")\n  endDate              DateTime?                   @map(\"end_date\")\n  priceAtPurchase      Decimal                     @map(\"price_at_purchase\") @db.Decimal(12, 2)\n  durationDaysSnapshot Int                         @map(\"duration_days_snapshot\")\n  totalVisits          Int?                        @map(\"total_visits\")\n  usedVisits           Int                         @default(0) @map(\"used_visits\")\n  createdAt            DateTime                    @default(now()) @map(\"created_at\")\n  updatedAt            DateTime                    @updatedAt @map(\"updated_at\")\n\n  gym      Gym               @relation(fields: [gymId], references: [id])\n  plan     GymMembershipPlan @relation(fields: [planId], references: [id])\n  checkIns GymCheckIn[]\n\n  @@index([clientId, status])\n  @@index([gymId, status])\n  @@map(\"gym_membership_contracts\")\n}\n\nmodel GymTrainerAffiliation {\n  id             String                @id @default(uuid())\n  gymId          String                @map(\"gym_id\")\n  ptId           String                @map(\"pt_id\")\n  status         AffiliationStatus     @default(PENDING)\n  employmentType AffiliationEmployment @default(FREELANCE) @map(\"employment_type\")\n  visibility     GymTrainerVisibility  @default(PUBLIC)\n  commissionRate Decimal?              @map(\"commission_rate\") @db.Decimal(5, 4)\n  invitedBy      String?               @map(\"invited_by\")\n  joinedAt       DateTime?             @map(\"joined_at\")\n  createdAt      DateTime              @default(now()) @map(\"created_at\")\n  updatedAt      DateTime              @updatedAt @map(\"updated_at\")\n\n  gym Gym @relation(fields: [gymId], references: [id])\n\n  @@unique([gymId, ptId])\n  @@index([ptId, status])\n  @@index([gymId, status])\n  @@map(\"gym_trainer_affiliations\")\n}\n\n// ─── Gym Check-in (member scans in at the gym) ────────────────────────\nmodel GymCheckIn {\n  id           String   @id @default(uuid())\n  membershipId String   @map(\"membership_id\")\n  gymId        String   @map(\"gym_id\")\n  clientId     String   @map(\"client_id\")\n  checkedInBy  String   @map(\"checked_in_by\") // owner userId who scanned\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n\n  membership GymMembershipContract @relation(fields: [membershipId], references: [id])\n\n  @@index([gymId, createdAt])\n  @@index([membershipId, createdAt])\n  @@map(\"gym_check_ins\")\n}\n\n// ─── Gym Review / Rating (one per member per gym) ─────────────────────\nmodel GymReview {\n  id        String   @id @default(uuid())\n  gymId     String   @map(\"gym_id\")\n  clientId  String   @map(\"client_id\")\n  rating    Int // 1–5\n  comment   String?\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  gym Gym @relation(fields: [gymId], references: [id])\n\n  @@unique([gymId, clientId])\n  @@index([gymId])\n  @@map(\"gym_reviews\")\n}\n",
  "inlineSchemaHash": "56d5a8b8b7f2bcfd6fdc3b5fba097d90a644dd0fa0931811915d2c2f7bd5b063",
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

config.runtimeDataModel = JSON.parse("{\"models\":{\"Gym\":{\"dbName\":\"gyms\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ownerId\",\"dbName\":\"owner_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"address\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"city\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"phone\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"email\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymStatus\",\"default\":\"PENDING_REVIEW\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"plans\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipPlan\",\"relationName\":\"GymToGymMembershipPlan\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"memberships\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymToGymMembershipContract\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"affiliations\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymTrainerAffiliation\",\"relationName\":\"GymToGymTrainerAffiliation\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviews\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymReview\",\"relationName\":\"GymToGymReview\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymMembershipPlan\":{\"dbName\":\"gym_membership_plans\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationDays\",\"dbName\":\"duration_days\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"visitLimit\",\"dbName\":\"visit_limit\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymMembershipPlanStatus\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymMembershipPlan\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"memberships\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymMembershipContractToGymMembershipPlan\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymMembershipContract\":{\"dbName\":\"gym_membership_contracts\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"planId\",\"dbName\":\"plan_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymMembershipContractStatus\",\"default\":\"PENDING_PAYMENT\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"paymentTxnId\",\"dbName\":\"payment_txn_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startDate\",\"dbName\":\"start_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endDate\",\"dbName\":\"end_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"priceAtPurchase\",\"dbName\":\"price_at_purchase\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationDaysSnapshot\",\"dbName\":\"duration_days_snapshot\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalVisits\",\"dbName\":\"total_visits\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"usedVisits\",\"dbName\":\"used_visits\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymMembershipContract\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"plan\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipPlan\",\"relationName\":\"GymMembershipContractToGymMembershipPlan\",\"relationFromFields\":[\"planId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"checkIns\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymCheckIn\",\"relationName\":\"GymCheckInToGymMembershipContract\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymTrainerAffiliation\":{\"dbName\":\"gym_trainer_affiliations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptId\",\"dbName\":\"pt_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"AffiliationStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"employmentType\",\"dbName\":\"employment_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"AffiliationEmployment\",\"default\":\"FREELANCE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"visibility\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"GymTrainerVisibility\",\"default\":\"PUBLIC\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"commissionRate\",\"dbName\":\"commission_rate\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"invitedBy\",\"dbName\":\"invited_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"joinedAt\",\"dbName\":\"joined_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymTrainerAffiliation\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"gymId\",\"ptId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"gymId\",\"ptId\"]}],\"isGenerated\":false},\"GymCheckIn\":{\"dbName\":\"gym_check_ins\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membershipId\",\"dbName\":\"membership_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"checkedInBy\",\"dbName\":\"checked_in_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"membership\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"GymMembershipContract\",\"relationName\":\"GymCheckInToGymMembershipContract\",\"relationFromFields\":[\"membershipId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"GymReview\":{\"dbName\":\"gym_reviews\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymId\",\"dbName\":\"gym_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientId\",\"dbName\":\"client_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rating\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"comment\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"gym\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gym\",\"relationName\":\"GymToGymReview\",\"relationFromFields\":[\"gymId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"gymId\",\"clientId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"gymId\",\"clientId\"]}],\"isGenerated\":false}},\"enums\":{\"GymStatus\":{\"values\":[{\"name\":\"PENDING_REVIEW\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"SUSPENDED\",\"dbName\":null}],\"dbName\":null},\"GymMembershipPlanStatus\":{\"values\":[{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"INACTIVE\",\"dbName\":null}],\"dbName\":null},\"GymMembershipContractStatus\":{\"values\":[{\"name\":\"PENDING_PAYMENT\",\"dbName\":null},{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"EXPIRED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null}],\"dbName\":null},\"AffiliationStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"SUSPENDED\",\"dbName\":null}],\"dbName\":null},\"AffiliationEmployment\":{\"values\":[{\"name\":\"IN_HOUSE\",\"dbName\":null},{\"name\":\"FREELANCE\",\"dbName\":null},{\"name\":\"PARTNER\",\"dbName\":null}],\"dbName\":null},\"GymTrainerVisibility\":{\"values\":[{\"name\":\"PUBLIC\",\"dbName\":null},{\"name\":\"INTERNAL_ONLY\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
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
