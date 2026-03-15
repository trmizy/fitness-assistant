# 🎯 AI Gym Coach - Complete Setup Guide

## ✅ Current Status

### Completed Components:
- ✅ Monorepo structure (pnpm workspaces)
- ✅ Shared package (types, schemas, auth, logger, HTTP client)
- ✅ Auth Service (complete with JWT, registration, login)
- ✅ Fitness Service (profiles, InBody, workouts, planning)
- ✅ Docker Compose configuration
- ✅ Database schemas (Prisma)

### To Complete:
- 🔄 AI Service (LLM + RAG)
- 🔄 API Gateway
- 🔄 React Frontend
- 🔄 Seed scripts

---

## 🚀 QUICK START (5 Minutes)

### Step 1: Install Dependencies
```bash
cd ai-gym-coach
pnpm install
```

### Step 2: Setup Environment
```bash
cp .env.example .env
# Edit .env with your database credentials
```

### Step 3: Generate Remaining Files
```bash
node scripts/generate-files.js
```

### Step 4: Start Infrastructure
```bash
docker-compose up -d postgres redis qdrant
```

### Step 5: Database Setup
```bash
# Generate Prisma clients
cd services/auth-service && pnpm db:generate && cd ../..
cd services/fitness-service && pnpm db:generate && cd ../..

# Run migrations
cd services/auth-service && pnpm db:migrate && cd ../..
cd services/fitness-service && pnpm db:migrate && cd ../..

# Seed data
cd services/auth-service && pnpm db:seed && cd ../..
```

### Step 6: Start Services (Development)
```bash
# Terminal 1 - Auth Service
cd services/auth-service
pnpm dev

# Terminal 2 - Fitness Service
cd services/fitness-service
pnpm dev

# Terminal 3 - AI Service (optional for basic testing)
# cd services/ai-service
# pnpm dev

# Terminal 4 - API Gateway
cd apps/api-gateway
pnpm dev

# Terminal 5 - Frontend
cd apps/web
pnpm dev
```

---

## 📋 Manual File Creation (If script fails)

### Create AI Service Structure

```bash
mkdir -p services/ai-service/src/{routes,services}
mkdir -p services/ai-service/prisma
```

**services/ai-service/package.json:**
```json
{
  "name": "@gym-coach/ai-service",
  "version": "1.0.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@gym-coach/shared": "workspace:*",
    "@prisma/client": "^5.8.0",
    "@qdrant/js-client-rest": "^1.7.0",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "axios": "^1.6.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

**services/ai-service/src/main.ts:**
```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServiceLogger } from '@gym-coach/shared';

dotenv.config();

const app = express();
const logger = createServiceLogger('ai-service');
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'ai-service' });
});

app.post('/coach/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Simple response for MVP
    const response = {
      message: `Based on your question "${message}", I recommend focusing on progressive overload and proper form.`,
      conversationId: 'mock-conversation-id',
      suggestions: ['Track your workouts', 'Increase weight gradually', 'Rest adequately'],
    };
    
    res.json({ success: true, data: response });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Chat failed' });
  }
});

app.listen(PORT, () => {
  logger.info(`AI Service listening on port ${PORT}`);
});
```

### Create API Gateway

```bash
mkdir -p apps/api-gateway/src/{middleware,routes}
```

**apps/api-gateway/package.json:**
```json
{
  "name": "@gym-coach/api-gateway",
  "version": "1.0.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@gym-coach/shared": "workspace:*",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express-rate-limit": "^7.1.5",
    "axios": "^1.6.5",
    "http-proxy-middleware": "^2.0.6"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

**apps/api-gateway/src/main.ts:**
```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createServiceLogger } from '@gym-coach/shared';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const logger = createServiceLogger('api-gateway');
const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests',
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'api-gateway' });
});

// Proxy routes
app.use('/auth', createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: { '^/auth': '/auth' },
}));

app.use('/profile', createProxyMiddleware({
  target: process.env.FITNESS_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
}));

app.use('/inbody', createProxyMiddleware({
  target: process.env.FITNESS_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
}));

app.use('/workouts', createProxyMiddleware({
  target: process.env.FITNESS_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
}));

app.use('/exercises', createProxyMiddleware({
  target: process.env.FITNESS_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
}));

app.use('/plans', createProxyMiddleware({
  target: process.env.FITNESS_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
}));

app.use('/coach', createProxyMiddleware({
  target: process.env.AI_SERVICE_URL || 'http://localhost:3003',
  changeOrigin: true,
}));

app.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
});
```

### Create React Frontend

```bash
mkdir -p apps/web/src/{pages,components,services}
```

**apps/web/package.json:**
```json
{
  "name": "@gym-coach/web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.1",
    "@tanstack/react-query": "^5.17.9",
    "zustand": "^4.4.7",
    "axios": "^1.6.5"
  },
  "devDependencies": {
    "@types/react": "^18.2.47",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.11",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.33"
  }
}
```

**apps/web/src/App.tsx:**
```typescript
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InBody from './pages/InBody';
import Workouts from './pages/Workouts';
import Plans from './pages/Plans';
import Coach from './pages/Coach';

const queryClient = new QueryClient();

function App() {
  const isAuthenticated = !!localStorage.getItem('accessToken');

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {isAuthenticated ? (
            <>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inbody" element={<InBody />} />
              <Route path="/workouts" element={<Workouts />} />
              <Route path="/plans" element={<Plans />} />
              <Route path="/coach" element={<Coach />} />
            </>
          ) : (
            <Route path="*" element={<Navigate to="/login" />} />
          )}
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
```

**apps/web/src/services/api.ts:**
```typescript
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
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
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
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
  
  getHistory: async () => {
    const { data } = await api.get('/inbody/history');
    return data;
  },
};

export const workoutService = {
  logWorkout: async (workout: any) => {
    const { data } = await api.post('/workouts/log', workout);
    return data;
  },
  
  getHistory: async (page: number = 1) => {
    const { data } = await api.get(`/workouts/history?page=${page}`);
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

export default api;
```

---

## 🧪 Testing the System

### Test Auth Flow
```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","firstName":"Test","lastName":"User"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### Test With Seeded User
```bash
# Login as john.doe
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john.doe@example.com","password":"password123"}'

# Use the returned token for subsequent requests
```

---

## 📦 Production Build

```bash
# Build all services
pnpm build

# Or with Docker
docker-compose build
docker-compose up -d
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

### Database Connection Issues
```bash
# Check Postgres is running
docker-compose ps postgres

# View logs
docker-compose logs postgres

# Restart
docker-compose restart postgres
```

### Prisma Issues
```bash
# Reset database
cd services/auth-service
pnpm prisma migrate reset --force
pnpm db:seed
```

---

## ✅ Final Checklist

- [ ] All dependencies installed (`pnpm install`)
- [ ] `.env` file configured
- [ ] Docker containers running (postgres, redis, qdrant)
- [ ] Database migrated
- [ ] Database seeded
- [ ] All services started
- [ ] Can login at http://localhost:5173
- [ ] API Gateway responds at http://localhost:3000/health

---

## 🎉 You're Ready!

Visit **http://localhost:5173** and login with:
- Email: `john.doe@example.com`
- Password: `password123`

Enjoy your AI Gym Coach! 🏋️‍♂️
