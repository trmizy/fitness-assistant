
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
      "value": "/app/backend/services/user-service/src/generated/prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "debian-openssl-3.0.x",
        "native": true
      },
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x"
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "/app/backend/services/user-service/prisma/schema.prisma",
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
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum Gender {\n  MALE\n  FEMALE\n  OTHER\n}\n\nenum Goal {\n  WEIGHT_LOSS\n  MUSCLE_GAIN\n  MAINTENANCE\n  ATHLETIC_PERFORMANCE\n}\n\nenum ActivityLevel {\n  SEDENTARY // 1.2\n  LIGHTLY_ACTIVE // 1.375\n  MODERATELY_ACTIVE // 1.55\n  VERY_ACTIVE // 1.725\n  EXTREMELY_ACTIVE // 1.9\n}\n\nenum ExperienceLevel {\n  BEGINNER\n  INTERMEDIATE\n  ADVANCED\n}\n\nmodel UserProfile {\n  id     String @id @default(uuid())\n  userId String @unique // References auth-service User.id\n\n  // Basic info (cached from auth-service or direct)\n  firstName String?\n  lastName  String?\n  email     String?\n\n  // PT Status\n  // Currently a simple boolean flag. Future expansion:\n  // - role: CLIENT | PT | ADMIN (enum)\n  // - ptApplicationStatus: NONE | PENDING | APPROVED | REJECTED (enum)\n  // - ptCertificateUrl, ptBio, ptSpecialties, etc.\n  isPT Boolean @default(false)\n\n  // Demographics\n  age      Int?\n  gender   Gender?\n  heightCm Float?\n\n  // Goals & Preferences\n  goal            Goal?\n  activityLevel   ActivityLevel?\n  experienceLevel ExperienceLevel?\n\n  // Training preferences\n  preferredTrainingDays Int[] // [1, 3, 5] = Mon, Wed, Fri\n  availableEquipment    String[] // [\"barbell\", \"dumbbells\", \"machines\"]\n  injuries              String[] // [\"lower back\", \"left knee\"]\n\n  // Calculated fields (can be denormalized from InBody service)\n  currentWeight Float?\n  targetWeight  Float?\n\n  sessionDurationMinutes Int @default(60) @map(\"session_duration_minutes\")\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  ptApplication PTApplication?\n\n  @@map(\"user_profiles\")\n}\n\nenum PTApplicationStatus {\n  DRAFT\n  SUBMITTED\n  UNDER_REVIEW\n  NEEDS_MORE_INFO\n  APPROVED\n  REJECTED\n}\n\nenum ServiceMode {\n  ONLINE\n  OFFLINE\n  HYBRID\n}\n\nenum MediaGroupType {\n  IDENTITY\n  CERTIFICATE\n  PORTFOLIO\n}\n\nmodel PTApplication {\n  id            String              @id @default(uuid())\n  userProfileId String              @unique @map(\"user_profile_id\")\n  status        PTApplicationStatus @default(DRAFT)\n\n  // Basic personal / verification info\n  phoneNumber      String? @map(\"phone_number\")\n  nationalIdNumber String? @map(\"national_id_number\")\n  currentAddress   String? @map(\"current_address\")\n\n  // Identity verification images (shortcut fields for the 3 required documents)\n  idCardFrontUrl   String? @map(\"id_card_front_url\")\n  idCardBackUrl    String? @map(\"id_card_back_url\")\n  portraitPhotoUrl String? @map(\"portrait_photo_url\")\n\n  // Professional background\n  yearsOfExperience       String?  @map(\"years_of_experience\")\n  educationBackground     String?  @map(\"education_background\")\n  previousWorkExperience  String?  @map(\"previous_work_experience\")\n  professionalBio         String?  @map(\"professional_bio\")\n  mainSpecialties         String[] @map(\"main_specialties\")\n  targetClientGroups      String[] @map(\"target_client_groups\")\n  primaryTrainingGoals    String[] @map(\"primary_training_goals\")\n  trainingMethodsApproach String?  @map(\"training_methods_approach\")\n\n  // Portfolio / professional links\n  portfolioUrl String? @map(\"portfolio_url\")\n  linkedinUrl  String? @map(\"linkedin_url\")\n  websiteUrl   String? @map(\"website_url\")\n  socialLinks  Json?   @map(\"social_links\") // For Instagram, YouTube, etc.\n\n  // Service / work setup\n  availabilityNotes      String?      @map(\"availability_notes\")\n  availableTimeSlots     Json?        @map(\"available_time_slots\")\n  serviceMode            ServiceMode? @map(\"service_mode\")\n  operatingAreas         String[]     @map(\"operating_areas\")\n  desiredSessionPrice    Float?       @map(\"desired_session_price\")\n  availableDays          String[]     @map(\"available_days\")\n  availableFrom          String?      @map(\"available_from\")\n  availableUntil         String?      @map(\"available_until\")\n  gymAffiliation         String?      @map(\"gym_affiliation\")\n  monthlyProgramPrice    Float?       @map(\"monthly_program_price\")\n  packagePrice           Float?       @map(\"package_price\")\n  sessionsPerPackage     Int          @default(10) @map(\"sessions_per_package\")\n  sessionDurationMinutes Int          @default(60) @map(\"session_duration_minutes\")\n  availabilityBlocks     Json?        @map(\"availability_blocks\")\n  additionalPricingNotes String?      @map(\"additional_pricing_notes\")\n  otherReferences        String?      @map(\"other_references\")\n\n  // Admin interaction\n  adminNote       String? @map(\"admin_note\")\n  rejectionReason String? @map(\"rejection_reason\")\n\n  // Timestamps\n  submittedAt DateTime? @map(\"submitted_at\")\n  reviewedAt  DateTime? @map(\"reviewed_at\")\n  approvedAt  DateTime? @map(\"approved_at\")\n  createdAt   DateTime  @default(now()) @map(\"created_at\")\n  updatedAt   DateTime  @updatedAt @map(\"updated_at\")\n\n  certificates PTApplicationCertificate[]\n  media        PTApplicationMedia[]\n\n  userProfile UserProfile @relation(fields: [userProfileId], references: [id])\n\n  @@map(\"pt_applications\")\n}\n\nmodel PTApplicationCertificate {\n  id                  String    @id @default(uuid())\n  applicationId       String    @map(\"application_id\")\n  certificateName     String    @map(\"certificate_name\")\n  issuingOrganization String    @map(\"issuing_organization\")\n  isCurrentlyValid    Boolean   @map(\"is_currently_valid\")\n  certificationStatus String?   @map(\"certification_status\") // Valid, Expired, Lifetime\n  issueDate           DateTime? @map(\"issue_date\")\n  expirationDate      DateTime? @map(\"expiration_date\")\n  certificateFileUrl  String?   @map(\"certificate_file_url\")\n  createdAt           DateTime  @default(now()) @map(\"created_at\")\n\n  application PTApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)\n\n  @@map(\"pt_application_certificates\")\n}\n\nmodel PTApplicationMedia {\n  id            String         @id @default(uuid())\n  applicationId String         @map(\"application_id\")\n  groupType     MediaGroupType @map(\"group_type\")\n  fileUrl       String         @map(\"file_url\")\n  label         String?        @map(\"label\")\n  createdAt     DateTime       @default(now()) @map(\"created_at\")\n\n  application PTApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)\n\n  @@map(\"pt_application_media\")\n}\n\n// ─── Contract + Booking Enums ─────────────────────────────────────\n\nenum ContractStatus {\n  PENDING_REVIEW // Client requested, awaiting PT decision\n  ACTIVE // PT accepted, contract in effect\n  COMPLETED // All sessions used\n  EXPIRED // Past end date\n  CANCELLED // Terminated early by either party\n  REJECTED // PT declined the request\n}\n\nenum PackageType {\n  PER_SESSION // Pay per session\n  PACKAGE // Fixed number of sessions bundle\n}\n\nenum SessionStatus {\n  REQUESTED // Client booked, awaiting PT confirmation\n  CONFIRMED // PT confirmed\n  COMPLETED // PT marked complete\n  CANCELLED // Either party cancelled\n  NO_SHOW // Client or PT did not attend\n}\n\nenum SessionMode {\n  ONLINE\n  OFFLINE\n  HYBRID\n}\n\nenum DayOfWeek {\n  MONDAY\n  TUESDAY\n  WEDNESDAY\n  THURSDAY\n  FRIDAY\n  SATURDAY\n  SUNDAY\n}\n\nenum NotificationEventType {\n  CONTRACT_REQUESTED\n  CONTRACT_ACCEPTED\n  CONTRACT_REJECTED\n  CONTRACT_CANCELLED\n  SESSION_BOOKED\n  SESSION_CONFIRMED\n  SESSION_COMPLETED\n  SESSION_CANCELLED\n  SESSION_NO_SHOW_CLIENT\n  SESSION_NO_SHOW_PT\n}\n\nenum NotificationEntityType {\n  CONTRACT\n  SESSION\n}\n\n// ─── Contract ─────────────────────────────────────────────────────\n\nmodel Contract {\n  id           String         @id @default(uuid())\n  ptUserId     String         @map(\"pt_user_id\")\n  clientUserId String         @map(\"client_user_id\")\n  status       ContractStatus @default(PENDING_REVIEW)\n\n  // Package details\n  packageType     PackageType @default(PACKAGE) @map(\"package_type\")\n  packageName     String      @map(\"package_name\")\n  description     String?\n  packageQuantity Int         @default(1) @map(\"package_quantity\")\n  extraSessions   Int         @default(0) @map(\"extra_sessions\")\n  totalSessions   Int         @map(\"total_sessions\")\n  usedSessions    Int         @default(0) @map(\"used_sessions\")\n  price           Float?\n  pricePerSession Float?      @map(\"price_per_session\")\n\n  // Timeline\n  startDate   DateTime? @map(\"start_date\")\n  endDate     DateTime? @map(\"end_date\")\n  completedAt DateTime? @map(\"completed_at\")\n\n  // Request & negotiation\n  clientMessage      String? @map(\"client_message\")\n  rejectionReason    String? @map(\"rejection_reason\")\n  cancelledBy        String? @map(\"cancelled_by\")\n  cancellationReason String? @map(\"cancellation_reason\")\n\n  // Terms\n  terms String?\n  notes String?\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  sessions Session[]\n  reviews  SessionReview[]\n\n  @@index([ptUserId])\n  @@index([clientUserId])\n  @@index([status])\n  @@map(\"contracts\")\n}\n\n// ─── Session (Booking) ────────────────────────────────────────────\n\nmodel Session {\n  id           String        @id @default(uuid())\n  contractId   String        @map(\"contract_id\")\n  clientUserId String        @map(\"client_user_id\")\n  ptUserId     String        @map(\"pt_user_id\")\n  status       SessionStatus @default(REQUESTED)\n  sessionMode  SessionMode   @default(OFFLINE) @map(\"session_mode\")\n\n  // Scheduling — authoritative datetime range\n  scheduledStartAt DateTime @map(\"scheduled_start_at\")\n  scheduledEndAt   DateTime @map(\"scheduled_end_at\")\n\n  location           String?\n  notes              String?\n  ptNotes            String?   @map(\"pt_notes\")\n  cancelledBy        String?   @map(\"cancelled_by\")\n  cancellationReason String?   @map(\"cancellation_reason\")\n  sessionDeducted    Boolean   @default(false) @map(\"session_deducted\")\n  completedAt        DateTime? @map(\"completed_at\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  contract Contract       @relation(fields: [contractId], references: [id], onDelete: Cascade)\n  review   SessionReview?\n\n  @@index([contractId])\n  @@index([clientUserId])\n  @@index([ptUserId])\n  @@index([scheduledStartAt])\n  @@map(\"sessions\")\n}\n\n// ─── Session Review ───────────────────────────────────────────────\n\nmodel SessionReview {\n  id           String   @id @default(uuid())\n  sessionId    String   @unique @map(\"session_id\")\n  contractId   String   @map(\"contract_id\")\n  clientUserId String   @map(\"client_user_id\")\n  rating       Int // 1–5\n  comment      String?\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n\n  session  Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)\n  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)\n\n  @@index([contractId])\n  @@map(\"session_reviews\")\n}\n\n// ─── Notification ─────────────────────────────────────────────────\n\nmodel Notification {\n  id         String                 @id @default(uuid())\n  userId     String                 @map(\"user_id\")\n  text       String\n  eventType  NotificationEventType  @map(\"event_type\")\n  entityType NotificationEntityType @map(\"entity_type\")\n  entityId   String                 @map(\"entity_id\")\n  link       String?\n  unread     Boolean                @default(true)\n  createdAt  DateTime               @default(now()) @map(\"created_at\")\n  updatedAt  DateTime               @updatedAt @map(\"updated_at\")\n\n  @@index([userId, createdAt])\n  @@index([userId, unread])\n  @@map(\"notifications\")\n}\n\n// ─── PT Availability ──────────────────────────────────────────────\n\nmodel PTAvailability {\n  id        String    @id @default(uuid())\n  ptUserId  String    @map(\"pt_user_id\")\n  dayOfWeek DayOfWeek @map(\"day_of_week\")\n  startTime String    @map(\"start_time\") // \"09:00\"\n  endTime   String    @map(\"end_time\") // \"17:00\"\n  isActive  Boolean   @default(true) @map(\"is_active\")\n  createdAt DateTime  @default(now()) @map(\"created_at\")\n  updatedAt DateTime  @updatedAt @map(\"updated_at\")\n\n  @@index([ptUserId])\n  @@map(\"pt_availability\")\n}\n\n// ─── PT Schedule Exception ────────────────────────────────────────\n\nmodel PTScheduleException {\n  id        String   @id @default(uuid())\n  ptUserId  String   @map(\"pt_user_id\")\n  date      DateTime\n  reason    String?\n  createdAt DateTime @default(now()) @map(\"created_at\")\n\n  @@index([ptUserId, date])\n  @@map(\"pt_schedule_exceptions\")\n}\n\nmodel InBodyEntry {\n  id     String   @id @default(uuid())\n  userId String   @map(\"user_id\")\n  date   DateTime @default(now())\n\n  // Basic metrics\n  weight     Float\n  height     Float?\n  bmi        Float?\n  bmr        Float?\n  bodyFat    Float  @map(\"body_fat\") // Mass in kg or %? Let's use mass kg\n  bodyFatPct Float? @map(\"body_fat_pct\") // Percentage\n  muscleMass Float  @map(\"muscle_mass\")\n\n  // Segmental Lean Analysis (kg)\n  rightArmMuscle Float? @map(\"right_arm_muscle\")\n  leftArmMuscle  Float? @map(\"left_arm_muscle\")\n  trunkMuscle    Float? @map(\"trunk_muscle\")\n  rightLegMuscle Float? @map(\"right_leg_muscle\")\n  leftLegMuscle  Float? @map(\"left_leg_muscle\")\n\n  // Segmental Fat Analysis (kg)\n  rightArmFat Float? @map(\"right_arm_fat\")\n  leftArmFat  Float? @map(\"left_arm_fat\")\n  trunkFat    Float? @map(\"trunk_fat\")\n  rightLegFat Float? @map(\"right_leg_fat\")\n  leftLegFat  Float? @map(\"left_leg_fat\")\n\n  status    String   @default(\"manual\") // manual, extracted, pending\n  notes     String?\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  @@index([userId, date])\n  @@map(\"inbody_entries\")\n}\n",
  "inlineSchemaHash": "327bc3f01b227fe8f93a1df194e4cf929e5d8f6cddbbee9dd3b333532842d8f3",
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

config.runtimeDataModel = JSON.parse("{\"models\":{\"UserProfile\":{\"dbName\":\"user_profiles\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"firstName\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastName\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"email\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"isPT\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"age\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gender\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Gender\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"heightCm\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"goal\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Goal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"activityLevel\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ActivityLevel\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"experienceLevel\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ExperienceLevel\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"preferredTrainingDays\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableEquipment\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"injuries\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"currentWeight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"targetWeight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionDurationMinutes\",\"dbName\":\"session_duration_minutes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":60,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"ptApplication\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PTApplication\",\"relationName\":\"PTApplicationToUserProfile\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PTApplication\":{\"dbName\":\"pt_applications\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userProfileId\",\"dbName\":\"user_profile_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PTApplicationStatus\",\"default\":\"DRAFT\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"phoneNumber\",\"dbName\":\"phone_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"nationalIdNumber\",\"dbName\":\"national_id_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"currentAddress\",\"dbName\":\"current_address\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idCardFrontUrl\",\"dbName\":\"id_card_front_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idCardBackUrl\",\"dbName\":\"id_card_back_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"portraitPhotoUrl\",\"dbName\":\"portrait_photo_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"yearsOfExperience\",\"dbName\":\"years_of_experience\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"educationBackground\",\"dbName\":\"education_background\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"previousWorkExperience\",\"dbName\":\"previous_work_experience\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"professionalBio\",\"dbName\":\"professional_bio\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mainSpecialties\",\"dbName\":\"main_specialties\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"targetClientGroups\",\"dbName\":\"target_client_groups\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"primaryTrainingGoals\",\"dbName\":\"primary_training_goals\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"trainingMethodsApproach\",\"dbName\":\"training_methods_approach\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"portfolioUrl\",\"dbName\":\"portfolio_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"linkedinUrl\",\"dbName\":\"linkedin_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"websiteUrl\",\"dbName\":\"website_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"socialLinks\",\"dbName\":\"social_links\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availabilityNotes\",\"dbName\":\"availability_notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableTimeSlots\",\"dbName\":\"available_time_slots\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"serviceMode\",\"dbName\":\"service_mode\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ServiceMode\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"operatingAreas\",\"dbName\":\"operating_areas\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"desiredSessionPrice\",\"dbName\":\"desired_session_price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableDays\",\"dbName\":\"available_days\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableFrom\",\"dbName\":\"available_from\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availableUntil\",\"dbName\":\"available_until\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"gymAffiliation\",\"dbName\":\"gym_affiliation\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"monthlyProgramPrice\",\"dbName\":\"monthly_program_price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"packagePrice\",\"dbName\":\"package_price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionsPerPackage\",\"dbName\":\"sessions_per_package\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":10,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionDurationMinutes\",\"dbName\":\"session_duration_minutes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":60,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"availabilityBlocks\",\"dbName\":\"availability_blocks\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"additionalPricingNotes\",\"dbName\":\"additional_pricing_notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"otherReferences\",\"dbName\":\"other_references\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"adminNote\",\"dbName\":\"admin_note\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rejectionReason\",\"dbName\":\"rejection_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"submittedAt\",\"dbName\":\"submitted_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewedAt\",\"dbName\":\"reviewed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvedAt\",\"dbName\":\"approved_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"certificates\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PTApplicationCertificate\",\"relationName\":\"PTApplicationToPTApplicationCertificate\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"media\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PTApplicationMedia\",\"relationName\":\"PTApplicationToPTApplicationMedia\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userProfile\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"UserProfile\",\"relationName\":\"PTApplicationToUserProfile\",\"relationFromFields\":[\"userProfileId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PTApplicationCertificate\":{\"dbName\":\"pt_application_certificates\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"applicationId\",\"dbName\":\"application_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"certificateName\",\"dbName\":\"certificate_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"issuingOrganization\",\"dbName\":\"issuing_organization\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"isCurrentlyValid\",\"dbName\":\"is_currently_valid\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Boolean\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"certificationStatus\",\"dbName\":\"certification_status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"issueDate\",\"dbName\":\"issue_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"expirationDate\",\"dbName\":\"expiration_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"certificateFileUrl\",\"dbName\":\"certificate_file_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"application\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PTApplication\",\"relationName\":\"PTApplicationToPTApplicationCertificate\",\"relationFromFields\":[\"applicationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PTApplicationMedia\":{\"dbName\":\"pt_application_media\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"applicationId\",\"dbName\":\"application_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"groupType\",\"dbName\":\"group_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"MediaGroupType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fileUrl\",\"dbName\":\"file_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"label\",\"dbName\":\"label\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"application\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PTApplication\",\"relationName\":\"PTApplicationToPTApplicationMedia\",\"relationFromFields\":[\"applicationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"Contract\":{\"dbName\":\"contracts\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientUserId\",\"dbName\":\"client_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ContractStatus\",\"default\":\"PENDING_REVIEW\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"packageType\",\"dbName\":\"package_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PackageType\",\"default\":\"PACKAGE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"packageName\",\"dbName\":\"package_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"packageQuantity\",\"dbName\":\"package_quantity\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":1,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"extraSessions\",\"dbName\":\"extra_sessions\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalSessions\",\"dbName\":\"total_sessions\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"usedSessions\",\"dbName\":\"used_sessions\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"price\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"pricePerSession\",\"dbName\":\"price_per_session\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startDate\",\"dbName\":\"start_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endDate\",\"dbName\":\"end_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completedAt\",\"dbName\":\"completed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientMessage\",\"dbName\":\"client_message\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rejectionReason\",\"dbName\":\"rejection_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancelledBy\",\"dbName\":\"cancelled_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancellationReason\",\"dbName\":\"cancellation_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"terms\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"sessions\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Session\",\"relationName\":\"ContractToSession\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviews\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"SessionReview\",\"relationName\":\"ContractToSessionReview\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"Session\":{\"dbName\":\"sessions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contractId\",\"dbName\":\"contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientUserId\",\"dbName\":\"client_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"SessionStatus\",\"default\":\"REQUESTED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionMode\",\"dbName\":\"session_mode\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"SessionMode\",\"default\":\"OFFLINE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"scheduledStartAt\",\"dbName\":\"scheduled_start_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"scheduledEndAt\",\"dbName\":\"scheduled_end_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"location\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptNotes\",\"dbName\":\"pt_notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancelledBy\",\"dbName\":\"cancelled_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cancellationReason\",\"dbName\":\"cancellation_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionDeducted\",\"dbName\":\"session_deducted\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completedAt\",\"dbName\":\"completed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"contract\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Contract\",\"relationName\":\"ContractToSession\",\"relationFromFields\":[\"contractId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"review\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"SessionReview\",\"relationName\":\"SessionToSessionReview\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"SessionReview\":{\"dbName\":\"session_reviews\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionId\",\"dbName\":\"session_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contractId\",\"dbName\":\"contract_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientUserId\",\"dbName\":\"client_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rating\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"comment\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"session\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Session\",\"relationName\":\"SessionToSessionReview\",\"relationFromFields\":[\"sessionId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contract\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Contract\",\"relationName\":\"ContractToSessionReview\",\"relationFromFields\":[\"contractId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"Notification\":{\"dbName\":\"notifications\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"text\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"eventType\",\"dbName\":\"event_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NotificationEventType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entityType\",\"dbName\":\"entity_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NotificationEntityType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entityId\",\"dbName\":\"entity_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"link\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unread\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":true,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PTAvailability\":{\"dbName\":\"pt_availability\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"dayOfWeek\",\"dbName\":\"day_of_week\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DayOfWeek\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startTime\",\"dbName\":\"start_time\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endTime\",\"dbName\":\"end_time\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"isActive\",\"dbName\":\"is_active\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":true,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"PTScheduleException\":{\"dbName\":\"pt_schedule_exceptions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"InBodyEntry\":{\"dbName\":\"inbody_entries\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"weight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"height\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bmi\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bmr\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bodyFat\",\"dbName\":\"body_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bodyFatPct\",\"dbName\":\"body_fat_pct\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"muscleMass\",\"dbName\":\"muscle_mass\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rightArmMuscle\",\"dbName\":\"right_arm_muscle\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"leftArmMuscle\",\"dbName\":\"left_arm_muscle\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"trunkMuscle\",\"dbName\":\"trunk_muscle\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rightLegMuscle\",\"dbName\":\"right_leg_muscle\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"leftLegMuscle\",\"dbName\":\"left_leg_muscle\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rightArmFat\",\"dbName\":\"right_arm_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"leftArmFat\",\"dbName\":\"left_arm_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"trunkFat\",\"dbName\":\"trunk_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rightLegFat\",\"dbName\":\"right_leg_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"leftLegFat\",\"dbName\":\"left_leg_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"manual\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false}},\"enums\":{\"Gender\":{\"values\":[{\"name\":\"MALE\",\"dbName\":null},{\"name\":\"FEMALE\",\"dbName\":null},{\"name\":\"OTHER\",\"dbName\":null}],\"dbName\":null},\"Goal\":{\"values\":[{\"name\":\"WEIGHT_LOSS\",\"dbName\":null},{\"name\":\"MUSCLE_GAIN\",\"dbName\":null},{\"name\":\"MAINTENANCE\",\"dbName\":null},{\"name\":\"ATHLETIC_PERFORMANCE\",\"dbName\":null}],\"dbName\":null},\"ActivityLevel\":{\"values\":[{\"name\":\"SEDENTARY\",\"dbName\":null},{\"name\":\"LIGHTLY_ACTIVE\",\"dbName\":null},{\"name\":\"MODERATELY_ACTIVE\",\"dbName\":null},{\"name\":\"VERY_ACTIVE\",\"dbName\":null},{\"name\":\"EXTREMELY_ACTIVE\",\"dbName\":null}],\"dbName\":null},\"ExperienceLevel\":{\"values\":[{\"name\":\"BEGINNER\",\"dbName\":null},{\"name\":\"INTERMEDIATE\",\"dbName\":null},{\"name\":\"ADVANCED\",\"dbName\":null}],\"dbName\":null},\"PTApplicationStatus\":{\"values\":[{\"name\":\"DRAFT\",\"dbName\":null},{\"name\":\"SUBMITTED\",\"dbName\":null},{\"name\":\"UNDER_REVIEW\",\"dbName\":null},{\"name\":\"NEEDS_MORE_INFO\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null}],\"dbName\":null},\"ServiceMode\":{\"values\":[{\"name\":\"ONLINE\",\"dbName\":null},{\"name\":\"OFFLINE\",\"dbName\":null},{\"name\":\"HYBRID\",\"dbName\":null}],\"dbName\":null},\"MediaGroupType\":{\"values\":[{\"name\":\"IDENTITY\",\"dbName\":null},{\"name\":\"CERTIFICATE\",\"dbName\":null},{\"name\":\"PORTFOLIO\",\"dbName\":null}],\"dbName\":null},\"ContractStatus\":{\"values\":[{\"name\":\"PENDING_REVIEW\",\"dbName\":null},{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"COMPLETED\",\"dbName\":null},{\"name\":\"EXPIRED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null}],\"dbName\":null},\"PackageType\":{\"values\":[{\"name\":\"PER_SESSION\",\"dbName\":null},{\"name\":\"PACKAGE\",\"dbName\":null}],\"dbName\":null},\"SessionStatus\":{\"values\":[{\"name\":\"REQUESTED\",\"dbName\":null},{\"name\":\"CONFIRMED\",\"dbName\":null},{\"name\":\"COMPLETED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"NO_SHOW\",\"dbName\":null}],\"dbName\":null},\"SessionMode\":{\"values\":[{\"name\":\"ONLINE\",\"dbName\":null},{\"name\":\"OFFLINE\",\"dbName\":null},{\"name\":\"HYBRID\",\"dbName\":null}],\"dbName\":null},\"DayOfWeek\":{\"values\":[{\"name\":\"MONDAY\",\"dbName\":null},{\"name\":\"TUESDAY\",\"dbName\":null},{\"name\":\"WEDNESDAY\",\"dbName\":null},{\"name\":\"THURSDAY\",\"dbName\":null},{\"name\":\"FRIDAY\",\"dbName\":null},{\"name\":\"SATURDAY\",\"dbName\":null},{\"name\":\"SUNDAY\",\"dbName\":null}],\"dbName\":null},\"NotificationEventType\":{\"values\":[{\"name\":\"CONTRACT_REQUESTED\",\"dbName\":null},{\"name\":\"CONTRACT_ACCEPTED\",\"dbName\":null},{\"name\":\"CONTRACT_REJECTED\",\"dbName\":null},{\"name\":\"CONTRACT_CANCELLED\",\"dbName\":null},{\"name\":\"SESSION_BOOKED\",\"dbName\":null},{\"name\":\"SESSION_CONFIRMED\",\"dbName\":null},{\"name\":\"SESSION_COMPLETED\",\"dbName\":null},{\"name\":\"SESSION_CANCELLED\",\"dbName\":null},{\"name\":\"SESSION_NO_SHOW_CLIENT\",\"dbName\":null},{\"name\":\"SESSION_NO_SHOW_PT\",\"dbName\":null}],\"dbName\":null},\"NotificationEntityType\":{\"values\":[{\"name\":\"CONTRACT\",\"dbName\":null},{\"name\":\"SESSION\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
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
path.join(__dirname, "libquery_engine-debian-openssl-3.0.x.so.node");
path.join(process.cwd(), "src/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node")

// file annotations for bundling tools to include these files
path.join(__dirname, "libquery_engine-linux-musl-openssl-3.0.x.so.node");
path.join(process.cwd(), "src/generated/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node")
// file annotations for bundling tools to include these files
path.join(__dirname, "schema.prisma");
path.join(process.cwd(), "src/generated/prisma/schema.prisma")
