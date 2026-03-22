# AI Service Flow (Current Codebase)

## 1. Tong quan kien truc

AI service trong project chay theo mo hinh:

- Frontend goi API den gateway
- Gateway xac thuc token voi auth-service
- Gateway proxy request sang ai-service va gan thong tin user vao headers
- AI service xu ly RAG/LLM/Queue
- Ket qua duoc luu vao Postgres, du lieu tri thuc tim kiem nam trong Qdrant

## 2. Duong di request tu Frontend -> Gateway -> AI Service

### Frontend

- Frontend goi AI endpoints o app service layer:
  - `POST /ai/ask`
  - `GET /ai/conversations`
- Vi tri: `frontend/web/src/app/services/api.ts`

### Gateway

- Route `/ai` bat buoc qua `authMiddleware` truoc khi proxy:
  - Vi tri: `backend/gateway/src/routes/proxy.routes.ts`
- Sau khi auth thanh cong, gateway forward headers:
  - `x-user-id`
  - `x-user-email`
  - `x-user-role`

### Auth middleware o Gateway

- Kiem tra Bearer token
- Goi `AUTH_SERVICE_URL/auth/verify` de verify token
- Neu hop le thi set `x-user-*` vao request de service phia sau dung
- Vi tri: `backend/gateway/src/middleware/auth.middleware.ts`

## 3. Cac endpoint trong AI Service

Vi tri route: `backend/services/ai-service/src/routes/ai.routes.ts`

- `POST /ai/ask`
- `GET /ai/conversations`
- `POST /ai/feedback`
- `GET /ai/feedback/stats`
- `POST /ai/generate-workout`
- `POST /ai/generate-plan`

Controller: `backend/services/ai-service/src/controllers/ai.controller.ts`

## 4. Luong chi tiet endpoint quan trong

### A) `POST /ai/ask` (RAG chat)

1. Controller doc `question` va `userId` tu header `x-user-id`
2. Goi `ragService.rag(question, userId)`
3. Trong `ragService`:
   - Tao embedding cho query (qua `llmService.generateEmbedding`)
   - Search vector trong Qdrant collection `exercises`
   - Build prompt tu context exercise tim duoc
   - Goi LLM de sinh cau tra loi
   - Tu danh gia do lien quan (relevance)
   - Luu conversation vao Postgres
4. Tra response cho client (answer, token usage, relevance, conversationId)

Vi tri code:

- `backend/services/ai-service/src/controllers/ai.controller.ts`
- `backend/services/ai-service/src/services/rag.service.ts`
- `backend/services/ai-service/src/services/llm.service.ts`
- `backend/services/ai-service/src/repositories/conversation.repository.ts`

### B) `POST /ai/generate-plan` (bat dong bo)

1. Controller validate userId
2. Goi `conversationService.queuePlanGeneration(...)`
3. Service day job vao BullMQ queue `ai-tasks`
4. Worker BullMQ nhan job, goi LLM tao plan
5. Worker luu ket qua vao bang `workout_plans`
6. API tra ngay HTTP 202 (Accepted), khong cho ket qua cuoi ngay lap tuc

Vi tri code:

- `backend/services/ai-service/src/controllers/ai.controller.ts`
- `backend/services/ai-service/src/services/conversation.service.ts`
- `backend/services/ai-service/src/workers/ai.worker.ts`

## 5. AI Service lay du lieu tu dau

### Nguon tri thuc cho RAG

- Tu Qdrant collection: `exercises`
- Du lieu ban dau ingest tu file CSV: `data/processed/rag/exercises.csv`
- Script ingest:
  - Doc CSV
  - Tao embeddings qua Ollama `/api/embeddings`
  - Upsert vectors vao Qdrant
- Vi tri: `backend/services/ai-service/src/ingest.ts`

### Nguon LLM

- Mac dinh dung Ollama local:
  - `LLM_PROVIDER=ollama`
  - `LLM_BASE_URL=http://localhost:11434`
  - `LLM_MODEL=llama3.2:3b`
- Fallback ho tro OpenAI-compatible endpoint `/v1/chat/completions`
- Vi tri: `backend/services/ai-service/src/services/llm.service.ts`

### Nguon du lieu luu tru

- Postgres qua Prisma:
  - Bang `conversations`
  - Bang `workout_plans`
- Vi tri schema: `backend/services/ai-service/prisma/schema.prisma`

## 6. Khoi dong va suc khoe service

- Entry point: `backend/services/ai-service/src/server.ts`
- Khi start:
  - Check ket noi Qdrant (`getCollections`)
  - Start HTTP server
- App mount routes o `/ai`: `backend/services/ai-service/src/app.ts`

Health/metrics:

- `GET /health`
- `GET /metrics`

## 7. Tong ket hanh vi runtime

- Gateway la diem vao duy nhat cho frontend
- Auth duoc xu ly tap trung tai gateway + auth-service
- AI service khong tu verify JWT truc tiep, ma dung `x-user-id` do gateway forward
- RAG phu thuoc vao Qdrant + embeddings
- Generate plan dai han chay qua queue/worker de tranh block request
- Tat ca lich su hoi thoai va plan deu duoc persist vao Postgres

## 8. Ghi chu van hanh

- Neu Qdrant khong san sang, service van len nhung tim kiem RAG se bi han che
- Neu Ollama khong chay, call LLM se fail va tra message loi tu `llmService`
- Can ingest du lieu exercise vao Qdrant de chat RAG cho ket qua tot

---

Cap nhat lan cuoi: 2026-03-22
