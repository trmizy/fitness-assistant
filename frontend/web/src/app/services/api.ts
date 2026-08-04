export interface PlanExplanationResponse {
  planId: string;
  explanation: string;
  source: "llm" | "fallback";
  warnings: string[];
}
import axios from "axios";
import { makeRefreshOnce } from "./refresh-once";

// Defaults to a same-origin relative path, proxied by Vite's dev server to
// the gateway (see vite.config.ts's "/api" proxy rule) — this is what makes
// the app work identically whether opened at http://localhost:5173 or
// through a Dev Tunnel/port-forwarded HTTPS URL, with no CORS or
// mixed-content issues, since the browser never makes a cross-origin
// request. Set VITE_API_URL to an absolute URL only when the frontend must
// reach a backend that ISN'T proxied same-origin (e.g. a production static
// build served without an API-proxying reverse proxy in front of it).
// @ts-ignore - ImportMeta.env is provided by Vite
export const API_URL = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

type RetriableRequestConfig = {
  _retry?: boolean;
  headers?: Record<string, string>;
  url?: string;
};

export interface CoachEvidenceItem {
  title: string;
  source_url: string;
  category: string;
  source_type: string;
  summary: string;
}

export interface CoachStreamDonePayload {
  conversationId?: string;
  sessionId?: string;
  evidenceUsed?: CoachEvidenceItem[];
  adjustmentReasons?: unknown[];
  safetyNotes?: string[];
  timing?: unknown;
  fallbackReason?: string;
}

export interface AiChatSessionSummary {
  id: string;
  userId: string;
  title: string;
  lastMessageAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSessionMessage {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  evidenceUsed?: CoachEvidenceItem[];
}

export type TranslationLanguage = "en" | "vi";

export type TranslateRequest = {
  text: string;
  targetLang: TranslationLanguage;
  sourceLang?: TranslationLanguage;
};

const refreshClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

const refreshOnce = makeRefreshOnce(refreshAccessToken);

function hasUsableToken(token: string | null): token is string {
  return !!token && token !== "null" && token !== "undefined";
}

function clearSessionAndRedirectToLogin() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  if (
    window.location.pathname !== "/login" &&
    window.location.pathname !== "/register"
  ) {
    window.location.href = "/login";
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!hasUsableToken(refreshToken)) return null;

  try {
    const { data } = await refreshClient.post("/auth/refresh", {
      refreshToken,
    });
    if (hasUsableToken(data?.accessToken)) {
      localStorage.setItem("accessToken", data.accessToken);
      if (hasUsableToken(data?.refreshToken)) {
        localStorage.setItem("refreshToken", data.refreshToken);
      }
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (hasUsableToken(token)) {
    config.headers.Authorization = `Bearer ${token}`;
  } else if (config.headers?.Authorization) {
    delete config.headers.Authorization;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = (error?.config || {}) as RetriableRequestConfig;
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code;
    const message = error?.response?.data?.error?.message;
    const requestUrl = originalRequest.url || "";

    const isAuthEndpoint =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/register") ||
      requestUrl.includes("/auth/refresh");

    const isTokenIssue =
      code === "UNAUTHORIZED" ||
      (typeof message === "string" && /token|unauthorized/i.test(message));

    if (
      status === 401 &&
      isTokenIssue &&
      !isAuthEndpoint &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      const newToken = await refreshOnce();

      if (hasUsableToken(newToken)) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      clearSessionAndRedirectToLogin();
    }

    return Promise.reject(error);
  },
);

export const authService = {
  login: async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    // Store tokens directly from auth service response
    if (data.accessToken) {
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  register: async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ) => {
    const { data } = await api.post("/auth/register", {
      email,
      password,
      firstName,
      lastName,
    });
    return data;
  },

  verifyRegistration: async (email: string, otp: string) => {
    const { data } = await api.post("/auth/register/verify", { email, otp });
    if (data.accessToken) {
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  logout: () => {
    localStorage.clear();
    window.location.href = "/login";
  },
};

export const translationService = {
  translate: async ({
    text,
    targetLang,
    sourceLang = "en",
  }: TranslateRequest): Promise<string> => {
    const { data } = await api.post("/api/translate", {
      text,
      targetLang,
      sourceLang,
    });
    return data?.translatedText ?? text;
  },
};

export const profileService = {
  getProfile: async () => {
    const { data } = await api.get("/profile/me");
    return data;
  },

  updateProfile: async (profile: any) => {
    const { data } = await api.put("/profile/me", profile);
    return data;
  },

  uploadPhoto: async (file: File) => {
    const formData = new FormData();
    formData.append("photo", file);
    const { data } = await api.post("/profile/me/photo", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as { photoUrl: string };
  },

  becomePT: async () => {
    const { data } = await api.patch("/profile/me/become-pt");
    return data;
  },

  listPTs: async () => {
    const { data } = await api.get("/profile/pts");
    return data;
  },
};

function inBodyDateKey(entry: any): string {
  const raw = entry?.dateOnly ?? entry?.date ?? entry?.createdAt;
  const s = raw ? String(raw) : "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmy2 = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy2) return `${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return "9999-12-31";
}

function sortInBodyHistoryByMeasurementDate(history: any[]) {
  return [...history].sort((a, b) => {
    const cmp = inBodyDateKey(b).localeCompare(inBodyDateKey(a)); // descending
    if (cmp !== 0) return cmp;
    return (
      Date.parse(String(b?.createdAt ?? 0)) -
      Date.parse(String(a?.createdAt ?? 0))
    );
  });
}

export const inbodyService = {
  create: async (entry: any) => {
    const { data } = await api.post("/inbody", entry);
    return data;
  },

  getLatest: async () => {
    const { data } = await api.get("/inbody/latest"); // We need to add /latest to backend too or just use history[0]
    return data;
  },

  getHistory: async () => {
    const { data } = await api.get("/inbody");
    return Array.isArray(data)
      ? sortInBodyHistoryByMeasurementDate(data)
      : data;
  },

  upload: async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    const { data } = await api.post("/inbody/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      // OCR can take longer than normal API calls on larger or low-quality images.
      timeout: 180000,
    });
    return data;
  },
};

export const workoutService = {
  logWorkout: async (workout: any) => {
    const { data } = await api.post("/workouts", workout);
    return data;
  },

  getHistory: async (page: number = 1, limit: number = 50) => {
    const { data } = await api.get(`/workouts?page=${page}&limit=${limit}`);
    return data;
  },

  getWorkout: async (id: string) => {
    const { data } = await api.get(`/workouts/${id}`);
    return data;
  },

  updateWorkout: async (id: string, workout: any) => {
    const { data } = await api.put(`/workouts/${id}`, workout);
    return data;
  },

  getExercises: async (params?: {
    search?: string;
    bodyPart?: string;
    muscleGroup?: string;
    equipment?: string;
    activityType?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.bodyPart) qs.set("bodyPart", params.bodyPart);
    if (params?.muscleGroup) qs.set("muscleGroup", params.muscleGroup);
    if (params?.equipment) qs.set("equipment", params.equipment);
    if (params?.activityType) qs.set("activityType", params.activityType);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const { data } = await api.get(
      `/exercises${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
    // Backend returns { success: true, data: { exercises: [...], pagination, filters } }
    return data?.data?.exercises ?? (Array.isArray(data) ? data : []);
  },

  getExerciseFilterOptions: async () => {
    const { data } = await api.get("/exercises/filter-options");
    return data;
  },

  // Batch lookup by id — used to resolve muscle/equipment metadata for
  // exercises referenced (by exerciseId) from AI-generated plan content,
  // which only ever stores {exerciseId, order, name, sets, reps,
  // restSeconds, note} and never the catalog's own descriptive fields.
  getExercisesByIds: async (ids: string[]) => {
    if (ids.length === 0) return [];
    const { data } = await api.get(`/exercises?ids=${ids.map(encodeURIComponent).join(",")}`);
    return data?.data?.exercises ?? (Array.isArray(data) ? data : []);
  },

  getStats: async () => {
    const { data } = await api.get("/stats/workouts");
    return data;
  },

  getSchedules: async (
    limit = 20,
    range?: { startDate?: string; endDate?: string },
  ) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (range?.startDate) qs.set("startDate", range.startDate);
    if (range?.endDate) qs.set("endDate", range.endDate);
    const { data } = await api.get(`/workouts/schedules?${qs.toString()}`);
    return data;
  },

  getPRs: async (exerciseId?: string) => {
    const url = exerciseId
      ? `/workouts/prs?exerciseId=${exerciseId}`
      : "/workouts/prs";
    const { data } = await api.get(url);
    return data;
  },

  updateSet: async (
    setId: string,
    patch: {
      reps?: number;
      weight?: number;
      rpe?: number;
      completed?: boolean;
    },
  ) => {
    const { data } = await api.patch(`/workouts/sets/${setId}`, patch);
    return data;
  },

  // Controller returns { success: true, data: { program: {...} | null } }
  getCurrentProgram: async () => {
    const { data } = await api.get("/workouts/programs/current");
    return data?.data?.program ?? null;
  },

  updateProgram: async (id: string, patch: any) => {
    const { data } = await api.patch(`/workouts/programs/${id}`, patch);
    return data;
  },

  deleteProgram: async (id: string) => {
    const { data } = await api.delete(`/workouts/programs/${id}`);
    return data;
  },

  updateProgramDay: async (id: string, patch: any) => {
    const { data } = await api.patch(`/workouts/program-days/${id}`, patch);
    return data;
  },

  updateProgramExercise: async (id: string, patch: any) => {
    const { data } = await api.patch(
      `/workouts/program-exercises/${id}`,
      patch,
    );
    return data;
  },

  deleteProgramExercise: async (id: string) => {
    const { data } = await api.delete(`/workouts/program-exercises/${id}`);
    return data;
  },

  deleteSchedule: async (id: string) => {
    const { data } = await api.delete(`/workouts/schedules/${id}`);
    return data;
  },

  createSchedule: async (input: {
    date: string;
    programDayId: string;
    notes?: string;
  }) => {
    const { data } = await api.post("/workouts/schedules", input);
    // Controller returns { success: true, data: { alreadyExists, schedule } }
    return data?.data ?? data;
  },

  startSchedule: async (id: string, input?: { repeat?: boolean }) => {
    const { data } = await api.post(
      `/workouts/schedules/${id}/start`,
      input || {},
    );
    return data?.data ?? data;
  },

  completeScheduleExercise: async (
    scheduleId: string,
    programExerciseId: string,
  ): Promise<WorkoutExerciseCompletionResponse> => {
    const { data } = await api.post(
      `/workouts/schedules/${scheduleId}/exercises/${programExerciseId}/complete`,
    );
    return data?.data ?? data;
  },

  createManualProgram: async (input: {
    name: string;
    goal?: string | null;
    durationWeeks: number;
    daysPerWeek: number;
    startDate: string;
    repeatWeeks?: number;
    selectedWeekdays: number[];
    replaceExisting?: boolean;
    days: Array<{
      dayNumber: number;
      title: string;
      description?: string | null;
      exercises: Array<{
        exerciseId: string;
        order?: number;
        sets?: number;
        reps?: number;
        restSeconds?: number;
        notes?: string | null;
      }>;
    }>;
  }) => {
    const { data } = await api.post("/workouts/programs/manual", input);
    return data?.data ?? data;
  },

  addProgramExercise: async (
    programDayId: string,
    exercise: {
      exerciseId: string;
      order?: number;
      sets?: number;
      reps?: number;
      restSeconds?: number;
      notes?: string | null;
    },
  ) => {
    const { data } = await api.post(
      `/workouts/program-days/${programDayId}/exercises`,
      exercise,
    );
    return data;
  },

  // Archive (soft-delete) the current program
  archiveProgram: async (id: string) => {
    const { data } = await api.delete(`/workouts/programs/${id}`);
    return data;
  },
};

// Widened (Phase 7 unification) — completeCycle() now writes the same
// 6-state decision as evaluate() for any cycle with sufficient data (only
// the INSUFFICIENT_DATA / legacy NEW_PLAN values are exclusively-legacy
// today). PROGRESS/DELOAD/REBUILD/ADJUST/KEEP overlap with AdaptiveCycleDecision
// below by design — same underlying CycleDecision engine enum.
export type CycleDecision = "KEEP" | "ADJUST" | "NEW_PLAN" | "INSUFFICIENT_DATA" | "PROGRESS" | "DELOAD" | "REBUILD";
export type OverallTrend = "PROGRESSING" | "PLATEAU" | "DECLINING";

export interface CycleAlert {
  code: string;
  severity: "info" | "warning";
  message: string;
  createdAt: string;
}

export interface CycleAdherence {
  completed: number;
  total: number;
  /** null when there were no scheduled sessions to judge against — never a
   * substitute for 0% (no data mistaken for failure) or 100% (no data
   * mistaken for perfect adherence). */
  percent: number | null;
}

export interface CycleVolumeWeek {
  week: number;
  totalVolumeKg: number;
  byMuscleGroup: Record<string, number>;
}

export interface CycleProgressSignals {
  overallTrend: OverallTrend;
  deltaSMM: number | null;
  deltaPBF: number | null;
  volumeChangePct: number | null;
  newPRs: string[];
  adherencePct: number | null;
  rpeTrend: "stable" | "increasing" | "decreasing";
  laggingMuscleGroups: string[];
}

export interface CycleSummary {
  adherence: CycleAdherence;
  volumeByWeek: CycleVolumeWeek[];
  volumeChangePct: number | null;
  e1rmTrend: Array<{ exerciseName: string; weeklyTop: Array<{ week: number; e1rm: number }> }>;
  rpeTrend: { weeklyAvg: number[]; trend: "stable" | "increasing" | "decreasing" };
  newPRs: string[];
  inBodySeries: Array<{ id: string; date: string; weight: number; bodyFatPct?: number | null; muscleMass: number }>;
  alerts: CycleAlert[];
  computedAt: string;
  progressSignals?: CycleProgressSignals;
  closedAt?: string;
}

export interface CycleReportSessionDetail {
  date: string;
  completedExercises: number | null;
  totalExercises: number | null;
  readinessScore: number | null;
  sessionRpe: number | null;
  painScore: number | null;
  notes: string | null;
}

export interface CycleReport {
  cycle: TrainingCycle;
  window: { startDate: string; endDate: string };
  workouts: {
    totalScheduled: number;
    completed: number;
    missed: number;
    upcoming: number;
    completionRate: number;
    missedSessions: Array<{ date: string }>;
    sessionDetails: CycleReportSessionDetail[];
    highPainSessions: CycleReportSessionDetail[];
  };
  trainingLoad: {
    hasData: boolean;
    weeklyLoad: Array<{ week: number; totalLoad: number; monotony: number | null; strain: number | null }>;
    monotonyThreshold: number;
  };
  nutrition: {
    daysLogged: number;
    totalDaysInWindow: number;
    avgProtein: number | null;
    targetProtein: number | null;
    proteinAdherencePct: number | null;
    proteinPerKgBodyWeight: number | null;
    proteinEvidenceRangeGPerKg: { min: number; max: number };
    avgCalories: number | null;
    targetCalories: number | null;
    caloriesAdherencePct: number | null;
    avgCarbs: number | null;
    targetCarbs: number | null;
    avgFat: number | null;
    targetFat: number | null;
    completedMeals: number;
    partialMeals: number;
    skippedMeals: number;
  };
  bodyComposition: CycleSummary["inBodySeries"];
  volumeWeekOverWeekPct: Array<{ week: number; changePct: number | null }>;
  progressSignals: CycleProgressSignals | null;
  alerts: CycleAlert[];
  newPRs: string[];
  flags: string[];
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
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ANALYZED" | "CANCELLED";
  startInbodyId: string | null;
  endInbodyId: string | null;
  summary: CycleSummary | null;
  lowConfidence: boolean;
  decision: CycleDecision | null;
  aiAnalysis: CycleAnalysisDetails | null;
  nextPlanId: string | null;
  name: string | null;
  actualEndDate: string | null;
  baselineMetrics: Record<string, unknown> | null;
  targetMetrics: Record<string, unknown> | null;
  configuration: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Adaptive Training Cycle Evaluation ────────────────────────────────────

export type AdaptiveCycleDecision = "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA";

export interface CycleFieldTrend {
  direction: "up" | "flat" | "down";
  changePerWeek: number | null;
  dataPoints: number;
}

export interface CycleSafetyFlag {
  code: string;
  severity: "warning" | "critical";
  message: string;
}

export interface CycleProposedChange {
  type: "VOLUME" | "LOAD" | "REPS" | "EXERCISE" | "FREQUENCY" | "DELOAD";
  target: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
}

export interface CycleMetrics {
  adherenceRate: number;
  completionRate: number;
  /** false when there were zero scheduled sessions at all — must render as
   * "no data" rather than "0%" (see CycleProgressSection). */
  hasScheduledSessions: boolean;
  workoutsPerWeek: number;
  weeklyVolumeByMuscleGroup: CycleVolumeWeek[];
  volumeTrendPercent: number | null;
  exerciseProgression: Array<{ exerciseName: string; firstWeekE1rm: number; lastWeekE1rm: number; changePct: number | null; isPriority: boolean }>;
  estimated1RmTrend: Array<{ exerciseName: string; weeklyTop: Array<{ week: number; e1rm: number }> }>;
  strengthProgressScore: number | null;
  performanceConsistencyScore: number | null;
  averageSessionRpe: number | null;
  rpeTrend: "stable" | "increasing" | "decreasing";
  averageRir: number | null;
  painTrend: CycleFieldTrend | null;
  averagePainScore: number | null;
  fatigueScore: number | null;
  recoveryScore: number | null;
  bodyWeightTrend: CycleFieldTrend | null;
  skeletalMuscleTrend: CycleFieldTrend | null;
  bodyFatTrend: CycleFieldTrend | null;
  goalProgressScore: number | null;
  dataCompletenessScore: number;
  dataQualityScore: number;
  newPRs: string[];
  inBodyQuality: {
    recordCount: number;
    comparableRecordCount: number;
    hasSufficientData: boolean;
    qualityFlags: string[];
  };
}

export interface CycleAssessment {
  id: string;
  cycleId: string;
  assessmentVersion: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  decision: AdaptiveCycleDecision | null;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  computedMetrics: CycleMetrics | null;
  reasonCodes: string[] | null;
  conflictingSignals: string[] | null;
  safetyFlags: CycleSafetyFlag[] | null;
  recommendedActionScope: "none" | "minor_adjustment" | "deload" | "full_rebuild" | null;
  aiSummary: string | null;
  proposedChanges: CycleProposedChange[] | null;
  userDecision: "PENDING" | "ACCEPTED" | "REJECTED";
  reviewedAt: string | null;
  createdAt: string;
}

export const trainingCycleService = {
  start: async (params?: { planId?: string; startDate?: string; durationDays?: number }) => {
    const { data } = await api.post<TrainingCycle>(
      "/training-cycles",
      params ?? {},
    );
    return data;
  },

  getActive: async () => {
    const { data } = await api.get<{
      cycle: TrainingCycle;
      summary: CycleSummary;
    }>("/training-cycles/active");
    return data;
  },

  complete: async (id: string, endInbodyId?: string) => {
    // Closing a cycle now runs the same synchronous Adaptive Decision
    // Engine + LLM explanation call as evaluate() below (Phase 7
    // unification — completeCycle() no longer fires the old analysis
    // off in the background). Needs the same 120s override for the same
    // reason: the shared `api` instance's flat 10s default would abort
    // this call client-side before the server-side LLM round-trip finishes.
    const { data } = await api.post<TrainingCycle>(
      `/training-cycles/${id}/complete`,
      endInbodyId ? { endInbodyId } : {},
      { timeout: 120000 },
    );
    return data;
  },

  /** Explicit abandonment — distinct from complete(): never evaluated,
   * never calls the AI, regardless of how much data exists. */
  cancel: async (id: string) => {
    const { data } = await api.post<TrainingCycle>(`/training-cycles/${id}/cancel`, {});
    return data;
  },

  approve: async (id: string, nextPlanId: string) => {
    const { data } = await api.post<TrainingCycle>(
      `/training-cycles/${id}/approve`,
      { nextPlanId },
    );
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<TrainingCycle>(`/training-cycles/${id}`);
    return data;
  },

  list: async (limit = 20) => {
    const { data } = await api.get<{ cycles: TrainingCycle[] }>(
      `/training-cycles?limit=${limit}`,
    );
    return data.cycles;
  },

  // ── Adaptive Training Cycle Evaluation additions ────────────────────────

  update: async (id: string, updates: { name?: string; targetMetrics?: Record<string, unknown>; configuration?: Record<string, unknown> }) => {
    const { data } = await api.patch<TrainingCycle>(`/training-cycles/${id}`, updates);
    return data;
  },

  startDraft: async (id: string) => {
    const { data } = await api.post<TrainingCycle>(`/training-cycles/${id}/start`, {});
    return data;
  },

  getProgress: async (id: string) => {
    const { data } = await api.get<{ cycle: TrainingCycle; metrics: CycleMetrics; computedAt: string }>(
      `/training-cycles/${id}/progress`,
    );
    return data;
  },

  evaluate: async (id: string) => {
    // The real LLM round-trip inside POST /evaluate is synchronous
    // server-side (not fire-and-forget like legacy /complete) and has taken
    // 5-90s in live testing — the shared `api` instance's flat 10s default
    // timeout previously aborted this call client-side well before the
    // server finished, surfacing a false "Không thể đánh giá chu kỳ" error
    // toast even though the assessment went on to complete successfully in
    // the DB moments later (the exact "button flips back with no clear
    // success/failure" symptom from the bug report). Matches the same
    // 120s override already used for other LLM-heavy calls (coachService.chat).
    const { data } = await api.post<CycleAssessment>(`/training-cycles/${id}/evaluate`, {}, { timeout: 120000 });
    return data;
  },

  listAssessments: async (id: string, page = 1, limit = 20) => {
    const { data } = await api.get<{ assessments: CycleAssessment[]; total: number; page: number; limit: number }>(
      `/training-cycles/${id}/assessments?page=${page}&limit=${limit}`,
    );
    return data;
  },

  getLatestAssessment: async (id: string) => {
    const { data } = await api.get<CycleAssessment>(`/training-cycles/${id}/assessments/latest`);
    return data;
  },

  acceptRecommendation: async (id: string, assessmentId?: string) => {
    const { data } = await api.post<CycleAssessment>(
      `/training-cycles/${id}/recommendation/accept`,
      assessmentId ? { assessmentId } : {},
    );
    return data;
  },

  rejectRecommendation: async (id: string, assessmentId?: string) => {
    const { data } = await api.post<CycleAssessment>(
      `/training-cycles/${id}/recommendation/reject`,
      assessmentId ? { assessmentId } : {},
    );
    return data;
  },

  linkInBodyEntry: async (id: string, inbodyEntryId: string) => {
    const { data } = await api.post(`/training-cycles/${id}/inbody-links`, { inbodyEntryId });
    return data;
  },

  remove: async (id: string) => {
    const { data } = await api.delete<{ cycleId: string; archived: boolean; archivedAt: string }>(
      `/training-cycles/${id}`,
    );
    return data;
  },

  getReport: async (id: string) => {
    const { data } = await api.get<CycleReport>(`/training-cycles/${id}/report`);
    return data;
  },

  submitSessionFeedback: async (
    cycleId: string,
    scheduleId: string,
    input: { readinessScore?: number; sessionRpe?: number; painScore?: number; notes?: string },
  ) => {
    const { data } = await api.post(`/training-cycles/${cycleId}/sessions/${scheduleId}/feedback`, input);
    return data;
  },
};

export interface PublishedPlanListing {
  id: string;
  sourcePlanId: string;
  publisherId: string;
  title: string;
  description: string | null;
  goal: string;
  moderationStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  moderationNote: string | null;
  avgRating: number;
  ratingCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanReview {
  id: string;
  publishedPlanId: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export const marketplaceService = {
  browse: async (params?: {
    goal?: string;
    sort?: "rating" | "recent";
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.goal) qs.set("goal", params.goal);
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const { data } = await api.get<{
      success: boolean;
      data: {
        items: PublishedPlanListing[];
        total: number;
        page: number;
        limit: number;
      };
    }>(`/marketplace/plans${qs.toString() ? `?${qs.toString()}` : ""}`);
    return data.data;
  },

  getDetail: async (id: string) => {
    const { data } = await api.get<{
      success: boolean;
      data: PublishedPlanListing & { reviews: PlanReview[] };
    }>(`/marketplace/plans/${id}`);
    return data.data;
  },

  submitReview: async (id: string, rating: number, comment?: string) => {
    const { data } = await api.post<{ success: boolean; data: PlanReview }>(
      `/marketplace/plans/${id}/reviews`,
      { rating, comment },
    );
    return data.data;
  },

  publish: async (sourcePlanId: string, title: string, description?: string) => {
    const { data } = await api.post<{
      success: boolean;
      data: PublishedPlanListing;
    }>("/marketplace/plans", { sourcePlanId, title, description });
    return data.data;
  },

  listMine: async () => {
    const { data } = await api.get<{
      success: boolean;
      data: PublishedPlanListing[];
    }>("/marketplace/plans/mine");
    return data.data;
  },

  withdraw: async (id: string) => {
    await api.delete(`/marketplace/plans/${id}`);
  },

  // ── Admin ──────────────────────────────────────────────────────────────
  adminListForModeration: async (status?: string) => {
    const { data } = await api.get<{
      success: boolean;
      data: PublishedPlanListing[];
    }>(`/admin/ai/marketplace/plans${status ? `?status=${status}` : ""}`);
    return data.data;
  },

  adminReviewAction: async (
    id: string,
    action: "APPROVE" | "REJECT",
    note?: string,
  ) => {
    const { data } = await api.post<{
      success: boolean;
      data: PublishedPlanListing;
    }>(`/admin/ai/marketplace/plans/${id}/review/${action}`, { note });
    return data.data;
  },
};

export interface TrainingPackage {
  id: string;
  sellerId: string;
  publishedPlanId: string;
  name: string;
  description: string | null;
  price: number;
  durationWeeks: number | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  publishedPlan?: {
    title: string;
    goal: string;
    avgRating?: number;
    ratingCount?: number;
    sourcePlanId?: string;
  };
}

export interface TrainingPackagePurchase {
  id: string;
  packageId: string;
  buyerId: string;
  priceAtPurchase: number;
  status: "PENDING" | "PAID" | "FAILED";
  purchasedAt: string | null;
  createdAt: string;
  package?: TrainingPackage;
}

export const trainingPackageService = {
  create: async (params: {
    publishedPlanId: string;
    name: string;
    description?: string;
    price: number;
    durationWeeks?: number;
  }) => {
    const { data } = await api.post<{ success: boolean; data: TrainingPackage }>(
      "/marketplace/packages",
      params,
    );
    return data.data;
  },

  listMine: async () => {
    const { data } = await api.get<{ success: boolean; data: TrainingPackage[] }>(
      "/marketplace/packages/mine",
    );
    return data.data;
  },

  archive: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: TrainingPackage }>(
      `/marketplace/packages/${id}/archive`,
    );
    return data.data;
  },

  browse: async (page = 1, limit = 20) => {
    const { data } = await api.get<{
      success: boolean;
      data: { items: TrainingPackage[]; total: number; page: number; limit: number };
    }>(`/marketplace/packages?page=${page}&limit=${limit}`);
    return data.data;
  },

  purchase: async (id: string) => {
    const { data } = await api.post<{
      success: boolean;
      data: TrainingPackagePurchase;
    }>(`/marketplace/packages/${id}/purchase`);
    return data.data;
  },

  listMyPurchases: async () => {
    const { data } = await api.get<{
      success: boolean;
      data: TrainingPackagePurchase[];
    }>("/marketplace/packages/purchases/mine");
    return data.data;
  },
};

export type PlanStatusBackend =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface ExerciseItem {
  exerciseId?: string;
  order?: number;
  name?: string;
  sets?: number | string;
  reps?: number | string;
  restSeconds?: number;
  note?: string;
  muscleGroup?: string;
  equipment?: string;
  intensity?: string;
}

export interface WeeklyScheduleItem {
  day?: string | number;
  focus?: string;
  goal?: string;
  exercises?: ExerciseItem[];
  notes?: string;
  cardio?: string;
}

export interface PlanContent {
  goal?: string;
  durationWeeks?: number;
  daysPerWeek?: number;
  exercisesPerDay?: number;
  weeklySchedule?: WeeklyScheduleItem[];
  progressionNotes?: string[];
  recoveryNotes?: string[];
  nutritionSummary?: string;
}

export interface WorkoutPlanRecord {
  id: string;
  userId?: string;
  name?: string;
  description?: string;
  goal?: string;
  duration?: number;
  daysPerWeek?: number;
  plan?: PlanContent | unknown;
  status: PlanStatusBackend;
  version?: number;
  jobId?: string | null;
  failReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}

export interface WorkoutScheduleExerciseRecord {
  id: string;
  order: number;
  sets: number;
  reps: number | null;
  restSeconds?: number | null;
  notes?: string | null;
  exercise?: {
    id: string;
    exerciseName: string;
    typeOfActivity?: string;
    muscleGroupsActivated?: string[];
  };
}

export interface WorkoutScheduleProgramDayRecord {
  id: string;
  dayNumber: number;
  title: string;
  description?: string | null;
  program?: {
    id: string;
    name: string;
    sourcePlanId?: string | null;
    sourceType?: string | null;
    aiPlanVersion?: number | null;
  };
  exercises?: WorkoutScheduleExerciseRecord[];
}

export interface WorkoutScheduleRecord {
  id: string;
  userId: string;
  date: string;
  scheduledDate?: string;
  sourcePlanId?: string | null;
  sourceType?: string | null;
  notes?: string | null;
  workoutId?: string | null;
  workoutLogId?: string | null;
  status?: "NOT_STARTED" | "IN_PROGRESS" | "PARTIALLY_COMPLETED" | "COMPLETED" | "SKIPPED" | "CANCELLED";
  progressPercent?: number;
  completedAt?: string | null;
  canStart?: boolean;
  canContinue?: boolean;
  canReview?: boolean;
  canRepeat?: boolean;
  totalExercises?: number | null;
  completedExercises?: number | null;
  totalSets?: number | null;
  completedSets?: number | null;
  durationSeconds?: number | null;
  durationMinutes?: number | null;
  exerciseCount?: number;
  programDay?: WorkoutScheduleProgramDayRecord | null;
  workout?: { id?: string } | null;
}

export interface WorkoutExerciseCompletionResponse {
  sessionId: string | null;
  workoutId: string | null;
  planId: string | null;
  dayId: string | null;
  exerciseId?: string | null;
  programExerciseId?: string | null;
  exerciseCompleted?: boolean;
  completedExercises: number;
  totalExercises: number;
  completedSets: number;
  totalSets: number;
  progressPercent: number;
  sessionStatus: "not_started" | "in_progress" | "completed";
  dayStatus: "not_started" | "in_progress" | "completed";
  completedAt: string | null;
  trainingCycleId?: string | null;
}

export interface PlanJobResponse {
  planId: string;
  jobId: string;
  status: PlanStatusBackend;
}

export interface PlanJobStatusResponse {
  jobId?: string;
  planId?: string | null;
  status: PlanStatusBackend;
  failReason?: string | null;
}

export interface LlmHealthStatus {
  llmAvailable: boolean;
  llmProvider: string;
  llmUrl: string;
  model: string;
  embeddingModel: string;
  checkedAt: string;
  error?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function unwrapApiPayload<T = unknown>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function normalizePlanStatus(value: unknown): PlanStatusBackend {
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (
      upper === "QUEUED" ||
      upper === "PROCESSING" ||
      upper === "COMPLETED" ||
      upper === "FAILED"
    ) {
      return upper;
    }
    if (upper === "WAITING" || upper === "DELAYED") return "QUEUED";
    if (upper === "ACTIVE") return "PROCESSING";
  }
  return "QUEUED";
}

function extractPlanJobResponse(payload: unknown): PlanJobResponse {
  const data = unwrapApiPayload<unknown>(payload);
  if (!isRecord(data)) {
    throw new Error("Invalid generate/adjust response payload");
  }

  const planId = typeof data.planId === "string" ? data.planId : "";
  const jobId = typeof data.jobId === "string" ? data.jobId : "";
  const status = normalizePlanStatus(data.status);

  if (!planId || !jobId) {
    throw new Error("Missing planId/jobId in generate/adjust response");
  }

  return { planId, jobId, status };
}

function extractCurrentPlans(payload: unknown): WorkoutPlanRecord[] {
  const unwrapped = unwrapApiPayload<unknown>(payload);

  if (Array.isArray(unwrapped)) {
    return unwrapped as WorkoutPlanRecord[];
  }

  if (isRecord(unwrapped)) {
    if (Array.isArray(unwrapped.plans)) {
      return unwrapped.plans as WorkoutPlanRecord[];
    }
    if (Array.isArray(unwrapped.data)) {
      return unwrapped.data as WorkoutPlanRecord[];
    }
  }

  return [];
}

function extractPlanRecord(payload: unknown): WorkoutPlanRecord {
  const unwrapped = unwrapApiPayload<unknown>(payload);

  if (isRecord(unwrapped) && isRecord(unwrapped.plan)) {
    return unwrapped.plan as WorkoutPlanRecord;
  }
  if (isRecord(unwrapped)) {
    return unwrapped as WorkoutPlanRecord;
  }

  throw new Error("Invalid plan detail response");
}

function extractJobStatus(payload: unknown): PlanJobStatusResponse {
  const data = unwrapApiPayload<unknown>(payload);
  if (!isRecord(data)) {
    throw new Error("Invalid job status response payload");
  }

  return {
    jobId: typeof data.jobId === "string" ? data.jobId : undefined,
    planId: typeof data.planId === "string" ? data.planId : null,
    status: normalizePlanStatus(data.status),
    failReason: typeof data.failReason === "string" ? data.failReason : null,
  };
}

function extractExplanation(payload: unknown): PlanExplanationResponse {
  const unwrapped = unwrapApiPayload<unknown>(payload);
  if (typeof unwrapped === "string") {
    return { planId: "", explanation: unwrapped, source: "llm", warnings: [] };
  }

  if (isRecord(unwrapped)) {
    if (typeof unwrapped.explanation === "string") {
      return {
        planId: typeof unwrapped.planId === "string" ? unwrapped.planId : "",
        explanation: unwrapped.explanation,
        source: unwrapped.source === "fallback" ? "fallback" : "llm",
        warnings: Array.isArray(unwrapped.warnings)
          ? unwrapped.warnings.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      };
    }
    if (
      isRecord(unwrapped.data) &&
      typeof unwrapped.data.explanation === "string"
    ) {
      return {
        planId:
          typeof unwrapped.data.planId === "string"
            ? unwrapped.data.planId
            : "",
        explanation: unwrapped.data.explanation,
        source: unwrapped.data.source === "fallback" ? "fallback" : "llm",
        warnings: Array.isArray(unwrapped.data.warnings)
          ? unwrapped.data.warnings.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      };
    }
    return {
      planId: "",
      explanation: JSON.stringify(unwrapped, null, 2),
      source: "llm",
      warnings: [],
    };
  }

  return {
    planId: "",
    explanation: String(unwrapped ?? ""),
    source: "llm",
    warnings: [],
  };
}

function extractLlmHealth(payload: unknown): LlmHealthStatus {
  const unwrapped = unwrapApiPayload<unknown>(payload);
  if (isRecord(unwrapped) && typeof unwrapped.llmAvailable === "boolean") {
    return {
      llmAvailable: unwrapped.llmAvailable,
      llmProvider:
        typeof unwrapped.llmProvider === "string"
          ? unwrapped.llmProvider
          : "unknown",
      llmUrl: typeof unwrapped.llmUrl === "string" ? unwrapped.llmUrl : "",
      model: typeof unwrapped.model === "string" ? unwrapped.model : "",
      embeddingModel:
        typeof unwrapped.embeddingModel === "string"
          ? unwrapped.embeddingModel
          : "",
      checkedAt:
        typeof unwrapped.checkedAt === "string"
          ? unwrapped.checkedAt
          : new Date().toISOString(),
      error: typeof unwrapped.error === "string" ? unwrapped.error : undefined,
    };
  }

  return {
    llmAvailable: false,
    llmProvider: "unknown",
    llmUrl: "",
    model: "",
    embeddingModel: "",
    checkedAt: new Date().toISOString(),
    error: "Invalid LLM health response",
  };
}

export const planService = {
  getLlmHealth: async (): Promise<LlmHealthStatus> => {
    const { data } = await api.get("/plans/llm-health", {
      timeout: 5000,
      validateStatus: () => true,
    });
    return extractLlmHealth(data);
  },

  generateWorkoutPlan: async (input: {
    goal: string;
    durationWeeks: number;
    daysPerWeek: number;
    exercisesPerDay?: number;
    contractId?: string;
  }): Promise<PlanJobResponse> => {
    const { data } = await api.post("/plans/workout/generate", input);
    return extractPlanJobResponse(data);
  },

  getCurrentPlans: async (
    includeArchived = false,
  ): Promise<WorkoutPlanRecord[]> => {
    const { data } = await api.get(
      `/plans/current${includeArchived ? "?includeArchived=true" : ""}`,
    );
    return extractCurrentPlans(data);
  },

  getPlanById: async (planId: string): Promise<WorkoutPlanRecord> => {
    const { data } = await api.get(`/plans/${planId}`);
    return extractPlanRecord(data);
  },

  getJobStatus: async (jobId: string): Promise<PlanJobStatusResponse> => {
    const { data } = await api.get(`/plans/job/${jobId}`);
    return extractJobStatus(data);
  },

  explainPlan: async (
    planId: string,
    lang = "vi",
  ): Promise<PlanExplanationResponse> => {
    const { data } = await api.post(
      `/plans/explain?lang=${encodeURIComponent(lang)}`,
      { planId },
      { timeout: 30000 },
    );
    return extractExplanation(data);
  },

  archivePlan: async (planId: string) => {
    const { data } = await api.delete(`/plans/${planId}`);
    return unwrapApiPayload<unknown>(data);
  },

  savePlanToWorkoutLog: async (
    planId: string,
    input: {
      startDate?: string;
      repeatWeeks?: number;
      selectedWeekdays?: number[];
      replaceExisting?: boolean;
    },
  ): Promise<{
    sourcePlanId: string;
    createdProgramId?: string;
    createdScheduleCount: number;
    cancelledScheduleCount?: number;
    skippedDuplicateCount: number;
    alreadyExists?: boolean;
    mode?: string;
    message?: string;
    selectedWeekdays?: number[];
    schedulePreview?: unknown[];
  }> => {
    const { data } = await api.post(
      `/plans/${planId}/save-to-workout-log`,
      input,
    );
    const unwrapped = unwrapApiPayload<unknown>(data);

    if (isRecord(unwrapped)) {
      return {
        sourcePlanId:
          typeof unwrapped.sourcePlanId === "string"
            ? unwrapped.sourcePlanId
            : planId,
        createdProgramId:
          typeof unwrapped.createdProgramId === "string"
            ? unwrapped.createdProgramId
            : undefined,
        createdScheduleCount:
          typeof unwrapped.createdScheduleCount === "number"
            ? unwrapped.createdScheduleCount
            : 0,
        cancelledScheduleCount:
          typeof unwrapped.cancelledScheduleCount === "number"
            ? unwrapped.cancelledScheduleCount
            : undefined,
        skippedDuplicateCount:
          typeof unwrapped.skippedDuplicateCount === "number"
            ? unwrapped.skippedDuplicateCount
            : 0,
        alreadyExists:
          typeof unwrapped.alreadyExists === "boolean"
            ? unwrapped.alreadyExists
            : undefined,
        mode: typeof unwrapped.mode === "string" ? unwrapped.mode : undefined,
        message:
          typeof unwrapped.message === "string" ? unwrapped.message : undefined,
        selectedWeekdays: Array.isArray(unwrapped.selectedWeekdays)
          ? (unwrapped.selectedWeekdays as number[])
          : undefined,
        schedulePreview: Array.isArray(unwrapped.schedulePreview)
          ? unwrapped.schedulePreview
          : undefined,
      };
    }

    return {
      sourcePlanId: planId,
      createdScheduleCount: 0,
      skippedDuplicateCount: 0,
    };
  },

  adjustPlan: async (
    planId: string,
    adjustments: string,
    daysPerWeek?: number,
    exercisesPerDay?: number,
  ): Promise<PlanJobResponse> => {
    const body: {
      planId: string;
      adjustments: string;
      daysPerWeek?: number;
      exercisesPerDay?: number;
    } = {
      planId,
      adjustments,
    };
    if (typeof daysPerWeek === "number") {
      body.daysPerWeek = daysPerWeek;
    }
    if (typeof exercisesPerDay === "number") {
      body.exercisesPerDay = exercisesPerDay;
    }
    const { data } = await api.post("/plans/adjust", body);
    return extractPlanJobResponse(data);
  },

  getCurrentNutritionAiPlans: async (): Promise<any[]> => {
    const { data } = await api.get("/plans/nutrition/current");
    return unwrapApiPayload<any[]>(data) || [];
  },

  generateNutritionPlan: async (input: {
    goal: string;
    durationWeeks: number;
    mealsPerDay: number;
    dailyCaloriesTarget?: number;
    dietPreference?: string;
    budgetLevel?: string;
    restrictions?: string[];
  }): Promise<PlanJobResponse> => {
    const { data } = await api.post("/plans/nutrition/generate", input);
    return extractPlanJobResponse(data);
  },

  saveNutritionPlanToNutrition: async (
    planId: string,
    input: { startDate?: string; forceArchive?: boolean },
  ): Promise<{
    sourcePlanId: string;
    createdNutritionPlanId?: string;
    createdProgramId?: string;
    existingNutritionPlanId?: string;
    createdDayCount?: number;
    createdMealCount?: number;
    createdItemCount?: number;
    alreadyExists?: boolean;
    message?: string;
  }> => {
    const { data } = await api.post(
      `/plans/nutrition/${planId}/save-to-nutrition`,
      input,
    );
    const unwrapped = unwrapApiPayload<unknown>(data);

    if (isRecord(unwrapped)) {
      return {
        sourcePlanId:
          typeof unwrapped.sourcePlanId === "string"
            ? unwrapped.sourcePlanId
            : planId,
        createdNutritionPlanId:
          typeof unwrapped.createdNutritionPlanId === "string"
            ? unwrapped.createdNutritionPlanId
            : undefined,
        createdProgramId:
          typeof unwrapped.createdProgramId === "string"
            ? unwrapped.createdProgramId
            : undefined,
        existingNutritionPlanId:
          typeof unwrapped.existingNutritionPlanId === "string"
            ? unwrapped.existingNutritionPlanId
            : undefined,
        createdDayCount:
          typeof unwrapped.createdDayCount === "number"
            ? unwrapped.createdDayCount
            : undefined,
        createdMealCount:
          typeof unwrapped.createdMealCount === "number"
            ? unwrapped.createdMealCount
            : undefined,
        createdItemCount:
          typeof unwrapped.createdItemCount === "number"
            ? unwrapped.createdItemCount
            : undefined,
        alreadyExists:
          typeof unwrapped.alreadyExists === "boolean"
            ? unwrapped.alreadyExists
            : undefined,
        message:
          typeof unwrapped.message === "string" ? unwrapped.message : undefined,
      };
    }

    return { sourcePlanId: planId };
  },

  explainNutritionPlan: async (
    planId: string,
  ): Promise<{ explanation: string; source: "llm" | "fallback" }> => {
    const { data } = await api.post(`/plans/nutrition/${planId}/explain`);
    const unwrapped = unwrapApiPayload<any>(data);
    return {
      explanation:
        typeof unwrapped?.explanation === "string" ? unwrapped.explanation : "",
      source: unwrapped?.source === "llm" ? "llm" : "fallback",
    };
  },

  adjustNutritionPlan: async (
    planId: string,
    adjustments: string,
    mealsPerDay?: number,
  ): Promise<PlanJobResponse> => {
    const { data } = await api.post(`/plans/nutrition/${planId}/adjust`, {
      adjustments,
      mealsPerDay,
    });
    return extractPlanJobResponse(data);
  },

  archiveNutritionPlan: async (planId: string): Promise<void> => {
    await api.delete(`/plans/nutrition/${planId}`);
  },
};

export const coachService = {
  chat: async (message: string, sessionId?: string) => {
    const { data } = await api.post(
      "/ai/ask",
      { question: message, ...(sessionId ? { sessionId } : {}) },
      {
        // AI generation can take longer than standard API calls.
        timeout: 120000,
      },
    );
    // AI service wraps responses in {success, data}; unwrap to get answer at top level.
    return data?.data ?? data;
  },

  getConversations: async () => {
    const { data } = await api.get("/ai/conversations");
    return data?.data ?? data;
  },

  listSessions: async (): Promise<AiChatSessionSummary[]> => {
    const { data } = await api.get("/ai/sessions");
    return data?.data?.sessions ?? [];
  },

  getSessionMessages: async (
    sessionId: string,
  ): Promise<AiSessionMessage[]> => {
    const { data } = await api.get(`/ai/sessions/${sessionId}/messages`);
    return data?.data?.messages ?? [];
  },

  renameSession: async (sessionId: string, title: string) => {
    const { data } = await api.patch(`/ai/sessions/${sessionId}`, { title });
    return data?.data ?? data;
  },

  archiveSession: async (sessionId: string) => {
    const { data } = await api.delete(`/ai/sessions/${sessionId}`);
    return data?.data ?? data;
  },

  chatStream(
    message: string,
    callbacks: {
      onStatus: (status: string) => void;
      onToken: (token: string) => void;
      onDone: (payload: CoachStreamDonePayload) => void;
      onError: (message: string) => void;
    },
    sessionId?: string,
  ): () => void {
    const controller = new AbortController();
    const slowNoticeTimer = window.setTimeout(() => {
      callbacks.onStatus(
        "Model local có thể đang khởi động, vui lòng chờ thêm...",
      );
    }, 10000);
    const timeoutTimer = window.setTimeout(() => {
      controller.abort();
    }, 75000);

    (async () => {
      try {
        const sendStreamRequest = (token: string | null) =>
          fetch(`${API_URL}/ai/ask/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(hasUsableToken(token)
                ? { Authorization: `Bearer ${token}` }
                : {}),
            },
            body: JSON.stringify({
              question: message,
              ...(sessionId ? { sessionId } : {}),
            }),
            signal: controller.signal,
          });

        let response = await sendStreamRequest(
          localStorage.getItem("accessToken"),
        );

        if (response.status === 401) {
          const newToken = await refreshOnce();
          if (hasUsableToken(newToken) && !controller.signal.aborted) {
            response = await sendStreamRequest(newToken);
          } else {
            clearSessionAndRedirectToLogin();
            callbacks.onError(
              "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
            );
            return;
          }
        }

        if (!response.ok || !response.body) {
          callbacks.onError(
            response.status === 503
              ? "AI model chưa sẵn sàng. Vui lòng bật Ollama hoặc thử lại sau."
              : "Không thể kết nối AI Coach. Vui lòng thử lại.",
          );
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedFinalEvent = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as Record<
                string,
                unknown
              >;
              if (event["type"] === "status") {
                callbacks.onStatus(
                  typeof event["message"] === "string" ? event["message"] : "",
                );
              } else if (event["type"] === "token") {
                callbacks.onToken(
                  typeof event["content"] === "string" ? event["content"] : "",
                );
              } else if (event["type"] === "done") {
                receivedFinalEvent = true;
                callbacks.onDone(event as CoachStreamDonePayload);
              } else if (event["type"] === "error") {
                receivedFinalEvent = true;
                callbacks.onError(
                  typeof event["message"] === "string"
                    ? event["message"]
                    : "Unknown error",
                );
              }
            } catch {
              // Ignore malformed SSE lines.
            }
          }
        }

        // Stream ended without a final event: connection was dropped unexpectedly.
        if (!receivedFinalEvent) {
          callbacks.onError("Connection lost. Please try again.");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          callbacks.onError(
            "AI phản hồi quá lâu. Vui lòng thử lại sau hoặc kiểm tra Ollama/Qdrant.",
          );
          return;
        }
        callbacks.onError("Không thể kết nối AI Coach. Vui lòng thử lại.");
      } finally {
        window.clearTimeout(slowNoticeTimer);
        window.clearTimeout(timeoutTimer);
      }
    })();

    return () => controller.abort();
  },
};

export const chatService = {
  createDirectConversation: async (targetUserId: string) => {
    const { data } = await api.post("/chat/conversations/direct", {
      targetUserId,
    });
    return data;
  },

  listConversations: async () => {
    const { data } = await api.get("/chat/conversations");
    return data;
  },

  getMessages: async (conversationId: string, page = 1, limit = 30) => {
    const { data } = await api.get(
      `/chat/conversations/${conversationId}/messages?page=${page}&limit=${limit}`,
    );
    return data;
  },

  sendMessage: async (conversationId: string, content: string) => {
    const { data } = await api.post(
      `/chat/conversations/${conversationId}/messages`,
      { content },
    );
    return data;
  },
};

export const adminService = {
  listUsers: async () => {
    const { data } = await api.get("/auth/users");
    return data;
  },

  getDashboard: async () => {
    const { data } = await api.get("/admin/dashboard");
    return data;
  },

  getSystemMonitoring: async () => {
    const { data } = await api.get("/admin/system-monitor");
    return data;
  },

  getWorkflowMeta: async () => {
    const { data } = await api.get("/admin/workflows/meta");
    return data;
  },

  getStudioAuthState: async () => {
    const { data } = await api.get("/admin/workflows/studio-auth-state", {
      withCredentials: true,
    });
    return data;
  },

  listWorkflows: async () => {
    const { data } = await api.get("/admin/workflows");
    return data;
  },

  getWorkflowExecutions: async (workflowId: string, limit = 20) => {
    const { data } = await api.get(
      `/admin/workflows/${workflowId}/executions?limit=${limit}`,
    );
    return data;
  },

  getExecutionDetail: async (executionId: string) => {
    const { data } = await api.get(
      `/admin/workflows/executions/${executionId}`,
    );
    return data;
  },

  runSmokeTest: async () => {
    const { data } = await api.post("/admin/workflows/smoke-test", {});
    return data;
  },

  setupSampleWorkflows: async () => {
    const { data } = await api.post("/admin/workflows/setup-samples", {});
    return data;
  },

  listPTProfiles: async () => {
    const { data } = await api.get("/profile/pts");
    return data;
  },

  updateUserRole: async (userId: string, role: "ADMIN" | "CUSTOMER" | "PT") => {
    const { data } = await api.patch(`/auth/users/${userId}/role`, { role });
    return data;
  },

  setPTStatus: async (userId: string, isPT: boolean) => {
    const { data } = await api.patch(
      `/profile/admin/users/${userId}/pt-status`,
      { isPT },
    );
    return data;
  },

  runFullSystemTest: async () => {
    const { data } = await api.post(
      "/admin/workflows/full-system-test",
      {},
      { timeout: 120000 },
    );
    return data;
  },

  // -- AI Observability --------------------------------------------------------

  getAIOverview: async () => {
    const { data } = await api.get("/admin/ai/overview");
    return data;
  },

  getAIRequests: async (params?: {
    filter?: "all" | "fallback" | "slow" | "warnings";
    intent?: string;
    page?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.filter && params.filter !== "all")
      query.set("filter", params.filter);
    if (params?.intent) query.set("intent", params.intent);
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    const { data } = await api.get(`/admin/ai/requests${qs ? `?${qs}` : ""}`);
    return data;
  },

  getAIRequestDetail: async (id: string) => {
    const { data } = await api.get(`/admin/ai/requests/${id}`);
    return data;
  },

  getAIQueue: async () => {
    const { data } = await api.get("/admin/ai/queue");
    return data;
  },

  getAIErrors: async () => {
    const { data } = await api.get("/admin/ai/errors");
    return data;
  },

  getAIKnowledgePipeline: async () => {
    const { data } = await api.get("/admin/ai/knowledge");
    return data;
  },

  enqueueAIKnowledgeJob: async (
    kind: "local" | "pubmed" | "rss" | "web",
    params?: {
      embed?: boolean;
      force?: boolean;
      limit?: number;
      query?: string;
      sourceId?: string;
    },
  ) => {
    const { data } = await api.post(
      `/admin/ai/knowledge/jobs/${kind}`,
      params ?? {},
    );
    return data;
  },

  approveAIKnowledgeReview: async (
    reviewId: string,
    params?: { embed?: boolean },
  ) => {
    const { data } = await api.post(
      `/admin/ai/knowledge/review/${reviewId}/approve`,
      params ?? {},
    );
    return data;
  },

  rejectAIKnowledgeReview: async (
    reviewId: string,
    params?: { reason?: string },
  ) => {
    const { data } = await api.post(
      `/admin/ai/knowledge/review/${reviewId}/reject`,
      params ?? {},
    );
    return data;
  },

  scheduleAIKnowledgePipeline: async () => {
    const { data } = await api.post("/admin/ai/knowledge/schedule", {});
    return data;
  },

  clearAIKnowledgeSchedule: async () => {
    const { data } = await api.delete("/admin/ai/knowledge/schedule");
    return data;
  },
};

export const foodService = {
  search: async (q: string) => {
    const { data } = await api.get(`/food/search?q=${encodeURIComponent(q)}`);
    return data as Array<{
      id: string;
      name: string;
      calories: number;
      protein: number;
      carbs: number;
      fats: number;
      imageUrl: string | null;
    }>;
  },
};

export const nutritionService = {
  getLogs: async (startDate?: string, endDate?: string, mealType?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    if (mealType) params.append("mealType", mealType);
    const { data } = await api.get(`/nutrition?${params.toString()}`);
    return data;
  },
  createLog: async (log: any) => {
    const { data } = await api.post("/nutrition", log);
    return data;
  },
  updateLog: async (id: string, log: any) => {
    const { data } = await api.put(`/nutrition/${id}`, log);
    return data;
  },
  deleteLog: async (id: string) => {
    const { data } = await api.delete(`/nutrition/${id}`);
    return data;
  },
  getCurrentProgram: async () => {
    const { data } = await api.get("/nutrition/plans/current");
    return data?.data ?? null;
  },

  getMonthlySummary: async (
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      date: string;
      status: "completed" | "partial" | "in_progress" | "skipped" | "pending";
      completedMeals: number;
      partialMeals: number;
      totalMeals: number;
      calories: number;
    }>
  > => {
    const { data } = await api.get(
      `/nutrition/monthly-summary?startDate=${startDate}&endDate=${endDate}`,
    );
    return data?.data ?? [];
  },

  getDailyTask: async (
    date?: string,
  ): Promise<{
    hasProgram: boolean;
    date: string;
    program: any | null;
    day: any | null;
    meals: any[];
    actualProgress: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    } | null;
    message?: string;
  }> => {
    const qs = date ? `?date=${date}` : "";
    const { data } = await api.get(`/nutrition/daily-task${qs}`);
    return (
      data?.data ?? {
        hasProgram: false,
        date: date ?? "",
        program: null,
        day: null,
        meals: [],
        actualProgress: null,
      }
    );
  },

  upsertMealCompletion: async (
    mealId: string,
    date: string,
    status: "COMPLETED" | "PARTIAL" | "SKIPPED" | "PENDING",
    opts?: {
      percentConsumed?: number;
      overrideCalories?: number;
      overrideProtein?: number;
      overrideCarbs?: number;
      overrideFat?: number;
    },
  ) => {
    const { data } = await api.post("/nutrition/meal-completions", {
      mealId,
      date,
      status,
      ...opts,
    });
    return data?.data ?? data;
  },

  deleteMealCompletion: async (mealId: string, date: string) => {
    const { data } = await api.delete(
      `/nutrition/meal-completions?mealId=${mealId}&date=${date}`,
    );
    return data?.data ?? data;
  },
  getGoal: async () => {
    const { data } = await api.get("/nutrition/goals");
    return data as {
      id?: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      waterMl: number | null;
    };
  },
  upsertGoal: async (goal: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    waterMl?: number;
  }) => {
    const { data } = await api.put("/nutrition/goals", goal);
    return data;
  },
  updateProgram: async (
    programId: string,
    patch: { name?: string; goal?: string; dailyCaloriesTarget?: number },
  ) => {
    const { data } = await api.patch(`/nutrition/programs/${programId}`, patch);
    return data?.data ?? data;
  },
  deleteProgram: async (programId: string) => {
    const { data } = await api.delete(`/nutrition/programs/${programId}`);
    return data;
  },
  addMealItem: async (
    mealId: string,
    item: {
      foodId?: string;
      customFoodName?: string;
      name?: string;
      quantity: number;
      unit?: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    },
  ) => {
    const { data } = await api.post(
      `/nutrition/program-meals/${mealId}/items`,
      item,
    );
    return data?.data ?? data;
  },
  updateMealItem: async (
    itemId: string,
    patch: {
      quantity?: number;
      unit?: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      notes?: string;
    },
  ) => {
    const { data } = await api.patch(
      `/nutrition/program-meal-items/${itemId}`,
      patch,
    );
    return data?.data ?? data;
  },
  deletePlanMeal: async (mealId: string) => {
    const { data } = await api.delete(`/nutrition/plan-meals/${mealId}`);
    return data?.data ?? data;
  },

  deactivateNutritionProgram: async (
    programId: string,
  ): Promise<{ archived: boolean; hadCompletedMeals: boolean }> => {
    const { data } = await api.post(
      `/nutrition/programs/${programId}/deactivate`,
    );
    return data?.data ?? data;
  },

  deleteMealItem: async (itemId: string) => {
    const { data } = await api.delete(
      `/nutrition/program-meal-items/${itemId}`,
    );
    return data;
  },
};

export const contractService = {
  // New contract request flow
  requestContract: async (requestData: {
    ptUserId: string;
    packageType: string;
    packageName: string;
    description?: string;
    totalSessions?: number;
    packageQuantity?: number;
    extraSessions?: number;
    price?: number;
    pricePerSession?: number;
    sessionMode?: "ONLINE" | "OFFLINE";
    startDate?: string;
    endDate?: string;
    message?: string;
  }) => {
    const { data } = await api.post("/contracts/request", requestData);
    return data;
  },
  acceptContract: async (id: string) => {
    const { data } = await api.patch(`/contracts/${id}/accept`);
    return data;
  },
  rejectContract: async (id: string, reason: string) => {
    const { data } = await api.patch(`/contracts/${id}/reject`, { reason });
    return data;
  },
  cancelContract: async (id: string, reason: string) => {
    const { data } = await api.patch(`/contracts/${id}/cancel`, { reason });
    return data;
  },
  getEarnings: async () => {
    const { data } = await api.get("/contracts/pt/earnings");
    return data;
  },

  // Existing methods
  getByPT: async (status?: string) => {
    const params = status ? `?status=${status}` : "";
    const { data } = await api.get(`/contracts/pt${params}`);
    return data;
  },
  getByClient: async (status?: string) => {
    const params = status ? `?status=${status}` : "";
    const { data } = await api.get(`/contracts/client${params}`);
    return data;
  },
  getById: async (id: string) => {
    const { data } = await api.get(`/contracts/${id}`);
    return data;
  },
  create: async (contractData: any) => {
    const { data } = await api.post("/contracts", contractData);
    return data;
  },
  updateStatus: async (id: string, status: string) => {
    const { data } = await api.patch(`/contracts/${id}/status`, { status });
    return data;
  },
  update: async (id: string, contractData: any) => {
    const { data } = await api.put(`/contracts/${id}`, contractData);
    return data;
  },
  logSession: async (id: string) => {
    const { data } = await api.post(`/contracts/${id}/session`);
    return data;
  },

  // E-sign endpoints
  getESignStatus: async (contractId: string) => {
    const { data } = await api.get(`/contracts/${contractId}/esign`);
    return data;
  },
  resendESign: async (contractId: string) => {
    const { data } = await api.post(`/contracts/${contractId}/esign/send`);
    return data;
  },
  getPdfUrl: (contractId: string) => `${API_URL}/contracts/${contractId}/pdf`,
  // Phase 4 — pay a PENDING_PAYMENT contract via wallet
  pay: async (contractId: string) => {
    const { data } = await api.post(`/contracts/${contractId}/pay`);
    return data;
  },
};

export const sessionService = {
  bookSession: async (
    contractId: string,
    sessionData: {
      scheduledDate: string;
      scheduledTime: string;
      durationMin?: number;
      sessionMode?: string;
      location?: string;
      notes?: string;
    },
  ) => {
    const { data } = await api.post("/sessions", {
      contractId,
      ...sessionData,
    });
    return data;
  },
  getContractSessions: async (contractId: string) => {
    const { data } = await api.get(`/sessions/contract/${contractId}`);
    return data;
  },
  getMyUpcoming: async () => {
    const { data } = await api.get("/sessions/upcoming");
    return data;
  },
  confirmSession: async (id: string) => {
    const { data } = await api.patch(`/sessions/${id}/confirm`);
    return data;
  },
  completeSession: async (id: string, ptNotes?: string) => {
    const { data } = await api.patch(`/sessions/${id}/complete`, { ptNotes });
    return data;
  },
  cancelSession: async (id: string, reason: string) => {
    const { data } = await api.patch(`/sessions/${id}/cancel`, { reason });
    return data;
  },
  markNoShow: async (id: string, noShowBy: "CLIENT" | "PT") => {
    const { data } = await api.patch(`/sessions/${id}/no-show`, { noShowBy });
    return data;
  },
  reviewSession: async (id: string, rating: number, comment?: string) => {
    const { data } = await api.post(`/sessions/${id}/review`, {
      rating,
      comment,
    });
    return data;
  },
  joinSession: async (id: string) => {
    const { data } = await api.post(`/sessions/${id}/join`);
    return data as {
      sessionId: string;
      otherUserId: string;
      sessionMode: string;
      status: string;
      scheduledStartAt: string;
      scheduledEndAt: string;
      joinToken: string;
    };
  },
};

export const availabilityService = {
  getAvailability: async (ptUserId: string) => {
    const { data } = await api.get(`/availability/${ptUserId}`);
    return data;
  },
  setAvailability: async (
    slots: Array<{
      dayOfWeek: string;
      startTime: string;
      endTime: string;
    }>,
  ) => {
    const { data } = await api.put("/availability/me", { slots });
    return data;
  },
  getExceptions: async () => {
    const { data } = await api.get("/availability/me/exceptions");
    return data;
  },
  addException: async (date: string, reason?: string) => {
    const { data } = await api.post("/availability/me/exceptions", {
      date,
      reason,
    });
    return data;
  },
  removeException: async (id: string) => {
    const { data } = await api.delete(`/availability/me/exceptions/${id}`);
    return data;
  },
  getAvailableSlots: async (ptUserId: string, date: string) => {
    const { data } = await api.get(
      `/availability/${ptUserId}/slots?date=${date}`,
    );
    return data;
  },
};

export const notificationService = {
  list: async (page = 1, limit = 20) => {
    const { data } = await api.get(
      `/notifications?page=${page}&limit=${limit}`,
    );
    return data;
  },
  markRead: async (id: string) => {
    const { data } = await api.patch(`/notifications/${id}/read`);
    return data;
  },
  markAllRead: async () => {
    const { data } = await api.patch("/notifications/read-all");
    return data;
  },
  getUnreadCount: async () => {
    const { data } = await api.get("/notifications/unread-count");
    return data;
  },
};

export const ptPlanReviewService = {
  getPendingReviews: async () => {
    const { data } = await api.get("/plans/pt/pending-review");
    return data?.data?.plans ?? [];
  },
  submitReview: async (
    planId: string,
    body: { action: "APPROVE" | "REJECT"; note?: string },
  ) => {
    const { data } = await api.post(`/plans/${planId}/pt-review`, body);
    return data;
  },
};

export const locationService = {
  getProvinces: async () => {
    const { data } = await api.get("/locations/provinces");
    return data as {
      code: number;
      name: string;
      codename?: string;
      divisionType?: string;
    }[];
  },
  getWards: async (provinceCode: number) => {
    const { data } = await api.get(
      `/locations/provinces/${provinceCode}/wards`,
    );
    return data as { code: number; name: string; codename?: string }[];
  },
};

export const trainingLocationService = {
  getMyLocations: async () => {
    const { data } = await api.get("/pt/training-locations/me");
    return data as {
      id: string;
      provinceCode: number;
      wardCode?: number;
      gymName?: string;
      addressLine?: string;
      legacyDistrictName?: string;
      isPrimary: boolean;
      isActive: boolean;
      note?: string;
      province: { name: string };
      ward?: { name: string };
    }[];
  },
  create: async (data: {
    provinceCode: number;
    wardCode?: number;
    gymName?: string;
    addressLine?: string;
    legacyDistrictName?: string;
    isPrimary?: boolean;
    note?: string;
  }) => {
    const { data: res } = await api.post("/pt/training-locations/me", data);
    return res;
  },
  update: async (id: string, data: Record<string, any>) => {
    const { data: res } = await api.patch(
      `/pt/training-locations/me/${id}`,
      data,
    );
    return res;
  },
  delete: async (id: string) => {
    const { data: res } = await api.delete(`/pt/training-locations/me/${id}`);
    return res;
  },
};

// ── Wallet (Phase 4) ─────────────────────────────────────────────────
export const walletService = {
  // Always the CLIENT (buyer) wallet, regardless of the user's other roles.
  getWallet: async () => {
    const { data } = await api.get('/me/wallet');
    return data?.data ?? data;
  },
  getTransactions: async () => {
    const { data } = await api.get('/me/wallet/transactions');
    return data?.data ?? data;
  },
  topup: async (amount: number, clientRequestId: string, provider?: string) => {
    const { data } = await api.post('/me/wallet/topup', {
      amount,
      clientRequestId,
      ...(provider && provider !== 'MOCK' ? { provider } : {}),
    });
    return data?.data ?? data;
  },
  // Actively asks the gateway (VNPay querydr, ...) for the transaction status — the
  // ONLY signal the UI may trust for "payment succeeded" (never the return-URL query).
  syncTopup: async (transactionId: string) => {
    const { data } = await api.post(`/me/wallet/topup/${transactionId}/sync`);
    return data?.data ?? data;
  },
  // Always the PT earnings wallet.
  getPtWallet: async () => {
    const { data } = await api.get('/me/pt-wallet');
    return data?.data ?? data;
  },
  getPtTransactions: async () => {
    const { data } = await api.get('/me/pt-wallet/transactions');
    return data?.data ?? data;
  },
};

// ── Gym marketplace (Phase 4) ────────────────────────────────────────
export const gymService = {
  // Public
  listGyms: async () => {
    const { data } = await api.get('/gyms');
    return data?.data ?? data;
  },
  getGym: async (gymId: string) => {
    const { data } = await api.get(`/gyms/${gymId}`);
    return data?.data ?? data;
  },
  listPlans: async (gymId: string) => {
    const { data } = await api.get(`/gyms/${gymId}/plans`);
    return data?.data ?? data;
  },
  listTrainers: async (gymId: string) => {
    const { data } = await api.get(`/gyms/${gymId}/trainers`);
    return data?.data ?? data;
  },
  // Client
  buyMembership: async (gymId: string, planId: string) => {
    const { data } = await api.post(`/gyms/${gymId}/memberships`, { planId });
    return data;
  },
  payMembership: async (membershipId: string) => {
    const { data } = await api.post(`/me/gym-memberships/${membershipId}/pay`);
    return data?.data ?? data;
  },
  cancelMembership: async (membershipId: string) => {
    const { data } = await api.post(`/me/gym-memberships/${membershipId}/cancel`);
    return data?.data ?? data;
  },
  listMyMemberships: async () => {
    const { data } = await api.get('/me/gym-memberships');
    return data?.data ?? data;
  },
  // Gym owner
  listOwnedGyms: async () => {
    const { data } = await api.get('/owner/gyms');
    return data?.data ?? data;
  },
  createGym: async (payload: { name: string; description?: string; address: string; city?: string; phone?: string; email?: string }) => {
    const { data } = await api.post('/owner/gyms', payload);
    return data?.data ?? data;
  },
  getOwnedGym: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}`);
    return data?.data ?? data;
  },
  getOwnedWallet: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/wallet`);
    return data?.data ?? data;
  },
  createPlan: async (gymId: string, payload: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number }) => {
    const { data } = await api.post(`/owner/gyms/${gymId}/plans`, payload);
    return data?.data ?? data;
  },
  listOwnedPlans: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/plans`);
    return data?.data ?? data;
  },
  listOwnedMemberships: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/memberships`);
    return data?.data ?? data;
  },
};

export default api;
