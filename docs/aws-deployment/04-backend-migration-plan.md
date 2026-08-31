# 04 — Backend migration plan

## First service candidate

`auth-service` is the best first backend migration candidate after Phase 2:

- Express app already separated from `server.ts`.
- Has health/metrics endpoints.
- Has Prisma schema and migrations.
- Does not depend on Redis, BullMQ, Qdrant, Ollama, or Socket.IO.

## Required work before migrating auth

1. Add Lambda adapter without breaking local `server.ts`.
2. Store JWT/internal secrets in Secrets Manager or SSM Parameter Store.
3. Decide Aurora topology and schema/database separation.
4. Add VPC only for DB-attached Lambda.
5. Add integration test against the Lambda adapter.
6. Keep Docker Compose local unchanged.

## Not first

- `ai-service`: depends on Qdrant, Redis/BullMQ, LLM provider, and workers.
- `fitness-service`: Redis/cache/queue + many DB tests and background concerns.
- `chat-service`: Socket.IO should be a separate realtime phase.
- `user-service`: upload/filesystem adapter must be designed first.
- `payment-service`: raw webhook body/HMAC handling needs careful Lambda/API Gateway mapping.
- `gym-service`: viable later, but current tests needed DB skip hardening.

## Database

Do not create Aurora yet. A database migration plan must first audit Prisma schemas, migrations, seeds, raw SQL, pooling, and cross-service data boundaries.
