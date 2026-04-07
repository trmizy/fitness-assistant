# Quy trinh chay project va luong he thong

Tai lieu nay mo ta cach chay du an fitness-assistant theo cau truc hien tai (`frontend/`, `backend/`, `infra/`), dong thoi giai thich luong request va vai tro cua cac file quan trong.

## 1. Tong quan kien truc

Project duoc to chuc theo monorepo PNPM workspace:

- Frontend: React + Vite (`frontend/web`)
- API Gateway: Express (`backend/gateway`)
- Microservices:
  - Auth service (`backend/services/auth-service`)
  - User service (`backend/services/user-service`)
  - Fitness service (`backend/services/fitness-service`)
  - AI service (`backend/services/ai-service`)
- Shared package dung chung (`backend/shared`)
- Ha tang Docker (`infra/compose/docker-compose.dev.yml`)

Port mapping tren may local:

- Web: `5173`
- Gateway: `3000`
- Auth: `3001`
- Fitness: `3002`
- AI: `3003`
- User: `3004`
- Postgres: `5433` (container `5432`)
- Redis: `6379`
- Qdrant: `6333`

## 2. Quy trinh chay project bang Docker (khuyen nghi)

### 2.1 Dieu kien can

1. Da cai Docker Desktop
2. Docker daemon dang chay (`docker info` khong bao loi)
3. Co file `.env` tai root project (co the copy tu `.env.example`)

Luu y quan trong:

- Dung `--env-file .env` (file o root), khong dung `infra/compose/.env` neu file do khong ton tai.

### 2.2 Chay project

Chay tu thu muc goc repo:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up --build -d
```

Hoac dung script mot lenh (tu dong bat Ollama neu chua chay):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev\start-docker-with-ollama.ps1
```

### 2.3 Kiem tra sau khi chay

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json
```

Mo trinh duyet:

- Web UI: `http://localhost:5173`
- Gateway health: `http://localhost:3000/health`

### 2.4 Dung he thong

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down
```

Xoa ca volume (can than vi mat du lieu DB):

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down -v
```

## 3. Quy trinh startup trong Docker Compose

File dieu phoi chinh: `infra/compose/docker-compose.dev.yml`.

Thu tu logic startup:

1. `postgres`, `redis`, `qdrant` khoi dong truoc
2. `auth-service`, `user-service`, `fitness-service`, `ai-service` cho healthcheck
3. `api-gateway` chi start khi 4 service backend healthy
4. `web` start sau `api-gateway`

Y nghia:

- Giam loi race-condition khi service chua san sang
- Gateway luon route vao backend dang healthy

## 4. Luong request chinh cua he thong

### 4.1 Luong dang nhap

1. Frontend goi `POST /auth/login` qua Gateway
2. Gateway proxy sang Auth service
3. Auth service verify user va tra access/refresh token
4. Frontend luu token vao `localStorage`
5. Cac request tiep theo gui kem `Authorization: Bearer <token>`

### 4.2 Luong profile

1. Frontend goi `/profile/me`
2. Gateway kiem tra JWT (`authMiddleware`)
3. Gateway proxy sang User service
4. User service doc/ghi profile trong Postgres (Prisma)

### 4.3 Luong workout va AI

1. Frontend goi endpoint workout/plan/chat qua Gateway
2. Gateway route den Fitness service hoac AI service
3. Fitness service dung Redis/BullMQ cho job queue
4. Fitness worker co the goi AI service de sinh workout
5. AI service goi LLM, co the ket hop Qdrant cho RAG
6. Ket qua duoc luu vao Postgres va tra ve frontend

## 5. Giai thich tung file quan trong

## 5.1 File dieu phoi va cau hinh goc

- `infra/compose/docker-compose.dev.yml`
  - Dinh nghia tat ca container, env, healthcheck, depends_on
  - Dinh nghia network noi bo `gymcoach-network`

- `.env`
  - Bien moi truong runtime khi chay compose
  - Chua secret, URL service, thong so LLM

- `.env.example`
  - Mau bien moi truong de tao `.env`

- `pnpm-workspace.yaml`
  - Khai bao workspace package trong monorepo

- `tsconfig.base.json`
  - Cau hinh TypeScript dung chung cho backend packages

## 5.2 Frontend (`frontend/web`)

- `frontend/web/src/main.tsx`
  - Entry point React, mount `App`

- `frontend/web/src/app/App.tsx`
  - Router chinh, auth guard, provider (`AuthProvider`, `QueryClientProvider`)

- `frontend/web/src/app/services/api.ts`
  - Axios client va service methods cho auth/profile/workout/coach
  - Tu dong gan access token vao request header

- `frontend/web/Dockerfile`
  - Build static React app bang Node + pnpm
  - Chuyen sang nginx image de phuc vu production

- `frontend/web/nginx.conf`
  - SPA fallback (`try_files ... /index.html`)
  - Proxy `/api/*` sang `api-gateway:3000`

## 5.3 API Gateway (`backend/gateway`)

- `backend/gateway/src/server.ts`
  - Khoi dong HTTP server Gateway

- `backend/gateway/src/app.ts`
  - Dang ky middleware chung: security, CORS, rate limit, logging
  - Expose `/health`

- `backend/gateway/src/routes/proxy.routes.ts`
  - Mapping route va proxy den service dich:
    - `/auth` -> auth-service
    - `/profile` -> user-service
    - `/workouts`, `/nutrition`, `/stats`, `/exercises` -> fitness-service
    - `/ai` -> ai-service
  - Co auth middleware cho route protected

- `backend/gateway/Dockerfile`
  - Multi-stage build cho gateway + shared package

## 5.4 Auth Service (`backend/services/auth-service`)

- `backend/services/auth-service/src/server.ts`
  - Entry point cua auth service

- `backend/services/auth-service/src/app.ts`
  - Middleware + route + metrics

- `backend/services/auth-service/src/routes/auth.routes.ts`
  - Route auth: register/login/refresh/logout/verify

- `backend/services/auth-service/prisma/schema.prisma`
  - Schema user, token, audit log

- `backend/services/auth-service/Dockerfile`
  - Build service, generate Prisma client, migrate deploy khi start

## 5.5 User Service (`backend/services/user-service`)

- `backend/services/user-service/src/server.ts`
  - Entry point cua user service

- `backend/services/user-service/src/app.ts`
  - Middleware + `/health` + `/metrics`

- `backend/services/user-service/src/routes/profile.routes.ts`
  - API profile `/profile/me` (GET/PUT/DELETE)

- `backend/services/user-service/prisma/schema.prisma`
  - Schema profile/inbody lien quan user

## 5.6 Fitness Service (`backend/services/fitness-service`)

- `backend/services/fitness-service/src/server.ts`
  - Khoi dong service + ket noi Redis + graceful shutdown

- `backend/services/fitness-service/src/app.ts`
  - Route goc: exercises/workouts/nutrition/stats

- `backend/services/fitness-service/src/routes/workout.routes.ts`
  - CRUD workout + endpoint generate workout

- `backend/services/fitness-service/src/workers/workout.worker.ts`
  - Worker BullMQ xu ly queue tao workout, goi AI service

- `backend/services/fitness-service/prisma/schema.prisma`
  - Schema workout/exercise/nutrition

## 5.7 AI Service (`backend/services/ai-service`)

- `backend/services/ai-service/src/server.ts`
  - Khoi dong AI service, check ket noi Qdrant

- `backend/services/ai-service/src/app.ts`
  - Route `/ai` + health/metrics

- `backend/services/ai-service/src/routes/ai.routes.ts`
  - Endpoint chat, feedback, generate workout/plan

- `backend/services/ai-service/src/workers/ai.worker.ts`
  - Worker xu ly queue tao workout plan dai han

- `backend/services/ai-service/prisma/schema.prisma`
  - Schema conversation/workout plan

## 5.8 Shared package (`backend/shared`)

- `backend/shared/src/index.ts`
  - Export logger, types, schemas, errors, metrics

- `backend/shared/src/errors.ts`
  - Dinh nghia custom error dung chung

- `backend/shared/src/schemas.ts`
  - Zod schema dung chung

- `backend/shared/src/metrics.ts`
  - Helpers Prometheus metrics middleware

## 6. Quy trinh debug nhanh khi khong chay duoc

1. Kiem tra daemon Docker:

```powershell
docker info
```

2. Validate compose file:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env config
```

3. Xem trang thai container:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
```

## 7. Bat buoc: N8N API key cho `/admin/workflows`

Endpoint `GET /admin/workflows` tren gateway yeu cau:

1. Header `Authorization: Bearer <admin_access_token>`
2. Gateway env co `N8N_PUBLIC_API_KEY` hop le
3. n8n da tao API key trong owner account

### 7.1 File lien quan

- `.env`:
  - `N8N_PUBLIC_API_KEY`
  - `N8N_BASE_URL`
  - `N8N_BASIC_AUTH_USER`
  - `N8N_BASIC_AUTH_PASSWORD`
- `.env.example`:
  - Mau bien `N8N_PUBLIC_API_KEY`, `N8N_PUBLIC_API_DISABLED`
- `infra/compose/docker-compose.dev.yml`:
  - `api-gateway.environment.N8N_PUBLIC_API_KEY: ${N8N_PUBLIC_API_KEY}`
  - n8n service env (`N8N_PUBLIC_API_DISABLED`, basic auth)
- `backend/gateway/src/routes/proxy.routes.ts`:
  - `requestN8n()` gui header `X-N8N-API-KEY`
  - endpoint `/admin/workflows`

### 7.2 Tao API key trong n8n (local)

Neu n8n chua setup owner:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:5678/rest/owner/setup" -ContentType "application/json" -Body (@{
  email = "n8n.owner.local@example.com"
  firstName = "N8N"
  lastName = "Owner"
  password = "OwnerPass123!"
} | ConvertTo-Json)
```

Dang nhap va tao API key:

```powershell
$loginBody = @{ emailOrLdapLoginId = "n8n.owner.local@example.com"; password = "OwnerPass123!" } | ConvertTo-Json
$login = Invoke-WebRequest -Method Post -Uri "http://localhost:5678/rest/login" -ContentType "application/json" -Body $loginBody -SessionVariable n8nSession
$createBody = @{ label = "gateway-local"; scopes = @("workflow:list", "workflow:read"); expiresAt = [int64]([DateTimeOffset]::UtcNow.AddYears(1).ToUnixTimeMilliseconds()) } | ConvertTo-Json
$apiKeyResp = Invoke-RestMethod -Method Post -Uri "http://localhost:5678/rest/api-keys" -ContentType "application/json" -Body $createBody -WebSession $n8nSession
$apiKeyResp.data.rawApiKey
```

Gan key vao `.env`:

```dotenv
N8N_PUBLIC_API_KEY=<rawApiKey>
```

Reload gateway:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up -d --build api-gateway
```

### 7.3 Test endpoint workflows qua gateway

```powershell
$adminLogin = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/auth/login" -ContentType "application/json" -Body (@{ email = "admin@example.com"; password = "password123" } | ConvertTo-Json)
$token = $adminLogin.accessToken
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/admin/workflows" -Headers @{ Authorization = "Bearer $token" }
```

Expected response shape:

```json
{
  "success": true,
  "data": {
    "total": 0,
    "active": 0,
    "inactive": 0,
    "workflows": []
  }
}
```

## 8. Bat buoc: PT application review flow (approve/reject/request info)

### 8.1 Seed user test cho review flow

Da them SQL test nhanh: `scripts/tmp-admin-test-users.sql`

```powershell
Get-Content scripts/tmp-admin-test-users.sql | docker exec -i gymcoach-postgres psql -U gymcoach -d gymcoach_auth
```

User test:

- `pt.flow.reqinfo@example.com` / `Test@12345`
- `pt.flow.reject@example.com` / `Test@12345`
- `pt.flow.approve@example.com` / `Test@12345`

### 8.2 Chay test E2E admin + PT review

```powershell
node scripts/test-admin-e2e.mjs
```

Script se test:

1. `/admin/workflows` (n8n key path)
2. Tao + submit PT applications
3. Review `REQUEST_INFO`
4. Review `REJECT`
5. Review `APPROVE`
6. Kiem tra detail sau review

Expected state change:

- `REQUEST_INFO` -> `NEEDS_MORE_INFO` + `adminNote`
- `REJECT` -> `REJECTED` + `rejectionReason`
- `APPROVE` -> `APPROVED`

4. Xem logs theo service:

```powershell
docker logs gymcoach-gateway --tail 200
docker logs gymcoach-auth --tail 200
docker logs gymcoach-user --tail 200
docker logs gymcoach-fitness --tail 200
docker logs gymcoach-ai --tail 200
```

5. Goi health check:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3004/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3002/health" | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3003/health" | ConvertTo-Json
```

## 7. Ghi chu van hanh

- Neu doi schema Prisma, can rebuild image service lien quan de regenerate client.
- Cac service Prisma dang chay `prisma migrate deploy` luc startup container.
- Qdrant co the start cham hon; AI service van start duoc va se canh bao neu Qdrant chua san sang.
- Frontend trong Docker duoc serve boi nginx; route app-side van hoat dong nho SPA fallback.
- Trong Docker, `ai-service` can dung URL noi bo de lay profile/lich su:
  - `USER_SERVICE_URL=http://user-service:3004`
  - `FITNESS_SERVICE_URL=http://fitness-service:3002`
  Neu de mac dinh `localhost` thi AI se khong doc duoc profile da co san va se hoi lai thong tin co ban.
