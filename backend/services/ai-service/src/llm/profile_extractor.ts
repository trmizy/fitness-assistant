import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type { InBodyMetrics, TrainingConstraints, UserProfile } from './types';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'http://user-service:3004'
    : 'http://localhost:3004');
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'http://fitness-service:3002'
    : 'http://localhost:3002');

type ProfileResponse = {
  profile?: {
    age?: number;
    gender?: 'MALE' | 'FEMALE' | 'OTHER';
    heightCm?: number;
    goal?: 'WEIGHT_LOSS' | 'MUSCLE_GAIN' | 'MAINTENANCE' | 'ATHLETIC_PERFORMANCE';
    activityLevel?:
      | 'SEDENTARY'
      | 'LIGHTLY_ACTIVE'
      | 'MODERATELY_ACTIVE'
      | 'VERY_ACTIVE'
      | 'EXTREMELY_ACTIVE';
    experienceLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    preferredTrainingDays?: number[];
    availableEquipment?: string[];
    injuries?: string[];
    currentWeight?: number;
    targetWeight?: number;
  } | null;
};

type InBodyEntry = {
  weight?: number;
  bodyFat?: number;
  bodyFatPct?: number;
  muscleMass?: number;
  bmr?: number;
  bmi?: number;
  date?: string;
};

type WorkoutEntry = {
  duration?: number | null;
  exercises?: unknown[];
  date?: string;
};

type NutritionEntry = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  date?: string;
};

export interface PersonalizationContext {
  profile: UserProfile;
  latestInBody?: InBodyMetrics;
  workoutHistory: WorkoutEntry[];
  nutritionHistory: NutritionEntry[];
}

function mapTraining(profile?: ProfileResponse['profile'] | null): TrainingConstraints {
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
    measuredAt: entry.date,
  };
}

function authHeaders(authorizationHeader?: string): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

interface CacheEntry {
  data: PersonalizationContext;
  expiresAt: number;
}
const profileCache = new Map<string, CacheEntry>();

export const profileExtractor = {
  async extract(userId?: string, authorizationHeader?: string): Promise<PersonalizationContext> {
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
        workoutHistory: [],
        nutritionHistory: [],
      };
    }

    const now = Date.now();
    const cached = profileCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const [profileRes, inBodyRes, workoutsRes, nutritionRes] = await Promise.allSettled([
      axios.get<ProfileResponse>(`${USER_SERVICE_URL}/profile/me`, {
        headers: authHeaders(authorizationHeader),
        timeout: 5000,
      }),
      axios.get<InBodyEntry[]>(`${USER_SERVICE_URL}/inbody`, {
        headers: authHeaders(authorizationHeader),
        timeout: 5000,
      }),
      axios.get<WorkoutEntry[]>(`${FITNESS_SERVICE_URL}/workouts?limit=20`, {
        headers: authHeaders(authorizationHeader),
        timeout: 5000,
      }),
      axios.get<NutritionEntry[]>(`${FITNESS_SERVICE_URL}/nutrition`, {
        headers: authHeaders(authorizationHeader),
        timeout: 5000,
      }),
    ]);

    const profileData = profileRes.status === 'fulfilled' ? profileRes.value.data.profile : null;
    const inBodyData = inBodyRes.status === 'fulfilled' ? inBodyRes.value.data : [];
    const workoutsData = workoutsRes.status === 'fulfilled' ? workoutsRes.value.data : [];
    const nutritionData = nutritionRes.status === 'fulfilled' ? nutritionRes.value.data : [];

    if (profileRes.status === 'rejected') {
      logger.warn({ error: profileRes.reason }, 'Failed to load profile for personalization');
    }
    if (inBodyRes.status === 'rejected') {
      logger.warn({ error: inBodyRes.reason }, 'Failed to load InBody data for personalization');
    }
    if (workoutsRes.status === 'rejected') {
      logger.warn({ error: workoutsRes.reason }, 'Failed to load workout history for personalization');
    }
    if (nutritionRes.status === 'rejected') {
      logger.warn({ error: nutritionRes.reason }, 'Failed to load nutrition history for personalization');
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
      currentWeightKg: profileData?.currentWeight ?? latestInBody?.weightKg,
      targetWeightKg: profileData?.targetWeight,
      training: mapTraining(profileData),
      inBody: latestInBody,
    };

    const finalContext = {
      profile,
      latestInBody,
      workoutHistory: workoutsData,
      nutritionHistory: nutritionData,
    };

    profileCache.set(userId, { data: finalContext, expiresAt: Date.now() + 60000 }); // cache for 60s

    return finalContext;
  },
};
