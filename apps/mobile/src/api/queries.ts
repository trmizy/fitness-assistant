import { useQuery } from "@tanstack/react-query";
import { profileApi } from "./profile";
import { inbodyApi } from "./inbody";
import {
  workoutsApi,
  type ListSchedulesParams,
  type ListWorkoutsParams,
} from "./workouts";
import { exercisesApi, type ExerciseListParams } from "./exercises";
import { trainingCyclesApi } from "./trainingCycles";
import { env } from "../config/env";

export const queryKeys = {
  profile: ["profile"] as const,
  inbodyLatest: ["inbody", "latest"] as const,
  inbodyHistory: ["inbody", "history"] as const,
  schedules: (params: ListSchedulesParams) => ["workouts", "schedules", params] as const,
  activeCycle: ["training-cycles", "active"] as const,
  exercises: (params: ExerciseListParams) => ["exercises", params] as const,
  workoutHistory: (params: ListWorkoutsParams) => ["workouts", "history", params] as const,
  workout: (id: string) => ["workouts", id] as const,
  prs: ["workouts", "prs"] as const,
};

export function useProfileQuery() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: profileApi.getProfile });
}

export function useLatestInBodyQuery() {
  return useQuery({ queryKey: queryKeys.inbodyLatest, queryFn: inbodyApi.getLatest });
}

export function useInBodyHistoryQuery() {
  return useQuery({ queryKey: queryKeys.inbodyHistory, queryFn: inbodyApi.getHistory });
}

export function useSchedulesQuery(params: ListSchedulesParams = {}) {
  return useQuery({
    queryKey: queryKeys.schedules(params),
    queryFn: () => workoutsApi.getSchedules(params),
  });
}

export function useActiveCycleQuery() {
  return useQuery({
    queryKey: queryKeys.activeCycle,
    queryFn: trainingCyclesApi.getActive,
    enabled: env.featureCycles,
  });
}

export function useExercisesQuery(params: ExerciseListParams) {
  return useQuery({
    queryKey: queryKeys.exercises(params),
    queryFn: () => exercisesApi.list(params),
  });
}

export function useExerciseFilterOptionsQuery() {
  return useQuery({
    queryKey: ["exercises", "filter-options"] as const,
    queryFn: exercisesApi.getFilterOptions,
    staleTime: Infinity,
  });
}

export function useWorkoutHistoryQuery(params: ListWorkoutsParams = {}) {
  return useQuery({
    queryKey: queryKeys.workoutHistory(params),
    queryFn: () => workoutsApi.getHistory(params),
  });
}

export function useWorkoutQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.workout(id),
    queryFn: () => workoutsApi.getWorkout(id),
    enabled: Boolean(id),
  });
}

export function usePRsQuery() {
  return useQuery({ queryKey: queryKeys.prs, queryFn: () => workoutsApi.getPRs() });
}
