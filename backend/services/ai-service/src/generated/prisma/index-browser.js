
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

exports.Prisma.ConversationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  sessionId: 'sessionId',
  question: 'question',
  answer: 'answer',
  modelUsed: 'modelUsed',
  responseTime: 'responseTime',
  relevance: 'relevance',
  relevanceExplanation: 'relevanceExplanation',
  promptTokens: 'promptTokens',
  completionTokens: 'completionTokens',
  totalTokens: 'totalTokens',
  cost: 'cost',
  feedback: 'feedback',
  feedbackTimestamp: 'feedbackTimestamp',
  traceId: 'traceId',
  usedFallback: 'usedFallback',
  usedDeterministicFallback: 'usedDeterministicFallback',
  responseLanguage: 'responseLanguage',
  routeIntent: 'routeIntent',
  warningCount: 'warningCount',
  createdAt: 'createdAt'
};

exports.Prisma.ChatSessionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  title: 'title',
  lastMessageAt: 'lastMessageAt',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserMemoryScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  content: 'content',
  category: 'category',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutPlanScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  goal: 'goal',
  duration: 'duration',
  daysPerWeek: 'daysPerWeek',
  plan: 'plan',
  status: 'status',
  version: 'version',
  jobId: 'jobId',
  failReason: 'failReason',
  ptUserId: 'ptUserId',
  ptName: 'ptName',
  clientName: 'clientName',
  ptReviewStatus: 'ptReviewStatus',
  ptNote: 'ptNote',
  ptReviewedAt: 'ptReviewedAt',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PublishedPlanScalarFieldEnum = {
  id: 'id',
  sourcePlanId: 'sourcePlanId',
  publisherId: 'publisherId',
  title: 'title',
  description: 'description',
  goal: 'goal',
  moderationStatus: 'moderationStatus',
  moderationNote: 'moderationNote',
  avgRating: 'avgRating',
  ratingCount: 'ratingCount',
  publishedAt: 'publishedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  version: 'version',
  previousVersionId: 'previousVersionId',
  changelog: 'changelog',
  improvementReason: 'improvementReason',
  approvedBy: 'approvedBy',
  publisherIsVerifiedPt: 'publisherIsVerifiedPt',
  qualityScore: 'qualityScore',
  qualityScoreComputedAt: 'qualityScoreComputedAt'
};

exports.Prisma.PlanModerationAnalysisScalarFieldEnum = {
  id: 'id',
  publishedPlanId: 'publishedPlanId',
  computedStats: 'computedStats',
  ruleFlags: 'ruleFlags',
  similarListings: 'similarListings',
  aiConcerns: 'aiConcerns',
  aiConfidenceScore: 'aiConfidenceScore',
  aiRecommendation: 'aiRecommendation',
  explanationForAdmin: 'explanationForAdmin',
  usedFallback: 'usedFallback',
  createdAt: 'createdAt'
};

exports.Prisma.PlanReviewScalarFieldEnum = {
  id: 'id',
  publishedPlanId: 'publishedPlanId',
  reviewerId: 'reviewerId',
  rating: 'rating',
  comment: 'comment',
  createdAt: 'createdAt',
  goalFit: 'goalFit',
  difficultyFit: 'difficultyFit',
  enjoyment: 'enjoyment',
  clarity: 'clarity',
  equipmentFit: 'equipmentFit',
  timeFit: 'timeFit',
  resultsPerception: 'resultsPerception',
  wouldUseAgain: 'wouldUseAgain',
  complaintTags: 'complaintTags',
  freeText: 'freeText'
};

exports.Prisma.PlanImprovementSuggestionScalarFieldEnum = {
  id: 'id',
  publishedPlanId: 'publishedPlanId',
  basedOnReviewCount: 'basedOnReviewCount',
  qualityScoreSnapshot: 'qualityScoreSnapshot',
  suggestions: 'suggestions',
  commonComplaints: 'commonComplaints',
  summary: 'summary',
  generatedAt: 'generatedAt'
};

exports.Prisma.PlanAdoptionScalarFieldEnum = {
  id: 'id',
  publishedPlanId: 'publishedPlanId',
  adopterId: 'adopterId',
  accessBasis: 'accessBasis',
  purchaseId: 'purchaseId',
  wasCustomized: 'wasCustomized',
  createdAt: 'createdAt'
};

exports.Prisma.TrainingPackageScalarFieldEnum = {
  id: 'id',
  sellerId: 'sellerId',
  publishedPlanId: 'publishedPlanId',
  name: 'name',
  description: 'description',
  price: 'price',
  durationWeeks: 'durationWeeks',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TrainingPackagePurchaseScalarFieldEnum = {
  id: 'id',
  packageId: 'packageId',
  buyerId: 'buyerId',
  priceAtPurchase: 'priceAtPurchase',
  paymentTransactionId: 'paymentTransactionId',
  status: 'status',
  purchasedAt: 'purchasedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PersonalizedServiceScalarFieldEnum = {
  id: 'id',
  sellerId: 'sellerId',
  serviceType: 'serviceType',
  title: 'title',
  description: 'description',
  price: 'price',
  deliverables: 'deliverables',
  revisionLimit: 'revisionLimit',
  initialDeliveryDays: 'initialDeliveryDays',
  supportWeeks: 'supportWeeks',
  targetGoal: 'targetGoal',
  targetLevel: 'targetLevel',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PersonalizedServiceOrderScalarFieldEnum = {
  id: 'id',
  serviceId: 'serviceId',
  sellerId: 'sellerId',
  buyerId: 'buyerId',
  status: 'status',
  titleSnapshot: 'titleSnapshot',
  descriptionSnapshot: 'descriptionSnapshot',
  serviceTypeSnapshot: 'serviceTypeSnapshot',
  deliverablesSnapshot: 'deliverablesSnapshot',
  revisionLimitSnapshot: 'revisionLimitSnapshot',
  initialDeliveryDaysSnapshot: 'initialDeliveryDaysSnapshot',
  supportWeeksSnapshot: 'supportWeeksSnapshot',
  priceAtPurchase: 'priceAtPurchase',
  paymentTransactionId: 'paymentTransactionId',
  purchasedAt: 'purchasedAt',
  milestoneIntakeReleasedAt: 'milestoneIntakeReleasedAt',
  milestoneDraftReleasedAt: 'milestoneDraftReleasedAt',
  milestoneAcceptedReleasedAt: 'milestoneAcceptedReleasedAt',
  milestoneCompletedReleasedAt: 'milestoneCompletedReleasedAt',
  intakeData: 'intakeData',
  consentCategories: 'consentCategories',
  intakeSubmittedAt: 'intakeSubmittedAt',
  contractId: 'contractId',
  initialDeliveryDeadline: 'initialDeliveryDeadline',
  draftContent: 'draftContent',
  draftVersion: 'draftVersion',
  revisionCount: 'revisionCount',
  acceptedAt: 'acceptedAt',
  committedProgramId: 'committedProgramId',
  cancelledAt: 'cancelledAt',
  cancelReason: 'cancelReason',
  refundRequestedAt: 'refundRequestedAt',
  refundedAt: 'refundedAt',
  disputeReason: 'disputeReason',
  disputedAt: 'disputedAt',
  preRefundStatus: 'preRefundStatus',
  cumulativeRefundedAmount: 'cumulativeRefundedAmount',
  refundResolvedBy: 'refundResolvedBy',
  refundResolvedAt: 'refundResolvedAt',
  refundResolutionNote: 'refundResolutionNote',
  refundDecision: 'refundDecision',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PersonalizedServicePlanVersionScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  version: 'version',
  content: 'content',
  status: 'status',
  createdBy: 'createdBy',
  changeReason: 'changeReason',
  createdAt: 'createdAt'
};

exports.Prisma.PersonalizedServiceCheckInScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  buyerId: 'buyerId',
  weekNumber: 'weekNumber',
  weight: 'weight',
  energyLevel: 'energyLevel',
  sleepQuality: 'sleepQuality',
  stressLevel: 'stressLevel',
  overallRpe: 'overallRpe',
  workoutAdherence: 'workoutAdherence',
  nutritionAdherence: 'nutritionAdherence',
  painOrDiscomfort: 'painOrDiscomfort',
  notes: 'notes',
  requiresAttention: 'requiresAttention',
  createdAt: 'createdAt'
};

exports.Prisma.PersonalizedServiceReviewScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  buyerId: 'buyerId',
  sellerId: 'sellerId',
  overallRating: 'overallRating',
  communicationRating: 'communicationRating',
  personalizationRating: 'personalizationRating',
  planQualityRating: 'planQualityRating',
  comment: 'comment',
  createdAt: 'createdAt'
};

exports.Prisma.PersonalizedServiceRevisionRequestScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  category: 'category',
  comment: 'comment',
  createdAt: 'createdAt',
  resolvedAt: 'resolvedAt'
};

exports.Prisma.NutritionPlanScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  mealsPerDay: 'mealsPerDay',
  plan: 'plan',
  status: 'status',
  jobId: 'jobId',
  failReason: 'failReason',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.KnowledgeSourceScalarFieldEnum = {
  id: 'id',
  name: 'name',
  baseUrl: 'baseUrl',
  sourceType: 'sourceType',
  trustTier: 'trustTier',
  crawlCron: 'crawlCron',
  isActive: 'isActive',
  lastCrawledAt: 'lastCrawledAt',
  createdAt: 'createdAt'
};

exports.Prisma.KnowledgeDocumentScalarFieldEnum = {
  id: 'id',
  sourceId: 'sourceId',
  url: 'url',
  title: 'title',
  author: 'author',
  language: 'language',
  contentHash: 'contentHash',
  rawObjectKey: 'rawObjectKey',
  cleanText: 'cleanText',
  topic: 'topic',
  trustScore: 'trustScore',
  qualityScore: 'qualityScore',
  safetyFlag: 'safetyFlag',
  status: 'status',
  rejectionReason: 'rejectionReason',
  publishedAt: 'publishedAt',
  crawledAt: 'crawledAt',
  processedAt: 'processedAt'
};

exports.Prisma.KnowledgeChunkScalarFieldEnum = {
  id: 'id',
  documentId: 'documentId',
  chunkIndex: 'chunkIndex',
  text: 'text',
  tokenCount: 'tokenCount',
  vectorId: 'vectorId',
  embeddedAt: 'embeddedAt'
};

exports.Prisma.KnowledgePipelineRunScalarFieldEnum = {
  id: 'id',
  runType: 'runType',
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',
  docsCrawled: 'docsCrawled',
  docsAccepted: 'docsAccepted',
  docsRejected: 'docsRejected',
  docsReview: 'docsReview',
  status: 'status'
};

exports.Prisma.KnowledgeReviewItemScalarFieldEnum = {
  id: 'id',
  documentId: 'documentId',
  reason: 'reason',
  status: 'status',
  reviewedBy: 'reviewedBy',
  reviewedAt: 'reviewedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
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
exports.PlanStatus = exports.$Enums.PlanStatus = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

exports.PtReviewStatus = exports.$Enums.PtReviewStatus = {
  PENDING_PT_REVIEW: 'PENDING_PT_REVIEW',
  PT_APPROVED: 'PT_APPROVED',
  PT_REJECTED: 'PT_REJECTED'
};

exports.PublishModerationStatus = exports.$Enums.PublishModerationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.TrainingPackageStatus = exports.$Enums.TrainingPackageStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
};

exports.TrainingPackagePurchaseStatus = exports.$Enums.TrainingPackagePurchaseStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED'
};

exports.PersonalizedServiceType = exports.$Enums.PersonalizedServiceType = {
  PERSONALIZED_WORKOUT: 'PERSONALIZED_WORKOUT',
  PERSONALIZED_NUTRITION: 'PERSONALIZED_NUTRITION',
  WORKOUT_AND_NUTRITION: 'WORKOUT_AND_NUTRITION',
  ONLINE_COACHING: 'ONLINE_COACHING'
};

exports.PersonalizedServiceStatus = exports.$Enums.PersonalizedServiceStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
};

exports.PersonalizedServiceOrderStatus = exports.$Enums.PersonalizedServiceOrderStatus = {
  PURCHASED: 'PURCHASED',
  INTAKE_PENDING: 'INTAKE_PENDING',
  INTAKE_SUBMITTED: 'INTAKE_SUBMITTED',
  PT_REVIEWING: 'PT_REVIEWING',
  IN_PROGRESS: 'IN_PROGRESS',
  DRAFT_DELIVERED: 'DRAFT_DELIVERED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  REVISION_IN_PROGRESS: 'REVISION_IN_PROGRESS',
  ACCEPTED: 'ACCEPTED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED'
};

exports.PlanVersionStatus = exports.$Enums.PlanVersionStatus = {
  DELIVERED: 'DELIVERED',
  ACCEPTED: 'ACCEPTED',
  SUPERSEDED: 'SUPERSEDED'
};

exports.RevisionRequestCategory = exports.$Enums.RevisionRequestCategory = {
  EXERCISE: 'EXERCISE',
  SCHEDULE: 'SCHEDULE',
  DIFFICULTY: 'DIFFICULTY',
  EQUIPMENT: 'EQUIPMENT',
  NUTRITION: 'NUTRITION',
  OTHER: 'OTHER'
};

exports.KnowledgeSourceType = exports.$Enums.KnowledgeSourceType = {
  RSS: 'RSS',
  API: 'API',
  WEB: 'WEB',
  LOCAL: 'LOCAL'
};

exports.KnowledgeDocumentTopic = exports.$Enums.KnowledgeDocumentTopic = {
  TRAINING: 'TRAINING',
  NUTRITION: 'NUTRITION',
  RECOVERY: 'RECOVERY',
  INJURY: 'INJURY',
  BODY_COMPOSITION: 'BODY_COMPOSITION',
  GENERAL: 'GENERAL'
};

exports.KnowledgeDocumentStatus = exports.$Enums.KnowledgeDocumentStatus = {
  CRAWLED: 'CRAWLED',
  CLEANED: 'CLEANED',
  SCORED: 'SCORED',
  EMBEDDED: 'EMBEDDED',
  REJECTED: 'REJECTED',
  REVIEW: 'REVIEW'
};

exports.KnowledgePipelineRunStatus = exports.$Enums.KnowledgePipelineRunStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED'
};

exports.KnowledgeReviewStatus = exports.$Enums.KnowledgeReviewStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.Prisma.ModelName = {
  Conversation: 'Conversation',
  ChatSession: 'ChatSession',
  UserMemory: 'UserMemory',
  WorkoutPlan: 'WorkoutPlan',
  PublishedPlan: 'PublishedPlan',
  PlanModerationAnalysis: 'PlanModerationAnalysis',
  PlanReview: 'PlanReview',
  PlanImprovementSuggestion: 'PlanImprovementSuggestion',
  PlanAdoption: 'PlanAdoption',
  TrainingPackage: 'TrainingPackage',
  TrainingPackagePurchase: 'TrainingPackagePurchase',
  PersonalizedService: 'PersonalizedService',
  PersonalizedServiceOrder: 'PersonalizedServiceOrder',
  PersonalizedServicePlanVersion: 'PersonalizedServicePlanVersion',
  PersonalizedServiceCheckIn: 'PersonalizedServiceCheckIn',
  PersonalizedServiceReview: 'PersonalizedServiceReview',
  PersonalizedServiceRevisionRequest: 'PersonalizedServiceRevisionRequest',
  NutritionPlan: 'NutritionPlan',
  KnowledgeSource: 'KnowledgeSource',
  KnowledgeDocument: 'KnowledgeDocument',
  KnowledgeChunk: 'KnowledgeChunk',
  KnowledgePipelineRun: 'KnowledgePipelineRun',
  KnowledgeReviewItem: 'KnowledgeReviewItem'
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
