import axios from "axios";
import { logger } from "@gym-coach/shared";
import type { InBodyMetrics, TrainingConstraints, UserProfile } from "./types";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://user-service:3004"
    : "http://localhost:3004");
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://fitness-service:3002"
    : "http://localhost:3002");

type ProfileResponse = {
  profile?: {
    age?: number;
    gender?: "MALE" | "FEMALE" | "OTHER";
    heightCm?: number;
    goal?:
      | "WEIGHT_LOSS"
      | "MUSCLE_GAIN"
      | "MAINTENANCE"
      | "ATHLETIC_PERFORMANCE";
    activityLevel?:
      | "SEDENTARY"
      | "LIGHTLY_ACTIVE"
      | "MODERATELY_ACTIVE"
      | "VERY_ACTIVE"
      | "EXTREMELY_ACTIVE";
    experienceLevel?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
    preferredTrainingDays?: number[];
    availableEquipment?: string[];
    injuries?: string[];
    currentWeight?: number;
    targetWeight?: number;
  } | null;
};

type InBodyEntry = {
  weight?: number;
  bodyFat?: number; // fat mass kg
  bodyFatPct?: number; // body fat %
  muscleMass?: number; // skeletal muscle mass kg
  bmr?: number;
  bmi?: number;
  date?: string; // ISO date string
  dateOnly?: string;
  // Segmental lean (muscle kg per body part)
  rightArmMuscle?: number;
  leftArmMuscle?: number;
  trunkMuscle?: number;
  rightLegMuscle?: number;
  leftLegMuscle?: number;
  // Segmental fat (kg per body part)
  rightArmFat?: number;
  leftArmFat?: number;
  trunkFat?: number;
  rightLegFat?: number;
  leftLegFat?: number;
};

type WorkoutExercise = {
  id?: string;
  exerciseId?: string;
  exercise?: {
    exerciseName?: string;
    bodyPart?: string;
    typeOfActivity?: string;
    muscleGroupsActivated?: string[];
  };
  sets?: number;
  reps?: number;
  weight?: number;
  notes?: string;
};

type WorkoutEntry = {
  id?: string;
  duration?: number | null;
  date?: string;
  name?: string;
  notes?: string;
  exercises?: WorkoutExercise[];
};

type NutritionEntry = {
  id?: string;
  date?: string;
  mealType?: string; // breakfast | lunch | dinner | snack
  foodName?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  quantity?: number;
  unit?: string;
};

export interface PersonalizationContext {
  profile: UserProfile;
  latestInBody?: InBodyMetrics;
  /** All InBody records sorted newest-first (for trend analysis) */
  inBodyHistory: InBodyEntry[];
  workoutHistory: WorkoutEntry[];
  nutritionHistory: NutritionEntry[];
  /** Current active workout program (name, goal, daysPerWeek, days[]) */
  currentWorkoutProgram?: Record<string, unknown> | null;
  /** Current active nutrition program (name, goal, dailyCaloriesTarget, macro targets) */
  currentNutritionProgram?: Record<string, unknown> | null;
  /**
   * Durable facts saved across sessions via the `remember_user_fact` tool
   * (Phase 3 memory). Not fetched by `profileExtractor.extract()` itself —
   * the orchestrator fetches these separately (ai-service's own DB, not
   * user-service/fitness-service) and attaches them here so prompt_builder
   * can read them off the same context object.
   */
  memories?: Array<{ content: string; category?: string | null }>;
}

function mapTraining(
  profile?: ProfileResponse["profile"] | null,
): TrainingConstraints {
  return {
    trainingDaysPerWeek: profile?.preferredTrainingDays?.length,
    availableEquipment: profile?.availableEquipment || [],
    injuries: profile?.injuries || [],
    preferredTrainingDays: profile?.preferredTrainingDays || [],
  };
}

function mapInBody(entry?: InBodyEntry): InBodyMetrics | undefined {
  if (!entry) return undefined;
  return {
    weightKg: entry.weight,
    bodyFatKg: entry.bodyFat,
    bodyFatPct: entry.bodyFatPct,
    skeletalMuscleKg: entry.muscleMass,
    bmr: entry.bmr,
    bmi: entry.bmi,
    measuredAt: entry.date ?? entry.dateOnly,
    // Segmental analysis
    segmentalMuscle:
      entry.rightArmMuscle ||
      entry.leftArmMuscle ||
      entry.trunkMuscle ||
      entry.rightLegMuscle ||
      entry.leftLegMuscle
        ? {
            rightArm: entry.rightArmMuscle,
            leftArm: entry.leftArmMuscle,
            trunk: entry.trunkMuscle,
            rightLeg: entry.rightLegMuscle,
            leftLeg: entry.leftLegMuscle,
          }
        : undefined,
    segmentalFat:
      entry.rightArmFat ||
      entry.leftArmFat ||
      entry.trunkFat ||
      entry.rightLegFat ||
      entry.leftLegFat
        ? {
            rightArm: entry.rightArmFat,
            leftArm: entry.leftArmFat,
            trunk: entry.trunkFat,
            rightLeg: entry.rightLegFat,
            leftLeg: entry.leftLegFat,
          }
        : undefined,
  };
}

function authHeaders(
  authorizationHeader?: string,
): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

interface CacheEntry {
  data: PersonalizationContext;
  expiresAt: number;
}
const profileCache = new Map<string, CacheEntry>();
// Nothing currently calls invalidateCache() cross-service when InBody/profile
// data changes (ai-service has no inbound webhook from user-service for this),
// so the TTL alone bounds staleness. Kept short so "just updated my InBody,
// immediately asked the AI" never sees pre-update data in practice.
const PROFILE_CACHE_TTL_MS = 15000;

export const profileExtractor = {
  /** Call this when user updates InBody / profile so the cache is immediately invalidated */
  invalidateCache(userId: string) {
    profileCache.delete(userId);
  },

  async extract(
    userId?: string,
    authorizationHeader?: string,
  ): Promise<PersonalizationContext> {
    const fallbackProfile: UserProfile = {
      userId,
      training: {
        trainingDaysPerWeek: undefined,
        availableEquipment: [],
        injuries: [],
        preferredTrainingDays: [],
      },
    };

    if (!userId || !authorizationHeader) {
      return {
        profile: fallbackProfile,
        inBodyHistory: [],
        workoutHistory: [],
        nutritionHistory: [],
      };
    }

    const now = Date.now();
    const cached = profileCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    // 3 s per call keeps total latency bounded; allSettled means any failure falls back gracefully.
    const [
      profileRes,
      inBodyRes,
      workoutsRes,
      nutritionRes,
      workoutProgramRes,
      nutritionProgramRes,
    ] = await Promise.allSettled([
      axios.get<ProfileResponse>(`${USER_SERVICE_URL}/profile/me`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
      // Get ALL InBody records (sorted desc by date) so we can show history too
      axios.get<InBodyEntry[]>(`${USER_SERVICE_URL}/inbody`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
      axios.get<WorkoutEntry[]>(`${FITNESS_SERVICE_URL}/workouts?limit=20`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
      axios.get<NutritionEntry[]>(`${FITNESS_SERVICE_URL}/nutrition`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
      // Current active workout program (name, days, goal, schedule)
      axios.get(`${FITNESS_SERVICE_URL}/workouts/programs/current`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
      // Current active nutrition program (calorie/macro targets)
      axios.get(`${FITNESS_SERVICE_URL}/nutrition/plans/current`, {
        headers: authHeaders(authorizationHeader),
        timeout: 3000,
      }),
    ]);

    const profileData =
      profileRes.status === "fulfilled" ? profileRes.value.data.profile : null;
    const inBodyData =
      inBodyRes.status === "fulfilled" ? inBodyRes.value.data : [];
    const workoutsData =
      workoutsRes.status === "fulfilled" ? workoutsRes.value.data : [];
    const nutritionData =
      nutritionRes.status === "fulfilled" ? nutritionRes.value.data : [];
    // Workout program may be wrapped in { success, data: program } or returned directly
    const rawWorkoutProgram =
      workoutProgramRes.status === "fulfilled"
        ? ((workoutProgramRes.value.data as any)?.data?.program ??
          (workoutProgramRes.value.data as any)?.data ??
          (workoutProgramRes.value.data as any))
        : null;
    // Nutrition program: { success, data: program }
    const rawNutritionProgram =
      nutritionProgramRes.status === "fulfilled"
        ? ((nutritionProgramRes.value.data as any)?.data ??
          (nutritionProgramRes.value.data as any))
        : null;

    const failedCount = [
      profileRes,
      inBodyRes,
      workoutsRes,
      nutritionRes,
    ].filter((r) => r.status === "rejected").length;
    if (failedCount >= 3) {
      logger.warn(
        { failedCount, userId },
        "Most profile services unavailable — AI response will use anonymous mode",
      );
    }

    if (profileRes.status === "rejected") {
      logger.warn(
        { error: profileRes.reason },
        "Failed to load profile for personalization",
      );
    }
    if (inBodyRes.status === "rejected") {
      logger.warn(
        { error: inBodyRes.reason },
        "Failed to load InBody data for personalization",
      );
    }
    if (workoutsRes.status === "rejected") {
      logger.warn(
        { error: workoutsRes.reason },
        "Failed to load workout history for personalization",
      );
    }
    if (nutritionRes.status === "rejected") {
      logger.warn(
        { error: nutritionRes.reason },
        "Failed to load nutrition history for personalization",
      );
    }
    // Program failures are non-critical — just log at debug level
    if (workoutProgramRes.status === "rejected") {
      logger.debug(
        { error: (workoutProgramRes as any).reason },
        "Could not load current workout program",
      );
    }
    if (nutritionProgramRes.status === "rejected") {
      logger.debug(
        { error: (nutritionProgramRes as any).reason },
        "Could not load current nutrition program",
      );
    }

    const latestInBody = mapInBody(inBodyData[0]);

    const profile: UserProfile = {
      userId,
      age: profileData?.age,
      gender: profileData?.gender,
      heightCm: profileData?.heightCm,
      goal: profileData?.goal,
      activityLevel: profileData?.activityLevel,
      experienceLevel: profileData?.experienceLevel,
      // ── InBody is the most accurate physical measurement; prefer it over the manually
      //    entered profile weight. Profile weight is only a fallback when no InBody exists.
      currentWeightKg: latestInBody?.weightKg ?? profileData?.currentWeight,
      targetWeightKg: profileData?.targetWeight,
      training: mapTraining(profileData),
      inBody: latestInBody,
    };

    // Compact current workout program for context (avoid sending entire days[] array raw)
    const currentWorkoutProgram =
      rawWorkoutProgram && typeof rawWorkoutProgram === "object"
        ? {
            name: rawWorkoutProgram.name,
            goal: rawWorkoutProgram.goal,
            daysPerWeek: rawWorkoutProgram.daysPerWeek,
            durationWeeks: rawWorkoutProgram.durationWeeks,
            sourceType: rawWorkoutProgram.sourceType,
            status: rawWorkoutProgram.status,
            dayCount: Array.isArray(rawWorkoutProgram.days)
              ? rawWorkoutProgram.days.length
              : undefined,
            daySummaries: Array.isArray(rawWorkoutProgram.days)
              ? rawWorkoutProgram.days.map((d: any) => ({
                  dayNumber: d.dayNumber,
                  title: d.title,
                  exerciseCount: Array.isArray(d.exercises)
                    ? d.exercises.length
                    : 0,
                }))
              : [],
          }
        : null;

    // Compact current nutrition program
    const currentNutritionProgram =
      rawNutritionProgram && typeof rawNutritionProgram === "object"
        ? {
            name: rawNutritionProgram.name,
            goal: rawNutritionProgram.goal,
            dailyCaloriesTarget: rawNutritionProgram.dailyCaloriesTarget,
            proteinTargetGrams: rawNutritionProgram.proteinTargetGrams,
            carbTargetGrams: rawNutritionProgram.carbTargetGrams,
            fatTargetGrams: rawNutritionProgram.fatTargetGrams,
            mealsPerDay: rawNutritionProgram.mealsPerDay,
            startDate: rawNutritionProgram.startDate,
            endDate: rawNutritionProgram.endDate,
            repeatEnabled: rawNutritionProgram.repeatEnabled,
            status: rawNutritionProgram.status,
          }
        : null;

    const finalContext: PersonalizationContext = {
      profile,
      latestInBody,
      // Keep ALL InBody entries for trend analysis (newest first, already sorted by API)
      inBodyHistory: inBodyData,
      workoutHistory: workoutsData,
      nutritionHistory: nutritionData,
      currentWorkoutProgram,
      currentNutritionProgram,
    };

    profileCache.set(userId, {
      data: finalContext,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });

    return finalContext;
  },
};
