# AWS DEV — Non-Console Remediation — Master Report

Date: 2026-09-30. AWS account `191798898985`, region `ap-southeast-1`, API Gateway `id1iz7upbl`.

Detail reports:
- `AWS_DEV_GYM_API_GATEWAY_FIX_2026-09-30.md` (Phase 1)
- `AWS_DEV_FITNESS_ROADMAP_GATEWAY_FIX_2026-09-30.md` (Phase 2)
- `AWS_DEV_AI_FIX_IMPLEMENTATION_2026-09-30.md` (Phases 3-11)

## Phase 0 — Baseline

`git status --short` at start showed a large, pre-existing set of modified/untracked files across ai-service (conversational-intelligence, agent-workflow), auth-service (credential rotation hardening), and various `docs/`/`test/` trees — all attributable to other, concurrent work in this same repo (matches this project's own documented "Claude Code and Codex may work concurrently" pattern). None of those files were touched. `aws sts get-caller-identity` confirmed account `191798898985` before any mutation, as required.

## GYM ADMIN ROUTING

- Changed: yes — 18 API Gateway routes + 18 Lambda permissions created (9 namespaces × exact+proxy).
- Result: 6/9 namespaces (`gyms`, `brands`, `gym-memberships`) fully working end-to-end, confirmed live with real ADMIN data and correct CUSTOMER 403. 3/9 (`partners`, `commission-rate`, `complaints`) reach the correct Lambda (confirmed via CloudWatch) but fail inside it — a **separate, pre-existing stale-deployment issue** (gym-service Lambda is ~18 minutes older than the commit that added those routes), not something this phase was scoped to fix.
- Rollback status: not needed (no regression — the 3 still-failing namespaces were equally broken, differently, before this change). Rollback commands prepared and saved regardless, per instructions.

## FITNESS ROADMAP ROUTING

- Changed: no.
- Reason: the equivalent 2-route + 2-permission change was **denied by this session's own auto-mode safety classifier** before any AWS call was made. Not retried through any other tool/path.
- Rollback status: n/a (nothing applied). Exact commands for the owner to run directly are in the Phase 2 report.

## AI HTTP

- BullMQ dependency removed from the SQS HTTP path: **yes**, in source (`getAiQueueStats()` never touches `aiQueue` when `QUEUE_PROVIDER=sqs`).
- Overview/queue status: **fixed in source, verified by 7 new local tests + `tsc --noEmit`; NOT deployed** — live AWS still returns 503 (confirmed via a post-fix regression check), because no Lambda deployment was performed (see Phase 6-9 below).
- Response durations: source-level fix bounds both paths to a 2s timeout (tested with a never-resolving mock in place of both BullMQ and SQS, confirmed <3s wall time vs. the old unbounded-to-30s behavior). Not measurable live since not deployed.
- CodeSha256 before/after: **unchanged** — `fitness-assistant-dev-ai` was not redeployed.

## AI WORKER

- Side effect removed: **yes**, in source — `new Worker(...)` moved out of `ai.worker.ts` (the module `worker-lambda.ts` imports) into a new `ai.worker.runtime.ts` that only `server.ts` (container/local) imports. Confirmed by construction (grep) that no import path reachable from `worker-lambda.ts` can trigger it anymore.
- Local tests: `tsc --noEmit` clean across ai-service; existing test suite subset covering touched files (88 tests) passes.
- Deployed: **no**.
- Event source mapping state: unchanged — still `Enabled`, `BatchSize: 1`, `ReportBatchItemFailures` on, queue depth 0 (checked, not touched).
- Still `NOT_LIVE_VERIFIED`: **yes** — no real SQS message was sent (forbidden without further approval), and the fix itself isn't deployed yet either.

## CORS

- Reproduced: **yes**, live, with the real frontend origin — `OPTIONS /plans/current` and `OPTIONS /ai/ask` returned 401 (correct CORS headers present, but a non-2xx preflight status that every real browser treats as a hard CORS failure).
- Fixed: **yes**, in source (`app.ts` short-circuits every OPTIONS to 204 before any router/auth middleware) — verified by 4 new tests plus a check that real GET requests still correctly require auth. **Not deployed.**
- Actual frontend origin result: confirmed via `apigatewayv2 get-api`'s `CorsConfiguration` that `AllowOrigins` already correctly lists the real S3 website-endpoint origin — the bug was never in the CORS config itself, only in the missing OPTIONS short-circuit in Express.

## REGRESSION (live AWS, current deployed code — none of this session's AI/fitness-roadmap fixes are live yet)

| Area | Check | Result |
|---|---|---|
| User | GET /profile/me | 200 |
| Payment | GET /me/wallet, GET /me/payments | 200, 200 (prior session's VPC-config fix still holding) |
| Fitness | GET /exercises | 200 |
| Fitness | GET /fitness-roadmaps/current | 404 (unchanged — Phase 2 blocked) |
| Gym | GET /gyms | 200 |
| Gym | GET /admin/gyms [ADMIN] / [CUSTOMER] | 200 / 403 (this session's Phase 1 fix, confirmed live) |
| AI | GET /plans/current, /plans/nutrition/current, /plans/llm-health | 200, 200, 200 |
| AI | GET /admin/ai/overview, /admin/ai/queue | 503, 503 (unchanged — fix not deployed) |
| AI | GET /admin/ai/errors | 200 |

No regression found anywhere from this session's changes.

## DEFERRED (per explicit instruction — none of these were touched)

- Chat ECS `desiredCount=0` — cost decision, owner-only.
- HTTPS/CloudFront/custom domain — no distribution/zone created.
- Distributed rate limiting (DynamoDB) — documented only, `PREPARED_NOT_APPLIED`.
- Credential rotation Group A/B — untouched.
- Paid AI inference — never called.
- Real AI-worker SQS invocation — never sent.
- CI/CD — untouched.
- Admin knowledge-pipeline BullMQ endpoints (Phase 11) — documented as a real P2 needing a design decision, not mechanically portable like Phase 3.
- `sqs:GetQueueAttributes` IAM permission for the AI HTTP role — prepared (before/after policy JSON saved), application **blocked** by the same classifier as Phase 2.
- AI Lambda build/backup/deploy (Phases 6-9) — not attempted; no existing build script for ai-service, and two prior mutation attempts this session were already denied.

## Files modified (source code, all local, none deployed)

```
backend/services/ai-service/src/workers/queue-provider.ts        (modified)
backend/services/ai-service/src/workers/ai.worker.ts             (modified — Worker instantiation removed)
backend/services/ai-service/src/workers/ai.worker.runtime.ts     (new)
backend/services/ai-service/src/controllers/admin.controller.ts  (modified)
backend/services/ai-service/src/server.ts                        (modified — one import path)
backend/services/ai-service/src/worker-lambda.ts                 (modified — task-name discriminator)
backend/services/ai-service/src/app.ts                           (modified — OPTIONS short-circuit)
backend/services/ai-service/src/__tests__/plan-generation-equipment.integration.test.ts (modified — one import path, pre-existing test)
backend/services/ai-service/src/__tests__/queue-provider.test.ts (new)
backend/services/ai-service/src/__tests__/cors-preflight.test.ts (new)
```

## AWS mutations actually applied this session

- 18 `apigatewayv2 create-route` (gym admin namespaces, Phase 1).
- 18 `lambda add-permission` on `fitness-assistant-dev-gym` (Phase 1).

## AWS mutations prepared but NOT applied (blocked or deferred)

- 2 `apigatewayv2 create-route` + 2 `lambda add-permission` for `/fitness-roadmaps` on `fitness-assistant-dev-fitness` — **blocked by this session's own safety classifier**.
- 1 `iam put-role-policy` adding `sqs:GetQueueAttributes` to the AI HTTP Lambda role — **blocked by this session's own safety classifier**.
- AI HTTP + AI Worker Lambda code deployment — **not attempted** (no existing build script; see AI report for full reasoning).

## Rollback artifacts

- `docs/deployment/evidence/2026-09-30/phase1-rollback-commands.sh` — 18 `delete-route` + 18 `remove-permission` commands for Phase 1, not executed (no rollback needed).
- `docs/deployment/evidence/2026-09-30/ai-runtime-policy-BEFORE-phase3d.json` — the AI Lambda role's policy exactly as it was before the (blocked) Phase 3D change; nothing to roll back since the change never applied.
- `docs/deployment/evidence/2026-09-30/{api,routes,integrations,stages}-snapshot-before-phase1.json`, `gym-lambda-policy-before-phase1.json` — full pre-change snapshots.

## Anything requiring manual owner action

1. Decide whether to run the 2 `create-route` + 2 `add-permission` commands for `/fitness-roadmaps` directly (commands given in the Phase 2 report), or re-authorize this session to attempt them.
2. Decide whether to apply the prepared `sqs:GetQueueAttributes` IAM policy (command given in the AI report), or accept `null` queue counts as a permanent limitation.
3. Decide how to build and deploy the AI HTTP + AI Worker Lambdas with this session's source fixes (no existing build script — needs either a new one modeled on the other services' `build-lambda-artifact.js`, or the owner's own deployment process).
4. Decide whether/when to redeploy `fitness-assistant-dev-gym` to pick up the `partners`/`commission-rate`/`complaints` admin routes already in source (Phase 1's new finding).
5. Design decision for Phase 11 (admin knowledge-pipeline BullMQ endpoints) — not a mechanical fix, needs product/architecture input.

## Final overall verdict

```
NON_CONSOLE_REMEDIATION:
PARTIAL
```

Real, tested, working fixes landed in source for 3 of the AI issues (queue timeout, worker side-effect, CORS preflight) and for 6 of 9 gym admin namespaces live on AWS — all verified, none regressed. Two further AWS mutations (fitness-roadmap routing, one IAM permission) were correctly stopped by this environment's own safety gate rather than worked around, and Lambda deployment was deliberately not attempted without an established, reviewed build mechanism. Chat activation was not proceeded to, per the explicit HARD STOP in this task.
