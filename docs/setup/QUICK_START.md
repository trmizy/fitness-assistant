# 🚀 Quick Start Guide - AI Gym Coach

> **✅ IMPLEMENTATION COMPLETE** - All services are fully functional with 414 exercises seeded!

## ✅ Prerequisites

- Node.js 20+ ([download](https://nodejs.org/))
- pnpm 8+ (install: `npm install -g pnpm`)
- Docker Desktop ([download](https://www.docker.com/products/docker-desktop/))
- Git

## 📦 Installation (5 Minutes)

### 1. Clone & Install Dependencies
```bash
cd fitness-assistant
pnpm install
```

### 2. Start Infrastructure (Postgres, Redis, Qdrant)
```bash
docker-compose -p gym-coach up -d postgres redis qdrant

# Wait 10 seconds for databases to initialize
# Verify they're running:
docker-compose -p gym-coach ps
```

### 3. Setup Databases & Seed Data
```bash
# Build shared package first
cd packages/shared
pnpm build
cd ../..

# Auth Service Database (creates users table + demo users)
cd services/auth-service
pnpm db:generate
pnpm db:migrate
cd ../..

# User Service Database (creates profiles table)
cd services/user-service
pnpm db:generate
pnpm db:migrate
cd ../..

# Fitness Service Database (creates exercises, workouts, nutrition tables + seeds 414 exercises)
cd services/fitness-service
pnpm db:generate
pnpm db:migrate
pnpm prisma db seed  # Seeds 414 exercises from CSV
cd ../..

# AI Service Database (creates conversations, workout plans tables)
cd services/ai-service
pnpm db:generate
pnpm db:migrate
cd ../..
```

### 4. Start All Services
```bash
# Start in separate terminals or use the start script:

# Terminal 1 - Auth Service (port 3001)
cd services/auth-service
pnpm dev

# Terminal 2 - User Service (port 3004)
cd services/user-service
pnpm dev

# Terminal 3 - Fitness Service (port 3002)
cd services/fitness-service
pnpm dev

# Terminal 4 - AI Service (port 3003)
cd services/ai-service
pnpm dev
```

**OR use PowerShell script to start all at once:**
```powershell
.\start.ps1
```

### 5. Start All Services (5 Terminals)

**Terminal 1 - Auth Service:**
```bash
cd services/auth-service
pnpm dev
# ✅ Should show: Auth service listening on port 3001
```

**Terminal 2 - Fitness Service:**
```bash
cd services/fitness-service
pnpm dev
# ✅ Should show: Fitness service listening on port 3002
```

**Terminal 3 - AI Service:**
```bash
cd services/ai-service
pnpm dev
# ✅ Should show: AI service listening on port 3003
```

**Terminal 4 - API Gateway:**
```bash
cd apps/api-gateway
pnpm dev
# ✅ Should show: API Gateway listening on port 3000
```

**Terminal 5 - Frontend:**
```bash
cd apps/web
pnpm dev
# ✅ Should show: Local: http://localhost:5173
```

## 🎯 Access the Application

**🌐 Web Interface:** http://localhost:5173

**Demo Credentials:**
- Email: `john.doe@example.com`
- Password: `password123`

**API Gateway:** http://localhost:3000

## ✅ Quick Verification

```powershell
# Check all services are running
@(3000,3001,3002,3003,3004) | ForEach-Object { 
  try { 
    $h = Invoke-RestMethod "http://localhost:$_/health"
    Write-Host "✓ Port $_: $($h.service)" 
  } catch { 
    Write-Host "✗ Port $_: Failed" 
  } 
}

# Test exercises API (414 exercises available)
$ex = Invoke-RestMethod "http://localhost:3000/exercises?search=squat&limit=5"
Write-Host "Found $($ex.Count) squat exercises"

# Test web app
Start-Process "http://localhost:5173"
```

## 🧪 Test the System

### 1. Browse Exercises (No Auth Required)
```powershell
# Get all exercises
Invoke-RestMethod "http://localhost:3000/exercises" | Measure-Object

# Search for specific exercises
Invoke-RestMethod "http://localhost:3000/exercises?search=bench press&limit=5"

# Filter by body part
Invoke-RestMethod "http://localhost:3000/exercises?bodyPart=UPPER_BODY&limit=10"
```

### 2. Test Authentication
```powershell
# Register new user
$newUser = @{
  name = 'Test User'
  email = 'test@example.com'
  password = 'test123'
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:3000/auth/register" `
  -Method POST `
  -Body $newUser `
  -ContentType "application/json"

# Login
$login = @{
  email = 'john.doe@example.com'
  password = 'password123'
} | ConvertTo-Json

$response = Invoke-RestMethod "http://localhost:3000/auth/login" `
  -Method POST `
  -Body $login `
  -ContentType "application/json"

$token = $response.accessToken
Write-Host "Token: $token"
```

### 3. Test Protected Endpoints
```powershell
# Get user profile
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod "http://localhost:3000/profile/me" -Headers $headers

# Create workout
$workout = @{
  name = "Monday Chest Day"
  date = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  exercises = @(
    @{
      exerciseId = "YOUR_EXERCISE_ID"  # Get from /exercises
      sets = 3
      reps = 10
      weight = 60
    }
  )
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:3000/workouts" `
  -Method POST `
  -Body $workout `
  -ContentType "application/json" `
  -Headers $headers

# Get workouts
Invoke-RestMethod "http://localhost:3000/workouts" -Headers $headers

# Get workout stats
Invoke-RestMethod "http://localhost:3000/stats/workouts" -Headers $headers
```

### 4. Test AI Coach (RAG System)
```powershell
# Ask fitness question
$question = @{
  question = "What exercises are best for building chest muscles?"
  userId = "YOUR_USER_ID"
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:3000/ai/ask" `
  -Method POST `
  -Body $question `
  -ContentType "application/json" `
  -Headers $headers
```
  -H "Authorization: Bearer $TOKEN"

# Create InBody entry
curl -X POST http://localhost:3000/inbody \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2024-01-20",
    "weight":75,
    "skeletalMuscleMass":35,
    "bodyFatMass":12,
    "percentBodyFat":16,
    "bmi":24.7
  }'
```

### 3. Test AI Coach (Browser)
1. Go to **http://localhost:5173**
2. Login with demo credentials
3. Navigate to **🤖 AI Coach**
4. Ask: "How do I improve my bench press?"
5. You'll get a response (fallback if Ollama not installed)

## 🤖 Optional: Enable Real AI Features

### Install Ollama (for local LLM)
```bash
# Download from https://ollama.ai
# Or on macOS: brew install ollama

# Pull models
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# Verify
ollama list
```

### Configure AI Service
```bash
# Edit ai-gym-coach/.env
LLM_PROVIDER=ollama  # or openai, gemini, claude
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# Restart AI service (Terminal 3)
# Ctrl+C then: pnpm dev
```

## 📱 Using the Web Application

### 1. Complete Your Profile
- Click **👤 Profile** in sidebar
- Fill in: age, gender, height, goals, activity level
- Save profile

### 2. Log InBody Data
- Click **⚖️ InBody**
- Enter: weight, muscle mass, body fat, etc.
- System automatically calculates TDEE and macros!

### 3. Log Workouts
- Click **🏋️ Workouts**
- Select exercise, enter sets/reps/weight/RPE
- Track progressive overload over time

### 4. Generate Plans
- Click **📋 Plans**
- Click "Generate New Plan"
- View your personalized workout schedule

### 5. Chat with AI Coach
- Click **🤖 AI Coach**
- Ask questions about:
  - Form and technique
  - Programming and periodization
  - Nutrition and supplements
  - Injury prevention
  - Progress troubleshooting

## 🛑 Stop Services

```bash
# Stop backend services: Ctrl+C in each terminal

# Stop infrastructure
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

## 🔄 Restart Everything

```bash
# Start infrastructure
docker-compose up -d postgres redis qdrant

# Start services (5 terminals as above)
```

## 📚 Demo Accounts

The seed script creates 3 test users:

| Email | Password | Role |
|-------|----------|------|
| john.doe@example.com | password123 | user |
| jane.smith@example.com | password123 | user |
| admin@example.com | admin123 | admin |

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Find process using port (e.g., 3000)
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or change port in .env
```

### Database Connection Error
```bash
# Reset databases
docker-compose down -v
docker-compose up -d postgres redis qdrant
# Wait 15 seconds
# Re-run migrations
```

### Prisma Client Not Generated
```bash
cd services/auth-service
pnpm db:generate

cd ../fitness-service
pnpm db:generate
```

### Frontend Not Loading
```bash
# Clear cache and reinstall
cd apps/web
rm -rf node_modules .vite
pnpm install
pnpm dev
```

## 🎉 Success Checklist

- ✅ 5 services running (auth, fitness, ai, gateway, web)
- ✅ Can login at http://localhost:5173
- ✅ Can view dashboard
- ✅ Can update profile
- ✅ Can log InBody data and see calculations
- ✅ Can log workouts
- ✅ Can generate plans
- ✅ Can chat with AI coach

## 📖 Next Steps

- Read [README.md](README.md) for full documentation
- Read [SETUP.md](SETUP.md) for detailed setup guide
- Check [API documentation](README.md#-api-documentation) for endpoint details
- Explore the codebase:
  - `packages/shared/` - Shared types and utilities
  - `services/` - Backend microservices
  - `apps/api-gateway/` - API Gateway
  - `apps/web/` - React frontend

## 💡 Tips

- Use **React Query DevTools** (available in browser) to debug API calls
- Check service logs in terminals for debugging
- Use demo credentials for testing
- Profile must be complete before generating plans
- InBody analysis requires profile with activity level

---

**Need help?** Check [SETUP.md](SETUP.md) for detailed troubleshooting or review service logs.

**Ready for production?** See [README.md](README.md) deployment section.
