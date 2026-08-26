
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

exports.Prisma.ExerciseScalarFieldEnum = {
  id: 'id',
  exerciseName: 'exerciseName',
  typeOfActivity: 'typeOfActivity',
  typeOfEquipment: 'typeOfEquipment',
  bodyPart: 'bodyPart',
  type: 'type',
  muscleGroupsActivated: 'muscleGroupsActivated',
  instructions: 'instructions',
  videoUrl: 'videoUrl',
  movementPattern: 'movementPattern',
  mechanics: 'mechanics',
  contraindications: 'contraindications',
  difficultyLevel: 'difficultyLevel',
  loggingMode: 'loggingMode',
  status: 'status',
  source: 'source',
  ownerId: 'ownerId',
  archivedAt: 'archivedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EquipmentScalarFieldEnum = {
  id: 'id',
  slug: 'slug',
  name: 'name',
  category: 'category',
  aliases: 'aliases',
  description: 'description',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExerciseEquipmentScalarFieldEnum = {
  id: 'id',
  exerciseId: 'exerciseId',
  equipmentId: 'equipmentId',
  requirementType: 'requirementType',
  createdAt: 'createdAt'
};

exports.Prisma.UserEquipmentScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  equipmentId: 'equipmentId',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  date: 'date',
  duration: 'duration',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutExerciseScalarFieldEnum = {
  id: 'id',
  workoutId: 'workoutId',
  exerciseId: 'exerciseId',
  programExerciseId: 'programExerciseId',
  sets: 'sets',
  reps: 'reps',
  duration: 'duration',
  weight: 'weight',
  notes: 'notes',
  order: 'order',
  createdAt: 'createdAt',
  exerciseNameSnapshot: 'exerciseNameSnapshot'
};

exports.Prisma.WorkoutSetScalarFieldEnum = {
  id: 'id',
  workoutExerciseId: 'workoutExerciseId',
  setNumber: 'setNumber',
  reps: 'reps',
  weight: 'weight',
  rpe: 'rpe',
  rir: 'rir',
  completed: 'completed',
  createdAt: 'createdAt',
  setType: 'setType',
  tempo: 'tempo',
  rangeOfMotion: 'rangeOfMotion',
  side: 'side',
  painScore: 'painScore',
  techniqueNotes: 'techniqueNotes',
  bodyWeightAtSetKg: 'bodyWeightAtSetKg',
  durationSeconds: 'durationSeconds',
  distanceMeters: 'distanceMeters'
};

exports.Prisma.FoodScalarFieldEnum = {
  id: 'id',
  fdcId: 'fdcId',
  name: 'name',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fats: 'fats',
  source: 'source',
  imageUrl: 'imageUrl',
  foodForm: 'foodForm',
  isSupplement: 'isSupplement',
  realisticServingMaxG: 'realisticServingMaxG'
};

exports.Prisma.FoodAliasScalarFieldEnum = {
  id: 'id',
  foodId: 'foodId',
  alias: 'alias',
  aliasNormalized: 'aliasNormalized',
  language: 'language',
  source: 'source',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  mealType: 'mealType',
  foodName: 'foodName',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fats: 'fats',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionGoalScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
  waterMl: 'waterMl',
  status: 'status',
  validFrom: 'validFrom',
  supersededAt: 'supersededAt',
  reason: 'reason',
  triggeredBy: 'triggeredBy',
  goalMode: 'goalMode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BodyMetricsScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  weight: 'weight',
  bodyFat: 'bodyFat',
  muscleMass: 'muscleMass',
  bodyWater: 'bodyWater',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  aiPlanVersion: 'aiPlanVersion',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  daysPerWeek: 'daysPerWeek',
  status: 'status',
  archivedAt: 'archivedAt',
  version: 'version',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramDayScalarFieldEnum = {
  id: 'id',
  programId: 'programId',
  dayNumber: 'dayNumber',
  title: 'title',
  description: 'description',
  duration: 'duration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramExerciseGroupScalarFieldEnum = {
  id: 'id',
  programDayId: 'programDayId',
  type: 'type',
  order: 'order',
  restBetweenExercisesSeconds: 'restBetweenExercisesSeconds',
  restAfterRoundSeconds: 'restAfterRoundSeconds',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramExerciseGroupMemberScalarFieldEnum = {
  id: 'id',
  groupId: 'groupId',
  programExerciseId: 'programExerciseId',
  order: 'order'
};

exports.Prisma.WorkoutProgramExerciseScalarFieldEnum = {
  id: 'id',
  programDayId: 'programDayId',
  exerciseId: 'exerciseId',
  order: 'order',
  sets: 'sets',
  reps: 'reps',
  weight: 'weight',
  duration: 'duration',
  restSeconds: 'restSeconds',
  notes: 'notes',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutProgramTemplateScalarFieldEnum = {
  id: 'id',
  createdByUserId: 'createdByUserId',
  name: 'name',
  description: 'description',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  daysPerWeek: 'daysPerWeek',
  daysJson: 'daysJson',
  sharedWithUserIds: 'sharedWithUserIds',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutScheduleScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  programDayId: 'programDayId',
  workoutId: 'workoutId',
  status: 'status',
  progressPercent: 'progressPercent',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  totalExercises: 'totalExercises',
  completedExercises: 'completedExercises',
  totalSets: 'totalSets',
  completedSets: 'completedSets',
  durationSeconds: 'durationSeconds',
  caloriesEstimate: 'caloriesEstimate',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  notes: 'notes',
  trainingCycleId: 'trainingCycleId',
  originalPlannedDate: 'originalPlannedDate',
  rescheduledAt: 'rescheduledAt',
  rescheduleReason: 'rescheduleReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TrainingCycleScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  planId: 'planId',
  cycleIndex: 'cycleIndex',
  startDate: 'startDate',
  endDate: 'endDate',
  durationDays: 'durationDays',
  goal: 'goal',
  status: 'status',
  archivedAt: 'archivedAt',
  startInbodyId: 'startInbodyId',
  endInbodyId: 'endInbodyId',
  summary: 'summary',
  lowConfidence: 'lowConfidence',
  decision: 'decision',
  aiAnalysis: 'aiAnalysis',
  nextPlanId: 'nextPlanId',
  name: 'name',
  actualEndDate: 'actualEndDate',
  timezoneAtStart: 'timezoneAtStart',
  baselineMetrics: 'baselineMetrics',
  targetMetrics: 'targetMetrics',
  configuration: 'configuration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CycleAssessmentScalarFieldEnum = {
  id: 'id',
  cycleId: 'cycleId',
  assessmentVersion: 'assessmentVersion',
  status: 'status',
  decision: 'decision',
  confidenceScore: 'confidenceScore',
  dataQualityScore: 'dataQualityScore',
  computedMetrics: 'computedMetrics',
  reasonCodes: 'reasonCodes',
  conflictingSignals: 'conflictingSignals',
  safetyFlags: 'safetyFlags',
  recommendedActionScope: 'recommendedActionScope',
  aiSummary: 'aiSummary',
  proposedChanges: 'proposedChanges',
  userDecision: 'userDecision',
  reviewedAt: 'reviewedAt',
  nutritionDecision: 'nutritionDecision',
  nutritionConfidence: 'nutritionConfidence',
  nutritionSignals: 'nutritionSignals',
  nutritionProposedChanges: 'nutritionProposedChanges',
  nutritionReasonCodes: 'nutritionReasonCodes',
  nutritionEvidenceIds: 'nutritionEvidenceIds',
  nutritionRequiresConfirmation: 'nutritionRequiresConfirmation',
  nutritionAiHeadline: 'nutritionAiHeadline',
  nutritionAiExplanation: 'nutritionAiExplanation',
  nutritionUserDecision: 'nutritionUserDecision',
  nutritionReviewedAt: 'nutritionReviewedAt',
  appliedNutritionGoalId: 'appliedNutritionGoalId',
  createdAt: 'createdAt'
};

exports.Prisma.RecommendationAuditScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  cycleId: 'cycleId',
  assessmentId: 'assessmentId',
  engineVersion: 'engineVersion',
  decision: 'decision',
  reasonCodes: 'reasonCodes',
  metricsSnapshot: 'metricsSnapshot',
  aiSummary: 'aiSummary',
  presentedAt: 'presentedAt',
  userAction: 'userAction',
  userActionAt: 'userActionAt',
  createdAt: 'createdAt',
  feedbackSignalsUsed: 'feedbackSignalsUsed',
  feedbackSummarySnapshot: 'feedbackSummarySnapshot',
  aiFeedbackAnalysisId: 'aiFeedbackAnalysisId',
  finalDecisionReasonCodes: 'finalDecisionReasonCodes',
  complaintValidity: 'complaintValidity',
  decisionInfluenceFromFeedback: 'decisionInfluenceFromFeedback'
};

exports.Prisma.CoachClientActionAuditScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  clientUserId: 'clientUserId',
  action: 'action',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.PlanGenerationAuditScalarFieldEnum = {
  id: 'id',
  ptUserId: 'ptUserId',
  clientUserId: 'clientUserId',
  ptNotes: 'ptNotes',
  requestSnapshot: 'requestSnapshot',
  draftDays: 'draftDays',
  dataGaps: 'dataGaps',
  warnings: 'warnings',
  createdAt: 'createdAt'
};

exports.Prisma.CycleSessionFeedbackScalarFieldEnum = {
  id: 'id',
  cycleId: 'cycleId',
  workoutScheduleId: 'workoutScheduleId',
  readinessScore: 'readinessScore',
  sessionRpe: 'sessionRpe',
  painScore: 'painScore',
  notes: 'notes',
  sessionRating: 'sessionRating',
  difficulty: 'difficulty',
  enjoyment: 'enjoyment',
  fatigueAfterSession: 'fatigueAfterSession',
  painLocation: 'painLocation',
  wouldRepeatSession: 'wouldRepeatSession',
  perceivedProgress: 'perceivedProgress',
  feedbackMissing: 'feedbackMissing',
  skipReason: 'skipReason',
  shouldAdjustPlan: 'shouldAdjustPlan',
  userAvailableMakeupDay: 'userAvailableMakeupDay',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExerciseSessionFeedbackScalarFieldEnum = {
  id: 'id',
  sessionFeedbackId: 'sessionFeedbackId',
  exerciseId: 'exerciseId',
  rating: 'rating',
  issueType: 'issueType',
  note: 'note',
  createdAt: 'createdAt'
};

exports.Prisma.CycleFeedbackSummaryScalarFieldEnum = {
  id: 'id',
  cycleId: 'cycleId',
  totalSessions: 'totalSessions',
  completedSessions: 'completedSessions',
  partialSessions: 'partialSessions',
  skippedSessions: 'skippedSessions',
  cancelledSessions: 'cancelledSessions',
  feedbackSubmittedCount: 'feedbackSubmittedCount',
  feedbackMissingCount: 'feedbackMissingCount',
  feedbackCompletionRate: 'feedbackCompletionRate',
  averageSessionRating: 'averageSessionRating',
  averageDifficultyScore: 'averageDifficultyScore',
  averageEnjoymentScore: 'averageEnjoymentScore',
  averageFatigue: 'averageFatigue',
  averagePain: 'averagePain',
  mostCommonIssues: 'mostCommonIssues',
  mostLikedExercises: 'mostLikedExercises',
  mostDislikedExercises: 'mostDislikedExercises',
  exercisesWithPainReports: 'exercisesWithPainReports',
  sessionsMarkedTooHard: 'sessionsMarkedTooHard',
  sessionsMarkedTooEasy: 'sessionsMarkedTooEasy',
  sessionsUserWouldNotRepeat: 'sessionsUserWouldNotRepeat',
  positiveFeedbackCount: 'positiveFeedbackCount',
  negativeFeedbackCount: 'negativeFeedbackCount',
  neutralFeedbackCount: 'neutralFeedbackCount',
  mixedFeedbackCount: 'mixedFeedbackCount',
  feedbackSentimentByRules: 'feedbackSentimentByRules',
  dataQualityScore: 'dataQualityScore',
  safetyFlags: 'safetyFlags',
  equipmentMismatchFlags: 'equipmentMismatchFlags',
  adherenceRelatedComplaintFlags: 'adherenceRelatedComplaintFlags',
  motivationOrBoredomFlags: 'motivationOrBoredomFlags',
  computedAt: 'computedAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CycleFeedbackAnalysisAuditScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  cycleId: 'cycleId',
  cycleFeedbackSummarySnapshot: 'cycleFeedbackSummarySnapshot',
  feedbackInterpretation: 'feedbackInterpretation',
  sentiment: 'sentiment',
  complaintValidity: 'complaintValidity',
  complaintCategories: 'complaintCategories',
  suggestedImprovementAreas: 'suggestedImprovementAreas',
  riskFlags: 'riskFlags',
  recommendedDecisionInfluence: 'recommendedDecisionInfluence',
  explanationForUser: 'explanationForUser',
  explanationForCoach: 'explanationForCoach',
  aiFallback: 'aiFallback',
  createdAt: 'createdAt'
};

exports.Prisma.CycleInBodyLinkScalarFieldEnum = {
  id: 'id',
  cycleId: 'cycleId',
  inbodyEntryId: 'inbodyEntryId',
  linkedAt: 'linkedAt'
};

exports.Prisma.NutritionProgramScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  mealsPerDay: 'mealsPerDay',
  dailyCaloriesTarget: 'dailyCaloriesTarget',
  proteinTargetGrams: 'proteinTargetGrams',
  carbTargetGrams: 'carbTargetGrams',
  fatTargetGrams: 'fatTargetGrams',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  sourceGoalId: 'sourceGoalId',
  status: 'status',
  startDate: 'startDate',
  endDate: 'endDate',
  repeatEnabled: 'repeatEnabled',
  archivedAt: 'archivedAt',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramDayScalarFieldEnum = {
  id: 'id',
  programId: 'programId',
  dayNumber: 'dayNumber',
  title: 'title',
  totalCalories: 'totalCalories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramMealScalarFieldEnum = {
  id: 'id',
  dayId: 'dayId',
  mealType: 'mealType',
  title: 'title',
  calories: 'calories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramMealItemScalarFieldEnum = {
  id: 'id',
  mealId: 'mealId',
  foodId: 'foodId',
  customFoodName: 'customFoodName',
  quantity: 'quantity',
  unit: 'unit',
  calories: 'calories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionMealCompletionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  mealId: 'mealId',
  logDate: 'logDate',
  status: 'status',
  percentConsumed: 'percentConsumed',
  consumedCalories: 'consumedCalories',
  consumedProtein: 'consumedProtein',
  consumedCarbs: 'consumedCarbs',
  consumedFat: 'consumedFat',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExerciseSourceScalarFieldEnum = {
  id: 'id',
  exerciseId: 'exerciseId',
  sourceName: 'sourceName',
  externalId: 'externalId',
  sourceUrl: 'sourceUrl',
  dataLicense: 'dataLicense',
  mediaLicense: 'mediaLicense',
  sourceVersion: 'sourceVersion',
  importedAt: 'importedAt',
  rawHash: 'rawHash'
};

exports.Prisma.ExerciseAliasScalarFieldEnum = {
  id: 'id',
  exerciseId: 'exerciseId',
  language: 'language',
  alias: 'alias',
  aliasNormalized: 'aliasNormalized',
  aliasType: 'aliasType',
  source: 'source',
  createdAt: 'createdAt'
};

exports.Prisma.MuscleScalarFieldEnum = {
  id: 'id',
  code: 'code',
  nameVi: 'nameVi',
  nameEn: 'nameEn',
  anatomyRegion: 'anatomyRegion',
  parentMuscleId: 'parentMuscleId',
  createdAt: 'createdAt'
};

exports.Prisma.ExerciseMuscleScalarFieldEnum = {
  id: 'id',
  exerciseId: 'exerciseId',
  muscleId: 'muscleId',
  role: 'role',
  source: 'source',
  createdAt: 'createdAt'
};

exports.Prisma.FoodSourceScalarFieldEnum = {
  id: 'id',
  foodId: 'foodId',
  sourceName: 'sourceName',
  externalId: 'externalId',
  sourceUrl: 'sourceUrl',
  license: 'license',
  sourceVersion: 'sourceVersion',
  importedAt: 'importedAt',
  confidence: 'confidence'
};

exports.Prisma.RecipeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  nameVi: 'nameVi',
  version: 'version',
  yieldServings: 'yieldServings',
  preparationState: 'preparationState',
  source: 'source',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RecipeIngredientScalarFieldEnum = {
  id: 'id',
  recipeId: 'recipeId',
  foodId: 'foodId',
  amount: 'amount',
  unit: 'unit',
  gramsEquivalent: 'gramsEquivalent',
  note: 'note',
  createdAt: 'createdAt'
};

exports.Prisma.ImportBatchScalarFieldEnum = {
  id: 'id',
  source: 'source',
  sourceVersion: 'sourceVersion',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  status: 'status',
  dryRun: 'dryRun',
  insertedCount: 'insertedCount',
  updatedCount: 'updatedCount',
  skippedCount: 'skippedCount',
  duplicateCount: 'duplicateCount',
  reviewCount: 'reviewCount',
  errorCount: 'errorCount',
  checksum: 'checksum'
};

exports.Prisma.ImportRecordScalarFieldEnum = {
  id: 'id',
  batchId: 'batchId',
  externalRef: 'externalRef',
  decision: 'decision',
  targetTable: 'targetTable',
  targetId: 'targetId',
  detail: 'detail',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutImportBatchScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  source: 'source',
  fileName: 'fileName',
  status: 'status',
  parsedWorkoutsJson: 'parsedWorkoutsJson',
  matchSummaryJson: 'matchSummaryJson',
  createdWorkoutIds: 'createdWorkoutIds',
  committedSourceHashes: 'committedSourceHashes',
  createdAt: 'createdAt',
  committedAt: 'committedAt'
};

exports.Prisma.ExerciseReviewDecisionScalarFieldEnum = {
  id: 'id',
  externalRef: 'externalRef',
  source: 'source',
  decision: 'decision',
  targetExerciseId: 'targetExerciseId',
  createdExerciseId: 'createdExerciseId',
  note: 'note',
  duplicateDecisionAtReview: 'duplicateDecisionAtReview',
  candidateSnapshot: 'candidateSnapshot',
  reviewerId: 'reviewerId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutMutationEventScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  type: 'type',
  result: 'result',
  createdAt: 'createdAt'
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
exports.ExerciseType = exports.$Enums.ExerciseType = {
  STRENGTH: 'STRENGTH',
  CARDIO: 'CARDIO',
  MOBILITY: 'MOBILITY',
  STRENGTH_CARDIO: 'STRENGTH_CARDIO',
  STRENGTH_MOBILITY: 'STRENGTH_MOBILITY'
};

exports.EquipmentType = exports.$Enums.EquipmentType = {
  BODYWEIGHT: 'BODYWEIGHT',
  BARBELL: 'BARBELL',
  DUMBBELLS: 'DUMBBELLS',
  KETTLEBELL: 'KETTLEBELL',
  MACHINE: 'MACHINE',
  RESISTANCE_BAND: 'RESISTANCE_BAND',
  CABLE: 'CABLE',
  MEDICINE_BALL: 'MEDICINE_BALL',
  FOAM_ROLLER: 'FOAM_ROLLER'
};

exports.BodyPart = exports.$Enums.BodyPart = {
  UPPER_BODY: 'UPPER_BODY',
  LOWER_BODY: 'LOWER_BODY',
  CORE: 'CORE',
  FULL_BODY: 'FULL_BODY'
};

exports.MovementType = exports.$Enums.MovementType = {
  PUSH: 'PUSH',
  PULL: 'PULL',
  HOLD: 'HOLD',
  STRETCH: 'STRETCH'
};

exports.Prisma.ModelName = {
  Exercise: 'Exercise',
  Equipment: 'Equipment',
  ExerciseEquipment: 'ExerciseEquipment',
  UserEquipment: 'UserEquipment',
  Workout: 'Workout',
  WorkoutExercise: 'WorkoutExercise',
  WorkoutSet: 'WorkoutSet',
  Food: 'Food',
  FoodAlias: 'FoodAlias',
  NutritionLog: 'NutritionLog',
  NutritionGoal: 'NutritionGoal',
  BodyMetrics: 'BodyMetrics',
  WorkoutProgram: 'WorkoutProgram',
  WorkoutProgramDay: 'WorkoutProgramDay',
  WorkoutProgramExerciseGroup: 'WorkoutProgramExerciseGroup',
  WorkoutProgramExerciseGroupMember: 'WorkoutProgramExerciseGroupMember',
  WorkoutProgramExercise: 'WorkoutProgramExercise',
  WorkoutProgramTemplate: 'WorkoutProgramTemplate',
  WorkoutSchedule: 'WorkoutSchedule',
  TrainingCycle: 'TrainingCycle',
  CycleAssessment: 'CycleAssessment',
  RecommendationAudit: 'RecommendationAudit',
  CoachClientActionAudit: 'CoachClientActionAudit',
  PlanGenerationAudit: 'PlanGenerationAudit',
  CycleSessionFeedback: 'CycleSessionFeedback',
  ExerciseSessionFeedback: 'ExerciseSessionFeedback',
  CycleFeedbackSummary: 'CycleFeedbackSummary',
  CycleFeedbackAnalysisAudit: 'CycleFeedbackAnalysisAudit',
  CycleInBodyLink: 'CycleInBodyLink',
  NutritionProgram: 'NutritionProgram',
  NutritionProgramDay: 'NutritionProgramDay',
  NutritionProgramMeal: 'NutritionProgramMeal',
  NutritionProgramMealItem: 'NutritionProgramMealItem',
  NutritionMealCompletion: 'NutritionMealCompletion',
  ExerciseSource: 'ExerciseSource',
  ExerciseAlias: 'ExerciseAlias',
  Muscle: 'Muscle',
  ExerciseMuscle: 'ExerciseMuscle',
  FoodSource: 'FoodSource',
  Recipe: 'Recipe',
  RecipeIngredient: 'RecipeIngredient',
  ImportBatch: 'ImportBatch',
  ImportRecord: 'ImportRecord',
  WorkoutImportBatch: 'WorkoutImportBatch',
  ExerciseReviewDecision: 'ExerciseReviewDecision',
  WorkoutMutationEvent: 'WorkoutMutationEvent'
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
