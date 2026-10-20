import { requestService } from "../clients/service-lambda.client";
import { logger } from "@gym-coach/shared";
import type { InBodyMetrics, TrainingConstraints, UserProfile } from "./types";
import { checkMacroCalorieConsistency } from "./nutrition_engine";

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
    // Immutable "journey start" weight (see UserProfile.startingWeight,
    // user-service) — distinct from currentWeight, which changes on every
    // InBody sync. May be absent for accounts that predate this field.
    startingWeight?: number;
    // Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.6.
    safetyScreeningStatus?: "UNKNOWN" | "CLEARED" | "FOLLOW_UP_SUGGESTED";
    safetyScreeningFlags?: string[];
    region?: string;
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

type NutritionGoalTarget = NonNullable<UserProfile["nutritionGoal"]>;

function readPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toNutritionGoalTarget(raw: {
  calories?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
}): NutritionGoalTarget | undefined {
  const calories = readPositiveNumber(raw.calories);
  const protein = readPositiveNumber(raw.protein);
  const carbs = readPositiveNumber(raw.carbs);
  const fat = readPositiveNumber(raw.fat);
  return calories && protein && carbs && fat
    ? { calories, protein, carbs, fat }
    : undefined;
}

function targetIsMacroConsistent(target: NutritionGoalTarget): boolean {
  return checkMacroCalorieConsistency(
    target.calories,
    target.protein,
    target.carbs,
    target.fat,
  ).consistent;
}

export function resolveEffectiveNutritionGoalForAiCoach(
  rawGoal: any,
  rawNutritionProgram: any,
): NutritionGoalTarget | undefined {
  const storedGoal =
    rawGoal &&
    typeof rawGoal.id === "string" &&
    (rawGoal.status === undefined || rawGoal.status === "ACTIVE")
      ? toNutritionGoalTarget(rawGoal)
      : undefined;
  if (storedGoal && targetIsMacroConsistent(storedGoal)) return storedGoal;

  const programTarget = toNutritionGoalTarget({
    calories: rawNutritionProgram?.dailyCaloriesTarget,
    protein: rawNutritionProgram?.proteinTargetGrams,
    carbs: rawNutritionProgram?.carbTargetGrams,
    fat: rawNutritionProgram?.fatTargetGrams,
  });
  if (programTarget && targetIsMacroConsistent(programTarget)) {
    if (storedGoal) {
      logger.warn(
        {
          storedGoalCalories: storedGoal.calories,
          programCalories: programTarget.calories,
        },
        "Ignoring inconsistent active NutritionGoal for AI coach; using active NutritionProgram target",
      );
    }
    return programTarget;
  }

  if (storedGoal) {
    logger.warn(
      { storedGoalCalories: storedGoal.calories },
      "Ignoring inconsistent active NutritionGoal for AI coach; no consistent active program target found",
    );
  }
  return undefined;
}

/** Mirrors fitness-service's GET /nutrition/daily-history response shape
 * (nutrition.service.ts's getDailyConsumptionHistory). */
type DailyConsumptionEntry = {
  date: string;
  hasProgram: boolean;
  targetCalories: number | null;
  targetProtein: number | null;
  consumedCalories: number | null;
  consumedProtein: number | null;
  consumedCarbs: number | null;
  consumedFat: number | null;
};

export interface PersonalizationContext {
  profile: UserProfile;
  latestInBody?: InBodyMetrics;
  /** All InBody records sorted newest-first (for trend analysis) */
  inBodyHistory: InBodyEntry[];
  workoutHistory: WorkoutEntry[];
  nutritionHistory: NutritionEntry[];
  /** AI Nutrition Cycle Engine (Gymini) — Phase 2 canonical consumption
   * totals per day, from fitness-service's GET /nutrition/daily-history
   * (reuses the exact same dailySummary computation the Nutrition
   * dashboard itself uses — respects SKIPPED/PARTIAL/COMPLETED meal
   * status, never double-counts). `nutritionHistory` above only ever
   * reflected raw free-text NutritionLog rows, silently missing anything
   * logged through the structured meal-item flow; prompt_builder prefers
   * these totals when present so the AI's answer about "what have you
   * eaten" can never disagree with the dashboard. Optional/best-effort —
   * absent (not an empty array) if the fetch failed, so callers can tell
   * "no data" from "fetch failed" and fall back to nutritionHistory alone. */
  dailyConsumptionHistory?: DailyConsumptionEntry[];
  /** Current active workout program (name, goal, daysPerWeek, days[]) */
  currentWorkoutProgram?: Record<string, unknown> | null;
  /** Current active nutrition program (name, goal, dailyCaloriesTarget, macro targets) */
  currentNutritionProgram?: Record<string, unknown> | null;
  /** Phase 3 Batch 1 (docs/ai-product/phase3-batch1-context-foundation.md) — `profile.nutritionGoal`
   * being undefined is ambiguous on its own: it means EITHER "fetched fine, no ACTIVE goal exists"
   * OR "the /nutrition/goals call itself failed." This field disambiguates the second case so
   * enterprise-data/nutrition.reader.ts can report an explicit error instead of a false absence. */
  nutritionGoalFetchFailed?: boolean;
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
// Phase 3 Batch 1 (docs/ai-product/phase3-batch1-context-foundation.md) — request-scoped
// deduplication. The TTL cache above only coalesces a call that arrives AFTER a previous one
// finished; two Enterprise Data Layer readers invoked moments apart in the same chat turn can
// both start their own 8-call HTTP batch before either completes. This additionally coalesces
// calls that genuinely overlap while one is still in flight — never shared across users (keyed by
// userId) and removed as soon as the fetch settles either way, so a failure is never "cached"
// here (only the TTL cache may do that, unchanged/pre-existing behavior for a completed result).
const inFlight = new Map<string, Promise<PersonalizationContext>>();

export const profileExtractor = {
  /** Call this when user updates InBody / profile so the cache is immediately invalidated */
  invalidateCache(userId: string) {
    profileCache.delete(userId);
  },

  async extract(
    userId?: string,
    authorizationHeader?: string,
  ): Promise<PersonalizationContext> {
    if (!userId || !authorizationHeader) {
      return {
        profile: {
          userId,
          training: {
            trainingDaysPerWeek: undefined,
            availableEquipment: [],
            injuries: [],
            preferredTrainingDays: [],
          },
        },
        inBodyHistory: [],
        workoutHistory: [],
        nutritionHistory: [],
      };
    }

    const cached = profileCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const pending = inFlight.get(userId);
    if (pending) return pending;

    const fetchPromise = fetchAndCache(userId, authorizationHeader).finally(() => {
      inFlight.delete(userId);
    });
    inFlight.set(userId, fetchPromise);
    return fetchPromise;
  },
};

async function fetchAndCache(
  userId: string,
  authorizationHeader: string,
): Promise<PersonalizationContext> {
    // 3 s per call keeps total latency bounded; allSettled means any failure falls back gracefully.
    const [
      profileRes,
      inBodyRes,
      workoutsRes,
      nutritionRes,
      dailyConsumptionRes,
      workoutProgramRes,
      nutritionProgramRes,
      nutritionGoalRes,
    ] = await Promise.allSettled([
      requestService<ProfileResponse>({
        service: "user", method: "GET", path: "/profile/me",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      // Get ALL InBody records (sorted desc by date) so we can show history too
      requestService<InBodyEntry[]>({
        service: "user", method: "GET", path: "/inbody",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      requestService<WorkoutEntry[]>({
        service: "fitness", method: "GET", path: "/workouts", params: { limit: 20 },
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      requestService<NutritionEntry[]>({
        service: "fitness", method: "GET", path: "/nutrition",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      // AI Nutrition Cycle Engine (Gymini) — Phase 2 canonical per-day
      // consumed totals (see PersonalizationContext.dailyConsumptionHistory's
      // doc comment for why this exists alongside the raw-log call above).
      requestService<{ data: DailyConsumptionEntry[] }>({
        service: "fitness", method: "GET", path: "/nutrition/daily-history",
        params: { days: 7 }, headers: authHeaders(authorizationHeader), timeoutMs: 3000,
      }),
      // Current active workout program (name, days, goal, schedule)
      requestService({
        service: "fitness", method: "GET", path: "/workouts/programs/current",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      // Current active nutrition program (calorie/macro targets)
      requestService({
        service: "fitness", method: "GET", path: "/nutrition/plans/current",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
      // The ACTIVE NutritionGoal: authoritative daily calories/macros (NutritionGoal owns them; nothing else may re-derive them).
      requestService({
        service: "fitness", method: "GET", path: "/nutrition/goals",
        headers: authHeaders(authorizationHeader),
        timeoutMs: 3000,
      }),
    ]);
    const rawGoal =
      nutritionGoalRes.status === "fulfilled"
        ? ((nutritionGoalRes.value.data as any)?.data ?? (nutritionGoalRes.value.data as any))
        : null;
    const profileData =
      profileRes.status === "fulfilled" ? profileRes.value.data.profile : null;
    const inBodyData =
      inBodyRes.status === "fulfilled" ? inBodyRes.value.data : [];
    const workoutsData =
      workoutsRes.status === "fulfilled" ? workoutsRes.value.data : [];
    const nutritionData =
      nutritionRes.status === "fulfilled" ? nutritionRes.value.data : [];
    // Absent (undefined), not [], on failure — see
    // PersonalizationContext.dailyConsumptionHistory's doc comment on why
    // that distinction matters to callers.
    const dailyConsumptionData =
      dailyConsumptionRes.status === "fulfilled"
        ? ((dailyConsumptionRes.value.data as any)?.data ?? undefined)
        : undefined;
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
    const effectiveNutritionGoal = resolveEffectiveNutritionGoalForAiCoach(
      rawGoal,
      rawNutritionProgram,
    );

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
      nutritionGoal: effectiveNutritionGoal,
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
      startingWeightKg: profileData?.startingWeight,
      region: profileData?.region,
      training: mapTraining(profileData),
      inBody: latestInBody,
      safetyScreeningStatus: profileData?.safetyScreeningStatus,
      safetyScreeningFlags: profileData?.safetyScreeningFlags,
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
            daySummaries: Array.isArray(rawNutritionProgram.days)
              ? rawNutritionProgram.days.slice(0, 3).map((d: any) => ({
                  dayNumber: d.dayNumber,
                  meals: Array.isArray(d.meals)
                    ? d.meals.map((m: any) => ({
                        mealType: m.mealType,
                        itemNames: Array.isArray(m.items)
                          ? m.items
                              .map((it: any) => it.customFoodName || it.food?.name)
                              .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0)
                              .slice(0, 6)
                          : [],
                      }))
                    : [],
                }))
              : [],
          }
        : null;

    const finalContext: PersonalizationContext = {
      profile,
      latestInBody,
      // Keep ALL InBody entries for trend analysis (newest first, already sorted by API)
      inBodyHistory: inBodyData,
      workoutHistory: workoutsData,
      nutritionHistory: nutritionData,
      dailyConsumptionHistory: dailyConsumptionData,
      currentWorkoutProgram,
      currentNutritionProgram,
      nutritionGoalFetchFailed: nutritionGoalRes.status === "rejected",
    };

    profileCache.set(userId, {
      data: finalContext,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });

    return finalContext;
}
