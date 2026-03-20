# 🔄 REFRACTOR PLAN - Fitness Assistant to Production Microservices

**Mục tiêu**: Refactor in-place repo "fitness-assistant" thành hệ thống microservices production-ready với bảo mật + chịu tải + đăng ký user + LLM integration.

**Ngày**: 2026-01-20  
**Phương châm**: "Archive first, delete later"

---

## 📊 HIỆN TRẠNG REPO

### Cấu trúc hiện tại:
```
fitness-assistant/
├── ai-gym-coach/          # ✅ TypeScript microservices (75+ files) - ĐÃ CÓ
│   ├── apps/
│   │   ├── api-gateway/   # Express gateway (port 3000)
│   │   └── web/           # React frontend (Vite)
│   ├── services/
│   │   ├── auth-service/  # Port 3001 - JWT, bcrypt
│   │   ├── fitness-service/ # Port 3002 - InBody, workouts, plans
│   │   └── ai-service/    # Port 3003 - LLM, RAG
│   ├── packages/
│   │   └── shared/        # Types, schemas, logger, http-client
│   └── docker-compose.yml # Redis, Qdrant, Postgres
│
├── fitness_assistant/     # ❌ Python Flask RAG (prototype cũ)
│   ├── app.py
│   ├── rag.py
│   ├── db.py
│   └── requirements.txt
│
├── frontend/              # ⚠️ React frontend đơn giản (TRÙNG với ai-gym-coach/apps/web)
├── nginx/                 # ⚠️ Nginx config (có thể dùng)
├── grafana/               # ✅ Monitoring setup (giữ lại)
├── data/                  # ✅ Exercise dataset CSV (giữ lại)
└── docker-compose.yaml    # ❌ Compose cũ cho Python app
```

### Phân tích:
- **ai-gym-coach/** đã có đầy đủ microservices TypeScript như yêu cầu
- **fitness_assistant/** là prototype Python cũ, không còn cần
- **frontend/** trùng với ai-gym-coach/apps/web (React)
- **nginx/** có thể tái sử dụng
- **grafana/** đang dùng, giữ lại

---

## 🎯 CHIẾN LƯỢC REFACTOR

### Approach: **"Promote ai-gym-coach lên root level"**
Thay vì tạo mới, ta sẽ:
1. **Move** nội dung ai-gym-coach/ lên root level
2. **Archive** Python code cũ vào _archive/
3. **Integrate** nginx/grafana vào cấu trúc mới
4. **Enhance** với features còn thiếu

---

## A) 📦 KEEP (Giữ lại & Nâng cấp)

### 1. **ai-gym-coach/** - Core Microservices ✅
**Lý do**: Đã implement đầy đủ architecture yêu cầu
**Action**: Move lên root level và enhance

| Thành phần | Trạng thái | Cần thêm |
|------------|-----------|----------|
| `apps/api-gateway/` | ✅ Có sẵn | Rate limiting (IP + userId), circuit breaker |
| `apps/web/` | ✅ Có sẵn | Auth flow, refresh token UI |
| `services/auth-service/` | ✅ Có sẵn | Refresh token rotation, RBAC, audit log |
| `services/fitness-service/` | ✅ Có sẵn | BullMQ queue, Redis cache, PR tracking |
| `services/ai-service/` | ✅ Có sẵn | Tool calling, async jobs, timeout handling |
| `packages/shared/` | ✅ Có sẵn | Zod schemas, error handling |

### 2. **data/** - Exercise Dataset ✅
**Lý do**: Nguồn dữ liệu cho RAG system
**Action**: Keep, dùng cho seed knowledge base vào Qdrant
**Files**: `data/data.csv` (207 exercises)

### 3. **grafana/** - Monitoring Setup ✅
**Lý do**: Đã config Grafana
**Action**: Move vào `/infra/grafana/`, integrate với Prometheus metrics

### 4. **nginx/nginx.conf** - Reverse Proxy Config ✅
**Lý do**: Có thể dùng cho production
**Action**: Move vào `/infra/nginx/`, update routes cho gateway

---

## B) 🔄 MOVE/RENAME (Di chuyển & Đổi tên)

| Từ | Đến | Lý do |
|----|-----|-------|
| `ai-gym-coach/apps/*` | `/apps/*` | Promote lên root |
| `ai-gym-coach/services/*` | `/services/*` | Promote lên root |
| `ai-gym-coach/packages/*` | `/packages/*` | Promote lên root |
| `ai-gym-coach/scripts/*` | `/scripts/*` | Promote lên root |
| `ai-gym-coach/docker-compose.yml` | `/docker-compose.yml` | Root level compose |
| `ai-gym-coach/tsconfig.base.json` | `/tsconfig.base.json` | Root level config |
| `ai-gym-coach/pnpm-workspace.yaml` | `/pnpm-workspace.yaml` | Workspace config |
| `ai-gym-coach/.env.example` | `/.env.example` | Root env template |
| `grafana/*` | `/infra/grafana/*` | Organize infra |
| `nginx/nginx.conf` | `/infra/nginx/nginx.conf` | Organize infra |
| `data/*` | `/data/*` (keep) | Already at root |

---

## C) 📦 ARCHIVE (Di chuyển vào _archive/)

### 1. **fitness_assistant/** - Python Flask App ❌
**Lý do**: Prototype cũ, đã thay bằng TypeScript microservices
**Impact**: None, đã migrate sang Node.js
**Action**: Move toàn bộ vào `_archive/python-prototype/`
**Files**:
- `fitness_assistant/app.py`
- `fitness_assistant/rag.py`
- `fitness_assistant/db.py`
- `fitness_assistant/ingest.py`
- `fitness_assistant/minsearch.py`
- `fitness_assistant/Dockerfile`
- `fitness_assistant/requirements.txt`
- `fitness_assistant/test_ollama.py`
- `fitness_assistant/translate_data.py`
- `fitness_assistant/db_prep.py`

### 2. **frontend/** - React Frontend Cũ ⚠️
**Lý do**: Trùng với ai-gym-coach/apps/web (đơn giản hơn)
**Impact**: ai-gym-coach/apps/web có đầy đủ pages hơn
**Action**: Move vào `_archive/frontend-simple/`
**Files**: Toàn bộ thư mục `frontend/`

### 3. **Python Dependencies** ❌
**Lý do**: Chuyển hoàn toàn sang Node.js ecosystem
**Action**: Move vào `_archive/python-setup/`
**Files**:
- `Pipfile`
- `Pipfile.lock`
- `requirements.txt` (root level)

### 4. **Scripts Setup Cũ** ⚠️
**Lý do**: Không còn dùng cho TypeScript setup
**Action**: Move vào `_archive/old-scripts/`
**Files**:
- `cli.py`
- `test.py`
- `setup.sh`

### 5. **Docker Compose Cũ** ❌
**Lý do**: Dành cho Python app, đã có compose mới trong ai-gym-coach/
**Action**: Move vào `_archive/docker-old/`
**Files**:
- `docker-compose.yaml` (root level, dành cho Python)
- `Dockerfile` (root level nếu có)

---

## D) 🚫 DELETE (Xóa hẳn sau khi archive & confirm)

**Chỉ xóa SAU KHI**:
1. ✅ Archive vào `_archive/`
2. ✅ Test docker-compose mới chạy OK
3. ✅ Confirm không còn dependency nào reference

**Files sẽ xóa**:
- `check-ollama.ps1` (helper script, không critical)
- `OLLAMA_SETUP.md` (docs, đã có trong ai-gym-coach/README.md)

**⚠️ KHÔNG XÓA NGAY**: Để trong _archive/ ít nhất 1 tuần để verify

---

## E) ➕ NEW CODE TO ADD

### 1. **Enhanced Auth Service**
- [ ] Refresh token rotation (database table)
- [ ] RBAC roles: user, admin
- [ ] Audit log table (login, sensitive actions)
- [ ] Argon2 migration (hiện tại dùng bcrypt - OK)

### 2. **Enhanced API Gateway**
- [ ] Rate limiting: IP-based + userId-based (Redis)
- [ ] Circuit breaker cho service calls (opossum/cockatiel)
- [ ] Request timeout (30s default)
- [ ] Swagger/OpenAPI docs

### 3. **Enhanced Fitness Service**
- [ ] BullMQ queue setup (worker cho plan generation)
- [ ] Redis cache (profile snapshot, current plan)
- [ ] Progressive overload unit tests (Jest)
- [ ] Deload logic (every 4 weeks)

### 4. **Enhanced AI Service**
- [ ] Tool calling implementation (call fitness-service HTTP)
- [ ] Async job endpoint: POST /jobs, GET /jobs/:id
- [ ] Timeout 30s cho LLM calls
- [ ] Fallback responses khi LLM fail

### 5. **Notification Service (Mock)**
**Path**: `/services/notification-service/`
- [ ] Skeleton service (Express)
- [ ] Endpoints: POST /notify (email, push)
- [ ] Mock implementation (console.log)

### 6. **Infrastructure as Code**
**Path**: `/infra/`
- [ ] nginx config updated (gateway routing)
- [ ] grafana dashboards (Prometheus metrics)
- [ ] prometheus.yml config
- [ ] docker-compose with all services

### 7. **Shared Package Enhancements**
- [ ] Zod schemas cho all DTOs
- [ ] Error handling middleware
- [ ] Logger (pino) with request ID
- [ ] HTTP client với retry logic

### 8. **Database Migrations**
- [ ] Prisma migrations tất cả services
- [ ] Seed script: 2 users, 10 exercises, 3 InBody, 5 meals

### 9. **Observability**
- [ ] Prometheus metrics (/metrics endpoint)
- [ ] Health checks (/health)
- [ ] Grafana dashboard import script

---

## 🎬 EXECUTION PLAN

### **Phase 1: Structure Refactor** (1-2 hours)
1. ✅ Create `_archive/` directory
2. ✅ Move Python code to `_archive/python-prototype/`
3. ✅ Move old frontend to `_archive/frontend-simple/`
4. ✅ Move Python deps to `_archive/python-setup/`
5. ✅ Move old scripts to `_archive/old-scripts/`
6. ✅ Move old docker-compose to `_archive/docker-old/`
7. ✅ Move ai-gym-coach/* to root level
8. ✅ Create `/infra/` and move nginx, grafana
9. ✅ Update `.gitignore`
10. ✅ Create new `/README.md` (merge info)

### **Phase 2: Enhance Core Services** (2-3 hours)
1. ✅ Auth service: refresh token + RBAC + audit log
2. ✅ API gateway: rate limiting + circuit breaker
3. ✅ Fitness service: BullMQ + Redis cache
4. ✅ AI service: tool calling + async jobs
5. ✅ Create notification-service (mock)

### **Phase 3: Infrastructure & Observability** (1-2 hours)
1. ✅ Update docker-compose.yml (all services)
2. ✅ Setup Prometheus + Grafana
3. ✅ Add /metrics endpoints
4. ✅ Health checks all services

### **Phase 4: Database & Seed** (30 min)
1. ✅ Run Prisma migrations
2. ✅ Seed users, exercises, InBody, meals
3. ✅ Seed Qdrant knowledge base (from data/data.csv)

### **Phase 5: Testing & Documentation** (1 hour)
1. ✅ Test docker-compose up
2. ✅ Test API endpoints (Postman/curl)
3. ✅ Update README.md (quick start)
4. ✅ Verify frontend login flow
5. ✅ Create RUNBOOK.md (scaling, troubleshooting)

---

## 📝 ACCEPTANCE CRITERIA

### ✅ Functional
- [ ] Docker compose chạy tất cả services (1 lệnh)
- [ ] Register + Login hoạt động (JWT)
- [ ] Profile CRUD hoạt động
- [ ] InBody entry + analysis (TDEE/macros)
- [ ] Workout logging (sets/reps/kg/RPE)
- [ ] Plan generation (workout + meal)
- [ ] AI coach chat (với/không Ollama)

### ✅ Non-Functional
- [ ] Rate limiting hoạt động (429 khi spam)
- [ ] Redis cache hit (profile snapshot)
- [ ] BullMQ job queue (async plan generation)
- [ ] Circuit breaker (khi service down)
- [ ] Metrics endpoint (/metrics) có data
- [ ] Grafana dashboard hiển thị metrics
- [ ] Logs có request ID (tracing)

### ✅ Security
- [ ] Password hashed (bcrypt)
- [ ] JWT access + refresh token
- [ ] RBAC roles (user/admin)
- [ ] Input validation (Zod)
- [ ] Helmet headers enabled
- [ ] CORS configured strict
- [ ] Audit log (login, sensitive actions)

### ✅ Documentation
- [ ] README.md updated (1-command start)
- [ ] .env.example có tất cả vars
- [ ] API docs (Swagger/OpenAPI)
- [ ] RUNBOOK.md (troubleshooting)
- [ ] Architecture diagram updated

---

## 🔐 SENSITIVE FILES (Double Check)

**Never commit**:
- `.env` (actual secrets)
- `*.log` files
- `node_modules/`
- `dist/`, `build/`
- `.DS_Store`

**Always commit**:
- `.env.example` (template)
- `.gitignore` (updated)
- `docker-compose.yml` (no secrets)

---

## 📊 METRICS TO TRACK

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Total files | 75+ (ai-gym-coach) + 20+ (Python) = 95+ | ~80 (cleaned) | ⏳ |
| Docker services | 5 (Postgres, Redis, Qdrant, Grafana, Python) | 10+ (Gateway, 3+ services, DB, cache, vector, monitoring) | ⏳ |
| API endpoints | ~10 (Python RAG) | 30+ (full microservices) | ⏳ |
| Languages | Python + TypeScript | TypeScript only (unified) | ⏳ |
| Auth | None | JWT + RBAC + refresh | ⏳ |
| Observability | Basic Grafana | Prometheus + Grafana + logs | ⏳ |

---

## ⚡ NEXT ACTIONS

### Immediate (Bước 1 & 2):
1. ✅ **Create _archive/ structure**
2. ✅ **Move Python code to archive**
3. ✅ **Move ai-gym-coach to root**
4. ✅ **Update docker-compose.yml**
5. ✅ **Add refresh token to auth-service**
6. ✅ **Add rate limiting to gateway**
7. ✅ **Test: docker compose up**
8. ✅ **Test: curl register/login**

### Report back:
- Files moved/archived
- Services running
- API tests passing
- What's next

---

**Status**: 🟡 READY TO EXECUTE  
**Risk Level**: 🟢 LOW (Archive first, can rollback)  
**Estimated Time**: 6-8 hours total
