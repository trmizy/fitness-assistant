import { apiClient } from "./client";

export type CycleStatus = "ACTIVE" | "COMPLETED" | "ANALYZED";
export type CycleDecision = "KEEP" | "ADJUST" | "NEW_PLAN";
export type OverallTrend = "PROGRESSING" | "PLATEAU" | "DECLINING";

export interface CycleAlert {
  code: string;
  severity: "info" | "warning";
  message: string;
  createdAt: string;
}

export interface CycleProgressSignals {
  overallTrend: OverallTrend;
  deltaSMM: number | null;
  deltaPBF: number | null;
  volumeChangePct: number | null;
  newPRs: string[];
  adherencePct: number;
  rpeTrend: "stable" | "increasing" | "decreasing";
  laggingMuscleGroups: string[];
}

export interface CycleSummary {
  adherence: { completed: number; total: number; percent: number };
  volumeByWeek: { week: number; totalVolumeKg: number; byMuscleGroup: Record<string, number> }[];
  volumeChangePct: number | null;
  e1rmTrend: { exerciseName: string; weeklyTop: { week: number; e1rm: number }[] }[];
  rpeTrend: { weeklyAvg: number[]; trend: "stable" | "increasing" | "decreasing" };
  newPRs: string[];
  inBodySeries: { id: string; date: string; weight: number; bodyFatPct?: number; muscleMass: number }[];
  alerts: CycleAlert[];
  computedAt: string;
  progressSignals?: CycleProgressSignals;
  closedAt?: string;
}

export interface CycleAnalysisDetails {
  cycleReview: {
    bodyCompositionTrend: string;
    trainingNote: string;
    laggingMuscleGroups: string[];
    confidence: "high" | "low";
  };
  keepDetails: { overloadIncreasePct: number; calorieDelta: number; notes: string } | null;
  adjustDetails: {
    pumpSetTargets: string[];
    maxPumpSessionsPerWeek: number;
    exerciseSwaps: unknown[];
    calorieDeltaPct: number;
    notes: string;
  } | null;
  newPlanDraft: {
    goal: string;
    durationDays: number;
    daysPerWeek: number;
    splitSuggestion: string;
    deloadWeekFirst: boolean;
    notes: string;
  } | null;
  mealPlanDraft: {
    estimatedTDEE: number;
    calorieTarget: number;
    macros: { proteinG: number; carbG: number; fatG: number };
    notes: string;
  } | null;
  aiFallback?: boolean;
}

export interface TrainingCycle {
  id: string;
  userId: string;
  planId: string | null;
  cycleIndex: number;
  startDate: string;
  endDate: string;
  durationDays: number;
  goal: string | null;
  status: CycleStatus;
  startInbodyId: string | null;
  endInbodyId: string | null;
  summary: CycleSummary | null;
  lowConfidence: boolean;
  decision: CycleDecision | null;
  aiAnalysis: CycleAnalysisDetails | null;
  nextPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const trainingCyclesApi = {
  start(input: { planId?: string | null; startDate?: string; durationDays?: number } = {}) {
    return apiClient.post<TrainingCycle>("/training-cycles", input).then((r) => r.data);
  },

  // 404 when no ACTIVE cycle exists — caller should catch and treat as null.
  getActive() {
    return apiClient
      .get<{ cycle: TrainingCycle; summary: CycleSummary }>("/training-cycles/active")
      .then((r) => r.data)
      .catch((err) => {
        if (err?.response?.status === 404) return null;
        throw err;
      });
  },

  complete(id: string, endInbodyId?: string) {
    return apiClient
      .post<TrainingCycle>(`/training-cycles/${id}/complete`, { endInbodyId })
      .then((r) => r.data);
  },

  approve(id: string, nextPlanId: string) {
    return apiClient
      .post<TrainingCycle>(`/training-cycles/${id}/approve`, { nextPlanId })
      .then((r) => r.data);
  },

  list(limit = 20) {
    return apiClient
      .get<{ cycles: TrainingCycle[] }>("/training-cycles", { params: { limit } })
      .then((r) => r.data.cycles);
  },

  get(id: string) {
    return apiClient.get<TrainingCycle>(`/training-cycles/${id}`).then((r) => r.data);
  },
};
