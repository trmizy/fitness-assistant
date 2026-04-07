# AI Service Flow (Current Codebase)

## 1) Tong quan kien truc

AI flow hien tai chay theo chuoi:

1. Frontend goi API vao Gateway (`/ai/*`)
2. Gateway verify token voi auth-service
3. Gateway forward request sang ai-service kem `x-user-id`
4. ai-service xu ly pipeline Orchestrator (profile + intent + safety + retrieve + recommend + format/LLM)
5. rag.service danh gia relevance, luu conversation vao Postgres
6. Ket qua tra lai frontend

Thanh phan chinh:

- Gateway auth/proxy: `backend/gateway/src/routes/proxy.routes.ts`, `backend/gateway/src/middleware/auth.middleware.ts`
- AI app/routes/controller: `backend/services/ai-service/src/app.ts`, `backend/services/ai-service/src/routes/ai.routes.ts`, `backend/services/ai-service/src/controllers/ai.controller.ts`
- Core RAG/LLM: `backend/services/ai-service/src/services/rag.service.ts`, `backend/services/ai-service/src/llm/orchestrator.service.ts`, `backend/services/ai-service/src/llm/retriever.ts`, `backend/services/ai-service/src/services/llm.service.ts`
- Persistence: `backend/services/ai-service/src/repositories/conversation.repository.ts`

## 2) Entry points trong AI service

### App-level routes

File: `backend/services/ai-service/src/app.ts`

- `GET /health`
- `GET /metrics`
- `use('/ai', aiRoutes)`
- `use('/plans', planRoutes)`

### AI routes

File: `backend/services/ai-service/src/routes/ai.routes.ts`

- `POST /ai/ask`
- `GET /ai/conversations`
- `POST /ai/feedback`
- `GET /ai/feedback/stats`
- `POST /ai/generate-workout`
- `POST /ai/generate-plan`

### Plans routes

File: `backend/services/ai-service/src/routes/plan.routes.ts`

- `POST /plans/workout/generate` (delegate sang `aiController.generatePlan`)
- `POST /plans/explain` (stub)
- `POST /plans/adjust` (stub)
- `GET /plans/shopping-list` (stub)
- `GET /plans/current` (stub)

## 3) Luong chi tiet `POST /ai/ask`

### 3.1 Gateway -> Controller

1. Frontend goi `POST /ai/ask` qua gateway.
2. Gateway auth middleware verify Bearer token voi auth-service.
3. Gateway forward request sang ai-service, kem `x-user-id`.
4. `aiController.ask()` doc:
   - `question` tu body
   - `userId` tu `x-user-id`
   - `authorization` tu header de pass tiep cho profile extractor
5. Controller goi: `ragService.rag(question, userId, authorizationHeader)`

File chinh: `backend/services/ai-service/src/controllers/ai.controller.ts`

### 3.2 RAG service layer

Trong `ragService.rag(...)`:

1. Ghi nhan `startTime`
2. Goi `llmOrchestrator.run(question, userId, authHeader)`
3. Goi them 1 lan LLM de tu-danh-gia do lien quan cua answer (`NON_RELEVANT | PARTLY_RELEVANT | RELEVANT | UNKNOWN`)
4. Luu conversation vao Postgres qua `conversationRepository.create(...)`
5. Tra payload cuoi cung (answer + token usage + trace metadata + recommendation)

File chinh: `backend/services/ai-service/src/services/rag.service.ts`

## 4) Orchestrator pipeline ben trong

File: `backend/services/ai-service/src/llm/orchestrator.service.ts`

Thu tu thuc thi hien tai:

1. `traceLogger.start(...)`
2. `profileExtractor.extract(userId, authHeader)`
   - Goi `user-service` (`/profile/me`, `/inbody`)
   - Goi `fitness-service` (`/workouts`, `/nutrition`)
   - Dung `Promise.allSettled` de khong fail toan bo neu 1 nguon loi
3. `languageGuard.resolve(question, userId)`
4. `intentRouter.route(...)` + `inputParser.parse(...)`
5. `safetyGuard.evaluate(question)` de chan request giam can nguy hiem
6. `retriever.retrieve(question)` lay context tu Qdrant
7. `recommendationEngine.recommend(profile, parsedInput)` tao recommendation deterministic
8. `responseFormatter.format(...)` tao deterministic answer co cau truc
9. Quyet dinh co goi LLM khong:
   - LLM intents: `general_fitness_knowledge`, `schedule_specific_day_request`, `body_recomposition_request`, `meal_plan_request`
   - Hoac khi `mentionsInjury = true`
   - Neu unsafe request bi block thi khong vao LLM path
10. Neu can LLM:
   - `promptBuilder.build(...)`
   - `llmService.callLLM(prompt)`
   - `labelLocalizer.localize(...)`
11. `answerValidator.validate(...)`
12. `traceLogger.end(...)`
13. Tra ve `FinalAnswerPayload`

Luu y quan trong:

- `usedFallback` trong response hien tai map theo `retrieval.isEmpty` (khong phai fallback transport).
- Chat co the van tra loi ngay ca khi retrieval rong nho deterministic formatting.

## 5) VectorDB nam o dau va chay nhu the nao

### 5.1 VectorDB nam o dau

VectorDB dang dung la Qdrant, chay thanh mot container rieng trong Docker Compose:

- Service: `qdrant`
- Image: `qdrant/qdrant:latest`
- HTTP port: `6333`
- gRPC port: `6334`
- Persistent volume: `qdrant_data:/qdrant/storage`

File: `infra/compose/docker-compose.dev.yml`

Trong ai-service, ket noi Qdrant duoc config boi env:

- `QDRANT_HOST=qdrant`
- `QDRANT_PORT=6333`

Va client khoi tao tai:

- `backend/services/ai-service/src/repositories/qdrant.ts`

### 5.2 Collection va du lieu dang tim

Retriever query den collection co ten co dinh:

- `exercises`

File: `backend/services/ai-service/src/llm/retriever.ts`

Payload points duoc map thanh noi dung bai tap:

- `exerciseName`, `typeOfActivity`, `typeOfEquipment`, `bodyPart`, `type`, `muscleGroupsActivated`, `instructions`

Source metadata trong retriever ghi ro:

- `source_file: data/processed/rag/exercises.csv`

### 5.3 Ingestion path (CSV -> Embedding -> Qdrant)

Script ingestion:

- File: `backend/services/ai-service/src/ingest.ts`
- Collection tao moi: `exercises`
- Vector size: `768`
- Distance metric: `Cosine`

Flow ingest:

1. Resolve CSV path (uu tien `RAG_INGEST_CSV_PATH`, fallback `data/processed/rag/exercises.csv`)
2. Parse CSV thanh records exercise
3. Goi embedding model qua `LLM_BASE_URL/api/embeddings` (mac dinh model `nomic-embed-text`)
4. Upsert theo batch vao Qdrant

### 5.4 Retrieval runtime (`/ai/ask`)

Trong runtime retrieve:

1. Expand query thanh nhieu variants (`expandQueries`) theo signal fat-loss/muscle-gain/injury/equipment
2. Moi variant:
   - Tao embedding qua `llmService.generateEmbedding(...)`
   - Search Qdrant collection `exercises` voi `limit = TOP_K`
3. Loc theo nguong score:
   - `MIN_SCORE = RAG_MIN_SCORE` (default `0.35`)
4. Dedupe theo point id, sort giam dan theo score, cat `TOP_K` (default `8`)
5. Neu khong con doc nao dat nguong -> `isEmpty = true`

Note resilience:

- Neu 1 variant query fail (embedding hoac qdrant call loi), retriever log warning va tiep tuc variant khac.
- Neu tat ca variants fail/khong dat threshold, orchestrator van co deterministic answer.

## 6) LLM provider va token accounting

File: `backend/services/ai-service/src/services/llm.service.ts`

### Generation path

- Primary: Ollama-style `POST {LLM_BASE_URL}/api/generate`
- Fallback: OpenAI-compatible `POST {LLM_BASE_URL}/v1/chat/completions`

### Embedding path

- `POST {LLM_BASE_URL}/api/embeddings`
- Model embedding qua `EMBEDDING_MODEL` (default `nomic-embed-text`)

### Token usage

`promptTokens`, `completionTokens`, `totalTokens` lay tu response neu provider tra ve, sau do duoc persist cung conversation.

## 7) Persistence va async jobs

### Postgres persistence

Repository: `backend/services/ai-service/src/repositories/conversation.repository.ts`

Du lieu duoc luu:

- Conversation logs: question/answer/model/response_time/relevance/token usage/feedback
- Workout plan generation output: bang `workoutPlan`

### Queue + worker (`generate-plan`)

Files:

- `backend/services/ai-service/src/services/conversation.service.ts`
- `backend/services/ai-service/src/workers/ai.worker.ts`

Flow:

1. API add job vao BullMQ queue `ai-tasks`
2. Worker lay job, goi LLM tao plan
3. Worker persist plan vao Postgres
4. API tra ve `202 Accepted` + `jobId`

Redis connection dung env `REDIS_HOST`/`REDIS_PORT`.

## 8) Startup va health behavior

File: `backend/services/ai-service/src/server.ts`

Khi boot:

1. Load env
2. Thu ket noi Qdrant (`getCollections`)
3. Neu fail: log warning "Qdrant not available, search functionality limited"
4. Van start HTTP server (khong hard-fail vi Qdrant)

Health:

- `GET /health` -> `{ status: 'ok', service: 'ai-service' }`
- `GET /metrics` -> Prometheus metrics

## 9) Cac bien moi truong quan trong

AI service can nhat:

- `PORT` (default 3003)
- `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`
- `QDRANT_HOST`, `QDRANT_PORT`
- `USER_SERVICE_URL`, `FITNESS_SERVICE_URL`
- `LLM_PROVIDER`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `EMBEDDING_MODEL`
- `RAG_MIN_SCORE` (default 0.35)
- `RAG_TOP_K` (default 8)

## 10) Cac command van hanh huu ich

### Kiem tra Qdrant trong docker

```bash
docker compose -f infra/compose/docker-compose.dev.yml ps qdrant
curl http://localhost:6333/collections
```

### Chay ingest du lieu exercise vao Qdrant

```bash
cd backend/services/ai-service
pnpm tsx src/ingest.ts
```

### Smoke test AI ask endpoint qua gateway

```bash
curl -X POST http://localhost:3000/ai/ask \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"Tao lich tap 5 buoi 1 tuan de tang co"}'
```

## 11) Tong ket nhanh

- VectorDB khong nam trong code memory, ma nam trong container Qdrant (`qdrant_data` volume) va duoc ai-service query qua host `qdrant:6333`.
- Runtime retrieve la embedding-based search tren collection `exercises`, co query expansion + score threshold.
- `/ai/ask` la pipeline ket hop deterministic recommendation + LLM (co dieu kien) + persistence + relevance evaluation.

---

Cap nhat lan cuoi: 2026-03-24
