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

// backend/services/fitness-service — WorkoutSet (per-set row)
export interface WorkoutSet {
  id: string;
  workoutExerciseId: string;
  setNumber: number;
  reps?: number;
  weight?: number;
  rpe?: number;
  completed: boolean;
  createdAt: string;
}

// WorkoutExercise — summary row (sets/reps/weight = planned/representative
// values); per-set breakdown lives in workoutSets, added via addSet().
export interface WorkoutExercise {
  id: string;
  workoutId: string;
  exerciseId: string;
  programExerciseId?: string | null;
  sets: number;
  reps?: number;
  duration?: number;
  weight?: number;
  notes?: string;
  order: number;
  createdAt: string;
  exercise: Exercise;
  workoutSets?: WorkoutSet[];
}

export interface Workout {
  id: string;
  userId: string;
  name: string;
  description?: string;
  date: string;
  duration?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  exercises: WorkoutExercise[];
}

export interface CreateWorkoutExerciseInput {
  exerciseId: string;
  programExerciseId?: string | null;
  sets: number;
  reps?: number;
  duration?: number;
  weight?: number;
  completed?: boolean;
  notes?: string;
}

export interface CreateWorkoutInput {
  scheduleId?: string;
  name: string;
  description?: string;
  date?: string;
  duration?: number;
  notes?: string;
  exercises: CreateWorkoutExerciseInput[];
}

export interface AddSetInput {
  exerciseId: string;
  setNumber?: number;
  weight?: number;
  reps?: number;
  rpe?: number;
}

export interface ExercisePR {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps?: number;
  sets: number;
  date: string;
}

export interface ListWorkoutsParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
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

  getHistory(params: ListWorkoutsParams = {}) {
    return apiClient.get<Workout[]>("/workouts", { params }).then((r) => r.data);
  },

  getWorkout(id: string) {
    return apiClient.get<Workout>(`/workouts/${id}`).then((r) => r.data);
  },

  createWorkout(input: CreateWorkoutInput) {
    return apiClient.post<Workout>("/workouts", input).then((r) => r.data);
  },

  addSet(workoutId: string, input: AddSetInput) {
    return apiClient
      .post<WorkoutSet>(`/workouts/${workoutId}/sets`, input)
      .then((r) => r.data);
  },

  getPRs(exerciseId?: string) {
    return apiClient
      .get<ExercisePR[]>("/workouts/prs", { params: exerciseId ? { exerciseId } : undefined })
      .then((r) => r.data);
  },
};
