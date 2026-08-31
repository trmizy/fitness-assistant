
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
