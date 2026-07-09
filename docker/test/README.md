# Docker Test Environment

This test stack is isolated from development and production. It uses separate container names, a separate Docker network, and test-only volumes.

## Fast Docker Test

Fast mode does not require real Ollama and does not fetch external research APIs.

```bash
pnpm docker:test:fast
```

It runs:

- workspace install from lockfile inside a Node test container
- Prisma client generation
- TypeScript/build checks
- unit tests
- AI service build
- research dry-run/eval without external fetch

## Full Docker Test

Full mode starts test Postgres, Redis, and Qdrant. It uses test databases only.

```bash
pnpm docker:test:full
```

By default, full mode uses `LLM_PROVIDER=mock`. It seeds Qdrant with a tiny deterministic test RAG corpus before running AI/RAG smoke and retrieval eval commands:

- `pnpm --filter @gym-coach/ai-service run ai:test:seed-rag`
- `pnpm --filter @gym-coach/ai-service run ai:test:rag`
- `pnpm --filter @gym-coach/ai-service run ai:eval:retrieval`

The seed creates the `exercises`, `fitness_knowledge`, `fitness_faq`, and `fitness_evidence` collections. It does not call crawler APIs.

To run against real Ollama, opt in explicitly:

```bash
USE_OLLAMA=true pnpm docker:test:full
```

This starts the `ollama` compose profile. It checks that `LLM_MODEL` and `EMBEDDING_MODEL` exist before seeding Qdrant. It does not download large models automatically. Pull required models yourself before expecting real Ollama checks to pass.

## Compose Directly

```bash
docker compose -f docker-compose.test.yml --profile fast up --abort-on-container-exit --exit-code-from test-runner-fast

docker compose -f docker-compose.test.yml --profile full up --abort-on-container-exit --exit-code-from test-runner-full
```

## Cleanup

```bash
pnpm docker:test:down
```

This removes test containers and test volumes.

## Logs

```bash
pnpm docker:test:logs
```

## Test Environment Variables

See `docker/test/.env.test.example` for the intended defaults. Important safety settings:

- `NODE_ENV=test`
- `ENABLE_RESEARCH_AUTOMATION=false`
- `DISABLE_EXTERNAL_RESEARCH_FETCH=true`
- `RESEARCH_REQUIRE_REVIEW_FOR_WEB=true`
- `DEBUG_RAG=false`
- test-only database URLs ending in `_test`

## Common Failures

- Docker not running: start Docker Desktop or the Docker daemon.
- Port conflict: test ports are `55433`, `56379`, `56333`, `56334`, and optional `51434`.
- Qdrant not healthy: inspect `docker compose -f docker-compose.test.yml logs qdrant-test`.
- Missing Ollama model: run full mode without `USE_OLLAMA=true`, or manually pull `llama3.2:3b` and `nomic-embed-text` in `ollama-test`. The runner prints exact pull commands when this happens.
- Missing Qdrant collection: full mode should self-seed test collections. If it still fails, run `pnpm --filter @gym-coach/ai-service run ai:test:seed-rag` inside the test runner container and inspect Qdrant logs.
- Prisma client stale: run `pnpm run prisma:generate` or use Docker test runner, which runs it before tests.
- Migration failure: verify test Postgres is healthy and database URLs point to `_test` databases.
- Windows CRLF warning: Git may warn that LF will be replaced by CRLF; this is not a test failure.
- pnpm store/cache issue: run `pnpm store prune` locally, or remove the `pnpm_store_test` Docker volume.
