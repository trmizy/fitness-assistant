# AWS DEV AI Fix Plan — 2026-09-30

This file is a fix plan only. No fixes were applied in this audit.

## Severity list

### P1 — BUG-A1 admin overview/queue timeout

Affected:

- `GET /admin/ai/overview`
- `GET /admin/ai/queue`

Root cause:

- `src/controllers/admin.controller.ts` calls BullMQ `aiQueue.get*Count()` APIs.
- `src/workers/ai.queue.ts` defaults Redis to `localhost:6379`.
- AWS Lambda deployment uses SQS (`QUEUE_PROVIDER=sqs`) and has no Redis env.
- BullMQ Redis promise does not fail fast enough; Lambda times out at 30s.

Fix:

1. Introduce queue stats abstraction:
   - if `QUEUE_PROVIDER=sqs`, use AWS SQS `GetQueueAttributes` for approximate visible/not-visible/delayed counts;
   - if BullMQ, use existing BullMQ counts;
   - enforce a short timeout, e.g. 1–2s, returning `null` if queue stats unavailable.
2. Remove direct `aiQueue` use from HTTP admin controller.
3. Ensure no Redis import/connection is created on HTTP Lambda when `QUEUE_PROVIDER=sqs`.

Redeploy:

- AI HTTP Lambda.

AWS infra change:

- Likely none if AI HTTP role already has `sqs:GetQueueAttributes`; currently AI HTTP role only has `sqs:SendMessage`, so either add scoped `sqs:GetQueueAttributes` or choose to omit live SQS queue stats from HTTP admin.

### P1 — Worker Lambda imports a module that starts BullMQ worker

Affected:

- `src/worker-lambda.ts`
- `src/workers/ai.worker.ts`

Root cause:

- `worker-lambda.ts` imports `processAiTaskJob` from `ai.worker.ts`.
- `ai.worker.ts` has top-level `new Worker("ai-tasks", ...)`.
- Importing the processor also starts a Redis BullMQ worker in Lambda.

Fix:

1. Move pure `processAiTaskJob` and supporting processor-only code into a side-effect-free module.
2. Create a separate container runtime file that starts `new Worker`.
3. Update `server.ts`/container worker to import the runtime file.
4. Keep `worker-lambda.ts` importing only pure processor code.

Redeploy:

- AI worker Lambda.
- Any container/local worker artifact if applicable.

AWS infra change:

- None.

### P1 — Browser CORS/preflight causes AI plan page `Network Error`

Affected:

- `GET /plans/current`
- `GET /plans/nutrition/current`
- likely other `/ai`/`/plans` endpoints from browser.

Root cause:

- API Gateway CORS allows only S3 website origin.
- `OPTIONS /plans/current` and `OPTIONS /ai/ask` are forwarded to Lambda and rejected by `requireAuth` with 401 and no CORS headers.
- CloudFront/custom deployed frontend origin is not in CORS allowlist.

Fix:

1. Add actual frontend origin(s), including CloudFront/custom domain, to API Gateway CORS allow origins.
2. Ensure preflight OPTIONS is handled at API Gateway or by unauthenticated CORS middleware before `requireAuth`.
3. Avoid `ANY` swallowing OPTIONS for protected routes unless preflight is explicitly exempted.

Redeploy:

- If fixed in API Gateway only: no Lambda redeploy.
- If fixed in Express middleware: redeploy all affected HTTP Lambdas or shared gateway.

AWS infra change:

- Yes, API Gateway CORS/routes if fixed there.

### P1/P2 — Lambda AI rate limit is not distributed

Affected:

- `/ai/ask`
- `/ai/ask/stream`
- `/ai/generate-workout`
- `/ai/agent/goal-image`
- `/ai/agent/image-chat`

Root cause:

- Source supports DynamoDB limiter, but AWS env does not set `RATE_LIMIT_PROVIDER=dynamodb`.
- AI HTTP role does not have DynamoDB rate-limit permissions.
- In-memory limiter is per warm Lambda environment.

Fix:

1. Create/confirm DynamoDB rate-limit table with TTL.
2. Set `RATE_LIMIT_PROVIDER=dynamodb`.
3. Set `AI_RATE_LIMIT_TABLE`.
4. Add scoped `dynamodb:UpdateItem` permission.
5. Keep fail-closed behavior.

Redeploy:

- AI HTTP Lambda env update.

AWS infra change:

- DynamoDB table and IAM/env update.

### P2 — Worker not live-verified

Affected:

- `fitness-assistant-dev-ai-worker`.

Finding:

- SQS mapping enabled and queue configured.
- `LastProcessingResult=null`, no log group, no backlog.
- No proof of successful worker cold-start or message handling.

Fix/test plan:

1. First fix the BullMQ side-effect import.
2. In isolated test/dev mode, send a non-paid mocked job or use a test queue/function.
3. Verify CloudWatch log group creation, status transition, batch failure behavior, DLQ behavior.

Redeploy:

- AI worker Lambda.

AWS infra change:

- Optional test-only queue/function if owner approves later. Not done in audit.

### P2 — Admin knowledge endpoints may retain BullMQ/Redis assumptions

Affected:

- `GET /admin/ai/knowledge`
- `POST /admin/ai/knowledge/jobs/:kind`
- `POST/DELETE /admin/ai/knowledge/schedule`

Root cause:

- `admin.controller.ts` uses `getKnowledgePipelineQueue()`, `enqueue*Refresh`, `scheduleKnowledgeRefreshes`.
- AWS jobs-lambda bypasses BullMQ for scheduled path, but admin HTTP endpoints still expose BullMQ controls.

Fix:

- Either make these endpoints AWS-aware and call jobs-lambda/direct run paths, or mark them unavailable in SQS/EventBridge mode with clear response.

Redeploy:

- AI HTTP Lambda.

AWS infra change:

- None unless switching to direct Lambda invoke.

## Recommended fix order

1. Fix CORS/preflight for `/plans` and `/ai` so frontend can load AI plans.
2. Fix `admin.controller` queue stats to be SQS-aware or disable live queue stats in SQS mode.
3. Refactor `ai.worker.ts` to remove top-level BullMQ side effect from Lambda import.
4. Redeploy AI HTTP + AI worker artifacts.
5. Enable distributed rate limiting or API Gateway/WAF throttling before real Bedrock traffic.
6. Run an isolated worker test with mocked/non-paid provider.
7. Re-test `/admin/ai/overview`, `/admin/ai/queue`, `/plans/current`, worker CloudWatch logs.

## Components requiring redeploy

- AI HTTP Lambda: for admin queue fix, CORS-in-code fix if chosen, rate-limit env if code table already present.
- AI Worker Lambda: for side-effect-free processor import.
- API Gateway: for CORS/preflight fix if done at infra layer.

## Components requiring AWS infra change

- API Gateway CORS/routes for preflight/origin.
- Optional `sqs:GetQueueAttributes` permission for AI HTTP Lambda if admin queue stats should read SQS.
- DynamoDB table + IAM + env for distributed rate limit.

## Final readiness

AI SERVICE: `READY_WITH_FIXES`

AI WORKER: `NOT_LIVE_VERIFIED`

AI JOBS: `READY_WITH_FIXES`

PAID PROVIDER LIVE TEST: `INTENTIONALLY_NOT_RUN`
