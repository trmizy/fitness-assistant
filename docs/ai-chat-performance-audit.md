# AI Chat Performance Audit

Scope: AI Coach chat latency for requests such as `Phan tich InBody moi nhat cua toi`.

## Request Flow

Frontend:

- `frontend/web/src/app/pages/client/AICoachPage.tsx`
- `frontend/web/src/app/stores/pendingAiTasks.ts`
- `frontend/web/src/app/services/api.ts`
- Streaming endpoint: `POST /ai/ask/stream`
- Non-stream fallback endpoint: `POST /ai/ask`

Gateway:

- `backend/gateway/src/routes/proxy.routes.ts`
- Generic AI proxy timeout is longer than the AI service internal timeout.
- Streaming chat is proxied as an SSE request.

AI service:

- Route/controller: `backend/services/ai-service/src/controllers/ai.controller.ts`
- Service wrapper: `backend/services/ai-service/src/services/rag.service.ts`
- Orchestration: `backend/services/ai-service/src/llm/orchestrator.service.ts`
- Context: `profile_extractor.ts`, workout/nutrition context resolvers
- Retrieval: `retriever.ts` -> Qdrant
- Generation: `llm.service.ts` -> Ollama
- Validation/fallback: `answer_validator.ts`, deterministic formatter

## Main Latency Risks

- Ollama cold start or missing `LLM_MODEL`.
- Embedding model cold start or missing `EMBEDDING_MODEL`.
- RAG query expansion creating multiple embedding calls.
- Qdrant missing collections or slow search.
- Downstream profile/InBody/workout/nutrition context calls.
- Long prompt generation on local CPU.

## Timeouts And Fallbacks

Default limits:

- Profile/context fetch: `AI_CHAT_CONTEXT_TIMEOUT_MS`, default `5000`.
- RAG retrieval: `AI_CHAT_RAG_TIMEOUT_MS`, default `8000`.
- Body-composition evidence: `AI_CHAT_EVIDENCE_TIMEOUT_MS`, default `8000`.
- Embedding call: `EMBEDDING_TIMEOUT_MS`, default `8000`.
- LLM generation: `AI_CHAT_LLM_TIMEOUT_MS` or `LLM_TIMEOUT_MS`, default `60000`.
  For local dev on CPU, prefer `AI_CHAT_LLM_TIMEOUT_MS=30000` so a cold or
  overloaded Ollama instance falls back quickly.
- Frontend stream timeout: `75000`.

Fallback policy:

- Context failure: continue with empty profile context and log `profile_context_unavailable`.
- RAG failure: continue without retrieved context and log `rag_unavailable`.
- Evidence failure: continue without evidence enrichment and log `evidence_unavailable`.
- Nutrition context failure/timeout: return a short localized fallback and log `nutrition_context_unavailable`.
- Workout schedule context failure/timeout: return a short localized fallback and log `workout_schedule_context_unavailable`.
- Generic LLM failure/timeout: return a deterministic user-facing fallback and set `fallbackReason=llm_unavailable`.
- InBody/body-composition LLM timeout with deterministic body-composition text available: return deterministic body-composition analysis and set `fallbackReason=llm_timeout_deterministic_body_comp`.

## Observability

Each AI chat request includes a `traceId` used as `request_id` in logs.

Structured timing fields:

- `totalMs`
- `profileContextMs`
- `ragTotalMs`
- `chatHistoryMs`
- `scheduleContextMs`
- `nutritionContextMs`
- `evidenceMs`
- `promptBuildMs`
- `llmGenerateMs`
- `validationMs`

The timing log intentionally does not include email, token, full prompt, full chat, or raw health/body-composition data.

## Debug Commands

```bash
pnpm --filter @gym-coach/ai-service run build
pnpm --filter @gym-coach/ai-service run ai:check:ollama
pnpm --filter @gym-coach/ai-service run ai:warmup
pnpm --filter @gym-coach/ai-service run ai:check:rag
pnpm --filter @gym-coach/ai-service run ai:debug:chat -- "Phan tich InBody moi nhat cua toi"
```

If Ollama models are missing:

```bash
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

If RAG collections are missing:

```bash
pnpm --filter @gym-coach/ai-service run ai:test:seed-rag
pnpm --filter @gym-coach/ai-service run ai:reindex
```
