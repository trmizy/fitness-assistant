import { useQuery } from "@tanstack/react-query";
import { profileApi } from "./profile";
import { inbodyApi } from "./inbody";
import { workoutsApi, type ListSchedulesParams } from "./workouts";
import { trainingCyclesApi } from "./trainingCycles";
import { env } from "../config/env";

export const queryKeys = {
  profile: ["profile"] as const,
  inbodyLatest: ["inbody", "latest"] as const,
  inbodyHistory: ["inbody", "history"] as const,
  schedules: (params: ListSchedulesParams) => ["workouts", "schedules", params] as const,
  activeCycle: ["training-cycles", "active"] as const,
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
