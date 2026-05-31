# Fitness Assistant - AI Gym Coach

🏋️ Hệ thống AI Gym Coach với microservices, phân tích InBody + workout logs → tạo plan workout/meal cá nhân hóa.

## 🚀 Quick Start

### 1. Start Infrastructure
```powershell
# Chạy từ root folder
docker-compose -f infra/compose/docker-compose.dev.yml up -d
Start-Sleep -Seconds 10
```

### 2. Start Services (chọn 1 trong 2 cách)

**Cách 1: Chạy từng service (recommended)**
- Double-click: `start-auth.bat`
- Double-click: `start-user.bat`
- Double-click: `start-fitness.bat`
- Double-click: `start-ai.bat`
- Double-click: `start-gateway.bat`
- Double-click: `start-web.bat`

**Cách 2: Script tự động**
```powershell
.\START_ALL_SIMPLE.ps1
```

### 3. Access App
- **Web**: http://localhost:5173
- **Login**: john.doe@example.com / password123

## 🏗️ Architecture

| Service | Port | Role |
|---------|------|------|
| Web | 5173 | React frontend |
| API Gateway | 3000 | Routing, auth, rate limiting |
| Auth Service | 3001 | JWT authentication |
| User Service | 3004 | User profiles |
| Fitness Service | 3002 | Exercises, workouts, nutrition |
| AI Service | 3003 | LLM + RAG coaching |
| PostgreSQL | 5433 | 4 databases |
| Redis | 6379 | Cache, queue |
| Qdrant | 6333 | Vector DB |

## ✨ Features

- ✅ InBody analysis (TDEE, calories, macros)
- ✅ 207 exercises database
- ✅ Workout logging (sets, reps, kg, RPE)
- ✅ Workout & Meal plans
- ✅ Shopping list
- ✅ AI Coach chat with RAG
- ✅ Progressive overload tracking
- ✅ Personal records (PR)

## 📁 Structure

```
fitness-assistant/
├── apps/
│   ├── api-gateway/                    # Express API Gateway
│   │   ├── src/
│   │   │   └── main.ts                 # Entry point, route proxying & auth middleware
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                            # React + Vite Frontend
│       ├── src/
│       │   ├── components/
│       │   │   └── Layout.tsx          # App shell / navigation layout
│       │   ├── pages/
│       │   │   ├── Coach.tsx           # AI Coach chat page
│       │   │   ├── Dashboard.tsx       # Main dashboard
│       │   │   ├── InBody.tsx          # InBody analysis page
│       │   │   ├── Login.tsx           # Login page
│       │   │   ├── Plans.tsx           # Workout & meal plans
│       │   │   ├── Profile.tsx         # User profile
│       │   │   ├── Register.tsx        # Register page
│       │   │   └── Workouts.tsx        # Workout logging page
│       │   ├── services/
│       │   │   └── api.ts              # Axios API client
│       │   ├── App.tsx                 # Root component & routing
│       │   ├── index.css               # Global styles (TailwindCSS)
│       │   └── main.tsx                # Vite entry point
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
│
├── services/
│   ├── ai-service/                     # LLM + RAG Coaching Service (port 3003)
│   │   ├── prisma/
│   │   │   ├── schema.prisma           # Prisma schema (chat history)
│   │   │   └── migrations/
│   │   │       └── 20260120005105_/
│   │   │           └── migration.sql
│   │   ├── src/
│   │   │   ├── ingest.ts               # Data ingestion into vector DB (Qdrant)
│   │   │   └── main.ts                 # Express server, RAG pipeline, LLM calls
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── auth-service/                   # JWT Authentication Service (port 3001)
│   │   ├── prisma/
│   │   │   ├── schema.prisma           # Prisma schema (users, sessions)
│   │   │   ├── seed.ts                 # Seed demo users
│   │   │   └── migrations/
│   │   │       └── 20260120003322_/
│   │   │           └── migration.sql
│   │   ├── src/
│   │   │   └── main.ts                 # Express server, register/login/refresh tokens
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── fitness-service/                # Exercises, Workouts & Nutrition (port 3002)
│   │   ├── prisma/
│   │   │   ├── schema.prisma           # Prisma schema (exercises, logs, plans)
│   │   │   ├── seed.ts                 # Seed 207 exercises
│   │   │   └── migrations/
│   │   │       └── 20260120005039_/
│   │   │           └── migration.sql
│   │   ├── src/
│   │   │   └── main.ts                 # Express server, CRUD workout/meal/plan APIs
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── user-service/                   # User Profiles Service (port 3004)
│       ├── prisma/
│       │   ├── schema.prisma           # Prisma schema (profiles, InBody records)
│       │   └── migrations/
│       │       └── 20260120003413_/
│       │           └── migration.sql
│       ├── src/
│       │   └── main.ts                 # Express server, profile & InBody APIs
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                         # Shared TypeScript package
│       ├── src/
│       │   ├── errors.ts               # Custom error classes
│       │   ├── index.ts                # Package exports
│       │   ├── metrics.ts              # Prometheus metrics helpers
│       │   ├── schemas.ts              # Zod validation schemas
│       │   └── types.ts                # Shared TypeScript types
│       ├── package.json
│       └── tsconfig.json
│
├── data/                               # RAG & Evaluation Data
│   ├── data.csv                        # Cleaned exercise/nutrition dataset
│   ├── data_unclean.csv                # Raw dataset
│   ├── ground-truth-retrieval.csv      # Ground truth for RAG eval (EN)
│   ├── ground-truth-retrieval-vi.csv   # Ground truth for RAG eval (VI)
│   ├── ground-truth-retrieval-backup.csv
│   ├── rag-eval-gpt-4o.csv             # RAG evaluation results (GPT-4o)
│   └── rag-eval-gpt-4o-mini.csv        # RAG evaluation results (GPT-4o-mini)
│
├── scripts/
│   ├── generate-files.js               # Code generation helper
│   └── generate-frontend.js            # Frontend scaffolding helper
│
├── .env                                # Root environment variables
├── .env.example                        # Environment variable template
├── .gitignore
├── docker-compose.dev.yml              # PostgreSQL + Redis + Qdrant
├── package.json                        # Root pnpm workspace config
├── pnpm-workspace.yaml                 # Workspace packages definition
├── tsconfig.base.json                  # Shared TypeScript base config
├── START_ALL_SIMPLE.ps1                # Start all services (PowerShell)
├── start-ai.bat                        # Start ai-service
├── start-auth.bat                      # Start auth-service
├── start-fitness.bat                   # Start fitness-service
├── start-gateway.bat                   # Start api-gateway
├── start-user.bat                      # Start user-service
├── start-web.bat                       # Start web frontend
├── test-ollama.bat                     # Test Ollama LLM connection
├── OLLAMA_SETUP.md                     # Ollama local LLM setup guide
├── PROJECT_COMPLETE.md                 # Full feature checklist
├── QUICK_START.md                      # Detailed setup guide
├── REFRACTOR_PLAN.md                   # Refactoring notes
├── SETUP.md                            # Initial setup instructions
└── WINDOWS_DEFENDER_FIX.md            # Windows Defender fix guide
```

## 🔧 Commands

### Database Migration
```powershell
cd services\[service-name]
pnpm prisma migrate deploy
```

### Seed Exercises
```powershell
cd services\fitness-service
pnpm prisma db seed
```

### Health Check
```powershell
curl http://localhost:3000/health  # Gateway
curl http://localhost:3001/health  # Auth
curl http://localhost:3004/health  # User
curl http://localhost:3002/health  # Fitness
curl http://localhost:3003/health  # AI
```

- **Infrastructure**: `docker-compose -f infra/compose/docker-compose.dev.yml down`
- **Clean all** (⚠️ deletes data): `docker-compose -f infra/compose/docker-compose.dev.yml down -v`

### 💡 LƯU Ý CHO TEAM (Khi mới pull code)
Nếu bạn không thấy danh sách bài tập (Empty Exercises), hãy chạy lệnh reset sau để database được seed lại:
```powershell
docker-compose -f infra/compose/docker-compose.dev.yml down -v
docker-compose -f infra/compose/docker-compose.dev.yml up --build -d
```

## 🐛 Troubleshooting

### Services won't start
```powershell
# Kill processes on ports
Get-NetTCPConnection -LocalPort 3001 | ForEach-Object { 
    Stop-Process -Id $_.OwningProcess -Force 
}
```

### Database errors
```powershell
# Restart postgres
docker restart gymcoach-postgres
```

### Web app not loading
- Hard refresh: Ctrl + Shift + R
- Clear cache: Ctrl + Shift + Delete
- Check port 5173 is listening

## 📚 Docs

- `QUICK_START.md` - Chi tiết setup
- `PROJECT_COMPLETE.md` - Feature list
- `WINDOWS_DEFENDER_FIX.md` - Fix antivirus

## 🔐 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Node.js + TypeScript + Express
- **Database**: PostgreSQL 15 + Prisma ORM
- **Cache**: Redis 7
- **Vector DB**: Qdrant
- **Auth**: JWT + Argon2
- **Monorepo**: pnpm workspaces

---

**Demo Login**: john.doe@example.com / password123
