
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
  ptSuspended: 'ptSuspended',
  referralCode: 'referralCode',
  dateOfBirth: 'dateOfBirth',
  age: 'age',
  gender: 'gender',
  heightCm: 'heightCm',
  goal: 'goal',
  activityLevel: 'activityLevel',
  experienceLevel: 'experienceLevel',
  competesInSport: 'competesInSport',
  preferredTrainingDays: 'preferredTrainingDays',
  availableEquipment: 'availableEquipment',
  injuries: 'injuries',
  preferredSplit: 'preferredSplit',
  hasCompletedOnboarding: 'hasCompletedOnboarding',
  currentWeight: 'currentWeight',
  targetWeight: 'targetWeight',
  dietaryPreference: 'dietaryPreference',
  photoUrl: 'photoUrl',
  sessionDurationMinutes: 'sessionDurationMinutes',
  isAcceptingClients: 'isAcceptingClients',
  notAcceptingReason: 'notAcceptingReason',
  firstNameNormalized: 'firstNameNormalized',
  lastNameNormalized: 'lastNameNormalized',
  searchCity: 'searchCity',
  searchDistrict: 'searchDistrict',
  searchWard: 'searchWard',
  gymId: 'gymId',
  specialties: 'specialties',
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
  onlinePricePerSession: 'onlinePricePerSession',
  offlinePricePerSession: 'offlinePricePerSession',
  onlinePackagePrice: 'onlinePackagePrice',
  offlinePackagePrice: 'offlinePackagePrice',
  otherReferences: 'otherReferences',
  residenceProvinceCode: 'residenceProvinceCode',
  residenceWardCode: 'residenceWardCode',
  residenceAddressLine: 'residenceAddressLine',
  residenceLegacyDistrictName: 'residenceLegacyDistrictName',
  applicationTrainingLocations: 'applicationTrainingLocations',
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
  sessionMode: 'sessionMode',
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
  eSignProvider: 'eSignProvider',
  eSignRequestId: 'eSignRequestId',
  eSignStatus: 'eSignStatus',
  eSignTestMode: 'eSignTestMode',
  eSignSentAt: 'eSignSentAt',
  clientSignedAt: 'clientSignedAt',
  ptSignedAt: 'ptSignedAt',
  fullySignedAt: 'fullySignedAt',
  contractPdfPath: 'contractPdfPath',
  signedPdfUrl: 'signedPdfUrl',
  eSignError: 'eSignError',
  clientSignerEmail: 'clientSignerEmail',
  ptSignerEmail: 'ptSignerEmail',
  gymId: 'gymId',
  source: 'source',
  paymentTransactionId: 'paymentTransactionId',
  platformRate: 'platformRate',
  ptRate: 'ptRate',
  gymRate: 'gymRate',
  terminationReason: 'terminationReason',
  terminatedAt: 'terminatedAt',
  releasedToPt: 'releasedToPt',
  releasedToGym: 'releasedToGym',
  releasedToPlatform: 'releasedToPlatform',
  packageId: 'packageId',
  packageSourceName: 'packageSourceName',
  sessionDurationMinutes: 'sessionDurationMinutes',
  lowAvailabilityWarned: 'lowAvailabilityWarned',
  slotsAtPurchase: 'slotsAtPurchase',
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
  clientConfirmDeadline: 'clientConfirmDeadline',
  autoConfirmed: 'autoConfirmed',
  disputeReason: 'disputeReason',
  disputedAt: 'disputedAt',
  resolvedBy: 'resolvedBy',
  resolutionNote: 'resolutionNote',
  resolvedAt: 'resolvedAt',
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

exports.Prisma.VietnamProvinceScalarFieldEnum = {
  code: 'code',
  name: 'name',
  nameNormalized: 'nameNormalized',
  codename: 'codename',
  divisionType: 'divisionType',
  phoneCode: 'phoneCode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VietnamWardScalarFieldEnum = {
  code: 'code',
  provinceCode: 'provinceCode',
  name: 'name',
  nameNormalized: 'nameNormalized',
  codename: 'codename',
  divisionType: 'divisionType',
  shortCodename: 'shortCodename',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTTrainingLocationScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  provinceCode: 'provinceCode',
  wardCode: 'wardCode',
  gymName: 'gymName',
  gymNameNormalized: 'gymNameNormalized',
  addressLine: 'addressLine',
  legacyDistrictName: 'legacyDistrictName',
  gymId: 'gymId',
  isPrimary: 'isPrimary',
  isActive: 'isActive',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PTServicePackageScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  name: 'name',
  description: 'description',
  sessionCount: 'sessionCount',
  price: 'price',
  sessionMode: 'sessionMode',
  sessionDurationMinutes: 'sessionDurationMinutes',
  validityDays: 'validityDays',
  isActive: 'isActive',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionRescheduleRequestScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  requestedBy: 'requestedBy',
  originalStartAt: 'originalStartAt',
  originalEndAt: 'originalEndAt',
  proposedStartAt: 'proposedStartAt',
  proposedEndAt: 'proposedEndAt',
  reason: 'reason',
  status: 'status',
  respondedAt: 'respondedAt',
  responseNote: 'responseNote',
  createdAt: 'createdAt'
};

exports.Prisma.InBodyEntryScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  dateOnly: 'dateOnly',
  weight: 'weight',
  height: 'height',
  bmi: 'bmi',
  bodyFat: 'bodyFat',
  bodyFatPct: 'bodyFatPct',
  muscleMass: 'muscleMass',
  visceralFat: 'visceralFat',
  bmr: 'bmr',
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

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  actorUserId: 'actorUserId',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  metadata: 'metadata',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
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
  PENDING_SIGNATURE: 'PENDING_SIGNATURE',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
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

exports.SessionMode = exports.$Enums.SessionMode = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  HYBRID: 'HYBRID'
};

exports.ContractSource = exports.$Enums.ContractSource = {
  INDEPENDENT: 'INDEPENDENT',
  GYM: 'GYM'
};

exports.TerminationReason = exports.$Enums.TerminationReason = {
  CLIENT_CANCELLED: 'CLIENT_CANCELLED',
  PT_BANNED: 'PT_BANNED',
  PT_CANCELLED: 'PT_CANCELLED',
  MUTUAL: 'MUTUAL',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED'
};

exports.SessionStatus = exports.$Enums.SessionStatus = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  PENDING_CLIENT_CONFIRMATION: 'PENDING_CLIENT_CONFIRMATION',
  DISPUTED: 'DISPUTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW'
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
  SESSION_NO_SHOW_PT: 'SESSION_NO_SHOW_PT',
  SESSION_RESCHEDULE_REQUESTED: 'SESSION_RESCHEDULE_REQUESTED',
  SESSION_RESCHEDULE_ACCEPTED: 'SESSION_RESCHEDULE_ACCEPTED',
  SESSION_RESCHEDULE_REJECTED: 'SESSION_RESCHEDULE_REJECTED',
  SESSION_RESCHEDULE_EXPIRED: 'SESSION_RESCHEDULE_EXPIRED'
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

exports.RescheduleRequestedBy = exports.$Enums.RescheduleRequestedBy = {
  CLIENT: 'CLIENT',
  PT: 'PT'
};

exports.RescheduleStatus = exports.$Enums.RescheduleStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

exports.AuditEntityType = exports.$Enums.AuditEntityType = {
  CONTRACT: 'CONTRACT',
  SESSION: 'SESSION',
  SERVICE_PACKAGE: 'SERVICE_PACKAGE',
  PT_PROFILE: 'PT_PROFILE'
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
  VietnamProvince: 'VietnamProvince',
  VietnamWard: 'VietnamWard',
  PTTrainingLocation: 'PTTrainingLocation',
  PTServicePackage: 'PTServicePackage',
  SessionRescheduleRequest: 'SessionRescheduleRequest',
  InBodyEntry: 'InBodyEntry',
  AuditLog: 'AuditLog'
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
