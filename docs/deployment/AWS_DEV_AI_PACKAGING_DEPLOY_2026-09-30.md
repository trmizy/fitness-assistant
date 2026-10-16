# AWS DEV — AI Service Packaging & Deploy (Continuation, Phases 2-9)

Date: 2026-09-30. Builds on `AWS_DEV_AI_FIX_IMPLEMENTATION_2026-09-30.md` (source fixes for BUG-A1/A2/A3, previously verified locally but not deployed).

## Correction to the prior report

The prior report stated "no `build-lambda-artifact.js` exists for ai-service" and concluded Phase 6-9 could not proceed without inventing one. That was true only for that exact filename — a broader search this session found `backend/services/ai-service/scripts/package-lambda.ts` (referenced from `package.json` as `"build:lambda:package": "tsx scripts/package-lambda.ts"`), an existing, fully-documented, already-reviewed packaging script that was simply missed by the earlier filename-specific search. **No new script was written.** This report uses that existing script throughout.

## Phase 2 — FitnessRoadmap API Gateway retry (owner-approved)

Re-queried routes first: no `roadmap`-related route existed yet (no duplicate risk). Created, once, with no classifier denial this time:

```
ANY /fitness-roadmaps           -> integrations/wv4c1bs (fitness-assistant-dev-fitness)
ANY /fitness-roadmaps/{proxy+}  -> integrations/wv4c1bs
```
Plus matching `lambda:InvokeFunction` permissions (`fitness-roadmaps-exact`, `fitness-roadmaps-proxy`) on `fitness-assistant-dev-fitness`. Rollback commands saved to `docs/deployment/evidence/2026-09-30/phase2-rollback-commands.sh` (not executed).

**Result — not the PASS condition described in the task, and not the described generic-404 FAIL condition either; a third case**: `GET /fitness-roadmaps/current` now returns **404 `Cannot GET /fitness-roadmaps/current`** — this is Express's own 404, proving the request correctly reaches the `fitness-assistant-dev-fitness` Lambda (routing is fixed), but that Lambda's own deployed code has no matching route.

**Root cause, same class of bug as the gym-service finding**: `aws lambda get-function-configuration --function-name fitness-assistant-dev-fitness` → `LastModified: 2026-09-08T03:16:53Z`. `git log` on `fitness-roadmap.routes.ts`/`app.ts`'s mount line → commit `16018e5f`, `2026-09-10T16:32:13+07` (`09:32:13Z`) — **~2.5 days after** the deployed Lambda was built. The FitnessRoadmap feature was added to source after this Lambda's last deployment; the route now correctly reaches it, but the Lambda itself doesn't have the feature yet.

**Not fixed in this session**: this specific prompt authorized the gym-service redeploy and the fitness-roadmap *routing* retry, but not a `fitness-assistant-dev-fitness` redeploy. Given the direct parallel to the just-completed, successful gym redeploy, the fix is well-understood and low-risk, but applying it here without it being explicitly named in this prompt's authorization would be scope expansion beyond what was asked — documented instead, exactly as the gym staleness finding was documented before being separately authorized and fixed this round.

```
FITNESS_ROADMAP_ROUTING:
APPLIED (routing) / BLOCKED (feature not live — Lambda redeploy needed, not yet authorized)
```

**Owner action to fully close this**: authorize a `fitness-assistant-dev-fitness` redeploy using the same playbook as `AWS_DEV_GYM_REDEPLOY_2026-09-30.md` (backup → build via `backend/services/fitness-service/scripts/build-lambda-artifact.js` → deploy → live-test `GET /fitness-roadmaps/current`).

## Phase 3 — AI packaging script

**3A**: Compared auth/user/fitness/gym/payment-service's `build-lambda-artifact.js` scripts (pnpm workspace build → `db:generate` → `tsc` → `pnpm deploy --prod` → flatten pnpm's isolated node_modules → prune non-RHEL Prisma engines → hand-rolled spec-correct zip writer) against ai-service's actual existing script, `scripts/package-lambda.ts`. That script already answers 3A's exact question: it stages ONE dependency set (via `npm install` with `--os=linux --cpu=x64 --libc=glibc` cross-targeting, `@gym-coach/shared` injected as an `npm pack` tarball since npm can't resolve pnpm's `workspace:*` protocol) and produces `ai-lambda.zip` + `ai-worker-lambda.zip` as **byte-identical copies of the same staged directory**, differing only in which `Handler` each deployed Lambda is configured with (`dist/lambda.handler` vs `dist/worker-lambda.handler`) — the simplest safe architecture, already implemented and documented in that file's own header comment.

**3B**: Not done — the script already exists and needed no changes.

## Phase 4 — Artifact safety test

Built via the existing pipeline: `pnpm --filter @gym-coach/shared build` → `pnpm --filter @gym-coach/ai-service db:generate` → `pnpm --filter @gym-coach/ai-service build` → `npx tsx scripts/package-lambda.ts`.

**Known Windows gotcha hit and worked around**: `prisma generate` failed with `EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp...' -> '...query_engine-windows.dll.node'` even after stopping `gymcoach-ai-dev`. Investigated directly rather than assumed: the required artifacts (`libquery_engine-rhel-openssl-3.0.x.so.node`, `dist/generated/prisma/index.js`) were confirmed present and current (schema unchanged since the engine file's timestamp) despite the CLI's non-zero exit — the failure was isolated to a stale Windows-only `.tmp` rename, irrelevant to a Linux Lambda artifact. Removed the stray `.tmp*` files (harmless cleanup, not a source change) and proceeded; `tsc` build then succeeded normally.

**Results**:
```
ai-lambda.zip          37,353,960 bytes   handler dist/lambda.handler
ai-worker-lambda.zip   37,353,960 bytes   handler dist/worker-lambda.handler   (byte-identical, confirmed via sha256)
ai-migrate-lambda.zip  22,338,071 bytes   handler dist/migrate-lambda.handler  (built as a side effect of the shared script; NOT deployed — out of this task's scope)
```
Both well within the 50MB direct-upload / 250MB unzipped Lambda limits.

- Handler files present: `dist/lambda.js`, `dist/worker-lambda.js` — confirmed via extraction.
- No stray Prisma engine/tmp files in either artifact — only `libquery_engine-rhel-openssl-3.0.x.so.node`.
- `dist/workers/queue-provider.js` inside the artifact confirmed to contain `getAiQueueStats`/`sqsDeps` (the actual fix, not stale code); `dist/controllers/admin.controller.js` confirmed to call `getAiQueueStats()`, not `aiQueue` directly.
- **HTTP artifact, `QUEUE_PROVIDER=sqs`, no `REDIS_HOST`/`REDIS_PORT`**: `require('./dist/lambda.js')` succeeds immediately, no hang, `handler` is a function.
- **Worker artifact, same env**: `require('./dist/worker-lambda.js')` succeeds immediately. Deeper check — `require('./dist/workers/ai.worker.js')` directly (the module `worker-lambda.js` dynamically imports at invocation time) — confirmed `module.exports.aiWorker` is `undefined` (the BullMQ `Worker` export no longer exists in this file at all) and `processAiTaskJob` is a function; `new Worker` no longer appears anywhere in the compiled `ai.worker.js` (grep-verified) — by construction, no import path from this artifact can instantiate a BullMQ Worker or open a Redis connection. One isolated run of this same check took 10s+ and was killed by a timeout wrapper; two immediate re-runs completed in ~1.05s and ~1.09s each — attributed to transient disk/process contention from concurrent operations at that moment (a `docker start` and several parallel `find`/`grep` calls were running at the same time), not a code defect, given the static grep evidence and the two clean, fast reruns immediately after.
- `npx tsc --noEmit`: clean.
- `queue-provider.test.ts` (7 tests) and `cors-preflight.test.ts` (4 tests): previously run and passing this session (see the earlier AI fix implementation report) — not re-run in this phase since no source changed since then, only artifacts were rebuilt from the same source.

## Phase 5 — Backup AI Lambdas

```
backend/services/ai-service/artifacts/rollback/fitness-assistant-dev-ai-config-BEFORE-20260930T055838Z.json
backend/services/ai-service/artifacts/rollback/fitness-assistant-dev-ai-BACKUP-20260930T055838Z.zip
backend/services/ai-service/artifacts/rollback/fitness-assistant-dev-ai-worker-config-BEFORE-20260930T055838Z.json
backend/services/ai-service/artifacts/rollback/fitness-assistant-dev-ai-worker-BACKUP-20260930T055838Z.zip
```
Both byte-verified (`sha256sum` of each backup zip, base64-encoded, equals that Lambda's reported `CodeSha256`, both `NV38VMwO7TB1jNfWdBkQlU1KAVJLT8J5liVMLEpqwQ0=` — confirms both Lambdas were already deployed from the same source at the same time, 2026-09-15, consistent with the byte-identical-artifact design).

## Phase 6 — IAM retry (owner-approved)

Re-read current state first: role `fitness-assistant-dev-ai-lambda-role` had only `sqs:SendMessage` on the `SendAiTasksToSqs` statement (unchanged since the prior session). Diffed the prepared `ai-runtime-policy-AFTER-phase3d.json` against the current live policy — confirmed the only change is `Action` becoming `["sqs:SendMessage", "sqs:GetQueueAttributes"]` on the exact same single-queue `Resource` ARN, no wildcard, no other statement touched. Applied once via `iam put-role-policy` — **no classifier denial this time**. Verified post-apply via `get-role-policy` — matches exactly.

```
IAM sqs:GetQueueAttributes:
APPLIED
```

## Phase 7 — Deploy AI HTTP

Direct upload not attempted (learned from the gym-service deploy's transient network failure this same session) — went straight to S3-mediated upload. `update-function-code --s3-bucket ... --s3-key ...`, waited via `lambda wait function-updated`.

```
Old CodeSha256: NV38VMwO7TB1jNfWdBkQlU1KAVJLT8J5liVMLEpqwQ0=  (LastModified 2026-09-15T08:45:16Z)
New CodeSha256: aBD4SFPOCLDdO/qR70Cs/GWSb+ws51s2YLYXORZ2/Ec=  (LastModified 2026-09-30T06:00:53Z)
State: Active, LastUpdateStatus: Successful
```

**Live verification** (ADMIN token where noted):

| Endpoint | Before | After | Latency |
|---|---|---|---|
| GET /admin/ai/overview | 503 (30s timeout) | **200**, real data incl. live SQS counts (`waiting:0,active:0,delayed:0,completed:null,failed:null`) | 4.47s (well under the old 30s Lambda timeout; still not fast — see note below) |
| GET /admin/ai/queue | 503 (30s timeout) | **200**, same real SQS counts | 0.37s |
| GET /admin/ai/errors | 200 | 200 (unchanged) | — |
| GET /plans/llm-health | 200 | 200 (unchanged) | — |
| OPTIONS /plans/current (real S3 origin) | 401 with CORS headers (browser-fatal) | **204** with the same correct CORS headers | — |
| OPTIONS /ai/ask (real S3 origin) | 401 | **204** | — |

Note on `/admin/ai/overview`'s 4.47s: this is the DB aggregate query (`conversationRepository.adminGetOverviewStats()`, run in `Promise.all` alongside the now-fast queue-stats call), not the queue-stats path — the fix's own 2-second timeout bound only wraps `getAiQueueStats()`, and the SQS `GetQueueAttributes` call itself returned well within that. 4.47s is still a large improvement over the old unbounded-to-30s failure and is a real, successful, non-timeout 200 response — not re-investigated further as it's outside this bug's scope (BUG-A1 was specifically the Redis-hang causing 503, not DB query performance).

CloudWatch (`/aws/lambda/fitness-assistant-dev-ai`, 6-minute window covering all the above calls): 0 error-level log lines.

## Phase 8 — Deploy AI Worker

Same S3-mediated method.

```
Old CodeSha256: NV38VMwO7TB1jNfWdBkQlU1KAVJLT8J5liVMLEpqwQ0=
New CodeSha256: aBD4SFPOCLDdO/qR70Cs/GWSb+ws51s2YLYXORZ2/Ec=  (identical to the HTTP Lambda's new CodeSha256 — confirms the byte-identical-artifact design)
State: Active, LastUpdateStatus: Successful, Handler: dist/worker-lambda.handler (unchanged)
```

Event source mapping after deploy: `State: Enabled`, `BatchSize: 1`, `ReportBatchItemFailures` still on — unchanged. Queue depth checked, still `ApproximateNumberOfMessages: 0` / `ApproximateNumberOfMessagesNotVisible: 0` — not touched, no test message sent, no manual invoke.

```
AI WORKER: DEPLOYED_NOT_LIVE_VERIFIED
```

## Phase 9 — Regression

| Area | Check | Result |
|---|---|---|
| User | GET /profile/me | 200 |
| Payment | GET /me/wallet, GET /me/payments | 200, 200 |
| Fitness | GET /exercises | 200 |
| Fitness | GET /fitness-roadmaps/current | 404 `Cannot GET` (documented above — separate, not-yet-authorized fitness Lambda redeploy needed) |
| Gym | GET /gyms | 200 |
| Gym | GET /admin/gyms [ADMIN], GET /admin/partners [ADMIN] | 200, 200 |
| Gym | GET /admin/gyms [CUSTOMER] | 403 |
| AI | GET /plans/current, /plans/nutrition/current, /plans/llm-health | 200, 200, 200 |
| AI | GET /admin/ai/overview, /admin/ai/queue, /admin/ai/errors | 200, 200, 200 |

No regressions. No writes performed anywhere in this phase.

## Phase 10 — Deferred (untouched, as instructed)

Chat ECS, CloudFront/HTTPS/custom domain, ACM, DynamoDB distributed limiter, credential rotation, paid AI, real SQS worker invocation, CI/CD, `gym_membership_plans.brand_id` manual item, admin knowledge-pipeline BullMQ endpoints (Phase 11 from the prior prompt — still only documented, not fixed).
