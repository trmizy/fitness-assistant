export interface PlanExplanationResponse {
  planId: string;
  explanation: string;
  source: "llm" | "fallback";
  warnings: string[];
}
import axios from "axios";
import { Preferences } from "@capacitor/preferences";
import { makeRefreshOnce } from "./refresh-once";
import { apiBaseUrl } from "../config/serverUrl";

// Defaults to a same-origin relative path, proxied by Vite's dev server to
// the gateway (see vite.config.ts's "/api" proxy rule) — this is what makes
// the app work identically whether opened at http://localhost:5173 or
// through a Dev Tunnel/port-forwarded HTTPS URL, with no CORS or
// mixed-content issues, since the browser never makes a cross-origin
// request. Set VITE_API_URL to an absolute URL only when the frontend must
// reach a backend that ISN'T proxied same-origin (e.g. a production static
// build served without an API-proxying reverse proxy in front of it).
// Resolved once at module load: a stored override (in-app "Cấu hình máy chủ", used by
// the Capacitor APK behind a tunnel) wins over VITE_API_URL, which wins over the
// same-origin "/api" default. Saving a new address reloads the app so this re-runs.
export const API_URL = apiBaseUrl();

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

async function clearSessionAndRedirectToLogin() {
  await Preferences.remove({ key: "accessToken" });
  await Preferences.remove({ key: "refreshToken" });
  await Preferences.remove({ key: "user" });
  if (
    window.location.pathname !== "/login" &&
    window.location.pathname !== "/register"
  ) {
    window.location.href = "/login";
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const { value: refreshToken } = await Preferences.get({ key: "refreshToken" });
  if (!hasUsableToken(refreshToken)) return null;

  try {
    const { data } = await refreshClient.post("/auth/refresh", {
      refreshToken,
    });
    if (hasUsableToken(data?.accessToken)) {
      await Preferences.set({ key: "accessToken", value: data.accessToken });
      if (hasUsableToken(data?.refreshToken)) {
        await Preferences.set({ key: "refreshToken", value: data.refreshToken });
      }
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.request.use(async (config) => {
  const { value: token } = await Preferences.get({ key: "accessToken" });
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
      await Preferences.set({ key: "accessToken", value: data.accessToken });
      await Preferences.set({ key: "refreshToken", value: data.refreshToken });
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
      await Preferences.set({ key: "accessToken", value: data.accessToken });
      await Preferences.set({ key: "refreshToken", value: data.refreshToken });
      await Preferences.set({ key: "user", value: JSON.stringify(data.user) });
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  logout: async () => {
    // Only clear session keys — keep theme, language and other non-session preferences.
    await Preferences.remove({ key: "accessToken" });
    await Preferences.remove({ key: "refreshToken" });
    await Preferences.remove({ key: "user" });
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

  listPTs: async (params?: Record<string, any>) => {
    const { data } = await api.get("/profile/pts", { params });
    return data;
  },
};

// Gym-onboarding project — normalized equipment catalog + per-user
// equipment (fitness-service, proxied through the gateway at /equipment).
export interface EquipmentCatalogItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  description: string | null;
}

export const equipmentService = {
  getCatalog: async (): Promise<EquipmentCatalogItem[]> => {
    const { data } = await api.get("/equipment");
    return data.equipment;
  },

  getMyEquipment: async (): Promise<string[]> => {
    const { data } = await api.get("/equipment/me");
    return data.equipmentIds;
  },

  setMyEquipment: async (equipmentIds: string[]): Promise<string[]> => {
    const { data } = await api.put("/equipment/me", { equipmentIds });
    return data.equipmentIds;
  },
};

// Gym-onboarding project follow-up — "Swap exercise" (session-only, never
// rewrites the underlying plan). Ranked by movementPattern/muscle overlap/
// mechanics/equipment availability — see exercise-substitution.service.ts.
export interface ExerciseSubstitute {
  id: string;
  exerciseName: string;
  bodyPart: string;
  movementPattern: string | null;
  mechanics: string | null;
  muscleGroupsActivated: string[];
  score: number;
  reason: string;
}

export const exerciseService = {
  getSubstitutes: async (
    exerciseId: string,
    options?: { excludeExerciseIds?: string[]; limit?: number },
  ): Promise<ExerciseSubstitute[]> => {
    const params = new URLSearchParams();
    if (options?.excludeExerciseIds?.length) params.set("exclude", options.excludeExerciseIds.join(","));
    if (options?.limit) params.set("limit", String(options.limit));
    const { data } = await api.get(
      `/exercises/${exerciseId}/substitute${params.toString() ? `?${params.toString()}` : ""}`,
    );
    return data.substitutes ?? [];
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

export interface WorkoutSessionPr {
  exerciseId: string;
  exerciseName: string;
  // "WEIGHT_E1RM" (existing) — weighted exercises, beaten by estimated 1RM.
  // "REPS" (new) — bodyweight exercises (no added load), beaten by rep count
  // alone since there's no weight to compute an e1RM from. Older API
  // responses (pre-migration) omit this field entirely — treat missing as
  // "WEIGHT_E1RM" for backward compatibility.
  prType?: "WEIGHT_E1RM" | "REPS";
  weightKg: number | null;
  reps: number | null;
  estimated1RmKg: number | null;
  previousBestWeightKg: number | null;
  previousBestEstimated1RmKg: number | null;
  previousBestReps?: number | null;
}

export interface WorkoutSessionSummary {
  workoutId: string;
  exerciseCount: number;
  totalSets: number;
  totalVolumeKg: number;
  prs: WorkoutSessionPr[];
}

export interface PreviousPerformanceSet {
  setNumber: number;
  weightKg: number | null;
  bodyWeightAtSetKg?: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  setType: string | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

export interface PreviousPerformance {
  exerciseId: string;
  hasHistory: boolean;
  date: string | null;
  sets: PreviousPerformanceSet[];
}

export type ExerciseProgressionStatus =
  | "KEEP"
  | "INCREASE_LOAD"
  | "INCREASE_REPS"
  | "INCREASE_SETS"
  | "DELOAD"
  | "REVIEW"
  | "INSUFFICIENT_DATA";

export interface ExerciseProgression {
  exerciseId: string;
  status: ExerciseProgressionStatus;
  policyUsed: string | null;
  currentPerformance: {
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceMeters: number | null;
    setCount: number;
  } | null;
  nextTarget: { weightKg: number | null; reps: number | null; durationSeconds: number | null } | null;
  loadChangeKg: number | null;
  repChange: number | null;
  reasonCodes: string[];
  cycleContext: string;
  dataQuality: "SUFFICIENT" | "LOW_SAMPLE" | "NONE";
}

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

  // Gate 6 (exercise/anatomy data-expansion roadmap) — canonical muscle
  // taxonomy (29 entries) for the muscle-map legend, and the real
  // per-exercise primary/secondary mapping. Both unwrapped, matching
  // getExercise's existing single-resource convention (list endpoints
  // wrap in {success,data}, single-resource ones don't — an existing,
  // real inconsistency in the backend, not introduced here).
  getMuscleTaxonomy: async (): Promise<
    Array<{ code: string; nameVi: string; nameEn: string | null; anatomyRegion: string | null }>
  > => {
    const { data } = await api.get("/exercises/muscles");
    return data?.muscles ?? [];
  },

  getExerciseMuscleMap: async (
    exerciseId: string,
  ): Promise<{
    exerciseId: string;
    exerciseName: string;
    mapped: boolean;
    primary: Array<{ code: string; nameVi: string; nameEn: string | null; anatomyRegion: string | null }>;
    secondary: Array<{ code: string; nameVi: string; nameEn: string | null; anatomyRegion: string | null }>;
  }> => {
    const { data } = await api.get(`/exercises/${exerciseId}/muscle-map`);
    return data;
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

  getSessionSummary: async (workoutId: string): Promise<WorkoutSessionSummary> => {
    const { data } = await api.get(`/workouts/${workoutId}/summary`);
    return data;
  },

  // "Previous performance" reference context (docs/TRAINING_PROGRESSION_ARCHITECTURE.md
  // §3, gap analysis P0 #1) — what the user actually logged last time for
  // this exercise, per set. Never a recommendation — display only.
  getPreviousPerformance: async (
    exerciseId: string,
    excludeWorkoutId?: string,
  ): Promise<PreviousPerformance> => {
    const qs = excludeWorkoutId ? `?excludeWorkoutId=${excludeWorkoutId}` : "";
    const { data } = await api.get(
      `/workouts/exercises/${exerciseId}/previous-performance${qs}`,
    );
    return data;
  },

  // Deterministic per-exercise progression (docs/TRAINING_PROGRESSION_ARCHITECTURE.md).
  // The engine's committed decision — never something the UI/AI may override.
  getExerciseProgression: async (
    exerciseId: string,
    excludeWorkoutId?: string,
  ): Promise<ExerciseProgression> => {
    const qs = excludeWorkoutId ? `?excludeWorkoutId=${excludeWorkoutId}` : "";
    const { data } = await api.get(
      `/workouts/exercises/${exerciseId}/progression${qs}`,
    );
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

  skipSchedule: async (id: string, notes?: string) => {
    const { data } = await api.post(`/workouts/schedules/${id}/skip`, notes ? { notes } : {});
    return data?.data ?? data;
  },

  cancelSchedule: async (id: string, reason: string) => {
    const { data } = await api.post(`/workouts/schedules/${id}/cancel`, { reason });
    return data?.data ?? data;
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
    // Hardening pass §3 — what was ACTUALLY performed (weight/reps/RPE/RIR,
    // and a session-only exercise swap's replacement id + note). Optional
    // and backward compatible: omitting it falls back to the plan's
    // prescribed values, matching the old no-body behavior exactly.
    performed?: {
      exerciseId?: string;
      weight?: number;
      reps?: number;
      bodyWeightAtSetKg?: number;
      durationSeconds?: number;
      distanceMeters?: number;
      rpe?: number;
      rir?: number;
      notes?: string;
    },
  ): Promise<WorkoutExerciseCompletionResponse> => {
    const { data } = await api.post(
      `/workouts/schedules/${scheduleId}/exercises/${programExerciseId}/complete`,
      performed ?? {},
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
  // Phase 2 — Adaptive Nutrition Decision Engine, an independent decision
  // space/lifecycle evaluated at the same touchpoint (see
  // docs/body-state-and-adaptive-planning.md).
  nutritionDecision: "KEEP_PLAN" | "PROPOSE_ADJUSTMENT" | "REQUEST_MORE_DATA" | "EARLY_REVIEW" | "ESCALATE" | null;
  nutritionConfidence: "LOW" | "MEDIUM" | "HIGH" | null;
  nutritionSignals: Record<string, unknown> | null;
  nutritionProposedChanges: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
  nutritionReasonCodes: string[] | null;
  nutritionEvidenceIds: string[] | null;
  nutritionRequiresConfirmation: boolean;
  nutritionUserDecision: "PENDING" | "ACCEPTED" | "REJECTED";
  nutritionReviewedAt: string | null;
  appliedNutritionGoalId: string | null;
  nutritionAiHeadline: string | null;
  nutritionAiExplanation: string | null;
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

  // Phase 2 — independent from the training accept/reject above.
  acceptNutritionRecommendation: async (id: string, assessmentId?: string) => {
    const { data } = await api.post<CycleAssessment>(
      `/training-cycles/${id}/nutrition-recommendation/accept`,
      assessmentId ? { assessmentId } : {},
    );
    return data;
  },

  rejectNutritionRecommendation: async (id: string, assessmentId?: string) => {
    const { data } = await api.post<CycleAssessment>(
      `/training-cycles/${id}/nutrition-recommendation/reject`,
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

  // Phase 3 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — deterministic
  // (no-AI) aggregate stats over every session-feedback row in the cycle.
  getSessionFeedbackSummary: async (id: string) => {
    const { data } = await api.get<CycleFeedbackSummary>(`/training-cycles/${id}/session-feedback-summary`);
    return data;
  },
};

// ── Phase 2/3 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md ────────────────
// Richer session feedback addressed directly by workoutScheduleId (works for
// sessions outside a cycle too), plus the deterministic cycle-level summary.

export type SessionFeedbackDifficulty = "too_easy" | "just_right" | "too_hard";
export type SessionFeedbackEnjoyment = "low" | "medium" | "high";
export type SessionFeedbackWouldRepeat = "yes" | "no" | "unsure";
export type SessionFeedbackPerceivedProgress = "better_than_last_time" | "same" | "worse" | "unsure";
export type ExerciseFeedbackIssueType =
  | "too_heavy"
  | "too_light"
  | "too_many_sets"
  | "too_few_sets"
  | "uncomfortable"
  | "pain"
  | "boring"
  | "liked"
  | "confusing"
  | "equipment_unavailable";
export type SessionSkipReason =
  | "fatigue"
  | "pain"
  | "schedule_conflict"
  | "motivation"
  | "illness"
  | "equipment_unavailable"
  | "too_hard_previous_session"
  | "other";

export interface ExerciseFeedbackItemInput {
  exerciseId: string;
  rating?: number;
  issueType?: ExerciseFeedbackIssueType;
  note?: string;
}

export interface CompletionFeedbackInput {
  readinessScore?: number;
  sessionRpe?: number;
  painScore?: number;
  notes?: string;
  sessionRating?: number;
  difficulty?: SessionFeedbackDifficulty;
  enjoyment?: SessionFeedbackEnjoyment;
  fatigueAfterSession?: number;
  painLocation?: string;
  wouldRepeatSession?: SessionFeedbackWouldRepeat;
  perceivedProgress?: SessionFeedbackPerceivedProgress;
  exerciseFeedback?: ExerciseFeedbackItemInput[];
}

export interface SkipCancelFeedbackInput {
  skipReason: SessionSkipReason;
  notes?: string;
  shouldAdjustPlan?: boolean;
  userAvailableMakeupDay?: string;
}

export interface SessionFeedbackRecord {
  id: string;
  workoutScheduleId: string;
  cycleId: string | null;
  feedbackMissing: boolean;
  readinessScore: number | null;
  sessionRpe: number | null;
  painScore: number | null;
  notes: string | null;
  sessionRating: number | null;
  difficulty: SessionFeedbackDifficulty | null;
  enjoyment: SessionFeedbackEnjoyment | null;
  fatigueAfterSession: number | null;
  painLocation: string | null;
  wouldRepeatSession: SessionFeedbackWouldRepeat | null;
  perceivedProgress: SessionFeedbackPerceivedProgress | null;
  skipReason: SessionSkipReason | null;
  shouldAdjustPlan: boolean | null;
  userAvailableMakeupDay: string | null;
  exerciseFeedback: Array<{ exerciseId: string; rating: number | null; issueType: string | null; note: string | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface CycleFeedbackSummary {
  cycleId: string;
  totalSessions: number;
  completedSessions: number;
  partialSessions: number;
  skippedSessions: number;
  cancelledSessions: number;
  feedbackSubmittedCount: number;
  feedbackMissingCount: number;
  feedbackCompletionRate: number;
  averageSessionRating: number | null;
  averageDifficultyScore: number | null;
  averageEnjoymentScore: number | null;
  averageFatigue: number | null;
  averagePain: number | null;
  mostCommonIssues: Array<{ issueType: string; count: number }>;
  mostLikedExercises: string[];
  mostDislikedExercises: string[];
  exercisesWithPainReports: string[];
  sessionsMarkedTooHard: number;
  sessionsMarkedTooEasy: number;
  sessionsUserWouldNotRepeat: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  neutralFeedbackCount: number;
  mixedFeedbackCount: number;
  feedbackSentimentByRules: "positive" | "negative" | "neutral" | "mixed" | "insufficient_feedback";
  dataQualityScore: number;
  safetyFlags: string[];
  equipmentMismatchFlags: string[];
  adherenceRelatedComplaintFlags: string[];
  motivationOrBoredomFlags: string[];
  computedAt: string;
  updatedAt: string;
}

export const sessionFeedbackService = {
  get: async (scheduleId: string) => {
    const { data } = await api.get<{ feedback: SessionFeedbackRecord | null; feedbackMissing: boolean; sessionStatus: string }>(
      `/workouts/schedules/${scheduleId}/feedback`,
    );
    return data;
  },
  submit: async (scheduleId: string, input: CompletionFeedbackInput | SkipCancelFeedbackInput) => {
    const { data } = await api.post<SessionFeedbackRecord>(`/workouts/schedules/${scheduleId}/feedback`, input);
    return data;
  },
  update: async (scheduleId: string, input: CompletionFeedbackInput | SkipCancelFeedbackInput) => {
    const { data } = await api.patch<SessionFeedbackRecord>(`/workouts/schedules/${scheduleId}/feedback`, input);
    return data;
  },
  dismiss: async (scheduleId: string) => {
    const { data } = await api.post<SessionFeedbackRecord>(`/workouts/schedules/${scheduleId}/feedback/dismiss`, {});
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
  // Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — additive.
  version?: number;
  previousVersionId?: string | null;
  changelog?: string | null;
  improvementReason?: string | null;
  approvedBy?: string | null;
  qualityScore?: number | null;
  qualityScoreComputedAt?: string | null;
  // Phase 9 — publisher-qualification gate: true only when the publisher's
  // role (forwarded from the gateway's x-user-role header) was PT at the
  // time this version was published/republished.
  publisherIsVerifiedPt?: boolean;
  packages?: Array<{ id: string; name: string; price: number }>;
}

export interface PlanReview {
  id: string;
  publishedPlanId: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  // Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — additive.
  goalFit?: number | null;
  difficultyFit?: "too_easy" | "just_right" | "too_hard" | null;
  enjoyment?: number | null;
  clarity?: number | null;
  equipmentFit?: number | null;
  timeFit?: number | null;
  resultsPerception?: "better_than_expected" | "as_expected" | "worse_than_expected" | "too_early_to_tell" | null;
  wouldUseAgain?: boolean | null;
  complaintTags?: string[] | null;
  freeText?: string | null;
}

export const marketplaceService = {
  browse: async (params?: {
    goal?: string;
    sort?: "rating" | "recent" | "quality" | "recommended";
    daysPerWeek?: number;
    durationWeeksMax?: number;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.goal) qs.set("goal", params.goal);
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.daysPerWeek) qs.set("daysPerWeek", String(params.daysPerWeek));
    if (params?.durationWeeksMax) qs.set("durationWeeksMax", String(params.durationWeeksMax));
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
      data: PublishedPlanListing & {
        reviews: PlanReview[];
        packages: Array<{ id: string; name: string; price: number }>;
        sourcePlan: {
          duration: number;
          daysPerWeek: number;
          plan: {
            weeklySchedule?: Array<{
              day: string;
              goal?: string;
              exercises: Array<{ exerciseId: string; name: string; sets: number; reps: string; restSeconds?: number; note?: string }>;
              cardio?: string;
            }>;
          };
        };
      };
    }>(`/marketplace/plans/${id}`);
    return data.data;
  },

  submitReview: async (
    id: string,
    rating: number,
    comment?: string,
    // Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — all optional.
    dimensions?: {
      goalFit?: number;
      difficultyFit?: "too_easy" | "just_right" | "too_hard";
      enjoyment?: number;
      clarity?: number;
      equipmentFit?: number;
      timeFit?: number;
      resultsPerception?: "better_than_expected" | "as_expected" | "worse_than_expected" | "too_early_to_tell";
      wouldUseAgain?: boolean;
      complaintTags?: string[];
      freeText?: string;
    },
  ) => {
    const { data } = await api.post<{ success: boolean; data: PlanReview }>(
      `/marketplace/plans/${id}/reviews`,
      { rating, comment, ...dimensions },
    );
    return data.data;
  },

  // Phase 8 — versioning
  republish: async (id: string, input: { sourcePlanId?: string; title?: string; description?: string; changelog: string; improvementReason?: string }) => {
    const { data } = await api.post<{ success: boolean; data: PublishedPlanListing }>(`/marketplace/plans/${id}/republish`, input);
    return data.data;
  },
  getVersionHistory: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: Array<{ id: string; version: number; title: string; moderation_status: string; changelog: string | null; improvement_reason: string | null; created_at: string }> }>(
      `/marketplace/plans/${id}/versions`,
    );
    return data.data;
  },

  // Phase 8 — adopt (closes the "no adopt action" gap)
  adoptPlan: async (
    id: string,
    input: {
      startDate: string;
      repeatWeeks?: number;
      selectedWeekdays: number[];
      replaceExisting?: boolean;
      // Phase 9 — trim/adjust exercises before import instead of always
      // getting a rigid, unchangeable copy. Same day-count as the listing;
      // exerciseIds must already exist in it (trim/adjust only).
      customizedWeeklySchedule?: Array<{
        day: string;
        exercises: Array<{ exerciseId: string; name: string; sets: number; reps: string; restSeconds?: number }>;
      }>;
    },
  ) => {
    const { data } = await api.post(`/marketplace/plans/${id}/adopt`, input);
    return data;
  },

  // Phase 8 — AI improvement suggestions (advisory only, publisher-only)
  generateImprovementSuggestions: async (id: string) => {
    const { data } = await api.post<{
      success: boolean;
      data: { id: string; suggestions: string[]; commonComplaints: Array<{ tag: string; count: number }>; summary: string; basedOnReviewCount: number; qualityScoreSnapshot: number | null };
    }>(`/marketplace/plans/${id}/improvement-suggestions`, {}, { timeout: 90000 });
    return data.data;
  },
  listImprovementSuggestions: async (id: string) => {
    const { data } = await api.get<{
      success: boolean;
      data: Array<{ id: string; suggestions: string[]; commonComplaints: Array<{ tag: string; count: number }>; summary: string; generatedAt: string }>;
    }>(`/marketplace/plans/${id}/improvement-suggestions`);
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
      data: Array<
        PublishedPlanListing & {
          sourcePlan: {
            duration: number;
            daysPerWeek: number;
            plan: {
              weeklySchedule?: Array<{
                day: string;
                goal?: string;
                exercises: Array<{ name: string; sets: number; reps: string }>;
                cardio?: string;
              }>;
            };
          };
          moderationAnalyses: Array<{
            id: string;
            computedStats: Record<string, unknown>;
            ruleFlags: string[];
            similarListings: Array<{ publishedPlanId: string; title: string; similarityScore: number }>;
            aiConcerns: string[];
            aiConfidenceScore: number;
            aiRecommendation: "likely_safe" | "needs_review" | "likely_unsafe";
            explanationForAdmin: string;
            usedFallback: boolean;
          }>;
        }
      >;
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

// ── Marketplace rework — Personalized PT Service ─────────────────────────
// A different PRODUCT from TrainingPackage above (which sells a fixed plan
// unchanged to every buyer): the PT sells personalization capacity, and the
// actual plan is created per-buyer after Intake, via Draft/Revision/Accept.
export type PersonalizedServiceType =
  | "PERSONALIZED_WORKOUT"
  | "PERSONALIZED_NUTRITION"
  | "WORKOUT_AND_NUTRITION"
  | "ONLINE_COACHING";

export type PersonalizedServiceOrderStatus =
  | "PURCHASED"
  | "INTAKE_PENDING"
  | "INTAKE_SUBMITTED"
  | "PT_REVIEWING"
  | "IN_PROGRESS"
  | "DRAFT_DELIVERED"
  | "REVISION_REQUESTED"
  | "REVISION_IN_PROGRESS"
  | "ACCEPTED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUND_REQUESTED"
  | "REFUNDED"
  | "DISPUTED";

export interface PersonalizedServiceSeller {
  userId: string;
  isApprovedPt: boolean;
  isPT: boolean;
  ptApplicationStatus: string | null;
  displayName?: string | null;
  mainSpecialties?: string[];
  yearsOfExperience?: string | null;
  professionalBio?: string | null;
}

export interface PersonalizedService {
  id: string;
  sellerId: string;
  serviceType: PersonalizedServiceType;
  title: string;
  description?: string | null;
  price: number;
  deliverables: string[];
  revisionLimit: number | null;
  initialDeliveryDays: number;
  supportWeeks: number | null;
  targetGoal?: string | null;
  targetLevel?: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  seller?: PersonalizedServiceSeller | null;
}

export interface DraftDay {
  dayNumber: number;
  title: string;
  description?: string | null;
  exercises: Array<{ exerciseId: string; order?: number; sets: number; reps: number; restSeconds: number; notes?: string | null }>;
}
export interface DraftContent {
  name: string;
  goal?: string | null;
  durationWeeks: number;
  daysPerWeek: number;
  startDate: string;
  repeatWeeks?: number;
  selectedWeekdays: number[];
  replaceExisting?: boolean;
  days: DraftDay[];
}

export interface PersonalizedServiceOrder {
  id: string;
  serviceId: string;
  sellerId: string;
  buyerId: string;
  status: PersonalizedServiceOrderStatus;
  titleSnapshot: string;
  descriptionSnapshot?: string | null;
  serviceTypeSnapshot: PersonalizedServiceType;
  deliverablesSnapshot: string[];
  revisionLimitSnapshot: number | null;
  initialDeliveryDaysSnapshot: number;
  supportWeeksSnapshot: number | null;
  priceAtPurchase: number;
  purchasedAt: string;
  intakeData?: Record<string, unknown> | null;
  consentCategories?: string[] | null;
  intakeSubmittedAt?: string | null;
  contractId?: string | null;
  initialDeliveryDeadline?: string | null;
  draftContent?: DraftContent | null;
  draftVersion: number;
  revisionCount: number;
  acceptedAt?: string | null;
  committedProgramId?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  refundRequestedAt?: string | null;
  disputeReason?: string | null;
  cumulativeRefundedAmount?: number;
  refundDecision?: string | null;
  refundResolutionNote?: string | null;
  revisionRequests?: Array<{ id: string; category: string; comment: string; createdAt: string }>;
}

export interface PersonalizedServicePlanVersion {
  id: string;
  orderId: string;
  version: number;
  content: DraftContent;
  status: "DELIVERED" | "ACCEPTED" | "SUPERSEDED";
  createdBy: string;
  changeReason?: string | null;
  createdAt: string;
}

export interface PersonalizedServiceCheckIn {
  id: string;
  orderId: string;
  buyerId: string;
  weekNumber?: number | null;
  weight?: number | null;
  energyLevel?: number | null;
  sleepQuality?: number | null;
  stressLevel?: number | null;
  overallRpe?: number | null;
  workoutAdherence?: number | null;
  nutritionAdherence?: number | null;
  painOrDiscomfort?: number | null;
  notes?: string | null;
  requiresAttention: boolean;
  createdAt: string;
}

export interface PersonalizedServiceReview {
  id: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  overallRating: number;
  communicationRating?: number | null;
  personalizationRating?: number | null;
  planQualityRating?: number | null;
  comment?: string | null;
  createdAt: string;
}

export interface RefundCalculation {
  orderId: string;
  status: string;
  totalPaid: number;
  alreadyRefunded: number;
  refundableCeiling: number;
  milestones: { intakeSubmitted: boolean; draftDelivered: boolean; latestVersionStatus: string | null; accepted: boolean };
  disputeReason?: string | null;
}

export const CONSENT_CATEGORY_LABELS: Record<string, string> = {
  basic_info: "Thông tin cơ bản",
  training_goals: "Mục tiêu tập luyện",
  experience: "Trình độ",
  equipment: "Thiết bị",
  injuries_limitations: "Chấn thương/hạn chế",
  workout_history: "Lịch sử tập luyện",
  inbody: "InBody",
  training_cycle: "Chu kỳ tập luyện",
  session_feedback: "Phản hồi buổi tập",
  nutrition_preferences: "Sở thích dinh dưỡng",
};

export const personalizedServiceApi = {
  create: async (input: {
    serviceType: PersonalizedServiceType;
    title: string;
    description?: string;
    price: number;
    deliverables: string[];
    revisionLimit?: number | null;
    initialDeliveryDays: number;
    supportWeeks?: number | null;
    targetGoal?: string;
    targetLevel?: string;
  }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedService }>("/marketplace/services", input);
    return data.data;
  },
  listMine: async () => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedService[] }>("/marketplace/services/mine");
    return data.data;
  },
  archive: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedService }>(`/marketplace/services/${id}/archive`);
    return data.data;
  },
  browse: async (params?: { serviceType?: string; goal?: string; level?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.serviceType) qs.set("serviceType", params.serviceType);
    if (params?.goal) qs.set("goal", params.goal);
    if (params?.level) qs.set("level", params.level);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const { data } = await api.get<{
      success: boolean;
      data: { items: PersonalizedService[]; total: number; page: number; limit: number };
    }>(`/marketplace/services?${qs.toString()}`);
    return data.data;
  },
  getDetail: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedService }>(`/marketplace/services/${id}`);
    return data.data;
  },
  purchase: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/services/${id}/purchase`);
    return data.data;
  },
  listMyOrders: async () => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServiceOrder[] }>("/marketplace/orders/mine");
    return data.data;
  },
  listOrdersForSeller: async () => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServiceOrder[] }>("/marketplace/orders/selling");
    return data.data;
  },
  getOrder: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}`);
    return data.data;
  },
  submitIntake: async (id: string, input: { intakeData: Record<string, unknown>; consentCategories: string[] }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/intake`, input);
    return data.data;
  },
  startReview: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/start-review`);
    return data.data;
  },
  deliverDraft: async (id: string, draft: DraftContent) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/draft`, draft);
    return data.data;
  },
  requestRevision: async (id: string, input: { category: string; comment: string }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/revision`, input);
    return data.data;
  },
  startRevisionWork: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/start-revision`);
    return data.data;
  },
  accept: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/accept`);
    return data.data;
  },
  complete: async (id: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/complete`);
    return data.data;
  },
  cancel: async (id: string, reason?: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/cancel`, { reason });
    return data.data;
  },
  requestRefund: async (id: string, reason: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/refund-request`, { reason });
    return data.data;
  },
  openDispute: async (id: string, reason: string) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/dispute`, { reason });
    return data.data;
  },

  // ── Plan version history ─────────────────────────────────────────────────
  listVersions: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServicePlanVersion[] }>(`/marketplace/orders/${id}/versions`);
    return data.data;
  },

  // ── Weekly check-in ───────────────────────────────────────────────────────
  submitCheckIn: async (id: string, input: {
    weekNumber?: number; weight?: number; energyLevel?: number; sleepQuality?: number; stressLevel?: number;
    overallRpe?: number; workoutAdherence?: number; nutritionAdherence?: number; painOrDiscomfort?: number; notes?: string;
  }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceCheckIn }>(`/marketplace/orders/${id}/checkin`, input);
    return data.data;
  },
  listCheckIns: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServiceCheckIn[] }>(`/marketplace/orders/${id}/checkins`);
    return data.data;
  },

  // ── Review ────────────────────────────────────────────────────────────────
  submitReview: async (id: string, input: {
    overallRating: number; communicationRating?: number; personalizationRating?: number; planQualityRating?: number; comment?: string;
  }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceReview }>(`/marketplace/orders/${id}/review`, input);
    return data.data;
  },
  getSellerReviewSummary: async (sellerId: string) => {
    const { data } = await api.get<{ success: boolean; data: { averageRating: number; reviewCount: number; recentReviews: PersonalizedServiceReview[] } }>(
      `/marketplace/services/seller/${sellerId}/reviews`,
    );
    return data.data;
  },

  // ── Admin refund resolution ──────────────────────────────────────────────
  listRefundRequests: async () => {
    const { data } = await api.get<{ success: boolean; data: PersonalizedServiceOrder[] }>("/marketplace/orders/refund-requests");
    return data.data;
  },
  getRefundCalculation: async (id: string) => {
    const { data } = await api.get<{ success: boolean; data: RefundCalculation }>(`/marketplace/orders/${id}/refund-calculation`);
    return data.data;
  },
  adminResolveRefund: async (id: string, input: { decision: "APPROVE" | "DENY"; refundAmount?: number; note: string }) => {
    const { data } = await api.post<{ success: boolean; data: PersonalizedServiceOrder }>(`/marketplace/orders/${id}/refund-resolve`, input);
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
    typeOfEquipment?: string;
    type?: string;
    loggingMode?: string;
    muscleGroupsActivated?: string[];
    videoUrl?: string | null;
    instructions?: string | null;
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
    notes?: string;
    weightKg?: number;
    heightCm?: number;
    age?: number;
    gender?: string;
    bodyFatPct?: number;
    activityLevel?: string;
    trainingDaysPerWeek?: number;
    trainingDurationMin?: number;
    trainingType?: string;
    trainingPhase?: string;
    experienceLevel?: string;
    primaryPriority?: string;
    weightChangeRateKgPerWeek?: number;
    proteinTargetG?: number;
    carbTargetG?: number;
    fatTargetG?: number;
    carbsAroundWorkout?: boolean;
    preworkoutMeal?: boolean;
    postworkoutMeal?: boolean;
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

        const { value: accessToken } = await Preferences.get({ key: "accessToken" });
        let response = await sendStreamRequest(accessToken);

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

// Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
// câu 6) — mirrors backend's GoalPlanConsistencyResult
// (nutrition-goal-plan-consistency.service.ts).
export interface NutritionGoalPlanConsistency {
  status:
    | "NO_ACTIVE_GOAL"
    | "NO_ACTIVE_PROGRAM"
    | "MATCHED"
    | "STALE_GOAL_CHANGED"
    | "MACRO_MISMATCH"
    | "LOW_CONFIDENCE";
  activeGoal: {
    id: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    goalMode: string;
  } | null;
  activeProgram: {
    id: string;
    name: string;
    dailyCaloriesTarget: number | null;
    proteinTargetGrams: number | null;
    carbTargetGrams: number | null;
    fatTargetGrams: number | null;
  } | null;
  mismatches: Array<{
    field: "calories" | "protein" | "carbs" | "fat";
    planValue: number;
    goalValue: number;
    diff: number;
  }>;
  recommendedAction: string;
}

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
      goalMode?: "RECOMMENDED" | "CUSTOM";
    };
  },
  upsertGoal: async (goal: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    waterMl?: number;
    goalMode?: "RECOMMENDED" | "CUSTOM";
  }) => {
    // Response shape changed to { goal, planConsistency } — planConsistency
    // lets the UI immediately show a "your plan may no longer match" banner
    // right after saving, instead of only finding out on next page load.
    const { data } = await api.put("/nutrition/goals", goal);
    return data as { goal: any; planConsistency: NutritionGoalPlanConsistency };
  },
  // Phase 2 — minimal version-history view (Current/Previous/Changed
  // date/Reason). newest-first; the ACTIVE row is history[0].
  getGoalHistory: async () => {
    const { data } = await api.get("/nutrition/goals/history");
    return (data?.history ?? []) as Array<{
      id: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      status: "ACTIVE" | "SUPERSEDED";
      validFrom: string;
      triggeredBy: string | null;
      reason: string | null;
      goalMode?: "RECOMMENDED" | "CUSTOM";
    }>;
  },
  // Goal <-> Plan sync gap (docs/audit/nutrition-ai-current-flow-audit.md,
  // câu 6) — read-only, never archives/regenerates anything.
  getActiveState: async () => {
    const { data } = await api.get("/nutrition/active-state");
    return data as NutritionGoalPlanConsistency;
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

export const ptServicePackageService = {
  getPackagesForPT: async (ptUserId: string) => {
    // Backend responds { packages: [...] } — the caller (PTDiscoveryPage) has always
    // expected a bare array (`packagesData?.length`, `packagesData.map(...)`), so every
    // PT's package list silently rendered as empty ("Liên hệ huấn luyện viên để biết chi
    // tiết giá.") regardless of how many real packages existed. Real bug, found live
    // while testing the PT-hiring flow — unwrap here to match what callers actually use.
    const { data } = await api.get(`/profile/pts/${ptUserId}/service-packages`);
    return data.packages ?? [];
  },
};

export const contractService = {
  // New contract request flow
  requestContract: async (requestData: {
    ptUserId: string;
    packageId: string;
    clientMessage?: string;
    gymId?: string;
    acknowledgedLowAvailability?: boolean;
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
  // Starts a gateway checkout; the response carries a redirectUrl, not a settled payment.
  pay: async (contractId: string, provider?: string) => {
    const { data } = await api.post(`/contracts/${contractId}/pay`, provider ? { provider } : {});
    return data;
  },
};

// Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — PT/coach access to
// a client's fitness data + plan assignment, built on the existing Contract
// relationship (routed through the gateway's /coach -> fitness-service).
export interface CoachClientSummary {
  activeCycle: TrainingCycle | null;
  cycleSummary: CycleSummary | null;
  feedbackSummary: CycleFeedbackSummary | null;
  priorDecisions: CycleDecision[];
}

// Named ptCoachService (not coachService) — that name is already taken by
// the unrelated AI Coach chat service above.
export const ptCoachService = {
  getClientSummary: async (clientId: string) => {
    const { data } = await api.get<CoachClientSummary>(`/coach/clients/${clientId}/summary`);
    return data;
  },
  createAndAssignPlan: async (
    clientId: string,
    input: {
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
        exercises: Array<{ exerciseId: string; order?: number; sets?: number; reps?: number; restSeconds?: number; notes?: string | null }>;
      }>;
    },
  ) => {
    const { data } = await api.post(`/coach/clients/${clientId}/plans`, input);
    return data;
  },
  // Phase 7 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — AI draft only;
  // never assigns anything. The PT reviews/edits the returned days before
  // (optionally) submitting them via createAndAssignPlan above.
  generatePlanDraft: async (
    clientId: string,
    input: { ptNotes?: string; daysPerWeek: number; durationWeeks: number },
  ) => {
    const { data } = await api.post<{
      days: Array<{
        dayNumber: number;
        title: string;
        exercises: Array<{ exerciseId: string; exerciseName: string; order: number; sets: number; reps: number; note?: string }>;
      }>;
      dataGaps: string[];
      warnings: string[];
      summaryForPt: string;
    }>(`/coach/clients/${clientId}/plan-draft`, input, { timeout: 90000 });
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
  requestReschedule: async (id: string, proposedStartAt: string, proposedEndAt: string, reason: string) => {
    const { data } = await api.post(`/sessions/${id}/reschedule`, {
      proposedStartAt,
      proposedEndAt,
      reason,
    });
    return data;
  },
  respondToReschedule: async (requestId: string, action: "ACCEPT" | "REJECT", responseNote?: string) => {
    const { data } = await api.post(`/sessions/reschedules/${requestId}/respond`, {
      action,
      responseNote,
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
export const paymentService = {
  /**
   * Which gateways this deployment can actually take money through. Server-decided: the set
   * depends on which credentials are configured, so the UI must not carry its own list.
   */
  getMethods: async () => {
    const { data } = await api.get('/me/payments/methods');
    return data?.data ?? data;
  },
};

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
      ...(provider ? { provider } : {}),
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
/**
 * PT ↔ gym revenue-share partnerships.
 *
 * The two sides hit different paths for the same actions — gym-service mounts the owner
 * router under /owner — because the actor is derived from the route rather than taken from
 * the request body. Taking it from the body would let a caller claim to be the other party.
 */
export const collaborationService = {
  /** Gyms this PT has an accepted partnership with — the client's gym picker reads this. */
  listGymsForPt: async (ptUserId: string) => {
    const { data } = await api.get(`/pt/${ptUserId}/gyms`);
    return data?.data ?? data;
  },

  listMine: async () => {
    const { data } = await api.get('/me/collaborations');
    return data?.data ?? data;
  },

  listForOwner: async () => {
    const { data } = await api.get('/owner/collaborations');
    return data?.data ?? data;
  },

  proposeAsPt: async (gymId: string, body: { ptRate: string; gymRate: string; platformRate?: string; note?: string }) => {
    const { data } = await api.post(`/gyms/${gymId}/collaborations`, body);
    return data?.data ?? data;
  },

  proposeAsGym: async (gymId: string, body: { ptUserId: string; ptRate: string; gymRate: string; platformRate?: string; note?: string }) => {
    const { data } = await api.post(`/owner/gyms/${gymId}/collaborations`, body);
    return data?.data ?? data;
  },

  respond: async (
    id: string,
    as: 'PT' | 'GYM',
    body: { action: 'ACCEPT' | 'REJECT' | 'COUNTER'; ptRate?: string; gymRate?: string; platformRate?: string; note?: string },
  ) => {
    const path = as === 'GYM' ? `/owner/collaborations/${id}` : `/collaborations/${id}`;
    const { data } = await api.patch(path, body);
    return data?.data ?? data;
  },

  terminate: async (id: string, as: 'PT' | 'GYM') => {
    const path = as === 'GYM' ? `/owner/collaborations/${id}` : `/collaborations/${id}`;
    const { data } = await api.delete(path);
    return data?.data ?? data;
  },
};

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
  buyMembership: async (gymId: string, planId: string, provider?: string) => {
    const { data } = await api.post(`/gyms/${gymId}/memberships`, {
      planId,
      ...(provider ? { provider } : {}),
    });
    return data;
  },
  // Starts a gateway checkout; the response carries a redirectUrl, not a settled payment.
  payMembership: async (membershipId: string, provider?: string) => {
    const { data } = await api.post(
      `/me/gym-memberships/${membershipId}/pay`,
      provider ? { provider } : {},
    );
    return data?.data ?? data;
  },
  cancelMembership: async (membershipId: string) => {
    const { data } = await api.post(`/me/gym-memberships/${membershipId}/cancel`);
    return data?.data ?? data;
  },
  // Cancel an ACTIVE membership → prorated refund (unused days) to the client wallet.
  refundMembership: async (membershipId: string) => {
    const { data } = await api.post(`/me/gym-memberships/${membershipId}/refund`);
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
  createGym: async (payload: { name: string; description?: string; address: string; city?: string; phone?: string; email?: string; brandId?: string }) => {
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
  createPlan: async (
    gymId: string,
    payload: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number; saleStartAt?: string; saleEndAt?: string },
  ) => {
    const { data } = await api.post(`/owner/gyms/${gymId}/plans`, payload);
    return data?.data ?? data;
  },
  updatePlan: async (
    gymId: string,
    planId: string,
    payload: Partial<{ name: string; description: string; price: number; durationDays: number; visitLimit: number; status: 'ACTIVE' | 'INACTIVE'; saleStartAt: string | null; saleEndAt: string | null }>,
  ) => {
    const { data } = await api.patch(`/owner/gyms/${gymId}/plans/${planId}`, payload);
    return data?.data ?? data;
  },
  listOwnedPlans: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/plans`);
    return data?.data ?? data;
  },

  // ── Brands (chains) ──────────────────────────────────────────────────
  createBrand: async (payload: { name: string; description?: string }) => {
    const { data } = await api.post('/owner/brands', payload);
    return data?.data ?? data;
  },
  listOwnedBrands: async () => {
    const { data } = await api.get('/owner/brands');
    return data?.data ?? data;
  },
  getOwnedBrand: async (brandId: string) => {
    const { data } = await api.get(`/owner/brands/${brandId}`);
    return data?.data ?? data;
  },
  updateBrand: async (brandId: string, payload: Partial<{ name: string; description: string }>) => {
    const { data } = await api.patch(`/owner/brands/${brandId}`, payload);
    return data?.data ?? data;
  },
  listOwnedMemberships: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/memberships`);
    return data?.data ?? data;
  },

  // ── Check-in (Phase 4) ──────────────────────────────────────────────
  // Gym owner: the QR to display at the front desk for members to scan.
  getGymCheckinQr: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/checkin-qr`);
    return data?.data ?? data;
  },
  // Member: scanned the gym's QR — records the visit and returns what the desk verifies.
  checkInByScan: async (token: string) => {
    const { data } = await api.post(`/me/gym-checkins`, { token });
    return data?.data ?? data;
  },
  listCheckins: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/checkins`);
    return data?.data ?? data;
  },
  listMyCheckins: async () => {
    const { data } = await api.get(`/me/gym-checkins`);
    return data?.data ?? data;
  },

  // ── Reviews (Phase 4) ───────────────────────────────────────────────
  getGymReviews: async (gymId: string) => {
    const { data } = await api.get(`/gyms/${gymId}/reviews`);
    return data?.data ?? data;
  },
  submitGymReview: async (gymId: string, payload: { rating: number; comment?: string }) => {
    const { data } = await api.post(`/gyms/${gymId}/reviews`, payload);
    return data?.data ?? data;
  },
  deleteGymReview: async (gymId: string) => {
    const { data } = await api.delete(`/gyms/${gymId}/reviews`);
    return data?.data ?? data;
  },
};

// Gate 7 (exercise/anatomy data-expansion roadmap) — human review queue
// for LIKELY_DUPLICATE/MANUAL_REVIEW exercise candidates. Admin-only;
// mounted under /exercises (already publicly proxied at the gateway) —
// each route itself enforces the admin role server-side.
export interface ExerciseReviewCandidate {
  externalRef: string;
  nameEn: string;
  nameVi: string;
  movementPattern: string;
  equipment: string[];
  primaryMuscles: string[];
  duplicateDecision: "EXACT_SAME_SOURCE" | "EXACT_CROSS_SOURCE" | "LIKELY_DUPLICATE" | "POSSIBLE_VARIANT" | "DISTINCT" | "MANUAL_REVIEW";
  confidence: number;
  matchedFields: string[];
  conflictingFields: string[];
  proposedAction: string;
  bestMatchExercise: { id: string; name: string; referenceCount: number } | null;
  reviewStatus: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ExerciseReviewCandidateDetail extends ExerciseReviewCandidate {
  catalogRow: {
    externalId: string;
    nameVi: string;
    nameEn: string;
    category: string;
    movementPattern: string;
    primaryMuscles: string[];
    equipment: string[];
    difficulty: string;
    isCompound: boolean;
    isUnilateral: boolean;
    forceType: string;
    setup: string;
    executionSteps: string;
    commonErrors: string;
    contraindications: string;
  };
  bestMatchExerciseDetail: {
    id: string;
    exerciseName: string;
    typeOfEquipment: string;
    bodyPart: string;
    muscleGroupsActivated: string[];
    instructions: string;
    videoUrl: string | null;
    status: string;
  } | null;
  reviewHistory: Array<{ decision: string; note: string | null; createdAt: string; updatedAt: string }>;
}

export const exerciseReviewService = {
  getSummary: async (): Promise<{ summary: Record<string, number> }> => {
    const { data } = await api.get("/exercises/admin/review/summary");
    return data;
  },

  list: async (params?: {
    status?: "PENDING" | "REVIEWED" | "ALL";
    decisionTier?: string;
    search?: string;
  }): Promise<{ candidates: ExerciseReviewCandidate[]; summary: Record<string, number> }> => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.decisionTier) qs.set("decisionTier", params.decisionTier);
    if (params?.search) qs.set("search", params.search);
    const { data } = await api.get(`/exercises/admin/review?${qs.toString()}`);
    return data;
  },

  getDetail: async (externalRef: string): Promise<ExerciseReviewCandidateDetail> => {
    const { data } = await api.get(`/exercises/admin/review/${encodeURIComponent(externalRef)}`);
    return data;
  },

  getHistory: async (externalRef: string): Promise<{ externalRef: string; history: Array<{ decision: string; note: string | null; reviewerId: string | null; createdAt: string }> }> => {
    const { data } = await api.get(`/exercises/admin/review/${encodeURIComponent(externalRef)}/history`);
    return data;
  },

  submitDecision: async (
    externalRef: string,
    input: {
      decision: "APPROVE_AS_NEW_STAGING" | "LINK_AS_ALIAS_OF_EXISTING" | "MARK_AS_DUPLICATE_SKIP" | "NEEDS_MORE_INFO" | "REJECT_RECORD";
      targetExerciseId?: string;
      note?: string;
    },
  ): Promise<{ externalRef: string; decision: string; createdExerciseId: string | null; targetExerciseId: string | null; alreadyDecided: boolean }> => {
    const { data } = await api.post(`/exercises/admin/review/${encodeURIComponent(externalRef)}/decision`, input);
    return data;
  },
};

export default api;
