# Fitness Assistant - AI Gym Coach

Fitness Assistant is a local-first AI gym coach built with a React frontend,
an API gateway, microservices, PostgreSQL, Redis, Qdrant, and Ollama.

## AI Approach: RAG, Not Fine-Tuning

This repo currently runs an AI Fitness Assistant with Ollama + Qdrant + RAG.
It does not train or fine-tune model weights.

- LLM runtime: Ollama, defaulting in Docker dev to a Windows SSH tunnel at `host.docker.internal:11435`
- Base model: `LLM_MODEL`, default `qwen3:30b-a3b-instruct-2507-q4_K_M`
- Embedding model: `EMBEDDING_MODEL`, default `nomic-embed-text`
- Vector DB: Qdrant
- Main collections: `exercises`, `fitness_knowledge`, `fitness_faq`, `fitness_evidence`
- AI approach: knowledge ingestion, RAG indexing, prompt policy, deterministic fitness logic, safety validation, and evaluation

Gym and evidence data is ingested into Qdrant for retrieval. Instruction-style
datasets are treated as instruction examples, retrieval evaluation data, or
future fine-tuning research material. They are not an active fine-tuning
pipeline.

See `docs/ai-rag-architecture.md` for the full AI architecture and evaluation
commands.

For the default Docker dev setup, start the RunPod SSH tunnel before starting
the stack. From Windows the tunnel should answer at
`http://127.0.0.1:11435/api/tags`; from containers it is reached as
`http://host.docker.internal:11435`. To use Docker-local Ollama instead, run
Compose with `--profile local-ollama` and set `LLM_BASE_URL=http://ollama:11434`
and `OLLAMA_BASE_URL=http://ollama:11434`.

## Services

| Service         | Port | Role                             |
| --------------- | ---- | -------------------------------- |
| Web             | 5173 | React frontend                   |
| API Gateway     | 3000 | Routing, auth, rate limiting     |
| Auth Service    | 3001 | JWT authentication               |
| Fitness Service | 3002 | Exercises, workouts, nutrition   |
| AI Service      | 3003 | Ollama, RAG, AI plan generation  |
| User Service    | 3004 | Profiles and InBody records      |
| Chat Service    | 3005 | Chat data and realtime messaging |
| PostgreSQL      | 5433 | Service databases                |
| Redis           | 6379 | Cache and queues                 |
| Qdrant          | 6333 | Vector database                  |

## Quick Start

Start the dev stack:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml up -d
```

Open the app:

```text
http://localhost:5173
```

Default local login, if seed data is present:

```text
john.doe@example.com / password123
```

## Useful Commands

Install dependencies:

```powershell
pnpm install
```

Run all workspace tests:

```powershell
pnpm test
```

Build all workspaces:

```powershell
pnpm run build
```

Run AI service checks:

```powershell
cd backend/services/ai-service
pnpm run ai:test:rag
pnpm run ai:eval:retrieval
pnpm run test:policy
pnpm run test:evaluation
```

## Knowledge Ingestion And Evaluation

Run from `backend/services/ai-service`:

```powershell
pnpm run data:validate
pnpm run data:ingest
pnpm run ai:test:rag
pnpm run ai:eval:retrieval
```

These commands validate evidence data, index knowledge into Qdrant, and evaluate
retrieval quality. They do not train model weights.

## Repository Layout

```text
frontend/web                     React + Vite frontend
backend/gateway                  API gateway
backend/services/auth-service    Authentication service
backend/services/user-service    User profile and InBody service
backend/services/fitness-service Workout, exercise, and nutrition service
backend/services/ai-service      Ollama, RAG, AI chat, AI plans
backend/services/chat-service    Chat service
backend/shared                   Shared TypeScript utilities
data                             RAG, catalog, evidence, and eval data
docs                             Setup, operations, and AI architecture docs
infra/compose                    Docker Compose files
```

## Safety Notes

The assistant provides educational fitness guidance. It should not diagnose
disease, invent citations, or recommend unsafe rapid weight loss or training
through injury. Evidence citations should come from retrieved metadata, not from
model-generated text.

## Docker Test Environment

Fast Docker test runs build/unit/research dry-run checks without real Ollama or external research fetch:

```bash
pnpm docker:test:fast
```

Full Docker test starts isolated test Postgres, Redis, and Qdrant volumes:

```bash
pnpm docker:test:full
```

Use real Ollama only by explicit opt-in:

```bash
USE_OLLAMA=true pnpm docker:test:full
```

Direct compose usage:

```bash
docker compose -f docker-compose.test.yml --profile fast up --abort-on-container-exit --exit-code-from test-runner-fast
```

Cleanup and logs:

```bash
pnpm docker:test:down
pnpm docker:test:logs
```

See `docker/test/README.md` for test env variables, common failures, and safety rules.
