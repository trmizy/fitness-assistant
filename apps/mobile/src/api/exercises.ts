import { apiClient } from "./client";

export type TypeOfActivity =
  | "STRENGTH"
  | "CARDIO"
  | "MOBILITY"
  | "STRENGTH_CARDIO"
  | "STRENGTH_MOBILITY";
export type TypeOfEquipment =
  | "BODYWEIGHT"
  | "BARBELL"
  | "DUMBBELLS"
  | "KETTLEBELL"
  | "MACHINE"
  | "RESISTANCE_BAND"
  | "CABLE"
  | "MEDICINE_BALL"
  | "FOAM_ROLLER";
export type BodyPart = "UPPER_BODY" | "LOWER_BODY" | "CORE" | "FULL_BODY";
export type ExerciseType = "PUSH" | "PULL" | "HOLD" | "STRETCH";

export interface Exercise {
  id: string;
  exerciseName: string;
  typeOfActivity: TypeOfActivity;
  typeOfEquipment: TypeOfEquipment;
  bodyPart: BodyPart;
  type: ExerciseType;
  muscleGroupsActivated: string[];
  instructions: string;
  videoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseListParams {
  search?: string;
  bodyPart?: BodyPart;
  muscleGroup?: string;
  typeOfEquipment?: TypeOfEquipment;
  typeOfActivity?: TypeOfActivity;
  type?: ExerciseType;
  page?: number;
  limit?: number;
}

export interface ExerciseListResponse {
  exercises: Exercise[];
  pagination: { page: number; limit: number; total: number };
  filters: Record<string, unknown>;
}

// Public — no auth required.
export const exercisesApi = {
  list(params: ExerciseListParams = {}) {
    return apiClient
      .get<{ success: true; data: ExerciseListResponse }>("/exercises", { params })
      .then((r) => r.data.data);
  },

  getById(id: string) {
    return apiClient.get<Exercise>(`/exercises/${id}`).then((r) => r.data);
  },
};
