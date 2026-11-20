# V-T012.2 — Independent Durability & Concurrency Review

Ngày: 2026-10-19. Reviewer: Codex. Scope: independent source/diff review, isolated synthetic verification, PostgreSQL verification only if positively identified. Production deployment: FORBIDDEN.

## 1. Executive verdict

**V-T012_2_CHANGES_REQUIRED**

82/82 requested scoped tests pass independently, and the additive schema validates. These results do not establish PostgreSQL durability. Docker's Linux-engine pipe is absent, no test PostgreSQL listener/container identity was verified: all required real PostgreSQL tests remain **ENVIRONMENT_BLOCKED**.

There are independently reproduced correctness defects beyond that environment gap:

- **D22-R01 / BLOCKER:** lease check/renew and plan mutation are separate operations. Worker A can pass the check, B can take over and complete, and A can then overwrite B's plan. Refusing A's operation finish does not undo the stale plan write.
- **D22-R02 / BLOCKER:** FAILED operations reopen under the same operationId with a new target. An old queued message can claim that reopened row, mutate the old plan and terminalize the new generation; the valid new message is then skipped.
- **D22-R03 / HIGH:** PUBLISHED operations with failed jobId attachment are not repaired by replay or recoverPendingGenerations; the polling API has no operationId fallback.
- **D22-R04 / HIGH:** chat initial keys collapse intentional same-parameter requests within a 20-minute window and split one retry crossing the boundary.

These were reproduced with actual orchestration/repository methods and deterministic fixture seams, **not real PostgreSQL**. Source ordering and absent predicates explain the failures; lack of DB access is not a reason to approve them. Recovery scheduling, real DB semantics and queue/Lambda runtime evidence also remain release prerequisites. No fixes, deployment or V-T003 implementation performed.

## 2. Source changes verified and repository baseline

START_HEAD = END_HEAD = 003545c6da8d524e8c4f6fbe4575444102f1fc50; branch aws-deploy. Start/end tracked diff: 28 files, 690 insertions, 222 deletions, including 7 generated Prisma files shown as binary by Git. Pre-existing status:

```text
 M backend/services/ai-service/package.json
 M backend/services/ai-service/prisma/schema.prisma
 M backend/services/ai-service/src/app.ts
 M backend/services/ai-service/src/controllers/plan.controller.ts
 M backend/services/ai-service/src/errors/api-error.ts
 M backend/services/ai-service/src/generated/prisma/edge.js
 M backend/services/ai-service/src/generated/prisma/index-browser.js
 M backend/services/ai-service/src/generated/prisma/index.d.ts
 M backend/services/ai-service/src/generated/prisma/index.js
 M backend/services/ai-service/src/generated/prisma/package.json
 M backend/services/ai-service/src/generated/prisma/schema.prisma
 M backend/services/ai-service/src/generated/prisma/wasm.js
 M backend/services/ai-service/src/middleware/auth.middleware.ts
 M backend/services/ai-service/src/middleware/rate-limit.middleware.ts
 M backend/services/ai-service/src/repositories/conversation.repository.ts
 M backend/services/ai-service/src/routes/ai.routes.ts
 M backend/services/ai-service/src/routes/fitness-agent.routes.ts
 M backend/services/ai-service/src/routes/marketplace.routes.ts
 M backend/services/ai-service/src/routes/plan.routes.ts
 M backend/services/ai-service/src/services/bedrock.client.ts
 M backend/services/ai-service/src/services/conversation.service.ts
 M backend/services/ai-service/src/services/fitness-agent.service.ts
 M backend/services/ai-service/src/services/nutrition.processor.ts
 M backend/services/ai-service/src/workers/ai.worker.ts
 M backend/services/auth-service/src/app.ts
 M backend/services/user-service/src/app.ts
 M backend/shared/src/index.ts
 M pnpm-lock.yaml
?? .dev/aws/scheduler-state.json.before-shutdown-20261019
?? .dev/aws/shutdown-20261019.json
?? backend/services/ai-service/prisma/migrations/20261019180000_ai_generation_operations/
?? backend/services/ai-service/src/__tests__/ai-endpoint-policy.test.ts
?? backend/services/ai-service/src/__tests__/bedrock-cross-account.test.ts
?? backend/services/ai-service/src/__tests__/generation-admission.test.ts
?? backend/services/ai-service/src/__tests__/generation-operations.test.ts
?? backend/services/ai-service/src/__tests__/helpers/
?? backend/services/ai-service/src/middleware/ai-rate-limiters.ts
?? backend/services/ai-service/src/middleware/require-trusted-service.middleware.ts
?? backend/services/ai-service/src/services/bedrock-credentials.ts
?? backend/services/ai-service/src/services/generation-admission.ts
?? backend/services/ai-service/src/services/generation-lease-context.ts
?? backend/services/ai-service/src/services/generation-operations.ts
?? backend/services/auth-service/src/__tests__/logger-redaction.test.ts
?? backend/services/user-service/src/__tests__/log-secret-hygiene.test.ts
?? backend/shared/src/log-safety.ts
?? docs/architecture/gymini-audit-verification/
?? docs/architecture/gymini-full-business-audit/
?? docs/architecture/gymini-implementation/
```

All listed source/migration/test/generated files are pre-existing work and were read-only to this review. Only docs/architecture/gymini-implementation/V-T012_2_INDEPENDENT_REVIEW.md created in repo. No reset/stash/clean/overwrite/commit/push. V-T001/V-T012/Bedrock/AWS changes preserved. Temporary schema/client artifacts outside repo were used for offline validation; no generated client in repo overwritten.

Read CLAUDE.md/project rules, applicable source-of-truth/scope/parallel/verification instructions, V-T012_2_IMPLEMENTATION_REPORT.md, V-T012_1_IMPLEMENTATION_REPORT.md and previous V-T012 independent review. Reports are historical evidence; source is authoritative.

Actual reviewed changes: AiGenerationOperation model/migration/generated metadata; generation-operations.ts/store; generation-lease-context.ts; conversation.service.ts and repository; plan.controller.ts keys; fitness-agent.service.ts propose/revise keys; worker/nutrition wrappers; admission/rate middleware/routes/error handling; both new generation test files and memory-operation-store helper. Existing execute()/confirmation state machine not modified.

Evidence labels: **CODE AUDIT**, **TEST FIXTURE**, **REAL HTTP/API** for scoped supertest routes with fake dependencies. No REAL BROWSER or real PostgreSQL BACKEND INTEGRATION. No sealed/heldout dataset read/hash/index/traversal, live provider inference, AWS/queue access, DEV/prod database access or migration application.

## 3. Migration/schema and generated client review

### Additive DDL: PASS by CODE AUDIT

prisma/schema.prisma:944–969 defines AiGenerationOperation mapped to ai_generation_operations. prisma/migrations/20261019180000_ai_generation_operations/migration.sql:2–26 creates one new table; :29–35 creates two nonunique indexes and one compound unique index. No ALTER/DROP of existing tables, no data UPDATE/backfill, no foreign key or existing row migration. Additive and non-destructive as written; actual application/locking/performance remain untested.

| Schema property | Observed definition |
|---|---|
| id | TEXT primary key, Prisma uuid() client-side default; no SQL UUID default, compatible with Prisma create |
| actor_user_id / idempotency_key | TEXT NOT NULL; unique pair actor+key |
| subject_user_id | nullable TEXT; no FK |
| kind/fingerprint/status | TEXT; status default RESERVING; no DB enum/CHECK restricting states |
| target_type/target_id/message_id/lease_owner/last_error | nullable TEXT |
| payload | nullable JSONB |
| attempt | INTEGER NOT NULL default 0; no DB CHECK for nonnegative/bounded values |
| timestamps | TIMESTAMP(3), nullable lease/published/completed; created_at default CURRENT_TIMESTAMP; updated_at required, Prisma @updatedAt supplies it |
| indexes | (status,updated_at), (target_type,target_id), UNIQUE(actor_user_id,idempotency_key) |

Status/target/lease invariants are enforced by application predicates only. Target index is not unique, there is no relation verifying a target Plan belongs to this operation. Random preassigned plan UUID plus existing Plan PK provides expected same-target insert uniqueness, but no real duplicate-insert test ran. JSON outbox content includes generation inputs; retention/privacy policy is still needed.

### Generated client / fresh generation

Installed generated Prisma client 5.22.0 exposes aiGenerationOperation delegate and compound unique metadata [actorUserId,idempotencyKey], with expected fields/defaults. Independent Prisma validate on a temporary copy passed, no DB connection. Fresh Prisma generate --no-engine into a separate temp project passed; AiGenerationOperation DMMF matched the repo client exactly. This proves generation/model compatibility only, not native query-engine loading, SQL behavior or deployed client packaging.

Temp project: C:/Users/ASUS/AppData/Local/Temp/gymini-vt0122-review-DQt6hX. Same schema except generator output points to temp client. Existing installed node_modules exposed through a temp junction; auto-install disabled on successful run. Existing source generated files untouched.

An initial generate attempt from the service cwd failed: Prisma reported loading its .env and attempted package auto-install because it inferred the temporary schema project root incorrectly. No env values were printed, no migration/query/model/AWS operation ran. Retried from the isolated temp project with PRISMA_GENERATE_SKIP_AUTOINSTALL=1, engine=none and local-only engine mirror. First failure is a tooling failure, not a schema PASS or application regression. No project source changes resulted.

### Ordering and rollback

Migration must be applied and generated client packaged before enabling producers/workers that use the table. Old code ignores the added table; new code without it fails. ai-service/scripts/package-lambda.ts:160–161 copies generated client; :226–233 copies schema/migrations into migration artifact. migrate-lambda.ts:195–205 uses prisma migrate deploy; it was only read, never invoked.

Rolling code back is schema-compatible but loses the new execution guard; already-published operations/messages require a drain/recovery plan. Do not describe dropping this table as harmless once records/payloads are in flight: it deletes coordination/outbox history. No rollback SQL is included or executed.

## 4. PostgreSQL environment and required test results

Actual docker-compose.test.yml: name gymcoach-test; postgres-test uses postgres:15-alpine, profile full, user gymcoach_test, database gymcoach_test, host port **55433**, dedicated postgres_test_data volume and gymcoach-test network. docker/test/postgres-init-test.sql creates gymcoach_ai_test plus other *_test databases. These are compose's test-only credentials/configuration, not proof a server is running.

Checked docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps with container ID/name/port output requested: failed because the pipe does not exist. No running container identity available. Get-NetTCPConnection showed no listener on 55433; Get-Command found no psql/postgres executable. Did not start DEV containers, start Docker Desktop or install another database. Starting only postgres-test would have been appropriate if the daemon and isolated service identity were available; that prerequisite failed.

No migration was applied to any database. No DB URL from a developer/production environment was used for test queries. Test children point to a deliberately nonserving 127.0.0.1:1/gymini_review_test URL and stub Prisma methods.

| Required real PostgreSQL verification | Result |
|---|---|
| Additive migration apply / existing-table compatibility | ENVIRONMENT_BLOCKED |
| 20-way createReserving / unique conflict | ENVIRONMENT_BLOCKED |
| Same key conflicting payload on real store | ENVIRONMENT_BLOCKED |
| Concurrent markAdmitted affected counts | ENVIRONMENT_BLOCKED |
| Concurrent worker claim / lease expiry takeover | ENVIRONMENT_BLOCKED |
| Real updateMany affected-row counts / lost update | ENVIRONMENT_BLOCKED |
| Concurrent finish/failure / stale finalization | ENVIRONMENT_BLOCKED |
| Duplicate Plan insert / P2002 recovery | ENVIRONMENT_BLOCKED |
| Transaction rollback | ENVIRONMENT_BLOCKED |
| Crash/retry reconstruction using persisted rows/new process | ENVIRONMENT_BLOCKED |

The 10-way memory create test and independent barrier probes below are explicitly TEST FIXTURE and do not replace these gates. No 20-way real DB PASS is claimed.

## 5. Operation identity assessment

Source: generation-operations.ts:190–213 canonical fingerprint/input contract; :263–299 submit; conversation.service.ts:134–164,208–239,284–300; plan.controller.ts:192–196; fitness-agent.service.ts:2133–2137,2256–2259.

| Requested scenario | Actual behavior / evidence |
|---|---|
| Same actor/key/payload | Reuses advanced operation, no second charge in normal flow; 20-test fixture suite |
| Same key/conflicting payload | 409 before quota for non-FAILED row; FAILED is a documented exception that accepts new fingerprint/reopens/charges |
| Different actors/same key | Separate unique namespaces; fixture verifies separation; real unique constraint behavior blocked |
| Same PT/different subjects | Low-level submit fingerprint includes subject, fixture expects conflict if the SAME key is reused; distinct keys needed for distinct client operations |
| Different revisions | New action/base-plan/params key normally creates new operation; tests verify distinct explicit keys |
| Chat retry across 20-minute boundary | **D22-R04:** same params, same session changes key; independently reproduced with real proposeNutritionPlan and fake Date.now |
| Intentional repeated same-params generation in window | **D22-R04:** distinct wording/intention yields same key when generation params match; independent key probe confirms collapse |
| REST retry without header | random auto:UUID each call; intentionally no deduplication contract, not a hidden exactly-once guarantee |
| Client-supplied key spoofing | Header scoped rest:<route-scope>:<key>, actor is authenticated context; does not grant ownership. Invalid header silently treated as absent (API hardening follow-up) |
| Concurrent identical keys | One reservation expected via unique + CAS; 10-way memory test passes; real 20-way PG uniqueness/CAS blocked |

Chat revision key includes base payload.planId; retry after the action row has advanced its base can also become a new operation even for the same revision message. That limitation is CODE AUDIT, not independently executed through a full chat/DB flow. Use stable turn/request/revision identity rather than a moving base alone.

Actual subject semantics differ from generic report examples: queuePlanGeneration sets actorUserId=userId and subjectUserId=ptUserId (:136). In the real REST contract, controller verifies the user's active PT and plan remains user-owned; subject here is PT metadata, not “client on behalf of PT”. Generic fixture actor/subject tests do not prove a real PT-on-client generation API. Preserve real relationship checks and define actor/beneficiary/coach meanings before V-T003 relies on the field.

Keys are not authorization; queuePlanAdjustment still checks owner/status before submit. Same-key replay fingerprint also contains dynamic clientName/derived original plan data, so mutable derived input can cause a 409 on an otherwise identical REST retry (source-level interface limit). Lifetime/retention of idempotency keys is undefined after terminal cleanup.

## 6. Quota admission and consistency

Nominal order: prismaOperationStore.createReserving :74–88 → d.admit :288 → markAdmitted :294 → ensure plan :239 → publish :242 → publication/plan job metadata :250–251. Every normal billable queued entry funnels through submitGeneration and ai-expensive admission; sync expensive routes keep middleware. 82 tests include REST↔chat shared budget and actor spoof cases. V12-R01's missing command quota has been corrected; do not reopen it merely because durability defects remain.

No quota-denied/outage operation becomes executable in the tested nominal paths: reservation deletion, no plan or publication. If deletion fails, a RESERVING placeholder remains nonexecutable until a charged retry. ADMITTED-or-later successful same-key replay normally does not charge again. FAILED reopen is explicitly a new charged generation, though current same-ID reuse is unsafe (R02).

PostgreSQL and DynamoDB do not share a transaction. A crash/DB failure after quota charge before markAdmitted can lose an allowance unit. Each stale-reservation retry must charge again. There is no strict global “at most one lost unit ever” bound across repeated crashes; it is per attempted admission. Quota is not refunded after ambiguous publish. Exactly-once billing/inference is **not** achieved or claimed here.

### Reservation-owner weakness — HIGH source finding D22-R05

Store :93 CASes updatedAt on takeover, but markAdmitted :104 predicates only id+RESERVING and deleteIfReserving :90 only id+RESERVING. A slow prior reserver can mark or delete the reservation after another request took over. The takeover marker is not carried into later transitions. Need a reservation owner/epoch or equivalent conditional predicate through admission/failure cleanup; don't delete a successor's reservation. No real DB interleaving was run for this finding.

Provider remains memory unless configured; target dynamodb/table/IAM remains DEPLOYMENT_NOT_VERIFIED. Fake DDB tests prove application fail-closed behavior for injected infrastructure errors, not live distributed accounting.

## 7. Outbox/recovery analysis

| State / crash point | Current behavior | Recovery actually available |
|---|---|---|
| RESERVING, crash before/after quota | Row persists, nonexecutable; stale same-key client can take over and charge again | Client retry only; sweeper does not select RESERVING |
| ADMITTED, before Plan creation | Durable target/payload available | Same-key replay or explicit recoverPendingGenerations invocation |
| ADMITTED, Plan exists/publish fails | 503; same operation/plan retained | Replay/manual sweeper republishes |
| Publish succeeds/markPublished ack fails | Row ADMITTED or already RUNNING; another publish may occur | Claim handles ordinary same-epoch duplicate; R02 limits this guarantee |
| PUBLISHED/attachJob fails | Warning swallowed; Plan.jobId may remain null | **R03: replay returns without repair; sweeper selects only ADMITTED** |
| RUNNING/crash before model | Lease eventually expires, but new delivery needed | Queue redelivery; no orphan RUNNING sweep |
| RUNNING/crash after paid inference | Same operation may invoke model again on takeover | At-least-once work, no exactly-once inference |
| Plan completed, process dies before operation finish | Operation may remain RUNNING, Plan already COMPLETED | Reclaim can overwrite PROCESSING and regenerate; no completed-result short circuit before model |
| COMPLETED | Redelivery acknowledged; same-key replay returns same target | No work, provided same operation incarnation |
| FAILED | Redelivery acknowledged; same key reopens same row/new target | **R02: delayed old messages are no longer distinguishable** |

recoverPendingGenerations :304–312 lists only stale ADMITTED (:159–160). No caller in server.ts/jobs-lambda.ts or scheduler/IaC was found; author correctly discloses it is not scheduled. A function and a test manually invoking it are not automatic recovery. With no client retry, stranded rows may remain indefinitely. Missing runner is an outstanding operational release dependency, not an instruction to deploy scheduler infrastructure during this review.

### D22-R03 — HIGH: incomplete published metadata reconciliation

Independent fixture: first publication mark succeeds; repository attachJob throws once. A subsequent same-key retry and explicit sweeper run leave operation PUBLISHED, planJobId=null, attachCalls=1, recovered=0. Code cause: advance :237 returns immediately for non-ADMITTED rows; :251 swallows attach failure. getJobStatus at plan.controller.ts:451 looks up Plan by jobId; SQS mode has no BullMQ fallback and :485–489 returns 404 when missing. A paid job can run while the client cannot poll it using the returned ID.

Related source race: worker can claim ADMITTED before markPublished; markPublished then returns false without storing messageId, yet later submit returns op.operationId as jobId (conversation.service.ts:164/300). Polling does not resolve that as an operation. Repair metadata for advanced states and return a stable resource/operation status reference; do not assume message ID == operation ID.

## 8. Worker fencing race analysis

### D22-R01 — BLOCKER: check-then-write is not fencing

Source: generation-lease-context.ts:26–30 awaits checker; generation-operations.ts:323 checker renews operation via store :138–143. Repository :593–608 then issues a separate Plan mutation filtered only by plan id. Same pattern at :464/:475/:497/:614; workout completion adds another independent lookup between check and write.

Smallest independently executed interleaving (no timing sleep; explicit promises + fake clock):

1. Worker A claims; actual updateNutritionPlanCompletion passes assertGenerationLeaseHeld and reaches Prisma update. Fixture pauses that call before applying Plan data.
2. Advance clock beyond renewed lease; B claims, writes {from:B}, and operation finishes COMPLETED.
3. Resume A's already-checked Plan update. It writes {from:A}; A's later finish returns false, but stale content is already committed to fixture Plan.

Observed: after B plan=B/op=COMPLETED; after A plan=A/op=COMPLETED. Actual method ordering exercised; store/Prisma were fixtures, so this is not a PostgreSQL reproduction. It exposes a real missing atomicity boundary irrespective of a passing memory test that places its barrier BEFORE lease validation.

Required minimal correction: short database transaction locking/conditionally updating the exact operation+incarnation+owner+unexpired lease AND mutating the bound Plan using the same transaction client. Every takeover/renew/finish/failure path must serialize on that operation row consistently. A transaction around a separate unlocked SELECT is insufficient. Do not hold the transaction across inference. Combine terminal Plan/operation persistence where appropriate or reconcile completed result before any repeated model invocation. Check affected-row counts and bind plan id/type/subject to the operation.

### D22-R02 — BLOCKER: FAILED reopen causes operation incarnation ABA

Source :97–102 resets target/attempt on the same row; submit :275–277 reopens it, then assigns a fresh plan UUID; publisher :242 includes operationId+planId but wrapper :340–364 validates/claims only operationId, never checks message target/kind/user/fingerprint against current row. Lease context carries operationId/token only.

Independent real orchestration/repository fixture:

1. Submit/execute operation O→old Plan P1, finish FAILED.
2. Retry same key, charge again, reuse O but assign new Plan P2 and publish new message.
3. Deliver the delayed OLD message O/P1. It wins O's new claim, writes P1 COMPLETED through real fenced repository method, while outcome lookup reads P2=QUEUED and marks O FAILED.
4. Deliver NEW message O/P2: terminal FAILED is acknowledged with no work.

Observed: charges=2; oldRuns=1; newRuns=0; oldPlan=COMPLETED; newPlan=QUEUED; operation=FAILED. No model/provider/queue network called. This is a stronger defect than ordinary duplicate billing: new legitimate work can be discarded because an old message aliases a new generation.

Minimal correction: give each charged generation an immutable incarnation (new immutable operation identity or version/epoch included in every message and all transitions), and reject old/mismatched deliveries before model or Plan write. Reopening a logical idempotency record must not reset an execution identity old messages still possess. Compare target/type/actor/subject and canonical stored job, not just existence of operationId. V-T003 should reference immutable execution incarnation, not a mutable operation row alone.

### Additional store predicates needing correction — D22-R05

claim :115–136 performs conditional update, then independent read; exhaustion later updates status/attempt but omits the observed lease/owner/expiry and ignores affected count before returning EXHAUSTED. A state change between observation and exhaustion can invalidate the decision. failTarget :325–331 is a separate unfenced Plan update after terminal transition; failure between the two leaves inconsistent operation/Plan status, and terminal redelivery does not repair it. Correct these in the same fenced transition strategy; don't treat every store method as a single atomic action because it contains updateMany somewhere.

## 9. Timeout/lease and queue/Lambda compatibility

Source defaults: lease 900s, max attempts 3, reservation timeout 60s (generation-operations.ts:164–175). No heartbeat timer; renewal happens only at repository writes. Worker wrapper checks claim before work; reentrant nutrition delegation shares context; legacy messages lacking operationId bypass the wrapper entirely (:342). It does not validate legacy message age or migration cutoff.

Nutrition model calls each have 180s timeout (:410/:431); two attempts plus data retrieval/validation/autosave can exceed one-call time. Workout timeout default 65–120s and retry <=60s; overrides up to 300s (ai.worker.ts:831–848). These suggest 900s may exceed common per-call durations, but total worst-case duration/default overrides, GC pauses and infrastructure interruptions are not proven < lease. If no write occurs long enough, takeover can run another model; R01 remains even when defaults make that uncommon.

worker-lambda.ts:76–106 returns batchItemFailures for thrown errors, including OperationInFlightError; terminal/exhausted/stale cases normally return success and are acknowledged. Duplicates contending while lease is live can consume SQS receive counts without consuming operation attempts. If a worker crashes early in a 900s lease and SQS visibility/redrive cycles are shorter, all messages may reach DLQ before takeover is possible. No automatic orphan sweep currently repairs that condition.

BullMQ add(name,data) has no explicit attempts/jobId; default single configured attempt is not a durable redelivery guarantee, and stalled jobs still matter. SQS visibility, redrive/maxReceiveCount/DLQ, actual Lambda timeout/concurrency, partial-batch response mapping and heartbeat policy are **DEPLOYMENT_NOT_VERIFIED**. Repository infra search found no authoritative target worker configuration establishing these relationships; hello Lambda timeout=10 is unrelated to AI worker and must not be used as its deployed timeout. Never called SQS/AWS.

Before release, verify actual total worker timeout/visibility/lease/attempt/redrive relationships, bounded renew/heartbeat policy, reconciliation and DLQ handling. No exactly-once billing claim is justified even after fencing correction.

## 10. Existing tests, negative evidence and build checks

| Run | Result | What it proves |
|---|---|---|
| generation-operations.test.ts | 20 PASS | Modelled store/clock/publication/lease cases, not PostgreSQL |
| generation-admission.test.ts | 12 PASS | Real routes/commands + fake DB/SQS, quota integration and converted gap assertions |
| ai-endpoint-policy.test.ts | 21 PASS | Auth/route/actor/quota policies with handler/transport seams |
| rate-limit.test.ts | 23 PASS | Memory and fake atomic DDB/HTTP limiter behavior |
| auth-middleware-token-rejection.test.ts | 6 PASS | Token-error classification |
| Combined five suites | **82 pass / 0 fail / 0 skipped**, exit 0, ~14.72s | Scoped only |
| Converted V12-R02 tests, current paired control | 3 pass / 0 fail, ~2.36s | Included already in 82, not extra unique cases |
| Same 3 tests, HEAD command overlay | 0 pass / 3 expected fail, ~2.52s | Negative counterfactual: duplicate publish, missing operation identity, no REST dedupe |
| Independent barrier/recovery/key fixtures | Defects reproduced, child exits 0 because assertions expected the defect | Not protection PASS; not DB verification |
| Prisma validate | PASS offline | Schema syntax/model consistency |
| Fresh Prisma client --no-engine | PASS on isolated retry | Client generation/DMMF only; initial auto-install attempt failed separately |
| Strict TS check of app, two processors and new test roots/transitive code | PASS, zero diagnostics/blocked-data reads | noEmit; no full package/archive/native engine claim |
| Real PostgreSQL/transaction/race tests | ENVIRONMENT_BLOCKED | No substitute PASS |
| Deployed DDB/SQS/Lambda/artifact | NOT_VERIFIED | No AWS/deploy |

Five-suite command from backend/services/ai-service:

```text
node <resolved tsx/cli> --test src/__tests__/generation-operations.test.ts src/__tests__/generation-admission.test.ts src/__tests__/ai-endpoint-policy.test.ts src/__tests__/rate-limit.test.ts src/__tests__/auth-middleware-token-rejection.test.ts
```

Synthetic minimal child env: NODE_ENV=test, LOG_LEVEL=silent, internal/JWT SYN_* secrets, DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/gymini_review_test?connect_timeout=1, REDIS_HOST=127.0.0.1/REDIS_PORT=1, LLM_PROVIDER=mock, EMBEDDING_PROVIDER=mock, AWS_EC2_METADATA_DISABLED=true, FITNESS_DISABLE_REDIS=true, TSX_DISABLE_CACHE=1; OS-required Windows path/temp vars. Suite overrides use their test-only secrets and stub transports. No real DB/Redis/model credentials inherited into test runners.

HEAD comparison used git show HEAD:backend/services/ai-service/src/services/conversation.service.ts in a child-only Module._extensions .ts overlay; current test was transpiled to CommonJS identically in both controls. Node --test-name-pattern=V12-R02 selects three assertions. No source checkout/replacement/stash. Other dependencies remain current, so this is not a whole historical V-T012.1 or 56-failure baseline. Failures observed were specifically sqs count 2 vs1 and missing operationId, not loader errors.

Author's prior 8 pass/56 fail DB results remain reported failures without comparable full baseline; no claim all are regressions or all environment-only. They were not re-run against an unavailable DB. Same for historical 283 failures.

### Assertion quality and blind spots

Tests contain meaningful state/counter checks, quota rejection cleanup, real route assertions, replay/conflict and fault injection. Two negative controls deliberately assert broken behavior (duplicate operations/worker runs); they pass as demonstrations, not as failing test-run totals. They do not validate real PG CAS. Memory helper makes each claim synchronous and combines read/decision/mutation, while Prisma claim uses update/read/possibly another update; it cannot represent all store races.

Stale test 13 pauses A BEFORE assertGenerationLeaseHeld, so it misses R01's AFTER-check window. FAILED reopen test 15b does not replay an old message after reopening, so misses R02. Existing action-save failure test stays in one time bucket and misses R04. There is no attachJob failure reconciliation test.

“No real model anywhere” test 20 installs its tripwire only within that test; earlier counters.models count synthetic run callbacks, not global provider calls. Reviewed earlier fixture callbacks do not invoke real models and mock provider/minimal env isolate the run, but its title overstates tripwire scope. No paid inference occurred in reviewer tests.

## 11. V-T003 integration requirements

GenerationOperation owns execution admission/outbox/attempt coordination. WorkoutPlan/NutritionPlan remains generated content/status owner. FitnessAgentAction/draft owns preview/confirmation intent, and V-T003 must own version/accepted snapshot integrity. Do not make operation payload a competing proposal or workflow engine.

Current queue command result drops operationId and chat stores only planId/jobId/phase/target/constraints (conversation.service.ts:164/300; fitness-agent.service.ts:2141–2147/2267–2271). V-T003 cannot reliably bind proposal version to immutable generation incarnation using this result contract yet. Add an explicit operation incarnation + plan/content version reference through internal results/draft payload; ownership and confirm eligibility must be revalidated against the exact completed Plan snapshot, not just operation.status.

Because operation/Plan can diverge (R01/R02/R03), COMPLETED row alone is not sufficient. Fence draft revision attachment against expected base version so two concurrent generated revisions cannot last-write-win over a newer proposal. Duplicate retries must reuse the same generation reference without rewriting accepted versions.

Existing execute()/PENDING→EXECUTING claim, release/finalize/stale reclaim unchanged. Future V-T003 owner fencing must coordinate its own transition, separate from generation worker fencing; do not move quota into generic confirm middleware. No schema/confirmation fix implemented in this review.

## 12. Confirmed blockers and release prerequisites

| ID | Severity / evidence | Release disposition |
|---|---|---|
| D22-R01 stale Plan write after check | BLOCKER / deterministic actual-method fixture + source | Correct atomic fencing before approval |
| D22-R02 old message aliases reopened generation | BLOCKER / deterministic orchestration fixture + source | Immutable incarnation + message binding required |
| D22-R03 PUBLISHED metadata unrecoverable | HIGH / injected attach failure + replay/sweeper + source | Reconciliation/status reference required |
| D22-R04 unstable/collapsing chat key | HIGH / actual key construction fixture | Stable request/turn/revision identity required |
| D22-R05 reservation/exhaustion/failure predicates | HIGH / CODE AUDIT; real races blocked | Complete owner/epoch CAS + transaction/count handling |
| Recovery runner absent | Operational release dependency / CODE AUDIT | Document and provide authorized runner/alerts before durable recovery claim |
| Real PG semantics/migration | ENVIRONMENT_BLOCKED | Run the required isolated PostgreSQL matrix after corrections |
| Target distributed quota/queue/lease config | DEPLOYMENT_NOT_VERIFIED | Read-only runtime evidence and integration before release |

Not approved for controlled deployment review. Source defects alone justify changes-required even if later DB tests pass the originally written fixture scenarios.

## 13. Non-blocking follow-ups

Document optional/malformed REST Idempotency-Key behavior; key/payload retention and terminal cleanup policy; explicit actor/subject naming; bounded legacy-message drain/cutoff; status reported as QUEUED on completed replay; stable operation-based status API rather than message-id aliases; validate positive finite lease/max-attempt/reservation env; minimize outbox payload/PII retention. These do not justify architecture rewrite.

External auto-save/downstream writes and crash-after-inference side effects need their owning idempotency boundaries; no universal exactly-once claim. Current no-op lease checker when context absent is intentional legacy behavior, not proof every worker write is protected.

## 14. Exact minimal correction plan

1. Make one short fenced persistence transaction for operation owner/incarnation/lease and bound Plan mutation, serializing with claim/takeover; fence terminal/failure transitions too and verify row counts. Never hold locks across model calls.
2. Preserve immutable execution incarnation across FAILED retries; include it + correct target/kind/actor in queue payload, validate against durable canonical operation before work. Old delivery must be safely ignored/rejected without terminalizing the new target.
3. Add reservation owner/epoch to takeOver/markAdmitted/delete cleanup; finish exhaustion and failTarget consistently under the same valid observed state. Reconcile completed Plan before any unnecessary model re-invocation.
4. Use stable REST/chat logical request identifiers. A chat retry keeps its turn ID across clock windows; a deliberate new generation uses a new turn/request ID even with identical params. Revision retries use explicit revision identity, not the current base alone.
5. Reconcile PUBLISHED/RUNNING/terminal metadata and stable status references; make attach failure replayable. Extend recovery selection/repair for genuinely abandoned states and provide an authorized scheduled runner/monitoring contract. No scheduler deployment during this review.
6. Then run real isolated PG migration/20-way uniqueness/CAS/rollback/Plan write races with deterministic barriers, including R01/R02/R03/R04 and reservation/exhaustion transitions; verify queue delivery/timeout/DLQ/provider evidence separately. Preserve fixture negative controls and avoid overwriting shared worktree sources for baselines.

Keep execute()/V-T003 state machine and existing auth/quota tier policy intact. No competing workflow engine or schema redesign required; targeted epoch/owner/atomicity corrections are sufficient directionally, subject to real DB proof.

## 15. Final acceptance gates

| Gate | Result | Concrete evidence |
|---|---|---|
| Additive schema correctness | PASS source | schema:944–969; migration CREATE TABLE + 3 indexes; offline validate/client metadata |
| Real PostgreSQL uniqueness | NOT_VERIFIED | 20-way/unique conflicts ENVIRONMENT_BLOCKED |
| Real PostgreSQL CAS semantics | NOT_VERIFIED | updateMany counts/transactions ENVIRONMENT_BLOCKED |
| Correct idempotency identity | FAIL | R02 incarnation ABA; R04 actual chat-key probe |
| Shared quota accounting | PARTIAL | 82 fixtures preserve admission; distributed gap + reservation fencing R05 |
| Durable outbox state | PARTIAL | Durable payload/target design; R03 metadata repair and RUNNING/Plan consistency missing |
| Automated recovery availability | FAIL | recoverPendingGenerations:304–312 only manual, no server/jobs/scheduler caller |
| Worker duplicate protection | PARTIAL | Ordinary fixture duplicate skipped; legacy bypass and reopened incarnation R02 |
| Worker fencing correctness | FAIL | R01 check-then-write overwrite; repository:601–608 |
| Lease/timeout compatibility | NOT_VERIFIED | 900s/3-attempt defaults source; deployed visibility/DLQ/Lambda unknown |
| Safe retries | FAIL | Old message suppresses new work; attach recovery and window identity failures |
| Legacy message compatibility | PARTIAL | :342 executes legacy; no fencing/drain guarantees or real queue test |
| Legitimate workflow compatibility | PARTIAL | 82 scoped tests; chat-repeat collapse, polling repair and real DB flows unverified |
| Deployment ordering | PARTIAL | Migration-first packaging source inspected; no apply/package/runtime ordering run |
| No data loss | FAIL | Fixture stale overwrite and skipped new target; no real production event claimed |
| No unauthorized side effects | PASS scoped | Reviewer source read-only, no DEV/prod DB/AWS/paid inference, one repo report |

Final recommendation: return one narrowly scoped correction pass for R01–R05 plus the named operational dependencies, then independent PostgreSQL-backed re-review. Do not close V-T012.2 or implement/deploy V-T003 from this review.

### Reproduction appendix — synthetic only

Each script ran through child Node -r <resolved tsx/cjs> -, cwd backend/services/ai-service, environment in section 10, script passed on stdin. Source files never changed. Fixtures replace operation storage/Prisma transport while invoking actual orchestration/repository functions; printed results are not database claims.

#### A. Barrier after lease check, before Plan mutation

```js
const assert=require('assert/strict');const ops=require('./src/services/generation-operations.ts');const {conversationRepository:repo,prisma}=require('./src/repositories/conversation.repository.ts');const {leaseStorage}=require('./src/services/generation-lease-context.ts');const {createMemoryOperationStore}=require('./src/__tests__/helpers/memory-operation-store.ts');const mem=createMemoryOperationStore();let clock=new Date('2026-10-19T10:00:00Z');const plans=new Map();const sent=[];Object.assign(ops.generationOpsDeps,{store:mem.store,now:()=>clock,leaseMs:()=>1000,maxAttempts:()=>3,admit:async()=>{},enqueue:async(n,data)=>{sent.push(data);return{id:'m-'+sent.length}}});repo.findNutritionPlanById=async(id)=>plans.get(id)||null;repo.createNutritionPlan=async(data)=>{plans.set(data.id,{...data,status:'QUEUED'});return data};repo.updateNutritionPlanJob=async()=>{};let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);prisma.nutritionPlan.update=async({where,data})=>{if(data.plan?.from==='A'){enter();await gate}Object.assign(plans.get(where.id),data);return plans.get(where.id)};const input={actorUserId:'synthetic-user',kind:'NUTRITION_PLAN',idempotencyKey:'test-stale-write-key',planCreate:{userId:'synthetic-user'},job:{userId:'synthetic-user'}};async function go(){const r=await ops.submitGeneration(input);const A=ops.withGenerationOperation({data:sent[0]},()=>repo.updateNutritionPlanCompletion(r.planId,{from:'A'}));await entered;clock=new Date(clock.getTime()+1001);await ops.withGenerationOperation({data:sent[0]},()=>repo.updateNutritionPlanCompletion(r.planId,{from:'B'}));const afterB={plan:plans.get(r.planId).plan.from,status:mem.rows.get(r.operationId).status};release();await A;const afterA={plan:plans.get(r.planId).plan.from,status:mem.rows.get(r.operationId).status};assert.equal(afterB.plan,'B');assert.equal(afterA.plan,'A');console.log(JSON.stringify({testFixture:true,afterB,afterA,staleOverwriteConfirmed:true}));}go().catch(e=>{console.error(e);process.exitCode=1});
```

#### B. Delayed old message after FAILED reopen

```js
const assert=require('assert/strict');const ops=require('./src/services/generation-operations.ts');const {conversationRepository:repo,prisma}=require('./src/repositories/conversation.repository.ts');const {createMemoryOperationStore}=require('./src/__tests__/helpers/memory-operation-store.ts');const mem=createMemoryOperationStore();const plans=new Map(),sent=[];let charges=0;Object.assign(ops.generationOpsDeps,{store:mem.store,admit:async()=>{charges++},enqueue:async(n,data)=>{sent.push(data);return{id:'m'+sent.length}}});repo.findNutritionPlanById=async id=>plans.get(id)||null;repo.createNutritionPlan=async data=>{plans.set(data.id,{...data,status:'QUEUED'});return data};repo.updateNutritionPlanJob=async()=>{};prisma.nutritionPlan.update=async({where,data})=>{Object.assign(plans.get(where.id),data);return plans.get(where.id)};const input={actorUserId:'synthetic-user',kind:'NUTRITION_PLAN',idempotencyKey:'test-epoch-key',planCreate:{userId:'synthetic-user'},job:{userId:'synthetic-user'}};async function go(){const old=await ops.submitGeneration(input);const oldMessage={...sent[0]};await ops.withGenerationOperation({data:oldMessage},async()=>{plans.get(old.planId).status='FAILED'});const retry=await ops.submitGeneration(input);let oldRuns=0,newRuns=0;await ops.withGenerationOperation({data:oldMessage},async()=>{oldRuns++;await repo.updateNutritionPlanCompletion(oldMessage.planId,{from:'old-delivery'})});await ops.withGenerationOperation({data:sent[1]},async()=>{newRuns++;await repo.updateNutritionPlanCompletion(retry.planId,{from:'new-delivery'})});assert.equal(old.operationId,retry.operationId);assert.notEqual(old.planId,retry.planId);assert.equal(oldRuns,1);assert.equal(newRuns,0);console.log(JSON.stringify({testFixture:true,charges,sameOperationId:true,differentPlanTargets:true,oldRuns,newRuns,oldPlan:plans.get(old.planId).status,newPlan:plans.get(retry.planId).status,operation:mem.rows.get(retry.operationId).status}));}go().catch(e=>{console.error(e);process.exitCode=1});
```

#### C. PUBLISHED attach failure not repaired

```js
const assert=require('assert/strict');const ops=require('./src/services/generation-operations.ts');const {conversationRepository:repo}=require('./src/repositories/conversation.repository.ts');const {createMemoryOperationStore}=require('./src/__tests__/helpers/memory-operation-store.ts');const mem=createMemoryOperationStore(),plans=new Map();let clock=new Date('2026-10-19T10:00:00Z'),attachCalls=0,publishes=0;Object.assign(ops.generationOpsDeps,{store:mem.store,now:()=>clock,admit:async()=>{},enqueue:async()=>({id:'m-'+(++publishes)})});repo.findNutritionPlanById=async id=>plans.get(id)||null;repo.createNutritionPlan=async d=>{plans.set(d.id,{...d,status:'QUEUED',jobId:null});return d};repo.updateNutritionPlanJob=async()=>{attachCalls++;throw Error('synthetic attach failure')};const input={actorUserId:'synthetic-user',kind:'NUTRITION_PLAN',idempotencyKey:'test-recovery-key',planCreate:{userId:'synthetic-user'},job:{userId:'synthetic-user'}};async function go(){const first=await ops.submitGeneration(input);repo.updateNutritionPlanJob=async(id,jobId)=>{attachCalls++;plans.get(id).jobId=jobId};const retry=await ops.submitGeneration(input);clock=new Date(clock.getTime()+120000);const recovery=await ops.recoverPendingGenerations();assert.equal(attachCalls,1);assert.equal(plans.get(first.planId).jobId,null);console.log(JSON.stringify({testFixture:true,operation:mem.rows.get(first.operationId).status,firstJob:first.jobId,retryJob:retry.jobId,attachCalls,planJobId:plans.get(first.planId).jobId,publishes,recovery}));}go().catch(e=>{console.error(e);process.exitCode=1});
```

#### D. Actual chat key across boundary / intentional repeat

```js
const assert=require('assert/strict');const {fitnessAgent:agent,fitnessAgentDeps:d}=require('./src/services/fitness-agent.service.ts');const {conversationService}=require('./src/services/conversation.service.ts');const {prisma}=require('./src/repositories/conversation.repository.ts');const {llmService}=require('./src/services/llm.service.ts');const captured=[];let fakeTime=Date.parse('2026-10-19T10:19:59.999Z');Date.now=()=>fakeTime;llmService.getHealthStatus=async()=>({llmAvailable:true});d.tools.getNutritionTargetPreview=async()=>({status:'ACTIVE_GOAL',goalId:'goal',calories:2000,protein:125,carbs:250,fat:56});d.tools.getNutritionActiveState=async()=>null;d.profileExtractor.extract=async()=>({profile:{goal:'MAINTENANCE',currentWeightKg:70,heightCm:175,age:30,gender:'MALE',activityLevel:'MODERATE'}});conversationService.queueNutritionPlanGeneration=async(params)=>{captured.push(params);return {planId:'SYN_PLAN',jobId:'SYN_JOB'}};prisma.fitnessAgentAction.create=async()=>({id:'SYN_ACTION'});prisma.fitnessAgentAction.update=async()=>({});async function go(){const identity={userId:'verified-synthetic-user'};await agent.proposeNutritionPlan('tao thuc don',identity,'synthetic-session');await agent.proposeNutritionPlan('tao lai thuc don moi',identity,'synthetic-session');const collapsed=captured[0].idempotencyKey===captured[1].idempotencyKey;fakeTime+=2;await agent.proposeNutritionPlan('tao thuc don',identity,'synthetic-session');const boundarySplit=captured[0].idempotencyKey!==captured[2].idempotencyKey;assert(collapsed);assert(boundarySplit);console.log(JSON.stringify({testFixture:true,intentionalSameParamsCollapsed:collapsed,retryAcrossBoundarySplit:boundarySplit,keys:captured.map(p=>p.idempotencyKey)}));}go().catch(e=>{console.error(e);process.exitCode=1});
```
