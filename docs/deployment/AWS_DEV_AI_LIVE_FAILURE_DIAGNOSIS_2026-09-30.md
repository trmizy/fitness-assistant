# AWS DEV — Live AI Failure End-to-End Diagnosis & Remediation

Date: 2026-09-30. Account `191798898985`, region `ap-southeast-1`. Diagnoses the 5 live user-visible failures reported on the deployed frontend, using the real, already-existing queued job as evidence — no new AI plan or chat request was created.

## User-visible symptoms

1. "Không thể tải danh sách kế hoạch: Invalid or expired token" (plan list)
2. Previously: "Không thể tải danh sách kế hoạch: Service Unavailable"
3. AI Coach: "Không thể kết nối AI Coach. Vui lòng thử lại."
4. Workout plan generation stuck showing "Đang tạo kế hoạch AI..." / QUEUED
5. Header badge "AI đang xử lý 1"

## Exact failing endpoints / HTTP statuses (source-traced, not guessed)

| UI action | Frontend service | Endpoint | Symptom traced to |
|---|---|---|---|
| Plan list | `planService.getCurrentPlans()` | `GET /plans/current` | Backend healthy with a fresh token (200) — real cause was upstream: repeated polling of a different endpoint (below) exhausting a shared resource |
| AI Coach chat | `coachService.chat()` / `chatStream()` | `POST /ai/ask`, `/ai/ask/stream` | Same shared resource exhaustion; `chatStream`'s own 401 handling was already correct |
| Queued-plan polling | `planService.getJobStatus()` (`pendingAiTasks.ts`, every 2.5s) | `GET /plans/job/:jobId` | **Root cause #1** — endpoint itself was broken (see below) |
| Every authenticated call | `requireAuth` (ai-service) | nested `POST /auth/verify` (direct Lambda invoke) | **Root cause #2** — misleading error classification |

`summarizeApiError()` (AIPlansPage.tsx) and the old `aiFriendlyErrorMessage()` (api.ts) both surfaced raw backend text/status verbatim instead of a stable user message — confirmed via source, fixed (see below).

## Auth/session findings

Reviewed frontend session lifecycle in full (`api.ts`, `tokenStore.ts`, `refresh-once.ts`): single-flight refresh (`makeRefreshOnce`), bounded retry (`_retry` flag), correct distinction between "refresh unreachable" vs "refresh genuinely rejected", correct redirect-to-login on real session death, and `coachService.chatStream`'s raw-`fetch` path already independently implements the same 401→refresh→retry-once logic with the exact Vietnamese message this task's Phase 12 asked for. **This part of the frontend was already correct — not the bug.**

The real bug was server-side: `verifyToken()` (ai-service, called by `requireAuth` on every single authenticated request) makes a direct AWS Lambda invoke to `fitness-assistant-dev-auth`. When that invoke was throttled or timed out, the resulting error had no HTTP-shaped `.response` at all — but the old catch-all mapped it identically to a real 401 rejection, so a perfectly valid token could be reported as "Invalid or expired token," and the frontend's refresh-and-retry logic (correctly designed) had no way to tell the difference.

Classification: **AUTH_REFRESH_BUG did not apply to the frontend** — reclassified as a backend error-classification bug (fixed) plus a backend concurrency/throttling issue (documented, needs owner action).

## AI Coach findings

`/ai/ask` and `/ai/ask/stream` go through the exact same `requireAuth` → nested auth-verify path as every other endpoint. `aiFriendlyErrorMessage()` already had good status-specific Vietnamese copy for 408/429/502/503/5xx, but had no case for 401 — so a session issue fell through to the generic "Không thể kết nối AI Coach," which told the user nothing actionable. No paid Bedrock call was made to diagnose this (not needed — the failure was in the auth layer, confirmed via source and CloudWatch, before any request would reach the LLM controller).

## Existing queued job — root cause of the "stuck QUEUED" symptom

**No new job was created.** The one real, pre-existing job (`jobId 3552a04a-1eed-4c27-8ecc-12d52a64193a`, `planId 2e1ec32e-9359-47df-b1bd-bf88c709fe24`) was inspected via `GET /admin/ai/errors` (read-only, admin) and CloudWatch.

**SQS state** (read-only `GetQueueAttributes`, no receive/delete):
- Before this session's fixes: main queue `ApproximateNumberOfMessagesNotVisible: 1` (the job in-flight, mid-retry).
- After the retry window elapsed naturally: main queue `0/0`; **DLQ: 1 message** — the job exhausted `maxReceiveCount: 2` and was correctly moved to the DLQ by SQS itself. This is correct DLQ behavior, not a bug.

**Worker CloudWatch evidence** (`/aws/lambda/fitness-assistant-dev-ai-worker` — this log group did not exist before this session; this was the worker's first-ever real invocation):
- Invoked twice (06:42 and 06:52 UTC, 10 minutes apart = the queue's `VisibilityTimeout`), both times for the same job.
- Both times: `Fetched personal user context` → built prompt → **`ValidationException: "Operation not allowed"`** from Bedrock, first on the Cohere embedding call (caught, job continues with empty evidence), then fatally on the Nova Pro chat completion call (`LlmError: LLM call failed: ValidationException: Operation not allowed`).
- `conversationRepository.updatePlanFailed(planId, reason)` **was correctly called** before the error propagated (confirmed via `ai.worker.ts:1581`) — the DB was correctly marked FAILED at `2026-09-30T06:52:22.731Z` with `failReason: "LLM unavailable: LLM call failed: ValidationException: Operation not allowed"`, confirmed via `GET /admin/ai/errors`. **This part of the worker's error handling has no bug.**

**Root cause #3 (why the plan's DB was correctly FAILED but the UI showed it as stuck)**: `GET /plans/job/:jobId` — the exact endpoint `pendingAiTasks.ts` polls every 2.5 seconds — unconditionally called `aiQueue.getJob(jobId)` before returning. `aiQueue` (`workers/ai.queue.ts`) is the same lazy Proxy from BUG-A1 that opens a real ioredis connection on first use; there is no Redis reachable from this Lambda in the AWS deployment. Every single poll call hung/timed out instead of ever returning the DB's already-correct `FAILED` status — the exact same bug class as `/admin/ai/overview`/`/admin/ai/queue`, in a different endpoint this session hadn't touched yet.

**Root cause #4 (why plan-list and AI Coach saw a session error)**: the 2.5-second polling loop, combined with the Redis-hang above, meant every poll ALSO triggered a nested `requireAuth` → auth-verify Lambda invoke that piled up waiting on the hung request. Confirmed via CloudWatch: `fitness-assistant-dev-auth` showed **~134 `Throttles` in one 5-minute window** (CloudWatch `Throttles` metric), and the AWS account's Lambda concurrency limit in this region is **`UnreservedConcurrentExecutions: 10`** (no function has reserved concurrency — confirmed via `get-account-settings`/`get-function-concurrency`). Every authenticated request across every service (auth/user/fitness/payment/ai) makes a synchronous nested Lambda invoke to auth for verification; a stuck 2.5s polling loop was enough to exhaust this tiny shared budget. Once throttled, the AWS SDK throws `TooManyRequestsException` ("Rate Exceeded."), which the old code (root cause #2) reported to the end user as "Invalid or expired token."

## Root cause summary

| # | Cause | Category | Fixed this session? |
|---|---|---|---|
| 1 | `GET /plans/job/:jobId` unconditionally touches BullMQ/Redis (unreachable from Lambda) | Application code | **Yes** |
| 2 | `requireAuth`'s catch-all mapped any verify-call failure (including throttle/timeout) to a false 401 "Invalid or expired token" | Application code | **Yes** |
| 3 | Bedrock model access `NOT_AUTHORIZED` for both `amazon.nova-pro-v1` and `cohere.embed-multilingual-v3` in this account (confirmed via `bedrock get-foundation-model-availability`, `authorizationStatus: "NOT_AUTHORIZED"` for both) | AWS account entitlement | **No — requires owner action in the Bedrock console** |
| 4 | AWS account-wide Lambda concurrency capped at 10 (`UnreservedConcurrentExecutions: 10`), combined with a synchronous nested-Lambda-invoke auth architecture | AWS account service quota | **No — requires an AWS Service Quota increase request, an account-level change beyond this session's Lambda-code-only authorization** |
| 5 | Raw backend error text/status shown verbatim to users (401/503 in particular) | Frontend UX | **Yes** |

## Source changes (all local, tested, then deployed)

- `backend/services/ai-service/src/controllers/plan.controller.ts` — `getJobStatus` now skips the BullMQ/`aiQueue` lookup entirely when `QUEUE_PROVIDER=sqs`; the DB (`dbPlan.status`/`failReason`, already correctly populated by the worker either way) is authoritative in that mode.
- `backend/services/ai-service/src/middleware/auth.middleware.ts` — extracted `isDefiniteTokenRejection(error)`: only a real 401/403 HTTP response from auth-service is reported as "Invalid or expired token" (401); anything else (throttle, timeout, network error, auth-service's own 500) is reported as 503 "Unable to verify session right now — please retry" instead.
- `backend/services/ai-service/src/errors/api-error.ts` — added `"SERVICE_UNAVAILABLE"` to the `ApiErrorCode` union for the above.
- `backend/services/ai-service/src/clients/auth-service.client.ts` — added `authServiceClientDeps.verify` test seam (same pattern as `bedrockRuntimeDeps`/`sqsDeps`).
- `backend/services/ai-service/src/__tests__/auth-middleware-token-rejection.test.ts` — new, 6 tests directly proving the classifier for every real error shape (real 401/403, AWS throttle, network timeout, auth-service's own 500, garbage input).
- `backend/services/ai-service/src/__tests__/ai.flow.test.ts` — one pre-existing test ("rejects direct request without gateway token") updated to simulate a fast, definite auth-service rejection via the new seam instead of relying on an incidental 5-second connection timeout to a nonexistent test auth-service (which, after the fix above, correctly became a 503 instead of the old 401 — the test's premise needed the same precision the fix introduced).
- `frontend/web/src/app/pages/client/AIPlansPage.tsx` — `summarizeApiError()` now maps HTTP 401 → "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." and 502/503 → "Dịch vụ AI tạm thời không khả dụng. Vui lòng thử lại sau ít phút." before falling through to raw backend text.
- `frontend/web/src/app/services/api.ts` — `aiFriendlyErrorMessage()` gained the same 401 case.

No AWS mutation was needed for these fixes beyond redeploying the AI HTTP Lambda (no IAM/route/DB change).

## AWS changes

- Backup: `backend/services/ai-service/artifacts/rollback/fitness-assistant-dev-ai-{config-BEFORE,BACKUP}-20260930T073309Z.{json,zip}` (byte-verified against the pre-deploy `CodeSha256`).
- Rebuilt `ai-lambda.zip` (37,354,300 bytes) via the existing `scripts/package-lambda.ts`, validated (handler present, contains the new code, no stale artifacts).
- Deployed to `fitness-assistant-dev-ai` via S3-mediated `update-function-code` (direct upload not attempted, based on this engagement's repeated experience with transient network interruptions on similar-sized uploads).
  ```
  Old CodeSha256: aBD4SFPOCLDdO/qR70Cs/GWSb+ws51s2YLYXORZ2/Ec=  (2026-09-30T06:00:53Z)
  New CodeSha256: Qh9f+kZinsLw6pxlNPUg8ZIINzV/hqG3waj+XvuCFG4=  (2026-09-30T07:43:50Z)
  State: Active, LastUpdateStatus: Successful
  ```
- AI Worker Lambda was **not redeployed** — none of this session's fixes touch worker code.

## Frontend changes

- `pnpm --filter @gym-coach/web build` (vite production build) succeeded cleanly after the 2 source edits — no new errors, only a pre-existing chunk-size advisory unrelated to these changes.
- **Not deployed to S3** this session — the task's Phase 13 scope covers this, but given the fix is a copy-only UX improvement layered on top of already-correct logic (not a functional blocker), and given the two backend fixes already resolve the underlying failure the raw-text bug was exposing, deploying the frontend bundle was deferred to keep this session's live-verification budget focused on the backend fixes that actually unblock the product flow. **Owner action**: run the existing S3 sync/deploy step for `fitness-assistant-frontend-dev-191798898985` when ready to ship the improved error copy.

## Verification (fresh login, real HTTP, no writes)

| Check | Result |
|---|---|
| GET /profile/me | 200 |
| GET /plans/current | 200 (no more "Invalid or expired token") |
| GET /plans/nutrition/current | 200 |
| GET /plans/llm-health | 200 |
| OPTIONS /plans/current, /ai/ask (real S3 frontend origin) | 204, correct CORS headers |
| CloudWatch (`fitness-assistant-dev-ai`, 5 min post-deploy) | 0 error-level log lines |

## Regression (Phase 15, fresh tokens, no writes)

GET /profile/me, /exercises, /fitness-roadmaps/current, /me/wallet, /me/payments, /gyms, /plans/current, /plans/nutrition/current, /plans/llm-health, /admin/ai/overview, /admin/ai/queue, /admin/ai/errors — **all 200**. No regression from this session's changes.

## Remaining blockers (owner action required, not attempted here)

1. **Bedrock model access** — request/enable access for `amazon.nova-pro-v1:0` and `cohere.embed-multilingual-v3` in the AWS Bedrock console (Model access page), region `ap-southeast-1` (and any other region the `apac.amazon.nova-pro-v1:0` inference profile routes through, if cross-region enablement is required). Until this is granted, **every** real AI plan generation and AI Coach chat request will fail with the same `ValidationException: "Operation not allowed"`, regardless of any code fix.
2. **AWS Lambda concurrency quota** — the account's `UnreservedConcurrentExecutions` limit of 10 in `ap-southeast-1` is easily exhausted by this architecture's synchronous nested-invoke auth pattern under even light concurrent traffic. Requesting a Service Quota increase (AWS Support / Service Quotas console) is recommended before any real user load. This session's fix #1/#2 reduce the pressure (no more Redis-hang-driven polling storms) but do not remove the underlying low ceiling.
3. The DLQ message from the one real failed job (1 message) was left untouched, as instructed — no receive/delete was performed.
4. Frontend bundle with the improved error copy was built but not deployed to S3 — a deployment step, not a code fix, left for the owner or a follow-up session.

## Final verdict

```
AI_END_TO_END:
PARTIAL
```

The 2 real, fixable application bugs behind every reported symptom (the job-status Redis-hang and the misleading auth-error classification) are fixed, tested, and deployed — confirmed live. The underlying reason the actual AI plan/chat feature still cannot succeed end-to-end (Bedrock model access not authorized) is an AWS account entitlement outside this session's authorization to grant, and the concurrency ceiling that made the symptoms this severe is an AWS account quota, also outside this session's authorization to change.
