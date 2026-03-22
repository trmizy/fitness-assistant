# FITNESS ASSISTANT - PROJECT SYSTEM OPERATIONS GUIDE

Tai lieu nay la ban huong dan day du de hieu va van hanh toan bo he thong fitness-assistant, bao gom:
- Cau truc monorepo va vai tro tung thanh phan
- Cach chay theo Docker va theo local dev
- Quy trinh startup, healthcheck, phu thuoc giua cac service
- Luong request chinh va luong chay ben trong mot service
- Cau truc file, entrypoint, va ly do kien truc duoc to chuc nhu hien tai

---

## 1) Tong quan kien truc

He thong duoc to chuc theo mo hinh microservices trong monorepo PNPM:

- Frontend: React + Vite
- API Gateway: diem vao duy nhat cho client
- Auth Service: xac thuc JWT, login/register/refresh/verify
- User Service: profile user
- Fitness Service: workout, nutrition, stats, worker
- AI Service: chat AI, RAG, worker
- Chat Service: REST + Socket.IO cho chat real-time
- Shared package: logger, types, schemas, errors, metrics
- Infrastructure: Postgres, Redis, Qdrant

Kien truc nay giai quyet 3 muc tieu:
1. Tach nghiep vu de scale va deploy doc lap tung phan.
2. Giu contract API ro rang qua Gateway.
3. Tien cho worker/background processing, cache va RAG.

---

## 2) Cau truc thu muc (thuc te repo)

## 2.1 Root

- package.json
  - scripts tong cho monorepo: dev, build, clean, docker up/down/build, db migrate/seed.
- pnpm-workspace.yaml
  - khai bao cac workspace package.
- tsconfig.base.json
  - cau hinh TypeScript dung chung.
- infra/compose/docker-compose.dev.yml
  - file dieu phoi chinh cho run bang Docker.
- docs/setup
  - tai lieu setup/van hanh.

## 2.2 Frontend

- frontend/New
  - src/main.tsx: entrypoint React.
  - src/App.tsx: router va app shell.
  - src/pages/*: cac man hinh chuc nang.
  - src/services/api.ts: axios client + token attach + interceptor.
  - vite.config.ts: dev server + proxy /api.
  - nginx.conf: runtime config khi build web trong Docker.

## 2.3 Backend

- backend/gateway
  - src/server.ts: entrypoint Gateway.
  - src/app.ts: middleware, /health, proxy route registration.
  - src/routes/proxy.routes.ts: map route sang cac service dich.

- backend/services/auth-service
  - src/server.ts: start service + graceful shutdown.
  - src/routes/auth.routes.ts: route auth.
  - src/controllers/auth.controller.ts
  - src/services/auth.service.ts
  - src/repositories/auth.repository.ts
  - prisma/schema.prisma + migrations

- backend/services/user-service
  - src/server.ts
  - src/routes/profile.routes.ts
  - src/controllers/profile.controller.ts
  - src/services/profile.service.ts
  - src/repositories/profile.repository.ts
  - prisma/schema.prisma + migrations

- backend/services/fitness-service
  - src/server.ts: ket noi Redis + start worker.
  - src/routes/*: workouts, nutrition, stats, exercises.
  - src/workers/workout.worker.ts: queue background.
  - prisma/schema.prisma + migrations

- backend/services/ai-service
  - src/server.ts: check Qdrant + start worker.
  - src/routes/ai.routes.ts
  - src/workers/ai.worker.ts
  - src/ingest.ts: nap du lieu cho RAG.
  - prisma/schema.prisma + migrations

- backend/services/chat-service
  - src/server.ts: create http server + init socket.
  - src/app.ts + socket layer.
  - prisma/schema.prisma + migrations.

- backend/shared
  - src/index.ts, errors.ts, schemas.ts, metrics.ts, types.ts.

---

## 3) Port map va ket noi

Host ports:
- Web: 5174
- Gateway: 3000
- Auth: 3001
- Fitness: 3002
- AI: 3003
- User: 3004
- Chat: 3005
- Postgres host: 5433 (container 5432)
- Redis: 6379
- Qdrant: 6333/6334

Trong Docker network:
- Gateway goi service bang DNS ten service:
  - auth-service:3001
  - user-service:3004
  - fitness-service:3002
  - ai-service:3003
  - chat-service:3005

---

## 4) Cach chay he thong

## 4.1 Chay bang Docker (khuyen nghi cho run full stack)

Tu thu muc goc repo:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up --build -d
```

Kiem tra:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json
```

Dung he thong:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down
```

Xoa volume (mat du lieu DB):

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down -v
```

## 4.2 Chay local dev watch mode (hot reload)

Co script:
- scripts/dev/START_ALL_SIMPLE.ps1

Script nay:
1. Kiem tra Docker daemon.
2. Kill process cu theo port.
3. Start tung service bang pnpm dev (tsx watch / vite).
4. Kiem tra health va mo browser.

Ly do co 2 mode:
- Docker mode: giong production runtime, de test integration day du.
- Local watch mode: developer feedback nhanh khi sua code.

---

## 5) Quy trinh startup trong Docker Compose

Trinh tu startup logic:
1. postgres, redis, qdrant khoi dong truoc.
2. auth-service, user-service, fitness-service, ai-service, chat-service start sau khi dependency san sang.
3. api-gateway start sau khi backend service healthy.
4. web start sau gateway.

Tai sao chay theo trinh tu nay:
- Giam race condition (service goi den dependency chua san sang).
- Dam bao client vao Gateway la co route backend co the phan hoi.
- Healthcheck cho phep compose dieu phoi startup on dinh hon.

---

## 6) Luong request tong quan

## 6.1 Login flow

1. Frontend goi POST /auth/login qua Gateway.
2. Gateway proxy sang auth-service.
3. Auth service tra accessToken + refreshToken + user.
4. Frontend luu token vao localStorage.
5. Request tiep theo tu dong gan Authorization Bearer token.

## 6.2 Profile flow

1. Frontend goi GET/PUT /profile/me.
2. Gateway auth middleware verify JWT (qua auth-service /auth/verify).
3. Gateway proxy sang user-service.
4. User service doc/ghi user_profiles trong Postgres qua Prisma.

Mo rong da co:
- Frontend Save Profile goi them PATCH /auth/me de luu firstName/lastName vao bang users (auth DB), va PUT /profile/me de luu metrics.

## 6.3 Workout + AI flow

1. Frontend goi /workouts, /nutrition, /stats, /ai.
2. Gateway route den fitness-service hoac ai-service.
3. Fitness service dung Redis queue/worker cho tac vu background.
4. AI service goi model LLM + co the dung Qdrant cho RAG.
5. Ket qua luu Postgres va tra ve frontend.

## 6.4 Chat flow

1. REST chat qua /chat (Gateway -> chat-service).
2. Real-time chat qua Socket.IO service chat.
3. Chat service co the validate user qua auth-service va profile qua user-service.

---

## 7) Luong chay ben trong mot service (template)

Vi du service backend (auth/user/fitness/ai):

1. server.ts
- load env
- init app
- khoi dong listener
- dang ky graceful shutdown SIGTERM

2. app.ts
- middleware security (helmet, cors)
- parse request (json)
- logging + metrics
- /health endpoint
- mount routes
- 404 + error handler

3. routes
- khai bao HTTP endpoint, map controller

4. controllers
- validate input (zod)
- goi service layer
- mapping response status

5. services
- business logic
- xu ly transaction sequence
- call repository + external integration

6. repositories
- truy cap database qua Prisma

Tai sao chia layer nhu vay:
- Testability tot hon.
- Tach nghiep vu khoi web layer va data layer.
- De thay doi storage/integration ma it anh huong controller.

---

## 8) Cau truc chay file va vi sao chay nhu vay

## 8.1 Gateway

- Entry: backend/gateway/src/server.ts
- app.ts mount middleware + proxy routes

Ly do:
- Gateway la API facade duy nhat cho frontend.
- Co auth middleware, rate-limit, centralized logging/error.
- Giam coupling frontend voi tung service port rieng.

## 8.2 Auth service

- Entry: backend/services/auth-service/src/server.ts
- Route auth tai auth.routes.ts
- Business tai auth.service.ts
- Data tai auth.repository.ts

Ly do:
- Xac thuc la concern rieng, can token lifecycle ro rang.
- Duoc tai su dung boi Gateway va cac service khac thong qua /auth/verify.

## 8.3 User service

- Entry: backend/services/user-service/src/server.ts
- Focus profile nghiep vu

Ly do:
- Tach profile metrics khoi auth identity.
- Don gian hoa data model va scale profile API doc lap.

## 8.4 Fitness service

- Entry: backend/services/fitness-service/src/server.ts
- Co Redis + worker

Ly do:
- Tac vu workout generation/coaching co the cham, can queue de tranh block request.

## 8.5 AI service

- Entry: backend/services/ai-service/src/server.ts
- Check Qdrant availability, start AI worker

Ly do:
- LLM va vector search la tai nguyen rieng, can service boundary tach biet.

## 8.6 Chat service

- Entry: backend/services/chat-service/src/server.ts
- HTTP server + Socket.IO

Ly do:
- Chat real-time can websocket lifecycle rieng, de tach khoi REST service.

## 8.7 Frontend

- Dev: vite.config.ts proxy /api -> gateway
- Docker runtime: nginx.conf proxy /api -> api-gateway trong network

Ly do:
- Tranh CORS phuc tap.
- Frontend luon goi cung mot base path /api.
- Moi truong dev va docker van nhat quan contract.

---

## 9) Bien moi truong quan trong

Nhom bien chinh:
- DB: POSTGRES_*, DATABASE_URL
- JWT: JWT_SECRET, JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY
- Service URL: AUTH_SERVICE_URL, USER_SERVICE_URL, FITNESS_SERVICE_URL, AI_SERVICE_URL, CHAT_SERVICE_URL
- AI: LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL, EMBEDDING_MODEL
- CORS: CORS_ORIGIN

Nguyen tac van hanh:
- Dat .env tai root repo.
- Compose doc bien bang --env-file .env.
- Trong container, service-to-service URL dung DNS ten service.

---

## 10) Van hanh thuong ngay

## 10.1 Lenh co ban

Start full stack:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up --build -d
```

Xem trang thai:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
```

Xem logs mot service:

```powershell
docker logs gymcoach-gateway --tail 200
docker logs gymcoach-auth --tail 200
docker logs gymcoach-user --tail 200
docker logs gymcoach-fitness --tail 200
docker logs gymcoach-ai --tail 200
docker logs gymcoach-chat --tail 200
```

Health checks:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3004/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3002/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3003/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3005/health" | ConvertTo-Json
```

---

## 11) Quy trinh khi sua code

## 11.1 Neu chay Docker mode

- Sua backend/frontend code -> can rebuild image lien quan:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up -d --build <service>
```

Vi du:
- Sua frontend: build web
- Sua auth API: build auth-service va api-gateway neu route/proxy thay doi

## 11.2 Neu chay local watch mode

- Dung scripts/dev/START_ALL_SIMPLE.ps1
- Service auto-reload bang tsx watch/vite

---

## 12) Tai sao he thong duoc thiet ke theo cach nay

1. Monorepo + shared package
- Chia se types/schemas/logger, giam duplicate.
- Dong bo contract nhanh giua frontend va backend.

2. API Gateway
- Centralized auth, rate limit, observability.
- Giu frontend contract on dinh, khong can biet tung service ben duoi.

3. Microservice boundaries
- Auth = identity
- User = profile
- Fitness = workout/nutrition
- AI = model + RAG
- Chat = realtime

Dieu nay giup team phat trien song song va scale theo domain.

4. Infra tich hop san (Postgres + Redis + Qdrant)
- Ho tro query data nghiep vu, queue/cache, vector retrieval.

5. Docker Compose + healthcheck
- Tao runtime reproducible tren may moi.
- Giam bug startup race.

---

## 13) Danh sach file nen doc dau tien khi onboarding

1. docs/setup/RUN_PROJECT_FLOW.md
2. infra/compose/docker-compose.dev.yml
3. frontend/New/src/app/services/api.ts
4. backend/gateway/src/routes/proxy.routes.ts
5. backend/services/auth-service/src/routes/auth.routes.ts
6. backend/services/user-service/src/routes/profile.routes.ts
7. backend/services/fitness-service/src/routes
8. backend/services/ai-service/src/routes/ai.routes.ts
9. backend/services/chat-service/src
10. backend/shared/src

---

## 14) Checklist startup nhanh

1. Docker daemon dang chay
2. .env co day du bien
3. Chay compose up --build -d
4. Kiem tra compose ps tat ca service Up/healthy
5. Kiem tra health endpoints
6. Mo web http://localhost:5174

Neu co loi token:
- Dang xuat va dang nhap lai
- Kiem tra /auth/login va /auth/verify
- Kiem tra gateway/auth logs

---

## 15) Ghi chu cap nhat gan day

- Frontend da co interceptor xu ly 401 va thu refresh token.
- Save Profile da luu du lieu vao 2 noi:
  - PATCH /auth/me cho firstName/lastName
  - PUT /profile/me cho profile metrics

Tai lieu nay nen duoc cap nhat moi khi:
- Them service moi
- Doi route/proxy contract
- Doi quy trinh startup/deploy
- Doi strategy auth/token
