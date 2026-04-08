import axios from 'axios';

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

let isRefreshing = false;
let pendingRequests: Array<(token: string | null) => void> = [];

function resolvePendingRequests(token: string | null) {
  pendingRequests.forEach((cb) => cb(token));
  pendingRequests = [];
}

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

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingRequests.push((newToken) => {
            if (!hasUsableToken(newToken)) {
              reject(error);
              return;
            }
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;
      const newToken = await refreshAccessToken();
      isRefreshing = false;
      resolvePendingRequests(newToken);

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

  getExercises: async () => {
    const { data } = await api.get('/exercises');
    return data;
  },

  getStats: async () => {
    const { data } = await api.get('/stats/workouts');
    return data;
  },

  getPRs: async (exerciseId?: number) => {
    const url = exerciseId ? `/workouts/prs?exerciseId=${exerciseId}` : '/workouts/prs';
    const { data } = await api.get(url);
    return data;
  },
};

export const planService = {
  generateWorkoutPlan: async (params: any) => {
    const { data } = await api.post('/plans/workout/generate', params);
    return data;
  },

  explainPlan: async (planType: 'workout' | 'meal') => {
    const { data } = await api.post('/plans/explain', { planType });
    return data;
  },

  adjustPlan: async (planType: 'workout' | 'meal', adjustments: any) => {
    const { data } = await api.post('/plans/adjust', { planType, adjustments });
    return data;
  },

  getShoppingList: async () => {
    const { data } = await api.get('/plans/shopping-list');
    return data;
  },

  getCurrentPlans: async () => {
    const { data } = await api.get('/plans/current');
    return data;
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
    return data;
  },

  getConversations: async () => {
    const { data } = await api.get('/ai/conversations');
    return data;
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
  deleteLog: async (id: string) => {
    const { data } = await api.delete(`/nutrition/${id}`);
    return data;
  },
};

export default api;