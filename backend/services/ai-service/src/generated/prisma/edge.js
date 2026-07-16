
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
  WorkoutPlan: 'WorkoutPlan',
  NutritionPlan: 'NutritionPlan',
  KnowledgeSource: 'KnowledgeSource',
  KnowledgeDocument: 'KnowledgeDocument',
  KnowledgeChunk: 'KnowledgeChunk',
  KnowledgePipelineRun: 'KnowledgePipelineRun',
  KnowledgeReviewItem: 'KnowledgeReviewItem'
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
      "value": "C:\\D_Backup\\project_personal\\fitness-assistant\\backend\\services\\ai-service\\src\\generated\\prisma",
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
    "sourceFilePath": "C:\\D_Backup\\project_personal\\fitness-assistant\\backend\\services\\ai-service\\prisma\\schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null,
    "schemaEnvPath": "../../../.env"
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
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nmodel Conversation {\n  id                        String    @id @default(uuid())\n  userId                    String?   @map(\"user_id\")\n  sessionId                 String?   @map(\"session_id\")\n  question                  String\n  answer                    String\n  modelUsed                 String    @map(\"model_used\")\n  responseTime              Float     @map(\"response_time\")\n  relevance                 String?\n  relevanceExplanation      String?   @map(\"relevance_explanation\")\n  promptTokens              Int       @map(\"prompt_tokens\")\n  completionTokens          Int       @map(\"completion_tokens\")\n  totalTokens               Int       @map(\"total_tokens\")\n  cost                      Float     @default(0)\n  feedback                  Int?\n  feedbackTimestamp         DateTime? @map(\"feedback_timestamp\")\n  // ── Observability fields ────────────────────────────────────────────────────\n  traceId                   String?   @map(\"trace_id\")\n  usedFallback              Boolean   @default(false) @map(\"used_fallback\")\n  usedDeterministicFallback Boolean   @default(false) @map(\"used_deterministic_fallback\")\n  responseLanguage          String?   @map(\"response_language\")\n  routeIntent               String?   @map(\"route_intent\")\n  warningCount              Int       @default(0) @map(\"warning_count\")\n  createdAt                 DateTime  @default(now()) @map(\"created_at\")\n\n  @@index([userId, createdAt])\n  @@index([userId, sessionId, createdAt])\n  @@index([createdAt])\n  @@index([routeIntent])\n  @@index([usedFallback])\n  @@map(\"conversations\")\n}\n\nmodel ChatSession {\n  id            String    @id @default(uuid())\n  userId        String    @map(\"user_id\")\n  title         String\n  // Bumped explicitly whenever a new turn is appended to this session (not on\n  // every touch) — the sidebar sorts by this, so a title rename alone never\n  // reorders the list.\n  lastMessageAt DateTime  @default(now()) @map(\"last_message_at\")\n  archivedAt    DateTime? @map(\"archived_at\")\n  createdAt     DateTime  @default(now()) @map(\"created_at\")\n  updatedAt     DateTime  @updatedAt @map(\"updated_at\")\n\n  @@index([userId, archivedAt, lastMessageAt])\n  @@map(\"chat_sessions\")\n}\n\nenum PlanStatus {\n  QUEUED\n  PROCESSING\n  COMPLETED\n  FAILED\n}\n\nenum PtReviewStatus {\n  PENDING_PT_REVIEW\n  PT_APPROVED\n  PT_REJECTED\n}\n\nmodel WorkoutPlan {\n  id             String          @id @default(uuid())\n  userId         String          @map(\"user_id\")\n  name           String\n  description    String?\n  goal           String\n  duration       Int\n  daysPerWeek    Int             @map(\"days_per_week\")\n  /// Structured JSON matching PlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING\n  plan           Json\n  status         PlanStatus      @default(QUEUED)\n  version        Int             @default(1)\n  /// BullMQ job ID — used for polling via GET /plans/job/:jobId\n  jobId          String?         @map(\"job_id\")\n  failReason     String?         @map(\"fail_reason\")\n  ptUserId       String?         @map(\"pt_user_id\")\n  ptName         String?         @map(\"pt_name\")\n  clientName     String?         @map(\"client_name\")\n  ptReviewStatus PtReviewStatus? @map(\"pt_review_status\")\n  ptNote         String?         @map(\"pt_note\")\n  ptReviewedAt   DateTime?       @map(\"pt_reviewed_at\")\n  archivedAt     DateTime?       @map(\"archived_at\")\n  createdAt      DateTime        @default(now()) @map(\"created_at\")\n  updatedAt      DateTime        @updatedAt @map(\"updated_at\")\n\n  @@index([userId])\n  @@index([jobId])\n  @@index([userId, status])\n  @@index([ptUserId, ptReviewStatus])\n  @@index([userId, archivedAt])\n  @@map(\"workout_plans\")\n}\n\nmodel NutritionPlan {\n  id            String     @id @default(uuid())\n  userId        String     @map(\"user_id\")\n  name          String\n  goal          String\n  durationWeeks Int        @map(\"duration_weeks\")\n  mealsPerDay   Int        @map(\"meals_per_day\")\n  /// Structured JSON matching NutritionPlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING\n  plan          Json\n  status        PlanStatus @default(QUEUED)\n  jobId         String?    @map(\"job_id\")\n  failReason    String?    @map(\"fail_reason\")\n  archivedAt    DateTime?  @map(\"archived_at\")\n  createdAt     DateTime   @default(now()) @map(\"created_at\")\n  updatedAt     DateTime   @updatedAt @map(\"updated_at\")\n\n  @@index([userId])\n  @@index([jobId])\n  @@index([userId, status])\n  @@index([userId, archivedAt])\n  @@map(\"nutrition_plans\")\n}\n\nenum KnowledgeSourceType {\n  RSS\n  API\n  WEB\n  LOCAL\n}\n\nenum KnowledgeDocumentTopic {\n  TRAINING\n  NUTRITION\n  RECOVERY\n  INJURY\n  BODY_COMPOSITION\n  GENERAL\n}\n\nenum KnowledgeDocumentStatus {\n  CRAWLED\n  CLEANED\n  SCORED\n  EMBEDDED\n  REJECTED\n  REVIEW\n}\n\nenum KnowledgePipelineRunStatus {\n  RUNNING\n  SUCCESS\n  FAILED\n}\n\nenum KnowledgeReviewStatus {\n  PENDING\n  APPROVED\n  REJECTED\n}\n\nmodel KnowledgeSource {\n  id            String              @id @default(uuid())\n  name          String\n  baseUrl       String              @unique @map(\"base_url\")\n  sourceType    KnowledgeSourceType @map(\"source_type\")\n  trustTier     Int                 @default(3) @map(\"trust_tier\")\n  crawlCron     String              @default(\"0 2 * * *\") @map(\"crawl_cron\")\n  isActive      Boolean             @default(true) @map(\"is_active\")\n  lastCrawledAt DateTime?           @map(\"last_crawled_at\")\n  createdAt     DateTime            @default(now()) @map(\"created_at\")\n\n  documents KnowledgeDocument[]\n\n  @@index([isActive])\n  @@map(\"knowledge_sources\")\n}\n\nmodel KnowledgeDocument {\n  id              String                  @id @default(uuid())\n  sourceId        String                  @map(\"source_id\")\n  url             String\n  title           String?\n  author          String?\n  language        String?\n  contentHash     String                  @unique @map(\"content_hash\")\n  rawObjectKey    String?                 @map(\"raw_object_key\")\n  cleanText       String?                 @map(\"clean_text\")\n  topic           KnowledgeDocumentTopic?\n  trustScore      Decimal?                @map(\"trust_score\") @db.Decimal(4, 3)\n  qualityScore    Decimal?                @map(\"quality_score\") @db.Decimal(4, 3)\n  safetyFlag      Boolean                 @default(false) @map(\"safety_flag\")\n  status          KnowledgeDocumentStatus @default(CRAWLED)\n  rejectionReason String?                 @map(\"rejection_reason\")\n  publishedAt     DateTime?               @map(\"published_at\")\n  crawledAt       DateTime                @default(now()) @map(\"crawled_at\")\n  processedAt     DateTime?               @map(\"processed_at\")\n\n  source      KnowledgeSource       @relation(fields: [sourceId], references: [id], onDelete: Cascade)\n  chunks      KnowledgeChunk[]\n  reviewItems KnowledgeReviewItem[]\n\n  @@index([status])\n  @@index([topic])\n  @@index([sourceId])\n  @@index([contentHash])\n  @@map(\"knowledge_documents\")\n}\n\nmodel KnowledgeChunk {\n  id         String   @id @default(uuid())\n  documentId String   @map(\"document_id\")\n  chunkIndex Int      @map(\"chunk_index\")\n  text       String\n  tokenCount Int?     @map(\"token_count\")\n  vectorId   String   @map(\"vector_id\")\n  embeddedAt DateTime @default(now()) @map(\"embedded_at\")\n\n  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)\n\n  @@unique([documentId, chunkIndex])\n  @@index([vectorId])\n  @@map(\"knowledge_chunks\")\n}\n\nmodel KnowledgePipelineRun {\n  id           String                     @id @default(uuid())\n  runType      String                     @default(\"manual_local_evidence\") @map(\"run_type\")\n  startedAt    DateTime                   @default(now()) @map(\"started_at\")\n  finishedAt   DateTime?                  @map(\"finished_at\")\n  docsCrawled  Int                        @default(0) @map(\"docs_crawled\")\n  docsAccepted Int                        @default(0) @map(\"docs_accepted\")\n  docsRejected Int                        @default(0) @map(\"docs_rejected\")\n  docsReview   Int                        @default(0) @map(\"docs_review\")\n  status       KnowledgePipelineRunStatus @default(RUNNING)\n\n  @@index([startedAt])\n  @@index([status])\n  @@map(\"knowledge_pipeline_runs\")\n}\n\nmodel KnowledgeReviewItem {\n  id         String                @id @default(uuid())\n  documentId String                @map(\"document_id\")\n  reason     String?\n  status     KnowledgeReviewStatus @default(PENDING)\n  reviewedBy String?               @map(\"reviewed_by\")\n  reviewedAt DateTime?             @map(\"reviewed_at\")\n\n  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)\n\n  @@index([status])\n  @@index([documentId])\n  @@map(\"knowledge_review_queue\")\n}\n",
  "inlineSchemaHash": "115a0c14694a1d29d5110a3d4169c8246c1de28c0f05db6bec7707469fa931ff",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Conversation\":{\"dbName\":\"conversations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sessionId\",\"dbName\":\"session_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"question\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"answer\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"modelUsed\",\"dbName\":\"model_used\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"responseTime\",\"dbName\":\"response_time\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relevance\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"relevanceExplanation\",\"dbName\":\"relevance_explanation\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"promptTokens\",\"dbName\":\"prompt_tokens\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completionTokens\",\"dbName\":\"completion_tokens\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalTokens\",\"dbName\":\"total_tokens\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cost\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"feedback\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"feedbackTimestamp\",\"dbName\":\"feedback_timestamp\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"traceId\",\"dbName\":\"trace_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"usedFallback\",\"dbName\":\"used_fallback\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"usedDeterministicFallback\",\"dbName\":\"used_deterministic_fallback\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"responseLanguage\",\"dbName\":\"response_language\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"routeIntent\",\"dbName\":\"route_intent\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"warningCount\",\"dbName\":\"warning_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"ChatSession\":{\"dbName\":\"chat_sessions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastMessageAt\",\"dbName\":\"last_message_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"archivedAt\",\"dbName\":\"archived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WorkoutPlan\":{\"dbName\":\"workout_plans\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"goal\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"duration\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"daysPerWeek\",\"dbName\":\"days_per_week\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"plan\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Structured JSON matching PlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING\"},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PlanStatus\",\"default\":\"QUEUED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"version\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":1,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"jobId\",\"dbName\":\"job_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"BullMQ job ID — used for polling via GET /plans/job/:jobId\"},{\"name\":\"failReason\",\"dbName\":\"fail_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptUserId\",\"dbName\":\"pt_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptName\",\"dbName\":\"pt_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"clientName\",\"dbName\":\"client_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptReviewStatus\",\"dbName\":\"pt_review_status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"PtReviewStatus\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptNote\",\"dbName\":\"pt_note\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"ptReviewedAt\",\"dbName\":\"pt_reviewed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"archivedAt\",\"dbName\":\"archived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"NutritionPlan\":{\"dbName\":\"nutrition_plans\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"goal\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationWeeks\",\"dbName\":\"duration_weeks\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealsPerDay\",\"dbName\":\"meals_per_day\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"plan\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false,\"documentation\":\"Structured JSON matching NutritionPlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING\"},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"PlanStatus\",\"default\":\"QUEUED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"jobId\",\"dbName\":\"job_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"failReason\",\"dbName\":\"fail_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"archivedAt\",\"dbName\":\"archived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"KnowledgeSource\":{\"dbName\":\"knowledge_sources\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"baseUrl\",\"dbName\":\"base_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceType\",\"dbName\":\"source_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeSourceType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"trustTier\",\"dbName\":\"trust_tier\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":3,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"crawlCron\",\"dbName\":\"crawl_cron\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"0 2 * * *\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"isActive\",\"dbName\":\"is_active\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":true,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"lastCrawledAt\",\"dbName\":\"last_crawled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"documents\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeDocument\",\"relationName\":\"KnowledgeDocumentToKnowledgeSource\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"KnowledgeDocument\":{\"dbName\":\"knowledge_documents\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceId\",\"dbName\":\"source_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"author\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"language\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"contentHash\",\"dbName\":\"content_hash\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rawObjectKey\",\"dbName\":\"raw_object_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cleanText\",\"dbName\":\"clean_text\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"topic\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeDocumentTopic\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"trustScore\",\"dbName\":\"trust_score\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"qualityScore\",\"dbName\":\"quality_score\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"safetyFlag\",\"dbName\":\"safety_flag\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"KnowledgeDocumentStatus\",\"default\":\"CRAWLED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rejectionReason\",\"dbName\":\"rejection_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"publishedAt\",\"dbName\":\"published_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"crawledAt\",\"dbName\":\"crawled_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"processedAt\",\"dbName\":\"processed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"source\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeSource\",\"relationName\":\"KnowledgeDocumentToKnowledgeSource\",\"relationFromFields\":[\"sourceId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"chunks\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeChunk\",\"relationName\":\"KnowledgeChunkToKnowledgeDocument\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewItems\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeReviewItem\",\"relationName\":\"KnowledgeDocumentToKnowledgeReviewItem\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"KnowledgeChunk\":{\"dbName\":\"knowledge_chunks\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"documentId\",\"dbName\":\"document_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"chunkIndex\",\"dbName\":\"chunk_index\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"text\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"tokenCount\",\"dbName\":\"token_count\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"vectorId\",\"dbName\":\"vector_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"embeddedAt\",\"dbName\":\"embedded_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"document\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeDocument\",\"relationName\":\"KnowledgeChunkToKnowledgeDocument\",\"relationFromFields\":[\"documentId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"documentId\",\"chunkIndex\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"documentId\",\"chunkIndex\"]}],\"isGenerated\":false},\"KnowledgePipelineRun\":{\"dbName\":\"knowledge_pipeline_runs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"runType\",\"dbName\":\"run_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"manual_local_evidence\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startedAt\",\"dbName\":\"started_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"finishedAt\",\"dbName\":\"finished_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"docsCrawled\",\"dbName\":\"docs_crawled\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"docsAccepted\",\"dbName\":\"docs_accepted\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"docsRejected\",\"dbName\":\"docs_rejected\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"docsReview\",\"dbName\":\"docs_review\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"KnowledgePipelineRunStatus\",\"default\":\"RUNNING\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"KnowledgeReviewItem\":{\"dbName\":\"knowledge_review_queue\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"documentId\",\"dbName\":\"document_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"KnowledgeReviewStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewedBy\",\"dbName\":\"reviewed_by\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reviewedAt\",\"dbName\":\"reviewed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"document\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"KnowledgeDocument\",\"relationName\":\"KnowledgeDocumentToKnowledgeReviewItem\",\"relationFromFields\":[\"documentId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false}},\"enums\":{\"PlanStatus\":{\"values\":[{\"name\":\"QUEUED\",\"dbName\":null},{\"name\":\"PROCESSING\",\"dbName\":null},{\"name\":\"COMPLETED\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null}],\"dbName\":null},\"PtReviewStatus\":{\"values\":[{\"name\":\"PENDING_PT_REVIEW\",\"dbName\":null},{\"name\":\"PT_APPROVED\",\"dbName\":null},{\"name\":\"PT_REJECTED\",\"dbName\":null}],\"dbName\":null},\"KnowledgeSourceType\":{\"values\":[{\"name\":\"RSS\",\"dbName\":null},{\"name\":\"API\",\"dbName\":null},{\"name\":\"WEB\",\"dbName\":null},{\"name\":\"LOCAL\",\"dbName\":null}],\"dbName\":null},\"KnowledgeDocumentTopic\":{\"values\":[{\"name\":\"TRAINING\",\"dbName\":null},{\"name\":\"NUTRITION\",\"dbName\":null},{\"name\":\"RECOVERY\",\"dbName\":null},{\"name\":\"INJURY\",\"dbName\":null},{\"name\":\"BODY_COMPOSITION\",\"dbName\":null},{\"name\":\"GENERAL\",\"dbName\":null}],\"dbName\":null},\"KnowledgeDocumentStatus\":{\"values\":[{\"name\":\"CRAWLED\",\"dbName\":null},{\"name\":\"CLEANED\",\"dbName\":null},{\"name\":\"SCORED\",\"dbName\":null},{\"name\":\"EMBEDDED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"REVIEW\",\"dbName\":null}],\"dbName\":null},\"KnowledgePipelineRunStatus\":{\"values\":[{\"name\":\"RUNNING\",\"dbName\":null},{\"name\":\"SUCCESS\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null}],\"dbName\":null},\"KnowledgeReviewStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
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

