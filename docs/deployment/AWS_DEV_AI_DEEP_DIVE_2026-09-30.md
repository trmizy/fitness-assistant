# AWS DEV AI Deep-Dive Root-Cause Audit — 2026-09-30

Scope: `backend/services/ai-service` and AWS dev AI resources only.  
Mode: read-only audit. No code fix, no deploy, no real LLM/provider call, no SQS send, no DB mutation.

## Executive result

`BUG-A1` is `ROOT_CAUSE_CONFIRMED`.

`GET /admin/ai/overview` and `GET /admin/ai/queue` time out because both handlers still call BullMQ Redis live-count APIs through `aiQueue`, while the AWS Lambda deployment uses SQS (`QUEUE_PROVIDER=sqs`) and the AI HTTP Lambda has no `REDIS_HOST`/`REDIS_PORT` configured.

The dependency that is unique to the failing handlers is BullMQ/Redis:

- `/admin/ai/errors` reads only Prisma data and passes.
- `/admin/ai/overview` reads Prisma data plus `aiQueue.getWaitingCount/getActiveCount/getCompletedCount/getFailedCount/getDelayedCount`.
- `/admin/ai/queue` reads Prisma plans plus the same BullMQ queue counts.

In AWS, those BullMQ calls are not SQS calls. They resolve `redisConnection` from `src/workers/ai.queue.ts`, defaulting to `localhost:6379` when Redis env is absent. In Lambda this is the Lambda execution environment itself, not Redis. The calls are individually wrapped with `.catch(() => null)`, but the catch only runs after the Redis command fails; with BullMQ/ioredis retry behavior, the promise can remain pending until Lambda’s 30s timeout.

## Evidence

### Source call graph

Route:

```text
src/app.ts
  app.use("/admin/ai", adminAiRoutes)
```

Admin router:

```text
src/routes/admin.routes.ts
  router.use(requireAuth)
  router.use(requireRole(["ADMIN"]))
  GET /overview -> adminController.getOverview
  GET /queue    -> adminController.getQueue
  GET /errors   -> adminController.getErrors
```

Failing handlers:

```text
src/controllers/admin.controller.ts
  getOverview()
    Promise.all([
      conversationRepository.adminGetOverviewStats(),
      aiQueue.getWaitingCount().catch(() => null),
      aiQueue.getActiveCount().catch(() => null),
      aiQueue.getCompletedCount().catch(() => null),
      aiQueue.getFailedCount().catch(() => null),
      aiQueue.getDelayedCount().catch(() => null),
    ])

  getQueue()
    Promise.all([
      conversationRepository.adminListPlans(30),
      aiQueue.getWaitingCount().catch(() => null),
      aiQueue.getActiveCount().catch(() => null),
      aiQueue.getCompletedCount().catch(() => null),
      aiQueue.getFailedCount().catch(() => null),
      aiQueue.getDelayedCount().catch(() => null),
    ])
```

Passing comparison:

```text
src/controllers/admin.controller.ts
  getErrors()
    conversationRepository.adminGetErrors()
```

Queue implementation:

```text
src/workers/ai.queue.ts
  redisConnection = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10)
  }

  getAiQueue()
    new Queue("ai-tasks", { connection: redisConnection })
```

AWS Lambda env observed read-only:

```text
fitness-assistant-dev-ai:
  QUEUE_PROVIDER=sqs
  AI_TASKS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/.../fitness-assistant-dev-ai-tasks
  REDIS_HOST not set
  REDIS_PORT not set
  Timeout=30
```

### Handler comparison

| Handler | DB access | BullMQ/Redis access | SQS access | External/service call | Expected latency | Observed failure candidate |
|---|---:|---:|---:|---:|---:|---|
| `getOverview` | Yes: conversation counts, raw avg/p95, groupBy plan status | Yes: 5 queue count calls | No | No | DB + Redis | BullMQ Redis calls hang |
| `getQueue` | Yes: recent 30 workout plans | Yes: 5 queue count calls | No | No | DB + Redis | BullMQ Redis calls hang |
| `getErrors` | Yes: failed plans + warning conversations | No | No | No | DB only | Passes; isolates DB as non-root-cause |

### Database query audit

`adminGetOverviewStats()` executes bounded aggregate/count queries:

- `conversation.count()`
- `conversation.count({ createdAt >= 24h })`
- fallback/warning counts
- raw avg/p95 for last 7 days
- slow count for last 7 days
- raw grouped intent distribution with `LIMIT 10`
- raw grouped language distribution
- `workoutPlan.groupBy({ by: ["status"] })`

`adminListPlans(30)` is bounded by `take: 30`.

`adminGetErrors()` uses two bounded `findMany(... take: 20)` calls and passes live. Therefore DB access is not the shared failing dependency.

## AWS trigger and network audit

### AI worker

Read-only AWS state:

```text
Lambda: fitness-assistant-dev-ai-worker
Runtime: nodejs22.x
Handler: dist/worker-lambda.handler
Timeout: 300
State: Active
LastUpdateStatus: Successful
Event source mapping: Enabled
Queue: fitness-assistant-dev-ai-tasks
BatchSize: 1
FunctionResponseTypes: ReportBatchItemFailures
LastProcessingResult: null
Main queue backlog: 0 visible, 0 not visible, 0 delayed
DLQ configured: yes, maxReceiveCount=2
Worker log group: not found
```

Most likely status: the worker has not processed a message since deployment/log-group creation. Evidence is `LastProcessingResult=null`, zero backlog, and no `/aws/lambda/fitness-assistant-dev-ai-worker` log group. Logging IAM exists through `AWSLambdaBasicExecutionRole`, so missing log group is not explained by missing basic logging permission.

### AI jobs

Read-only AWS state:

```text
Lambda: fitness-assistant-dev-ai-jobs
Runtime: nodejs22.x
Handler: dist/jobs-lambda.handler
Timeout: 600
State: Active
```

EventBridge Scheduler is the real trigger mechanism:

| Schedule | Expression | Target | Payload |
|---|---|---|---|
| `fitness-assistant-dev-ai-autoaccept` | `rate(15 minutes)` | `fitness-assistant-dev-ai-jobs` | `{"job":"personalized-service-autoaccept-sweep"}` |
| `fitness-assistant-dev-ai-local-evidence` | `cron(0 2 * * ? *)` | `fitness-assistant-dev-ai-jobs` | `{"job":"local-evidence-refresh"}` |
| `fitness-assistant-dev-ai-pubmed` | `cron(30 2 * * ? *)` | `fitness-assistant-dev-ai-jobs` | `{"job":"pubmed-refresh"}` |
| `fitness-assistant-dev-ai-rss` | `cron(0 3 * * ? *)` | `fitness-assistant-dev-ai-jobs` | `{"job":"rss-refresh"}` |
| `fitness-assistant-dev-ai-web` | `cron(30 3 * * ? *)` | `fitness-assistant-dev-ai-jobs` | `{"job":"web-refresh"}` |

Conclusion: `TRIGGER_VERIFIED` for `ai-jobs`. The earlier report checked EventBridge Rules only; this deployment uses EventBridge Scheduler.

## VPC/SQS networking

AI Lambda and AI worker run in private app subnets:

```text
subnet-02b39d77762465ef8
subnet-09e3230f7bca04c8e
sg-0b38ab22927b284ab
vpc-010c13afd8920c8f1
```

VPC route table for those subnets has:

```text
0.0.0.0/0 -> nat-025b2c37935815d6d
```

VPC endpoints found:

- Secrets Manager endpoint.
- OpenSearch Serverless/private endpoint.
- No SQS VPC endpoint found.

This means SQS access would go through NAT. However `/admin/ai/queue` does not use AWS SQS at all; it uses BullMQ Redis. SQS public endpoint networking is not the root cause of BUG-A1.

## Frontend CORS/network error finding

Separate from BUG-A1, the screenshot error “Không thể tải danh sách kế hoạch: Network Error” is consistent with CORS/preflight failure.

Observed safe HTTP:

```text
GET /plans/current -> 401 JSON response
OPTIONS /plans/current -> 401, no access-control-allow-origin
OPTIONS /ai/ask -> 401, no access-control-allow-origin
```

API Gateway CORS config allows only:

```text
http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com
```

If the browser is served from CloudFront or another origin, it is not in the allowlist. Also, because `ANY /plans/{proxy+}` forwards `OPTIONS` to Lambda, `requireAuth` rejects preflight. This is a separate P1 frontend/API contract issue.

## Cost/retry safety

Source has a DynamoDB distributed rate limiter, but AWS env does not enable it:

```text
RATE_LIMIT_PROVIDER not set
AI_RATE_LIMIT_TABLE not set
```

Therefore `resolveRateLimitProvider()` defaults to `memory`. In Lambda this is per execution environment, not account-wide/user-wide. This is better than no limiter in a single warm container but not a production-grade distributed limiter for Bedrock-cost control.

## Readiness verdict

AI Service: `READY_WITH_FIXES`

Primary blockers before calling it production-ready:

1. Fix admin queue-count dependency from BullMQ Redis to SQS-aware queue stats, or skip queue counts when `QUEUE_PROVIDER=sqs`.
2. Fix CORS/preflight/API Gateway origin handling for deployed frontend.
3. Enable distributed rate limit (`RATE_LIMIT_PROVIDER=dynamodb`) or equivalent API Gateway/WAF throttling before real Bedrock traffic.
4. Re-check worker after at least one controlled non-paid test message or local DB-backed worker test.
