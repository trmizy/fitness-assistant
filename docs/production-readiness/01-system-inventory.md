# 01 — System Inventory

Snapshot taken on branch `aws-deploy`, HEAD `81d9f432fa856c4e4f06d6b412071f4dbd6c15be` (merge of `origin/feature/payment-gateways`).
Working tree at audit start: **171 entries** modified or untracked (`git status --porcelain`). None of these were created by this audit.

## Repository layout (deployable product)

| Area | Path | Notes |
|---|---|---|
| Gateway | `backend/gateway` | Express; public entry; JWT check by calling auth-service; proxies all services; Socket.IO gateway |
| Auth | `backend/services/auth-service` | Registration, OTP, login, refresh, roles, internal routes |
| User / profile | `backend/services/user-service` | Profile, InBody measurements, availability, booking-related |
| Fitness | `backend/services/fitness-service` | Workouts, training cycles, nutrition, roadmaps, coach (PT) actions, exercise catalog |
| AI | `backend/services/ai-service` | Conversational Intelligence, orchestrator, LLM clients, RAG, marketplace, agent workflows |
| Chat | `backend/services/chat-service` | Conversations, messages, calls, Socket.IO |
| Gym | `backend/services/gym-service` | Gym branches, partners, check-in, memberships |
| Payment | `backend/services/payment-service` | Providers (MoMo, VNPay, PayOS, ZaloPay), webhooks, wallets |
| Shared | `backend/shared` | Logger, metrics, schemas, error types, gateway trust helpers |
| Web | `frontend/web` | Vite/React SPA; nginx container |
| Mobile | `frontend/mobile` | React Native app; SecureStore for tokens |
| Infra | `infra/` | Compose (dev, low-resource, prod), Terraform (dev only), CloudFormation, monitoring config, n8n workflows |
| Tools | `tools/db-migrator`, `infra/data-migration-importer` | Migration helpers |
| CI | `.github/workflows/docker-test.yml` | Single workflow |
| Research | `test/research/workout-plan-bpm`, `results/research/workout-plan-bpm`, `docs/research/workout-plan-bpm` | Research track; see §Research isolation |
| Other | `apps/`, `training/`, `reports/`, `output/`, `backups/`, `db_snapshots/`, `artifacts/`, `data/` | Mostly empty or operational; see G-35 |

## Services and data ownership

Each service owns a PostgreSQL database named `gymcoach_<service>` (prod compose env). Cross-service references are soft (`user_id` by value; see G-28).

| Service | Prisma schema | Migrations (approx.) | Health | Metrics |
|---|---|---|---|---|
| ai-service | yes | many | `/health` (includes LLM status) | `/metrics` |
| auth-service | yes | yes | `/health` | `/metrics` |
| chat-service | yes | yes | `/health` | `/metrics` |
| fitness-service | yes | 54 migration folders | `/health` | `/metrics` |
| gym-service | yes | yes | `/health` | `/metrics` |
| payment-service | yes | yes | `/health` | `/metrics` |
| user-service | yes | yes | `/health` | `/metrics` |

## Runtime dependencies

- PostgreSQL 15 (test and CI), RDS endpoint in production compose (not provisioned in repo).
- Redis 7 (rate limit store, caches, optional).
- Qdrant (vector store; semantic knowledge only, not business truth).
- Ollama with `qwen3:4b-instruct-2507-q4_K_M` (local inference). Bedrock and Anthropic provider code paths exist in `llm-provider-anthropic-regression.test.ts` and related files; their production status was not verified.
- MinIO (object storage, dev compose).
- Email/SMTP (optional; absence triggers dev OTP behaviour, see G-06).
- Payment providers (MoMo, VNPay, PayOS, ZaloPay).

## Feature flags and defaults observed

| Flag | Default in code | Production compose | Notes |
|---|---|---|---|
| `CONVERSATIONAL_INTELLIGENCE_V2` | `off` (`ciMode()`) | not set | Accepts `on`, `shadow`, `off` |
| `CONVERSATIONAL_INTELLIGENCE_V2_LLM` | `off` (`ciLlmAllowed()`) | not set | See G-17 |
| `ENABLE_TOOL_CALLING` | `false` | `"false"` | Only `"true"` enables |
| `ENABLE_AGENTIC_DEMO` | unset | unset | Demo guard (G-36) |
| `LLM_TIMEOUT_MS` | 60000 (orchestrator fallback) | `170000` (verification compose) | Two variables, see G-18 |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | 20 per 15 min | not set | Environment-dependent |
| `RATE_LIMIT_MAX_REQUESTS` | 100 per minute | not set | Dev stack showed 2000 |

## Deployment artefacts

- Dockerfiles: 8 backend and gateway (`USER` set), `frontend/web/Dockerfile` (no `USER`), tools and infra images.
- Compose: `infra/compose/docker-compose.dev.yml`, `docker-compose.low-resource.yml`, `docker-compose.prod.yml`, root `docker-compose.test.yml`, verification override under `test/ai-chat-full-verification/`.
- Terraform: `infra/terraform/environments/dev`; modules `cloudfront-spa`, `iam`, `lambda-http-api`, `private-s3-bucket`.
- Lambda entrypoints: `ai-service/src/{lambda,jobs-lambda,worker-lambda,migrate-lambda}.ts`, `auth-service/src/{lambda,migrate-lambda}.ts`, `chat-service/src/migrate-lambda.ts`.

## Tests (inventory, not execution)

- Test files (`*.test.*`, `*.spec.*`, `__tests__`): **393** across the repository.
- Frontend test files: **61**.
- Playwright specs: **4**.
- Root `pnpm test` runs `pnpm run --recursive test`.
- Live verification harnesses exist under `test/` (conversational, ai-chat-full-verification, research). They are classified separately in [13-ci-cd-test-strategy.md](13-ci-cd-test-strategy.md).

## Research isolation

Locations and state at audit time. Nothing in these paths was edited by the audit.

| Item | Path | Tracked by git? | Identifier |
|---|---|---|---|
| Frozen dataset | `test/research/workout-plan-bpm/dataset/frozen-150.v1.jsonl` | **No** (untracked) | SHA-256 `eedb1adb16bd3a1284371118b5a03c05a883294a815aa0fb3d79cd76ef8cc849` |
| Frozen dataset manifest | `test/research/workout-plan-bpm/dataset/frozen-150.manifest.json` | No | (see file) |
| Active run | `results/research/workout-plan-bpm/20261003T054521Z/` | No | run ID `20261003T054521Z` |
| Evaluator manifest (v4) | `…/20261003T054521Z/evaluator-manifest.json` | No | evaluator SHA-256 `45712c437f1c99b26197f7cdc465ed60662947cf9076a733a8386254752ddcbe` |
| Gate 1 source manifest | `…/20261003T054521Z/source-state/production-source-manifest.json` | No | aggregate `bd9269003a03883e6b68a46c0cd14fbdf37c3a3d566e4723c7543e2b20de23ef` (1,076 files) |
| Model manifest | `…/source-state/model-manifest.json` | No | Qwen manifest SHA-256 `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0` |
| Stop report | `…/STOP-REPORT.md` | No | Config A stopped (research track only) |
| Preflight failure (historical) | `results/research/workout-plan-bpm/20261003T054058Z` | No | BLOCKED; historical only |

Git commit and tag status: no research tag exists. The frozen artefacts are not in any commit, so their hashes are the only anchor.
See README §Research isolation for the recommended tag and branch strategy.

## What this inventory does not cover

- Mobile and web business flows beyond token storage and cache clearing.
- Production AWS account resources (none provisioned from this repository; no access used).
- Third-party provider sandboxes and live credentials.
