# GYMINI Conversational AI Coach — Final Independent Production Sign-off

Date: 2026-09-15  
Repository: `fitness-assistant`  
Branch observed: `aws-deploy`  
Commit observed: `b43d6e9 feat(agentic-fitness): roadmap+workout+nutrition automation via chat, RAG chunking fix, ChatGPT-style AI Coach UI`  
Scope: independent final sign-off for GYMINI Conversational AI Coach only. No AWS deployment was performed.

## 1. FINAL DECISION

GO for AWS deployment of the current Conversational AI Coach code/artifacts, with the operational deltas in sections 19–24 applied manually.

The earlier deferred-context target-weight safety issue is fixed in source and present inside the deployable AI HTTP/worker artifact.

## 2. DEFERRED-CONTEXT SAFETY

PASS.

Source confirms `finalizeWorkflow()` rebuilds complete workflow context, checks missing slots first, then reruns every slot-level `validateContext` before any profile diff, confirmation block, completion, or resume:

- `backend/services/ai-service/src/agent-workflow/orchestrator.ts:166-218`
- Generic loop: `for (const s of def.slots)`, skip only slots without `validateContext`.
- Invalid deferred candidate is removed from `known`, `expectedSlot` is set back to that slot key, and workflow stays in missing-data collection.
- The target-weight slot uses contextual safety through `validateContext`: `backend/services/ai-service/src/agent-workflow/workflows/roadmap.workflow.ts:102-128`.

The implementation is generic over `SlotDefinition.validateContext`; the only targetWeight-specific branch is logging.

## 3. THREE VALIDATION STAGES

PASS.

Observed validation stages:

1. Candidate/slot-answer validation: parser + `validateContext` when a user answers a slot.
2. Finalize validation: all resolved slots with `validateContext` rerun against complete context in `finalizeWorkflow()`.
3. Pre-write validation: confirmation path reloads context and reruns `validateContext` before `updateProfileFields()`.

Source:

- `backend/services/ai-service/src/agent-workflow/orchestrator.ts`
- `backend/services/ai-service/src/agent-workflow/types.ts:91-104`

## 4. UNSAFE/SAFE TARGET TESTS

PASS.

Targeted regression command:

```powershell
pnpm --filter @gym-coach/ai-service exec tsx --test src/__tests__/agent-workflow-remediation-2.test.ts src/__tests__/agent-workflow-remediation-1.test.ts src/__tests__/agent-workflow-roadmap-e2e.test.ts src/__tests__/agent-workflow-program-e2e.test.ts src/__tests__/agent-workflow-security-e2e.test.ts
```

Result:

```text
tests 30
pass 30
fail 0
```

The golden deferred-context case is explicitly covered in `agent-workflow-remediation-2.test.ts`: unsafe `targetWeight=30` before `currentWeight` is known never becomes confirmable after `currentWeight=80` arrives; safe correction to `72kg` can later confirm and write once.

## 5. PROFILE_FACT POLICY

PASS.

`PROFILE_FACT` cannot use “just this once”.

Source:

- `backend/services/ai-service/src/agent-workflow/types.ts:35-45`
- `backend/services/ai-service/src/agent-workflow/orchestrator.ts:230-253`

Policy is metadata-driven by `allowsUseOnce(slot.persistence)`, not hard-coded by field name.

## 6. PARSER MATRIX

PASS.

Source tests covered parser behavior through TypeScript regression tests. Compiled `dist` was separately checked with Node against `backend/services/ai-service/dist/agent-workflow/slot-values.js`.

Compiled parser matrix result:

```text
T2 T4 T6                         -> [1,3,5]
thứ 2 4 6                        -> [1,3,5]
thứ 2, 4, 6                      -> [1,3,5]
thứ 2, thứ 4, thứ 6              -> [1,3,5]
thứ 2 - thứ 4 - thứ 6            -> [1,3,5]
thứ hai, thứ tư, thứ sáu         -> [1,3,5]
tập thứ 2, khoảng 60 phút        -> [1]
60 phút                          -> 60
90 phút                          -> 90
1 giờ                            -> 60
1 tiếng                          -> 60
1 giờ 30 phút                    -> 90
1.5 giờ                          -> 90
1,5 giờ                          -> 90
1.2.3 giờ                        -> no_number_found
-1 giờ                           -> no_number_found
```

Source:

- `backend/services/ai-service/src/agent-workflow/slot-values.ts:112-202`

## 7. NO-CAP BUDGET

PASS.

No-cap budget is represented as workflow-only `"NO_CAP"` and translated to `budgetVnd: undefined` for PT search. It is never persisted as `0`, `Number.MAX_VALUE`, or fake profile data.

Source:

- `backend/services/ai-service/src/agent-workflow/workflows/find-pt-program.workflow.ts`
- `backend/services/ai-service/src/__tests__/agent-workflow-remediation-2.test.ts:326-349`

Evaluator covered:

```text
find-pt-budget-1.500.000       PASS
find-pt-budget-Không-giới-hạn PASS
find-pt-budget-Ngân-sách-không-quan-trọng PASS
```

## 8. CONCURRENCY

PASS.

Concurrency controls are DB-backed:

- partial unique active-workflow index migration: `20260916090000_agent_workflow_session_active_unique`
- create conflict handling: `workflowStateRepository.create()` catches Prisma `P2002`
- confirmation write lock: `claimForWrite()` changes exactly one row from `AWAITING_SLOT_CONFIRMATION` to `WRITING`
- failed writes revert via `releaseClaimAfterFailedWrite()`

Source:

- `backend/services/ai-service/src/agent-workflow/workflow-state.repository.ts:32-108`
- `backend/services/ai-service/prisma/migrations/20260916090000_agent_workflow_session_active_unique/migration.sql`

Evaluator result includes `concurrent-start-20` and `concurrent-confirm` as PASS.

## 9. STALE/EXPIRY/FAILED WRITE

PASS.

Observed source semantics:

- active workflow excludes terminal statuses `COMPLETED`, `CANCELLED`, `EXPIRED`
- expired rows are marked `EXPIRED`
- failed profile writes release `WRITING` back to `AWAITING_SLOT_CONFIRMATION`
- stale expected-current-value conditions do not overwrite current profile facts

Source:

- `backend/services/ai-service/src/agent-workflow/workflow-state.repository.ts:9-30`
- `backend/services/ai-service/src/agent-workflow/workflow-state.repository.ts:95-108`

Evaluator case `failed-stale-expired-cancel-switch` PASS.

## 10. SECURITY

PASS for the workflow sign-off scope.

Verified controls:

- slot values come only from current user message, enterprise context, or workflow-local default; prompt/RAG/tool text is not trusted as a profile fact.
- adversarial prompt while `targetWeight` is pending cannot skip confirmation or write profile.
- profile update schema rejects unauthorized fields such as `isPT`.
- `PROFILE_FACT` changes require explicit confirmation.

Source/tests:

- `backend/services/ai-service/src/agent-workflow/types.ts:47-52`
- `backend/services/ai-service/src/__tests__/agent-workflow-security-e2e.test.ts`

## 11. PT TWO-STEP

PASS.

Evaluator confirms PT search-to-hire preserves a draft and requires critical confirmation before contract creation/confirmation:

```text
pt-search-to-hire-two-step PASS
```

Source:

- `backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts:573-584`

## 12. ROADMAP FLAGSHIP

PASS.

Roadmap E2E targeted tests pass. The flagship path asks only for missing data, confirms profile fact updates, then resumes to roadmap generation after confirmation.

Targeted test result:

```text
agent-workflow-roadmap-e2e.test.ts included in 30/30 PASS targeted suite
```

Source:

- `backend/services/ai-service/src/__tests__/agent-workflow-roadmap-e2e.test.ts`

## 13. CODEX V2 EVALUATOR RESULT

PASS.

Command run unmodified from repository root:

```powershell
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts
```

Result:

```text
evaluator: codex-conversational-ai-coach-evaluation-2
decision: GO_WITH_DOCUMENTED_LIMITATIONS
PASS 30
FAIL 0
INFO 0
BLOCKED 0
```

## 14. TARGETED REGRESSION RESULT

PASS.

Command:

```powershell
pnpm --filter @gym-coach/ai-service exec tsx --test src/__tests__/agent-workflow-remediation-2.test.ts src/__tests__/agent-workflow-remediation-1.test.ts src/__tests__/agent-workflow-roadmap-e2e.test.ts src/__tests__/agent-workflow-program-e2e.test.ts src/__tests__/agent-workflow-security-e2e.test.ts
```

Result:

```text
tests 30
pass 30
fail 0
```

Established regression command:

```powershell
pnpm --filter @gym-coach/ai-service exec tsx --test src/llm/__tests__/memory_extraction.test.ts src/llm/__tests__/memory_policy.test.ts src/llm/__tests__/recommendation_claims.test.ts src/llm/__tests__/program_recommendation_claims.test.ts src/__tests__/training-program-scoring-v2.test.ts
```

Result:

```text
tests 76
pass 76
fail 0
```

## 15. FULL SUITE CLASSIFICATION

PASS WITH CLASSIFIED NON-BLOCKING FAILURES.

Command:

```powershell
pnpm --filter @gym-coach/ai-service test
```

Result:

```text
tests 537
suites 32
pass 530
fail 3
skipped 4
duration_ms 333018.5037
```

The 3 failures are all from:

```text
src/__tests__/plan-generation-equipment.integration.test.ts
```

Root cause:

```text
AssertionError: NODE_ENV must be test for live DB-backed suite
actual: development
expected: test
```

Classification: environment guard / live DB-backed suite gating. Not a Conversational AI Coach workflow failure and not caused by the final safety closure.

## 16. BUILD RESULT

PASS.

Command:

```powershell
pnpm --filter @gym-coach/shared build
pnpm --filter @gym-coach/ai-service build
pnpm --filter @gym-coach/web build
```

Result:

```text
shared build: PASS
ai-service build: PASS
web build: PASS
```

Frontend build warning only:

```text
Some chunks are larger than 500 kB after minification.
```

No build failure.

## 17. ARTIFACT FRESHNESS

PASS.

Artifact timestamps:

```text
ai-lambda.zip          2026-09-15 22:58:27  37,096,949 bytes
ai-worker-lambda.zip   2026-09-15 22:58:27  37,096,949 bytes
ai-migrate-lambda.zip  2026-09-15 22:59:01  22,329,415 bytes
orchestrator.ts        2026-09-15 22:48:54
```

HTTP/worker artifacts are newer than the final safety source change and contain the final safety code:

```text
dist/agent-workflow/orchestrator.js in ai-lambda.zip        orchestratorFinalSafety=True
dist/agent-workflow/orchestrator.js in ai-worker-lambda.zip orchestratorFinalSafety=True
```

The later local TypeScript build refreshed `dist/` timestamps after the ZIPs, but ZIP content inspection confirmed the final safety closure is inside the artifacts. No rebuild is required for freshness.

## 18. ARTIFACT SECURITY

PASS WITH FALSE-POSITIVE NOTE.

ZIP entry inspection:

```text
ai-lambda.zip         entries=13,573 badEntries=0
ai-worker-lambda.zip  entries=13,573 badEntries=0
ai-migrate-lambda.zip entries=3,140  badEntries=0
```

No `.env`, repository `.git`, `dist/**/__tests__`, or compiled app `*.test.js` entries were found.

Required runtime entries:

```text
ai-lambda.zip:
  dist/lambda.js                                        present
  dist/worker-lambda.js                                 present
  dist/jobs-lambda.js                                   present
  dist/migrate-lambda.js                                present
  node_modules/@aws-sdk/client-bedrock-runtime           present
  node_modules/@opensearch-project/opensearch            present
  dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node present

ai-worker-lambda.zip:
  same as ai-lambda.zip

ai-migrate-lambda.zip:
  dist/migrate-lambda.js                                present
  prisma/schema.prisma                                  present
  prisma/migrations/**/migration.sql                    present
  node_modules/@prisma/engines/schema-engine-rhel-openssl-3.0.x present
```

A broad regex content scan produced hits in SDK/library source and documentation for strings like `password`, `aws_secret_access_key`, and sample `AKIA...` patterns. These are false positives from bundled npm packages and code paths that read environment/secret fields; no project `.env` or concrete secret material was packaged.

## 19. DATABASE MIGRATION DELTA

AWS DB migration required: YES, if not already applied to the AWS AI database.

Current AI Service migration directory count:

```text
24
```

Conversational workflow migrations present:

```text
20260915120000_agent_workflow_session
20260916090000_agent_workflow_session_active_unique
```

The final safety closure itself did not add a new migration beyond the existing workflow session/active-unique migrations.

AI migrate Lambda source now supports:

- `DATABASE_SECRET_ID`
- secret JSON fields: `username`, `password`, `host`, `port`, `database`
- guard requiring `database === "fitness_assistant_ai"`
- maintenance connection to `postgres`
- `CREATE DATABASE "fitness_assistant_ai"` only if absent
- `prisma migrate deploy --schema prisma/schema.prisma`

Source:

- `backend/services/ai-service/src/migrate-lambda.ts:1-30`
- `backend/services/ai-service/src/migrate-lambda.ts:106-138`
- `backend/services/ai-service/src/migrate-lambda.ts:155-183`
- `backend/services/ai-service/src/migrate-lambda.ts:192-209`

## 20. LAMBDA DEPLOYMENT DELTA

AI HTTP Lambda reupload required: YES if AWS currently has an older artifact.

AI Worker Lambda reupload required: YES if AWS currently has an older artifact.

AI Jobs Lambda reupload required: YES if AWS currently has an older artifact.

AI Migrate Lambda reupload required: YES before running current AI DB migrations, because the current migrate handler supports `DATABASE_SECRET_ID` and DB-create semantics.

Handlers:

```text
HTTP:    dist/lambda.handler
Worker:  dist/worker-lambda.handler
Jobs:    dist/jobs-lambda.handler
Migrate: dist/migrate-lambda.handler
```

## 21. FRONTEND DEPLOYMENT DELTA

Frontend S3/CloudFront reupload required: NOT REQUIRED by the final safety closure itself.

Reason: the safety closure changed backend AI workflow code, not frontend UI code. The web build still PASSed, so frontend can remain as-is unless AWS currently points at an older UI version intentionally being refreshed.

## 22. ENV/IAM DELTA

Required AI migration env:

```text
AWS_REGION=ap-southeast-1
DATABASE_SECRET_ID=fitness-assistant/dev/ai-database
```

Secret JSON must include:

```json
{
  "username": "<aurora-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_ai"
}
```

HTTP/worker env still required according to the current AWS AI service report: database secret/config, internal service secret, service URLs or direct service connectivity, LLM/Bedrock settings, vector store settings, and SQS settings.

IAM delta:

- Migration Lambda needs CloudWatch Logs, Secrets Manager read on `fitness-assistant/dev/ai-database*`, and VPC ENI permissions if attached to private subnets.
- HTTP/Worker/Jobs need the same baseline IAM previously documented; no new IAM permission was introduced by the final safety closure.

## 23. DOCUMENTATION CONSISTENCY

PASS.

Reviewed docs are consistent with current source/test outcomes:

- `docs/conversational-ai-coach-remediation-1.md`
- `docs/conversational-ai-coach-remediation-2.md`
- `docs/conversational-ai-coach-safety-closure.md`
- `docs/codex-conversational-ai-coach-evaluation-2.md`

One correction for older AI deployment docs: current `src/migrate-lambda.ts` now supports `DATABASE_SECRET_ID` and `CREATE DATABASE fitness_assistant_ai` if absent. The manual runbook below follows current source, not older notes.

## 24. EXACT AWS MANUAL RUNBOOK

Run order for owner in AWS Console, because final decision is READY:

1. Open AWS Console in `ap-southeast-1`.
2. In Secrets Manager, create or update:

   ```text
   fitness-assistant/dev/ai-database
   ```

   with `database` exactly:

   ```text
   fitness_assistant_ai
   ```

3. Upload `backend/services/ai-service/artifacts/ai-migrate-lambda.zip` to Lambda `fitness-assistant-dev-ai-migrate`.
4. Configure migration Lambda:

   ```text
   Runtime: Node.js 22.x
   Architecture: x86_64
   Handler: dist/migrate-lambda.handler
   Timeout: 300 seconds or higher
   Memory: 1024 MB or higher
   VPC: private app subnets that can reach Aurora
   Security group: outbound to Aurora PostgreSQL 5432
   Env:
     AWS_REGION=ap-southeast-1
     DATABASE_SECRET_ID=fitness-assistant/dev/ai-database
   ```

5. Give migration Lambda IAM permissions:

   ```text
   logs:CreateLogGroup
   logs:CreateLogStream
   logs:PutLogEvents
   secretsmanager:GetSecretValue on fitness-assistant/dev/ai-database*
   ec2:CreateNetworkInterface / DescribeNetworkInterfaces / DeleteNetworkInterface if VPC-attached
   ```

6. Invoke migration Lambda manually once with:

   ```json
   { "database": "fitness_assistant_ai" }
   ```

7. Confirm CloudWatch logs show `prisma migrate deploy` success and no refusal message.
8. Upload `backend/services/ai-service/artifacts/ai-lambda.zip` to Lambda `fitness-assistant-dev-ai`.
9. Configure HTTP Lambda:

   ```text
   Runtime: Node.js 22.x
   Architecture: x86_64
   Handler: dist/lambda.handler
   Timeout: 29 seconds
   Memory: 1024 MB or higher
   Env: existing AI HTTP env plus current DB/LLM/vector/SQS settings
   ```

10. Upload `backend/services/ai-service/artifacts/ai-worker-lambda.zip` to Lambda `fitness-assistant-dev-ai-worker`.
11. Configure Worker Lambda:

   ```text
   Handler: dist/worker-lambda.handler
   Trigger: SQS fitness-assistant-dev-ai-tasks
   Batch size: 1
   Report batch item failures: enabled
   Timeout: 300 seconds
   Env:
     QUEUE_PROVIDER=sqs
     AI_TASKS_QUEUE_URL=<real queue URL>
     LLM_TIMEOUT_MS=180000 or worker-safe equivalent
   ```

12. Configure Jobs Lambda if used:

   ```text
   Artifact: ai-lambda.zip
   Handler: dist/jobs-lambda.handler
   Timeout: 600 seconds
   EventBridge payloads as documented in AI_SERVICE_FINAL_AWS_CONFIG_REPORT_2026-09-08.md
   ```

13. Update API Gateway routes only after migration success. Do not expose `/internal/*` or `/metrics` publicly.
14. Smoke test authenticated AI Coach routes through the existing identity-injection path, not by sending raw user headers directly from public clients.
15. Monitor CloudWatch logs for:

   ```text
   finalize_revalidation
   workflow_target_weight_safety_rejected
   Prisma migration success
   Lambda errors/throttles
   ```

## 25. REMAINING FINDINGS

Non-blocking / operational:

- Repository worktree is dirty and contains many modified/untracked files from prior passes. Deployment should use the exact reviewed branch/artifacts or commit/tag them before handoff.
- Full AI-service suite has 3 classified environment-guard failures when run with `NODE_ENV=development`; run the live DB-backed equipment integration suite separately with `NODE_ENV=test` and a safe test DB before changing that classification.
- Frontend build has large chunk warnings; this is performance debt, not a sign-off blocker for backend AI workflow safety.
- Broad artifact regex scans include npm SDK/example false positives for credential-like names. No `.env`/`.git`/compiled app tests were packaged.

No remaining blocker was found in the Conversational AI Coach safety workflow itself.

## 26. FINAL SIGN-OFF

The Conversational AI Coach passes final independent sign-off for AWS deployment, provided the owner applies the exact manual migration/deployment runbook and does not skip the AI database migrations.

READY FOR AWS DEPLOYMENT
