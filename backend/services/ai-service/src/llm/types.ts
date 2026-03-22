export type IntentType =
  | 'knowledge'
  | 'workout_plan'
  | 'meal_plan'
  | 'personalized_plan'
  | 'ambiguous';

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
  goalHint?: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'recomposition';
  mealPreferenceHint?: string;
  parsedTrainingDays?: number;
  mentionsInjury?: boolean;
  needsPersonalization: boolean;
  missingFields: string[];
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

export interface MealRecommendation {
  template: string;
  dailyMeals: number;
  preference?: string;
  assumptions: string[];
}

export interface RecommendationResult {
  objective: string;
  nutrition: NutritionTargets;
  workout: WorkoutRecommendation;
  meal: MealRecommendation;
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
