export type IntentType =
  | 'knowledge'
  | 'workout_plan'
  | 'meal_plan'
  | 'personalized_plan'
  | 'ambiguous';

export type RoutedIntentType =
  | 'general_fitness_knowledge'
  | 'workout_plan_request'
  | 'specific_exercise_request'
  | 'muscle_group_routine_request'
  | 'meal_plan_request'
  | 'body_recomposition_request'
  | 'unsafe_weight_loss_request'
  | 'profile_completion_request';

export type ResponseLanguage = 'vi' | 'en';

export interface InBodyMetrics {
  weightKg?: number;
  bodyFatPct?: number;
  bodyFatKg?: number;
  skeletalMuscleKg?: number;
  bmr?: number;
  bmi?: number;
  measuredAt?: string;
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
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  heightCm?: number;
  currentWeightKg?: number;
  targetWeightKg?: number;
  goal?: 'WEIGHT_LOSS' | 'MUSCLE_GAIN' | 'MAINTENANCE' | 'ATHLETIC_PERFORMANCE' | 'RECOMPOSITION';
  activityLevel?:
    | 'SEDENTARY'
    | 'LIGHTLY_ACTIVE'
    | 'MODERATELY_ACTIVE'
    | 'VERY_ACTIVE'
    | 'EXTREMELY_ACTIVE';
  experienceLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  foodPreference?: string;
  training: TrainingConstraints;
  inBody?: InBodyMetrics;
}

export interface InputIntent {
  normalizedQuestion: string;
  intent: IntentType;
  routeIntent?: RoutedIntentType;
  goalHint?: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'recomposition';
  mealPreferenceHint?: string;
  parsedTrainingDays?: number;
  mentionsInjury?: boolean;
  needsPersonalization: boolean;
  missingFields: string[];
}

export interface IntentRoute {
  normalizedQuestion: string;
  intent: RoutedIntentType;
  goalHint?: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'recomposition';
  muscleGroupHint?: 'biceps' | 'triceps' | 'chest' | 'back' | 'legs' | 'shoulders' | 'core' | 'forearms';
  parsedTrainingDays?: number;
  missingFields: string[];
}

export interface LanguageDecision {
  responseLanguage: ResponseLanguage;
  locked: boolean;
  lockReason?: 'explicit_user_request' | 'user_last_message';
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
  confidence: 'low' | 'medium' | 'high';
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

export interface FinalAnswerPayload {
  traceId: string;
  answer: string;
  responseLanguage?: ResponseLanguage;
  usedFallback: boolean;
  missingFields: string[];
  retrieval: RetrievalResult;
  recommendation: RecommendationResult;
  finalPrompt: string;
  validationNotes: string[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OrchestrationInput {
  question: string;
  userId?: string;
  authorizationHeader?: string;
}
