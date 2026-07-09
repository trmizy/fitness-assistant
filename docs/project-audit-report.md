# Project Audit Report

Date: 2026-07-08
Scope: pre-GPU/fine-tuning stabilization for AI/RAG/data flows.

## Services

- `frontend/web`: React/Vite client.
- `backend/gateway`: public API facade, auth middleware, proxy to services.
- `backend/services/auth-service`: user identity and JWT lifecycle.
- `backend/services/user-service`: profile, InBody, PT contracts, locations, availability.
- `backend/services/fitness-service`: exercises, workout logs/programs, nutrition logs/plans, food catalog.
- `backend/services/ai-service`: AI chat, AI plan jobs, Ollama client, Qdrant retrieval, evidence/RAG indexing, knowledge refresh workers.
- `backend/services/chat-service`: conversations, realtime chat/call features.
- `backend/shared`: shared logger/errors/schemas/types.

## Databases And Collections

PostgreSQL databases are split by service boundary:

- Auth DB: users and auth lifecycle data.
- User DB: profile, InBody, PT/application/contract/domain data.
- Fitness DB: exercises, workout logs/programs, nutrition logs/plans, foods.
- AI DB: conversations, workout/nutrition AI plans, knowledge pipeline/admin entities.
- Chat DB: chat conversations/messages and call-related tables.

Qdrant collections used by AI service:

- `exercises`: semantic exercise catalog for AI Coach chat retrieval.
- `fitness_knowledge`: general gym/nutrition/workout chunks.
- `fitness_faq`: FAQ-style chunks.
- `fitness_evidence`: evidence/guideline/research metadata and chunks.

## User/Profile/InBody/Workout/Nutrition Flow

1. Frontend sends authenticated requests through Gateway.
2. Gateway verifies JWT and forwards user identity headers.
3. Profile/InBody live in user-service.
4. Workout/nutrition logs and catalogs live in fitness-service.
5. AI service reads context through `profile_extractor` for chat and `worker-user-context` for plan jobs.
6. CoachContext now normalizes profile, InBody, logs, constraints, calculated metrics, missing fields, and safety flags before prompt/plan validation.

## AI Service Flow

Chat flow:

1. `llm/orchestrator.service.ts` resolves language and safety.
2. It loads profile context, chat history, and RAG retrieval.
3. It builds CoachContext and body-composition analysis.
4. It retrieves evidence from `fitness_evidence` when needed.
5. Prompt builder receives sanitized context plus retrieved snippets.
6. Citations are built from retrieved metadata via `plan_evidence.ts`, not from model text.

Plan flow:

1. `ai.worker.ts` receives queued plan jobs.
2. It fetches allowed exercises from fitness-service DB; AI plan generation does not select exercise IDs from Qdrant.
3. It fetches user context, builds CoachContext, retrieves evidence, and sends compact prompt to Ollama.
4. Existing JSON parser validates the legacy plan contract.
5. New coach plan validator checks calculated constraints, available days, beginner volume, injury notes, protein/calories, and missing-data behavior.
6. Hard validation failures fall back to deterministic backend plan content.

## Data Duplication Or Schema Drift Risks

- Weight can exist in both profile and InBody. The AI path should prefer latest InBody weight and use profile weight only as fallback.
- Exercise catalog exists in fitness DB and Qdrant `exercises`. AI plan jobs correctly use fitness DB for real IDs; Qdrant exercises should remain chat-only.
- Nutrition targets may exist in user goals, current nutrition plan, and AI generated plan JSON. Validator should treat backend-calculated targets as authoritative.
- Workout schedule can exist as active programs, logs, and AI plan drafts. Saved schedule lookup should read active programs/logs, not pending AI drafts.
- Chat-service build currently fails due Prisma generated type mismatch for call enums. This blocks full repo build but is outside AI/RAG changes.
- Some legacy seed SQL/docs contain mojibake. New/modified AI/RAG files avoid mojibake, but full historical data cleanup is still a separate migration task.

## Terminology Corrections

Current repo should use:

- knowledge ingestion
- RAG indexing
- retrieval evaluation
- evidence refresh
- instruction examples
- optional future fine-tuning

Do not describe `data:ingest`, `knowledge:pipeline`, or `ai:reindex` as model training. They write embeddings/chunks to Qdrant and do not modify model weights.

## AI Wrong-Answer Risks

- Missing age/height/weight/goal can make calorie and protein targets uncertain. CoachContext now records missing fields.
- InBody/BIA values can be noisy if measurement conditions differ. Evidence and deterministic BIA guidance should mention standardization.
- LLM may invent citations if prompt is too open. Citation fields should only come from retrieved metadata.
- Weak evidence or metadata-only sources should not be presented as firm citations.
- Injury constraints can be missed if free-text injuries are not normalized. Validator now requires safety notes when injuries exist.
- Beginner volume can be too high if the model over-prescribes. Validator catches high beginner volume and can fallback.

## Pre-GPU Recommendation

Do not deploy A40 or train yet. First stabilize:

1. Run AI/RAG tests after each context or retrieval change.
2. Fix chat-service Prisma generated type drift before requiring full workspace build.
3. Run research automation in dry-run/fetch/review/index phases only.
4. Keep fine-tuning dataset synthetic/anonymized and separate from production user data.
