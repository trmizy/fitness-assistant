import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
};

export const inbodyService = {
  create: async (entry: any) => {
    const { data } = await api.post('/inbody', entry);
    return data;
  },
  
  getLatest: async () => {
    const { data } = await api.get('/inbody/latest');
    return data;
  },
  
  getHistory: async (page: number = 1, limit: number = 50) => {
    const { data } = await api.get(`/inbody?page=${page}&limit=${limit}`);
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
    const { data } = await api.post('/ai/ask', { question: message });
    return data;
  },
  
  getConversations: async () => {
    const { data } = await api.get('/ai/conversations');
    return data;
  },
};

export default api;