import { apiClient } from "./client";

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type Goal = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";
export type ActivityLevel =
  | "SEDENTARY"
  | "LIGHTLY_ACTIVE"
  | "MODERATELY_ACTIVE"
  | "VERY_ACTIVE"
  | "EXTREMELY_ACTIVE";
export type ExperienceLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

// backend/services/user-service/prisma/schema.prisma — UserProfile model
export interface UserProfile {
  id: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isPT: boolean;
  age?: number;
  gender?: Gender;
  heightCm?: number;
  goal?: Goal;
  activityLevel?: ActivityLevel;
  experienceLevel?: ExperienceLevel;
  preferredTrainingDays: number[];
  availableEquipment: string[];
  injuries: string[];
  currentWeight?: number;
  targetWeight?: number;
  dietaryPreference?: string;
  photoUrl?: string;
  sessionDurationMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  goal?: Goal;
  age?: number;
  heightCm?: number;
  currentWeight?: number;
  targetWeight?: number;
}

export const profileApi = {
  // GET /profile/me -> { profile: UserProfile | null } (profile.service.ts::getProfile)
  getProfile() {
    return apiClient
      .get<{ profile: UserProfile | null }>("/profile/me")
      .then((r) => r.data.profile);
  },

  // PUT /profile/me -> { profile } (profile.service.ts::upsertProfile)
  updateProfile(input: UpdateProfileInput) {
    return apiClient
      .put<{ profile: UserProfile }>("/profile/me", input)
      .then((r) => r.data.profile);
  },
};
