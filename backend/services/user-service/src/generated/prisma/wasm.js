
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

exports.Prisma.UserProfileScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  isPT: 'isPT',
  age: 'age',
  gender: 'gender',
  heightCm: 'heightCm',
  goal: 'goal',
  activityLevel: 'activityLevel',
  experienceLevel: 'experienceLevel',
  preferredTrainingDays: 'preferredTrainingDays',
  availableEquipment: 'availableEquipment',
  injuries: 'injuries',
  currentWeight: 'currentWeight',
  targetWeight: 'targetWeight',
  sessionDurationMinutes: 'sessionDurationMinutes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTApplicationScalarFieldEnum = {
  id: 'id',
  userProfileId: 'userProfileId',
  status: 'status',
  phoneNumber: 'phoneNumber',
  nationalIdNumber: 'nationalIdNumber',
  currentAddress: 'currentAddress',
  idCardFrontUrl: 'idCardFrontUrl',
  idCardBackUrl: 'idCardBackUrl',
  portraitPhotoUrl: 'portraitPhotoUrl',
  yearsOfExperience: 'yearsOfExperience',
  educationBackground: 'educationBackground',
  previousWorkExperience: 'previousWorkExperience',
  professionalBio: 'professionalBio',
  mainSpecialties: 'mainSpecialties',
  targetClientGroups: 'targetClientGroups',
  primaryTrainingGoals: 'primaryTrainingGoals',
  trainingMethodsApproach: 'trainingMethodsApproach',
  portfolioUrl: 'portfolioUrl',
  linkedinUrl: 'linkedinUrl',
  websiteUrl: 'websiteUrl',
  socialLinks: 'socialLinks',
  availabilityNotes: 'availabilityNotes',
  availableTimeSlots: 'availableTimeSlots',
  serviceMode: 'serviceMode',
  operatingAreas: 'operatingAreas',
  desiredSessionPrice: 'desiredSessionPrice',
  availableDays: 'availableDays',
  availableFrom: 'availableFrom',
  availableUntil: 'availableUntil',
  gymAffiliation: 'gymAffiliation',
  monthlyProgramPrice: 'monthlyProgramPrice',
  packagePrice: 'packagePrice',
  sessionsPerPackage: 'sessionsPerPackage',
  sessionDurationMinutes: 'sessionDurationMinutes',
  availabilityBlocks: 'availabilityBlocks',
  additionalPricingNotes: 'additionalPricingNotes',
  otherReferences: 'otherReferences',
  adminNote: 'adminNote',
  rejectionReason: 'rejectionReason',
  submittedAt: 'submittedAt',
  reviewedAt: 'reviewedAt',
  approvedAt: 'approvedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTApplicationCertificateScalarFieldEnum = {
  id: 'id',
  applicationId: 'applicationId',
  certificateName: 'certificateName',
  issuingOrganization: 'issuingOrganization',
  isCurrentlyValid: 'isCurrentlyValid',
  certificationStatus: 'certificationStatus',
  issueDate: 'issueDate',
  expirationDate: 'expirationDate',
  certificateFileUrl: 'certificateFileUrl',
  createdAt: 'createdAt'
};

exports.Prisma.PTApplicationMediaScalarFieldEnum = {
  id: 'id',
  applicationId: 'applicationId',
  groupType: 'groupType',
  fileUrl: 'fileUrl',
  label: 'label',
  createdAt: 'createdAt'
};

exports.Prisma.ContractScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  clientUserId: 'clientUserId',
  status: 'status',
  packageType: 'packageType',
  packageName: 'packageName',
  description: 'description',
  packageQuantity: 'packageQuantity',
  extraSessions: 'extraSessions',
  totalSessions: 'totalSessions',
  usedSessions: 'usedSessions',
  price: 'price',
  pricePerSession: 'pricePerSession',
  startDate: 'startDate',
  endDate: 'endDate',
  completedAt: 'completedAt',
  clientMessage: 'clientMessage',
  rejectionReason: 'rejectionReason',
  cancelledBy: 'cancelledBy',
  cancellationReason: 'cancellationReason',
  terms: 'terms',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionScalarFieldEnum = {
  id: 'id',
  contractId: 'contractId',
  clientUserId: 'clientUserId',
  ptUserId: 'ptUserId',
  status: 'status',
  sessionMode: 'sessionMode',
  scheduledStartAt: 'scheduledStartAt',
  scheduledEndAt: 'scheduledEndAt',
  location: 'location',
  notes: 'notes',
  ptNotes: 'ptNotes',
  cancelledBy: 'cancelledBy',
  cancellationReason: 'cancellationReason',
  sessionDeducted: 'sessionDeducted',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionReviewScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  contractId: 'contractId',
  clientUserId: 'clientUserId',
  rating: 'rating',
  comment: 'comment',
  createdAt: 'createdAt'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  text: 'text',
  eventType: 'eventType',
  entityType: 'entityType',
  entityId: 'entityId',
  link: 'link',
  unread: 'unread',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTAvailabilityScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  dayOfWeek: 'dayOfWeek',
  startTime: 'startTime',
  endTime: 'endTime',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTScheduleExceptionScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  date: 'date',
  reason: 'reason',
  createdAt: 'createdAt'
};

exports.Prisma.InBodyEntryScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  weight: 'weight',
  height: 'height',
  bmi: 'bmi',
  bmr: 'bmr',
  bodyFat: 'bodyFat',
  bodyFatPct: 'bodyFatPct',
  muscleMass: 'muscleMass',
  rightArmMuscle: 'rightArmMuscle',
  leftArmMuscle: 'leftArmMuscle',
  trunkMuscle: 'trunkMuscle',
  rightLegMuscle: 'rightLegMuscle',
  leftLegMuscle: 'leftLegMuscle',
  rightArmFat: 'rightArmFat',
  leftArmFat: 'leftArmFat',
  trunkFat: 'trunkFat',
  rightLegFat: 'rightLegFat',
  leftLegFat: 'leftLegFat',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
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
exports.Gender = exports.$Enums.Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER'
};

exports.Goal = exports.$Enums.Goal = {
  WEIGHT_LOSS: 'WEIGHT_LOSS',
  MUSCLE_GAIN: 'MUSCLE_GAIN',
  MAINTENANCE: 'MAINTENANCE',
  ATHLETIC_PERFORMANCE: 'ATHLETIC_PERFORMANCE'
};

exports.ActivityLevel = exports.$Enums.ActivityLevel = {
  SEDENTARY: 'SEDENTARY',
  LIGHTLY_ACTIVE: 'LIGHTLY_ACTIVE',
  MODERATELY_ACTIVE: 'MODERATELY_ACTIVE',
  VERY_ACTIVE: 'VERY_ACTIVE',
  EXTREMELY_ACTIVE: 'EXTREMELY_ACTIVE'
};

exports.ExperienceLevel = exports.$Enums.ExperienceLevel = {
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED'
};

exports.PTApplicationStatus = exports.$Enums.PTApplicationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEEDS_MORE_INFO: 'NEEDS_MORE_INFO',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.ServiceMode = exports.$Enums.ServiceMode = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  HYBRID: 'HYBRID'
};

exports.MediaGroupType = exports.$Enums.MediaGroupType = {
  IDENTITY: 'IDENTITY',
  CERTIFICATE: 'CERTIFICATE',
  PORTFOLIO: 'PORTFOLIO'
};

exports.ContractStatus = exports.$Enums.ContractStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};

exports.PackageType = exports.$Enums.PackageType = {
  PER_SESSION: 'PER_SESSION',
  PACKAGE: 'PACKAGE'
};

exports.SessionStatus = exports.$Enums.SessionStatus = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW'
};

exports.SessionMode = exports.$Enums.SessionMode = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  HYBRID: 'HYBRID'
};

exports.NotificationEventType = exports.$Enums.NotificationEventType = {
  CONTRACT_REQUESTED: 'CONTRACT_REQUESTED',
  CONTRACT_ACCEPTED: 'CONTRACT_ACCEPTED',
  CONTRACT_REJECTED: 'CONTRACT_REJECTED',
  CONTRACT_CANCELLED: 'CONTRACT_CANCELLED',
  SESSION_BOOKED: 'SESSION_BOOKED',
  SESSION_CONFIRMED: 'SESSION_CONFIRMED',
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  SESSION_CANCELLED: 'SESSION_CANCELLED',
  SESSION_NO_SHOW_CLIENT: 'SESSION_NO_SHOW_CLIENT',
  SESSION_NO_SHOW_PT: 'SESSION_NO_SHOW_PT'
};

exports.NotificationEntityType = exports.$Enums.NotificationEntityType = {
  CONTRACT: 'CONTRACT',
  SESSION: 'SESSION'
};

exports.DayOfWeek = exports.$Enums.DayOfWeek = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY'
};

exports.Prisma.ModelName = {
  UserProfile: 'UserProfile',
  PTApplication: 'PTApplication',
  PTApplicationCertificate: 'PTApplicationCertificate',
  PTApplicationMedia: 'PTApplicationMedia',
  Contract: 'Contract',
  Session: 'Session',
  SessionReview: 'SessionReview',
  Notification: 'Notification',
  PTAvailability: 'PTAvailability',
  PTScheduleException: 'PTScheduleException',
  InBodyEntry: 'InBodyEntry'
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
