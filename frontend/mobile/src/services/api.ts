import axios from "axios";
// React Native's global fetch is an XMLHttpRequest polyfill: `response.body` is always null, so
// an SSE stream read via `.getReader()` would silently never produce a token. expo/fetch is the
// native-backed implementation whose Response DOES expose a real ReadableStream — the AI Coach
// stream below is the one caller that needs it (everything else goes through axios).
import { fetch as streamingFetch } from "expo/fetch";
import { Preferences } from "./storage";
import { makeRefreshOnce } from "./refresh-once";
import { apiBaseUrl, onServerUrlChange } from "../config/serverUrl";
import { hasUsableToken } from "./token";
import { emitSessionExpired } from "./sessionEvents";
import { readRefreshToken, writeRefreshToken, clearRefreshToken } from "./secureStorage";
import { tokenStore } from "./tokenStore";
import { downloadAuthenticatedFile, shareLocalFile, writeLocalFile } from "./files";

export interface PlanExplanationResponse {
  planId: string;
  explanation: string;
  source: "llm" | "fallback";
  warnings: string[];
}

// An absolute URL straight to the gateway — a native app has no origin for web's relative "/api"
// default to be same as (see config/serverUrl.ts for the full priority chain and why the /api
// prefix is a browser-only proxy convention that must NOT be sent here).
//
// Unlike web, this is a `let`: saving a new address in-app cannot reload a native app the way a
// browser reloads a page, so the live axios instances are re-pointed instead (see the
// onServerUrlChange subscription below). Anything reading this at call time (gymPhotoUrl, the
// streaming fetch) therefore sees the current address, not the one from app launch.
export let API_URL = apiBaseUrl();

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery, no auth. Web could return
// a bare relative path because the browser resolves it against its own origin; an <Image source>
// here needs a fully-qualified URL, so the gateway address is prefixed explicitly.
export function gymPhotoUrl(fileName: string): string {
  return `${API_URL}/uploads/gym-photos/${fileName}`;
}

// Exported so a screen can make an ad-hoc call without a dedicated service method — but always
// through THIS instance. Its request interceptor is what attaches the token; reaching for a bare
// `axios` import instead skips it and silently sends every request unauthenticated, which is
// exactly what put two admin screens into a permanent "failed to load" state on web.
// eslint-disable-next-line import/no-named-as-default-member -- axios.create() is axios's documented API
export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

/**
 * What every upload call takes in place of web's `File`.
 *
 * RN has no `File`/`Blob` to hand to FormData; its FormData instead accepts this shape directly
 * and the native networking layer streams the file off disk. `uri` is whatever the picker gave
 * back (`expo-image-picker`, `expo-camera`, `expo-document-picker` — see
 * MOBILE_PLATFORM_ADAPTERS.md §1/§2); `name` and `type` are what the backend's multer sees, so
 * they must be real (a missing `type` makes the server reject an otherwise valid image).
 */
export type UploadFile = {
  uri: string;
  name: string;
  type: string;
};

/** RN's FormData accepts the descriptor object itself; the cast is only to satisfy the DOM-shaped
 *  FormData typings TypeScript resolves here. */
function appendUpload(formData: FormData, field: string, file: UploadFile): void {
  formData.append(field, file as unknown as Blob);
}

type RetriableRequestConfig = {
  _retry?: boolean;
  /**
   * Set by the startup/session-restore path (services/session.ts), which owns its own
   * "give up and show the login screen" decision. Without it, a 401 during bootstrap would
   * trigger the interceptor's own hard redirect and reload the whole app mid-restore —
   * exactly the login-screen flash this flow exists to prevent.
   */
  _skipAuthRedirect?: boolean;
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

// eslint-disable-next-line import/no-named-as-default-member -- axios.create() is axios's documented API
const refreshClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// Web reloaded the whole page when the server address changed, which re-ran this module. A
// native app cannot, so re-point everything that captured the old address instead. Registered
// once at module load; fires only when the in-app server setting is actually saved.
onServerUrlChange((nextBaseUrl) => {
  API_URL = nextBaseUrl;
  api.defaults.baseURL = nextBaseUrl;
  refreshClient.defaults.baseURL = nextBaseUrl;
});

/** Shared across the app: concurrent 401s and the startup path all funnel through this one
 *  in-flight refresh instead of each firing their own /auth/refresh. */
export const refreshOnce = makeRefreshOnce(refreshAccessToken);

/** Clears only the session keys — theme, language and other preferences survive. */
export async function clearStoredSession(): Promise<void> {
  await Preferences.remove({ key: "accessToken" });
  tokenStore.set(null);
  await clearRefreshToken();
  await Preferences.remove({ key: "user" });
}

async function clearSessionAndRedirectToLogin() {
  await clearStoredSession();
  // Emit rather than navigating from here: this module is outside the React tree. AppContext
  // listens and navigates with expo-router instead (see services/sessionEvents.ts).
  emitSessionExpired();
}

/**
 * Thrown when /auth/refresh could not be reached or answered with a server error —
 * i.e. we do NOT know whether the session is still valid.
 *
 * This is deliberately distinct from `refreshAccessToken` returning null, which means the
 * server actively rejected the refresh token. Collapsing the two (the old behaviour: catch
 * everything, return null) meant a dropped connection or a backend hiccup was indistinguishable
 * from a revoked session, and logged the user out over a bad network.
 */
export class RefreshUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Token refresh could not be completed");
    this.name = "RefreshUnavailableError";
    this.cause = cause;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await readRefreshToken();
  if (!hasUsableToken(refreshToken)) return null;

  try {
    const { data } = await refreshClient.post("/auth/refresh", {
      refreshToken,
    });
    if (hasUsableToken(data?.accessToken)) {
      await Preferences.set({ key: "accessToken", value: data.accessToken });
      tokenStore.set(data.accessToken);
      if (hasUsableToken(data?.refreshToken)) {
        await writeRefreshToken(data.refreshToken);
      }
      return data.accessToken;
    }
    // 2xx with no usable token in the body — treat as a real rejection, not a transport fault.
    return null;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // The server answered and said no — the session really is over.
    if (typeof status === "number" && status >= 400 && status < 500) return null;
    // No response, or the server failed on its own account: we simply don't know.
    throw new RefreshUnavailableError(err);
  }
}

api.interceptors.request.use(async (config) => {
  // Vòng 4 / Phase D3 — was `await Preferences.get({ key: "accessToken" })` here: a
  // native-bridge round-trip on EVERY single request. tokenStore is kept in sync with
  // storage on every write (see tokenStore.ts's doc comment) — reading it is synchronous.
  const token = tokenStore.get();
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
    const requestUrl = originalRequest.url || "";

    // /auth/logout is deliberately NOT in this list: it is called with an already-dead
    // session on purpose, and must never trigger a refresh-and-retry loop.
    const isAuthEndpoint =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/register") ||
      requestUrl.includes("/auth/refresh") ||
      requestUrl.includes("/auth/logout");

    // Any 401 from a non-auth endpoint is worth ONE refresh attempt. This used to also
    // require an error code of "UNAUTHORIZED" or a /token|unauthorized/i match on the
    // server's message — which silently disabled the whole refresh mechanism whenever a
    // service worded its 401 differently. The retry is already bounded by _retry, and a
    // refresh that isn't needed simply succeeds and costs one request.
    if (status === 401 && !isAuthEndpoint && !originalRequest._retry) {
      originalRequest._retry = true;

      let newToken: string | null = null;
      try {
        newToken = await refreshOnce();
      } catch (refreshErr) {
        // RefreshUnavailableError: we could not reach /auth/refresh, so we do NOT know the
        // session is dead. Fail this one request and leave the stored session intact —
        // destroying it here would log the user out over a flaky connection.
        if (refreshErr instanceof RefreshUnavailableError) {
          return Promise.reject(error);
        }
        throw refreshErr;
      }

      if (hasUsableToken(newToken)) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      // Refresh genuinely failed — the session is over. The bootstrap path opts out of the
      // redirect because it renders the login screen itself, without reloading the app.
      if (!originalRequest._skipAuthRedirect) {
        clearSessionAndRedirectToLogin();
      }
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
      tokenStore.set(data.accessToken);
      await writeRefreshToken(data.refreshToken);
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
      tokenStore.set(data.accessToken);
      await writeRefreshToken(data.refreshToken);
      await Preferences.set({ key: "user", value: JSON.stringify(data.user) });
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  logout: async () => {
    // Revoke the refresh token server-side FIRST. Clearing local storage alone left the
    // refresh token valid in the database, so a copy of it kept working after "logging out".
    // Best-effort by design: a network failure here must not trap the user in a session they
    // asked to end, so we always fall through to clearing locally either way.
    try {
      const refreshToken = await readRefreshToken();
      if (hasUsableToken(refreshToken)) {
        await api.post("/auth/logout", { refreshToken });
      }
    } catch {
      // Ignored on purpose — see above.
    }

    // Only clear session keys — keep theme, language and other non-session preferences.
    await clearStoredSession();
    // Same reasoning as clearSessionAndRedirectToLogin: router navigation, not a reload.
    emitSessionExpired();
  },

  // Settings Center → Account. Backend (`PATCH /auth/me`) only accepts
  // firstName/lastName — no email/phone change exists (verified, see
  // docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md §6/§11).
  updateMe: async (updates: { firstName?: string; lastName?: string }) => {
    const { data } = await api.patch("/auth/me", updates);
    return data;
  },

  changePassword: async (payload: {
    currentPassword: string;
    newPassword: string;
  }) => {
    const { data } = await api.patch("/auth/me/password", payload);
    return data;
  },

  /** GAP-5 — a new code for a sign-up still waiting on email verification. */
  resendRegistrationOtp: async (email: string) => {
    const { data } = await api.post("/auth/register/resend", { email });
    return data as {
      message: string;
      email: string;
      expiresInMinutes: number;
      resendAfterSeconds: number;
    };
  },

  /**
   * GAP-4 — self-service password reset. Resolves with the same message whether or not the email
   * has an account (the server never reveals which); the emailed link opens the web reset page.
   */
  requestPasswordReset: async (email: string) => {
    const { data } = await api.post("/auth/password-reset/request", { email });
    return data as { message: string };
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

  uploadPhoto: async (file: UploadFile) => {
    const formData = new FormData();
    appendUpload(formData, "photo", file);
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

  /** One PT's public profile for the discovery detail modal — adds avgRating/ratingCount
   *  (already on the list rows too) plus recentReviews: the last 5 commented reviews, which
   *  the list endpoint never sends. */
  getPTDetail: async (ptUserId: string) => {
    const { data } = await api.get(`/profile/pts/${ptUserId}`);
    return data;
  },

  // Settings Center → Privacy & Data. This deletes ONLY the UserProfile
  // row (+ a fire-and-forget AI-conversation cascade) — it does NOT delete
  // the login account, workouts/programs, contracts, payments, or chat
  // history (verified, see impact analysis §11). The UI must label this
  // accurately as "xoá dữ liệu hồ sơ", never "xoá tài khoản".
  deleteProfileData: async () => {
    const { data } = await api.delete("/profile/me");
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

  upload: async (file: UploadFile) => {
    const formData = new FormData();
    appendUpload(formData, "image", file);
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
  tempo?: string | null;
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
  amrapPerformance: {
    achievedReps: number;
    minimumReps: number;
    marginReps: number;
  } | null;
}

// Roadmap P3.6 "Exercise history detail page"
// (docs/features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md).
export interface ExerciseHistoryPersonalRecord {
  metric: "e1rm" | "reps" | "duration" | "distance" | "pace";
  value: number;
  weightKg: number | null;
  reps: number | null;
  date: string;
}

export interface ExerciseHistorySessionSet {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  setType: string | null;
  tempo: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface ExerciseHistoryRecentSession {
  workoutId: string;
  workoutName: string;
  date: string;
  notes: string | null;
  sets: ExerciseHistorySessionSet[];
}

export interface ExerciseHistoryDetail {
  exercise: { id: string; name: string; loggingMode: ExerciseLoggingMode };
  personalRecord: ExerciseHistoryPersonalRecord | null;
  progression: ExerciseProgression | null;
  recentSessions: ExerciseHistoryRecentSession[];
  chart: { sessions: ExerciseProgressSessionPoint[] };
}

export type WorkoutSetPrescriptionInput = {
  setNumber: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  targetSetType?: string | null;
  targetTempo?: string | null;
  targetDurationSeconds?: number | null;
  targetDistanceMeters?: number | null;
  isAmrap?: boolean;
  minReps?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
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
    // Product Completeness pass — Exercise Library difficulty/logging-mode
    // filters (spec §16).
    difficulty?: string;
    loggingMode?: string;
    hasVideo?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.bodyPart) qs.set("bodyPart", params.bodyPart);
    if (params?.muscleGroup) qs.set("muscleGroup", params.muscleGroup);
    if (params?.equipment) qs.set("equipment", params.equipment);
    if (params?.activityType) qs.set("activityType", params.activityType);
    if (params?.difficulty) qs.set("difficulty", params.difficulty);
    if (params?.loggingMode) qs.set("loggingMode", params.loggingMode);
    if (params?.hasVideo !== undefined) qs.set("hasVideo", String(params.hasVideo));
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

  // Roadmap P1.5 "Custom exercises".
  createCustomExercise: async (input: {
    exerciseName: string;
    typeOfActivity: string;
    typeOfEquipment: string;
    bodyPart: string;
    type: string;
    muscleGroupsActivated: string[];
    instructions?: string;
    loggingMode: string;
    confirmCreateAnyway?: boolean;
  }) => {
    const { data } = await api.post("/exercises/custom", input);
    return data as
      | { blocked: false; exercise: any }
      | { blocked: true; candidates: Array<{ id: string; name: string; confidence: number; proposedAction: string }> };
  },

  listMyCustomExercises: async () => {
    const { data } = await api.get("/exercises/custom");
    return data?.exercises ?? [];
  },

  archiveCustomExercise: async (id: string) => {
    const { data } = await api.delete(`/exercises/custom/${id}`);
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

  // Product Completeness pass — Exercise Detail page. Bare single-exercise
  // row (aliases/equipment need their own calls — see impact analysis §6).
  getExercise: async (exerciseId: string) => {
    const { data } = await api.get(`/exercises/${exerciseId}`);
    return data;
  },

  // Product Completeness pass — Muscle Library detail page's "related
  // exercises", correctly sourced from the canonical ExerciseMuscle table
  // (never the legacy muscleGroup filter getExercises() above uses).
  getExercisesByMuscle: async (
    muscleIdOrCode: string,
    params?: { page?: number; limit?: number },
  ): Promise<{
    muscle: { id: string; code: string; nameVi: string; nameEn: string | null; anatomyRegion: string | null };
    exercises: Array<Record<string, any> & { muscleRole: "primary" | "secondary" | null }>;
    pagination: { page: number; limit: number; total: number };
  }> => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const { data } = await api.get(
      `/exercises/muscles/${encodeURIComponent(muscleIdOrCode)}/exercises${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
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

  // Roadmap P3.6 "Exercise history detail page" — one aggregated call
  // powering the whole page (charts + PR + recent sessions + progression).
  getExerciseHistory: async (exerciseId: string): Promise<ExerciseHistoryDetail> => {
    const { data } = await api.get(`/workouts/exercises/${exerciseId}/history`);
    return data;
  },

  /**
   * Add one ad-hoc set to a live workout — the "Thêm set" action on the logging screen.
   *
   * NOT a port: `POST /workouts/:id/sets` (fitness-service `workoutController.addSet`) has
   * existed all along, but no client ever wrapped it — web's own service layer has no caller
   * either, which is why its logging screen cannot add a set outside the prescribed skeleton.
   * Mobile's design does ask for it, so the wrapper is written here against the endpoint's real
   * contract (see `workout.service.ts#addSet`: rpe 1-10, rir 0-5, setType from SET_TYPES).
   * Backend untouched.
   */
  addSet: async (
    workoutId: string,
    body: {
      exerciseId: string;
      setNumber?: number;
      weight?: number;
      reps?: number;
      rpe?: number;
      rir?: number;
      setType?: string | null;
      tempo?: string | null;
    },
  ) => {
    const { data } = await api.post(`/workouts/${workoutId}/sets`, body);
    return data;
  },

  updateSet: async (
    setId: string,
    patch: {
      reps?: number;
      weight?: number;
      rpe?: number;
      // Roadmap P1.1 "true set-by-set table UI" — the backend's
      // updateWorkoutSetSchema already accepted every one of these; this
      // type just never declared them for a caller to use.
      rir?: number;
      bodyWeightAtSetKg?: number | null;
      durationSeconds?: number | null;
      distanceMeters?: number | null;
      setType?: string | null;
      tempo?: string | null;
      segments?: Array<{
        segmentNumber: number;
        technique: "DROP_SET" | "REST_PAUSE";
        reps: number;
        weight?: number | null;
        rpe?: number | null;
        rir?: number | null;
        restBeforeSeconds?: number | null;
        notes?: string | null;
      }>;
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

  // Roadmap P1.3 "Superset / exercise grouping".
  createExerciseGroup: async (
    programDayId: string,
    programExerciseIds: string[],
    type: "SUPERSET" | "TRISET" | "CIRCUIT",
    restBetweenExercisesSeconds?: number,
    restAfterRoundSeconds?: number,
  ) => {
    const { data } = await api.post(`/workouts/program-days/${programDayId}/exercise-groups`, {
      programExerciseIds,
      type,
      restBetweenExercisesSeconds,
      restAfterRoundSeconds,
    });
    return data;
  },

  updateExerciseGroup: async (
    id: string,
    patch: { type?: string; restBetweenExercisesSeconds?: number | null; restAfterRoundSeconds?: number | null },
  ) => {
    const { data } = await api.patch(`/workouts/exercise-groups/${id}`, patch);
    return data;
  },

  ungroupExercises: async (id: string) => {
    const { data } = await api.delete(`/workouts/exercise-groups/${id}`);
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

  // Roadmap P1.2 "Reschedule workout" — moves the same session to a new
  // date. newDate is a YYYY-MM-DD string.
  rescheduleSchedule: async (id: string, newDate: string, reason?: string) => {
    const { data } = await api.post(`/workouts/schedules/${id}/reschedule`, {
      newDate,
      reason,
    });
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

  // Roadmap P1.6 "undo last set" — sibling of completeScheduleExercise
  // above. No body: this only ever flips the named exercise's completion
  // flag back off.
  undoCompleteScheduleExercise: async (
    scheduleId: string,
    programExerciseId: string,
  ): Promise<WorkoutExerciseCompletionResponse> => {
    const { data } = await api.post(
      `/workouts/schedules/${scheduleId}/exercises/${programExerciseId}/undo-complete`,
      {},
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
        setPrescriptions?: WorkoutSetPrescriptionInput[];
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
      setPrescriptions?: WorkoutSetPrescriptionInput[];
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

// Roadmap P3.4 "Training consistency and adherence"
// (docs/features/TRAINING_CONSISTENCY_ADHERENCE_IMPACT_ANALYSIS.md).
export interface CycleAdherenceBreakdown {
  completed: number;
  partial: number;
  missed: number;
  rescheduled: number;
  planned: number;
  adherencePct: number | null;
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
    breakdown: CycleAdherenceBreakdown;
    rescheduledSessions: Array<{ from: string; to: string; status: string }>;
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
  plannedVsActual: {
    byExercise: Array<{
      exerciseId: string;
      exerciseName: string;
      loggingMode: string;
      sessionsPlanned: number;
      plannedVolumeKg: number | null;
      actualVolumeKg: number | null;
      plannedReps: number | null;
      actualReps: number | null;
      plannedDurationSeconds: number | null;
      actualDurationSeconds: number | null;
      actualDistanceMeters: number | null;
    }>;
    totals: {
      totalPlannedVolumeKg: number | null;
      totalActualVolumeKg: number | null;
      volumeAdherencePct: number | null;
      totalPlannedReps: number | null;
      totalActualReps: number | null;
      totalPlannedDurationSeconds: number | null;
      totalActualDurationSeconds: number | null;
      totalActualDistanceMeters: number | null;
    };
  };
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
  // P0 cluster C2/C3: payment now goes through gateway checkout, same as PT-contract/gym
  // membership — an order exists in this status from the moment checkout starts until the
  // gateway's webhook confirms payment. "PURCHASED" itself is never actually observed by the
  // frontend anymore (activation moves PENDING_PAYMENT straight to INTAKE_PENDING), kept below
  // only because the backend enum still names it.
  | "PENDING_PAYMENT"
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

// P0 cluster C2 — mirrors ai-service's clients/payment.client.ts CheckoutResult exactly.
export interface PersonalizedServicePayment {
  transactionId: string;
  status: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
  provider: string;
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
  // P0 cluster C2 — starts a gateway checkout; the response carries payment.redirectUrl (or
  // payment.qrCodeUrl), not a settled order. The order activates only once the gateway's
  // webhook confirms payment — the caller must send the buyer to payment.redirectUrl next,
  // same convention as gymService.payMembership / contract checkout.
  purchase: async (id: string, provider?: string) => {
    const { data } = await api.post<{
      success: boolean;
      data: { order: PersonalizedServiceOrder; payment: PersonalizedServicePayment };
    }>(`/marketplace/services/${id}/purchase`, provider ? { provider } : {});
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
  weight?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
  setPrescriptions?: Array<WorkoutSetPrescriptionInput & {
    id: string;
    targetReps: number | null;
    targetWeight: number | null;
    targetRpe: number | null;
    targetRir: number | null;
    targetSetType: string | null;
    targetTempo: string | null;
    targetDurationSeconds: number | null;
    targetDistanceMeters: number | null;
    isAmrap: boolean;
    minReps: number | null;
    restSeconds: number | null;
    notes: string | null;
  }>;
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

  // Double cast because isRecord only proves "some object", which TypeScript will not narrow
  // straight to WorkoutPlanRecord under `strict`. The shape is the server's to guarantee here —
  // web has no tsconfig at all, so this latent cast only started being checked on this side.
  if (isRecord(unwrapped) && isRecord(unwrapped.plan)) {
    return unwrapped.plan as unknown as WorkoutPlanRecord;
  }
  if (isRecord(unwrapped)) {
    return unwrapped as unknown as WorkoutPlanRecord;
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
    const slowNoticeTimer = setTimeout(() => {
      callbacks.onStatus(
        "Model local có thể đang khởi động, vui lòng chờ thêm...",
      );
    }, 10000);
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, 75000);

    (async () => {
      try {
        const sendStreamRequest = (token: string | null) =>
          streamingFetch(`${API_URL}/ai/ask/stream`, {
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

        // Vòng 4 / Phase D3 — raw fetch() bypasses the axios interceptor above (needs a
        // streaming response body), so it used to do its own Preferences.get round-trip here.
        let response = await sendStreamRequest(tokenStore.get());

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
        clearTimeout(slowNoticeTimer);
        clearTimeout(timeoutTimer);
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

  // Money-flow plan 4.2: sessions a client disputed (PT reported it, client objected) — the
  // backend has had list + resolve endpoints since VĐ2, but no admin UI ever called them, so
  // a disputed session's money stayed frozen indefinitely with nobody able to rule on it.
  listDisputedSessions: async () => {
    const { data } = await api.get("/admin/sessions/disputed");
    return data;
  },
  resolveSessionDispute: async (id: string, resolution: "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED", note: string) => {
    const { data } = await api.post(`/admin/sessions/${id}/resolve`, { resolution, note });
    return data;
  },

  // Whole-platform money invariant (docs/money-flow.md §1.3): ESCROW.available must equal
  // the sum of every claim on it (client refunds, PT/gym pending+available, platform
  // revenue). balanced:false means the ledger created or destroyed money somewhere. The
  // endpoint has existed since the money-flow redesign; nothing in the admin UI ever called
  // it, so a real drift would have gone unnoticed with no page to show it on.
  getReconciliation: async () => {
    const { data } = await api.get("/admin/payments/reconciliation");
    return data;
  },

  // "Tài chính" → tab Tổng quan: thu/chi/doanh thu ròng theo ngày/tuần/tháng/quý.
  getFinanceOverview: async (params: { groupBy: "day" | "week" | "month" | "quarter"; from?: string; to?: string }) => {
    const { data } = await api.get("/admin/payments/finance-overview", { params });
    return data;
  },

  // Money-flow plan 5.3 — the manual withdrawal flow's admin side. approve/reject are optional
  // review steps; markPaid is the only one that actually moves money, and only after the admin
  // has already made a real bank/e-wallet transfer outside this system.
  listPendingWithdrawals: async () => {
    const { data } = await api.get("/admin/payments/withdrawals");
    return data?.data ?? data;
  },
  approveWithdrawal: async (id: string) => {
    const { data } = await api.post(`/admin/payments/withdrawals/${id}/approve`);
    return data?.data ?? data;
  },
  rejectWithdrawal: async (id: string, reason: string) => {
    const { data } = await api.post(`/admin/payments/withdrawals/${id}/reject`, { reason });
    return data?.data ?? data;
  },
  markWithdrawalPaid: async (id: string, bankReference: string) => {
    const { data } = await api.post(`/admin/payments/withdrawals/${id}/mark-paid`, { bankReference });
    return data?.data ?? data;
  },

  // Vòng 4 / Phase C — gym/brand moderation. There was no admin-facing gym/brand list at all
  // before this phase.
  // No self-registration path for GYM_OWNER — an admin creates the account directly after
  // arranging the partnership out of band (phone/email); returns the random temporary
  // password ONCE, never retrievable again after this call.
  createGymOwner: async (payload: { email: string; firstName: string; lastName?: string }) => {
    const { data } = await api.post('/admin/gym-owners', payload);
    return data?.data ?? data;
  },
  // "Quản lý gym & owner" — admin can only CREATE an owner account before this; these three
  // fill the gap the user pointed out (suspend/reactivate + name fix, no email edit — see
  // authService.updateUserNameAsAdmin's doc comment for why email is excluded).
  listGymOwners: async () => {
    const { data } = await api.get('/admin/gym-owners');
    return data?.data ?? data;
  },
  setGymOwnerActive: async (userId: string, isActive: boolean) => {
    const { data } = await api.patch(`/admin/users/${userId}/${isActive ? 'enable' : 'disable'}`);
    return data?.data ?? data;
  },
  updateGymOwnerName: async (userId: string, payload: { firstName?: string; lastName?: string }) => {
    const { data } = await api.patch(`/admin/users/${userId}/name`, payload);
    return data?.data ?? data;
  },
  listGymsForAdmin: async (status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
    const { data } = await api.get('/admin/gyms', { params: status ? { status } : undefined });
    return data?.data ?? data;
  },
  setGymStatus: async (gymId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
    const { data } = await api.patch(`/admin/gyms/${gymId}/status`, { status });
    return data?.data ?? data;
  },
  // "Quản lý gym & owner" — admin editing a branch's details directly (name/address take
  // effect immediately, no owner-approval round-trip). Creating a NEW branch is still owner-
  // only (unchanged) — this only covers editing an existing one.
  updateGymDetails: async (
    gymId: string,
    payload: Partial<{ name: string; description: string; address: string; city: string; phone: string; email: string }>,
  ) => {
    const { data } = await api.patch(`/admin/gyms/${gymId}`, payload);
    return data?.data ?? data;
  },
  // C2 — approves a rename/address-change on a gym that was already approved before (the
  // gym's very FIRST approval happens automatically via setGymStatus('APPROVED') above).
  approveGymRename: async (gymId: string) => {
    const { data } = await api.patch(`/admin/gyms/${gymId}/approve-rename`);
    return data?.data ?? data;
  },
  // C3 — the actionable item for a permanently-closed gym: still-ACTIVE memberships there
  // need an admin to run the existing refundByAdmin(reason: 'GYM_CLOSED') on them.
  listPermanentlyClosedGyms: async () => {
    const { data } = await api.get('/admin/gyms/permanently-closed');
    return data?.data ?? data;
  },
  listBrandsForAdmin: async () => {
    const { data } = await api.get('/admin/brands');
    return data?.data ?? data;
  },
  // C1 — the dedicated "Duyệt đổi tên thương hiệu" action; a brand's FIRST-ever approval
  // happens automatically when its first branch is approved (setGymStatus above).
  approveBrandRename: async (brandId: string) => {
    const { data } = await api.patch(`/admin/brands/${brandId}/approve-rename`);
    return data?.data ?? data;
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

  // Exceptional gym-membership refund (money-flow §2.4) — gym violation/closure/transaction
  // error only. Route has existed since the money-flow redesign with no caller anywhere in
  // the admin UI.
  refundGymMembership: async (
    membershipId: string,
    reason: "GYM_VIOLATION_SUSPENDED" | "GYM_CLOSED" | "TRANSACTION_ERROR",
  ) => {
    const { data } = await api.post(`/admin/gym-memberships/${membershipId}/refund`, { reason });
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

  // ── Quản lý đối tác phòng tập (Phase 2-5) ─────────────────────────────────────
  getGymManagementOverview: async () => {
    const { data } = await api.get("/admin/partners/overview-stats");
    return data?.data ?? data;
  },
  getPartnerQueue: async () => {
    const { data } = await api.get("/admin/partners/queue");
    return data?.data ?? data;
  },
  listPartners: async (status?: string) => {
    const { data } = await api.get("/admin/partners", { params: status ? { status } : undefined });
    return data?.data ?? data;
  },
  getPartner: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}`);
    return data?.data ?? data;
  },
  createPartner: async (payload: {
    legalName: string; partnerKind?: "BUSINESS" | "INDIVIDUAL"; taxCode?: string; businessLicenseNo?: string;
    contactEmail: string; contactPhone?: string; commissionRateOverride?: number | null;
  }) => {
    const { data } = await api.post("/admin/partners", payload);
    return data?.data ?? data;
  },
  updatePartner: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/admin/partners/${id}`, payload);
    return data?.data ?? data;
  },
  getPartnerAuditLog: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/audit-log`);
    return data?.data ?? data;
  },
  provisionPartnerOwner: async (id: string) => {
    const { data } = await api.post(`/admin/partners/${id}/provision`, {});
    return data?.data ?? data;
  },
  resendPartnerInvitation: async (partnerId: string, invitationId: string) => {
    const { data } = await api.post(`/admin/partners/${partnerId}/invitations/${invitationId}/resend`, {});
    return data?.data ?? data;
  },
  revokePartnerInvitation: async (partnerId: string, invitationId: string) => {
    const { data } = await api.post(`/admin/partners/${partnerId}/invitations/${invitationId}/revoke`, {});
    return data?.data ?? data;
  },
  resetPartnerAccountPassword: async (accountId: string) => {
    const { data } = await api.post(`/admin/partner-accounts/${accountId}/reset-password`, {});
    return data?.data ?? data;
  },
  forceLogoutPartnerAccount: async (accountId: string) => {
    const { data } = await api.post(`/admin/partner-accounts/${accountId}/force-logout`, {});
    return data?.data ?? data;
  },
  revokePartnerAccountAsAdmin: async (accountId: string, reason?: string) => {
    const { data } = await api.delete(`/admin/partner-accounts/${accountId}`, { data: { reason } });
    return data?.data ?? data;
  },
  transferPartnerOwnership: async (partnerId: string, toAccountId: string, reason?: string) => {
    const { data } = await api.post(`/admin/partners/${partnerId}/transfer-ownership`, { toAccountId, reason });
    return data?.data ?? data;
  },
  viewAsPartner: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/view-as`);
    return data?.data ?? data;
  },

  // Phase 4 — hồ sơ thẩm định.
  listPartnerDocuments: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/documents`);
    return data?.data ?? data;
  },
  upsertPartnerDocument: async (id: string, docType: string, fileUrl: string) => {
    const { data } = await api.put(`/admin/partners/${id}/documents/${docType}`, { fileUrl });
    return data?.data ?? data;
  },
  verifyPartnerDocument: async (id: string, docType: string, decision: "VERIFIED" | "REJECTED", expiresAt?: string) => {
    const { data } = await api.post(`/admin/partners/${id}/documents/${docType}/verify`, { decision, expiresAt });
    return data?.data ?? data;
  },
  listPartnerContactLog: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/contact-log`);
    return data?.data ?? data;
  },
  addPartnerContactLog: async (id: string, payload: { channel: string; note: string; occurredAt?: string }) => {
    const { data } = await api.post(`/admin/partners/${id}/contact-log`, payload);
    return data?.data ?? data;
  },
  rejectPartner: async (id: string, reason: string) => {
    const { data } = await api.post(`/admin/partners/${id}/reject`, { reason });
    return data?.data ?? data;
  },
  reopenPartner: async (id: string) => {
    const { data } = await api.post(`/admin/partners/${id}/reopen`, {});
    return data?.data ?? data;
  },

  // Phase 5 — tạm khoá / chấm dứt / chiết khấu.
  suspendPartner: async (id: string, reason: string) => {
    const { data } = await api.post(`/admin/partners/${id}/suspend`, { reason });
    return data?.data ?? data;
  },
  unsuspendPartner: async (id: string) => {
    const { data } = await api.post(`/admin/partners/${id}/unsuspend`, {});
    return data?.data ?? data;
  },
  getTerminationImpact: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/termination-impact`);
    return data?.data ?? data;
  },
  terminatePartner: async (id: string, payload: { reason: string; memberPolicy: "SERVE_UNTIL_EXPIRY" | "PRORATED_REFUND" }) => {
    const { data } = await api.post(`/admin/partners/${id}/terminate`, payload);
    return data?.data ?? data;
  },
  getCommissionRate: async () => {
    const { data } = await api.get("/admin/commission-rate");
    return data?.data ?? data;
  },
  getCommissionRateHistory: async () => {
    const { data } = await api.get("/admin/commission-rate/history");
    return data?.data ?? data;
  },
  setCommissionRate: async (rate: number, effectiveFrom: string) => {
    const { data } = await api.post("/admin/commission-rate", { rate, effectiveFrom });
    return data?.data ?? data;
  },

  // GYM_MANAGEMENT master spec Phase 1 — verification axis, admin assignment, internal notes.
  setPartnerVerificationStatus: async (id: string, verificationStatus: string, notes?: string) => {
    const { data } = await api.patch(`/admin/partners/${id}/verification-status`, { verificationStatus, notes });
    return data?.data ?? data;
  },
  assignPartnerAdmin: async (id: string, assignedAdminId: string | null) => {
    const { data } = await api.patch(`/admin/partners/${id}/assigned-admin`, { assignedAdminId });
    return data?.data ?? data;
  },
  listPartnerInternalNotes: async (id: string) => {
    const { data } = await api.get(`/admin/partners/${id}/internal-notes`);
    return data?.data ?? data;
  },
  addPartnerInternalNote: async (id: string, text: string) => {
    const { data } = await api.post(`/admin/partners/${id}/internal-notes`, { text });
    return data?.data ?? data;
  },
  // Phase 1 — per-field "Request Changes" on a branch (does not change GymStatus).
  requestGymChanges: async (gymId: string, payload: { nameNote?: string; addressNote?: string }) => {
    const { data } = await api.post(`/admin/gyms/${gymId}/request-changes`, payload);
    return data?.data ?? data;
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 4 — the SEPARATE by-category "Request Changes" for a
  // branch's first-time PENDING_REVIEW wizard submission (sends it back to DRAFT). Distinct
  // from requestGymChanges above, which is name/address only and never changes status.
  requestBranchChanges: async (gymId: string, issues: { category: import('../types').BranchReviewCategory; message: string }[]) => {
    const { data } = await api.post(`/admin/gyms/${gymId}/branch-review-issues`, { issues });
    return data?.data ?? data;
  },
  listBranchReviewIssues: async (gymId: string): Promise<import('../types').GymBranchReviewIssue[]> => {
    const { data } = await api.get(`/admin/gyms/${gymId}/branch-review-issues`);
    return data?.data ?? data;
  },

  // GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace: the wizard collects opening
  // hours/facilities/photos/verification documents a bare gym row doesn't carry (facilities
  // does — it's a plain column already on GET /admin/gyms's rows).
  getGymHoursForAdmin: async (gymId: string): Promise<import('../types').GymOperatingHoursDay[]> => {
    const { data } = await api.get(`/admin/gyms/${gymId}/hours`);
    return data?.data ?? data;
  },
  listGymPhotosForAdmin: async (gymId: string): Promise<import('../types').GymPhoto[]> => {
    const { data } = await api.get(`/admin/gyms/${gymId}/photos`);
    return data?.data ?? data;
  },
  listBranchDocumentsForAdmin: async (
    gymId: string,
  ): Promise<{ documents: import('../types').GymBranchDocument[]; partnerContext: import('../types').PartnerDocumentContext[] }> => {
    const { data } = await api.get(`/admin/gyms/${gymId}/branch-documents`);
    return data?.data ?? data;
  },
  /** Returns a local `file://` URI, not a Blob — see the note above exportService. */
  fetchBranchDocumentFile: async (token: string): Promise<string> => {
    return downloadAuthenticatedFile(`/admin/branch-documents/${token}`, `branch-document-${token}`);
  },

  // GYM_MANAGEMENT master spec, Phase 5 — Khiếu nại/Vi phạm (một hàng đợi chung, mọi nguồn).
  listComplaints: async (status?: string) => {
    const { data } = await api.get("/admin/complaints", { params: status ? { status } : undefined });
    return data?.data ?? data;
  },
  getComplaint: async (id: string) => {
    const { data } = await api.get(`/admin/complaints/${id}`);
    return data?.data ?? data;
  },
  listPartnerComplaints: async (partnerId: string) => {
    const { data } = await api.get(`/admin/partners/${partnerId}/complaints`);
    return data?.data ?? data;
  },
  createComplaintAsAdmin: async (payload: {
    gymId: string;
    source: string;
    issueType: string;
    description: string;
    photoTokens?: string[];
    reporterUserId?: string | null;
  }) => {
    const { data } = await api.post("/admin/complaints", payload);
    return data?.data ?? data;
  },
  updateComplaintStatus: async (id: string, payload: { status: string; adminResponse?: string }) => {
    const { data } = await api.patch(`/admin/complaints/${id}/status`, payload);
    return data?.data ?? data;
  },
  assignComplaintAdmin: async (id: string, assignedAdminId: string | null) => {
    const { data } = await api.patch(`/admin/complaints/${id}/assigned-admin`, { assignedAdminId });
    return data?.data ?? data;
  },
  /** Returns a local `file://` URI, not a Blob — see the note above exportService. */
  fetchComplaintPhotoFile: async (token: string): Promise<string> => {
    return downloadAuthenticatedFile(`/admin/complaint-photos/${token}`, `complaint-photo-${token}`);
  },
};

export interface FoodCatalogItem {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  imageUrl: string | null;
  source?: string;
  foodForm?: string | null;
  isSupplement?: boolean;
}

export const foodService = {
  search: async (q: string) => {
    const { data } = await api.get(`/food/search?q=${encodeURIComponent(q)}`);
    return data as FoodCatalogItem[];
  },

  // Product Completeness pass — Food Library browse page
  // (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md §7). Plain
  // paginated list off the same real USDA-backed `Food` table `search`
  // already reads — no parallel food data source.
  list: async (params?: {
    page?: number;
    limit?: number;
    // "protein-rich / carb-rich / fat-rich" sort (spec §18) — real,
    // computable from Food's own columns; not a fabricated food-group filter.
    sortBy?: "name" | "protein" | "carbs" | "fats";
    source?: string;
    foodForm?: string;
    isSupplement?: boolean;
    hasImage?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.sortBy) qs.set("sortBy", params.sortBy);
    if (params?.source) qs.set("source", params.source);
    if (params?.foodForm) qs.set("foodForm", params.foodForm);
    if (params?.isSupplement !== undefined) {
      qs.set("isSupplement", String(params.isSupplement));
    }
    if (params?.hasImage !== undefined) {
      qs.set("hasImage", String(params.hasImage));
    }
    const { data } = await api.get(
      `/food${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
    return data as {
      foods: FoodCatalogItem[];
      pagination: { page: number; limit: number; total: number };
    };
  },

  getFilterOptions: async () => {
    const { data } = await api.get("/food/filter-options");
    return data as {
      sources: string[];
      foodForms: string[];
      supplementValues: boolean[];
    };
  },

  getById: async (id: string): Promise<FoodCatalogItem> => {
    const { data } = await api.get(`/food/${id}`);
    return data;
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

export interface PTServicePackage {
  id: string;
  ptUserId: string;
  name: string;
  description: string | null;
  sessionCount: number;
  price: string;
  sessionMode: "ONLINE" | "OFFLINE";
  sessionDurationMinutes: number;
  validityDays: number | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  // The PT's own view — everything including archived. Route existed on the backend
  // (controller + service) with no route declaration wired to it, so every call here used
  // to 404; the UI instead showed static placeholder packages that were never real.
  getMyPackages: async (): Promise<{ packages: PTServicePackage[] }> => {
    const { data } = await api.get("/profile/me/service-packages");
    return data;
  },
  createPackage: async (payload: {
    name: string;
    description?: string;
    sessionCount: number;
    price: number;
    sessionMode: "ONLINE" | "OFFLINE";
    sessionDurationMinutes?: number;
    validityDays?: number;
  }): Promise<{ package: PTServicePackage }> => {
    const { data } = await api.post("/profile/me/service-packages", payload);
    return data;
  },
  updatePackage: async (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      sessionCount: number;
      price: number;
      sessionMode: "ONLINE" | "OFFLINE";
      sessionDurationMinutes: number;
      validityDays: number | null;
      isActive: boolean;
    }>,
  ): Promise<{ package: PTServicePackage }> => {
    const { data } = await api.patch(`/profile/me/service-packages/${id}`, payload);
    return data;
  },
  // Soft-archive — the backend never hard-deletes a package (signed contracts reference it).
  archivePackage: async (id: string): Promise<{ archived: boolean; hasActiveContracts: boolean }> => {
    const { data } = await api.delete(`/profile/me/service-packages/${id}`);
    return data;
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
  // Withdraw/cancel BEFORE any money has settled (PENDING_REVIEW / PENDING_PAYMENT) — a
  // plain status flip, nothing to refund because nothing was ever paid.
  cancelContract: async (id: string, reason: string) => {
    const { data } = await api.patch(`/contracts/${id}/cancel`, { reason });
    return data;
  },
  // End an ACTIVE (paid) contract and settle everyone per the termination reason's formula
  // — see docs/money-flow.md §3.3–3.6. CLIENT_CANCELLED refunds 90% of the unused value
  // (10% penalty); PT_REPEATED_NO_SHOW (Vòng 4 / Phase E2) refunds 100% — the backend
  // independently re-counts confirmed PT no-shows before allowing it, never trusting this call.
  terminateContract: async (id: string, reason: "CLIENT_CANCELLED" | "PT_CANCELLED" | "PT_REPEATED_NO_SHOW") => {
    const { data } = await api.post(`/contracts/${id}/terminate`, { reason });
    return data;
  },
  // Read-only preview of what a CLIENT_CANCELLED termination would pay out right now —
  // shown before the client confirms so they see the actual refund, not a guess.
  getMoneyBreakdown: async (id: string) => {
    const { data } = await api.get(`/contracts/${id}/money-breakdown`);
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
  // Roadmap P4.1 "Notifications/reminders" (§27) — PT sends a feedback
  // message to their client on an active contract.
  sendFeedback: async (contractId: string, text: string) => {
    const { data } = await api.post(`/contracts/${contractId}/feedback`, { text });
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
  // Money-flow plan 4.1: the CLIENT's side of confirming/disputing what the PT reported —
  // distinct from confirmSession above (PT accepting a REQUESTED booking).
  listPendingConfirmation: async () => {
    const { data } = await api.get("/sessions/pending-confirmation");
    return data;
  },
  clientConfirmSession: async (id: string) => {
    const { data } = await api.post(`/sessions/${id}/confirm`);
    return data;
  },
  disputeSession: async (id: string, reason: string) => {
    const { data } = await api.post(`/sessions/${id}/dispute`, { reason });
    return data;
  },
  // Money-flow plan 4.3 — client reports the PT never showed up, and the PT's response.
  reportPtNoShow: async (id: string, reason: string) => {
    const { data } = await api.post(`/sessions/${id}/report-no-show`, { reason });
    return data;
  },
  respondToNoShowReport: async (id: string, response: "AGREE" | "DENY", note?: string) => {
    const { data } = await api.post(`/sessions/${id}/respond-no-show`, { response, note });
    return data;
  },
  listNoShowReports: async () => {
    const { data } = await api.get("/sessions/no-show-reports");
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
  // Mirror-image of reviewSession — PT rates the client instead of the client rating the PT.
  reviewClient: async (id: string, rating: number, comment?: string) => {
    const { data } = await api.post(`/sessions/${id}/review-client`, {
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
      // Open-room fields (booking.service.ts's joinSession) — let the room UI show a live
      // countdown / closing warning without hardcoding or re-deriving these itself.
      roomOpensAt: string;
      roomClosesAt: string;
      ptLateAfter: string;
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
  // Roadmap P4.1 "Notifications/reminders" (§27) — preference controls.
  getPreferences: async (): Promise<NotificationPreferences> => {
    const { data } = await api.get("/notifications/preferences");
    return data;
  },
  updatePreferences: async (patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> => {
    const { data } = await api.put("/notifications/preferences", patch);
    return data;
  },
};

// Roadmap P4.1 "Notifications/reminders" (§27).
export interface NotificationPreferences {
  workoutUpcomingEnabled: boolean;
  workoutRescheduledEnabled: boolean;
  workoutUnfinishedEnabled: boolean;
  planUpdatedEnabled: boolean;
  ptFeedbackEnabled: boolean;
}

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
  // Actively asks the gateway for this transaction's status — works for any purchase
  // (membership, PT contract), not just the old wallet top-up. Used by the gateway
  // return-page (PaymentResultPage) for every provider, since none of them can reach this
  // deployment's IPN URL.
  syncTransaction: async (transactionId: string) => {
    const { data } = await api.post(`/me/payments/${transactionId}/sync`);
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
  // Always the PT earnings wallet.
  getPtWallet: async () => {
    const { data } = await api.get('/me/pt-wallet');
    return data?.data ?? data;
  },
  getPtTransactions: async () => {
    const { data } = await api.get('/me/pt-wallet/transactions');
    return data?.data ?? data;
  },
  // Money-flow plan 5.3 — self-service withdrawal requests. Works for both the CLIENT and PT
  // wallet: payment-service infers which one from the caller's role.
  requestWithdrawal: async (amount: string, payoutInfo: string) => {
    const { data } = await api.post('/me/withdrawals', { amount, payoutInfo });
    return data?.data ?? data;
  },
  getMyWithdrawals: async () => {
    const { data } = await api.get('/me/withdrawals');
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
  // A4 — "gyms where I already have an active membership elsewhere", for the warning shown
  // before confirming a purchase at a *different* gym. Warns, never blocks (money-flow §2.6).
  getMembershipWarnings: async (gymId: string): Promise<Array<{ gymId: string; gymName: string; endDate: string }>> => {
    const { data } = await api.get(`/gyms/${gymId}/membership-warnings`);
    return data?.data ?? data;
  },
  buyMembership: async (
    gymId: string,
    planId: string,
    provider?: string,
    referralCode?: string,
    acknowledgedMultiGymWarning?: boolean,
  ) => {
    const { data } = await api.post(`/gyms/${gymId}/memberships`, {
      planId,
      ...(provider ? { provider } : {}),
      ...(referralCode ? { referralCode } : {}),
      ...(acknowledgedMultiGymWarning ? { acknowledgedMultiGymWarning: true } : {}),
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
  // Cancel an ACTIVE membership. Money-flow plan §2.4: the client forfeits the unused
  // portion — there is no refund on this path (a prorated refund is now an admin-only
  // exceptional action at POST /admin/gym-memberships/:id/refund). The old client-facing
  // .../refund route this used to call no longer exists on the backend.
  cancelActiveMembership: async (membershipId: string) => {
    const { data } = await api.post(`/me/gym-memberships/${membershipId}/cancel-membership`);
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
  // GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell: draft/auto-save/resume.
  createGymDraft: async () => {
    const { data } = await api.post('/owner/gyms/draft', {});
    return data?.data ?? data;
  },
  updateGymDraft: async (
    gymId: string,
    payload: Partial<{
      name: string; description: string; address: string; city: string; phone: string; email: string;
      provinceCode: number | null; wardCode: number | null; latitude: number | null; longitude: number | null;
      locationNote: string; facilities: import('../types').GymFacility[]; wizardStep: number;
    }>,
  ) => {
    const { data } = await api.patch(`/owner/gyms/${gymId}/draft`, payload);
    return data?.data ?? data;
  },
  // Rejects with the usual axios error shape on 4xx — a failed submit's per-field issue list
  // lives at e.response.data.error.issues (see gym-draft.controller.ts's fail()), same
  // convention every other mutation in this file already relies on.
  submitGymDraft: async (gymId: string) => {
    const { data } = await api.post(`/owner/gyms/${gymId}/submit`, {});
    return data?.data ?? data;
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74: free edit whether DRAFT
  // or already APPROVED — one pair of endpoints serves both the wizard and the post-approval
  // branch workspace.
  getGymHours: async (gymId: string): Promise<import('../types').GymOperatingHoursDay[]> => {
    const { data } = await api.get(`/owner/gyms/${gymId}/hours`);
    return data?.data ?? data;
  },
  setGymHours: async (
    gymId: string,
    days: Pick<import('../types').GymOperatingHoursDay, 'day' | 'type' | 'openMinute' | 'closeMinute'>[],
  ): Promise<import('../types').GymOperatingHoursDay[]> => {
    const { data } = await api.put(`/owner/gyms/${gymId}/hours`, { days });
    return data?.data ?? data;
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery — fileName joins with
  // GYM_PHOTO_BASE_URL (below) to form a plain <img src>, no auth-gated blob fetch needed.
  listGymPhotos: async (gymId: string): Promise<import('../types').GymPhoto[]> => {
    const { data } = await api.get(`/owner/gyms/${gymId}/photos`);
    return data?.data ?? data;
  },
  uploadGymPhoto: async (gymId: string, file: UploadFile): Promise<import('../types').GymPhoto> => {
    const formData = new FormData();
    appendUpload(formData, 'photo', file);
    const { data } = await api.post(`/owner/gyms/${gymId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data?.data ?? data;
  },
  deleteGymPhoto: async (gymId: string, photoId: string) => {
    const { data } = await api.delete(`/owner/gyms/${gymId}/photos/${photoId}`);
    return data?.data ?? data;
  },
  setGymPhotoCover: async (gymId: string, photoId: string): Promise<import('../types').GymPhoto[]> => {
    const { data } = await api.patch(`/owner/gyms/${gymId}/photos/${photoId}/cover`);
    return data?.data ?? data;
  },
  reorderGymPhotos: async (gymId: string, photoIds: string[]): Promise<import('../types').GymPhoto[]> => {
    const { data } = await api.put(`/owner/gyms/${gymId}/photos/reorder`, { photoIds });
    return data?.data ?? data;
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". Private — fileToken needs
  // AuthenticatedImage (blob fetch with auth), same convention as complaint photos.
  listBranchDocuments: async (
    gymId: string,
  ): Promise<{ documents: import('../types').GymBranchDocument[]; partnerContext: import('../types').PartnerDocumentContext[]; gymId: string }> => {
    const { data } = await api.get(`/owner/gyms/${gymId}/branch-documents`);
    return data?.data ?? data;
  },
  uploadBranchDocument: async (
    gymId: string,
    docType: import('../types').BranchDocumentType,
    file: UploadFile,
  ): Promise<import('../types').GymBranchDocument> => {
    const formData = new FormData();
    appendUpload(formData, 'file', file);
    const { data } = await api.post(`/owner/gyms/${gymId}/branch-documents/${docType}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data?.data ?? data;
  },
  /** Returns a local `file://` URI, not a Blob — see the note above exportService. */
  fetchBranchDocumentFile: async (token: string): Promise<string> => {
    return downloadAuthenticatedFile(`/owner/branch-documents/${token}`, `branch-document-${token}`);
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 4 — the wizard's "fix loop" banner: what admin flagged
  // last time this branch was sent back from PENDING_REVIEW to DRAFT.
  listOpenReviewIssues: async (gymId: string): Promise<import('../types').GymBranchReviewIssue[]> => {
    const { data } = await api.get(`/owner/gyms/${gymId}/review-issues`);
    return data?.data ?? data;
  },
  createGym: async (payload: {
    name: string; description?: string; address: string; city?: string; phone?: string; email?: string;
    provinceCode?: number | null; wardCode?: number | null; latitude?: number | null; longitude?: number | null;
  }) => {
    const { data } = await api.post('/owner/gyms', payload);
    return data?.data ?? data;
  },
  getOwnedGym: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}`);
    return data?.data ?? data;
  },
  // Vòng 4 / Phase C2 — name/address only ever move pendingName/pendingAddress (public
  // display waits for admin approval). GYM_BRANCH_FORM_SPEC.md §51/§79/§89 — no brandId here
  // any more; a branch permanently belongs to the owner's one brand (see gym.schemas.ts's
  // own doc comment for why the field was removed, not just left unused).
  updateGym: async (
    gymId: string,
    payload: Partial<{
      name: string; description: string; address: string; city: string; phone: string; email: string;
      provinceCode: number | null; wardCode: number | null; latitude: number | null; longitude: number | null;
      locationNote: string; facilities: import('../types').GymFacility[];
    }>,
  ) => {
    const { data } = await api.patch(`/owner/gyms/${gymId}`, payload);
    return data?.data ?? data;
  },
  // GYM_BRANCH_FORM_SPEC.md, Phase 5 — shown before confirming permanent closure.
  getClosureImpact: async (
    gymId: string,
  ): Promise<{ activeMembers: number; unusedValueTotal: number; activeCollaborations: number; walletBalance: number }> => {
    const { data } = await api.get(`/owner/gyms/${gymId}/closure-impact`);
    return data?.data ?? data;
  },
  // Vòng 4 / Phase C3 — owner's own open/close switch. `reason` required for
  // TEMPORARILY_CLOSED/PERMANENTLY_CLOSED, ignored for OPEN (reopen).
  setGymOperationalStatus: async (
    gymId: string,
    operationalStatus: 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED',
    reason?: string,
    // GYM_MANAGEMENT master spec §61 (Phase 1 backend) — only meaningful for TEMPORARILY_CLOSED.
    expectedReopenAt?: string,
  ) => {
    const { data } = await api.patch(`/owner/gyms/${gymId}/operational-status`, {
      operationalStatus,
      ...(reason ? { reason } : {}),
      ...(expectedReopenAt ? { expectedReopenAt } : {}),
    });
    return data?.data ?? data;
  },
  getOwnedWallet: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/wallet`);
    return data?.data ?? data;
  },
  // Money-flow plan 5.3 — gym-service verifies gym ownership itself before proxying to
  // payment-service, same shape as getOwnedWallet above.
  requestGymWithdrawal: async (gymId: string, amount: string, payoutInfo: string) => {
    const { data } = await api.post(`/owner/gyms/${gymId}/withdrawals`, { amount, payoutInfo });
    return data?.data ?? data;
  },
  listGymWithdrawals: async (gymId: string) => {
    const { data } = await api.get(`/owner/gyms/${gymId}/withdrawals`);
    return data?.data ?? data;
  },
  // Plans are brand-scoped now (one owner, one brand — a plan works at every branch under
  // it), so these hang off /owner/brands/:brandId rather than any one gym's id.
  createPlan: async (
    brandId: string,
    payload: { name: string; description?: string; price: number; durationDays: number; visitLimit?: number; saleStartAt?: string; saleEndAt?: string },
  ) => {
    const { data } = await api.post(`/owner/brands/${brandId}/plans`, payload);
    return data?.data ?? data;
  },
  updatePlan: async (
    brandId: string,
    planId: string,
    payload: Partial<{ name: string; description: string; price: number; durationDays: number; visitLimit: number; status: 'ACTIVE' | 'INACTIVE'; saleStartAt: string | null; saleEndAt: string | null }>,
  ) => {
    const { data } = await api.patch(`/owner/brands/${brandId}/plans/${planId}`, payload);
    return data?.data ?? data;
  },
  listOwnedPlans: async (brandId: string) => {
    const { data } = await api.get(`/owner/brands/${brandId}/plans`);
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

  // ── GYM_MANAGEMENT master spec, Phase 5 — "Báo cáo vấn đề" (riêng tư, khác review công
  // khai ở trên — hai nút riêng, nhãn khác nhau, theo đúng yêu cầu đã chốt). ──
  uploadComplaintPhoto: async (file: UploadFile): Promise<{ token: string }> => {
    const formData = new FormData();
    appendUpload(formData, "photo", file);
    const { data } = await api.post("/complaint-photos", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data?.data ?? data;
  },
  submitGymComplaint: async (
    gymId: string,
    payload: { issueType: string; description: string; photoTokens?: string[] },
  ) => {
    const { data } = await api.post(`/gyms/${gymId}/complaints`, payload);
    return data?.data ?? data;
  },
  listMyComplaints: async () => {
    const { data } = await api.get("/me/complaints");
    return data?.data ?? data;
  },
  /** Ảnh minh chứng riêng tư — không có URL công khai nào để dùng thẳng trong `<Image source>`,
   * phải tải kèm header xác thực xuống file cục bộ rồi trỏ vào `file://` URI đó. Dùng chung cho
   * cả người báo cáo xem lại ảnh của chính mình (route `/complaint-photos/:token`, không phải
   * `/admin/...` — xem adminService.fetchComplaintPhotoFile cho phía admin). */
  fetchComplaintPhotoFile: async (token: string): Promise<string> => {
    return downloadAuthenticatedFile(`/complaint-photos/${token}`, `complaint-photo-${token}`);
  },

  // ── Quản lý đối tác — Phase 3: trình thiết lập lần đầu + tự quản lý người quản lý ──
  getOnboardingStatus: async () => {
    const { data } = await api.get('/owner/onboarding/status');
    return data?.data ?? data;
  },
  submitOnboardingContact: async (phone: string) => {
    const { data } = await api.patch('/owner/onboarding/contact', { phone });
    return data?.data ?? data;
  },
  submitOnboardingBrand: async (payload: { name: string; description?: string }) => {
    const { data } = await api.post('/owner/onboarding/brand', payload);
    return data?.data ?? data;
  },
  submitOnboardingPayout: async (payload: { bankName: string; accountNumber: string; accountHolder: string }) => {
    const { data } = await api.patch('/owner/onboarding/payout', payload);
    return data?.data ?? data;
  },
  submitOnboardingTerms: async (version?: string) => {
    const { data } = await api.post('/owner/onboarding/terms', { version });
    return data?.data ?? data;
  },

  listPartnerAccounts: async () => {
    const { data } = await api.get('/owner/partner-accounts');
    return data?.data ?? data;
  },
  revokePartnerAccount: async (accountId: string, reason?: string) => {
    const { data } = await api.delete(`/owner/partner-accounts/${accountId}`, { data: { reason } });
    return data?.data ?? data;
  },
  listPartnerInvitations: async () => {
    const { data } = await api.get('/owner/partner-invitations');
    return data?.data ?? data;
  },
  inviteManager: async (payload: { email: string; scopedGymIds: string[] }) => {
    const { data } = await api.post('/owner/partner-invitations', payload);
    return data?.data ?? data;
  },
  resendManagerInvitation: async (id: string) => {
    const { data } = await api.post(`/owner/partner-invitations/${id}/resend`);
    return data?.data ?? data;
  },
  revokeManagerInvitation: async (id: string) => {
    const { data } = await api.delete(`/owner/partner-invitations/${id}`);
    return data?.data ?? data;
  },

  // ── Thư mời đối tác — công khai, không cần đăng nhập ──────────────────────────
  previewPartnerInvitation: async (token: string) => {
    const { data } = await api.get(`/partner-invitations/${token}`);
    return data?.data ?? data;
  },
  acceptPartnerInvitation: async (token: string, payload: { password: string; firstName: string; lastName?: string }) => {
    const { data } = await api.post(`/partner-invitations/${token}/accept`, payload);
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

// Roadmap P1.8 "Logging-mode catalog discoverability"
// (docs/features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md).
export interface CatalogQualityRow {
  id: string;
  exerciseName: string;
  loggingMode: string;
  publicationStatus: string;
  equipment: string;
  muscles: string[];
  hasVideo: boolean;
  dataLicense: string | null;
  mediaLicense: string | null;
  sourceName: string | null;
  reviewStatus: string;
}

export interface CatalogQualitySummary {
  total: number;
  byPublicationStatus: Record<string, number>;
  byLoggingMode: Record<string, number>;
  missingVideo: number;
  missingMediaLicense: number;
  noReviewRecord: number;
}

export const catalogQualityService = {
  getMatrix: async (params?: {
    loggingMode?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    rows: CatalogQualityRow[];
    pagination: { page: number; limit: number; total: number };
    summary: CatalogQualitySummary;
  }> => {
    const qs = new URLSearchParams();
    if (params?.loggingMode) qs.set("loggingMode", params.loggingMode);
    if (params?.status) qs.set("status", params.status);
    if (params?.search) qs.set("search", params.search);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const { data } = await api.get(`/exercises/admin/catalog-quality-matrix?${qs.toString()}`);
    return data;
  },
};

// Roadmap P2 "Canonical import framework" + P2.1 "Hevy import"
// (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
export interface ImportMatchCandidate {
  id: string;
  name: string;
  confidence: number;
}

export interface ImportExerciseMatchSummary {
  exerciseTitle: string;
  candidates: ImportMatchCandidate[];
  isExactMatch: boolean;
}

export interface ImportPreviewResult {
  blocked: boolean;
  reason?: string;
  batchId?: string;
  workoutCount?: number;
  futureWorkoutCount?: number;
  dateRange?: { earliest: string | null; latest: string | null };
  alreadyImportedCount?: number;
  exerciseMatchSummary?: ImportExerciseMatchSummary[];
  rowErrors: Array<{ rowIndex: number; message: string }>;
}

export type ImportExerciseResolution =
  | { action: "USE_EXISTING"; exerciseId: string }
  | {
      action: "CREATE_CUSTOM";
      input: {
        exerciseName?: string;
        typeOfActivity: string;
        typeOfEquipment: string;
        bodyPart: string;
        type: string;
        loggingMode: string;
        muscleGroupsActivated?: string[];
        instructions?: string;
      };
    }
  | { action: "SKIP" };

export interface ImportCommitResult {
  committedWorkoutCount: number;
  alreadyImportedSkippedCount: number;
  skippedExerciseSetCount: number;
  createdWorkoutIds: string[];
}

export interface ImportBatchSummary {
  id: string;
  source: string;
  fileName: string;
  status: "PREVIEW" | "COMMITTED" | "CANCELLED";
  createdAt: string;
  committedAt: string | null;
  createdWorkoutIds: string[];
}

export const importService = {
  previewHevy: async (fileName: string, csvContent: string): Promise<ImportPreviewResult> => {
    const { data } = await api.post("/imports/hevy/preview", { fileName, csvContent });
    return data;
  },
  // Roadmap P2.2 "Strong import" — same request/response shape as Hevy.
  previewStrong: async (fileName: string, csvContent: string): Promise<ImportPreviewResult> => {
    const { data } = await api.post("/imports/strong/preview", { fileName, csvContent });
    return data;
  },
  // Roadmap P2.3 "FitNotes import" — same request/response shape again.
  previewFitNotes: async (fileName: string, csvContent: string): Promise<ImportPreviewResult> => {
    const { data } = await api.post("/imports/fitnotes/preview", { fileName, csvContent });
    return data;
  },
  commit: async (batchId: string, resolutions: Record<string, ImportExerciseResolution>): Promise<ImportCommitResult> => {
    const { data } = await api.post(`/imports/${encodeURIComponent(batchId)}/commit`, { resolutions });
    return data;
  },
  cancel: async (batchId: string): Promise<{ status: string }> => {
    const { data } = await api.post(`/imports/${encodeURIComponent(batchId)}/cancel`, {});
    return data;
  },
  list: async (): Promise<{ batches: ImportBatchSummary[] }> => {
    const { data } = await api.get("/imports");
    return data;
  },
};

// Roadmap P2.5 "Export / data portability"
// (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
//
// PORT NOTE — every function on web that returned a `Blob` returns a local `file://` URI here
// instead, and is named `...File` rather than `...Blob`. There is no Blob URL on native: a private
// image is shown by pointing `<Image source>` at a real file, and a "download" is a file written
// to app storage and handed to the OS share sheet (MOBILE_PLATFORM_ADAPTERS.md §3/§4). The rename
// is deliberate — keeping the `Blob` name on something that no longer returns one would mislead
// every screen ported later.
//
// These two keep going through axios rather than the native downloader in services/files.ts
// because they need the response's Content-Disposition header to learn the server's file name;
// the payloads are small JSON/CSV, so passing them through JS is not a concern.
export const exportService = {
  downloadJson: async (): Promise<{ uri: string; fileName: string }> => {
    const res = await api.get("/exports/json", { responseType: "text" });
    const fileName = extractFileName(res.headers["content-disposition"], "fitness-assistant-export.json");
    return { uri: writeLocalFile(fileName, res.data as string), fileName };
  },
  downloadCsv: async (): Promise<{ uri: string; fileName: string }> => {
    const res = await api.get("/exports/csv", { responseType: "text" });
    const fileName = extractFileName(res.headers["content-disposition"], "fitness-assistant-workouts.csv");
    return { uri: writeLocalFile(fileName, res.data as string), fileName };
  },
};

function extractFileName(contentDisposition: string | undefined, fallback: string): string {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/** The native stand-in for web's hidden-`<a download>` trick: hands an already-written local file
 *  to the OS share sheet, which is the only route out of the app sandbox. */
export async function shareDownloadedFile(uri: string, mimeType?: string): Promise<void> {
  return shareLocalFile(uri, mimeType);
}

// Roadmap P2.6 "Workout template sharing/import"
// (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
export interface WorkoutProgramTemplate {
  id: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  goal: string | null;
  durationWeeks: number;
  daysPerWeek: number;
  daysJson: Array<{ dayNumber: number; title: string; exercises: Array<{ exerciseId: string; sets: number; reps: number; restSeconds: number }> }>;
  sharedWithUserIds: string[];
  createdAt: string;
}

export const templateService = {
  createFromProgram: async (input: { programId: string; name?: string; description?: string }): Promise<{ template: WorkoutProgramTemplate }> => {
    const { data } = await api.post("/templates", input);
    return data;
  },
  share: async (templateId: string, recipientUserId: string): Promise<{ template: WorkoutProgramTemplate }> => {
    const { data } = await api.post(`/templates/${templateId}/share`, { recipientUserId });
    return data;
  },
  listMine: async (): Promise<{ templates: WorkoutProgramTemplate[] }> => {
    const { data } = await api.get("/templates/mine");
    return data;
  },
  listSharedWithMe: async (): Promise<{ templates: WorkoutProgramTemplate[] }> => {
    const { data } = await api.get("/templates/shared-with-me");
    return data;
  },
  importTemplate: async (
    templateId: string,
    placement: { startDate: string; selectedWeekdays: number[]; repeatWeeks?: number; replaceExisting?: boolean },
  ): Promise<any> => {
    const { data } = await api.post(`/templates/${templateId}/import`, placement);
    return data;
  },
};

// Roadmap P3.1 "Muscle heatmap"
// (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
export interface MuscleHeatmapEntry {
  muscleId: string;
  code: string;
  nameVi: string;
  nameEn: string | null;
  anatomyRegion: string | null;
  score: number;
  intensity: number;
}

export interface MuscleHeatmapResult {
  range: "7d" | "30d" | "cycle" | "custom";
  from: string;
  to: string;
  noActiveCycle: boolean;
  muscles: MuscleHeatmapEntry[];
}

// Roadmap P3.2 "Activity heatmap"
// (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
export type ActivityDayState = "completed" | "partial" | "missed" | "rescheduled" | "rest";

export interface ActivityHeatmapResult {
  from: string;
  to: string;
  days: Array<{ date: string; state: ActivityDayState | null }>;
}

export interface ActivityDayDetail {
  date: string;
  state: ActivityDayState | null;
  workout: { id: string; name: string; exerciseCount: number | null } | null;
  volumeKg: number | null;
  durationMinutes: number | null;
  prs: Array<{ exerciseId: string; exerciseName: string; prType: string; weightKg: number | null; reps: number | null; estimated1RmKg: number | null }>;
  rpeAverage: number | null;
  rirAverage: number | null;
  notes: string | null;
}

// Roadmap P3.3 "Exercise progress charts"
// (docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
export type ExerciseLoggingMode = "REPS_LOAD" | "BODYWEIGHT_REPS" | "TIME" | "TIME_LOAD" | "DISTANCE_TIME";

export interface ExerciseProgressSessionPoint {
  date: string;
  workoutId: string;
  maxWeightKg: number | null;
  repsAtMaxWeight: number | null;
  maxReps: number | null;
  bestEstimated1RmKg: number | null;
  bestSetWeightKg: number | null;
  bestSetReps: number | null;
  maxDurationSeconds: number | null;
  maxDistanceMeters: number | null;
  bestPaceSecPerKm: number | null;
}

export interface ExerciseProgressResult {
  exerciseId: string;
  exerciseName: string;
  loggingMode: ExerciseLoggingMode;
  from: string | null;
  to: string | null;
  sessions: ExerciseProgressSessionPoint[];
}

export const statsService = {
  getMuscleHeatmap: async (params: { range: "7d" | "30d" | "cycle" | "custom"; from?: string; to?: string }): Promise<MuscleHeatmapResult> => {
    const qs = new URLSearchParams({ range: params.range });
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    const { data } = await api.get(`/stats/muscle-heatmap?${qs.toString()}`);
    return data;
  },
  getActivityHeatmap: async (from: string, to: string): Promise<ActivityHeatmapResult> => {
    const { data } = await api.get(`/stats/activity-heatmap?from=${from}&to=${to}`);
    return data;
  },
  getActivityDayDetail: async (date: string): Promise<ActivityDayDetail> => {
    const { data } = await api.get(`/stats/activity-heatmap/day/${date}`);
    return data;
  },
  getExerciseProgress: async (exerciseId: string, params?: { from?: string; to?: string }): Promise<ExerciseProgressResult> => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const { data } = await api.get(`/stats/exercise-progress/${exerciseId}${suffix}`);
    return data;
  },
};

export default api;
