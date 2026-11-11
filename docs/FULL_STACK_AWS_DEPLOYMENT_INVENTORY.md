# Full-Stack AWS Deployment Inventory

Operational reference for manual AWS Console deployment. Region
`ap-southeast-1`, account `191798898985`. All artifact paths below were
rebuilt from current source during the 2026-09-22 full-stack release
sync (see `docs/FULL_STACK_AWS_RELEASE_SYNC_REPORT.md`).

## Auth Service

| Component | Auth HTTP | Auth Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-auth` | `fitness-assistant-dev-auth-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `backend/services/auth-service/artifacts/auth-lambda.zip` (26.63 MB) | `backend/services/auth-service/artifacts/auth-migrate-lambda.zip` (15.46 MB) |
| Handler | `dist/lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 512 MB / 30s (REST) | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/auth-database` *(name not independently confirmed in any existing AWS config doc — see release report §22)* | same |
| Logical DB | `fitness_assistant` | same |
| VPC | Yes — private app subnets, `fitness-assistant-dev-lambda-sg` | same |
| IAM | Secrets Manager GetSecretValue (own secret only), CloudWatch Logs | same, plus `CREATE DATABASE` capability via maintenance connection |
| Key env vars | `DATABASE_SECRET_ID`, `JWT_SECRET`/`JWT_REFRESH_SECRET` (Secrets Manager), `AWS_REGION` | `DATABASE_SECRET_ID`, `AWS_REGION` |
| API route | via `fitness-assistant-dev-api` (existing HTTP API integration) | manual invoke only |
| Deployment required | **YES** — artifact was missing entirely before this pass | **YES** — rebuilt, current source |

## User Service

| Component | User HTTP | User Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-user` | `fitness-assistant-dev-user-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `backend/services/user-service/artifacts/user-lambda.zip` (110.79 MB) | `backend/services/user-service/artifacts/user-migrate-lambda.zip` (15.50 MB) |
| Handler | `dist/lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 1024 MB / 30s (uploads/PT-application processing) | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/user-database` (confirmed in existing AWS config docs) | same |
| Logical DB | `fitness_assistant_user` | same |
| VPC | Yes | same |
| IAM | Secrets Manager (own secret), CloudWatch Logs, `lambda:InvokeFunction` on `fitness-assistant-dev-auth` | same + DB create |
| Key env vars | `DATABASE_SECRET_ID`, `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth` | `DATABASE_SECRET_ID` |
| API route | via `fitness-assistant-dev-api` | manual invoke only |
| Deployment required | **YES** — rebuilt (`agentic-fitness.service.ts` changed since last artifact) | **YES** — rebuilt for consistency, no schema change found |

## Fitness Service

| Component | Fitness HTTP | Fitness Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-fitness` | `fitness-assistant-dev-fitness-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `backend/services/fitness-service/artifacts/fitness-lambda.zip` (76.31 MB) | `backend/services/fitness-service/artifacts/fitness-migrate-lambda.zip` (70.84 MB) |
| Handler | `dist/lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 1024 MB / 30s (catalog queries, roadmap logic) | 256 MB / 90s (53 migrations) |
| DB secret | `fitness-assistant/dev/fitness-database` | same |
| Logical DB | `fitness_assistant_fitness` | same |
| VPC | Yes | same |
| IAM | Secrets Manager (own secret), CloudWatch Logs, `lambda:InvokeFunction` on Auth/User | same + DB create |
| Key env vars | `DATABASE_SECRET_ID`, `AUTH_LAMBDA_NAME`, `USER_LAMBDA_NAME` | `DATABASE_SECRET_ID` |
| API route | via `fitness-assistant-dev-api` | manual invoke only |
| Deployment required | **YES** — rebuilt (roadmap/agentic-fitness source is current) | **YES — CRITICAL**: local DB was found 2 migrations behind repo history (`20260907030000_agentic_fitness`, `20260909090000_fitness_roadmap_phase`) with 3 missing partial-unique business-invariant indexes (`fitness_roadmaps_one_active_per_user`, `roadmap_phases_one_active_per_roadmap`, `training_cycles_one_active_per_phase`) — fixed locally this pass (see release report §5/§12); **AWS Aurora's `fitness_assistant_fitness` schema must be confirmed to actually have these 3 indexes before go-live**, via this migration Lambda or a manual check |

## Gym Service

| Component | Gym HTTP | Gym Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-gym` | `fitness-assistant-dev-gym-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `backend/services/gym-service/artifacts/gym-lambda.zip` (36.43 MB) | `backend/services/gym-service/artifacts/gym-migrate-lambda.zip` (69.34 MB) |
| Handler | `dist/lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 512 MB / 30s | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/gym-database` | same |
| Logical DB | `fitness_assistant_gym` | same |
| VPC | Yes | same |
| IAM | Secrets Manager (own secret), CloudWatch Logs, `lambda:InvokeFunction` on Auth/User/Payment, **new**: `s3:PutObject`/`s3:GetObject` scoped to the partner-document/brand-logo private bucket (new S3-backed upload feature — `partner-s3.service.ts`) | same + DB create |
| Key env vars | `DATABASE_SECRET_ID`, `AUTH_LAMBDA_NAME`, `USER_LAMBDA_NAME`, `PAYMENT_LAMBDA_NAME`, **new**: S3 bucket name for partner documents/logos (name not audited — check `partner-s3.service.ts` for the exact env var it reads before deployment) | `DATABASE_SECRET_ID` |
| API route | via `fitness-assistant-dev-api` | manual invoke only |
| Deployment required | **YES — CRITICAL**: artifact predates the entire partner self-service application feature (5 new migrations, `@aws-sdk/client-s3` dependency, `partner-s3.service.ts`) merged 2026-09-20/21; the previous artifact (built 2026-09-08) is missing this feature entirely | **YES** — 5 new migrations (`20260919000000_partner_self_service_application` through `20260921010000_brand_social_links`) must run before the new HTTP artifact is used |

## Payment Service

| Component | Payment HTTP | Payment Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-payment` | `fitness-assistant-dev-payment-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `backend/services/payment-service/artifacts/payment-lambda.zip` (existing, 2026-09-08) | `backend/services/payment-service/artifacts/payment-migrate-lambda.zip` (existing, 2026-09-08) |
| Handler | `dist/lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 512 MB / 30s | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/payment-database` | same |
| Logical DB | `fitness_assistant_payment` | same |
| VPC | Yes | same |
| IAM | Secrets Manager (own secret), CloudWatch Logs, `lambda:InvokeFunction` on Auth/User/AI (`fitness-assistant-dev-ai`) | same + DB create |
| Key env vars | `DATABASE_SECRET_ID`, `AUTH_LAMBDA_NAME`, `USER_LAMBDA_NAME`, `AI_LAMBDA_NAME=fitness-assistant-dev-ai`, provider webhook secrets (VNPay/MoMo/PayOS/ZaloPay — never printed) | `DATABASE_SECRET_ID` |
| API route | via `fitness-assistant-dev-api` | manual invoke only |
| Deployment required | **NO** — verified no source or migration change since the existing artifact was built (`git status` clean for this service, `prisma migrate status` confirms local DB already matches this exact migration set) |

## AI Service

| Component | AI HTTP | AI Worker | AI Jobs | AI Migration |
|---|---|---|---|---|
| AWS resource name | `fitness-assistant-dev-ai` | `fitness-assistant-dev-ai-worker` | `fitness-assistant-dev-ai-jobs` | `fitness-assistant-dev-ai-migrate` |
| Runtime | Lambda, Node.js 22.x, x86_64 | Lambda (SQS-triggered), Node.js 22.x, x86_64 | Lambda (SQS-triggered), Node.js 22.x, x86_64 | Lambda, Node.js 22.x, x86_64 |
| Artifact | `ai-lambda.zip` (37,213,320 bytes) | `ai-worker-lambda.zip` (byte-identical to ai-lambda.zip by design) | ships inside `ai-worker-lambda.zip` | `ai-migrate-lambda.zip` (22,331,289 bytes) |
| Handler | `dist/lambda.handler` | `dist/worker-lambda.handler` | `dist/jobs-lambda.handler` | `dist/migrate-lambda.handler` |
| Memory / Timeout | 1024 MB / 60s (Bedrock calls) | 1024 MB / 120s | 512 MB / 60s | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/ai-database` | same | same | same |
| Logical DB | `fitness_assistant_ai` | same | same | same |
| VPC | Yes | Yes | Yes | Yes |
| IAM | Secrets Manager, CloudWatch, `lambda:InvokeFunction` on Auth/User, **Bedrock InvokeModel** (`apac.amazon.nova-pro-v1:0`, `cohere.embed-multilingual-v3`), **OpenSearch Serverless** data-plane access (`aoss:APIAccessAll` scoped to the collection) | same | same | same + DB create |
| Key env vars | `DATABASE_SECRET_ID`, `AUTH_LAMBDA_NAME`, `USER_LAMBDA_NAME`, `LLM_PROVIDER=bedrock`, `BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0`, `EMBEDDING_PROVIDER=bedrock`, `BEDROCK_EMBEDDING_MODEL=cohere.embed-multilingual-v3`, `VECTOR_STORE_PROVIDER=opensearch`, OpenSearch collection endpoint | same | same | `DATABASE_SECRET_ID` |
| API route | via `fitness-assistant-dev-api` | SQS trigger, no HTTP route | SQS trigger / EventBridge Scheduler, no HTTP route | manual invoke only |
| Deployment required | **YES** — rebuilt this pass (extensive source changes: Conversational Intelligence v2, nutrition-plan-repair, roadmap multi-slot extraction — all now in current source and passing 71/71 new tests + the unchanged 30/30 evaluator baseline) | **YES** — same artifact | **YES** — same artifact | **YES** — rebuilt for consistency, no schema change found (`prisma migrate status`: up to date) |

## Chat Service

| Component | Chat Runtime | Chat Migration |
|---|---|---|
| AWS resource name | `fitness-assistant-dev-chat` | `fitness-assistant-dev-chat-migrate` |
| Runtime | **ECS Fargate** (not Lambda — real Socket.IO server, see `docs/CHAT_SERVICE_AWS_READINESS_REPORT.md` §11-12) + ALB | Lambda, Node.js 22.x, x86_64 |
| Artifact | Docker image `gymini-chat-service:aws-local` (linux/amd64, not pushed to ECR) | `backend/services/chat-service/artifacts/chat-migrate-lambda.zip` (69.29 MB) |
| Handler / start command | `CMD ["sh","-c","exec node dist/server.js"]` | `dist/migrate-lambda.handler` |
| Memory / CPU / Timeout | 1 GB / 0.5 vCPU (ECS task, `desiredCount: 1`) — n/a timeout (long-lived) | 256 MB / 60s |
| DB secret | `fitness-assistant/dev/chat-database` | same |
| Logical DB | `fitness_assistant_chat` | same |
| VPC | Private app subnets, `fitness-assistant-dev-chat-sg`; ALB in public subnets | same subnets as migration Lambdas |
| IAM | Task Role: `lambda:InvokeFunction` on Auth/User only, scoped ARNs. Task Execution Role: ECR pull + CloudWatch + (optionally) Secrets Manager | Secrets Manager (own secret), CloudWatch, DB create |
| Key env vars | `CHAT_DATABASE_URL` (note: not `DATABASE_URL`), `CHAT_SERVICE_PORT=3005`, `CORS_ORIGIN`, `ENABLE_REST_CORS=true` (new this pass), `AUTH_LAMBDA_NAME`, `USER_LAMBDA_NAME`, `INTERNAL_API_SECRET` | `DATABASE_SECRET_ID` |
| API route | Own ALB (`fitness-assistant-dev-chat-alb`), **not** routed through `fitness-assistant-dev-api` | manual invoke only |
| Deployment required | **YES — not yet deployed at all.** Full Console runbook: `docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md` | **YES** — artifact ready, function not yet created |

## Frontend

| Component | Frontend S3 |
|---|---|
| AWS resource | `fitness-assistant-frontend-dev-191798898985` (S3 static website) |
| Artifact | `frontend/web/dist/` (built this pass, clean) |
| Build command | `pnpm --filter web build` |
| Required env (build-time) | `VITE_API_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`, `VITE_CHAT_WS_URL=<chat ALB DNS, once created>` (not yet set — Chat isn't deployed) |
| Deployment required | **YES** for `VITE_CHAT_WS_URL` once Chat's ALB exists; otherwise the existing S3 content is current for every other route (rebuild confirmed clean, no secret leak, no stale `localhost` reference in the bundle) |

## Cross-cutting notes

- **No `.env` file exists for `gym-service`/`payment-service`** for host-run Prisma CLI (they rely entirely on docker-compose's injected `DATABASE_URL`) — not a defect, just means `prisma validate`/`migrate status` must be run with `DATABASE_URL` supplied manually when working outside Docker.
- **`auth-service/.env`'s own `DATABASE_URL` names the wrong database** (`gym_coach_auth` instead of the real `gymcoach_auth`) — does not affect the running container (compose injects the correct value directly) but would fail if used for a host-run Prisma command; pre-existing, not fixed this pass (out of scope — a `.env` typo, not a source defect).
- Every Lambda artifact uses the `rhel-openssl-3.0.x` Prisma engine target, confirmed present in each rebuilt zip.
- No deployment artifact contains `.env`, `.git`, credentials, or this repo's own compiled tests (only harmless third-party `node_modules/**/__tests__` content, confirmed in `ai-lambda.zip`).
