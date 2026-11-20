# V-T012 — Independent Security & Cost Governance Review

Ngày: 2026-10-19. Reviewer: Codex. Related gaps: NEW-GAP-003 / G-33. Phạm vi: read-only source/diff review, focused synthetic verification, một báo cáo. Không triển khai.

## 1. Executive verdict

**V-T012_CHANGES_REQUIRED**

Implementation cải thiện rõ authorization và quota: 21/21 test mới pass độc lập; 29 test quota/auth hiện có pass; Gateway thật chặn request không đăng nhập và sáu route service-only chặn user JWT. Không tái hiện public-to-service authentication bypass khi INTERNAL_SERVICE_SECRET được cấu hình và request đi qua Gateway hiện tại.

Chưa đủ điều kiện phê duyệt release: chat nutrition generation/revision bỏ qua ai-expensive; persistence sau enqueue có thể thất bại trong khi job đã được chấp nhận; worker chưa có durable admission/idempotency guard bảo đảm không chạy lại model khi redelivery. Target provider/table/IAM chưa xác minh: **DEPLOYMENT_NOT_VERIFIED**.

Quan trọng: mô tả “confirm → queue*PlanGeneration” trong implementation report không đúng với các nhánh CREATE_WORKOUT_PLAN/CREATE_NUTRITION_PLAN hiện tại. Chi phí dinh dưỡng phát sinh khi propose/revise TRƯỚC confirm; confirm lưu preview đã tạo. Thêm limiter chung ở confirm sẽ vừa bỏ sót generation vừa tính quota sai cho deterministic writes.

## 2. Repository safety and baseline

START_HEAD = END_HEAD = 003545c6da8d524e8c4f6fbe4575444102f1fc50. Branch: aws-deploy. Start tracked diff: 11 files, 448 insertions, 59 deletions. Start status:

```text
 M backend/services/ai-service/package.json
 M backend/services/ai-service/src/middleware/auth.middleware.ts
 M backend/services/ai-service/src/routes/ai.routes.ts
 M backend/services/ai-service/src/routes/fitness-agent.routes.ts
 M backend/services/ai-service/src/routes/marketplace.routes.ts
 M backend/services/ai-service/src/routes/plan.routes.ts
 M backend/services/ai-service/src/services/bedrock.client.ts
 M backend/services/auth-service/src/app.ts
 M backend/services/user-service/src/app.ts
 M backend/shared/src/index.ts
 M pnpm-lock.yaml
?? .dev/aws/scheduler-state.json.before-shutdown-20261019
?? .dev/aws/shutdown-20261019.json
?? backend/services/ai-service/src/__tests__/ai-endpoint-policy.test.ts
?? backend/services/ai-service/src/__tests__/bedrock-cross-account.test.ts
?? backend/services/ai-service/src/middleware/ai-rate-limiters.ts
?? backend/services/ai-service/src/middleware/require-trusted-service.middleware.ts
?? backend/services/ai-service/src/services/bedrock-credentials.ts
?? backend/services/auth-service/src/__tests__/logger-redaction.test.ts
?? backend/services/user-service/src/__tests__/log-secret-hygiene.test.ts
?? backend/shared/src/log-safety.ts
?? docs/architecture/gymini-audit-verification/
?? docs/architecture/gymini-full-business-audit/
?? docs/architecture/gymini-implementation/
```

Các source/test/config trên là pre-existing OTHER_AGENT/UNKNOWN và chỉ được đọc. Chỉ file báo cáo này do reviewer tạo. Không reset/stash/clean/commit/push; không sửa V-T001.1, Bedrock, source, schemas, config hay báo cáo trước. Không đọc/index/hash/traverse heldout/sealed datasets; không gọi paid model; không gọi AWS hoặc DB/Redis thật.

Đã đọc implementation report và diff của auth.middleware.ts cùng bốn route files; đọc hai middleware mới và policy test mới. Shared log-safety, auth/user app changes và Bedrock diff được nhận diện là workstream khác, không gộp vào kết luận V-T012.

Bằng chứng dùng các nhãn **CODE AUDIT**, **REAL HTTP/API** localhost, **TEST FIXTURE**. Không có REAL BROWSER, production verification hoặc distributed BACKEND INTEGRATION.

## 3. Confirmed implementation strengths

- ai-rate-limiters.ts:17–48 tập trung ai-ask (20/60s), ai-expensive (10/60s), ai-internal (30/60s); env override dùng lúc import. Một bucket key là name:userId, dùng context sau auth, không dùng body userId.
- ai.routes.ts:26,86–125 gắn requireAuth trước guard và quota của sáu internal routes. require-trusted-service.middleware.ts:18–29 fail-closed nếu callerKind không phải service.
- plan.routes.ts:39,45,73,91,117,128 và marketplace.routes.ts:24 bổ sung ai-expensive. Vision và generate-workout dùng cùng bucket. Đổi endpoint trong nhóm này không lấy được allowance mới.
- rate-limit.middleware.ts:80–96 trả 429 + Retry-After khi hết quota; :100–112 đổi RateLimitInfrastructureError thành sanitized 503, không gọi downstream handler.
- DynamoDB implementation dùng một UpdateItem atomic increment + UPDATED_NEW (dynamodb-rate-limiter.ts:89–122), không read-modify-write hai round trips. Đây là CODE AUDIT; fake transport tests không phải chứng minh AWS deployment.
- Marketplace publisher ownership vẫn được real service kiểm; test ownership giữ controller/service thật, stub DB/model boundary.

## 4. Service authentication boundary

### Trace source

Gateway app.ts:60–69 loại client x-user-id/email/role và stamp gateway secret. middleware/auth.middleware.ts:28–70 yêu cầu Bearer, gọi auth-service verify rồi ghi x-user-* từ verified user. proxy.routes.ts:1188–1210 đặt authMiddleware trước generic /ai proxy, forward Authorization và inject x-internal-token.

AI requireAuth (auth.middleware.ts:119–136) nhận đúng shared internal secret + nonempty x-user-id trước JWT branch; callerKind dựa vào có parsed Bearer hay không. Có Bearer → gateway_user; không Bearer → service. JWT-only branch :140–154 verify token độc lập, lấy id/role từ verified response và callerKind=user. requireTrustedService chỉ cho service đi tiếp.

Vì Gateway hiện tại không proxy request thiếu Bearer qua auth gate, việc gateway inject secret không tự biến một anonymous browser thành service. Test chỉ giả lập gw headers sẽ không đủ; reviewer đã chạy actual Gateway app → actual AI app trên localhost với auth-server fixture.

### Synthetic A–G verification

Cả sáu paths được thử: /ai/analyze-cycle, assess-cycle, analyze-feedback, generate-client-plan-draft, generate-roadmap-draft, explain-exercise-progression. AI controllers được thay bằng recorder trước router import; real auth, guard, proxy, limiter được giữ. Auth-server/JWT verifier là synthetic fixture, không dùng JWT/credential thật.

| Case | Kết quả trên 6 routes | Nhãn / ý nghĩa |
|---|---|---|
| A user qua actual Gateway, thêm forged identity/internal headers | 6 × 403 | REAL HTTP/API; authenticated user không thành service |
| B JWT trực tiếp AI, forged x-user-id | 6 × 403 | REAL HTTP/API + verifier fixture |
| C anonymous qua actual Gateway | 6 × 401 | Bị chặn tại Gateway |
| D anonymous + forged x-user-id/ADMIN qua Gateway | 6 × 401 | Không thể mượn secret injection |
| D direct AI + forged x-user-id | 6 × 401 | Secret được cấu hình |
| E đúng synthetic internal secret + x-user-id, không Bearer | 6 × 200 | context callerKind=service; origin-user được giữ, body-victim không dùng cho quota |
| F cùng secret + Bearer | 6 × 403 | gateway_user bị từ chối |
| G sáu actual fitness client wrappers | 6 × 200 | context userId=fitness-origin-user, callerKind=service |

42 HTTP A–F variants + 24 actual client success/failure cases hoàn tất, exit 0, modelCalls=0. Đây không phải six real model/controller business flows.

### Identity limit and conditional exposure

Shared secret possession là credential của trust domain, **không xác minh service identity riêng tên fitness-service**. Bất kỳ holder nào có secret và bỏ Bearer có thể claim userId/role; named service identity không được ký/attest riêng. Không coi việc reviewer chủ động cung cấp secret đúng là public bypass.

auth.middleware.ts:172–199 vẫn có pre-existing non-production convenience: nếu secret unset, caller x-user-id được gán callerKind=service. Đây không đáp ứng verified-service identity; không được expose môi trường cấu hình đó ra public. Production unset secret không cho header-only path đi qua (:174–184). Runtime NODE_ENV/secret/ingress chưa được đọc từ AWS. Nếu target thực sự expose dev-fallback hoặc một ingress khác inject secret nhưng không verify/strip identity, đó là release blocker; chưa có bằng chứng runtime như vậy trong review này.

Khuyến nghị không weaken authentication hoặc bỏ Bearer để “sửa” legitimate callers. Khi yêu cầu identity mạnh hơn shared secret, dùng credential riêng/claim có xác minh cho service hoặc ingress policy phân biệt gateway và service; không tin x-service-name tùy ý.

## 5. Endpoint/quota coverage

| Surface | Quota / auth | Đánh giá |
|---|---|---|
| POST /ai/ask, /ai/ask/stream | requireAuth + ai-ask | Chung chat bucket, riêng ai-expensive; mỗi turn có thể phát sinh thêm model/queue work |
| /ai/generate-workout, /ai/agent/goal-image, image-chat | requireAuth + ai-expensive | Có quota chung |
| /plans/workout/generate, nutrition/generate, adjust, nutrition/:id/adjust | requireAuth + ai-expensive | Controller admission trước queue/DB; queued routes cần command-level admission khi đóng chat gap |
| /plans/explain, nutrition/:id/explain | requireAuth + ai-expensive | Sync model paths có quota |
| marketplace improvement-suggestions POST | requireAuth + ai-expensive + ownership | Người khác không được generate cho publisher |
| Sáu service-only AI paths | requireAuth + requireTrustedService + ai-internal | Chung bucket theo originating caller, khác ai-expensive |
| Chat propose/revise nutrition | Chỉ ai-ask ở HTTP ingress | **Không consume ai-expensive trong queue command** |
| Agent confirm | requireAuth + action/session ownership + atomic claim | Không có expensive limiter; không đồng nghĩa mọi confirmation gọi model |
| GET llm-health | requireAuth, không quota | mock/Bedrock health không inference; Ollama mode kiểm model availability qua GET |
| Admin knowledge/embedding | requireAuth + ADMIN | Role authorization có; không có explicit spend/concurrency budget |
| /internal/knowledge/* | x-service-secret check tại từng handler | Không user quota; không thực thi pipeline trong review |
| Worker / scheduled jobs | Queue/IAM/scheduler trust bên ngoài HTTP | Không có ai-expensive consumption; retry/redelivery chưa có durable model-admission proof |

Original identity: direct JWT lấy subject thật, không body/header claim. Gateway ghi identity sau verify. Fitness client generateClientPlanDraft dùng ptUserId cho quota (ai.client.ts:279–292; coach.service.ts:410), không clientUserId đích; đó là originating actor policy, không phải mọi quota đều keyed theo beneficiary. Nếu cần ngân sách theo client, phải quy định rõ actor/subject, không đổi sang body userId.

## 6. Confirmed findings: blockers versus follow-ups

### V12-R01 — HIGH / release-blocking cost coverage gap

**Impact:** người dùng còn chat allowance có thể enqueue paid nutrition generation/revision sau khi ai-expensive hết.

Locations: fitness-agent.service.ts:2117,2229; conversation.service.ts:242–329; ai.routes.ts:36–48. Controller → ragService.rag (ai.controller.ts:29), llmOrchestrator.run (rag.service.ts:104), fitnessAgent.tryTurn (orchestrator.service.ts:452), intent dispatch (fitness-agent.service.ts:984) → proposeNutritionPlan. Revision gọi queue tương tự. Command tạo Plan rồi enqueue, không consume budget.

Independent TEST FIXTURE chạy real proposeNutritionPlan + real queueNutritionPlanGeneration + real enqueueAiTask, chỉ stub profile/target/Prisma repository/SQS transport. Sau khi cùng ai-expensive:user key hết quota: queued=1, createdPlan=1, actionCreate=1, sent user đúng verified-fixture-user, modelCalls=0. Chứng minh component-level admission gap; không tuyên bố full chat production E2E hoặc paid execution.

Fix: budget admission tại shared billable generation command, bao phủ REST và chat initial/revision, dùng verified identity và idempotent generation operation. Chuyển queued REST routes sang cùng command admission để không consume ai-expensive hai lần; giữ sync expensive-route protection. Chat ai-ask turn charge vẫn là tier riêng, không nên dùng nó thay expensive-generation charge.

### V12-R02 — HIGH / release evidence gap: enqueue và persistence không atomic, retries chưa idempotent

**Impact:** retry sau lỗi/ambiguous success hoặc duplicate delivery có thể tạo job/model work bổ sung không gắn với admission duy nhất.

conversation.service.ts:279 tạo nutrition Plan, :287 enqueue, :323 lưu jobId; fitness-agent.service.ts:2117 enqueue trước :2122 tạo action; revision :2229 enqueue trước :2235 update payload. Queue provider gửi SQS message không có generation dedup token/FIFO dedup ID; BullMQ add(name,data) không truyền stable jobId/attempt policy (queue-provider.ts:86–114). Không atomic transaction xuyên DB/SQS.

TEST FIXTURE cố ý cho action persistence throw sau enqueue: request/hàm thất bại nhưng tổng queued tăng từ 1 lên 2, createdPlan từ 1 lên 2. Không có worker thật/DB thật trong test. Không được hứa “throw nghĩa là chưa commit gì” cho generation boundary này.

worker-lambda.ts:76–106 gọi processor cho từng delivery và report batch failure để redeliver; processor nutrition.processor.ts:270–275 và ai.worker.ts:1090–1095 ghi PROCESSING mà không CAS ownership/completed guard trước model. Nutrition :400,421 có model retry; workout :1516,1614,1967 có generation/repair calls. Default BullMQ attempts=1 không bảo đảm exactly-once do stalled/redelivery/HTTP retries; SQS at-least-once cần durable idempotency. Đây là CODE AUDIT về khả năng lặp, không phải đã tái hiện AWS duplicate billing. Target SQS maxReceiveCount, visibility, mapping concurrency/DLQ chưa xác minh.

Fix: stable generation/attempt ID, durable admission/reservation state và idempotent queue/worker claim; duplicate completed/in-flight operation không gọi model lại hoặc charge lại ngoài policy. Bounded repair/retry cần policy riêng; một request quota không phải hard monetary cap.

### V12-R03 — release prerequisite / DEPLOYMENT_NOT_VERIFIED

Provider mặc định memory (provider.ts:24–36), off explicit bỏ quota. Nhiều Lambda processes/cold starts không share memory counter. Chưa có bằng chứng target đặt dynamodb, đúng table/partition key/TTL, IAM UpdateItem hoặc network/config thực. Không được approve distributed protection từ mocks. Không khẳng định target đang sai cấu hình.

### Non-blocking / separate follow-ups

- MEDIUM: shared-secret/no-Bearer là trust-domain classification, chưa chứng minh named fitness-service identity; dev secret-unset bypass phải bị cấm ở public ingress.
- MEDIUM: admin/internal/background embeddings có auth nhưng không budget policy, retry/concurrency spend cap rõ ràng. Có thể là chủ ý khác với user allowance; cần policy được ghi rõ, không blanket user limiter gây hỏng bulk workflows.
- MEDIUM pre-existing compatibility defect: fitness-service/workers/workout.worker.ts:14–20 POST /ai/generate-workout không headers, có từ HEAD; sẽ 401 nếu secret configured. Không sửa guard để accommodate; caller cần credential/origin identity theo contract, trong patch riêng.
- LOW: policy tests /internal/knowledge/anything chấp nhận 404 nên không chứng minh actual internal route auth; health test assert not-429 vẫn cho phép status lỗi khác. CODE AUDIT bổ sung kiểm requireInternalSecret; chưa chạy embedding pipelines.
- LOW operational config: resolve provider nằm ngoài try của consume; invalid provider env phải fail boot/health rõ ràng, không xem mọi config error đều sanitized store-outage 503. Không tái hiện production misconfiguration.

## 7. Queued-action analysis and V-T003 dependency

### What action kinds actually cost

| Kind / stage | Current behavior | Paid work / budget implication |
|---|---|---|
| CREATE_NUTRITION_PLAN propose/revise | queueNutritionPlanGeneration trước preview/confirm | Paid worker; ai-expensive thiếu ở command |
| CREATE_NUTRITION_PLAN confirm | verify target, fetch COMPLETED Plan, validate content/exclusions, save via fitness | Không regenerate/enqueue trực tiếp; không charge expensive như generation |
| CREATE_WORKOUT_PLAN | Deterministic recommendation engine + catalog matching tạo draft; confirm importAiPlanToSchedule | Không trực tiếp call LLM/queue ở confirm; không tính generation fee chỉ vì kind có PLAN |
| SAVE_GENERATED_PLAN | Import schedule đã preview | Deterministic persistence boundary |
| CREATE_PLAN_BUNDLE propose/revise | tools.generateRoadmapDraft → fitness ai-draft → six-route ai-internal policy | Model đã được gọi trước confirm; dùng internal originating user allowance |
| CREATE_PLAN_BUNDLE confirm | accept/activate roadmap, apply template, bootstrap nutrition | Các writes chính deterministic; bootstrap có optional nutrition job qua /plans/nutrition/generate, đã qua ai-expensive HTTP (nutrition-onboarding-bootstrap.service.ts:318, ai.client.ts:384) |
| CYCLE_COMPLETE / evaluate requests | Fitness decision engine + optional AI explanations | Indirect assess/analyze calls thuộc ai-internal, không giả định pure deterministic toàn flow |
| PT contract draft/confirm, recommendation accept/reject, roadmap archive/rebuild/advance, workout start/skip/cancel, meal log confirm | Domain writes / rule-based transitions trên payload đã chuẩn bị | Không có direct queue*PlanGeneration trong runActionBranch; downstream enrichment không được đồng nhất với direct paid generation |

Atomic confirm source: execute():1066 kiểm explicit true, :1068 action scoped user, ownSession :1070, completed replay, terminal/expiry checks. Conditional updateMany :1087 PENDING→EXECUTING; stale reclaim :1098 so sánh marker; branch sau claim :1113; release :1110/1115/1122, finalize :1125. No DB transaction held across HTTP.

TEST FIXTURE với real execute(), fake in-memory row CAS và import tool recorder: foreign user 404; 6 concurrent confirmations → 1 fulfilled + 5 conflicts 409; writes=1, queues=0, models=0, final COMPLETED; replay reused result. Đây không chứng minh DB CAS semantics thực hay stale-lease recovery.

### Ten transition questions

1. Paid inference nằm ở generation stages/indirect enrichment như bảng, không phải tất cả kinds ở confirm.
2. Deterministic writes phải được exempt khỏi paid-generation budget, đồng thời vẫn giữ authorization/claim.
3. Confirm không trực tiếp gọi queue*PlanGeneration trong current runActionBranch. Gap direct queue đã xác nhận nằm ở chat propose/revise; CREATE_PLAN_BUNDLE có indirect queue qua existing metered HTTP route.
4. Concurrent fresh confirms đã có one-winner CAS; không bảo vệ các enqueue trước action creation hoặc duplicate worker deliveries. Stale claim/repair retry vẫn cần coordination/fencing.
5. Proposal/action ownership được xác minh từ identity/session; queue user lấy identity, không body. Mọi admission command mới phải giữ verified actor provenance và tránh public arbitrary-user call.
6. Enforce tại billable generation command/worker admission, không đặt generic limiter trước confirm lookup.
7. Quota reject: 429 + Retry-After, không enqueue/model; không đổi action thành COMPLETED hoặc làm mất preview; claim/reservation giữ trạng thái có thể retry rõ ràng. Backend unavailable: sanitized 503, không chuyển sang allow.
8. Claim thắng nhưng enqueue definite-fail: release đúng owned claim/reservation và giữ retryable state; ambiguous enqueue success: giữ operation để reconcile/retry bằng cùng ID, không blind refund+enqueue mới. Current direct chat enqueue không dùng confirm claim; đã tái hiện action-save-fail nhưng job tồn tại.
9. Reserve budget nhưng CAS thua: reuse/release reservation idempotently theo operation + owner marker. Không consume một quota cho mỗi contender rồi bỏ, không refund sau khi worker có thể bắt đầu.
10. **V-T012.1 có thể sửa generation admission độc lập với confirm state machine V-T003**, vì current chat paid work ở propose/revise, không trong execute. Cần thống nhất operation/idempotency contract với V-T003 nếu thay đổi claim/reservation/stale reclaim; không sửa chung execute/release/finalize trong patch riêng mà thiếu coordination.

Current release/finalize chỉ filter EXECUTING, không filter executingSince/lease owner như stale reclaim. Nếu V-T003 thêm durable generation/reservation vào action lifecycle, phải fence owner ở release/finalize; không coi existing two-minute stale reclaim là bảo đảm exactly-once model billing. Không mở rộng review này thành implementation V-T003.

## 8. Legitimate caller compatibility and fallback

fitness-service/clients/ai.client.ts:24–28 tạo x-internal-token + x-user-id, không end-user Bearer cho sáu calls. Reviewer thực thi chính sáu *Safe wrappers với actual AI HTTP app, controller recorder: tất cả nhận 200 và đúng originating user; forced 403/429/503 cho từng wrapper đều trả null (18 failure cases), không fake success.

Consumer CODE AUDIT: coach.service.ts:410–418 trả empty draft + manual guidance khi null; fitness-roadmap.service.ts:550–573 ghi fallback/non-personalized/confidence 0; workout.service.ts:884–895 trả deterministic-fallback; feedback-analysis.service.ts:44–73 phân biệt rule-based result. Training-cycle service dùng assessCycleSafe và giữ deterministic authority. Không chạy DB-backed consumer persistence/UI, nên không chứng nhận toàn journey fallback.

Không có contract break được quan sát ở sáu callers. Worker thiếu auth là pre-existing exception nêu trên. Không sửa auth để làm caller đó pass.

## 9. Runtime/deployment provider evidence

CODE AUDIT repository: RATE_LIMIT_PROVIDER mặc định memory, dynamodb explicit, off explicit. DDB table default fitness-assistant-dev-ai-rate-limit, key partition attribute key, expiresAt TTL; atomic UPDATED_NEW count dùng count<=max. TTL cleanup không ảnh hưởng correctness vì windowStart nằm trong key. Fixed-window policy có thể burst quanh boundary; không phải rolling-window/dollar cap.

Đã tìm các tên provider/table/UpdateItem trong infra, scripts, .github và AI packaging scripts; không tìm được target AI Lambda environment/table/IAM provisioning đủ để xác nhận runtime. Terraform lambda-http-api module đang mô tả hello Lambda, không phải bằng chứng AI production config. .dev/aws chỉ có scheduler/shutdown state, không được coi là current quota deployment configuration.

**DEPLOYMENT_NOT_VERIFIED:** không đọc AWS environment/IAM/table thực, không gọi AWS CLI/SDK, không đổi cấu hình. Trước release cần read-only evidence target RATE_LIMIT_PROVIDER=dynamodb, AI_RATE_LIMIT_TABLE đúng môi trường, table schema/TTL, IAM dynamodb:UpdateItem scoped đúng ARN, credentials/network khả dụng và multi-instance admission test. Không bật provider hoặc tạo tài nguyên trong review này.

## 10. Test, baseline and build results

Toolchain thực: Node v24.14.1, TypeScript 5.9.3, tsx 4.21.0, Express 4.22.1.

| Verification | Status | Result / boundary |
|---|---|---|
| ai-endpoint-policy.test.ts, all 21 new tests | PASS | 21 passed / 0 failed / 0 skipped; exit 0; ~13.27s |
| rate-limit.test.ts + auth-middleware-token-rejection.test.ts | PASS | 29 passed / 0 failed / 0 skipped; exit 0; ~1.24s |
| Comparable policy baseline, current overlay | PASS | 21/21; same synthetic fixtures, no source replacement; ~2.91s |
| Comparable policy baseline, HEAD overlay | FAIL (expected negative control) | 6 pass / 15 fail / 0 skipped; ~2.72s; shows policy assertions detect original gaps |
| Gateway/AI and actual fitness client HTTP probe | PASS scoped | 42 auth cases + 24 client cases; modelCalls=0 |
| Real generation-command gap fixture | FAIL protection | Quota exhausted but enqueue succeeded; action-save error did not undo enqueue; child exit 0 because observation succeeded |
| Deterministic execute/ownership/concurrency fixture | PASS scoped | Foreign 404; one write for six concurrent confirmations; no model/queue; completed replay |
| Targeted TS program, no emit | PASS scoped | Roots app.ts, 2 new middleware files, policy test; 2524 transitive source/declaration files; 0 diagnostics; 0 protected-data read attempts |
| Full AI/fitness DB + Redis regression | ENVIRONMENT_BLOCKED | Docker Desktop Linux pipe absent; isolated DB/Redis identity not available, no connection/mutation attempted |
| Real DynamoDB/Lambda concurrency, SQS retries, deployable artifact | NOT_VERIFIED | No AWS/packaging/deployment execution |

Runner commands from backend/services/ai-service:

```text
node <resolved tsx/cli> --test src/__tests__/ai-endpoint-policy.test.ts
node <resolved tsx/cli> --test src/__tests__/rate-limit.test.ts src/__tests__/auth-middleware-token-rejection.test.ts
docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps --format '{{.Names}}'
```

Minimal child environment only: NODE_ENV=test, LOG_LEVEL=silent, secrets SYN_*, DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/gymini_review_test?connect_timeout=1, REDIS_HOST=127.0.0.1/REDIS_PORT=1, LLM_PROVIDER=mock, EMBEDDING_PROVIDER=mock, AWS_EC2_METADATA_DISABLED=true, TSX_DISABLE_CACHE=1, FITNESS_DISABLE_REDIS=true; Windows OS/path/temp variables needed for Node. No inherited real credentials/.env. Policy file overrides internal secret with its own test-internal-secret and budget=3, resets provider. HTTP server fixtures bind only localhost. Other proxy targets registered by Gateway were not requested.

Type checking used TypeScript createProgram with explicit roots and repo-equivalent strict ES2022/CommonJS options, noEmit=true/incremental=false, readFile guard refusing heldout/sealed/data/eval paths. It did not enumerate all src root files, emit dist, build ZIP/container or invoke data ingestion. No full-project build claim.

Baseline: git show HEAD:<five exact auth/route paths> loaded strings into child memory; Module._extensions .ts overlay transpiled only those HEAD sources plus the CURRENT test to CommonJS. All other dependencies stayed current, including concurrent Bedrock/shared changes. Current control used the same test-transpilation path and passed. No checkout/worktree/file swaps. This is scoped V-T012 behavior comparison, not whole-HEAD repository regression.

Two preliminary harness attempts were invalid comparisons (tsx/cjs alone did not resolve native dynamic imports in the test; command-line source payload exceeded Windows argument capacity). Corrected by transpiling the test to CommonJS and passing overlay through stdin. Their errors are harness failures, excluded from security/baseline counts; no application source changed.

Implementation report's approximately 381 pass / 283 fail is historical, not independently re-run here. The 283 failures remain reported failures, not pass or TEST_NOT_EXECUTED after execution. No comparable full-suite baseline exists; do not label all 283 regressions or all environment-only without individual investigation. DB-backed agent-workflow-finalization-race.test.ts was inspected but not run against unavailable DB.

### Coverage assessment of 21 tests

All 21 executed. They meaningfully assert shared routes, JWT spoof isolation, role/ownership, downstream-not-reached, 429/Retry-After, sanitized 503, local concurrency and atomic-style fake DDB. Genuine user JWT verification is replaced at authServiceClientDeps; six expensive handlers/queue controllers are stubbed. “No row/job on reject” means handler not called, not real DB/queue integration. Fake DDB does synchronous Map increment; it does not prove DynamoDB consistency, IAM, deployed provider or actual expression execution. Concurrent cross-route DDB test declares four paths but uses i%2, so actually alternates two. Public gateway tests in the suite only construct gw headers; independent actual Gateway probe closes that gap for A/C/D. All model tripwires stayed zero; mock provider/no real credentials additionally isolated execution.

## 11. Independent acceptance gates

| Gate | Result | Evidence |
|---|---|---|
| Authenticated user quotas | PASS scoped | 21 tests + rate-limit regressions; protected route policy, context user key |
| Cross-endpoint quota sharing | PARTIAL | Listed expensive endpoints share; chat nutrition command R01 bypasses expensive tier |
| No caller spoofing | PASS scoped | Actual Gateway rejects C/D; direct JWT ignores forged user; six routes refuse A/B/F |
| Trusted service identity | PARTIAL | Shared secret + no Bearer works; no named service attestation, dev fallback caveat |
| Gateway unauthenticated handling | PASS | Actual app/proxy C/D: 12 × 401 before AI handler |
| Original user ID attribution | PASS scoped | Tests body/header spoof; fitness client header user preserved; PT actor policy disclosed |
| Queued billable action coverage | FAIL | Real proposeNutritionPlan + queue command fixture after exhausted ai-expensive |
| Concurrent admission | PARTIAL | 12-way memory/fake DDB bounded; command/worker idempotency incomplete |
| Distributed quota correctness | NOT_VERIFIED | Atomic source plausible; no actual table/multi-instance run/runtime config |
| Fail-closed behavior | PARTIAL | Tested provider-outage routes 503; unmetered command gap, off/default/runtime caveats |
| Internal caller compatibility | PARTIAL | Six wrappers pass success/fallback probes; pre-existing worker missing auth, no full DB journey |
| Admin/background job policy | PARTIAL | Role/secret gates reviewed; explicit spend/retry policy absent and runtime unknown |
| Regression coverage | PARTIAL | 50 unique scoped tests pass, policy HEAD comparison; full suite DB/Redis blocked |
| No paid inference | PASS | Mock provider, synthetic-only environment, model tripwires 0, queue transports fake |
| No unrelated modifications | PASS | Reviewer creates only this report; V-T001.1/Bedrock/source unchanged |

PASS scoped does not certify production deployment or paid inference success.

## 12. Exact V-T012.1 implementation scope

1. Correct endpoint/action cost inventory around nutrition propose/revise and indirect flows; do not assume confirm performs generation. Preserve deterministic confirmation semantics.
2. Add one shared billable-generation admission command for REST + chat initial/revision + adjustments, preserving current name:userId budget policy and verified origin. Move queued REST charging into that same boundary (remove duplicate route charge for those commands only); retain sync/vision/marketplace route limits and chat ai-ask tier.
3. Define stable generation operation ID and durable reservation/enqueue outcome. Repeated same operation must not double charge or publish a distinct job. Quota rejection must precede work and preserve existing draft; definite failure can compensate once, ambiguous publish must reconcile using the same operation. Do not invent a second authoritative action/plan state; use current Plan/Job/action ownership boundaries, documenting any persistence change before implementation.
4. Worker checks/claims the admitted operation before model work, fences owner/attempt, returns prior completed work on duplicate; separately bound repairs/retries/concurrency. Per-request rate quota alone cannot promise total dollars or exactly-once side effects across DB/SQS.
5. Focused tests: expensive exhausted through REST then chat and reverse; initial/revision sharing; owner/actor spoof; rejected request leaves draft unchanged; concurrent same-operation admission; publish failure and ambiguous success; action save/jobId update failure; retry/redelivery; deterministic confirm/replay not billed as new generation. Run DB/Redis tests only with verified isolated services; real DDB concurrency needs a separately authorized environment.
6. Keep V-T003 execute/claim/release/finalize unchanged in an independent admission patch. If using action status/claim for reservation, coordinate that transition/fencing with V-T003 first. Same source file alone is not sufficient reason to move enforcement to confirm or to block a well-scoped generation-command correction.

No generic middleware on all confirmations; no weakening internal auth; no changes to V-T001.1, Bedrock, AWS, schema or deployment authorized by this review.

## 13. Residual risks and recommended next action

Current implementation is useful and its 21-test red/green signal was independently reproduced. No configured public auth bypass was confirmed. Nevertheless R01/R02 plus DEPLOYMENT_NOT_VERIFIED prevent sufficiently credible cost-governance approval.

Next action: one V-T012.1 patch for idempotent generation admission at the REST/chat shared command boundary, with lifecycle coordination as above; then independent re-review and isolated integration/runtime evidence. Do not close V-T012 or start controlled deployment review yet. No production deployment has occurred in this task.

## 14. Reproduction appendix (all synthetic; do not load real .env)

Use child Node from backend/services/ai-service with minimal environment in section 10, -r <resolved tsx/cjs> -, snippet on stdin, stdout captured by parent. Windows Node executable: C:/Program Files/nodejs/node.exe. No files/scripts are written by these probes.

### Actual Gateway/AI and actual fitness clients

Set AI_INTERNAL_RATE_LIMIT_MAX=1000 for compatibility matrix so repeated failure probes do not spend its tiny test allowance. Actual auth-server is a localhost synthetic fixture.

```js
const http=require('http');const routes=['analyze-cycle','assess-cycle','analyze-feedback','generate-client-plan-draft','generate-roadmap-draft','explain-exercise-progression'];const methods=[['cycle-analysis.controller','cycleAnalysisController','analyzeCycle'],['cycle-assessment.controller','cycleAssessmentController','assessCycle'],['feedback-analysis.controller','feedbackAnalysisController','analyzeFeedback'],['client-plan-draft.controller','clientPlanDraftController','generateDraft'],['roadmap-draft.controller','roadmapDraftController','generateDraft'],['exercise-progression-explanation.controller','exerciseProgressionExplanationController','explain']];let forcedStatus=200,modelCalls=0,handlerCalls=0;const {llmService}=require('./src/services/llm.service.ts');llmService.callLLM=async()=>{modelCalls++;throw Error('MODEL_TRIPWIRE')};require('./src/clients/auth-service.client.ts').authServiceClientDeps.verify=async(token)=>{if(token!=='SYN_VALID_JWT')throw Object.assign(Error('synthetic invalid'),{response:{status:401}});return {data:{user:{id:'verified-user',role:'CUSTOMER'}}}};for(const [file,obj,method]of methods)require('./src/controllers/'+file+'.ts')[obj][method]=(req,res)=>{handlerCalls++;res.status(forcedStatus).json({success:forcedStatus===200,data:{...req.context,authorizationHeader:undefined},error:forcedStatus===200?undefined:{code:'SYN_STATUS'}})};const ai=require('./src/app.ts').default;const servers=[];async function serve(app){const s=http.createServer(app);await new Promise(r=>s.listen(0,'127.0.0.1',r));servers.push(s);return 'http://127.0.0.1:'+s.address().port}async function go(){const aiUrl=await serve(ai);const authUrl=await serve((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization==='Bearer SYN_VALID_JWT')res.end(JSON.stringify({user:{id:'verified-user',role:'CUSTOMER'}}));else{res.statusCode=401;res.end('{}')}});process.env.AUTH_SERVICE_URL=authUrl;process.env.AI_SERVICE_URL=aiUrl;process.env.AI_INTERNAL_RATE_LIMIT_MAX='1000';const gateway=require('../../gateway/src/app.ts').default;const gwUrl=await serve(gateway);const s=process.env.INTERNAL_SERVICE_SECRET;const results=[];async function probe(name,base,headers){for(const route of routes){const response=await fetch(base+'/ai/'+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({userId:'body-victim'})});const body=await response.json();results.push({name,route,status:response.status,context:response.status===200?body.data:undefined});}}await probe('A_gateway_user',gwUrl,{Authorization:'Bearer SYN_VALID_JWT','x-user-id':'forged-victim','x-internal-token':'wrong'});await probe('B_direct_jwt',aiUrl,{Authorization:'Bearer SYN_VALID_JWT','x-user-id':'forged-victim'});await probe('C_gateway_unauth',gwUrl,{});await probe('D_gateway_forged_identity',gwUrl,{'x-user-id':'forged-victim','x-user-role':'ADMIN'});await probe('D_direct_forged_identity',aiUrl,{'x-user-id':'forged-victim'});await probe('E_internal_no_bearer',aiUrl,{'x-internal-token':s,'x-user-id':'origin-user'});await probe('F_internal_and_bearer',aiUrl,{'x-internal-token':s,'x-user-id':'origin-user',Authorization:'Bearer SYN_VALID_JWT'});const fit=require('../fitness-service/src/clients/ai.client.ts');const names=['analyzeCycleSafe','assessCycleSafe','analyzeFeedbackSafe','generateClientPlanDraftSafe','generateRoadmapDraftSafe','explainExerciseProgressionSafe'];const compatibility=[];for(const name of names){forcedStatus=200;const ok=await fit[name]('fitness-origin-user',{});compatibility.push({name,status:200,context:ok});for(const status of [403,429,503]){forcedStatus=status;compatibility.push({name,status,returnedNull:(await fit[name]('fitness-origin-user',{}))===null});}}console.log(JSON.stringify({results,compatibility,modelCalls,handlerCalls}));}go().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await Promise.all(servers.map(s=>new Promise(r=>s.close(r))))});
```

### Queue admission/persistence gap

Set QUEUE_PROVIDER=sqs, AI_TASKS_QUEUE_URL=https://synthetic.invalid/SYN_QUEUE; sqsDeps is stubbed before calls, so this URL is never contacted.

```js
const assert=require('assert/strict');const {fitnessAgent,fitnessAgentDeps}=require('./src/services/fitness-agent.service.ts');const {conversationService}=require('./src/services/conversation.service.ts');const {conversationRepository,prisma}=require('./src/repositories/conversation.repository.ts');const {llmService}=require('./src/services/llm.service.ts');const {sqsDeps}=require('./src/workers/queue-provider.ts');const {getRateLimiter}=require('./src/services/rate-limit/provider.ts');let queued=0,created=0,actionCreates=0,modelCalls=0;const sent=[];llmService.callLLM=async()=>{modelCalls++;throw Error('MODEL_TRIPWIRE')};llmService.getHealthStatus=async()=>({llmAvailable:true});fitnessAgentDeps.tools.getNutritionTargetPreview=async()=>({status:'ACTIVE_GOAL',goalId:'goal-synthetic',calories:2000,protein:125,carbs:250,fat:56});fitnessAgentDeps.tools.getNutritionActiveState=async()=>null;fitnessAgentDeps.profileExtractor.extract=async()=>({profile:{goal:'MAINTENANCE',currentWeightKg:70,heightCm:175,age:30,gender:'MALE',activityLevel:'MODERATE'}});conversationRepository.createNutritionPlan=async(params)=>{created++;return {id:'SYN_PLAN_'+created,...params}};conversationRepository.updateNutritionPlanJob=async()=>{};sqsDeps.sendMessage=async(command)=>{queued++;sent.push(JSON.parse(command.input.MessageBody));return {MessageId:'SYN_JOB_'+queued}};prisma.fitnessAgentAction.create=async({data})=>{actionCreates++;return {id:'SYN_ACTION_'+actionCreates,...data}};const identity={userId:'verified-fixture-user',role:'CUSTOMER'};async function go(){const limiter=getRateLimiter('memory');await limiter.consume({key:'ai-expensive:'+identity.userId,max:1,windowSeconds:3600});const exhausted=await limiter.consume({key:'ai-expensive:'+identity.userId,max:1,windowSeconds:3600});assert.equal(exhausted.allowed,false);await fitnessAgent.proposeNutritionPlan('Create a nutrition plan',identity,'synthetic-session');const afterFirst={queued,created,actionCreates};prisma.fitnessAgentAction.create=async()=>{throw Error('SYN_ACTION_PERSIST_FAILURE')};let failed=false;try{await fitnessAgent.proposeNutritionPlan('Create a nutrition plan',identity,'synthetic-session')}catch{failed=true}const afterFailure={failed,queued,created};console.log(JSON.stringify({expensiveQuotaExhausted:!exhausted.allowed,afterFirst,afterFailure,sentUsers:sent.map(m=>m.data.userId),modelCalls}));}go().catch(e=>{console.error(e);process.exitCode=1});
```

### Confirmation ownership/atomic claim fixture

```js
const assert=require('assert/strict');const {fitnessAgent,fitnessAgentDeps}=require('./src/services/fitness-agent.service.ts');const {prisma}=require('./src/repositories/conversation.repository.ts');const {conversationService}=require('./src/services/conversation.service.ts');const {llmService}=require('./src/services/llm.service.ts');let writes=0,queues=0,models=0;let action={id:'SYN_ACTION',userId:'verified-user',sessionId:'SYN_SESSION',kind:'CREATE_WORKOUT_PLAN',status:'PENDING',expiresAt:new Date(Date.now()+60000),payload:{weeklySchedule:[{day:1,exercises:[]}],goal:'MAINTENANCE'}};prisma.fitnessAgentAction.findFirst=async({where})=>where.userId===action.userId?{...action}:null;prisma.chatSession.findFirst=async({where})=>where.userId===action.userId?{id:'SYN_SESSION'}:null;prisma.fitnessAgentAction.updateMany=async({where,data})=>{if(where.status&&where.status!==action.status)return {count:0};Object.assign(action,data);return {count:1}};fitnessAgentDeps.tools.importAiPlanToSchedule=async()=>{writes++;await new Promise(r=>setTimeout(r,20));return {message:'synthetic saved'}};conversationService.queuePlanGeneration=async()=>{queues++;throw Error('QUEUE_TRIPWIRE')};conversationService.queueNutritionPlanGeneration=async()=>{queues++;throw Error('QUEUE_TRIPWIRE')};llmService.callLLM=async()=>{models++;throw Error('MODEL_TRIPWIRE')};async function go(){let foreignStatus;try{await fitnessAgent.execute({userId:'other-user'},action.id,true)}catch(e){foreignStatus=e.status}const result=await Promise.allSettled(Array.from({length:6},()=>fitnessAgent.execute({userId:'verified-user'},action.id,true)));await fitnessAgent.execute({userId:'verified-user'},action.id,true);assert.equal(writes,1);assert.equal(queues,0);assert.equal(models,0);console.log(JSON.stringify({foreignStatus,concurrentFulfilled:result.filter(x=>x.status==='fulfilled').length,conflicts:result.filter(x=>x.status==='rejected').map(x=>x.reason.status),writes,queues,models,finalStatus:action.status,completedReplayReused:true}));}go().catch(e=>{console.error(e);process.exitCode=1});
```

### Baseline overlay procedure

Read only these five HEAD paths using git show; do not replace their working-tree contents:

```text
backend/services/ai-service/src/middleware/auth.middleware.ts
backend/services/ai-service/src/routes/ai.routes.ts
backend/services/ai-service/src/routes/fitness-agent.routes.ts
backend/services/ai-service/src/routes/marketplace.routes.ts
backend/services/ai-service/src/routes/plan.routes.ts
```

In a child registered with tsx/cjs, overlay Module._extensions['.ts'] for those absolute filenames using typescript.transpileModule({target:ES2022,module:CommonJS,esModuleInterop:true}); delegate all other files to original hook. Also transpile the current ai-endpoint-policy.test.ts through the same hook to transform dynamic imports. Require that current test. Run again with only the test overlay for the current control. Pass the program via stdin, not the Windows command line. Credentials/env/dependencies and test assertions stay identical; failures are expected only in the HEAD policy counterfactual. This operation reads code strings only and never invokes data/evaluation jobs.
