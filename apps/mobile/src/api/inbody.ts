import { apiClient } from "./client";

// backend/services/user-service — InBodyEntry Prisma model (API_MAP.md §4.3)
export interface InBodyEntry {
  id: string;
  userId: string;
  date: string;
  dateOnly: string;
  weight: number;
  height?: number;
  bmi?: number;
  bodyFat: number;
  bodyFatPct?: number;
  muscleMass: number;
  visceralFat?: number;
  bmr?: number;
  rightArmMuscle?: number;
  leftArmMuscle?: number;
  trunkMuscle?: number;
  rightLegMuscle?: number;
  leftLegMuscle?: number;
  rightArmFat?: number;
  leftArmFat?: number;
  trunkFat?: number;
  rightLegFat?: number;
  leftLegFat?: number;
  status: "manual" | "extracted" | "pending";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInBodyInput {
  date?: string;
  weight: number;
  height?: number;
  bodyFat: number;
  bodyFatPct?: number;
  muscleMass: number;
  visceralFat?: number;
  bmr?: number;
  notes?: string;
}

export const inbodyApi = {
  getHistory() {
    return apiClient.get<InBodyEntry[]>("/inbody").then((r) => r.data);
  },

  // 404 when no entry exists yet — caller should catch and treat as null.
  getLatest() {
    return apiClient
      .get<InBodyEntry>("/inbody/latest")
      .then((r) => r.data)
      .catch((err) => {
        if (err?.response?.status === 404) return null;
        throw err;
      });
  },

  create(input: CreateInBodyInput) {
    return apiClient.post<InBodyEntry>("/inbody", input).then((r) => r.data);
  },
};
