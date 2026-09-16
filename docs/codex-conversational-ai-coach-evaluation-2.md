# GYMINI Conversational AI Coach — Independent Evaluation #2

Date: 2026-09-15. Evaluator: Codex independent reviewer.

No AWS deployment was performed. No production code was fixed. No assertions were weakened.

## 1. DECISION

RETURN TO CLAUDE.

Remediation #1 fixed the two original high-risk production behaviors from Evaluation #1 in the currently audited runtime path: `PROFILE_FACT` use-once is rejected server-side, and unsafe target weight is rejected before write/resume.

However, Evaluation #2 found two dynamic parser release-gate failures still present in current compiled code:

- `parseTrainingDays("thứ 2 - thứ 4 - thứ 6")` returns `[1]`, expected `[1,3,5]`.
- `parseMinutes("1.5 giờ")` returns `no_number_found`, expected canonical minutes.

Therefore the final sign-off cannot be `READY FOR AWS DEPLOYMENT`.

## 2. EVALUATION #1 FINDINGS → #2 STATUS

- PROFILE_FACT use-once accepted: fixed in current source/runtime.
- Unsafe target weight 180cm/80kg → 30kg accepted: fixed in current source/runtime.
- Initial multi-slot ignored: fixed in current evaluator/runtime for cued Vietnamese input.
- Correction before confirm misread: fixed for `"Không, 70 kg"` and inline `"72 kg... à không 70 kg"`.
- Active workflow invariant missing: fixed by raw SQL partial unique index migration and verified in local dev/test DBs.
- FIND_PT dot-thousands parser: fixed for `1.500.000` and related forms.
- Training-day hyphenated phrase: still failing.
- Decimal-hour duration: still failing.

## 3. PROFILE_FACT USE-ONCE

Evidence label: BACKEND INTEGRATION + CODE AUDIT + FRONTEND CODE AUDIT.

Command:

```text
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow/evaluate_conversational_workflow.ts
```

Result:

```text
PASS 19 / FAIL 0 / INFO 1 / BLOCKED 0
```

Dynamic cases passed:

- `use-once-goal`
- `use-once-targetWeight`
- `use-once-age`
- `use-once-heightCm`
- `use-once-currentWeight`
- `use-once-gender`

Observed behavior: the server returns the message requiring profile persistence, performs zero `updateProfileFields` calls, does not start the business action, and keeps workflow status `AWAITING_SLOT_CONFIRMATION`.

Source audited:

- `backend/services/ai-service/src/agent-workflow/types.ts`: `allowsUseOnce()` returns false for `PROFILE_FACT`.
- `backend/services/ai-service/src/agent-workflow/orchestrator.ts`: rejects use-once for profile facts before write/resume.
- `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`: use-once button is rendered only when `block.allowUseOnce !== false`; profile fact blocks can suppress it.
- `frontend/web/src/app/services/fitnessAgent.ts`: block type includes `allowUseOnce`.

## 4. TARGET-WEIGHT SAFETY

Evidence label: BACKEND INTEGRATION + CODE AUDIT.

Dynamic result: `unsafe-target-weight-accepted` now PASS.

Scenario: height `180cm`, current weight `80kg`, goal `WEIGHT_LOSS`, target `30kg`.

Observed:

- No confirmable profile-update block.
- `targetWeight` remains null.
- `updateProfileFields` not called.
- Roadmap generation not resumed.

Source audited:

- `backend/services/ai-service/src/agent-workflow/target-weight-safety.ts`
- `backend/services/ai-service/src/agent-workflow/workflows/roadmap.workflow.ts`
- `backend/services/ai-service/src/agent-workflow/orchestrator.ts`

Safety is deterministic application code using BMI/goal-direction checks, not LLM judgment.

## 5. PRE-WRITE SAFETY

Evidence label: BACKEND INTEGRATION + CODE AUDIT.

Command:

```text
pnpm --filter @gym-coach/ai-service exec tsx --test src/__tests__/agent-workflow-remediation-1.test.ts src/__tests__/agent-workflow-roadmap-e2e.test.ts src/__tests__/agent-workflow-program-e2e.test.ts src/__tests__/agent-workflow-security-e2e.test.ts
```

Result:

```text
19 tests / 19 pass / 0 fail
```

The remediation test `safety re-runs immediately before write using fresh context` passed. Source audit confirms `handleConfirmationReply()` refetches authoritative context and reruns `validateContext` before `updateProfileFields()`.

## 6. CORRECTION HANDLING

Evidence label: BACKEND INTEGRATION + PARSER CODE AUDIT.

Dynamic evaluator case `correction-before-confirm` passed:

- proposed `72kg`
- reply `"Không, 70 kg"`
- response block: `PROFILE_UPDATE_CONFIRMATION`
- pending update changed to `targetWeight=70`
- profile write count: 0

Parser check from compiled code:

```text
parseWeightKg("72 kg... à không 70 kg") -> 70
```

## 7. MULTI-SLOT EXTRACTION

Evidence label: BACKEND INTEGRATION + CODE AUDIT.

Dynamic evaluator case `initial-message-multislot-ignored` passed for:

```text
Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, 80kg, mục tiêu 72kg.
```

Observed `slotsJson` included:

```json
{
  "age": 25,
  "goal": "WEIGHT_LOSS",
  "heightCm": 175,
  "targetWeight": 72,
  "currentWeightKg": 80
}
```

Remediation tests also passed for ambiguous `"80, 72"`: no unsafe current/target assignment by guessing.

## 8. BUDGET PARSER

Evidence label: COMPILED PARSER CHECK + BACKEND INTEGRATION.

Compiled parser results:

```text
1500000       -> 1500000
1.5 triệu     -> 1500000
1.500.000     -> 1500000
1,500,000     -> 1500000
1tr5          -> 1500000
1tr500        -> 1500000
1 triệu 500   -> 1500000
```

Real workflow dispatch evidence: evaluator `find-pt-dedicated-e2e` passed and `findPTCandidates` received `budgetVnd = 1500000` after the user replied `"1.500.000"`.

## 9. NO-CAP BUDGET

Evidence label: BACKEND INTEGRATION + COMPILED PARSER CHECK.

Compiled parser alone returns `no_number_found` for:

- `không giới hạn`
- `ngân sách không quan trọng`
- `không quan trọng giá`

But the FIND_PT workflow layer handles the product phrase separately. Dynamic evaluator case `find-pt-unlimited-budget-traps-user` passed:

- no infinite identical question loop;
- not parsed as `0`;
- not parsed as fake huge integer;
- no profile data persisted;
- `findPTCandidates` called without a numeric `budgetVnd`.

Classification: acceptable bounded product behavior, not a release blocker.

## 10. TRAINING DAYS

Evidence label: COMPILED PARSER CHECK.

Command:

```text
node -e "... require('./backend/services/ai-service/dist/agent-workflow/slot-values.js') ..."
```

Results:

```text
T2 T4 T6                 -> [1,3,5] PASS
thứ 2 4 6                -> [1,3,5] PASS
thứ 2, 4, 6              -> [1,3,5] PASS
thứ 2 - thứ 4 - thứ 6    -> [1] FAIL
```

This is a current dynamic failure against a required Evaluation #2 case.

## 11. DURATION

Evidence label: COMPILED PARSER CHECK.

Results:

```text
60 phút    -> 60 PASS
90 phút    -> 90 PASS
1 giờ      -> 60 PASS
1 tiếng    -> 60 PASS
1.5 giờ    -> no_number_found FAIL
```

`1.5 giờ` should canonicalize to minutes; current compiled behavior rejects it.

## 12. ACTIVE-WORKFLOW DB INVARIANT

Evidence label: DATABASE QUERY + BACKEND INTEGRATION + MIGRATION CODE AUDIT.

Migration audited:

```text
backend/services/ai-service/prisma/migrations/20260916090000_agent_workflow_session_active_unique/migration.sql
```

SQL behavior:

- cancels duplicate non-terminal historical rows by setting older duplicates to `CANCELLED`;
- creates partial unique index on `(user_id, session_id)`;
- terminal states excluded: `COMPLETED`, `CANCELLED`, `EXPIRED`.

Direct DB verification:

```text
docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d gymcoach_ai_test ...
docker exec gymcoach-postgres psql -U gymcoach -d gymcoach_ai ...
```

Both returned:

```text
agent_workflow_sessions_one_active_per_session
CREATE UNIQUE INDEX ... WHERE status <> ALL (ARRAY['COMPLETED','CANCELLED','EXPIRED'])
```

Dynamic concurrency test: 20 concurrent starts produced exactly one active row.

## 13. CONCURRENT CONFIRM

Evidence label: BACKEND INTEGRATION + CODE AUDIT.

Source audited:

- `workflow-state.repository.ts`: `claimForWrite()` performs conditional status transition `AWAITING_SLOT_CONFIRMATION -> WRITING`.
- `orchestrator.ts`: losing requests receive an in-progress message and do not call `updateProfileFields`.
- failed write path calls `releaseClaimAfterFailedWrite()` to restore recoverability.

Regression suite `agent-workflow-remediation-1.test.ts` passed. I did not see a separate console line naming the two-confirm scenario in the truncated output, so this is accepted only as source-backed + suite-covered, not independently isolated as a single manual case.

## 14. STALE / EXPIRY / FAILED-WRITE

Evidence label: BACKEND INTEGRATION.

Evaluator cases passed:

- `stale-profile-confirm-rejected`
- `expired-confirm-no-write`
- `failed-profile-write-does-not-resume`

Observed stale behavior: old proposal did not overwrite changed authoritative value.

Observed expiry behavior: profile writes = 0, workflow status = `EXPIRED`.

Observed failed-write behavior: roadmap/program resume = 0, workflow remains `AWAITING_SLOT_CONFIRMATION`.

## 15. SECURITY

Evidence label: BACKEND INTEGRATION + CODE AUDIT.

Regression command passed 19/19 across remediation, roadmap, program and security E2E files.

Covered:

- cross-user workflow isolation;
- business-state injection;
- arbitrary profile field injection;
- prompt-injection-shaped reply while pending.

Attacks such as `set contract ACTIVE`, `set role ADMIN`, and `mark payment PAID` are not valid profile slots and cannot bypass profile/action confirmations through the audited workflow path.

## 16. PT TWO-STEP

Evidence label: BACKEND INTEGRATION.

Evaluator case `pt-search-to-hire-two-step` passed.

Verified path:

```text
PT_RECOMMENDATIONS
-> candidate selected
-> CREATE_PT_CONTRACT_DRAFT confirmation
-> explicit confirmation
-> CONFIRM_PT_CONTRACT confirmation
-> explicit confirmation
-> ACTION_RESULT
```

No one-step hire bypass reproduced.

## 17. ROADMAP FLAGSHIP

Evidence label: BACKEND INTEGRATION.

`CREATE_ROADMAP flagship E2E` passed:

- asks only missing slot;
- zero writes before confirm;
- persists once;
- auto-resumes without repeating original request;
- supports draft-only revision;
- final execute is single-confirmed.

The evaluator also passed `roadmap-flagship-confirm-resume`.

## 18. DATABASE MIGRATION

Evidence label: MIGRATION CODE AUDIT + DB QUERY.

AWS DATABASE MIGRATION REQUIRED = YES.

Exact migration to deploy:

```text
backend/services/ai-service/prisma/migrations/20260916090000_agent_workflow_session_active_unique
```

Migration review:

- `DROP TABLE`: none
- `DROP COLUMN`: none
- `TRUNCATE`: none
- `DELETE`: none
- Unsafe history deletion: none
- Duplicate cleanup: non-destructive `UPDATE ... SET status = 'CANCELLED'` for older duplicate active rows

This migration is required before deploying remediated concurrent workflow behavior to AWS AI database.

## 19. FULL REGRESSION RESULTS

Evidence label: TEST FIXTURE + BACKEND INTEGRATION.

Targeted workflow regression:

```text
pnpm --filter @gym-coach/ai-service exec tsx --test src/__tests__/agent-workflow-remediation-1.test.ts src/__tests__/agent-workflow-roadmap-e2e.test.ts src/__tests__/agent-workflow-program-e2e.test.ts src/__tests__/agent-workflow-security-e2e.test.ts
```

Result:

```text
19 pass / 0 fail
```

Memory/claim/program scoring regression:

```text
pnpm --filter @gym-coach/ai-service exec tsx --test src/llm/__tests__/memory_extraction.test.ts src/llm/__tests__/memory_policy.test.ts src/llm/__tests__/recommendation_claims.test.ts src/llm/__tests__/program_recommendation_claims.test.ts src/__tests__/training-program-scoring-v2.test.ts
```

Result:

```text
76 pass / 0 fail
```

AI service build:

```text
pnpm --filter @gym-coach/ai-service build
```

Result: PASS.

Full ai-service test:

```text
pnpm --filter @gym-coach/ai-service test
```

Status: BLOCKED/HUNG. It emitted early passing tests and provider-unreachable fallback logs, then produced no more output for several minutes; I interrupted it. This is not counted as PASS.

## 20. FRONTEND

Evidence label: FRONTEND CODE AUDIT + BUILD.

Build command:

```text
pnpm --filter @gym-coach/web build
```

Result: PASS.

Build output includes:

```text
dist/assets/FitnessAgentBlocks-DbMgpdV5.js
dist/assets/AICoachPage-DjNazrin.js
```

Code audit:

- `PROFILE_UPDATE_CONFIRMATION` supports `allowUseOnce`.
- `FitnessAgentBlocks.tsx` suppresses the use-once button when `allowUseOnce === false`.
- Request path remains through existing frontend fitness agent service path; no real browser test was run.

## 21. ARTIFACT AUDIT

Evidence label: ZIP CONTENT AUDIT + TIMESTAMP AUDIT.

Artifacts:

```text
backend/services/ai-service/artifacts/ai-lambda.zip          37,083,461 bytes, mtime 2026-09-15 21:57:00
backend/services/ai-service/artifacts/ai-worker-lambda.zip   37,083,461 bytes, mtime 2026-09-15 21:57:00
backend/services/ai-service/artifacts/ai-migrate-lambda.zip  22,329,415 bytes, mtime 2026-09-15 21:57:35
```

Source timestamps checked:

```text
orchestrator.ts             2026-09-15 21:45:16
target-weight-safety.ts     2026-09-15 21:10:47
slot-values.ts              2026-09-15 21:09:01
FitnessAgentBlocks.tsx      2026-09-15 21:28:07
```

Artifact content audit:

- `ai-lambda.zip`: contains `dist/lambda.js`, `dist/worker-lambda.js`, `dist/jobs-lambda.js`, `dist/migrate-lambda.js`, and current `dist/agent-workflow/*`.
- `ai-worker-lambda.zip`: same workflow code present.
- `ai-migrate-lambda.zip`: migration artifact does not need workflow runtime code.
- `.env`: not present.
- root `.git`: not present. Some third-party npm package metadata contains `.github`/`.gitkeep`, not repo `.git`.
- compiled service tests under `dist/**/__tests__` / `dist/**/*.test.js`: not present by ZIP scan.

Conclusion:

- AI HTTP Lambda artifact rebuild required: NO, artifact is newer than audited remediation source and contains workflow code.
- AI Worker artifact rebuild required: NO.
- AI Jobs artifact rebuild required: NO.
- AI migrate artifact rebuild required: NO for packaging freshness, but AWS DB migration must still be run.

## 22. AWS DEPLOYMENT DELTA

Because the decision is `RETURN TO CLAUDE`, do not deploy.

If/when parser failures are fixed and re-evaluated:

A. AI DATABASE: run migration `20260916090000_agent_workflow_session_active_unique` if not already applied to AWS AI DB.

B. AI HTTP LAMBDA: upload new ZIP only if source changes after the audited artifact timestamp.

C. AI WORKER: upload new ZIP only if source changes after the audited artifact timestamp.

D. AI JOBS: upload new ZIP only if source changes after the audited artifact timestamp.

E. FRONTEND: Vite dist would need re-upload to S3 after the frontend build if sign-off later passes.

F. ENV/IAM: no new env/IAM requirement found specifically for Remediation #1 beyond the existing AI Lambda/Aurora/OpenSearch/Bedrock setup.

## 23. REMAINING FINDINGS

P0 release-gate:

- Training-days parser fails the required `"thứ 2 - thứ 4 - thứ 6" -> [1,3,5]` case.
- Duration parser fails the required `"1.5 giờ" -> canonical minutes` case.

P1:

- Current evaluator is named Evaluation #1 and still outputs `"decision": "RETURN_TO_CLAUDE"` even when cases pass. This is confusing for release operations, although not itself runtime behavior.
- Running evaluator through `pnpm --filter @gym-coach/ai-service exec ...` makes its migration-directory check BLOCKED due cwd path duplication. Running from repo root passes.

P2:

- Full `pnpm --filter @gym-coach/ai-service test` hung in this environment and was interrupted. Targeted release-gate suites passed, but full-suite status is not a clean PASS.

## 24. EVIDENCE QUALITY

- BACKEND INTEGRATION: used for workflow tests/evaluator with real local DB and mocked service dependencies.
- DATABASE QUERY: used for actual partial unique index verification in dev/test Postgres containers.
- CODE AUDIT: used for frontend/server enforcement paths and migration review.
- COMPILED PARSER CHECK: used for exact parser edge cases from current `dist`.
- FRONTEND BUILD: used for Vite production build.
- ZIP CONTENT AUDIT: used for AWS artifact freshness/content.
- REAL BROWSER: not used.
- REAL AWS: not used.

## 25. FINAL SIGN-OFF

Not signed off. Remediation #1 fixed the original two high-risk issues, but current source still fails two required parser cases in Evaluation #2.

RETURN TO CLAUDE

