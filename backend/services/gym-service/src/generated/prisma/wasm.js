
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

exports.Prisma.GymPhotoScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  fileName: 'fileName',
  sortOrder: 'sortOrder',
  isCover: 'isCover',
  s3Key: 's3Key',
  category: 'category',
  visibility: 'visibility',
  createdAt: 'createdAt'
};

exports.Prisma.GymBranchDocumentScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  docType: 'docType',
  required: 'required',
  fileToken: 'fileToken',
  status: 'status',
  verifiedBy: 'verifiedBy',
  verifiedAt: 'verifiedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymBranchReviewIssueScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  category: 'category',
  message: 'message',
  createdBy: 'createdBy',
  resolvedAt: 'resolvedAt',
  createdAt: 'createdAt'
};

exports.Prisma.GymOperatingHoursScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  day: 'day',
  type: 'type',
  openMinute: 'openMinute',
  closeMinute: 'closeMinute',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymComplaintScalarFieldEnum = {
  id: 'id',
  gymId: 'gymId',
  partnerId: 'partnerId',
  source: 'source',
  issueType: 'issueType',
  reporterUserId: 'reporterUserId',
  description: 'description',
  photoTokens: 'photoTokens',
  status: 'status',
  assignedAdminId: 'assignedAdminId',
  adminResponse: 'adminResponse',
  resolvedAt: 'resolvedAt',
  resolvedBy: 'resolvedBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PartnerAuditLogScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  actorUserId: 'actorUserId',
  action: 'action',
  targetAccountId: 'targetAccountId',
  reason: 'reason',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.PartnerInternalNoteScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  authorAdminId: 'authorAdminId',
  text: 'text',
  createdAt: 'createdAt'
};

exports.Prisma.PlatformCommissionRateScalarFieldEnum = {
  id: 'id',
  rate: 'rate',
  effectiveFrom: 'effectiveFrom',
  createdBy: 'createdBy',
  createdAt: 'createdAt'
};

exports.Prisma.GymPartnerScalarFieldEnum = {
  id: 'id',
  legalName: 'legalName',
  partnerKind: 'partnerKind',
  taxCode: 'taxCode',
  businessLicenseNo: 'businessLicenseNo',
  contactEmail: 'contactEmail',
  contactPhone: 'contactPhone',
  status: 'status',
  verificationStatus: 'verificationStatus',
  verificationNotes: 'verificationNotes',
  verifiedAt: 'verifiedAt',
  verifiedBy: 'verifiedBy',
  assignedAdminId: 'assignedAdminId',
  brandId: 'brandId',
  commissionRateOverride: 'commissionRateOverride',
  suspendedAt: 'suspendedAt',
  suspendedReason: 'suspendedReason',
  suspendedBy: 'suspendedBy',
  terminatedAt: 'terminatedAt',
  terminationReason: 'terminationReason',
  terminationMemberPolicy: 'terminationMemberPolicy',
  rejectedAt: 'rejectedAt',
  rejectionReason: 'rejectionReason',
  expectedBranchCount: 'expectedBranchCount',
  negotiationNotes: 'negotiationNotes',
  source: 'source',
  submittedAt: 'submittedAt',
  representativeName: 'representativeName',
  representativeRole: 'representativeRole',
  businessScale: 'businessScale',
  payoutBankName: 'payoutBankName',
  payoutBankAccountNumber: 'payoutBankAccountNumber',
  payoutBankAccountHolder: 'payoutBankAccountHolder',
  termsAcceptedVersion: 'termsAcceptedVersion',
  termsAcceptedAt: 'termsAcceptedAt',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymPartnerAccountScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  userId: 'userId',
  role: 'role',
  scopedGymIds: 'scopedGymIds',
  status: 'status',
  invitedBy: 'invitedBy',
  invitedAt: 'invitedAt',
  activatedAt: 'activatedAt',
  revokedAt: 'revokedAt',
  revokedReason: 'revokedReason',
  contactPhone: 'contactPhone',
  onboardingCompletedAt: 'onboardingCompletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PartnerInvitationScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  email: 'email',
  role: 'role',
  scopedGymIds: 'scopedGymIds',
  tokenHash: 'tokenHash',
  expiresAt: 'expiresAt',
  status: 'status',
  sentCount: 'sentCount',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  acceptedAt: 'acceptedAt'
};

exports.Prisma.GymPartnerDocumentScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  docType: 'docType',
  required: 'required',
  fileUrl: 'fileUrl',
  fileKey: 'fileKey',
  mimeType: 'mimeType',
  sizeBytes: 'sizeBytes',
  uploadedBy: 'uploadedBy',
  version: 'version',
  reviewNote: 'reviewNote',
  status: 'status',
  verifiedBy: 'verifiedBy',
  verifiedAt: 'verifiedAt',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymPartnerDocumentFileScalarFieldEnum = {
  id: 'id',
  documentId: 'documentId',
  fileKey: 'fileKey',
  mimeType: 'mimeType',
  sizeBytes: 'sizeBytes',
  uploadedBy: 'uploadedBy',
  createdAt: 'createdAt'
};

exports.Prisma.GymPartnerReviewIssueScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  category: 'category',
  message: 'message',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  resubmitNote: 'resubmitNote',
  resubmittedAt: 'resubmittedAt',
  adminFollowUp: 'adminFollowUp',
  resolvedBy: 'resolvedBy',
  resolvedAt: 'resolvedAt'
};

exports.Prisma.PartnerUploadIntentScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  kind: 'kind',
  docType: 'docType',
  gymId: 'gymId',
  photoCategory: 'photoCategory',
  objectKey: 'objectKey',
  contentType: 'contentType',
  maxBytes: 'maxBytes',
  createdBy: 'createdBy',
  expiresAt: 'expiresAt',
  confirmedAt: 'confirmedAt',
  createdAt: 'createdAt'
};

exports.Prisma.GymPartnerContactLogScalarFieldEnum = {
  id: 'id',
  partnerId: 'partnerId',
  channel: 'channel',
  note: 'note',
  occurredAt: 'occurredAt',
  createdBy: 'createdBy',
  createdAt: 'createdAt'
};

exports.Prisma.GymBrandScalarFieldEnum = {
  id: 'id',
  ownerId: 'ownerId',
  name: 'name',
  approvedName: 'approvedName',
  pendingName: 'pendingName',
  description: 'description',
  logoKey: 'logoKey',
  facebookUrl: 'facebookUrl',
  instagramUrl: 'instagramUrl',
  tiktokUrl: 'tiktokUrl',
  youtubeUrl: 'youtubeUrl',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymScalarFieldEnum = {
  id: 'id',
  ownerId: 'ownerId',
  brandId: 'brandId',
  name: 'name',
  approvedName: 'approvedName',
  pendingName: 'pendingName',
  pendingNameNote: 'pendingNameNote',
  pendingAddressNote: 'pendingAddressNote',
  changesRequestedAt: 'changesRequestedAt',
  changesRequestedBy: 'changesRequestedBy',
  description: 'description',
  address: 'address',
  approvedAddress: 'approvedAddress',
  pendingAddress: 'pendingAddress',
  city: 'city',
  provinceCode: 'provinceCode',
  wardCode: 'wardCode',
  latitude: 'latitude',
  longitude: 'longitude',
  locationNote: 'locationNote',
  facilities: 'facilities',
  phone: 'phone',
  email: 'email',
  status: 'status',
  wizardStep: 'wizardStep',
  operationalStatus: 'operationalStatus',
  closureReason: 'closureReason',
  expectedReopenAt: 'expectedReopenAt',
  closedAt: 'closedAt',
  reopenedAt: 'reopenedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GymMembershipPlanScalarFieldEnum = {
  id: 'id',
  brandId: 'brandId',
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
  effectiveAt: 'effectiveAt',
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
exports.GymPhotoCategory = exports.$Enums.GymPhotoCategory = {
  EXTERIOR: 'EXTERIOR',
  MAIN_TRAINING_AREA: 'MAIN_TRAINING_AREA',
  EQUIPMENT: 'EQUIPMENT',
  CARDIO: 'CARDIO',
  CHANGING_ROOM: 'CHANGING_ROOM',
  AMENITIES: 'AMENITIES',
  OTHER: 'OTHER'
};

exports.GymPhotoVisibility = exports.$Enums.GymPhotoVisibility = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC'
};

exports.BranchDocumentType = exports.$Enums.BranchDocumentType = {
  LEASE_OR_PROPERTY_DOC: 'LEASE_OR_PROPERTY_DOC',
  FIRE_SAFETY_CERTIFICATE: 'FIRE_SAFETY_CERTIFICATE',
  FACILITY_PHOTOS: 'FACILITY_PHOTOS'
};

exports.PartnerDocumentStatus = exports.$Enums.PartnerDocumentStatus = {
  PENDING: 'PENDING',
  RECEIVED: 'RECEIVED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED'
};

exports.BranchReviewCategory = exports.$Enums.BranchReviewCategory = {
  BASIC_INFO: 'BASIC_INFO',
  LOCATION: 'LOCATION',
  OPENING_HOURS: 'OPENING_HOURS',
  FACILITIES: 'FACILITIES',
  PHOTOS: 'PHOTOS',
  VERIFICATION: 'VERIFICATION',
  OTHER: 'OTHER'
};

exports.WeekDay = exports.$Enums.WeekDay = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY'
};

exports.DayScheduleType = exports.$Enums.DayScheduleType = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  ALL_DAY: 'ALL_DAY'
};

exports.ComplaintSource = exports.$Enums.ComplaintSource = {
  SELF_DETECTED: 'SELF_DETECTED',
  MEMBER_REPORT: 'MEMBER_REPORT',
  PT_REPORT: 'PT_REPORT',
  PARTNER_DISCLOSED: 'PARTNER_DISCLOSED'
};

exports.ComplaintIssueType = exports.$Enums.ComplaintIssueType = {
  CLEANLINESS: 'CLEANLINESS',
  STAFF_BEHAVIOR: 'STAFF_BEHAVIOR',
  EQUIPMENT_CONDITION: 'EQUIPMENT_CONDITION',
  FALSE_ADVERTISING: 'FALSE_ADVERTISING',
  BILLING: 'BILLING',
  SAFETY: 'SAFETY',
  OTHER: 'OTHER'
};

exports.ComplaintStatus = exports.$Enums.ComplaintStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED'
};

exports.PartnerAuditAction = exports.$Enums.PartnerAuditAction = {
  PARTNER_CREATED: 'PARTNER_CREATED',
  PARTNER_UPDATED: 'PARTNER_UPDATED',
  ACCOUNT_PROVISIONED: 'ACCOUNT_PROVISIONED',
  INVITATION_RESENT: 'INVITATION_RESENT',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  PASSWORD_RESET_SENT: 'PASSWORD_RESET_SENT',
  SESSIONS_REVOKED: 'SESSIONS_REVOKED',
  ACCOUNT_REVOKED: 'ACCOUNT_REVOKED',
  OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED',
  PARTNER_SUSPENDED: 'PARTNER_SUSPENDED',
  PARTNER_UNSUSPENDED: 'PARTNER_UNSUSPENDED',
  PARTNER_TERMINATED: 'PARTNER_TERMINATED',
  VIEWED_AS_PARTNER: 'VIEWED_AS_PARTNER',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  ISSUE_MARKED_UPDATED: 'ISSUE_MARKED_UPDATED',
  APPLICATION_RESUBMITTED: 'APPLICATION_RESUBMITTED',
  ISSUE_RESOLVED: 'ISSUE_RESOLVED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_REPLACED: 'DOCUMENT_REPLACED',
  DOCUMENT_ACCEPTED: 'DOCUMENT_ACCEPTED',
  DOCUMENT_UPDATE_REQUESTED: 'DOCUMENT_UPDATE_REQUESTED',
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_REOPENED: 'APPLICATION_REOPENED',
  DOCUMENT_VIEWED: 'DOCUMENT_VIEWED'
};

exports.GymPartnerKind = exports.$Enums.GymPartnerKind = {
  BUSINESS: 'BUSINESS',
  INDIVIDUAL: 'INDIVIDUAL'
};

exports.GymPartnerStatus = exports.$Enums.GymPartnerStatus = {
  PROSPECT: 'PROSPECT',
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  TERMINATED: 'TERMINATED'
};

exports.PartnerVerificationStatus = exports.$Enums.PartnerVerificationStatus = {
  NOT_VERIFIED: 'NOT_VERIFIED',
  IN_REVIEW: 'IN_REVIEW',
  NEEDS_INFO: 'NEEDS_INFO',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED'
};

exports.TerminationMemberPolicy = exports.$Enums.TerminationMemberPolicy = {
  SERVE_UNTIL_EXPIRY: 'SERVE_UNTIL_EXPIRY',
  PRORATED_REFUND: 'PRORATED_REFUND'
};

exports.GymPartnerSource = exports.$Enums.GymPartnerSource = {
  ADMIN_CREATED: 'ADMIN_CREATED',
  SELF_SERVICE: 'SELF_SERVICE'
};

exports.PartnerRepresentativeRole = exports.$Enums.PartnerRepresentativeRole = {
  GYM_OWNER: 'GYM_OWNER',
  CO_FOUNDER: 'CO_FOUNDER',
  LEGAL_REPRESENTATIVE: 'LEGAL_REPRESENTATIVE',
  AUTHORIZED_MANAGER: 'AUTHORIZED_MANAGER'
};

exports.PartnerBusinessScale = exports.$Enums.PartnerBusinessScale = {
  ONE_BRANCH: 'ONE_BRANCH',
  MULTIPLE_BRANCHES: 'MULTIPLE_BRANCHES'
};

exports.PartnerAccountRole = exports.$Enums.PartnerAccountRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER'
};

exports.PartnerAccountStatus = exports.$Enums.PartnerAccountStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED'
};

exports.PartnerInvitationStatus = exports.$Enums.PartnerInvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED'
};

exports.PartnerDocumentType = exports.$Enums.PartnerDocumentType = {
  BUSINESS_LICENSE: 'BUSINESS_LICENSE',
  REPRESENTATIVE_ID: 'REPRESENTATIVE_ID',
  PREMISES_PROOF: 'PREMISES_PROOF',
  TAX_CODE_CERTIFICATE: 'TAX_CODE_CERTIFICATE',
  SITE_PHOTOS: 'SITE_PHOTOS',
  FIRE_SAFETY_CERTIFICATE: 'FIRE_SAFETY_CERTIFICATE'
};

exports.PartnerReviewCategory = exports.$Enums.PartnerReviewCategory = {
  REPRESENTATIVE: 'REPRESENTATIVE',
  BRAND: 'BRAND',
  BRANCH: 'BRANCH',
  LOCATION: 'LOCATION',
  PHOTOS: 'PHOTOS',
  LEGAL: 'LEGAL',
  OTHER: 'OTHER'
};

exports.PartnerReviewIssueStatus = exports.$Enums.PartnerReviewIssueStatus = {
  OPEN: 'OPEN',
  RESUBMITTED: 'RESUBMITTED',
  RESOLVED: 'RESOLVED'
};

exports.PartnerUploadKind = exports.$Enums.PartnerUploadKind = {
  DOCUMENT: 'DOCUMENT',
  PHOTO: 'PHOTO',
  LOGO: 'LOGO'
};

exports.PartnerContactChannel = exports.$Enums.PartnerContactChannel = {
  EMAIL: 'EMAIL',
  CALL: 'CALL',
  MEETING: 'MEETING',
  OTHER: 'OTHER'
};

exports.GymStatus = exports.$Enums.GymStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

exports.GymOperationalStatus = exports.$Enums.GymOperationalStatus = {
  OPEN: 'OPEN',
  TEMPORARILY_CLOSED: 'TEMPORARILY_CLOSED',
  PERMANENTLY_CLOSED: 'PERMANENTLY_CLOSED'
};

exports.GymFacility = exports.$Enums.GymFacility = {
  FREE_WEIGHTS: 'FREE_WEIGHTS',
  CARDIO_MACHINES: 'CARDIO_MACHINES',
  FUNCTIONAL_TRAINING_AREA: 'FUNCTIONAL_TRAINING_AREA',
  GROUP_CLASSES: 'GROUP_CLASSES',
  YOGA_STUDIO: 'YOGA_STUDIO',
  SWIMMING_POOL: 'SWIMMING_POOL',
  PERSONAL_TRAINER: 'PERSONAL_TRAINER',
  INBODY_SCAN: 'INBODY_SCAN',
  LOCKER_ROOM: 'LOCKER_ROOM',
  SHOWER: 'SHOWER',
  SAUNA: 'SAUNA',
  TOWEL_SERVICE: 'TOWEL_SERVICE',
  PARKING: 'PARKING',
  WIFI: 'WIFI',
  AIR_CONDITIONING: 'AIR_CONDITIONING',
  DRINKING_WATER: 'DRINKING_WATER',
  KIDS_AREA: 'KIDS_AREA',
  VENDING_MACHINE: 'VENDING_MACHINE'
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
  GymPhoto: 'GymPhoto',
  GymBranchDocument: 'GymBranchDocument',
  GymBranchReviewIssue: 'GymBranchReviewIssue',
  GymOperatingHours: 'GymOperatingHours',
  GymComplaint: 'GymComplaint',
  PartnerAuditLog: 'PartnerAuditLog',
  PartnerInternalNote: 'PartnerInternalNote',
  PlatformCommissionRate: 'PlatformCommissionRate',
  GymPartner: 'GymPartner',
  GymPartnerAccount: 'GymPartnerAccount',
  PartnerInvitation: 'PartnerInvitation',
  GymPartnerDocument: 'GymPartnerDocument',
  GymPartnerDocumentFile: 'GymPartnerDocumentFile',
  GymPartnerReviewIssue: 'GymPartnerReviewIssue',
  PartnerUploadIntent: 'PartnerUploadIntent',
  GymPartnerContactLog: 'GymPartnerContactLog',
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
