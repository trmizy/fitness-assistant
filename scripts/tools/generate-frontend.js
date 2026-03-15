#!/usr/bin/env node
/**
 * Complete React Frontend Generator
 */

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const files = {
  'apps/web/src/services/api.ts': `import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

export const authService = {
  login: async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.success) {
      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken);
    }
    return data;
  },
  
  register: async (email: string, password: string, firstName: string, lastName: string) => {
    const { data } = await api.post('/auth/register', { email, password, firstName, lastName });
    return data;
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
};

export const workoutService = {
  logWorkout: async (workout: any) => {
    const { data } = await api.post('/workouts/log', workout);
    return data;
  },
  
  getHistory: async (page: number = 1) => {
    const { data } = await api.get(\`/workouts/history?page=\${page}\`);
    return data;
  },
  
  getExercises: async () => {
    const { data } = await api.get('/exercises/exercises');
    return data;
  },
};

export const planService = {
  generateWorkoutPlan: async (params: any) => {
    const { data } = await api.post('/plans/workout/generate', params);
    return data;
  },
  
  getCurrentPlans: async () => {
    const { data } = await api.get('/plans/current');
    return data;
  },
};

export const coachService = {
  chat: async (message: string) => {
    const { data } = await api.post('/coach/chat', { message });
    return data;
  },
};

export default api;`,

  'apps/web/src/components/Layout.tsx': `import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services/api';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    authService.logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/inbody', label: 'InBody', icon: '⚖️' },
    { path: '/workouts', label: 'Workouts', icon: '🏋️' },
    { path: '/plans', label: 'Plans', icon: '📋' },
    { path: '/coach', label: 'AI Coach', icon: '🤖' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: '250px', backgroundColor: '#1a1a1a', color: 'white', padding: '20px' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '30px', fontWeight: 'bold' }}>🏋️ AI Gym Coach</h1>
        
        <ul style={{ listStyle: 'none' }}>
          {navItems.map((item) => (
            <li key={item.path} style={{ marginBottom: '10px' }}>
              <Link
                to={item.path}
                style={{
                  display: 'block',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  color: 'white',
                  backgroundColor: location.pathname === item.path ? '#333' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ marginRight: '10px' }}>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        
        <button
          onClick={handleLogout}
          style={{
            marginTop: '40px',
            width: '100%',
            padding: '12px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </nav>
      
      <main style={{ flex: 1, padding: '40px', backgroundColor: '#f5f5f5' }}>
        <Outlet />
      </main>
    </div>
  );
}`,

  'apps/web/src/pages/Login.tsx': `import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../services/api';

export default function Login() {
  const [email, setEmail] = useState('john.doe@example.com');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authService.login(email, password);
      if (result.success) {
        navigate('/');
      } else {
        setError('Invalid credentials');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' }}>
      <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '12px', maxWidth: '400px', width: '100%' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '10px', textAlign: 'center' }}>🏋️ AI Gym Coach</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '30px' }}>Welcome back!</p>
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px' }}
            />
          </div>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px' }}
            />
          </div>
          
          {error && (
            <div style={{ padding: '12px', backgroundColor: '#fee', color: '#c33', borderRadius: '8px', marginBottom: '20px' }}>
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <p style={{ textAlign: 'center', marginTop: '20px', color: '#666' }}>
          Don't have an account? <Link to="/register" style={{ color: '#007bff', textDecoration: 'none', fontWeight: '600' }}>Register</Link>
        </p>
        
        <p style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '6px', fontSize: '14px', color: '#666' }}>
          <strong>Demo credentials:</strong><br />
          Email: john.doe@example.com<br />
          Password: password123
        </p>
      </div>
    </div>
  );
}`,
};

console.log('🚀 Generating React Frontend files...\n');

Object.entries(files).forEach(([filepath, content]) => {
  const fullPath = path.join(process.cwd(), filepath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ Created: ${filepath}`);
});

console.log('\n✨ Frontend generation complete!\n');
