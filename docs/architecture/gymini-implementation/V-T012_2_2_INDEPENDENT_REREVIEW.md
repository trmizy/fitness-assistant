# V-T012.2.2 — Independent re-review & release gate assessment

Ngày 2026-10-19 (Asia/Saigon). Reviewer: Codex. Phạm vi: read-only source review, scoped regression, offline probes. **Deployment authorization: NONE.**

## 1. Executive verdict

**`V-T012_2_2_CHANGES_REQUIRED`**

Không duyệt controlled-deployment review. RR-03 được sửa ở mức source/validator; RR-02 thay đổi đúng cấu trúc transaction và có regression fixture; RR-01 chỉ sửa một phần contract, chưa đạt retry idempotency tại UI thực tế. Có counterexample độc lập dù toàn bộ 135 scoped tests pass.

| Hạng mục | Kết luận độc lập |
|---|---|
| RR-01: request identity | PARTIAL; UI không tái sử dụng ID khi gửi lại; relative revision retry trả nhầm conflict; FAILED cho phép đổi payload |
| RR-02: terminal recovery | Source correction + fixture PASS; PostgreSQL atomicity/locking/rollback NOT_VERIFIED |
| RR-03: BullMQ ID | PASS validator BullMQ 5.66.5 và adapter fixture; enqueue/dedup qua Redis ENVIRONMENT_BLOCKED |
| Scoped regression | 135 PASS, 0 FAIL, 0 SKIPPED; không phải full repository regression |
| ai-service TypeScript | PASS, `tsc --noEmit`, exit 0 |
| Frontend production bundle | PASS, Vite 6.3.5, 6,149 modules, exit 0; không phải semantic TypeScript check/REAL BROWSER |
| PostgreSQL integration | **POSTGRESQL_INTEGRATION_ENVIRONMENT_BLOCKED** |
| AWS runtime configuration | NOT_VERIFIED trong review này; không truy cập AWS |

### Baseline và bảo toàn working tree

- Worktree: `C:\D_Backup\project_personal\fitness-assistant`; branch `aws-deploy`.
- START_HEAD = END_HEAD: `003545c6da8d524e8c4f6fbe4575444102f1fc50`. HEAD lịch sử không bao gồm V-T012 uncommitted.
- Đã đọc AGENTS.md/CLAUDE.md, implementation report V-T012.2.2, independent review V-T012.2.1 và skills parallel-agent-safety, real-e2e-verification, scope-control, domain-source-of-truth, cross-system-journey, account-session-isolation.
- Baseline: 33 tracked modified paths; 22 untracked status entries (Git gộp các directory). Tracked modifications gồm ai-service package/schema/generated client/app/controllers/errors/jobs/auth/rate/repository/routes/schema/services/worker/queue, auth/user app, shared logger/index, frontend `AIPlansPage.tsx`/`api.ts`, lockfile. Untracked có sẵn gồm hai migrations, operation/admission/identity/lease services, tests/helpers, Bedrock credentials, logger work, audit/implementation directories, shutdown/scheduler evidence. Tất cả là input read-only.
- Không reset/clean/stash/checkout/commit/push; không sửa source/generated client/migration/test/config/report cũ. Chỉ thêm báo cáo này. Vite output đặt dưới `%TEMP%`, không ghi `frontend/web/dist`.
- Không gọi AWS/DEV/prod DB, không paid inference, không queue người dùng, không đọc/traverse heldout/sealed/eval data. Việc khởi động AWS ở lượt trước không phải evidence cho cấu hình V-T012 hiện tại.
- SHA256 `git diff --binary` trước khi tạo báo cáo: `f491a4ddad23a53091bfcb69f795a9e227d96945239992a8afcd842e1e3852c8`.
- Kiểm tra cuối: HEAD và tracked diff SHA256 giữ nguyên; hashes của generation-operations, request-identity, generation-operations test và pendingAiTasks cũng không đổi. Báo cáo đủ 13 sections; report nằm trong untracked implementation directory có sẵn nên Git status tiếp tục gộp directory đó.

## 2. RR-01 — Source/test verification

### Trace thực tế — CODE AUDIT

`pendingAiTasks.ts:509 sendQuestion` → `coachService.chat`/`chatStream` (`api.ts:3580,3624`) → POST `/ai/ask` hoặc `/ai/ask/stream` → `requireAuth`, ask limiter, `validateBody(AskRequestSchema)`, `bindRequestIdentity` (`ai.routes.ts:37–50`) → controller dùng `req.context.userId` → `ragService.rag` kiểm session owner → orchestrator/fitness agent → `nutritionGenerationKey` (`fitness-agent.service.ts:74`) → `queueNutritionPlanGeneration` → `submitGeneration` → quota admission → plan/outbox → enqueue.

`request-identity.ts:21` dùng AsyncLocalStorage.run, không phải global mutable ID. Valid ID sinh `chat:req:<id>`; unique `(actor_user_id,idempotency_key)` và fingerprint chứa kind, subject, planCreate, job. ID không cấp quyền và không thay verified actor. Client body userId không điều khiển quota. Session read kiểm owner/archived; nutrition target/profile dùng verified identity. Scoped auth/spoofing tests pass; không có REAL BROWSER account-switch/PT relationship verification mới.

Axios 401 interceptor gửi lại `originalRequest` (`api.ts:194–230`), giữ nguyên JSON payload. Streaming giữ ID trong closure `sendStreamRequest`, gọi lại closure sau refresh. Cả hai backend routes bind cùng middleware. Offline probe trên actual extracted coachService chứng minh stream 401 gửi cùng ID hai lần; hai lần gọi chat độc lập sinh hai ID khác nhau. Đây là TEST FIXTURE với fake fetch/api, không phải browser/network thật.

Tests 29/29 admission pass gồm retry trước/sau response persistence, giữ durable row qua reset fixture, namespaces hai user, same-ID/different-params ở nonterminal, intentional repeat, ingress middleware. Probe độc lập hai AsyncLocalStorage contexts chạy xen kẽ trả `request-a`, `request-b`; sau khi hoàn tất ngoài context trả null. Không phát hiện leak request ID trong phạm vi này. Test “server restart” vẫn là fixture giữ Map, không chứng minh cross-process durability.

### Các lỗi còn lại

**R222-01 — HIGH / CODE_FIX: FAILED bypass fingerprint conflict.** `generation-operations.ts:432` chỉ reject mismatch khi status khác FAILED. `reopenFailed:144` thay fingerprint và tăng epoch nhưng giữ kind/subject cũ. Probe actual `submitGeneration` + memory store: submit actor A/key K/meals=3 → đánh dấu FAILED → submit cùng K/meals=5 được chấp nhận ở epoch 2, tổng hai admission charges. Do đó câu “same ID conflicting payload bị reject” không đúng cho mọi trạng thái; thay kind/subject còn có thể làm canonical binding không nhất quán. Giữ reopen cùng payload nếu đó là policy đã chọn, nhưng payload conflict phải được reject trước reopen. Retry FAILED với cùng payload hiện chủ đích là execution mới có charge; không được mô tả là exactly-once paid generation suốt đời request ID.

**R222-02 — HIGH / CODE_FIX: relative revision replay không ổn định sau action persistence.** `fitness-agent.service.ts:2228–2230` tính `mealsPerDay` từ payload hiện tại rồi cộng delta; fingerprint được xây sau đó (`:2297`). Probe actual `tryPollOrReviseNutritionPlanDraft`, mocked repositories/target/provider: action ban đầu 3 bữa; request ID R + “nhieu bua hon” tạo 4 bữa và persist action; retry cùng R/cùng text thấy payload 4, tính 5, bị conflict. Kết quả một charge/một send, action vẫn 4 bữa, nhưng retry không trả operation/result cũ mà báo sai rằng người dùng dùng ID cho nội dung khác. Lookup/replay phải diễn ra trước khi áp relative mutation hoặc phải giữ immutable input/base revision cho request. Không sửa trong review.

Probe revision đầu tiên in đúng counterexample nhưng assertion tiếng Việt bị PowerShell stdin encoding chuyển thành dấu `?`; đó là lỗi harness assertion, không phải product failure thứ hai. Đã chạy lại bằng assertion ASCII về số bữa, charge/send và kết quả khác nhau, exit 0.

Ngoài ra, stable ID hiện chỉ đi vào generation command; không cache/replay toàn bộ chat response/orchestrator. Profile/target/draft hiện tại có thể làm cùng text được tính thành params khác trước khi lookup. Không tuyên bố end-to-end chat replay từ bằng chứng command-level.

### Legacy và malformed IDs

Không ID hoặc ID không khớp SAFE_ID → fallback newest persisted turn; retry sau persistence có thể sinh operation/charge mới. Independent schema/middleware probe:

| clientRequestId | Kết quả |
|---|---|
| `bad!` | Schema accepted; middleware bỏ ID, bind null, dùng legacy |
| Chuỗi dài 65 ký tự | Schema rejected; không tới bind |
| Number | Schema rejected; không tới bind |

Comment/report “malformed luôn ignored, never 400” quá rộng: `z.string().max(64)` vẫn reject type/length. Cần thống nhất policy và quan sát downgrade legacy; valid-ID requirement phải có rollout/cutoff rõ ràng. Không gọi đây là bypass auth.

## 3. RR-02 — Source/test verification

### Transaction thực — CODE AUDIT

- `prismaOperationStore.settleStranded:231`: interactive Prisma `$transaction`; `$queryRaw SELECT ... FROM ai_generation_operations WHERE id/epoch FOR UPDATE` trước mọi Plan mutation. Chỉ ADMITTED/PUBLISHED hoặc RUNNING có lease hết hạn đủ điều kiện.
- Sau lock, đọc target từ operation; chọn nutrition/workout table tương ứng. Plan COMPLETED → operation COMPLETED, giữ result. Plan khác → update với `status != COMPLETED`, kiểm `count === 1`; sau đó operation FAILED trong cùng transaction/tx. Plan update throw/zero count → throw, PostgreSQL transaction theo source phải rollback cả pair. Missing target có explicit `target plan missing`.
- `runFenced:193` UPDATE operation theo id/epoch/token/RUNNING/targetId/unexpired lease trong transaction trước callback Plan writer; timeout 15 s, maxWait 5 s. Competing claim (`:172`), renew, finish, release, reopen UPDATE cùng operation row, nên cùng điểm serialization với FOR UPDATE. Lock order nội bộ: operation trước plan; không giữ transaction qua inference/HTTP.
- `finish:217` kiểm lease còn hạn. `release` kiểm epoch/token/RUNNING nhưng không kiểm lease expiry; old token vẫn không thể sửa owner mới sau takeover. Đây không phải evidence cho external side-effect fencing.
- Claim exhaustion không terminalize trước nữa: caller dùng settleStranded. Old epoch không match locked row; completed plan không bị settle fail. Các updateMany worker writers kiểm count; completion dùng Prisma update nên missing row ném lỗi thay vì count 0 âm thầm.
- `repairFailedTarget:259` lock operation id/epoch, recheck FAILED và target; chỉ sửa Plan QUEUED/PROCESSING. `listInconsistentTerminal:271` join hai bảng, chọn FAILED và completed_at trong 30 ngày; bounded theo limit. Không cover mọi lịch sử: NULL/older completed_at hoặc orphan không match join không được scan; cần inventory/backfill có kiểm soát nếu tồn tại các row đó.

### Reproduction và giới hạn

Original sequence đã chạy lại cho cả WORKOUT_PLAN/NUTRITION_PLAN qua scoped suite: publication budget exhausted → injected Plan write throws → operation vẫn PUBLISHED, plan QUEUED → recovery lần sau đưa cả hai FAILED → lần tiếp theo không làm thêm. Test completed preservation, stale epoch, concurrent recovery, missing target/zero rows, reconciliation và claim exhaustion đều pass.

**Evidence: TEST FIXTURE**, không phải PostgreSQL integration. `createMemoryOperationStore` tự cài mutex và ghi Plan trước rồi mới mutate Operation; không gọi actual Prisma transaction/raw SQL. Không có test rollback khi Plan đã đổi nhưng Operation write sau đó thất bại trong fixture. Facade workout/nutrition cùng dùng một Map; test stale epoch còn gọi `updateNutritionPlanFailed` ở cả hai nhánh kind. Vì vậy hai nhãn domain không chứng minh routing hai physical tables. Đây là coverage limitation thật, không phủ nhận source correction.

Kết luận RR-02: original ordering defect đã được sửa ở source và không còn trong model fixture; **PostgreSQL atomicity, predicate re-evaluation, lock waits, rollback và durability chưa VERIFIED**.

## 4. RR-03 — BullMQ verification

Installed version độc lập: `require(.../bullmq/package.json).version = 5.66.5`.

`transportJobId:383` trả `<operationId>-e<epoch>`; UUID operation ID + integer epoch tạo mapping xác định, khác epoch khác transport ID, không chứa colon và không là số thuần. Prisma operation id là UUID; helper không phải validator cho arbitrary caller strings. Epoch cần valid positive integer trong execution contract; không suy ra tính an toàn từ arbitrary IDs.

Đã chạy actual `Job.prototype.validateOptions` trong 135 tests: ID mới được chấp nhận; negative control `operationId:epoch` ném `Custom Id cannot contain :`. Adapter fixture xác nhận opts.jobId được forward nguyên vào BullMQ; SQS chỉ gửi `{name,data}` chứa execution binding, không dùng transport ID cho public identity. Public reference là operationId (= Plan.jobId), worker đọc operationId/epoch/planId/kind/actor từ body, không parse job.id.

**PASS validator + TEST FIXTURE adapter.** Không có isolated Redis runtime: Docker engine unavailable, test Redis `127.0.0.1:56379` không reachable. Actual enqueue/duplicate/removal/retry semantics **ENVIRONMENT_BLOCKED**, không được gọi là queue-operation PASS. BullMQ job retained với cùng transport ID có lifecycle khác SQS republish; cần isolated queue test về failed/completed/removed jobs khi phục hồi.

Legacy message không operationId vẫn chạy unwrapped trừ `AI_GENERATION_REQUIRE_OPERATION=true`. Có cutoff switch ở source (`withGenerationOperation:561`), chưa có evidence drain/cutoff execution. Cần drain producer/queue/in-flight worker legacy rồi enforce cutoff; không chỉ bật flag và mặc định legacy targets an toàn.

## 5. Frontend resend behavior

`pendingAiTasks.ts:509` tạo local taskId/requestToken, nhưng gọi `.chat(question, sessionId)` (`:600`) hoặc `.chatStream(question,callbacks,sessionId)` (`:665–751`) **không truyền clientRequestId**. AiChatMessage/PendingAiTask/AiCoachSessionState không lưu field này. LocalStorage có namespace user/session nhưng không lưu logical request ID. Token dùng cancel/current callback không phải ID gửi server.

| Tình huống | Hiện trạng source/runtime fixture |
|---|---|
| Automatic 401 retry | Giữ ID trong cùng service call; stream được offline runtime-proven, Axios source giữ original config |
| Timeout/lost HTTP response rồi người dùng gửi lại | Call mới → ID mới; không dedupe request trước |
| Streaming interruption rồi gửi lại | onError đặt failed; gửi lại là call mới → ID mới |
| Browser reconnect | Không có replay ID contract; gửi mới sinh ID mới |
| Refresh rồi retry | Persisted chat không có ID để tái sử dụng; không có supported durable retry mechanism |
| Intentional action mới | Service call mới sinh ID mới, đúng yêu cầu |
| Hai users | Backend actor namespace và frontend user-scoped keys được giữ; REAL BROWSER switch chưa chạy |

**R222-03 — HIGH / CODE_FIX:** UI retry contract chưa hoàn thiện. Không phát hiện resend button có cơ chế reuse ID trong đường caller thực tế; việc người dùng gửi lại cùng câu vẫn là new identity. Cần lưu ID trước send theo user/session/message, explicit retry dùng lại ID, action mới tạo ID mới; giữ account isolation. Không tuyên bố mọi manual resend đều tự động có thể nhận diện là retry nếu UI chưa cung cấp semantics đó.

Frontend package có `build: vite build`; root pnpm workspace bao gồm frontend. Không có frontend web tsconfig/project reference riêng trong các config đã đọc; backend tsconfig.base không phải frontend check phù hợp. Đã chạy command tương đương build script với output `%TEMP%`: build exit 0, 13.69 s, 6,149 modules. Có warning chunk >500 kB, không là blocker trong review này. Vite transpile/bundle không thay semantic TS checking hay REAL BROWSER retry verification.

## 6. PostgreSQL test results

`docker ps` thất bại vì named pipe `dockerDesktopLinuxEngine` không tồn tại. Không có `psql`/`postgres` trên PATH. `docker-compose.test.yml` có `postgres-test` (Postgres 15, host 55433), DB `gymcoach_ai_test`; TCP probe 55433 không reachable. Không dùng historical port làm proof DB identity. Không khởi động Docker daemon, không kết nối DB thay thế, không migrate DEV/prod.

Hai additive migrations đã đọc: `20261019180000_ai_generation_operations` tạo table/unique actor-key/indexes; `20261019190000_ai_generation_operation_epoch` thêm epoch/publish_count/reservation_token. Không áp migration vì chưa có isolated DB được xác minh.

**`POSTGRESQL_INTEGRATION_ENVIRONMENT_BLOCKED`** cho tất cả: concurrent unique inserts, conditional UPDATE/predicate recheck, SELECT FOR UPDATE, injected rollback, competing takeover, stale write rejection, epoch reopen, concurrent recovery, terminal reconciliation và persistence qua hai process. Không có một mục nào được thay bằng fixture PASS.

## 7. Cross-service autosave finding

**R222-04 — HIGH / CODE_FIX + INTEGRATION_TEST.** `nutrition.processor.ts:584–600` hoàn tất canonical NutritionPlan trước, sau đó `assertGenerationLeaseHeld` và HTTP autosave. Probe lease không fence HTTP side effect: attempt A renew thành công → pause/HTTP delay → lease hết hạn hoặc owner B tiếp quản/finalize → HTTP của A vẫn tới fitness-service.

POST `/nutrition/from-ai-plan` dùng internal auth; request chứa sourcePlanId/content và verified-origin user header, **không chứa operationId/epoch/ownership proof** (`nutrition.processor.ts:650`). `nutrition.service.ts:1427` tìm existing `(userId,sourcePlanId)`, nếu không có thì tạo ACTIVE NutritionProgram. Schema unique cùng cặp bảo vệ duplicate cùng source plan, không bảo vệ stale incarnation; epoch mới có planId khác. Existing branch trả alreadyExists, nên đây là risk **stale creation**, không có bằng chứng overwrite existing program. Autosave cũng có thể bị mất sau Plan COMPLETED vì redelivery short-circuit bỏ generation callback.

Smallest safe contract cần chọn rõ một semantics: (a) reject attempt đã mất execution ownership; hoặc (b) durable save intent tạo cùng canonical completion, dispatcher không phụ thuộc attempt lease, consumer idempotent theo intent/version. Nếu yêu cầu stale rejection tới lúc commit, downstream cần authoritative fence/inbox state, không chỉ thêm fields hay preflight HTTP check. Contract tối thiểu phải gắn verified actor/subject, operationId, epoch, target planId, immutable intent/idempotency key và content/version, với internal service authorization; check cùng transaction phía owner trước NutritionProgram create. Không giữ AI PostgreSQL transaction qua HTTP. Không triển khai contract trong review.

## 8. Recovery scheduler và publication concurrency

`jobs-lambda.ts:105` có case `ai-generation-recovery` gọi recoverPendingGenerations, recommendation rate(5 minutes). Search source/IaC/scripts/workflows không tìm thấy scheduler resource wiring job này. **Handler runnable có thật; deployed EventBridge invocation NOT_VERIFIED.** Không suy ra live schedule “không tồn tại” chỉ từ repository; không query AWS trong review.

`claimRepublish:165` đã sửa PUBLISHED/RUNNING budget: conditional update publishCount < max, increment trước send; failed/ambiguous send tiêu tốn slot. Tests 10 concurrent claims và concurrent recovery runners pass trong memory model. Production SQL CAS vẫn cần PostgreSQL test.

**R222-05 — HIGH / CODE_FIX:** bound không bao phủ ADMITTED. `advance:401` gọi publish rồi recordPublish; send failure không count. `recoverPendingGenerations:489` nhánh ADMITTED gọi advance trực tiếp, không claim budget. Independent probe retry cùng ADMITTED request 5 lần, mỗi send ném lỗi: 5 attempts, publishCount=0, configuredMax=3, charge=1. Automatic recovery cũng đi nhánh này. Ambiguous send/ack có thể lặp publish vô hạn cho đến khi worker/status tiến triển; worker dedupe không làm publisher bounded. Cần budget/claim durable cho mọi publication, gồm initial/ADMITTED và ambiguous outcome, cùng retry/backoff policy.

Duplicate workers: actual wrapper kiểm epoch/kind/actor/target, live lease → retryable error, terminal/stale → no run. Fixture pass, không proof SQS delivery/Redis lifecycle. Concurrent runners đọc snapshot stale có thể gửi thêm publication sau khi worker đã renew; CAS budget giới hạn số send ở nhánh được bảo vệ nhưng không chứng minh không có extra sends. Không hứa exactly-once inference; quota admission và PostgreSQL không atomic, crash sau quota trước admission row vẫn có thể mất allowance theo fail-closed policy.

## 9. Distributed quota, status và AWS configuration evidence

### Job status

`findPlanByJobId` và `findNutritionPlanByJobId` đã order createdAt desc; newest selection fixture pass. Đây chưa phải explicit `(operationId,epoch,targetId)` lookup: timestamp tie/clock assumptions và request muốn epoch cũ không được giải quyết bằng sort.

**R222-06 — CODE_FIX:** `/plans/job/:jobId` (`plan.controller.ts:441`) vẫn chỉ lookup WorkoutPlan. Independent direct-controller fixture, owner hợp lệ, nutrition plan tồn tại ở nutrition repo, QUEUE_PROVIDER=sqs → **404 NOT_FOUND**. Chat nutrition có polling riêng theo PlanId, nên không mô tả toàn bộ chat nutrition bị hỏng; generic operation polling cho cả hai domain chưa đạt. BullMQ enrichment vẫn `aiQueue.getJob(operationId)`, trong khi transport ID là `operationId-e<epoch>`, nên không thấy live BullMQ job qua public ID. Sửa status từ canonical operation/epoch/target, giữ owner authorization; không parse transport ID.

### Config matrix — CODE AUDIT, không phải deployed evidence

| Điều kiện | Evidence trong repo | Gate trước release |
|---|---|---|
| RATE_LIMIT_PROVIDER | Default memory; dynamodb/off tùy env (`rate-limit/provider.ts:25`) | Xác minh deployed HTTP/worker admission dùng distributed provider phù hợp |
| DynamoDB quota table | Source default `fitness-assistant-dev-ai-rate-limit`, PK key, counter UpdateItem, expiresAt TTL (`dynamodb-rate-limiter.ts:48,103`) | Table/key/TTL/region/IAM UpdateItem và fail-closed phải được kiểm thực tế; không có provisioning match trong IaC đã search |
| Shared quota | `ai-expensive` ở command admission và sync routes; 135 tests gồm deny/spoof/outage | Multi-process DynamoDB integration chưa chạy |
| Worker lease | Default 900 s, attempts 3; renew trên fenced writes và explicit probe | Không có periodic heartbeat trong worker wrapper; bound whole job/timeouts phải được duyệt |
| Lambda timeout | Generic Terraform HTTP module timeout=10 s | Không phải worker timeout evidence; worker-lambda comments chỉ recommendation |
| SQS visibility/DLQ | Handler trả batchItemFailures; recommendation batch=1 | Live visibility/redrive/maxReceiveCount/DLQ/mapping failure mode NOT_VERIFIED |
| Recovery schedule | Job handler có, chưa thấy IaC wiring | Schedule target/input/permission/cadence phải được review riêng |
| Migration order | Hai migrations mới additive, client/source đã sử dụng table mới | Test apply rồi migrate-before-producer/worker/jobs rollout; không thấy pipeline đảm bảo order trong evidence đã đọc |
| Legacy cutoff | AI_GENERATION_REQUIRE_OPERATION switch | Drain/cutoff deployment evidence bắt buộc |

Lease/visibility/timeout/DLQ/attempt budget phải tương thích toàn bộ job (nhiều inference/repair/DB/HTTP), không suy từ timeout một call. intEnv chưa reject NaN/nonpositive; cấu hình phải được validate và fail rõ, không âm thầm dùng lease invalid. Không dùng thông tin AWS của lần khởi động trước làm proof các điều kiện này.

## 10. Remaining blockers

| ID / loại | Mức | Việc còn thiếu |
|---|---|---|
| R222-01 CODE_FIX | HIGH | Reject conflicting input cả khi FAILED; giữ immutable logical binding khi reopen |
| R222-02 CODE_FIX | HIGH | Relative revision retry lookup trước mutable recomputation |
| R222-03 CODE_FIX | HIGH | Actual UI durable request ID + explicit retry semantics |
| R222-04 CODE_FIX + INTEGRATION_TEST | HIGH | Cross-service autosave durable intent/fencing và stale creation race |
| R222-05 CODE_FIX | HIGH | Bounded publication cả ADMITTED/initial/ambiguous outcomes |
| R222-06 CODE_FIX | Release gate cho general operation polling | Nutrition + epoch-aware canonical status và BullMQ transport lookup |
| PG-01 INTEGRATION_TEST | Essential | Real PostgreSQL transaction/locking/migration/durability matrix |
| Q-01 INTEGRATION_TEST | Essential cho BullMQ release | Isolated Redis enqueue/dedup/retention/recovery lifecycle |
| DEP-01 DEPLOYMENT_REVIEW | Essential | Distributed quota/table/IAM; worker/queue timing; DLQ; recovery schedule; legacy cutoff; migration order |

Malformed-ID policy, reconciliation age/NULL inventory và env validation cần giải quyết rõ trong cùng contract/config review. Không biến các điểm này thành một framework/orchestrator mới.

## 11. Minimal next-step plan và regression evidence

Thứ tự: **code correction trước**, rồi isolated PostgreSQL/Redis integration, cuối cùng deployment configuration review. Không phải “deploy thử để xem” và không bắt đầu V-T003.

1. Sửa logical request/retry semantics (R222-01/02/03) và publication budget (R222-05), thêm counterexamples đã nêu thành regression tests; status contract và autosave phải có quyết định scoped rõ.
2. Dùng postgres-test/Redis-test được xác minh độc lập, apply hai migrations chỉ vào DB test, chạy interleavings/rollback/cross-process cùng cross-service autosave race. Không dùng DEV database để gỡ blocker.
3. Review cấu hình runtime riêng sau khi correctness gates đạt. Review này không cấp phép deploy.

Đã chạy từ `backend/services/ai-service`:

```text
node node_modules/tsx/dist/cli.mjs --test src/__tests__/generation-operations.test.ts src/__tests__/generation-admission.test.ts src/__tests__/ai-endpoint-policy.test.ts src/__tests__/rate-limit.test.ts src/__tests__/auth-middleware-token-rejection.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Env synthetic: NODE_ENV=test; DATABASE_URL/AI_DATABASE_URL=`postgresql://review:review@127.0.0.1:1/gymini_review_test`; LLM_PROVIDER/EMBEDDING_PROVIDER=mock; Redis localhost:1; synthetic JWT/internal secrets; LOG_LEVEL=silent; AWS metadata disabled; research automation/fetch disabled. Tests thay DB/queue/provider seams; không dùng AWS credential hay real model. Không rerun “full test/all/evaluation” vì ngoài scope và có DB/external/data dependencies.

| Check | PASS | FAIL | SKIPPED / blocked / not verified |
|---|---:|---:|---|
| generation-operations | 56 | 0 | Fixture + actual installed validator |
| generation-admission | 29 | 0 | Fixture HTTP chain/provider/repositories |
| ai-endpoint-policy | 21 | 0 | Fixture HTTP/provider/ownership |
| rate-limit | 23 | 0 | Fake DynamoDB transport; không gọi DynamoDB thật |
| auth-middleware-token-rejection | 6 | 0 | Scoped classification cases |
| Combined | **135** | **0** | **0 skipped**, duration 14.09 s, exit 0 |
| ai-service noEmit | PASS | 0 | exit 0 |
| Frontend Vite build → TEMP | PASS | 0 | exit 0; semantic frontend TS NOT_VERIFIED |
| Independent counterexample assertions | Reproduced | — | FAILED-conflict accepted; ADMITTED attempts=5/count=0; revision replay conflict; nutrition job status=404 |
| ALS / coachService probes | PASS | 0 | In-process isolation; stream 401 ID reuse; new call/new ID |
| Real PostgreSQL / Redis queue operations | — | — | ENVIRONMENT_BLOCKED, không executed |
| REAL BROWSER / AWS config / paid model | — | — | NOT_VERIFIED, không executed |

Negative controls RR-01 old previous-turn key, RR-02 old FAILED-first ordering, RR-03 old colon ID đều chạy và phát hiện broken variants. Các controls khác chứng minh fixture có thể bộc lộ uniqueness/claim/fencing defect khi cố ý bỏ guard. Không thay thế real SQL: mutex/store đã encode chính semantics cần được kiểm chứng. Client “CODE AUDIT” test chủ yếu inspect source; offline actual extracted service probe bổ sung execution nhưng không nâng thành E2E.

Frontend command từ `frontend/web`: `node node_modules/vite/bin/vite.js build --outDir <fresh TEMP path> --emptyOutDir false`. Không chạy installer/generate, không ghi output vào concurrent workspace.

## 12. Architecture compatibility và V-T003

CODE AUDIT: giữ `ragService → llmOrchestrator → fitnessAgent`, existing JWT/internal authentication, shared quota, Plan/NutritionPlan là content truth. AiGenerationOperation là coordination/admission/outbox/lease, không sở hữu prescription mới. NutritionProgram vẫn thuộc fitness-service; NutritionGoal vẫn authoritative target. Không thấy orchestrator/framework thứ hai trong correction scope. Existing proposal execute/confirm flow còn nguyên, nhưng review không rerun toàn bộ proposal confirmation regression và không duyệt V-T003.

Bedrock/Nova wiring còn: `llm.service.ts` chọn Bedrock khi LLM_PROVIDER=bedrock; `bedrock.client.ts:41` lấy BEDROCK_CHAT_MODEL hoặc Nova Pro default, vision model default theo chat. Các Bedrock changes có sẵn là concurrent input, không thay trong review. Không paid inference/live wiring verification.

V-T003 phải phân biệt `clientRequestId` (user intent), `operationId` (logical coordination), `epoch` (charged execution incarnation), `planId` (canonical content target), `proposalContentVersion` (preview/confirmation CAS). Namespace verified actor/subject; bind proposalId và expected content version. Retry một intent không được áp lại delta; action mới có ID mới; stale epoch/version phải bị reject trước mutation/confirm. Không suy epoch từ transport job ID hay chỉ lấy newest plan theo timestamp. Không dùng operation status thay proposal confirmation authority.

## 13. Acceptance gate matrix

| Gate | Verdict | Evidence / blocker |
|---|---|---|
| Request ID ingress và 401 reuse | PASS scoped | CODE AUDIT + TEST FIXTURE |
| Same payload replay ở nonterminal/COMPLETED command | PASS scoped | 135 tests, không full chat replay |
| Same key conflicting payload mọi status | FAIL | R222-01 |
| Relative revision sau action persistence | FAIL | R222-02 independent probe |
| Real UI timeout/lost-response/reconnect/refresh retry | FAIL contract / REAL BROWSER NOT_VERIFIED | R222-03 |
| Actor/session scoping | PASS scoped | Auth/source/fixture, không account-switch E2E |
| RR-02 atomic terminal source correction | PASS CODE AUDIT + TEST FIXTURE | Actual Prisma/PostgreSQL chưa exercised |
| SQL locks/rollback/epoch/concurrent recovery/durability | ENVIRONMENT_BLOCKED | PG-01 |
| RR-03 accepted BullMQ job ID | PASS | Actual 5.66.5 validator + negative control |
| Real BullMQ enqueue/duplicate lifecycle | ENVIRONMENT_BLOCKED | Q-01 |
| Publication bounded across all states | FAIL | R222-05 |
| Autosave stale side-effect protection | FAIL source contract | R222-04; cross-service runtime NOT_VERIFIED |
| Workout + Nutrition epoch-aware polling | FAIL / PARTIAL | R222-06; newest ordering alone insufficient |
| Recovery runner scheduled | NOT_VERIFIED deployment | Source handler only, DEP-01 |
| Distributed quota/runtime queue config/migrations | NOT_VERIFIED deployment | DEP-01 |
| Scoped regression / ai TS / frontend bundle | PASS | Exact checks above, không full regression |
| Controlled deploy review approval | **NOT APPROVED** | Essential correctness + integration gates chưa đạt |
| Scope safety | PASS | Chỉ báo cáo mới, không source/AWS/DB/deploy mutation |

**Final verdict: `V-T012_2_2_CHANGES_REQUIRED`. STOP sau independent review.**
