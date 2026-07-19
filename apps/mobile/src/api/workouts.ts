import { apiClient } from "./client";
import type { Exercise } from "./exercises";

// backend/services/fitness-service/prisma/schema.prisma — WorkoutSchedule
export interface WorkoutProgramExerciseEntry {
  id: string;
  order: number;
  sets: number;
  reps?: number;
  restSeconds?: number;
  notes?: string;
  exercise: Exercise;
}

export interface WorkoutProgramDay {
  id: string;
  programId: string;
  dayNumber: number;
  title: string;
  description?: string;
  duration?: number;
  exercises: WorkoutProgramExerciseEntry[];
  program?: {
    id: string;
    name: string;
    sourceType?: string;
    sourcePlanId?: string;
    status: string;
  };
}

export type ScheduleStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";

export interface WorkoutSchedule {
  id: string;
  userId: string;
  date: string;
  programDayId?: string;
  workoutId?: string;
  status: ScheduleStatus;
  progressPercent: number;
  startedAt?: string;
  completedAt?: string;
  totalExercises?: number;
  completedExercises?: number;
  totalSets?: number;
  completedSets?: number;
  durationSeconds?: number;
  caloriesEstimate?: number;
  sourcePlanId?: string;
  sourceType?: string;
  notes?: string;
  programDay?: WorkoutProgramDay;
  createdAt: string;
  updatedAt: string;
}

export interface ListSchedulesParams {
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export const workoutsApi = {
  // GET /workouts/schedules -> WorkoutSchedule[] (raw array)
  getSchedules(params: ListSchedulesParams = {}) {
    return apiClient
      .get<WorkoutSchedule[]>("/workouts/schedules", { params })
      .then((r) => r.data);
  },

  startSchedule(id: string, repeat = false) {
    return apiClient
      .post<{ success: boolean; data: unknown }>(`/workouts/schedules/${id}/start`, { repeat })
      .then((r) => r.data);
  },
};
