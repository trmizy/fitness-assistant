# 01 — Pre-deployment audit

## 1. Git state

- Branch: `master`
- Remote: `https://github.com/trmizy/fitness-assistant.git`
- Commit: `8d1f3f2`
- Status before this task already had dirty/generated/untracked files. This session did not commit or push.

## 2. Current services

| Component | Runtime | Port local | DB | Redis | Queue | Socket | Upload | AWS target |
|---|---:|---:|---|---|---|---|---|---|
| frontend/web | Vite React static | 5173 | No | No | No | Socket.IO client | Browser upload clients | S3 + CloudFront |
| api-gateway | Express/Node | 3000 | No direct Prisma | No direct | No | Own Socket.IO + chat proxy | Proxies `/uploads` | API Gateway/Lambda later, realtime separate |
| auth-service | Express/Node + Prisma | 3001 | `gymcoach_auth` | No | No | No | No | Lambda candidate, DB-attached |
| user-service | Express/Node + Prisma | 3004 | `gymcoach_user` | No | No | No | filesystem `uploads/*` | Lambda candidate with S3 upload adapter |
| fitness-service | Express/Node + Prisma | 3002 | `gymcoach_fitness` | Yes | BullMQ workout queue | No | Import/export files | Lambda candidate only after Redis/queue split |
| ai-service | Express/Node + Prisma | 3003 | `gymcoach_ai` | Yes | BullMQ AI/knowledge queues | No | Dataset/report files | AI facade Lambda first; workers separate |
| knowledge-worker | Node worker | n/a | `gymcoach_ai` | Yes | BullMQ worker | No | Dataset files | SQS/Lambda worker or Fargate later |
| chat-service | Express/Node + Prisma | 3005 | `gymcoach_chat` | No | No | Socket.IO | No | REST later; realtime separate |
| gym-service | Express/Node + Prisma | 3006 | `gymcoach_gym` | No | No | No | No | Lambda candidate, DB-attached |
| payment-service | Express/Node + Prisma | 3007 | `gymcoach_payment` | No | No | No | Raw webhook body | Lambda candidate with webhook adapter care |

## 3. Runtime dependencies

- Node workspace uses `pnpm@8.15.0`, Node engine `>=20`.
- Local Docker Compose includes PostgreSQL, Redis, Qdrant, Ollama, n8n, Prometheus, Grafana.
- Production Dockerfiles exist for gateway and all backend services.

## 4. Database topology

Each backend service has its own Prisma schema/database locally:

- `gymcoach_auth`
- `gymcoach_user`
- `gymcoach_fitness`
- `gymcoach_ai`
- `gymcoach_chat`
- `gymcoach_gym`
- `gymcoach_payment`

AWS Phase 3 should not create one Aurora cluster per service. Target should be one Aurora PostgreSQL cluster with logical separation after a dedicated DB migration plan.

## 5. Redis/BullMQ dependencies

- `fitness-service`: Redis cache + BullMQ workout-generation queue.
- `ai-service`: BullMQ AI tasks and knowledge pipeline.
- These are not suitable for a naive all-in-one Lambda migration.

## 6. Socket.IO/realtime dependencies

- Gateway owns a Socket.IO server.
- Chat service owns a separate Socket.IO server proxied via `/chat-socket.io`.
- Realtime should be a separate phase: API Gateway WebSocket + Lambda or Fargate Socket.IO, not both.

## 7. AI/RAG dependencies

- Qdrant vector store.
- Ollama/local LLM provider in dev; provider abstraction exists.
- BullMQ workers for long-running AI/knowledge jobs.
- Serverless target should start with a thin AI HTTP facade Lambda; async jobs need SQS/EventBridge only when use cases are proven.

## 8. Upload/filesystem dependencies

`user-service` still writes to local filesystem:

- `uploads/profile-photos`
- `uploads/pt-applications`
- `uploads/contracts`
- InBody image upload uses multer.

AWS target should use S3 presigned URL or a storage adapter. Do not proxy large binary files through Lambda long-term.

## 9. Existing Docker readiness

Dockerfiles exist for all primary backend services and frontend. `docker:test:fast` currently has an oversized context and root test DB-env blockers.

## 10. CI state

`.github/workflows/docker-test.yml` previously targeted `main`; fixed to `master`.

## 11. Existing infra state

Remote state exists in S3:

```text
s3://fitness-assistant-tfstate-191798898985/environments/dev/terraform.tfstate
```

Existing AWS resources include ECR repos, S3 buckets, API Gateway HTTP API, Lambda `/hello`, IAM OIDC role/provider, and budget.

## 12. Secret risks

- `.env` is not tracked by Git.
- Tracked env files are examples only.
- Frontend uses public `VITE_*` variables; no provider/payment/JWT secrets should be exposed in frontend builds.
- Default dev secrets still exist in local compose/code for local dev only and must not be used in AWS backend deployment.

## 13. AWS compatibility blockers

- Backend services need Express-to-Lambda adapters before Phase 3.
- DB services require Aurora/VPC/RDS connection design.
- User uploads need S3 adapter.
- AI workers/Qdrant/Ollama are not Lambda-ready as-is.
- CloudFront creation is blocked by AWS account verification.

## 14. Recommended migration mapping

1. Phase 1: API Gateway HTTP API + Lambda `/hello`.
2. Phase 2: S3 private frontend + CloudFront OAC.
3. Phase 3: start with `auth-service` or another minimal DB service after app/server split.
4. Phase 4: async AI and realtime after REST services are stable.

## 15. GO / NO-GO for AWS Phase 1

GO. Phase 1 is isolated, low-cost, and does not depend on DB/Redis/Qdrant/Ollama.
