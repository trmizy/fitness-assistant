export interface PlanExplanationResponse {
  planId: string;
  explanation: string;
  source: 'llm' | 'fallback';
  warnings: string[];
}
import axios from 'axios';
import { makeRefreshOnce } from './refresh-once';

// @ts-ignore - ImportMeta.env is provided by Vite
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

type RetriableRequestConfig = {
  _retry?: boolean;
  headers?: Record<string, string>;
  url?: string;
};

const refreshClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

const refreshOnce = makeRefreshOnce(refreshAccessToken);

function hasUsableToken(token: string | null): token is string {
  return !!token && token !== 'null' && token !== 'undefined';
}

function clearSessionAndRedirectToLogin() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
    window.location.href = '/login';
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!hasUsableToken(refreshToken)) return null;

  try {
    const { data } = await refreshClient.post('/auth/refresh', { refreshToken });
    if (hasUsableToken(data?.accessToken)) {
      localStorage.setItem('accessToken', data.accessToken);
      if (hasUsableToken(data?.refreshToken)) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
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
    const requestUrl = originalRequest.url || '';

    const isAuthEndpoint =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/register') ||
      requestUrl.includes('/auth/refresh');

    const isTokenIssue =
      code === 'UNAUTHORIZED' ||
      (typeof message === 'string' && /token|unauthorized/i.test(message));

    if (status === 401 && isTokenIssue && !isAuthEndpoint && !originalRequest._retry) {
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
    const { data } = await api.post('/auth/login', { email, password });
    // Store tokens directly from auth service response
    if (data.accessToken) {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  register: async (email: string, password: string, firstName: string, lastName: string) => {
    const { data } = await api.post('/auth/register', { email, password, firstName, lastName });
    return data;
  },

  verifyRegistration: async (email: string, otp: string) => {
    const { data } = await api.post('/auth/register/verify', { email, otp });
    if (data.accessToken) {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      return { success: true, user: data.user };
    }
    return { success: false };
  },

  logout: () => {
    localStorage.clear();
    window.location.href = '/login';
  },
};

export const profileService = {
  getProfile: async () => {
    const { data } = await api.get('/profile/me');
    return data;
  },

  updateProfile: async (profile: any) => {
    const { data } = await api.put('/profile/me', profile);
    return data;
  },

  uploadPhoto: async (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    const { data } = await api.post('/profile/me/photo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data as { photoUrl: string };
  },

  becomePT: async () => {
    const { data } = await api.patch('/profile/me/become-pt');
    return data;
  },

  listPTs: async () => {
    const { data } = await api.get('/profile/pts');
    return data;
  },
};

export const inbodyService = {
  create: async (entry: any) => {
    const { data } = await api.post('/inbody', entry);
    return data;
  },

  getLatest: async () => {
    const { data } = await api.get('/inbody/latest'); // We need to add /latest to backend too or just use history[0]
    return data;
  },

  getHistory: async () => {
    const { data } = await api.get('/inbody');
    return data;
  },

  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    const { data } = await api.post('/inbody/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // OCR can take longer than normal API calls on larger or low-quality images.
      timeout: 180000,
    });
    return data;
  },
};

export const workoutService = {
  logWorkout: async (workout: any) => {
    const { data } = await api.post('/workouts', workout);
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

  getExercises: async () => {
    const { data } = await api.get('/exercises');
    return data;
  },

  getStats: async () => {
    const { data } = await api.get('/stats/workouts');
    return data;
  },

  getSchedules: async (limit = 20) => {
    const { data } = await api.get(`/workouts/schedules?limit=${limit}`);
    return data;
  },

  getPRs: async (exerciseId?: string) => {
    const url = exerciseId ? `/workouts/prs?exerciseId=${exerciseId}` : '/workouts/prs';
    const { data } = await api.get(url);
    return data;
  },

  updateSet: async (setId: string, patch: { reps?: number; weight?: number; rpe?: number; completed?: boolean }) => {
    const { data } = await api.patch(`/workouts/sets/${setId}`, patch);
    return data;
  },
};

export type PlanStatusBackend = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

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
  sourcePlanId?: string | null;
  sourceType?: string | null;
  notes?: string | null;
  programDay?: WorkoutScheduleProgramDayRecord | null;
  workout?: unknown | null;
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
  return typeof value === 'object' && value !== null;
}

function unwrapApiPayload<T = unknown>(payload: unknown): T {
  if (isRecord(payload) && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function normalizePlanStatus(value: unknown): PlanStatusBackend {
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper === 'QUEUED' || upper === 'PROCESSING' || upper === 'COMPLETED' || upper === 'FAILED') {
      return upper;
    }
    if (upper === 'WAITING' || upper === 'DELAYED') return 'QUEUED';
    if (upper === 'ACTIVE') return 'PROCESSING';
  }
  return 'QUEUED';
}

function extractPlanJobResponse(payload: unknown): PlanJobResponse {
  const data = unwrapApiPayload<unknown>(payload);
  if (!isRecord(data)) {
    throw new Error('Invalid generate/adjust response payload');
  }

  const planId = typeof data.planId === 'string' ? data.planId : '';
  const jobId = typeof data.jobId === 'string' ? data.jobId : '';
  const status = normalizePlanStatus(data.status);

  if (!planId || !jobId) {
    throw new Error('Missing planId/jobId in generate/adjust response');
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

  throw new Error('Invalid plan detail response');
}

function extractJobStatus(payload: unknown): PlanJobStatusResponse {
  const data = unwrapApiPayload<unknown>(payload);
  if (!isRecord(data)) {
    throw new Error('Invalid job status response payload');
  }

  return {
    jobId: typeof data.jobId === 'string' ? data.jobId : undefined,
    planId: typeof data.planId === 'string' ? data.planId : null,
    status: normalizePlanStatus(data.status),
    failReason: typeof data.failReason === 'string' ? data.failReason : null,
  };
}

function extractExplanation(payload: unknown): PlanExplanationResponse {
  const unwrapped = unwrapApiPayload<unknown>(payload);
  if (typeof unwrapped === 'string') {
    return { planId: '', explanation: unwrapped, source: 'llm', warnings: [] };
  }

  if (isRecord(unwrapped)) {
    if (typeof unwrapped.explanation === 'string') {
      return {
        planId: typeof unwrapped.planId === 'string' ? unwrapped.planId : '',
        explanation: unwrapped.explanation,
        source: unwrapped.source === 'fallback' ? 'fallback' : 'llm',
        warnings: Array.isArray(unwrapped.warnings) ? unwrapped.warnings.filter((item): item is string => typeof item === 'string') : [],
      };
    }
    if (isRecord(unwrapped.data) && typeof unwrapped.data.explanation === 'string') {
      return {
        planId: typeof unwrapped.data.planId === 'string' ? unwrapped.data.planId : '',
        explanation: unwrapped.data.explanation,
        source: unwrapped.data.source === 'fallback' ? 'fallback' : 'llm',
        warnings: Array.isArray(unwrapped.data.warnings) ? unwrapped.data.warnings.filter((item): item is string => typeof item === 'string') : [],
      };
    }
    return {
      planId: '',
      explanation: JSON.stringify(unwrapped, null, 2),
      source: 'llm',
      warnings: [],
    };
  }

  return { planId: '', explanation: String(unwrapped ?? ''), source: 'llm', warnings: [] };
}

function extractLlmHealth(payload: unknown): LlmHealthStatus {
  const unwrapped = unwrapApiPayload<unknown>(payload);
  if (isRecord(unwrapped) && typeof unwrapped.llmAvailable === 'boolean') {
    return {
      llmAvailable: unwrapped.llmAvailable,
      llmProvider: typeof unwrapped.llmProvider === 'string' ? unwrapped.llmProvider : 'unknown',
      llmUrl: typeof unwrapped.llmUrl === 'string' ? unwrapped.llmUrl : '',
      model: typeof unwrapped.model === 'string' ? unwrapped.model : '',
      embeddingModel: typeof unwrapped.embeddingModel === 'string' ? unwrapped.embeddingModel : '',
      checkedAt: typeof unwrapped.checkedAt === 'string' ? unwrapped.checkedAt : new Date().toISOString(),
      error: typeof unwrapped.error === 'string' ? unwrapped.error : undefined,
    };
  }

  return {
    llmAvailable: false,
    llmProvider: 'unknown',
    llmUrl: '',
    model: '',
    embeddingModel: '',
    checkedAt: new Date().toISOString(),
    error: 'Invalid LLM health response',
  };
}

export const planService = {
  getLlmHealth: async (): Promise<LlmHealthStatus> => {
    const { data } = await api.get('/plans/llm-health', {
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
    const { data } = await api.post('/plans/workout/generate', input);
    return extractPlanJobResponse(data);
  },

  getCurrentPlans: async (includeArchived = false): Promise<WorkoutPlanRecord[]> => {
    const { data } = await api.get(`/plans/current${includeArchived ? '?includeArchived=true' : ''}`);
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

  explainPlan: async (planId: string, lang = 'vi'): Promise<PlanExplanationResponse> => {
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
    input: { startDate?: string; repeatWeeks?: number },
  ): Promise<{
    sourcePlanId: string;
    createdProgramId?: string;
    createdScheduleCount: number;
    skippedDuplicateCount: number;
    alreadyExists?: boolean;
    message?: string;
  }> => {
    const { data } = await api.post(`/plans/${planId}/save-to-workout-log`, input);
    const unwrapped = unwrapApiPayload<unknown>(data);

    if (isRecord(unwrapped)) {
      return {
        sourcePlanId: typeof unwrapped.sourcePlanId === 'string' ? unwrapped.sourcePlanId : planId,
        createdProgramId: typeof unwrapped.createdProgramId === 'string' ? unwrapped.createdProgramId : undefined,
        createdScheduleCount: typeof unwrapped.createdScheduleCount === 'number' ? unwrapped.createdScheduleCount : 0,
        skippedDuplicateCount: typeof unwrapped.skippedDuplicateCount === 'number' ? unwrapped.skippedDuplicateCount : 0,
        alreadyExists: typeof unwrapped.alreadyExists === 'boolean' ? unwrapped.alreadyExists : undefined,
        message: typeof unwrapped.message === 'string' ? unwrapped.message : undefined,
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
    const body: { planId: string; adjustments: string; daysPerWeek?: number; exercisesPerDay?: number } = {
      planId,
      adjustments,
    };
    if (typeof daysPerWeek === 'number') {
      body.daysPerWeek = daysPerWeek;
    }
    if (typeof exercisesPerDay === 'number') {
      body.exercisesPerDay = exercisesPerDay;
    }
    const { data } = await api.post('/plans/adjust', body);
    return extractPlanJobResponse(data);
  },
};

export const coachService = {
  chat: async (message: string) => {
    const { data } = await api.post(
      '/ai/ask',
      { question: message },
      {
        // AI generation can take longer than standard API calls.
        timeout: 120000,
      },
    );
    // AI service wraps responses in {success, data} — unwrap to get answer at top level.
    return data?.data ?? data;
  },

  getConversations: async () => {
    const { data } = await api.get('/ai/conversations');
    return data?.data ?? data;
  },

  chatStream(
    message: string,
    callbacks: {
      onStatus: (status: string) => void;
      onToken: (token: string) => void;
      onDone: () => void;
      onError: (message: string) => void;
    },
  ): () => void {
    const token = localStorage.getItem('accessToken');
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(`${API_URL}/ai/ask/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && token !== 'null' && token !== 'undefined'
              ? { Authorization: `Bearer ${token}` }
              : {}),
          },
          body: JSON.stringify({ question: message }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          callbacks.onError('Could not connect to AI service');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedFinalEvent = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6)) as Record<string, string>;
              if (event['type'] === 'status') {
                callbacks.onStatus(event['message'] ?? '');
              } else if (event['type'] === 'token') {
                callbacks.onToken(event['content'] ?? '');
              } else if (event['type'] === 'done') {
                receivedFinalEvent = true;
                callbacks.onDone();
              } else if (event['type'] === 'error') {
                receivedFinalEvent = true;
                callbacks.onError(event['message'] ?? 'Unknown error');
              }
            } catch {
              // Ignore malformed SSE lines.
            }
          }
        }

        // Stream ended without a final event — connection was dropped unexpectedly.
        if (!receivedFinalEvent) {
          callbacks.onError('Connection lost. Please try again.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        callbacks.onError('Could not connect to AI service');
      }
    })();

    return () => controller.abort();
  },
};

export const chatService = {
  createDirectConversation: async (targetUserId: string) => {
    const { data } = await api.post('/chat/conversations/direct', { targetUserId });
    return data;
  },

  listConversations: async () => {
    const { data } = await api.get('/chat/conversations');
    return data;
  },

  getMessages: async (conversationId: string, page = 1, limit = 30) => {
    const { data } = await api.get(
      `/chat/conversations/${conversationId}/messages?page=${page}&limit=${limit}`,
    );
    return data;
  },

  sendMessage: async (conversationId: string, content: string) => {
    const { data } = await api.post(`/chat/conversations/${conversationId}/messages`, { content });
    return data;
  },
};

export const adminService = {
  listUsers: async () => {
    const { data } = await api.get('/auth/users');
    return data;
  },

  getDashboard: async () => {
    const { data } = await api.get('/admin/dashboard');
    return data;
  },

  getSystemMonitoring: async () => {
    const { data } = await api.get('/admin/system-monitor');
    return data;
  },

  getWorkflowMeta: async () => {
    const { data } = await api.get('/admin/workflows/meta');
    return data;
  },

  getStudioAuthState: async () => {
    const { data } = await api.get('/admin/workflows/studio-auth-state', {
      withCredentials: true,
    });
    return data;
  },

  listWorkflows: async () => {
    const { data } = await api.get('/admin/workflows');
    return data;
  },

  getWorkflowExecutions: async (workflowId: string, limit = 20) => {
    const { data } = await api.get(`/admin/workflows/${workflowId}/executions?limit=${limit}`);
    return data;
  },

  getExecutionDetail: async (executionId: string) => {
    const { data } = await api.get(`/admin/workflows/executions/${executionId}`);
    return data;
  },

  runSmokeTest: async () => {
    const { data } = await api.post('/admin/workflows/smoke-test', {});
    return data;
  },

  setupSampleWorkflows: async () => {
    const { data } = await api.post('/admin/workflows/setup-samples', {});
    return data;
  },

  listPTProfiles: async () => {
    const { data } = await api.get('/profile/pts');
    return data;
  },

  updateUserRole: async (userId: string, role: 'ADMIN' | 'CUSTOMER' | 'PT') => {
    const { data } = await api.patch(`/auth/users/${userId}/role`, { role });
    return data;
  },

  setPTStatus: async (userId: string, isPT: boolean) => {
    const { data } = await api.patch(`/profile/admin/users/${userId}/pt-status`, { isPT });
    return data;
  },

  runFullSystemTest: async () => {
    const { data } = await api.post(
      '/admin/workflows/full-system-test',
      {},
      { timeout: 120000 },
    );
    return data;
  },

  // ── AI Observability ────────────────────────────────────────────────────────

  getAIOverview: async () => {
    const { data } = await api.get('/admin/ai/overview');
    return data;
  },

  getAIRequests: async (params?: {
    filter?: 'all' | 'fallback' | 'slow' | 'warnings';
    intent?: string;
    page?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.filter && params.filter !== 'all') query.set('filter', params.filter);
    if (params?.intent) query.set('intent', params.intent);
    if (params?.page)   query.set('page',   String(params.page));
    if (params?.limit)  query.set('limit',  String(params.limit));
    const qs = query.toString();
    const { data } = await api.get(`/admin/ai/requests${qs ? `?${qs}` : ''}`);
    return data;
  },

  getAIRequestDetail: async (id: string) => {
    const { data } = await api.get(`/admin/ai/requests/${id}`);
    return data;
  },

  getAIQueue: async () => {
    const { data } = await api.get('/admin/ai/queue');
    return data;
  },

  getAIErrors: async () => {
    const { data } = await api.get('/admin/ai/errors');
    return data;
  },
};

export const foodService = {
  search: async (q: string) => {
    const { data } = await api.get(`/food/search?q=${encodeURIComponent(q)}`);
    return data as Array<{ id: string; name: string; calories: number; protein: number; carbs: number; fats: number; imageUrl: string | null }>;
  },
};

export const nutritionService = {
  getLogs: async (startDate?: string, endDate?: string, mealType?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (mealType) params.append('mealType', mealType);
    const { data } = await api.get(`/nutrition?${params.toString()}`);
    return data;
  },
  createLog: async (log: any) => {
    const { data } = await api.post('/nutrition', log);
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
  getGoal: async () => {
    const { data } = await api.get('/nutrition/goals');
    return data as { id?: string; calories: number; protein: number; carbs: number; fat: number; waterMl: number | null };
  },
  upsertGoal: async (goal: { calories: number; protein: number; carbs: number; fat: number; waterMl?: number }) => {
    const { data } = await api.put('/nutrition/goals', goal);
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
    sessionMode?: 'ONLINE' | 'OFFLINE';
    startDate?: string;
    endDate?: string;
    message?: string;
  }) => {
    const { data } = await api.post('/contracts/request', requestData);
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
    const { data } = await api.get('/contracts/pt/earnings');
    return data;
  },

  // Existing methods
  getByPT: async (status?: string) => {
    const params = status ? `?status=${status}` : '';
    const { data } = await api.get(`/contracts/pt${params}`);
    return data;
  },
  getByClient: async (status?: string) => {
    const params = status ? `?status=${status}` : '';
    const { data } = await api.get(`/contracts/client${params}`);
    return data;
  },
  getById: async (id: string) => {
    const { data } = await api.get(`/contracts/${id}`);
    return data;
  },
  create: async (contractData: any) => {
    const { data } = await api.post('/contracts', contractData);
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
};

export const sessionService = {
  bookSession: async (contractId: string, sessionData: {
    scheduledDate: string;
    scheduledTime: string;
    durationMin?: number;
    sessionMode?: string;
    location?: string;
    notes?: string;
  }) => {
    const { data } = await api.post('/sessions', { contractId, ...sessionData });
    return data;
  },
  getContractSessions: async (contractId: string) => {
    const { data } = await api.get(`/sessions/contract/${contractId}`);
    return data;
  },
  getMyUpcoming: async () => {
    const { data } = await api.get('/sessions/upcoming');
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
  markNoShow: async (id: string, noShowBy: 'CLIENT' | 'PT') => {
    const { data } = await api.patch(`/sessions/${id}/no-show`, { noShowBy });
    return data;
  },
  reviewSession: async (id: string, rating: number, comment?: string) => {
    const { data } = await api.post(`/sessions/${id}/review`, { rating, comment });
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
  setAvailability: async (slots: Array<{
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }>) => {
    const { data } = await api.put('/availability/me', { slots });
    return data;
  },
  getExceptions: async () => {
    const { data } = await api.get('/availability/me/exceptions');
    return data;
  },
  addException: async (date: string, reason?: string) => {
    const { data } = await api.post('/availability/me/exceptions', { date, reason });
    return data;
  },
  removeException: async (id: string) => {
    const { data } = await api.delete(`/availability/me/exceptions/${id}`);
    return data;
  },
  getAvailableSlots: async (ptUserId: string, date: string) => {
    const { data } = await api.get(`/availability/${ptUserId}/slots?date=${date}`);
    return data;
  },
};

export const notificationService = {
  list: async (page = 1, limit = 20) => {
    const { data } = await api.get(`/notifications?page=${page}&limit=${limit}`);
    return data;
  },
  markRead: async (id: string) => {
    const { data } = await api.patch(`/notifications/${id}/read`);
    return data;
  },
  markAllRead: async () => {
    const { data } = await api.patch('/notifications/read-all');
    return data;
  },
  getUnreadCount: async () => {
    const { data } = await api.get('/notifications/unread-count');
    return data;
  },
};

export const ptPlanReviewService = {
  getPendingReviews: async () => {
    const { data } = await api.get('/plans/pt/pending-review');
    return data?.data?.plans ?? [];
  },
  submitReview: async (planId: string, body: { action: 'APPROVE' | 'REJECT'; note?: string }) => {
    const { data } = await api.post(`/plans/${planId}/pt-review`, body);
    return data;
  },
};

export const locationService = {
  getProvinces: async () => {
    const { data } = await api.get('/locations/provinces');
    return data as { code: number; name: string; codename?: string; divisionType?: string }[];
  },
  getWards: async (provinceCode: number) => {
    const { data } = await api.get(`/locations/provinces/${provinceCode}/wards`);
    return data as { code: number; name: string; codename?: string }[];
  },
};

export const trainingLocationService = {
  getMyLocations: async () => {
    const { data } = await api.get('/pt/training-locations/me');
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
    const { data: res } = await api.post('/pt/training-locations/me', data);
    return res;
  },
  update: async (id: string, data: Record<string, any>) => {
    const { data: res } = await api.patch(`/pt/training-locations/me/${id}`, data);
    return res;
  },
  delete: async (id: string) => {
    const { data: res } = await api.delete(`/pt/training-locations/me/${id}`);
    return res;
  },
};

export default api;
