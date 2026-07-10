# AI Service Operations Guide

Tai lieu nay tom tat toan bo luong chay, cau hinh, DB, log, test va streaming SSE cua `ai-service`.

> Nguyen tac van hanh: khong hard-code token/userId/planId trong code. Khi test local, dung bien moi truong nhu `$env:ACCESS_TOKEN`, `$env:USER_ID`, `$env:PLAN_ID`, `$env:JOB_ID`.

## 1. Service Va Cong Nghe

AI service nam tai:

- `backend/services/ai-service`
- Port container: `3003`
- Port qua gateway/frontend: `3000`
- Frontend dev: `http://localhost:5173`

Cac thanh phan chinh:

- Express API: `src/app.ts`, `src/server.ts`
- Auth middleware: `src/middleware/auth.middleware.ts`
- Chat/RAG: `src/services/rag.service.ts`, `src/llm/orchestrator.service.ts`
- LLM client: `src/services/llm.service.ts`
- AI Plan worker: `src/workers/ai.worker.ts`
- Nutrition AI worker: `src/services/nutrition.processor.ts`
- Queue: BullMQ queue `ai-tasks`
- DB: Postgres database `gymcoach_ai`
- Vector DB: Qdrant
- LLM runtime: Ollama

## AI Training vs RAG Ingestion

He thong hien tai khong fine-tune va khong train model weights.

Mo hinh AI dang chay la:

- Ollama local LLM runtime
- `LLM_MODEL`, mac dinh `llama3.2:3b`
- `EMBEDDING_MODEL`, mac dinh `nomic-embed-text`
- Qdrant vector DB
- RAG indexing + prompt policy + deterministic fitness logic + safety validation
- Evaluation scripts de kiem tra retrieval/policy/chat behavior

Khi chay ingest/reindex, repo chi nap knowledge vao Qdrant va tao embedding.
Do la knowledge ingestion / RAG indexing, khong phai fine-tuning.

File instruction-style trong `data/catalog/rag/gym_instruction_tuning_pairs.csv`
chi nen xem la instruction examples cho evaluation hoac future fine-tuning. Repo
chua co LoRA/QLoRA/Transformers pipeline va khong sua model weights.

## 2. Docker Compose Dev

Compose file:

```powershell
infra/compose/docker-compose.dev.yml
```

AI service env quan trong:

```env
PORT=3003
DATABASE_URL=postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_ai
REDIS_HOST=redis
REDIS_PORT=6379
QDRANT_HOST=qdrant
QDRANT_PORT=6333
USER_SERVICE_URL=http://user-service:3004
FITNESS_SERVICE_URL=http://fitness-service:3002
LLM_PROVIDER=ollama
LLM_BASE_URL=http://ollama:11434
OLLAMA_BASE_URL=http://ollama:11434
LLM_MODEL=llama3.2:3b
EMBEDDING_MODEL=nomic-embed-text
LLM_JSON_NUM_CTX=4096
AI_PLAN_NUM_PREDICT=650
AI_PLAN_RETRY_NUM_PREDICT=450
AI_PLAN_TIMEOUT_MS=60000
AI_PLAN_RETRY_TIMEOUT_MS=35000
INTERNAL_SERVICE_SECRET=...
```

Services lien quan:

- `ai-service`: API + BullMQ worker trong cung process
- `ollama`: LLM local, port `11434`
- `ollama-model-puller`: pull model luc compose start
- `qdrant`: vector database, port `6333`
- `redis`: BullMQ backend
- `postgres`: database, host port `5433`
- `api-gateway`: public API port `3000`
- `web`: Vite frontend port `5173`

## 3. Health Check

Kiem tra container:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
```

Kiem tra AI service health:

```powershell
curl.exe http://localhost:3003/health
curl.exe http://localhost:3000/health
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service sh -lc "wget -qO- http://localhost:3003/health"
```

`/health` cua AI service tra ve:

- `status`
- `service`
- `retrieval`
- `llmAvailable`
- `llmProvider`
- `llmUrl`
- `llm.model`
- `llm.embeddingModel`
- `llm.error` neu co

Kiem tra LLM health qua API plan:

```powershell
curl.exe http://localhost:3000/plans/llm-health -H "Authorization: Bearer $env:ACCESS_TOKEN"
```

## 4. Ollama Va Model

Model dang cau hinh:

- Chat model: `llama3.2:3b`
- Embedding model: `nomic-embed-text`

Lenh kiem tra:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs ollama --tail=200
docker compose -f infra/compose/docker-compose.dev.yml exec ollama ollama list
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service sh -lc "wget -qO- http://ollama:11434/api/tags || curl -s http://ollama:11434/api/tags"
```

Pull model neu thieu:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ollama ollama pull llama3.2:3b
docker compose -f infra/compose/docker-compose.dev.yml exec ollama ollama pull nomic-embed-text
```

Loi thuong gap:

- `LLM provider unreachable`: `ai-service` khong ket noi duoc `ollama:11434`
- `Missing model(s)`: Ollama chay nhung thieu model
- `LLM provider timed out`: model qua tai, prompt dai, CPU/RAM cham, hoac Ollama dang xu ly request khac

## 5. Qdrant Va RAG

Qdrant config:

```env
QDRANT_HOST=qdrant
QDRANT_PORT=6333
RAG_MIN_SCORE=0.35
RAG_TOP_K=5
```

Kiem tra Qdrant:

```powershell
curl.exe http://localhost:6333/collections
curl.exe http://localhost:6333/collections/fitness_evidence
docker compose -f infra/compose/docker-compose.dev.yml logs qdrant --tail=100
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service sh -lc "wget -qO- http://qdrant:6333/collections"
```

Scope retrieval:

- Chat AI Coach duoc phep dung:
  - `exercises`
  - `fitness_knowledge`
  - `fitness_faq`
  - `fitness_evidence`
- AI Workout Plan khong dung `qdrant:exercises`.
- AI Workout Plan chi retrieve evidence tu:
  - `fitness_evidence`

File lien quan:

- `src/llm/retriever.ts`
- `src/llm/plan_evidence.ts`
- `src/llm/body_composition_rules.ts`

Knowledge ingestion / RAG indexing:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ingest -- --collection=all
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ai:reindex
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run data:validate
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run data:ingest
```

RAG/evaluation/safety tests:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ai:test:rag
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ai:eval:retrieval
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ai:test:evidence
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run test:policy
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run test:evaluation
```

## 6. API Chat AI Coach

Routes:

```text
POST /ai/ask
POST /ai/ask/stream
GET  /ai/conversations
POST /ai/feedback
GET  /ai/feedback/stats
```

Code:

- Routes: `src/routes/ai.routes.ts`
- Controller: `src/controllers/ai.controller.ts`
- RAG service: `src/services/rag.service.ts`
- Orchestrator: `src/llm/orchestrator.service.ts`
- Prompt builder: `src/llm/prompt_builder.ts`

Call non-streaming:

```powershell
curl.exe -X POST http://localhost:3000/ai/ask `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{ "question": "thứ 3 tuần này tập gì" }'
```

Luồng xử lý:

1. Gateway verify JWT.
2. Gateway forward `x-user-id`, `x-user-role`, `x-internal-token`, `Authorization`.
3. `requireAuth` trong AI service tin gateway headers.
4. `ragService.rag()` gọi `llmOrchestrator.run()`.
5. Orchestrator:
   - detect language
   - safety guard
   - detect nutrition lookup
   - detect workout schedule lookup
   - fetch profile/InBody/workout/nutrition context
   - retrieve RAG neu can
   - build prompt
   - call LLM neu intent can LLM
   - validate answer
   - save conversation vao `conversations`

## 7. Streaming SSE Cua AI Coach

Route:

```text
POST /ai/ask/stream
```

Code backend:

- `src/controllers/ai.controller.ts`
- Method: `askStream`

Code frontend:

- `frontend/web/src/app/services/api.ts`
- Method: `coachService.chatStream`
- UI state: `frontend/web/src/app/stores/pendingAiTasks.ts`
- Page: `frontend/web/src/app/pages/client/AICoachPage.tsx`

### 7.1 Request

Frontend goi qua gateway:

```http
POST http://localhost:3000/ai/ask/stream
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "question": "thứ 3 tuần này tập gì"
}
```

Curl test:

```powershell
curl.exe -N -X POST http://localhost:3000/ai/ask/stream `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{ "question": "thứ 3 tuần này tập gì" }'
```

Direct-to-ai-service local debug, chi dung khi co internal headers hop le:

```powershell
curl.exe -N -X POST http://localhost:3003/ai/ask/stream `
  -H "x-internal-token: $env:INTERNAL_SERVICE_SECRET" `
  -H "x-user-id: $env:USER_ID" `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{ "question": "thứ 3 tuần này tập gì" }'
```

### 7.2 Response Headers

Backend set:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` giup tranh proxy buffer SSE.

### 7.3 Event Format

Backend ghi moi event theo format:

```text
data: {"type":"status","message":"Đang đọc hồ sơ của bạn..."}

data: {"type":"token","content":"Theo"}

data: {"type":"done","conversationId":"..."}
```

Cac event type:

| Type     | Payload              | Y nghia                     |
| -------- | -------------------- | --------------------------- |
| `status` | `{ message }`        | Cap nhat milestone pipeline |
| `token`  | `{ content }`        | Chunk text hien thi typing  |
| `done`   | `{ conversationId }` | Stream thanh cong           |
| `error`  | `{ message }`        | Stream loi                  |

### 7.4 Luu y Quan Trong Ve Streaming

Hien tai SSE cua AI Coach la **pseudo-streaming**:

1. Backend goi `ragService.rag()` va doi ra **toan bo answer**.
2. Sau khi co answer, backend cat thanh chunk nho.
3. Moi chunk gui ra SSE event `token`.

Thong so chunking trong `ai.controller.ts`:

```ts
const CHUNK_SIZE = 4;
const TOKEN_INTERVAL_MS = 18;
```

Dieu nay co nghia:

- UI co typing effect.
- Nhưng LLM khong stream token truc tiep tu Ollama len UI trong route nay.
- Neu LLM cham, user van se cho den khi `ragService.rag()` tra ve lan dau, sau do moi thay token.

`llm.service.ts` co ham `callLLMStream()`, nhung luong `/ai/ask/stream` hien tai khong dung ham nay de stream token raw tu Ollama. Route nay stream ket qua cuoi theo chunk UX.

### 7.5 Frontend Reader

Frontend doc stream bang:

```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
```

Moi chunk duoc tach theo newline:

```ts
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? "";
```

Frontend chi xu ly line bat dau bang:

```text
data:
```

Neu stream ket thuc ma khong co `done` hoac `error`, frontend bao:

```text
Connection lost. Please try again.
```

### 7.6 Auth Refresh Trong Streaming

Trong `coachService.chatStream()`:

1. Goi stream voi `localStorage.accessToken`.
2. Neu response status `401`, goi `refreshOnce()`.
3. Neu refresh thanh cong, retry request stream mot lan.
4. Neu refresh fail, clear session va redirect login.

### 7.7 Debug SSE

Logs backend:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs -f ai-service
docker compose -f infra/compose/docker-compose.dev.yml logs -f api-gateway
```

Loi hay gap:

- `503`: LLM unavailable.
- Response khong co `body`: gateway/proxy bi loi hoac request fail truoc khi stream.
- Stream ket thuc khong co `done`: ket noi bi drop, backend crash, hoac proxy timeout.
- UI dung o status: LLM dang cham truoc khi answer duoc chunk ra.

## 8. Workout Schedule Lookup Trong Chat

File chinh:

- `src/llm/workout_schedule_context.ts`

Priority lookup:

1. `scheduled_session` tu fitness-service `/workouts/schedules`
2. `active_workout_program` tu `/workouts/programs/current`
3. `generated_ai_plan` tu DB `workout_plans`
4. `recent_workout_logs` tu `/workouts`
5. `none`

Neu intent la schedule lookup nhung khong co lich cu the, AI service phai tra:

```text
Mình chưa thấy lịch tập cụ thể được lưu cho [ngày].
```

Khong nen fallback sang tong quan profile/macro/lich mau.

Debug:

```env
DEBUG_WORKOUT_SCHEDULE=true
DEBUG_INTENT_ROUTING=true
```

Test:

```powershell
cd backend/services/ai-service
npm run ai:test:workout-schedule-chat
```

## 9. Nutrition Lookup Trong Chat

File chinh:

- `src/llm/nutrition_context.ts`

Priority lookup:

1. Nutrition logs tu `/nutrition`
2. Daily task tu `/nutrition/daily-task`
3. Generated AI nutrition plan tu DB `nutrition_plans`
4. Nutrition goal tu `/nutrition/goals`
5. `none`

Debug:

```env
DEBUG_INTENT_ROUTING=true
```

Test:

```powershell
cd backend/services/ai-service
npm run ai:test:nutrition-chat
```

## 10. AI Workout Plan Flow

API:

```text
POST /plans/workout/generate
GET  /plans/job/:jobId
GET  /plans/current
GET  /plans/:planId
POST /plans/explain
POST /plans/adjust
DELETE /plans/:planId
POST /plans/:planId/save-to-workout-log
```

Code:

- Route: `src/routes/plan.routes.ts`
- Controller: `src/controllers/plan.controller.ts`
- Queue service: `src/services/conversation.service.ts`
- Worker: `src/workers/ai.worker.ts`
- Schema: `src/schemas/plan.schemas.ts`

Generate flow:

1. Frontend calls `POST /plans/workout/generate`.
2. Controller checks `llmService.getHealthStatus()`.
3. Creates `workout_plans` row with `QUEUED`.
4. Adds BullMQ job `generate-plan`.
5. UI polls `GET /plans/job/:jobId`.
6. Worker marks plan `PROCESSING`.
7. Worker fetches exercises from fitness-service:
   - `GET /internal/exercises/for-ai-plans`
8. Worker fetches personal context:
   - user profile
   - InBody
   - recent workouts
   - recent nutrition
9. Worker runs body composition rules.
10. Worker retrieves evidence from Qdrant `fitness_evidence`.
11. Worker builds compact JSON prompt.
12. Worker calls Ollama.
13. Worker validates JSON shape and exerciseIds.
14. Worker repairs deterministic issues if possible.
15. Worker attaches:

- `adjustment_reason`
- `evidence_used`
- `safety_notes`
- camelCase aliases

16. Worker marks plan `COMPLETED` or `FAILED`.

Generate command:

```powershell
curl.exe -X POST http://localhost:3000/plans/workout/generate `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{ "goal": "Giảm mỡ tăng cơ", "durationWeeks": 8, "daysPerWeek": 4, "exercisesPerDay": 6 }'
```

Poll job:

```powershell
curl.exe http://localhost:3000/plans/job/$env:JOB_ID `
  -H "Authorization: Bearer $env:ACCESS_TOKEN"
```

Save to workout log:

```powershell
curl.exe -X POST http://localhost:3000/plans/$env:PLAN_ID/save-to-workout-log `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{ "startDate": "2026-06-01", "repeatWeeks": 8, "selectedWeekdays": [1,2,3,4], "replaceExisting": true }'
```

## 11. AI Nutrition Plan Flow

API:

```text
POST /plans/nutrition/generate
GET  /plans/nutrition/current
POST /plans/nutrition/:planId/explain
POST /plans/nutrition/:planId/adjust
DELETE /plans/nutrition/:planId
POST /plans/nutrition/:planId/save-to-nutrition
```

Generate flow:

1. Controller checks LLM health.
2. Creates `nutrition_plans` row with `QUEUED`.
3. Adds BullMQ job `generate-nutrition-plan`.
4. Worker imports `processNutritionPlanJob()`.
5. Fetches foods from fitness-service:
   - `GET /internal/foods/for-ai-nutrition`
6. Fetches profile/InBody/nutrition context.
7. Builds compact 1-day meal template prompt.
8. Calls LLM JSON mode.
9. Expands template into 7 days using DB foods.
10. Validates foodId exists.
11. Marks plan `COMPLETED` or `FAILED`.

## 12. DB Schema Lien Quan

AI database: `gymcoach_ai`

Tables:

- `conversations`
- `workout_plans`
- `nutrition_plans`

Fitness database: `gymcoach_fitness`

Tables AI Plan import can ghi:

- `workout_programs`
- `workout_program_days`
- `workout_program_exercises`
- `workout_schedules`
- `workouts`
- `workout_exercises`
- `workout_sets`
- `nutrition_programs`
- `nutrition_program_days`
- `nutrition_program_meals`
- `nutrition_program_meal_items`
- `nutrition_logs`
- `nutrition_goals`

User database: `gymcoach_user`

Tables profile/InBody:

- `user_profiles`
- `inbody_entries`

## 13. DB Inspection Commands

AI DB:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "\dt"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "select id,user_id,name,status,job_id,fail_reason,created_at,updated_at from workout_plans order by created_at desc limit 10;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "select id,user_id,name,status,job_id,fail_reason,created_at,updated_at from nutrition_plans order by created_at desc limit 10;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "select id,user_id,route_intent,response_time,used_fallback,used_deterministic_fallback,warning_count,created_at,left(question,120) as question from conversations order by created_at desc limit 20;"
```

Fitness DB:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "\dt"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select id,user_id,name,source_plan_id,source_type,status,days_per_week,created_at from workout_programs order by created_at desc limit 10;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select ws.id,ws.user_id,ws.date::date,ws.status,ws.progress_percent,ws.source_plan_id,wpd.day_number,wpd.title from workout_schedules ws left join workout_program_days wpd on wpd.id=ws.program_day_id order by ws.date desc limit 30;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select user_id,date::date,count(*) from workout_schedules group by user_id,date::date having count(*) > 1;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select id,workout_id,exercise_id,sets,reps,weight,created_at from workout_exercises order by created_at desc limit 20;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select id,workout_exercise_id,set_number,reps,weight,completed,created_at from workout_sets order by created_at desc limit 30;"
```

User DB:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_user -c "\dt"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_user -c "select user_id,age,gender,heightCm,goal,activityLevel,experienceLevel,currentWeight,targetWeight from user_profiles order by updatedAt desc limit 10;"

docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_user -c "select user_id,date::date,date_only,weight,height,bmi,body_fat,body_fat_pct,muscle_mass,status,created_at from inbody_entries order by date desc limit 20;"
```

## 14. Logs

All services:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs --tail=100
```

AI service:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs ai-service --tail=200
docker compose -f infra/compose/docker-compose.dev.yml logs -f ai-service
```

Gateway:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs api-gateway --tail=200
```

Fitness/user dependencies:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs fitness-service --tail=200
docker compose -f infra/compose/docker-compose.dev.yml logs user-service --tail=200
```

Infra:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs postgres --tail=100
docker compose -f infra/compose/docker-compose.dev.yml logs redis --tail=100
docker compose -f infra/compose/docker-compose.dev.yml logs qdrant --tail=100
docker compose -f infra/compose/docker-compose.dev.yml logs ollama --tail=100
```

## 15. Redis / BullMQ

Queue name:

```text
ai-tasks
```

Worker nam trong:

```text
src/workers/ai.worker.ts
```

Kiem tra Redis:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec redis redis-cli ping
docker compose -f infra/compose/docker-compose.dev.yml exec redis redis-cli --scan --pattern "bull:ai-tasks*"
```

Admin endpoints doc queue:

```text
GET /admin/ai/overview
GET /admin/ai/queue
GET /admin/ai/errors
```

Frontend/API service:

- `frontend/web/src/app/services/api.ts`
- `adminService.getAIOverview`
- `adminService.getAIQueue`
- `adminService.getAIErrors`
- `adminService.getAIKnowledgePipeline`
- `adminService.enqueueAIKnowledgeJob`
- Admin Portal -> AI Observability -> Knowledge tab

Knowledge pipeline queue:

```text
knowledge-pipeline
```

Code:

- `src/knowledge-pipeline/`
- `src/scripts/runKnowledgePipeline.ts`
- `src/scripts/startKnowledgePipelineWorker.ts`
- `src/scripts/scheduleKnowledgePipeline.ts`

Manual scripts:

```powershell
corepack pnpm --filter @gym-coach/ai-service run knowledge:pipeline
corepack pnpm --filter @gym-coach/ai-service run knowledge:pubmed
corepack pnpm --filter @gym-coach/ai-service run knowledge:rss
corepack pnpm --filter @gym-coach/ai-service run knowledge:web
corepack pnpm --filter @gym-coach/ai-service run knowledge:schedule
corepack pnpm --filter @gym-coach/ai-service run knowledge:worker
corepack pnpm --filter @gym-coach/ai-service run knowledge:test-rag
```

Docker worker:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --profile knowledge up -d knowledge-worker
```

Small end-to-end smoke test:

```powershell
$headers = @{
  "x-internal-token" = "dev_internal_service_secret_change_in_production"
  "x-user-id"        = "codex-admin"
  "x-user-role"      = "ADMIN"
  "Content-Type"     = "application/json"
}
$body = @{ embed = $true; force = $true; limit = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3003/admin/ai/knowledge/jobs/local" -Headers $headers -Body $body
Invoke-RestMethod -Method Get -Uri "http://localhost:3003/admin/ai/knowledge" -Headers $headers
Invoke-RestMethod -Method Get -Uri "http://localhost:6333/collections/fitness_evidence"
```

Expected result: queue has zero failed jobs, latest run is `SUCCESS`, `docsAccepted >= 1`, and Qdrant collection `fitness_evidence` has at least one point.

RAG smoke test after embedding:

```powershell
$env:QDRANT_HOST = "localhost"
$env:QDRANT_PORT = "6333"
$env:LLM_BASE_URL = "http://localhost:11434"
$env:LLM_PROVIDER = "ollama"
$env:EMBEDDING_MODEL = "nomic-embed-text"
corepack pnpm --filter @gym-coach/ai-service run knowledge:test-rag
```

Expected result: script prints `status: PASS`, returns at least one `fitness_evidence` document through `retrieveEvidence`, and also finds the same collection through chat retrieval scope.

Local evidence loader searches for `data/processed/evidence`. If the service is launched from a custom working directory, set `KNOWLEDGE_DATA_ROOT` to the repo `data` directory.

RSS note: the old NSCA feed URL returns `404` as of June 6, 2026, so the default RSS source is `source-sciencedaily-fitness` (`https://www.sciencedaily.com/rss/health_medicine/fitness.xml`). ACE also publishes official RSS feeds, but FeedBurner can be slow or blocked in some local environments.

Admin endpoints:

```text
GET    /admin/ai/knowledge
POST   /admin/ai/knowledge/jobs/local
POST   /admin/ai/knowledge/jobs/pubmed
POST   /admin/ai/knowledge/jobs/rss
POST   /admin/ai/knowledge/jobs/web
POST   /admin/ai/knowledge/review/:reviewId/approve
POST   /admin/ai/knowledge/review/:reviewId/reject
POST   /admin/ai/knowledge/schedule
DELETE /admin/ai/knowledge/schedule
```

Useful query/body params for job endpoints:

```text
embed=true|false
force=true|false
limit=10
query=...
sourceId=...
```

Internal endpoints with `x-service-secret` are still available under `/internal/knowledge/*` for service-to-service automation.

Low-resource Windows startup:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-local-low-resource.ps1
powershell -ExecutionPolicy Bypass -File scripts/dev-stop-extras.ps1
powershell -ExecutionPolicy Bypass -File scripts/dev-lite.ps1
```

`configure-local-low-resource.ps1` writes `%USERPROFILE%\.wslconfig` and updates Docker Desktop settings. Close Docker Desktop and run `wsl --shutdown` once for the WSL memory limit to take effect.

Docker Desktop note: the Start button may not bring every Compose dependency up in order and may start optional containers you do not need. Prefer `scripts/dev-lite.ps1` for daily work. Use these profiles only when needed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-lite.ps1 -WithAutomation
powershell -ExecutionPolicy Bypass -File scripts/dev-lite.ps1 -WithObservability
docker compose -f infra/compose/docker-compose.dev.yml --profile knowledge up -d knowledge-worker
```

`ollama-model-puller` and `db-seeder` are one-shot jobs, so `Exited (0)` or an old exited state can be normal after they finish.

## 16. Build Va Test Commands

Trong `backend/services/ai-service`:

```powershell
npm run build
npm test
npm run test:all
npm run data:validate
npm run data:ingest
npm run data:ingest:nhanes
npm run ai:reindex
npm run ai:test:evidence
npm run ai:test:plan-evidence
npm run ai:test:workout-schedule-chat
npm run ai:test:intent-routing
npm run ai:test:nutrition-chat
```

Tu root repo:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
docker compose -f infra/compose/docker-compose.dev.yml up -d ai-service ollama qdrant redis postgres
```

Khong dung khi khong co yeu cau ro:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down -v
```

Lenh tren xoa volumes, co nguy co mat DB/model local.

## 17. Debug Flags

AI Plan:

```env
DEBUG_AI_PLAN=true
```

Log summary an toan:

- `planId`
- `goal`
- `daysPerWeek`
- `exercisesPerDay`
- token/timeout settings
- co user context khong
- evidence titles/source_url/source_type
- khong log secret/token/API key

Intent:

```env
DEBUG_INTENT_ROUTING=true
```

Workout schedule:

```env
DEBUG_WORKOUT_SCHEDULE=true
```

LLM self-eval:

```env
ENABLE_LLM_SELF_EVAL=true
```

Can than: self-eval goi them 1 request LLM sau moi `/ai/ask`, lam chat cham hon. Mac dinh nen de false.

## 18. Frontend Entry Points

AI Plans page:

```text
frontend/web/src/app/pages/client/AIPlansPage.tsx
```

AI Coach page:

```text
frontend/web/src/app/pages/client/AICoachPage.tsx
```

API wrapper:

```text
frontend/web/src/app/services/api.ts
```

Pending AI task/session store:

```text
frontend/web/src/app/stores/pendingAiTasks.ts
```

Frontend routes:

```text
/client/plans
/client/ai-coach
```

## 19. Checklist Dieu Tra Loi AI Plan Cham

1. Kiem tra Ollama:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ollama ollama list
docker compose -f infra/compose/docker-compose.dev.yml logs ollama --tail=200
```

2. Kiem tra AI service:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs ai-service --tail=200
curl.exe http://localhost:3003/health
```

3. Kiem tra queue:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec redis redis-cli --scan --pattern "bull:ai-tasks*"
```

4. Kiem tra DB plan dang keo dai:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "select id,user_id,status,job_id,fail_reason,created_at,updated_at from workout_plans order by created_at desc limit 20;"
```

5. Kiem tra fitness-service catalog:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs fitness-service --tail=200
```

6. Neu LLM timeout nhieu:

- giam `daysPerWeek`
- giam `exercisesPerDay`
- kiem tra `AI_PLAN_NUM_PREDICT`
- kiem tra CPU/RAM
- kiem tra Ollama dang co request song song khong

## 20. Checklist Dieu Tra Chat Tra Loi Sai Context

1. Bat intent debug:

```env
DEBUG_INTENT_ROUTING=true
DEBUG_WORKOUT_SCHEDULE=true
```

2. Xem logs:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs -f ai-service
```

3. Kiem tra route intent trong DB:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_ai -c "select created_at,route_intent,left(question,120) as question,left(answer,160) as answer from conversations order by created_at desc limit 20;"
```

4. Kiem tra lich tap that trong fitness DB:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec postgres psql -U gymcoach -d gymcoach_fitness -c "select ws.date::date,ws.status,wp.name,wpd.day_number,wpd.title from workout_schedules ws left join workout_program_days wpd on wpd.id=ws.program_day_id left join workout_programs wp on wp.id=wpd.program_id order by ws.date desc limit 30;"
```

## 21. File Tham Chieu Nhanh

Backend AI:

- `backend/services/ai-service/src/app.ts`
- `backend/services/ai-service/src/server.ts`
- `backend/services/ai-service/src/routes/ai.routes.ts`
- `backend/services/ai-service/src/routes/plan.routes.ts`
- `backend/services/ai-service/src/controllers/ai.controller.ts`
- `backend/services/ai-service/src/controllers/plan.controller.ts`
- `backend/services/ai-service/src/services/llm.service.ts`
- `backend/services/ai-service/src/services/rag.service.ts`
- `backend/services/ai-service/src/services/conversation.service.ts`
- `backend/services/ai-service/src/services/nutrition.processor.ts`
- `backend/services/ai-service/src/workers/ai.worker.ts`
- `backend/services/ai-service/src/workers/worker-user-context.ts`
- `backend/services/ai-service/src/llm/orchestrator.service.ts`
- `backend/services/ai-service/src/llm/retriever.ts`
- `backend/services/ai-service/src/llm/workout_schedule_context.ts`
- `backend/services/ai-service/src/llm/nutrition_context.ts`
- `backend/services/ai-service/src/llm/prompt_builder.ts`
- `backend/services/ai-service/src/llm/body_composition_rules.ts`
- `backend/services/ai-service/src/llm/plan_evidence.ts`
- `backend/services/ai-service/prisma/schema.prisma`

Frontend:

- `frontend/web/src/app/pages/client/AIPlansPage.tsx`
- `frontend/web/src/app/pages/client/AICoachPage.tsx`
- `frontend/web/src/app/services/api.ts`
- `frontend/web/src/app/stores/pendingAiTasks.ts`

Infra:

- `infra/compose/docker-compose.dev.yml`
- `infra/compose/postgres-init.sql`

## Research Automation Operations

Research automation is optional and off by default. It refreshes RAG evidence; it
does not fine-tune model weights.

Dry-run:

```powershell
cd backend/services/ai-service
pnpm run knowledge:research:dry-run
```

Fetch metadata/abstract records without indexing:

```powershell
pnpm run knowledge:research:fetch
```

Review queue:

```text
data/research_review_queue.jsonl
```

Only run indexing after review/high-confidence filtering:

```powershell
pnpm run knowledge:research:index
```

Offline metadata eval:

```powershell
pnpm run knowledge:research:eval
```

Rollback: stop automation, identify the bad `retrieved_at` or `content_hash`,
delete matching Qdrant points from `fitness_evidence` or restore the Qdrant
volume snapshot, then rerun `ai:test:rag` and `ai:eval:retrieval`.

## Docker AI/RAG Test Environment

Use `pnpm docker:test:fast` for normal CI/dev verification. It does not call external research APIs and uses mock LLM mode.

Use `pnpm docker:test:full` when you want isolated Postgres/Redis/Qdrant test services. Full mode skips real Ollama-dependent checks unless `USE_OLLAMA=true` is set.

The test stack uses `docker-compose.test.yml`, test-only volumes, and safety env defaults:

- `ENABLE_RESEARCH_AUTOMATION=false`
- `DISABLE_EXTERNAL_RESEARCH_FETCH=true`
- `RESEARCH_REQUIRE_REVIEW_FOR_WEB=true`
- `DEBUG_RAG=false`

Commands:

```bash
pnpm docker:test:fast
pnpm docker:test:full
pnpm docker:test:down
pnpm docker:test:logs
```
