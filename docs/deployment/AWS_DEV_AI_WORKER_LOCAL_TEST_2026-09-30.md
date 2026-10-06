# AWS DEV AI Worker Local Test — 2026-09-30

Scope: `backend/services/ai-service/src/worker-lambda.ts` and worker processor path.  
Mode: local mocked/offline only. No AWS SQS message sent. No AWS Lambda invoked. No DB mutation.

## Worker source flow

Actual SQS worker entrypoint:

```text
dist/worker-lambda.handler
src/worker-lambda.ts
```

Flow:

```text
SQS event
  -> handler(event)
  -> ensureDatabaseUrlConfigured()
  -> dynamic import("./workers/ai.worker")
  -> for each record:
       JSON.parse(record.body)
       build job shim:
         id = record.messageId
         name = message.name
         data = message.data
         attemptsMade = ApproximateReceiveCount - 1
       if name === "generate-nutrition-plan":
         import nutrition.processor
         processNutritionPlanJob(job)
       else:
         processAiTaskJob(job)
       on error:
         batchItemFailures.push({ itemIdentifier: record.messageId })
  -> return { batchItemFailures }
```

Supported task names by intended code path:

- `generate-plan`
- `generate-nutrition-plan`

Important implementation detail:

`worker-lambda.ts` does not explicitly validate the discriminator. Any task name other than `generate-nutrition-plan` is routed to `processAiTaskJob()`. If payload shape also matches a workout plan job, an unsupported task name could be processed as a workout-plan job. This is a medium-severity validation gap.

## Critical local finding: module side effect

`worker-lambda.ts` dynamically imports `./workers/ai.worker` to get `processAiTaskJob`.

But `src/workers/ai.worker.ts` ends with:

```text
export const aiWorker = new Worker("ai-tasks", processAiTaskJob, {
  connection: redisConnection,
});
```

Therefore importing the module in Lambda also starts a BullMQ Redis worker at module scope. This is the opposite of the intended Lambda-native worker isolation and explains why a local offline harness did not naturally exit after returning `batchItemFailures`.

Impact:

- Lambda SQS worker may try to create an additional long-lived Redis consumer.
- In AWS env, `REDIS_HOST` is absent, so `redisConnection` defaults to `localhost:6379`.
- This may create unnecessary connection retries/open handles and can interfere with cold-start/runtime behavior.

Severity: HIGH for Lambda worker reliability.

Safe proposed fix:

- Split pure processor into a side-effect-free module, for example `workers/ai-task-processor.ts`.
- Keep `new Worker(...)` only in a container/runtime entrypoint such as `ai.worker.runtime.ts` or guard it behind `if (process.env.RUNTIME_MODE !== "lambda")`.
- `worker-lambda.ts` should import only pure processing functions and must not import a module that starts BullMQ.

Redeploy needed: yes, AI worker artifact and likely AI HTTP artifact if shared packaging includes the same files.

## Local test command results

Environment used:

```text
NODE_ENV=test
DATABASE_URL=postgresql://user:pass@127.0.0.1:1/fitness_assistant_ai
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=mock
VECTOR_STORE_PROVIDER=qdrant
INTERNAL_SERVICE_SECRET=test-internal-secret
```

The fake `DATABASE_URL` was used only to satisfy Prisma env validation. The tested invalid cases fail before any real DB write.

Command shape:

```text
pnpm --filter @gym-coach/ai-service exec tsx -e "<import handler; call handler with synthetic SQS Records>"
```

| Case | Input | Expected | Actual |
|---|---|---|---|
| malformed JSON body | record body `{bad` | `batchItemFailures` contains message id | PASS |
| unsupported task type with empty payload | `{name:"unknown", data:{}}` | failure, no success | PASS: failed via workout schema validation |
| missing `userId` | valid UUID planId but no userId | failure | PASS |
| invalid `planId` | `planId:"not-uuid"` | failure | PASS |

Output shape observed:

```json
{"batchItemFailures":[{"itemIdentifier":"malformed-json"}]}
{"batchItemFailures":[{"itemIdentifier":"unsupported-empty"}]}
{"batchItemFailures":[{"itemIdentifier":"missing-user"}]}
{"batchItemFailures":[{"itemIdentifier":"invalid-plan-id"}]}
```

## Local tests not run, by safety rule

These cases were not fully executed because they require an isolated test DB, service-to-service fixtures, or would reach provider logic:

- valid SQS message end-to-end persistence path;
- provider timeout / 429 / 500 through full worker;
- malformed provider JSON through full persistence path;
- duplicate delivery idempotency on real plan rows;
- permanent vs retryable failure against a real plan row.

They should be tested in a dedicated isolated test DB or a fully mocked repository/provider harness after refactoring the processor to be side-effect-free.

## AWS worker trigger readiness

Read-only AWS state:

```text
fitness-assistant-dev-ai-worker: Active
Event source mapping: Enabled
Queue: fitness-assistant-dev-ai-tasks
BatchSize: 1
ReportBatchItemFailures: enabled
VisibilityTimeout: 600
DLQ: fitness-assistant-dev-ai-tasks-dlq
maxReceiveCount: 2
Backlog: 0 visible / 0 not visible / 0 delayed
LastProcessingResult: null
Log group: not found
```

Interpretation:

- Infrastructure wiring is present.
- There is no live evidence that the worker has processed a message.
- Missing log group is best explained by “no message/cold-start yet” or deleted log group. IAM logging exists, so missing basic log permission is unlikely.

Worker verdict: `NOT_LIVE_VERIFIED`.

## Required follow-up test

After code side-effect fix and with an isolated AI test database:

1. Generate one plan job with provider mocked to deterministic JSON.
2. Assert plan status transitions `QUEUED -> PROCESSING -> COMPLETED`.
3. Repeat delivery of the same SQS message and verify idempotency or safe failure.
4. Inject provider timeout/429/500/malformed JSON and verify status `FAILED`, partial batch failure behavior, and DLQ after redrive.
