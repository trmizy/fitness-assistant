# AWS DEV — Fitness Lambda Stale Deployment Fix

Date: 2026-09-30. Account `191798898985`, region `ap-southeast-1`. Closes the last remaining gap from `AWS_DEV_AI_PACKAGING_DEPLOY_2026-09-30.md`'s Phase 2 finding: API Gateway routing for `/fitness-roadmaps` was already correct and unchanged in this session — only the Lambda code was stale.

## Phase 1 — Source verify

`backend/services/fitness-service/src/app.ts:50` — confirmed `app.use("/fitness-roadmaps", fitnessRoadmapRoutes)` unchanged. `fitness-roadmap.routes.ts` — confirmed `GET /current` plus 14 other routes (diagnosis, projection, ai-draft, activate, advance, rebuild, archive, etc.), all present and unchanged since the last audit. `npx tsc --noEmit`: clean. Ran 7 non-integration test files relevant to roadmap/exercises/training-cycles (no production DB): `fitness-roadmap-forecast.engine.test.ts`, `fitness-roadmap-reconciliation.engine.test.ts`, `exercise-history.util.test.ts`, `exercise-name-matcher.util.test.ts`, `exercise-progress.util.test.ts`, `exercise-progression.engine.test.ts`, `training-cycle-metrics.service.test.ts` — **97/97 pass**. (`exercise-substitution.test.ts` was excluded — despite its name it requires a live DB connection, not a pure unit test; not run, per "do not use production DB.")

## Phase 2 — Build process

`backend/services/fitness-service/package.json`: `"build:lambda-zip": "node scripts/build-lambda-artifact.js"` — existing, reviewed script (same pattern as gym-service's, not shared via the same lib file but structurally identical: pnpm build shared → `db:generate` → tsc build → `pnpm deploy --prod` → flatten node_modules → copy dist, prune non-Lambda Prisma engines → hand-written zip writer). No new packaging method created.

`gymcoach-fitness-dev` stopped before building (same Windows EPERM gotcha as gym/ai), restarted after.

## Phase 3 — Backup

```
backend/services/fitness-service/artifacts/rollback/fitness-lambda-config-BEFORE-20260930T062731Z.json
backend/services/fitness-service/artifacts/rollback/fitness-lambda-BACKUP-20260930T062731Z.zip
backend/services/fitness-service/artifacts/rollback/fitness-lambda-env-var-NAMES-ONLY-20260930T062731Z.json
```
Byte-verified: backup zip's SHA256 (base64) = `k1CWSwp7s3DMVkd4Ckxgq6ZiUdIqaHIbb8zB1Oplk1c=`, matching the Lambda's own reported `CodeSha256` exactly. Environment variable **names only** saved (`USER_LAMBDA_NAME`, `AUTH_LAMBDA_NAME`, `FITNESS_DISABLE_REDIS`, `NODE_ENV`, `DATABASE_SECRET_ID`, `INTERNAL_SERVICE_SECRET`) — no values captured or displayed, per instruction.

## Phase 4 — Build

First build attempt: `node scripts/build-lambda-artifact.js` succeeded but produced an oversized artifact (**80.01 MB compressed**, vs the old 55.9 MB) containing **3 stale `query_engine-windows.dll.node.tmp<pid>` files (~19.26 MB each)** left over from `prisma generate`'s own EPERM-prone Windows rename step (the same class of issue already documented for ai-service and user-service's build scripts).

**Root cause investigated, not just patched around**: fitness-service's own `build-lambda-artifact.js` has a pre-existing typo in its Prisma-engine-pruning regex — `/^(libquery_engine|query-engine)/` (hyphen) instead of `query_engine` (underscore), the actual prefix of the Windows engine filename. This means the Windows engine (and any of its stray `.tmp*` copies) has **never** been pruned by this script, in any past build — a latent inefficiency predating this session, out of this task's authorized scope to fix (only Lambda code redeployment was authorized, not build-tooling changes). Also found 5 further stray `libquery_engine-linux-musl-openssl-3.0.x.so.node.tmp*` files in `src/generated/prisma/` (these ARE matched and would have been pruned correctly by the script's own regex, but were harmless leftover clutter in the source tree regardless).

**Action taken**: deleted all 8 stray `*.tmp*` files from `src/generated/prisma/` (plain temp-file cleanup — not a source code change, not a build-script change) and rebuilt. Second build: **56.04 MB compressed, 138 MB uncompressed, 4229 entries** — no stale `.tmp` files (confirmed via `unzip -l | grep tmp` → empty), close to the old artifact's size (consistent with the old artifact also having shipped the same always-unpruned, non-stale Windows engine — a pre-existing characteristic, not a regression).

**Artifact validation**:
- `dist/lambda.js` present, Handler `dist/lambda.handler`.
- `libquery_engine-rhel-openssl-3.0.x.so.node` present (Lambda-runtime engine).
- No `.tmp` files anywhere in the artifact.
- `dist/routes/fitness-roadmap.routes.js` present and confirmed (via `unzip -p | grep`) to contain the literal `"/current"` route string.
- Extracted and `require()`d `dist/lambda.js` locally: `handler` exports as a function, no import-time error, no `MODULE_NOT_FOUND`.
- 138 MB uncompressed / 56 MB compressed — both well within Lambda's 250 MB / direct-upload limits (deployed via S3 staging regardless, matching this session's established practice after two prior direct-upload network interruptions on other services).

## Phase 5 — Deploy

S3-mediated upload (`s3://fitness-assistant-deployments-dev-191798898985/fitness-lambda/...`, then `update-function-code --s3-bucket --s3-key`) — chosen directly based on this same session's prior experience (direct `--zip-file` upload hit a transient network interruption for both gym-service and would risk the same here at a similar size).

```
Old CodeSha256: k1CWSwp7s3DMVkd4Ckxgq6ZiUdIqaHIbb8zB1Oplk1c=  (LastModified 2026-09-08T03:16:53Z, CodeSize 55,937,845)
New CodeSha256: 6gDMULtGT1ycpcHTLYN2gFeDAd8uYx93sIJvXvhKrQY=  (LastModified 2026-09-30T06:35:44Z, CodeSize 56,035,262)
State: Active, LastUpdateStatus: Successful — CodeSize matches the new artifact exactly.
```

## Phase 6 — Live read-only verification (fresh CUSTOMER token, not printed)

| Test | Result |
|---|---|
| GET /fitness-roadmaps/current | **200** — a real, pre-existing `ACTIVE` FitnessRoadmap (`"Lộ trình do AI Coach tạo"`, created 2026-09-10, goal `MUSCLE_GAIN`) that has been sitting in the DB, completely unreachable via the API, since before this entire audit began. This data was not created by this session — it already existed. |
| GET /exercises | 200 (unchanged) |
| GET /training-cycles | 200 (unchanged) |
| GET /nutrition/goals | 200 (unchanged) |

No resource was created or modified by this verification — all calls were GET-only, using an existing authorized test account.

## Phase 7 — CloudWatch

`/aws/lambda/fitness-assistant-dev-fitness`, 6-minute window covering the deploy + all verification calls: 14 total log events, **0** matching `Runtime.ImportModuleError`, `MODULE_NOT_FOUND`, `PrismaClientInitializationError`, `UnhandledPromiseRejection`, or any `level:50` (error) line. Confirms the new code path (including the roadmap handler and its Prisma client) executed cleanly.

## Phase 8 — Rollback

**Not needed.** No regression on any endpoint, 0 CloudWatch errors, `GET /fitness-roadmaps/current` now succeeds. Backup remains at the paths listed in Phase 3 for future reference.

## Incidental finding (documented, not fixed — out of this task's authorized scope)

`build-lambda-artifact.js`'s Prisma-engine prune regex has a hyphen/underscore typo (`query-engine` vs the real `query_engine` prefix), so it never prunes the Windows-only engine binary from any fitness-service Lambda artifact it has ever produced. Not a functional bug (Lambda ignores the unusable Windows binary at runtime) — purely ~19 MB of permanent, avoidable dead weight in every deploy. A one-character fix if a future session is authorized to touch build tooling: change `query-engine` to `query_engine` on that line, matching gym-service's shared `lambda-package-lib.js`, which already has the correct pattern.

## Final verdict

```
FITNESS_STALE_DEPLOYMENT:
FIXED
```
