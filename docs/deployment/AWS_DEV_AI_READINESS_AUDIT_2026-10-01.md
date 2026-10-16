# AWS Dev AI Readiness Audit - 2026-10-01

Scope: independent read-only readiness audit for the Gymini dev AI path.

Guardrails followed:

- No Bedrock `Converse`, `InvokeModel`, or embedding runtime call was made by this audit.
- No SQS message was sent, received, deleted, or re-driven.
- No database cluster was started, stopped, migrated, or modified.
- No Lambda/API Gateway/IAM/OpenSearch/S3 resource was mutated.
- The only repository mutation is this audit document.
- Secrets were treated as redacted. Environment variable names are reported, secret values are not.

## Executive Summary

The deployed AI HTTP and worker infrastructure is mostly wired correctly, but the actual AI path is not usable right now.

Primary blocker: the AWS account is not authorized to run the deployed Bedrock models:

- `apac.amazon.nova-pro-v1:0` / `amazon.nova-pro-v1:0`: `authorizationStatus=NOT_AUTHORIZED`
- `cohere.embed-multilingual-v3`: `authorizationStatus=NOT_AUTHORIZED`

CloudTrail and CloudWatch confirm real worker attempts failed with `ValidationException: Operation not allowed` for both Nova chat and Cohere embeddings. No successful Bedrock runtime call was found in the audited 2026-09-30 to 2026-10-01 event window.

Secondary limitation: the Aurora cluster was stopped during this audit, so live DB-backed persistence and polling could not be safely verified without violating the no-mutation/no-start constraint.

Final E2E verdict: `AI_E2E=BLOCKED`.

## Readiness Matrix

| Area | Status | Evidence |
|---|---:|---|
| AI HTTP | READY | Lambda `fitness-assistant-dev-ai` exists, active, handler `dist/lambda.handler`; API Gateway routes `/ai`, `/plans`, `/admin/ai`, `/marketplace` to it; CORS preflight succeeds. |
| AUTH | READY | `/health` returns auth service OK; unauthenticated `/plans/llm-health` returns 401 instead of invoking AI. Historical polling logs show auth rate-limit errors, but current auth gate behavior is correct. |
| SQS | READY | Main queue exists with zero visible/in-flight/delayed messages; event source mapping to worker is enabled; DLQ exists. |
| WORKER | READY | Worker Lambda `fitness-assistant-dev-ai-worker` exists, active, handler `dist/worker-lambda.handler`; SQS mapping enabled with batch size 1 and partial failure reporting. |
| NOVA | BLOCKED | Bedrock availability says Nova authorization `NOT_AUTHORIZED`; worker `Converse` calls failed with `ValidationException: Operation not allowed`. |
| COHERE | BLOCKED | Bedrock availability says Cohere embedding authorization `NOT_AUTHORIZED`; worker `InvokeModel` calls failed with `ValidationException: Operation not allowed`. |
| RAG | BLOCKED | OpenSearch Serverless is active, but deployed embedding provider is Bedrock Cohere and Cohere runtime is blocked. Chat may degrade to empty retrieval, but RAG itself is not usable. |
| PERSISTENCE | NOT_TESTABLE_DB_STOPPED | Aurora cluster `fitness-assistant-dev-aurora` was `stopped`; no DB write/read verification was performed. |
| POLLING | BLOCKED | Source polling path is SQS-aware and DB-backed, but live verification requires a DB-backed job. Aurora was stopped and provider calls are blocked. |
| FRONTEND | READY | Deployed S3 bundle points `VITE_API_URL` to the current API Gateway; source UI has auth refresh, AI plan polling, and friendly AI error handling. |

`CAN_USER_USE_AI_RIGHT_NOW=NO`

`AI_E2E=BLOCKED`

## Current AI Architecture

### HTTP Lambda

Deployed function:

- Name: `fitness-assistant-dev-ai`
- Runtime: `nodejs22.x`
- Handler: `dist/lambda.handler`
- Timeout: 30 seconds
- Memory: 1024 MB
- State: `Active`
- Last update status: `Successful`
- Last modified: `2026-09-30T07:43:50Z`

Source path: `backend/services/ai-service/src/lambda.ts`

The HTTP Lambda lazily imports the Express app after database config and performs vector store health initialization. It does not start the background worker.

### Worker Lambda

Deployed function:

- Name: `fitness-assistant-dev-ai-worker`
- Runtime: `nodejs22.x`
- Handler: `dist/worker-lambda.handler`
- Timeout: 300 seconds
- Memory: 1024 MB
- State: `Active`
- Last update status: `Successful`
- Last modified: `2026-09-30T06:03:49Z`

Source path: `backend/services/ai-service/src/worker-lambda.ts`

The worker parses SQS records as `{ name, data }`, supports `generate-plan` and `generate-nutrition-plan`, and reports per-record batch failures.

## Source vs Deployment

Deployment environment for both AI HTTP and worker:

- `LLM_PROVIDER=bedrock`
- `BEDROCK_REGION=ap-southeast-1`
- `BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0`
- `BEDROCK_VISION_MODEL=apac.amazon.nova-pro-v1:0`
- `EMBEDDING_PROVIDER=bedrock`
- `BEDROCK_EMBEDDING_MODEL=cohere.embed-multilingual-v3`
- `VECTOR_STORE_PROVIDER=opensearch`
- `KNOWLEDGE_VECTOR_SIZE=1024`
- `QUEUE_PROVIDER=sqs`
- `AI_TASKS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/191798898985/fitness-assistant-dev-ai-tasks`
- Internal service secret is present but redacted here.

Source defaults differ from deployment in expected ways:

- Source default LLM provider is Ollama unless overridden.
- Source default Bedrock chat model is base `amazon.nova-pro-v1:0`, while deployment explicitly uses the APAC inference profile `apac.amazon.nova-pro-v1:0`.
- Source default embedding provider resolves to Ollama unless overridden; deployment explicitly uses Bedrock Cohere with 1024-dimension vectors.

Verdict: `SOURCE_DEPLOY_PARITY=PASS_WITH_ENV_OVERRIDES`.

## API Routes

API Gateway:

- API ID: `id1iz7upbl`
- Endpoint: `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`
- Stage: `$default`
- Auto deploy: enabled
- Last deployed: `2026-09-30T05:44:54Z`

AI integration routes:

- `ANY /ai`
- `ANY /ai/{proxy+}`
- `ANY /plans`
- `ANY /plans/{proxy+}`
- `ANY /admin/ai`
- `ANY /admin/ai/{proxy+}`
- `ANY /marketplace`
- `ANY /marketplace/{proxy+}`

Safe HTTP checks performed:

- `OPTIONS /plans/workout/generate`: `204`, CORS allowed deployed frontend origin.
- `OPTIONS /ai/ask`: `204`, CORS allowed deployed frontend origin.
- `GET /health`: `200`, auth service reports OK.
- `GET /plans/llm-health` without token: `401`, no AI provider call.

No authenticated AI generation route was called.

## SQS / Worker

Main queue:

- URL: `https://sqs.ap-southeast-1.amazonaws.com/191798898985/fitness-assistant-dev-ai-tasks`
- Visible messages: `0`
- In-flight messages: `0`
- Delayed messages: `0`
- Visibility timeout: `600`
- Retention: `345600`
- DLQ redrive max receive count: `2`

DLQ:

- URL: `https://sqs.ap-southeast-1.amazonaws.com/191798898985/fitness-assistant-dev-ai-tasks-dlq`
- Visible messages: `1`

Event source mapping:

- UUID: `b582d6b7-bdfb-4552-8faf-09cc7ce49ff0`
- State: `Enabled`
- Batch size: `1`
- Function response type: `ReportBatchItemFailures`

Worker infrastructure is ready. The DLQ message is consistent with the historical Bedrock provider failure.

## Bedrock CloudTrail Evidence

Audited event window: 2026-09-30 to 2026-10-01 in `ap-southeast-1`.

Operations checked:

- `Converse`
- `InvokeModel`
- `InvokeModelWithResponseStream`
- `ConverseStream`

### Successful Runtime Calls

No successful Bedrock runtime call was found in the audited window for the relevant app path.

`LATEST_CONFIRMED_SUCCESSFUL_BEDROCK_CALL=NONE_FOUND`

### Failed Runtime Calls

Relevant worker failures:

| Timestamp UTC | Operation | Model / Resource | Role | Request ID | Error |
|---|---|---|---|---|---|
| `2026-09-30T06:42:22Z` | `InvokeModel` | `cohere.embed-multilingual-v3` | `fitness-assistant-dev-ai-worker-role` | `a1363dda-ff95-402c-a6b6-63c7f7ca4521` | `ValidationException: Operation not allowed` |
| `2026-09-30T06:42:23Z` | `Converse` | `apac.amazon.nova-pro-v1:0` | `fitness-assistant-dev-ai-worker-role` | `87bb205a-28c1-4e49-bf2b-ebd7ed1cfbad` | `ValidationException: Operation not allowed` |
| `2026-09-30T06:52:22Z` | `InvokeModel` | `cohere.embed-multilingual-v3` | `fitness-assistant-dev-ai-worker-role` | `ff1e3430-4a5e-45ac-8f70-ba29e12a7c79` | `ValidationException: Operation not allowed` |
| `2026-09-30T06:52:22Z` | `Converse` | `apac.amazon.nova-pro-v1:0` | `fitness-assistant-dev-ai-worker-role` | `c50b1dc6-e07a-4985-af52-bdddc07b1ffb` | `ValidationException: Operation not allowed` |

Latest confirmed failed app-path Bedrock call:

`LATEST_CONFIRMED_FAILED_BEDROCK_CALL=2026-09-30T06:52:22Z Converse apac.amazon.nova-pro-v1:0 role=fitness-assistant-dev-ai-worker-role requestId=c50b1dc6-e07a-4985-af52-bdddc07b1ffb error=ValidationException:Operation not allowed`

Later root-console Bedrock stream attempts also failed with `ValidationException: Operation not allowed`, but they were not part of the deployed app path.

## Model IDs

Read-only Bedrock availability checks:

### Nova

- Deployed chat model: `apac.amazon.nova-pro-v1:0`
- Underlying foundation model: `amazon.nova-pro-v1:0`
- Inference profile status: `ACTIVE`
- Foundation model authorization: `NOT_AUTHORIZED`
- Agreement availability: `AVAILABLE`
- Entitlement availability: `AVAILABLE`
- Region availability: `AVAILABLE`

Conclusion: the APAC profile exists and is active, but the account is not authorized to invoke the model.

### Cohere Embedding

- Deployed embedding model: `cohere.embed-multilingual-v3`
- Inference type: `ON_DEMAND`
- Authorization: `NOT_AUTHORIZED`
- Agreement availability: `AVAILABLE`
- Entitlement availability: `AVAILABLE`
- Region availability: `AVAILABLE`

Conclusion: the embedding model is available in region but not authorized for this account.

## Chronology

Known failed production-path job:

- Job ID: `3552a04a-1eed-4c27-8ecc-12d52a64193a`
- Plan ID: `2e1ec32e-9359-47df-b1bd-bf88c709fe24`
- First worker attempt around `2026-09-30T06:42Z`
- Second worker attempt around `2026-09-30T06:52Z`
- Both attempts failed on Bedrock provider calls.
- SQS max receive count is `2`; DLQ currently has one message.

CloudWatch worker logs show:

- Plan generation job started.
- Prompt prepared with allowed exercises and training parameters.
- Cohere embedding generation failed with `Operation not allowed`.
- Nova LLM call failed with `Operation not allowed`.
- SQS record was reported as a batch item failure for redelivery.

No successful completion log for that job was found.

## Database Job State

Aurora cluster:

- Identifier: `fitness-assistant-dev-aurora`
- Engine: `aurora-postgresql`
- Status: `stopped`
- Database: `fitness_assistant`

No database read/write verification was performed because starting the cluster would mutate runtime state and may cost money.

`DB_RUNTIME_CHECK_SKIPPED_AURORA_STOPPED=YES`

Source review confirms the intended persistence path:

- Plan generation creates a DB `WorkoutPlan` in queued state before enqueue.
- SQS mode job polling uses DB state as the authoritative source.
- Worker marks plan processing, failed, or completed through repository methods.

Live persistence remains unverified in this audit.

## Output Parsing

The worker plan path prepares a deterministic prompt, calls the LLM, parses returned content, and either completes or fails the persisted plan. Timeout-specific fallbacks can complete deterministically, but the observed Bedrock `ValidationException: Operation not allowed` is not a timeout and is treated as a provider failure.

Therefore current Bedrock authorization failures are not masked as successful plan generation.

## Frontend Readiness

Deployed frontend bucket:

- `fitness-assistant-frontend-dev-191798898985`

Deployed bundle configuration includes:

- `VITE_API_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`
- `VITE_ENABLE_CHAT=false`
- `VITE_ENABLE_CHAT_WS=true`
- `VITE_ENABLE_REALTIME=false`

Source review:

- AI plan page calls `/plans/llm-health`, `/plans/workout/generate`, and `/plans/job/:jobId`.
- Axios refreshes access tokens once on 401.
- AI Coach chat maps 401, 408, 429, 502, and 503 to user-friendly errors.
- AI Plans UI shows queued, processing, completed, and failed states.

Frontend is pointed at the current API Gateway and is ready to surface the backend state. It cannot make AI usable while Bedrock is blocked.

## RAG / Embeddings

OpenSearch Serverless:

- Collection: `fitness-assistant-dev-ai-vectors`
- Type: `VECTORSEARCH`
- Status: `ACTIVE`
- Endpoint: `https://t22tsiv3f1p8a9q5s1qi.aoss.ap-southeast-1.on.aws`
- VPC endpoint status: `ACTIVE`

IAM grants AI roles `aoss:APIAccessAll` to the collection.

RAG blocker:

- Deployed embeddings use Bedrock Cohere.
- Cohere model authorization is `NOT_AUTHORIZED`.
- Historical embedding calls failed with `ValidationException: Operation not allowed`.

The retriever catches embedding failures and may return empty retrieval results, so some chat flows may degrade instead of crashing. That is not the same as RAG readiness.

`RAG=BLOCKED`

## Cost Risk

No provider calls were made by this audit.

Current source retry/cost behavior:

- `BEDROCK_MAX_ATTEMPTS` defaults to `3` in the Bedrock client.
- SQS redrive max receive count is `2`.
- Plan generation may perform several embedding calls for evidence retrieval before one chat generation call.
- The historical failed job produced 9 Cohere `InvokeModel` events and 2 Nova `Converse` events across two worker receives.

Estimated provider calls for one minimal plan E2E after authorization is fixed:

- Typical successful attempt: at least one Nova chat call plus several Cohere embedding calls.
- Failed/retriable case: multiplied by SDK retry attempts and by up to two SQS receives.
- Observed blocked case: 11 Bedrock runtime events for one job before DLQ.

`OWNER_APPROVAL_REQUIRED_BEFORE_LIVE_AI_E2E=YES`

## Remaining Blockers

Primary blocker:

- `BEDROCK_ACCOUNT_AUTHORIZATION`: Nova and Cohere models are available but `NOT_AUTHORIZED`, and real runtime calls fail with `Operation not allowed`.

Secondary blockers / limitations:

- `DATABASE_RUNTIME_NOT_VERIFIED`: Aurora was stopped.
- `POLLING_NOT_LIVE_VERIFIED`: DB-backed job polling requires a live job and database.
- `DLQ_HAS_FAILED_MESSAGE`: DLQ has one visible message from the failed AI path.

## Minimal Live Test Plan

Not executed. Requires owner approval because it will enqueue work and invoke paid providers after Bedrock authorization is fixed.

Preconditions:

1. Bedrock authorization for Nova and Cohere is fixed.
2. Aurora is already available, or owner separately approves starting it.
3. Owner provides an existing dev bearer token. This audit should not create users or mutate auth state.

Suggested single E2E test:

```http
POST https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com/plans/workout/generate
Authorization: Bearer <OWNER_PROVIDED_DEV_TOKEN>
Content-Type: application/json

{
  "goal": "maintenance",
  "durationWeeks": 1,
  "daysPerWeek": 1,
  "exercisesPerDay": 1,
  "trainingLocation": "HOME"
}
```

Then poll:

```http
GET https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com/plans/job/<jobId>
Authorization: Bearer <OWNER_PROVIDED_DEV_TOKEN>
```

Expected pass criteria:

- HTTP route accepts the request.
- DB plan row is created in queued state.
- SQS receives exactly one job.
- Worker processes the job.
- CloudTrail shows authorized Nova and Cohere calls.
- Job reaches `COMPLETED` or a truthful `FAILED` state.
- Polling reflects the same DB state.
- No new DLQ message appears.

This test should be run exactly once first because current retry behavior can multiply provider calls.

`LIVE_TEST_REQUIRED=YES_AFTER_BEDROCK_AUTHORIZATION_FIXED`

## Final Verdict

| Verdict | Value |
|---|---:|
| `CAN_USER_USE_AI_RIGHT_NOW` | `NO` |
| `AI_E2E` | `BLOCKED` |
| `EXACT_BLOCKER` | `BEDROCK_ACCOUNT_AUTHORIZATION` |
| `LIVE_TEST_REQUIRED` | `YES` |
| `OWNER_APPROVAL_REQUIRED_FOR_LIVE_TEST` | `YES` |
| `LATEST_CONFIRMED_SUCCESSFUL_BEDROCK_CALL` | `NONE_FOUND` |
| `LATEST_CONFIRMED_FAILED_BEDROCK_CALL` | `2026-09-30T06:52:22Z Converse apac.amazon.nova-pro-v1:0 role=fitness-assistant-dev-ai-worker-role error=ValidationException:Operation not allowed` |

The system is not AI-ready end to end in AWS dev until Bedrock model authorization is fixed and a single owner-approved live job verifies DB persistence, SQS worker execution, Bedrock calls, and frontend polling together.
