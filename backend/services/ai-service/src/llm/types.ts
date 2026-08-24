export type IntentType =
  | "knowledge"
  | "workout_plan"
  | "meal_plan"
  | "personalized_plan"
  | "ambiguous";

export type RoutedIntentType =
  | "general_fitness_knowledge"
  | "workout_plan_request"
  | "specific_exercise_request"
  | "muscle_group_routine_request"
  | "meal_plan_request"
  | "combined_plan_request"
  | "body_recomposition_request"
  | "unsafe_weight_loss_request"
  | "profile_completion_request"
  | "frequency_change_request"
  | "schedule_specific_day_request"
  // Focused pre/post-workout nutrient-timing advice ("trước/sau tập nên ăn
  // gì?") — distinct from meal_plan_request so the answer stays a direct,
  // short answer to the timing question instead of a full-day/7-day meal
  // plan. Real bug found via E2E persona testing
  // (24-ai-nutrition-persona-b-c.spec.ts, Persona B): every "ăn gì"-shaped
  // question used to fall into meal_plan_request's catch-all pattern,
  // which always renders a full meal-plan template regardless of what was
  // actually asked.
  | "nutrient_timing_request";

export type RouteCategory =
  | "exercise_request"
  | "workout_session_request"
  | "training_schedule_request"
  | "nutrition_macro_request"
  | "meal_plan_request"
  | "combined_plan_request";

export type ResponseLanguage = "vi" | "en";

export interface InBodySegmental {
  rightArm?: number;
  leftArm?: number;
  trunk?: number;
  rightLeg?: number;
  leftLeg?: number;
}

export interface InBodyMetrics {
  weightKg?: number;
  bodyFatPct?: number;
  bodyFatKg?: number;
  skeletalMuscleKg?: number;
  bmr?: number;
  bmi?: number;
  measuredAt?: string;
  segmentalMuscle?: InBodySegmental;
  segmentalFat?: InBodySegmental;
}

export interface TrainingConstraints {
  trainingDaysPerWeek?: number;
  availableEquipment: string[];
  injuries: string[];
  preferredTrainingDays: number[];
}

export interface UserProfile {
  userId?: string;
  age?: number;
  gender?: "MALE" | "FEMALE" | "OTHER";
  heightCm?: number;
  currentWeightKg?: number;
  targetWeightKg?: number;
  // Immutable "journey start" weight — see UserProfile.startingWeight
  // (user-service). Never equal to currentWeightKg after the first
  // measurement; absent for accounts predating this field.
  startingWeightKg?: number;
  goal?:
    | "WEIGHT_LOSS"
    | "MUSCLE_GAIN"
    | "MAINTENANCE"
    | "ATHLETIC_PERFORMANCE"
    | "RECOMPOSITION";
  activityLevel?:
    | "SEDENTARY"
    | "LIGHTLY_ACTIVE"
    | "MODERATELY_ACTIVE"
    | "VERY_ACTIVE"
    | "EXTREMELY_ACTIVE";
  experienceLevel?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  foodPreference?: string;
  training: TrainingConstraints;
  inBody?: InBodyMetrics;
  // Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.6.
  // FOLLOW_UP_SUGGESTED means the user flagged at least one pre-exercise safety concern
  // (heart condition, chest pain, dizziness/fainting, bone/joint, doctor-prescribed
  // medication) — never a hard block, but the response must suggest consulting a doctor
  // before increasing training intensity. UNKNOWN (default) means never screened —
  // pre-existing accounts, or the user skipped past the step — and must NOT be treated as
  // "cleared".
  safetyScreeningStatus?: "UNKNOWN" | "CLEARED" | "FOLLOW_UP_SUGGESTED";
  safetyScreeningFlags?: string[];
}

export interface InputIntent {
  normalizedQuestion: string;
  intent: IntentType;
  routeIntent?: RoutedIntentType;
  routeCategory?: RouteCategory;
  detailMode?: boolean;
  goalHint?: "fat_loss" | "muscle_gain" | "maintenance" | "recomposition";
  muscleGroupHint?:
    | "biceps"
    | "triceps"
    | "chest"
    | "back"
    | "legs"
    | "shoulders"
    | "core"
    | "forearms";
  mealPreferenceHint?: string;
  parsedTrainingDays?: number;
  minimumExercisesPerDay?: number;
  parsedMealsPerDay?: number;
  requestsCardio?: boolean;
  mentionsInjury?: boolean;
  needsPersonalization: boolean;
  missingFields: string[];
}

export interface IntentRoute {
  normalizedQuestion: string;
  intent: RoutedIntentType;
  goalHint?: "fat_loss" | "muscle_gain" | "maintenance" | "recomposition";
  muscleGroupHint?:
    | "biceps"
    | "triceps"
    | "chest"
    | "back"
    | "legs"
    | "shoulders"
    | "core"
    | "forearms";
  parsedTrainingDays?: number;
  missingFields: string[];
}

export interface LanguageDecision {
  responseLanguage: ResponseLanguage;
  locked: boolean;
  lockReason?: "explicit_user_request" | "user_last_message";
}

export interface RetrievalDocument {
  id: string;
  pageContent: string;
  score: number;
  source: string;
  category: string;
  metadata: {
    goal?: string;
    level?: string;
    equipment?: string;
    source_file: string;
    chunk_id: string;
    body_part?: string;
    type_of_activity?: string;
    // Evidence-collection fields (fitness_evidence)
    title?: string;
    source_url?: string | null;
    source_type?: string;
    evidence_level?: string;
    tags?: unknown[];
    created_from?: string;
    extraction_method?: string;
    [key: string]: unknown;
  };
}

export interface RetrievalResult {
  documents: RetrievalDocument[];
  isEmpty: boolean;
  reason?: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export interface NutritionTargets {
  maintenanceCalories?: number;
  targetCalories?: number;
  proteinGrams?: number;
  fatGrams?: number;
  carbsGrams?: number;
  deficitOrSurplusKcal?: number;
  formula: string;
  confidence: "low" | "medium" | "high";
}

export interface WorkoutRecommendation {
  split: string;
  sessionsPerWeek: number;
  focus: string[];
  avoidedPatterns: string[];
  assumptions: string[];
}

export interface ExercisePrescription {
  order: number;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  note?: string;
}

export interface DayPlan {
  day: string;
  goal: string;
  exercises: ExercisePrescription[];
  cardio?: string;
}

export interface WorkoutPlanTemplate {
  isDefaultTemplate: boolean;
  goalSummary: string;
  days: DayPlan[];
  progressionNotes: string[];
}

export interface SpecificRoutineTemplate {
  isDefaultTemplate: boolean;
  sessionGoal: string;
  exercises: ExercisePrescription[];
  techniqueNotes: string[];
  overloadGuide: string[];
}

export interface MealItem {
  mealName: string;
  foods: string[];
}

export interface MealPlanTemplate {
  isDefaultTemplate: boolean;
  kcal: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  meals: MealItem[];
  substitutions: string[];
}

export interface UnsafeGuidance {
  blocked: boolean;
  reason: string;
  safeAlternative: string;
  firstWeekSteps: string[];
}

export interface MealRecommendation {
  template: string;
  dailyMeals: number;
  preference?: string;
  assumptions: string[];
}

export interface RecommendationResult {
  objective: string;
  responseIntent?: RoutedIntentType;
  detailMode?: boolean;
  personalizationSummary?: string[];
  nutrition: NutritionTargets;
  workout: WorkoutRecommendation;
  meal: MealRecommendation;
  workoutPlan?: WorkoutPlanTemplate;
  specificRoutine?: SpecificRoutineTemplate;
  mealPlan?: MealPlanTemplate;
  unsafeGuidance?: UnsafeGuidance;
  followUpQuestions?: string[];
  assumptions: string[];
  missingFields: string[];
}

export interface PromptSections {
  systemRole: string;
  userProfile: string;
  retrievedKnowledge: string;
  recommendationResult: string;
  responseRules: string;
}

// ── Evidence-based enrichment types (backward-compatible additions) ──────────

/** Explains why a plan parameter was adjusted based on body metrics. */
export interface AdjustmentReason {
  metric: string; // e.g. "bodyFatPct"
  observed_value: string | number; // e.g. "28.6%"
  interpretation: string; // human-readable explanation
  plan_adjustment: string; // what was changed and why
}

/** A piece of evidence used to inform the plan (from RAG or curated knowledge). */
export interface EvidenceUsed {
  title: string;
  source_url: string;
  category: string;
  source_type: string; // "guideline" | "paper" | "dataset" | "curated_summary"
  source?: string;
  year?: string;
  date?: string;
  citation?: string;
  summary: string; // 1–2 sentence summary of the relevant finding
}

export interface AiChatTiming {
  requestId: string;
  totalMs: number;
  profileContextMs?: number;
  ragTotalMs?: number;
  chatHistoryMs?: number;
  memoriesMs?: number;
  scheduleContextMs?: number;
  nutritionContextMs?: number;
  evidenceMs?: number;
  promptBuildMs?: number;
  llmGenerateMs?: number;
  validationMs?: number;
}

export interface FinalAnswerPayload {
  traceId: string;
  answer: string;
  responseLanguage?: ResponseLanguage;
  usedFallback: boolean;
  /** True when the LLM answer was discarded because the validator detected a
   *  critical nutrition number mismatch and the deterministic answer was used. */
  usedDeterministicFallbackBecauseOfValidation: boolean;
  missingFields: string[];
  retrieval: RetrievalResult;
  recommendation: RecommendationResult;
  finalPrompt: string;
  validationNotes: string[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tracing fields for observability */
  routeIntent: string;
  warningCount: number;
  explicitLanguageLock: boolean;
  timing?: AiChatTiming;
  fallbackReason?: string;
  // ── Evidence enrichment (new — optional for backward compat) ──────────────
  adjustmentReasons?: AdjustmentReason[];
  evidenceUsed?: EvidenceUsed[];
  safetyNotes?: string[];
  workoutSchedule?: {
    activePlanName?: string;
    planFrequency?: number;
    targetDate?: string;
    targetDayOfWeek?: string;
    scheduledWorkoutFound: boolean;
    source: string;
  };
  nutritionSchedule?: {
    targetDate?: string;
    mealType: string;
    nutritionPlanName?: string;
    plannedMealsFound: boolean;
    source: string;
  };
}

export interface OrchestrationInput {
  question: string;
  userId?: string;
  authorizationHeader?: string;
}
