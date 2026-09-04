# Development Setup

This is the canonical setup guide for the current repository. It replaces the
older quick-start, new-machine, run-flow, system-operations, and standalone
Ollama guides that duplicated one another.

## Prerequisites

- Windows 10/11 with Docker Desktop using Linux containers
- Node.js 20 or newer
- Corepack and pnpm 8 or newer
- Git
- Ollama when AI features are required

Check the toolchain:

```powershell
node --version
corepack pnpm --version
docker version
docker compose version
ollama --version
```

## First-Time Setup

From the repository root:

```powershell
Copy-Item .env.example .env
corepack enable
pnpm install
```

Review `.env`. Development values are convenient defaults, not production
secrets. Never commit `.env`, API keys, provider credentials, SSH keys, or real
user health data.

## Ollama Modes

### Recommended development mode: Ollama on Windows

The AI and knowledge-worker containers use
`http://host.docker.internal:11434`. Start Ollama on Windows with a listener
that Docker Desktop can reach:

```powershell
$env:OLLAMA_HOST = "0.0.0.0:11434"
ollama serve
```

Open a second terminal and verify the host endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Verify access from Docker:

```powershell
docker run --rm curlimages/curl:latest http://host.docker.internal:11434/api/tags
```

Current defaults:

```dotenv
LLM_PROVIDER=ollama
LLM_BASE_URL=http://host.docker.internal:11434
OLLAMA_BASE_URL=http://host.docker.internal:11434
LLM_MODEL=fitness-coach-qwen2.5-1.5b:q4_K_M
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
LLM_TIMEOUT_MS=300000
EMBEDDING_TIMEOUT_MS=120000
LLM_NUM_CTX=8192
LLM_JSON_NUM_CTX=8192
```

The chat model name may be overridden with any compatible installed Ollama
model. Embeddings must continue to use `nomic-embed-text`; the chat model is not
an embedding model.

### Docker-local Ollama

Use the optional profile when running Ollama in Docker is preferable:

```powershell
$env:LLM_BASE_URL = "http://ollama:11434"
$env:OLLAMA_BASE_URL = "http://ollama:11434"
$env:LOCAL_OLLAMA_CHAT_MODEL = "llama3.2:3b"
docker compose -f infra/compose/docker-compose.dev.yml --profile local-ollama up -d --build
```

The profile starts `ollama` and `ollama-model-puller`. It is CPU-only by
default, so the smaller fallback model is intentional.

### Remote Ollama through a private tunnel

Compose does not require a specific remote provider. If a private SSH tunnel is
already running on Windows, point both URLs at the host-side tunnel port. For
example, for a tunnel listening on `11435`:

```dotenv
LLM_BASE_URL=http://host.docker.internal:11435
OLLAMA_BASE_URL=http://host.docker.internal:11435
```

Keep the tunnel lifecycle and credentials outside this repository. Do not
expose Ollama directly to the public Internet.

## Start And Stop

Start the standard development stack:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml up -d --build
docker compose -f infra/compose/docker-compose.dev.yml ps
```

Stop containers while preserving data:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down
```

Removing volumes deletes local databases, vector indexes, queues, and local
Ollama data. Use the following only when a full reset is intentional:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down -v
```

## Optional Profiles

| Profile | Services | Command suffix |
| --- | --- | --- |
| `local-ollama` | Ollama and model puller | `--profile local-ollama` |
| `knowledge` | Background knowledge worker | `--profile knowledge` |
| `automation` | n8n | `--profile automation` |
| `observability` | Prometheus, Grafana, exporters | `--profile observability` |

Profiles can be combined:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --profile automation --profile observability up -d
```

## Health Checks

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-WebRequest http://localhost:5173 -UseBasicParsing
Invoke-RestMethod http://localhost:3003/health
docker compose -f infra/compose/docker-compose.dev.yml ps
```

Test Ollama from the running AI container:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service sh -lc "wget -qO- http://host.docker.internal:11434/api/tags"
```

The AI health response checks connectivity and verifies both the configured chat
and embedding model. Ollama names with or without the `:latest` suffix are
accepted.

## Seed Accounts

`db-seeder` runs after the core services become healthy unless
`SKIP_SEED=true`. It creates disposable test users:

```text
Customer: testuser001@example.com ... testuser100@example.com
PT:       testpt001@example.com ... testpt005@example.com
Password: Test@123456
```

Clean only this seeded dataset with:

```powershell
pnpm run seed:cleanup
```

## Development Commands

```powershell
pnpm run build
pnpm run lint
pnpm test
pnpm run prisma:generate
pnpm run db:migrate
```

Run a workspace directly:

```powershell
pnpm --filter @gym-coach/web dev
pnpm --filter @gym-coach/ai-service build
pnpm --filter @gym-coach/fitness-service test
```

## Docker Tests

```powershell
pnpm docker:test:fast
pnpm docker:test:full
pnpm docker:test:logs
pnpm docker:test:down
```

Fast mode is the normal code/build verification path. Full mode starts isolated
test infrastructure. Real Ollama is opt-in; see
[`docker/test/README.md`](../../docker/test/README.md).

## Logs And Troubleshooting

Follow the main logs:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs -f api-gateway ai-service fitness-service
```

Inspect one service:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml logs --tail=200 ai-service
```

Common causes:

| Symptom | Check |
| --- | --- |
| AI service remains unhealthy | Ollama listener, Docker host access, both models in `/api/tags` |
| `host.docker.internal` cannot resolve | Compose `extra_hosts` and Docker Desktop Linux-container mode |
| AI returns deterministic fallback | AI logs for timeout/model/RAG warnings; Qdrant collections; model warm-up |
| Web opens but API calls fail | Gateway health and Vite proxy targets |
| Prisma client mismatch | `pnpm run prisma:generate`, then rebuild the affected service |
| Port already allocated | Find the process/container using ports in the root service map |
| Seed data is missing | `docker compose ... logs db-seeder`, then `pnpm run docker:reset-seeder` |

For Windows Defender application-control issues, see
[WINDOWS_DEFENDER_FIX.md](WINDOWS_DEFENDER_FIX.md). For database details, see
[DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) and
[DB_INSPECTION_COMMANDS.md](DB_INSPECTION_COMMANDS.md).
