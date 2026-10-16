# AWS DEV — AI Service Fix Implementation (Phases 3-11)

Date: 2026-09-30. Builds directly on `docs/deployment/AWS_DEV_AI_DEEP_DIVE_2026-09-30.md` and `AWS_DEV_AI_FIX_PLAN_2026-09-30.md` (pre-existing investigation, plan-only, no code changed by that pass). This report covers what was actually implemented and tested in this session, and what remains undeployed.

## Phase 3 — `/admin/ai/overview` + `/admin/ai/queue` 30s timeout (BUG-A1)

**Root cause** (already confirmed by the deep-dive, re-verified here): `admin.controller.ts` called `aiQueue.getWaitingCount()` etc. (BullMQ) unconditionally. `aiQueue` (`workers/ai.queue.ts`) is a lazy `Proxy` that opens a real `ioredis` connection to `REDIS_HOST` (default `localhost`) on first property access. The AWS deployment sets `QUEUE_PROVIDER=sqs` and has no Redis reachable from the AI HTTP Lambda; ioredis's default retry strategy does not reject quickly, so the promise never settled before the existing `.catch(() => null)` could run, and the request ran to the Lambda's 30s timeout → API Gateway 503.

**Fix implemented** (`backend/services/ai-service/src/workers/queue-provider.ts`):
- New `getAiQueueStats()`: when `QUEUE_PROVIDER=sqs`, reads `sqs:GetQueueAttributes` on `AI_TASKS_QUEUE_URL` (`ApproximateNumberOfMessages`/`...NotVisible`/`...Delayed`) — **never touches `aiQueue`/BullMQ at all** in this branch. `completed`/`failed` are explicitly `null` (SQS has no equivalent concept — not invented). Otherwise, reads the existing BullMQ counts.
- Both branches are wrapped in a 2-second `withTimeout()` that degrades to all-`null` counts on rejection *or* on a promise that never settles — this is what actually neutralizes the 30s-hang failure mode, independent of which provider path runs.
- Two test seams added, matching the existing `bedrockRuntimeDeps` pattern in `services/bedrock.client.ts`: `sqsDeps.{sendMessage,getQueueAttributes}` and `bullmqStatsDeps.getStats`.
- `admin.controller.ts`'s `getOverview`/`getQueue` now call `getAiQueueStats()` instead of the 5 raw `aiQueue.get*Count()` calls.

**Tests**: `src/__tests__/queue-provider.test.ts` (7 new tests) — SQS success, SQS failure, SQS never-resolves (bounded to <3s, was previously unbounded to 30s), no-queue-url, BullMQ success, BullMQ failure, BullMQ never-resolves (bounded). All pass. `npx tsc --noEmit` clean.

## Phase 3D — IAM permission for `sqs:GetQueueAttributes`

Confirmed via `iam get-role-policy` on `fitness-assistant-dev-ai-lambda-role`: the AI HTTP Lambda's role currently has `sqs:SendMessage` only, **not** `sqs:GetQueueAttributes`, on `arn:...:fitness-assistant-dev-ai-tasks`. Backup of the current policy saved at `docs/deployment/evidence/2026-09-30/ai-runtime-policy-BEFORE-phase3d.json`; the minimally-scoped updated policy (same statement, action list extended to `["sqs:SendMessage","sqs:GetQueueAttributes"]`, same single-queue resource ARN, no wildcard) was prepared at `.../ai-runtime-policy-AFTER-phase3d.json`.

**BLOCKED**: the `iam put-role-policy` call needed to apply it was **denied by this session's own auto-mode safety classifier**, before reaching AWS. Not retried through any other path, per this environment's own rule against working around a denial.

**Consequence**: without this permission, once deployed, the SQS branch of `getAiQueueStats()` will get an `AccessDenied` error from `GetQueueAttributes` — which is a **fast rejection**, not a hang, so it still degrades to `null` counts well within the 2s bound. **BUG-A1's core symptom (503/30s-timeout) is fixed either way.** The only remaining gap without this permission is that `/admin/ai/overview` and `/admin/ai/queue` will show `null` queue counts instead of real SQS numbers — a cosmetic/observability gap, not a functional one.

**Owner action needed**:
```
aws iam put-role-policy --role-name fitness-assistant-dev-ai-lambda-role \
  --policy-name fitness-assistant-dev-ai-runtime-policy \
  --policy-document file://docs/deployment/evidence/2026-09-30/ai-runtime-policy-AFTER-phase3d.json
```

## Phase 4 — AI Worker BullMQ import side effect (BUG-A2)

**Root cause**: `worker-lambda.ts` (Lambda handler) did `const { processAiTaskJob } = await import("./workers/ai.worker")`. `ai.worker.ts` had, at module top level: `export const aiWorker = new Worker("ai-tasks", processAiTaskJob, { connection: redisConnection })`. Any import of a module — static or dynamic — runs its top-level code, so this dynamic import opened a real `ioredis` connection attempt from the AI Worker Lambda on its first SQS message, even though `QUEUE_PROVIDER=sqs` never uses BullMQ.

**Fix implemented**:
- Removed the `Worker` instantiation and its `import { Worker } from "bullmq"` / `import { redisConnection } from "./ai.queue"` from `ai.worker.ts`. It now exports only the pure `processAiTaskJob` function (and its many local helper functions, unchanged).
- New file `backend/services/ai-service/src/workers/ai.worker.runtime.ts`: holds `export const aiWorker = new Worker("ai-tasks", processAiTaskJob, { connection: redisConnection })` and its `.on("failed", ...)` handler — this is the ONLY place the BullMQ `Worker` is instantiated now.
- `server.ts` (the container/local Express entry point — confirmed via grep as the only other importer of `aiWorker`) updated to import from `./workers/ai.worker.runtime` instead of `./workers/ai.worker`.
- `src/__tests__/plan-generation-equipment.integration.test.ts` (pre-existing, real-LLM/real-Redis integration test, not authored this session) also imported `aiWorker` from the old path — updated its one import line to the new path so the repo keeps compiling; no behavioral change to that test.

**Verification**: `worker-lambda.ts`'s only import of the processor module remains the dynamic `import("./workers/ai.worker")` — confirmed via `grep` that nothing in `worker-lambda.ts` imports `ai.worker.runtime.ts` (the only file that does is `server.ts`). Since `ai.worker.ts` no longer contains `new Worker(...)` at all, no import path from the Lambda handler can trigger it anymore, by construction — not just by a timeout/catch mitigating the symptom. `npx tsc --noEmit` clean across the whole ai-service package after this change (this is what caught the `plan-generation-equipment.integration.test.ts` import that needed updating).

**Task discriminator gap (4D)**, also fixed: `worker-lambda.ts`'s `QueueMessage.name` was a compile-time-only union (`"generate-plan" | "generate-nutrition-plan"`); at runtime, any other value silently fell into the `else` branch (`processAiTaskJob`, the workout-plan path) with no explicit check. Added `KNOWN_TASK_NAMES` set (the same two values `queue-provider.ts`'s `AiTaskName` type and `ai.worker.ts`'s own internal check use) and an explicit rejection (throws, caught by the existing try/catch, reported as a batch item failure) for any other name.

**Not done**: no real SQS message was sent to test this end-to-end (forbidden — no paid work, no real worker invocation without explicit approval per this task's own hard rules). Worker remains `NOT_LIVE_VERIFIED`.

## Phase 5 — CORS/preflight (BUG-A3, the deep-dive's P1 "Network Error")

**Reproduced live** (VERIFIED_HTTP, real frontend origin): `OPTIONS /plans/current` and `OPTIONS /ai/ask` against the real API Gateway, with `Origin: http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com`, returned **401** with `access-control-allow-origin`/`-methods`/`-headers` headers present but on a non-2xx status. Confirmed cause: API Gateway's `CorsConfiguration` only decorates whatever the Lambda returns — it does not auto-answer OPTIONS, because `ANY /plans/{proxy+}` / `ANY /ai/{proxy+}` already match OPTIONS and forward it. Every route in `ai.routes.ts`/`plan.routes.ts` mounts `router.use(requireAuth)` first, and a browser preflight never carries an Authorization header, so it hit `requireAuth` and got 401. A non-2xx preflight response makes browsers abort the real request regardless of the CORS headers present — invisible to a plain curl test that never sends OPTIONS.

**Fix implemented** (`backend/services/ai-service/src/app.ts`): a single middleware, mounted before anything else (before `express.json()`, before any router), that answers every `OPTIONS` request with `204` and returns immediately. API Gateway still adds the real CORS headers on top of this 204, since that decoration happens regardless of the Lambda's response.

**Tests**: `src/__tests__/cors-preflight.test.ts` (4 new tests, in-process against the real Express app) — `OPTIONS /plans/current`, `OPTIONS /ai/ask`, and `OPTIONS /admin/ai/overview` all return 204 with no Authorization header; a real `GET /plans/current` without a token still correctly returns 401 (proves this is not an accidental auth bypass). All pass, plus the pre-existing `ai.test.ts`/`ai.flow.test.ts` suites (88 tests total across these + queue-provider + cors-preflight files) still pass — no regression.

**Not addressed** (out of this phase's scope per the plan's own item 1 vs. this fix's minimal scope): if the real production frontend origin is ever anything other than the current S3 website endpoint (e.g. a future CloudFront/custom domain), API Gateway's `CorsConfiguration.AllowOrigins` will need that origin added — a separate, API-Gateway-side change, not a code change, and not attempted here since no such origin exists yet in this AWS account (confirmed no CloudFront distribution, no Route53 zone for this app, in the earlier E2E audit).

## Phase 6-9 — Build / backup / deploy AI Lambdas

**NOT ATTEMPTED.** Two reasons, both explicit:
1. No `build-lambda-artifact.js` (or equivalent) exists for `ai-service` anywhere in this repo — every other service (auth/fitness/gym/payment/user) has one; ai-service does not. This task's own Phase 6 instruction is explicit: "Do NOT invent a zip command." Inventing a new, unreviewed packaging script for a Lambda that handles Bedrock/production traffic is a bigger, riskier action than this task's phased, one-change-at-a-time intent, and was not done.
2. Two AWS mutation attempts already in this same session (Phase 2's API Gateway route, and Phase 3D's IAM policy update) were denied by this environment's own auto-mode safety classifier before reaching AWS. A Lambda code deployment is at least as sensitive an action; attempting it without first resolving why those two were blocked risks a third denial for no benefit, and — more importantly — deploying either Lambda without a byte-verified rollback artifact (this repo's own established practice, see the auth-service Group C deployment from the prior session) is not something to improvise via a script that doesn't exist yet.

All Phase 3/4/5 fixes above are therefore **verified in source and by local tests only — not yet live on AWS.** The regression matrix in the master summary report confirms the live Lambda still exhibits the pre-fix behavior (`/admin/ai/overview` and `/admin/ai/queue` still 503) because nothing has been deployed.

## Phase 10 — Distributed rate limiting

Per the deep-dive: source already supports a DynamoDB-backed limiter, but the AWS deployment doesn't set `RATE_LIMIT_PROVIDER=dynamodb`, has no `AI_RATE_LIMIT_TABLE`, and the AI HTTP role has no DynamoDB permissions — so the in-memory limiter is effectively per-warm-container, not actually distributed across concurrent Lambda instances.

**Classification**: `PREPARED_NOT_APPLIED`. No DynamoDB table, IAM permission, or env var was created — this is a new persistent AWS resource with real ongoing cost, explicitly excluded from this task's auto-apply scope. Needed before real Bedrock traffic: a DynamoDB table with TTL, `RATE_LIMIT_PROVIDER=dynamodb` + `AI_RATE_LIMIT_TABLE` env vars on the AI HTTP Lambda, and a scoped `dynamodb:UpdateItem`/`GetItem` IAM statement on exactly that table.

## Phase 11 — Admin knowledge endpoints' BullMQ/Redis dependency

Confirmed via source: `admin.controller.ts`'s `getKnowledgePipeline`, `enqueueKnowledgePipeline`, `scheduleKnowledgeRefreshes`/`clearKnowledgeSchedule` all go through `knowledge-pipeline/queue.ts`'s BullMQ-backed queue — the same Redis-unreachable-from-Lambda problem as BUG-A1, not yet fixed. The AWS-native path for scheduled knowledge refresh uses EventBridge Scheduler + `ai-jobs` directly (bypassing BullMQ), so these 4 HTTP admin endpoints are currently the **only** BullMQ-dependent code left reachable from the AI HTTP Lambda in AWS.

**Not fixed** — this needs a design decision (make these endpoints AWS-aware and call the jobs-Lambda path directly, vs. return an explicit "unavailable in this deployment mode" response) rather than a mechanical port like Phase 3's. Documented here per scope-control guidance (a real P2, not blocking, not silently half-built) rather than implemented under this task's time box. Calling any of these 4 endpoints against the live Lambda today will very likely reproduce the same 30s-timeout pattern as BUG-A1 did — not verified live in this session (would require an ADMIN call that mutates the knowledge-pipeline queue state, outside this audit's read-only intent for that particular endpoint group).

## Summary of code changes (all local, none deployed)

- `backend/services/ai-service/src/workers/queue-provider.ts` — `getAiQueueStats()`, `sqsDeps`, `bullmqStatsDeps`.
- `backend/services/ai-service/src/controllers/admin.controller.ts` — use `getAiQueueStats()`.
- `backend/services/ai-service/src/workers/ai.worker.ts` — removed `Worker` instantiation.
- `backend/services/ai-service/src/workers/ai.worker.runtime.ts` — new file, holds the `Worker` instantiation.
- `backend/services/ai-service/src/server.ts` — import `aiWorker` from the new runtime file.
- `backend/services/ai-service/src/worker-lambda.ts` — explicit task-name discriminator.
- `backend/services/ai-service/src/app.ts` — OPTIONS short-circuit before any router/auth.
- `backend/services/ai-service/src/__tests__/plan-generation-equipment.integration.test.ts` — one-line import path fix (pre-existing test, not authored this session).
- New tests: `queue-provider.test.ts`, `cors-preflight.test.ts`.
